/* ------------------------------------------------------------------ *
 * Kianimation Endless Rush — the runner.
 *
 * A lightweight procedural character: a jointed rig of oriented boxes,
 * posed every frame from the engine's state. No skeleton file, no
 * texture, no animation data — the run cycle, the jump tuck, the slide
 * and the lean into a lane change are all trigonometry.
 *
 * ── Replacing this with a Meshy GLB ───────────────────────────────────
 * Nothing outside this file knows what the runner looks like. The
 * engine hands over a plain `pose` object (see `readPose`) and the
 * renderer only ever receives finished geometry, so a glTF character
 * drops in by implementing one interface:
 *
 *     { ready: boolean,
 *       draw(r, pose, tint): boolean,   // false → fall back to boxes
 *       setSize(w, h, dpr),
 *       dispose() }
 *
 * `character.js` already implements that interface on top of three.js
 * and is wired up below — put `runner.glb` in `public/models/` and it
 * takes over automatically, with the boxes below as the safety net if
 * WebGL, three.js or the file itself is unavailable.
 * ------------------------------------------------------------------ */

import { clamp, lerp, L_VOLUME, rgba } from "./render.js";
import { curveAt, hillAt } from "./world.js";
import { SLIDE_H, STAND_H } from "./engine.js";

/* ------------------------------ palette ------------------------------ */

export const KIT = {
  skin: "#b0714a",
  hair: "#20191a",
  shirt: "#e9b45c",
  sleeve: "#2b313d",
  trouser: "#333b4d",
  shoe: "#f2f0ea",
  sole: "#d99a3a",
  scarf: "#d8543f",
};

/* Key light: high, slightly left, slightly ahead of the runner. */
const LX = -0.34, LY = 0.86, LZ = -0.38;

/* ------------------------- oriented box drawing ------------------------- */

/*  A box of arbitrary orientation, given as a segment between two points
    plus a thickness. Only the faces turned toward the camera are filled,
    and each face is shaded by a plain Lambert term so limbs read as
    round-ish rather than as flat cut-outs. */
function segment(r, ax, ay, az, bx, by, bz, halfW, halfT, hex, tint) {
  let dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) return;
  dx /= len; dy /= len; dz /= len;

  // right = d × worldUp, except when the segment is itself near-vertical
  let rx, ry, rz;
  if (Math.abs(dy) > 0.985) {
    rx = 1; ry = 0; rz = 0;
  } else {
    rx = -dz; ry = 0; rz = dx;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl; rz /= rl;
  }
  // up = d × right
  const ux = dy * rz - dz * ry;
  const uy = dz * rx - dx * rz;
  const uz = dx * ry - dy * rx;

  const cxp = (ax + bx) * 0.5, cyp = (ay + by) * 0.5, czp = (az + bz) * 0.5;
  const hl = len * 0.5;

  const c = [];
  for (let i = 0; i < 8; i += 1) {
    const sl = (i & 1) ? 1 : -1;
    const sw = (i & 2) ? 1 : -1;
    const st = (i & 4) ? 1 : -1;
    c.push([
      cxp + dx * hl * sl + rx * halfW * sw + ux * halfT * st,
      cyp + dy * hl * sl + ry * halfW * sw + uy * halfT * st,
      czp + dz * hl * sl + rz * halfW * sw + uz * halfT * st,
    ]);
  }

  // face index quads, with the outward normal of each
  const FACES = [
    [[1, 3, 7, 5], dx, dy, dz],
    [[0, 4, 6, 2], -dx, -dy, -dz],
    [[2, 6, 7, 3], rx, ry, rz],
    [[0, 1, 5, 4], -rx, -ry, -rz],
    [[4, 5, 7, 6], ux, uy, uz],
    [[0, 2, 3, 1], -ux, -uy, -uz],
  ];

  const cam = r.cam;
  for (const [idx, nx, ny, nz] of FACES) {
    const p0 = c[idx[0]];
    // back-face cull against the eye vector
    if (nx * (cam.x - p0[0]) + ny * (cam.y - p0[1]) + nz * (cam.z - p0[2]) <= 0) continue;
    const lamb = Math.max(0, nx * LX + ny * LY + nz * LZ);
    const light = (0.44 + 0.62 * lamb) * tint;
    const p1 = c[idx[1]], p2 = c[idx[2]], p3 = c[idx[3]];
    r.quad(
      p0[0], p0[1], p0[2],
      p1[0], p1[1], p1[2],
      p2[0], p2[1], p2[2],
      p3[0], p3[1], p3[2],
      hex, light, L_VOLUME,
    );
  }
}

/* ------------------------------ the rig ------------------------------ */

/* Forward kinematics in the sagittal plane. `ang` is measured from
   straight down, positive swinging forward (+Z). */
function chain(x, y, z, segs) {
  const pts = [[x, y, z]];
  let ang = 0, cy = y, cz = z;
  for (const s of segs) {
    ang += s.a;
    cz += Math.sin(ang) * s.l;
    cy -= Math.cos(ang) * s.l;
    pts.push([x, cy, cz]);
  }
  return pts;
}

/** Everything the character needs, extracted from the engine state. */
export function readPose(s) {
  return {
    x: s.x,
    y: s.y,
    z: s.z,
    lean: s.lean,
    phase: s.runPhase,
    airborne: s.airborne,
    vy: s.vy,
    sliding: s.sliding,
    slideT: s.slideT,
    speed: s.speed,
    stumble: s.stumble,
    dead: s.phase === "dead",
    boost: s.powers.boost,
    shield: s.powers.shield,
    magnet: s.powers.magnet,
    double: s.powers.double,
  };
}

/* --------------------------- pose evaluation --------------------------- */

const smoothed = { slide: 0, air: 0, dead: 0 };

function evaluate(p, dt) {
  const k = Math.min(1, dt * 14);
  smoothed.slide += ((p.sliding ? 1 : 0) - smoothed.slide) * k;
  smoothed.air += ((p.airborne ? 1 : 0) - smoothed.air) * k;
  smoothed.dead += ((p.dead ? 1 : 0) - smoothed.dead) * Math.min(1, dt * 6);

  const ph = p.phase;
  const swing = Math.sin(ph);
  const swing2 = Math.sin(ph + Math.PI);

  /* ---- running legs ---- */
  let hipL = swing * 0.92;
  let hipR = swing2 * 0.92;
  let kneeL = Math.max(0, -Math.sin(ph + 0.7)) * 1.5 + 0.12;
  let kneeR = Math.max(0, -Math.sin(ph + 0.7 + Math.PI)) * 1.5 + 0.12;
  let shoulderL = -swing * 0.82 - 0.15;
  let shoulderR = -swing2 * 0.82 - 0.15;
  let elbowL = 1.15;
  let elbowR = 1.15;
  let bob = 0.055 * (1 - Math.cos(ph * 2)) * 0.5;
  let torso = 0.2 + clamp(p.speed * 0.006, 0, 0.16);

  /* ---- airborne: tuck on the way up, reach on the way down ---- */
  if (smoothed.air > 0.01) {
    const rise = clamp(p.vy / 7, -1, 1);
    const tuck = clamp(0.5 + rise * 0.5, 0, 1);
    const aHipL = lerp(0.35, 1.25, tuck);
    const aHipR = lerp(0.05, 0.55, tuck);
    const aKneeL = lerp(0.5, 1.75, tuck);
    const aKneeR = lerp(0.25, 0.95, tuck);
    hipL = lerp(hipL, aHipL, smoothed.air);
    hipR = lerp(hipR, aHipR, smoothed.air);
    kneeL = lerp(kneeL, aKneeL, smoothed.air);
    kneeR = lerp(kneeR, aKneeR, smoothed.air);
    shoulderL = lerp(shoulderL, -1.5, smoothed.air);
    shoulderR = lerp(shoulderR, -1.1, smoothed.air);
    elbowL = lerp(elbowL, 0.55, smoothed.air);
    elbowR = lerp(elbowR, 0.8, smoothed.air);
    bob = lerp(bob, 0, smoothed.air);
    torso = lerp(torso, 0.1, smoothed.air);
  }

  /* ---- sliding: legs out in front, arms tucked back ---- */
  if (smoothed.slide > 0.01) {
    hipL = lerp(hipL, 1.05, smoothed.slide);
    hipR = lerp(hipR, 0.72, smoothed.slide);
    kneeL = lerp(kneeL, 0.12, smoothed.slide);
    kneeR = lerp(kneeR, 0.85, smoothed.slide);
    shoulderL = lerp(shoulderL, 0.85, smoothed.slide);
    shoulderR = lerp(shoulderR, 0.7, smoothed.slide);
    elbowL = lerp(elbowL, 0.7, smoothed.slide);
    elbowR = lerp(elbowR, 0.7, smoothed.slide);
    bob = 0;
  }

  return {
    hipL, hipR, kneeL, kneeR,
    shoulderL, shoulderR, elbowL, elbowR,
    bob, torso,
    slide: smoothed.slide,
    air: smoothed.air,
    dead: smoothed.dead,
  };
}

/* ---------------------------- transform stack ---------------------------- */

/* Rig-local → world. Roll for the lane-change lean, pitch for the slide
   recline, yaw so the runner angles into the direction of travel. */
function makeXform(pose, ev) {
  const roll = -pose.lean * 0.3;
  const yaw = pose.lean * 0.2;
  const pitch = -ev.slide * 1.26 - ev.dead * 0.5;
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const pivotY = 0.34;

  const wx = pose.x + curveAt(pose.z);
  const wy = pose.y + hillAt(pose.z) + ev.bob;
  const wz = pose.z;

  return function xf(p) {
    let x = p[0];
    let y = p[1] - pivotY;
    let z = p[2];
    // roll about Z
    let nx = x * cr - y * sr;
    let ny = x * sr + y * cr;
    x = nx; y = ny;
    // pitch about X
    ny = y * cp - z * sp;
    const nz = y * sp + z * cp;
    y = ny; z = nz;
    // yaw about Y
    nx = x * cy + z * sy;
    const nz2 = -x * sy + z * cy;
    x = nx; z = nz2;
    return [wx + x, wy + y + pivotY, wz + z];
  };
}

/* ------------------------------- drawing ------------------------------- */

const HIP_Y = 0.90;
const SHOULDER_Y = 1.40;

function drawBody(r, pose, ev, tint) {
  const xf = makeXform(pose, ev);
  const hurt = pose.stumble > 0 ? 1 : 0;
  const skin = hurt ? "#c07a4e" : KIT.skin;

  /* ---- legs ---- */
  for (const [side, hip, knee] of [[-1, ev.hipL, ev.kneeL], [1, ev.hipR, ev.kneeR]]) {
    const j = chain(side * 0.15, HIP_Y, 0, [{ l: 0.45, a: hip }, { l: 0.44, a: -knee }]);
    const a = xf(j[0]), b = xf(j[1]), c = xf(j[2]);
    segment(r, a[0], a[1], a[2], b[0], b[1], b[2], 0.105, 0.105, KIT.trouser, tint);
    segment(r, b[0], b[1], b[2], c[0], c[1], c[2], 0.085, 0.085, KIT.trouser, tint);
    // foot, pointing along the shin's forward direction
    const footAng = hip - knee;
    const f = [
      j[2][0],
      j[2][1] - 0.02 + Math.sin(footAng) * 0.02,
      j[2][2] + Math.cos(footAng) * 0.14,
    ];
    const fw = xf(f);
    segment(r, c[0], c[1], c[2], fw[0], fw[1], fw[2], 0.085, 0.06, KIT.shoe, tint);
    segment(r, c[0], c[1] - 0.03, c[2], fw[0], fw[1] - 0.03, fw[2], 0.088, 0.028, KIT.sole, tint);
  }

  /* ---- torso ---- */
  const hipC = xf([0, HIP_Y, 0]);
  const chest = xf([0, SHOULDER_Y, Math.sin(ev.torso) * 0.14]);
  segment(r, hipC[0], hipC[1], hipC[2], chest[0], chest[1], chest[2], 0.185, 0.125, KIT.shirt, tint);

  /* ---- arms ---- */
  for (const [side, sh, el] of [[-1, ev.shoulderL, ev.elbowL], [1, ev.shoulderR, ev.elbowR]]) {
    const ox = side * 0.235;
    const j = chain(ox, SHOULDER_Y - 0.03, Math.sin(ev.torso) * 0.12,
      [{ l: 0.31, a: sh }, { l: 0.30, a: -el }]);
    const a = xf(j[0]), b = xf(j[1]), c = xf(j[2]);
    segment(r, a[0], a[1], a[2], b[0], b[1], b[2], 0.075, 0.075, KIT.sleeve, tint);
    segment(r, b[0], b[1], b[2], c[0], c[1], c[2], 0.065, 0.065, skin, tint);
  }

  /* ---- head ---- */
  const neck = xf([0, SHOULDER_Y + 0.04, Math.sin(ev.torso) * 0.14]);
  const headBase = [0, SHOULDER_Y + 0.10, Math.sin(ev.torso) * 0.15];
  const headTop = [0, SHOULDER_Y + 0.42, Math.sin(ev.torso) * 0.19];
  const hb = xf(headBase), ht = xf(headTop);
  segment(r, neck[0], neck[1], neck[2], hb[0], hb[1], hb[2], 0.07, 0.07, skin, tint);
  segment(r, hb[0], hb[1], hb[2], ht[0], ht[1], ht[2], 0.125, 0.115, skin, tint);
  const hairA = xf([0, SHOULDER_Y + 0.30, Math.sin(ev.torso) * 0.17]);
  const hairB = xf([0, SHOULDER_Y + 0.45, Math.sin(ev.torso) * 0.19]);
  segment(r, hairA[0], hairA[1], hairA[2], hairB[0], hairB[1], hairB[2], 0.132, 0.122, KIT.hair, tint);

  /* ---- trailing scarf ----
     The camera sits directly behind the runner, so anything that streams
     straight back ends up between the lens and his head. This one lifts
     as it trails and drifts to one side, reading as a ribbon over the
     shoulder rather than a curtain across the view. */
  const sway = Math.sin(pose.phase * 0.9) * 0.2;
  const drag = clamp(pose.speed * 0.02, 0.3, 0.7);
  let px = 0.1, py = SHOULDER_Y + 0.04, pz = -0.04;
  for (let i = 1; i <= 3; i += 1) {
    const nx = px + 0.13 + sway * i * 0.5 - pose.lean * 0.3 * i;
    const ny = py + 0.09 + Math.sin(pose.phase * 1.3 + i) * 0.05;
    const nz = pz - drag * (0.2 + i * 0.05);
    const A = xf([px, py, pz]);
    const B = xf([nx, ny, nz]);
    segment(r, A[0], A[1], A[2], B[0], B[1], B[2], 0.055 - i * 0.011, 0.018, KIT.scarf, tint);
    px = nx; py = ny; pz = nz;
  }
}

/* ------------------------------- effects ------------------------------- */

function bubble(ctx, sx, sy, scale, arg) {
  const rad = arg.r * scale;
  ctx.save();
  const g = ctx.createRadialGradient(sx, sy - rad * 0.1, rad * 0.35, sx, sy - rad * 0.1, rad);
  g.addColorStop(0, rgba(arg.hex, 0.02));
  g.addColorStop(0.72, rgba(arg.hex, 0.14 * arg.a));
  g.addColorStop(0.94, rgba(arg.hex, 0.5 * arg.a));
  g.addColorStop(1, rgba(arg.hex, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(sx, sy - rad * 0.1, rad * 0.78, rad, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawAura(r, pose, ev, t) {
  const wx = pose.x + curveAt(pose.z);
  const wy = pose.y + hillAt(pose.z);
  const wz = pose.z;

  if (pose.shield > 0) {
    const fade = pose.shield < 2.2 ? (0.35 + 0.65 * Math.abs(Math.sin(t * 9))) : 1;
    r.custom(wx, wy + 0.95, wz, bubble, { r: 1.25, hex: "#63d5ff", a: fade }, L_VOLUME + 0.4);
  }
  if (pose.boost > 0) {
    const fade = pose.boost < 1.4 ? (0.4 + 0.6 * Math.abs(Math.sin(t * 11))) : 1;
    for (let i = 0; i < 5; i += 1) {
      const k = i / 5;
      r.glow(wx - pose.lean * 0.3 * k, wy + 0.5 + Math.sin(t * 14 + i) * 0.12, wz - 0.6 - k * 2.2,
        0.75 - k * 0.1, i % 2 ? "#ffcf5c" : "#ff8a3d", (0.55 - k * 0.08) * fade);
    }
  }
  if (pose.magnet > 0) {
    const fade = pose.magnet < 2 ? (0.4 + 0.6 * Math.abs(Math.sin(t * 9))) : 1;
    for (let i = 0; i < 3; i += 1) {
      const a = t * 2.6 + (i * Math.PI * 2) / 3;
      r.glow(wx + Math.cos(a) * 1.05, wy + 0.95 + Math.sin(a * 1.6) * 0.25, wz + Math.sin(a) * 0.7,
        0.34, "#9e62ff", 0.6 * fade);
    }
  }
  if (pose.double > 0) {
    const fade = pose.double < 2 ? (0.4 + 0.6 * Math.abs(Math.sin(t * 9))) : 1;
    r.glow(wx, wy + 2.15 + Math.sin(t * 3) * 0.08, wz, 0.42, "#f4b965", 0.7 * fade);
  }
  void ev;
}

/* ------------------------------- factory ------------------------------- */

/**
 * Creates the runner drawer. `driver` is the optional GLB-backed
 * character; when it is absent, not ready, or reports that it could not
 * draw, the procedural rig below is used instead — so the game is always
 * playable regardless of what does or does not load.
 */
export function createRunner() {
  let driver = null;

  return {
    /** Attach a glTF character. See character.js for the interface. */
    setDriver(d) { driver = d; },
    get driver() { return driver; },

    draw(r, s, tint, dt, t) {
      const pose = readPose(s);
      // world-space placement, shared by both the boxes and any GLB driver
      pose.wx = pose.x + curveAt(pose.z);
      pose.wy = pose.y + hillAt(pose.z);
      pose.wz = pose.z;
      const ev = evaluate(pose, Math.min(dt, 0.05));
      ev.dt = dt;

      // contact shadow first: it belongs to the ground, not the body
      const sx = pose.x + curveAt(pose.z);
      const sy = hillAt(pose.z) + 0.012;
      const lift = clamp(1 - pose.y / 2.2, 0.32, 1);
      r.shadow(sx, sy, pose.z, 0.42 * lift + 0.1, 0.34 * lift + 0.08, 0.75 * lift);

      drawAura(r, pose, ev, t);

      if (driver && driver.ready && driver.draw(r, pose, ev, tint)) return;
      drawBody(r, pose, ev, tint);
    },

    dispose() {
      driver?.dispose?.();
      driver = null;
    },
  };
}

export { STAND_H, SLIDE_H };
