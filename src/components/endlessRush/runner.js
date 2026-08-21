/* ------------------------------------------------------------------ *
 * Kianimation Endless Rush — the runner.
 *
 * Poses and draws whichever character is selected. The bodies are the
 * real scans from `public/models/`, baked and skinned by
 * `tools/bake-models.mjs`; this file decides what they are doing.
 *
 * The scans have no skeleton, so the bake step invents one and paints
 * weights for eleven limb groups. Everything below is the other half of
 * that trick: a run cycle, a jump tuck, a slide, a pedalling crouch and
 * a hoverboard stance, all expressed as joint angles, composed into a
 * matrix per limb and handed to the skinner.
 *
 * If a mesh has not arrived yet — or never does — `drawBoxRig` takes
 * over. It is the same jointed-boxes runner the game shipped with, so a
 * failed download costs some detail and nothing else.
 * ------------------------------------------------------------------ */

import { clamp, lerp, L_VOLUME, rgba } from "./render.js";
import { curveAt, hillAt } from "./world.js";
import { SLIDE_H, STAND_H } from "./engine.js";
import {
  getMesh, drawSkinned, mat, matMul, matJoint, matPlace,
  G_PELVIS, G_TORSO, G_HEAD, G_ARM_UL, G_ARM_LL, G_ARM_UR, G_ARM_LR,
  G_LEG_UL, G_LEG_LL, G_LEG_UR, G_LEG_LR, GROUP_COUNT,
} from "./models.js";
import { characterById, drawRide, drawRideTrail } from "./characters.js";

/* The scans face −Z as exported; the game runs toward +Z. */
const MODEL_YAW = Math.PI;

/* ------------------------------ fallback kit ------------------------------ */

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

const LX = -0.34, LY = 0.86, LZ = -0.38;

/* ------------------------- oriented box drawing ------------------------- */

function segment(r, ax, ay, az, bx, by, bz, halfW, halfT, hex, tint) {
  let dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) return;
  dx /= len; dy /= len; dz /= len;

  let rx, ry, rz;
  if (Math.abs(dy) > 0.985) {
    rx = 1; ry = 0; rz = 0;
  } else {
    rx = -dz; ry = 0; rz = dx;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl; rz /= rl;
  }
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
    if (nx * (cam.x - p0[0]) + ny * (cam.y - p0[1]) + nz * (cam.z - p0[2]) <= 0) continue;
    const lamb = Math.max(0, nx * LX + ny * LY + nz * LZ);
    const light = (0.44 + 0.62 * lamb) * tint;
    const p1 = c[idx[1]], p2 = c[idx[2]], p3 = c[idx[3]];
    r.quad(
      p0[0], p0[1], p0[2], p1[0], p1[1], p1[2],
      p2[0], p2[1], p2[2], p3[0], p3[1], p3[2],
      hex, light, L_VOLUME,
    );
  }
}

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

/* ---------------------------- pose evaluation ---------------------------- */

/** Everything the character drawer needs, lifted out of the engine. */
export function readPose(s) {
  return {
    x: s.x,
    y: s.y,
    z: s.z,
    dist: s.dist,
    lean: s.lean,
    phase: s.runPhase,
    airborne: s.airborne,
    vy: s.vy,
    sliding: s.sliding,
    speed: s.speed,
    speedNorm: clamp((s.speed - 11) / 18, 0, 1.4),
    stumble: s.stumble,
    dead: s.phase === "dead",
    still: !!s.still,
    flying: s.powers.jetpack > 0,
    attack: s.attackT,
    attackKind: s.attackKind,
    boost: s.powers.boost,
    shield: s.powers.shield,
    magnet: s.powers.magnet,
    double: s.powers.double,
    jetpack: s.powers.jetpack,
    superJump: s.powers.superJump,
  };
}

const smoothed = { slide: 0, air: 0, dead: 0, fly: 0 };

export function resetPoseBlend() {
  smoothed.slide = 0; smoothed.air = 0; smoothed.dead = 0; smoothed.fly = 0;
}

/**
 * Joint angles for the current pose. Positive limb angles swing forward.
 * Ride-specific stances are blended on top of the run cycle rather than
 * replacing it, so a courier still bobs with the pedals and a skyrider
 * still braces on landing.
 */
function evaluate(p, dt, ride) {
  const k = Math.min(1, dt * 14);
  smoothed.slide += ((p.sliding ? 1 : 0) - smoothed.slide) * k;
  smoothed.air += ((p.airborne ? 1 : 0) - smoothed.air) * k;
  smoothed.fly += ((p.flying ? 1 : 0) - smoothed.fly) * Math.min(1, dt * 6);
  smoothed.dead += ((p.dead ? 1 : 0) - smoothed.dead) * Math.min(1, dt * 6);

  const ph = p.phase;
  const swing = Math.sin(ph);
  const swing2 = Math.sin(ph + Math.PI);

  const e = {
    hipL: swing * 0.92,
    hipR: swing2 * 0.92,
    kneeL: Math.max(0, -Math.sin(ph + 0.7)) * 1.5 + 0.12,
    kneeR: Math.max(0, -Math.sin(ph + 0.7 + Math.PI)) * 1.5 + 0.12,
    shoulderL: -swing * 0.82 - 0.15,
    shoulderR: -swing2 * 0.82 - 0.15,
    elbowL: 1.15,
    elbowR: 1.15,
    torso: 0.2 + clamp(p.speed * 0.006, 0, 0.16),
    head: 0,
    bob: 0.055 * (1 - Math.cos(ph * 2)) * 0.5,
    slide: smoothed.slide,
    air: smoothed.air,
    fly: smoothed.fly,
    dead: smoothed.dead,
    dt,
  };

  /* ---- riding stances ---- */
  if (ride === "bicycle") {
    // legs turn circles rather than swinging; the body folds over the bars
    const pedal = -p.dist / 0.34 * 0.55;
    e.hipL = 0.72 + Math.sin(pedal) * 0.55;
    e.hipR = 0.72 + Math.sin(pedal + Math.PI) * 0.55;
    e.kneeL = 0.95 - Math.cos(pedal) * 0.55;
    e.kneeR = 0.95 - Math.cos(pedal + Math.PI) * 0.55;
    e.shoulderL = 0.95;
    e.shoulderR = 0.95;
    e.elbowL = 0.35;
    e.elbowR = 0.35;
    e.torso = 0.72;
    e.head = -0.45;
    e.bob = Math.sin(pedal * 2) * 0.012;
  } else if (ride === "hoverboard") {
    // side-on surf stance, knees loaded, arms out for balance
    e.hipL = 0.44; e.hipR = 0.3;
    e.kneeL = 0.62; e.kneeR = 0.5;
    e.shoulderL = -0.5 - p.lean * 0.5;
    e.shoulderR = -0.5 + p.lean * 0.5;
    e.elbowL = 0.45; e.elbowR = 0.45;
    e.torso = 0.24;
    e.bob = Math.sin(ph * 0.5) * 0.012;
  } else if (ride === "jetshoes") {
    // a normal stride, but the feet never fully commit to the ground
    e.kneeL *= 0.72; e.kneeR *= 0.72;
    e.hipL *= 0.85; e.hipR *= 0.85;
    e.torso = 0.16;
  }

  /* ---- airborne ---- */
  if (smoothed.air > 0.01 && ride !== "bicycle") {
    const rise = clamp(p.vy / 7, -1, 1);
    const tuck = clamp(0.5 + rise * 0.5, 0, 1);
    e.hipL = lerp(e.hipL, lerp(0.35, 1.25, tuck), smoothed.air);
    e.hipR = lerp(e.hipR, lerp(0.05, 0.55, tuck), smoothed.air);
    e.kneeL = lerp(e.kneeL, lerp(0.5, 1.75, tuck), smoothed.air);
    e.kneeR = lerp(e.kneeR, lerp(0.25, 0.95, tuck), smoothed.air);
    e.shoulderL = lerp(e.shoulderL, -1.5, smoothed.air);
    e.shoulderR = lerp(e.shoulderR, -1.1, smoothed.air);
    e.elbowL = lerp(e.elbowL, 0.55, smoothed.air);
    e.elbowR = lerp(e.elbowR, 0.8, smoothed.air);
    e.bob = lerp(e.bob, 0, smoothed.air);
    e.torso = lerp(e.torso, 0.1, smoothed.air);
  }

  /* ---- low profile: a slide on foot, a duck on the bike ---- */
  if (smoothed.slide > 0.01) {
    const w = smoothed.slide;
    if (ride === "bicycle") {
      e.torso = lerp(e.torso, 1.42, w);       // flat over the bars
      e.head = lerp(e.head, -0.75, w);
      e.shoulderL = lerp(e.shoulderL, 1.35, w);
      e.shoulderR = lerp(e.shoulderR, 1.35, w);
    } else {
      e.hipL = lerp(e.hipL, 1.05, w);
      e.hipR = lerp(e.hipR, 0.72, w);
      e.kneeL = lerp(e.kneeL, 0.12, w);
      e.kneeR = lerp(e.kneeR, 0.85, w);
      e.shoulderL = lerp(e.shoulderL, 0.85, w);
      e.shoulderR = lerp(e.shoulderR, 0.7, w);
      e.elbowL = lerp(e.elbowL, 0.7, w);
      e.elbowR = lerp(e.elbowR, 0.7, w);
      e.bob = 0;
    }
  }

  /* ---- jetpack: upright, legs trailing ---- */
  if (smoothed.fly > 0.01) {
    const w = smoothed.fly;
    e.hipL = lerp(e.hipL, -0.35, w);
    e.hipR = lerp(e.hipR, -0.2, w);
    e.kneeL = lerp(e.kneeL, 0.5, w);
    e.kneeR = lerp(e.kneeR, 0.35, w);
    e.shoulderL = lerp(e.shoulderL, -0.35, w);
    e.shoulderR = lerp(e.shoulderR, -0.35, w);
    e.elbowL = lerp(e.elbowL, 0.3, w);
    e.elbowR = lerp(e.elbowR, 0.3, w);
    e.torso = lerp(e.torso, -0.12, w);
    e.bob = lerp(e.bob, Math.sin(p.phase * 0.6) * 0.03, w);
  }

  /* ---- attacks ---- */
  if (p.attack > 0) {
    const a = clamp(p.attack, 0, 1);
    const punch = Math.sin(a * Math.PI);
    if (p.attackKind === "kick" || p.attackKind === "airKick") {
      e.hipR = lerp(e.hipR, 1.55, punch);
      e.kneeR = lerp(e.kneeR, 0.1, punch);
      e.torso = lerp(e.torso, -0.2, punch);
      e.shoulderL = lerp(e.shoulderL, -0.9, punch);
    } else if (p.attackKind === "spin") {
      e.hipR = lerp(e.hipR, 1.2, punch);
      e.kneeR = lerp(e.kneeR, 0.35, punch);
      e.shoulderL = lerp(e.shoulderL, -1.5, punch);
      e.shoulderR = lerp(e.shoulderR, 1.5, punch);
    } else {
      e.shoulderR = lerp(e.shoulderR, -1.72, punch);
      e.elbowR = lerp(e.elbowR, 0.08, punch);
      e.shoulderL = lerp(e.shoulderL, 0.9, punch);
      e.torso = lerp(e.torso, 0.34, punch);
    }
  }

  return e;
}

/* ------------------------------ skinned draw ------------------------------ */

const MATS = Array.from({ length: GROUP_COUNT }, () => mat());
const LOCAL = Array.from({ length: GROUP_COUNT }, () => mat());
const TMP = mat();
const G = mat();

function place(m, pose, ev, ch, spinY) {
  /* Model space is one unit tall with the soles on zero, so the scale is
     simply the character's height. */
  const h = ch.height;
  const yaw = MODEL_YAW + pose.lean * 0.24 + (spinY || 0);
  const roll = -pose.lean * 0.26;
  const lift = ev.fly > 0.01 ? 0 : 0;
  matPlace(G,
    pose.wx, pose.wy + ev.bob + lift, pose.wz,
    h, h, h, yaw, roll);
  void m;
}

function composeLimbs(m, ev) {
  const P = m.pivots;
  const j = (out, pivot, ax, ay, az) => matJoint(out, pivot[0], pivot[1], pivot[2], ax, ay, az);

  // pelvis is the root; the torso leans forward from the same joint
  j(LOCAL[G_PELVIS], P[G_PELVIS], 0, 0, 0);
  j(TMP, P[G_TORSO], -ev.torso, 0, 0);
  matMul(LOCAL[G_TORSO], LOCAL[G_PELVIS], TMP);
  j(TMP, P[G_HEAD], -ev.head + ev.torso * 0.55, 0, 0);
  matMul(LOCAL[G_HEAD], LOCAL[G_TORSO], TMP);

  j(TMP, P[G_ARM_UL], -ev.shoulderL, 0, 0);
  matMul(LOCAL[G_ARM_UL], LOCAL[G_TORSO], TMP);
  j(TMP, P[G_ARM_LL], ev.elbowL, 0, 0);
  matMul(LOCAL[G_ARM_LL], LOCAL[G_ARM_UL], TMP);

  j(TMP, P[G_ARM_UR], -ev.shoulderR, 0, 0);
  matMul(LOCAL[G_ARM_UR], LOCAL[G_TORSO], TMP);
  j(TMP, P[G_ARM_LR], ev.elbowR, 0, 0);
  matMul(LOCAL[G_ARM_LR], LOCAL[G_ARM_UR], TMP);

  j(TMP, P[G_LEG_UL], -ev.hipL, 0, 0);
  matMul(LOCAL[G_LEG_UL], LOCAL[G_PELVIS], TMP);
  j(TMP, P[G_LEG_LL], ev.kneeL, 0, 0);
  matMul(LOCAL[G_LEG_LL], LOCAL[G_LEG_UL], TMP);

  j(TMP, P[G_LEG_UR], -ev.hipR, 0, 0);
  matMul(LOCAL[G_LEG_UR], LOCAL[G_PELVIS], TMP);
  j(TMP, P[G_LEG_LR], ev.kneeR, 0, 0);
  matMul(LOCAL[G_LEG_LR], LOCAL[G_LEG_UR], TMP);

  for (let i = 0; i < GROUP_COUNT; i += 1) matMul(MATS[i], G, LOCAL[i]);
}

/** Where the feet ended up, for the jet-shoe wings and the contact FX. */
function footPoints(m, ch) {
  const P = m.pivots;
  const out = [];
  for (const [g, side] of [[G_LEG_LL, -1], [G_LEG_LR, 1]]) {
    const mm = MATS[g];
    const px = P[g][0], py = 0.02, pz = P[g][2];
    out.push([
      mm[0] * px + mm[1] * py + mm[2] * pz + mm[3],
      mm[4] * px + mm[5] * py + mm[6] * pz + mm[7],
      mm[8] * px + mm[9] * py + mm[10] * pz + mm[11],
      side,
    ]);
  }
  void ch;
  return out;
}

/* ------------------------------ box fallback ------------------------------ */

const HIP_Y = 0.90;
const SHOULDER_Y = 1.40;

function makeXform(pose, ev, scale) {
  const roll = -pose.lean * 0.3;
  const yaw = pose.lean * 0.2;
  const pitch = -ev.slide * 1.26 - ev.dead * 0.5;
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const pivotY = 0.34;
  const wx = pose.wx, wy = pose.wy + ev.bob, wz = pose.wz;

  return function xf(p) {
    let x = p[0] * scale;
    let y = p[1] * scale - pivotY;
    let z = p[2] * scale;
    let nx = x * cr - y * sr;
    let ny = x * sr + y * cr;
    x = nx; y = ny;
    ny = y * cp - z * sp;
    const nz = y * sp + z * cp;
    y = ny; z = nz;
    nx = x * cy + z * sy;
    const nz2 = -x * sy + z * cy;
    return [wx + nx, wy + y + pivotY, wz + nz2];
  };
}

function drawBoxRig(r, pose, ev, tint, ch) {
  const scale = ch.height / STAND_H;
  const xf = makeXform(pose, ev, scale);
  const skin = pose.stumble > 0 ? "#c07a4e" : KIT.skin;

  for (const [side, hip, knee] of [[-1, ev.hipL, ev.kneeL], [1, ev.hipR, ev.kneeR]]) {
    const jt = chain(side * 0.15, HIP_Y, 0, [{ l: 0.45, a: hip }, { l: 0.44, a: -knee }]);
    const a = xf(jt[0]), b = xf(jt[1]), c = xf(jt[2]);
    segment(r, a[0], a[1], a[2], b[0], b[1], b[2], 0.105 * scale, 0.105 * scale, KIT.trouser, tint);
    segment(r, b[0], b[1], b[2], c[0], c[1], c[2], 0.085 * scale, 0.085 * scale, KIT.trouser, tint);
    const footAng = hip - knee;
    const f = [jt[2][0], jt[2][1] - 0.02 + Math.sin(footAng) * 0.02, jt[2][2] + Math.cos(footAng) * 0.14];
    const fw = xf(f);
    segment(r, c[0], c[1], c[2], fw[0], fw[1], fw[2], 0.085 * scale, 0.06 * scale, KIT.shoe, tint);
  }

  const hipC = xf([0, HIP_Y, 0]);
  const chest = xf([0, SHOULDER_Y, Math.sin(ev.torso) * 0.14]);
  segment(r, hipC[0], hipC[1], hipC[2], chest[0], chest[1], chest[2], 0.185 * scale, 0.125 * scale, KIT.shirt, tint);

  for (const [side, sh, el] of [[-1, ev.shoulderL, ev.elbowL], [1, ev.shoulderR, ev.elbowR]]) {
    const jt = chain(side * 0.235, SHOULDER_Y - 0.03, Math.sin(ev.torso) * 0.12,
      [{ l: 0.31, a: sh }, { l: 0.30, a: -el }]);
    const a = xf(jt[0]), b = xf(jt[1]), c = xf(jt[2]);
    segment(r, a[0], a[1], a[2], b[0], b[1], b[2], 0.075 * scale, 0.075 * scale, KIT.sleeve, tint);
    segment(r, b[0], b[1], b[2], c[0], c[1], c[2], 0.065 * scale, 0.065 * scale, skin, tint);
  }

  const neck = xf([0, SHOULDER_Y + 0.04, Math.sin(ev.torso) * 0.14]);
  const hb = xf([0, SHOULDER_Y + 0.10, Math.sin(ev.torso) * 0.15]);
  const ht = xf([0, SHOULDER_Y + 0.42, Math.sin(ev.torso) * 0.19]);
  segment(r, neck[0], neck[1], neck[2], hb[0], hb[1], hb[2], 0.07 * scale, 0.07 * scale, skin, tint);
  segment(r, hb[0], hb[1], hb[2], ht[0], ht[1], ht[2], 0.125 * scale, 0.115 * scale, skin, tint);
  const hairA = xf([0, SHOULDER_Y + 0.30, Math.sin(ev.torso) * 0.17]);
  const hairB = xf([0, SHOULDER_Y + 0.45, Math.sin(ev.torso) * 0.19]);
  segment(r, hairA[0], hairA[1], hairA[2], hairB[0], hairB[1], hairB[2],
    0.132 * scale, 0.122 * scale, KIT.hair, tint);
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

function drawAura(r, pose, ev, t, ch) {
  const wx = pose.wx, wy = pose.wy, wz = pose.wz;
  const h = ch.height;
  const fade = (left, span) => (left < span ? 0.4 + 0.6 * Math.abs(Math.sin(t * 9)) : 1);

  if (pose.shield > 0) {
    r.custom(wx, wy + h * 0.55, wz, bubble,
      { r: h * 0.78, hex: "#63d5ff", a: fade(pose.shield, 2.2) }, L_VOLUME + 0.4);
  }
  if (pose.jetpack > 0) {
    const a = fade(pose.jetpack, 2);
    // the pack itself, then the plume
    r.box(wx, wy + h * 0.52, wz - 0.22, 0.16, 0.2, 0.1, "#3a4152", 1.05);
    for (const s of [-1, 1]) {
      r.box(wx + s * 0.13, wy + h * 0.5, wz - 0.24, 0.06, 0.17, 0.06, "#5c6577", 1.05);
      for (let i = 0; i < 3; i += 1) {
        r.glow(wx + s * 0.13, wy + h * 0.42 - i * 0.22, wz - 0.26 - i * 0.06,
          0.3 - i * 0.05, i ? "#ffb545" : "#fff0c0", (0.75 - i * 0.18) * a);
      }
    }
  }
  if (pose.boost > 0) {
    const a = fade(pose.boost, 1.4);
    for (let i = 0; i < 5; i += 1) {
      const k = i / 5;
      r.glow(wx - pose.lean * 0.3 * k, wy + h * 0.3 + Math.sin(t * 14 + i) * 0.12, wz - 0.6 - k * 2.2,
        (0.75 - k * 0.1) * (h / 1.72), i % 2 ? "#ffcf5c" : "#ff8a3d", (0.55 - k * 0.08) * a);
    }
  }
  if (pose.magnet > 0) {
    const a = fade(pose.magnet, 2);
    for (let i = 0; i < 3; i += 1) {
      const ang = t * 2.6 + (i * Math.PI * 2) / 3;
      r.glow(wx + Math.cos(ang) * 1.05, wy + h * 0.55 + Math.sin(ang * 1.6) * 0.25,
        wz + Math.sin(ang) * 0.7, 0.34, "#9e62ff", 0.6 * a);
    }
  }
  if (pose.double > 0) {
    r.glow(wx, wy + h * 1.25 + Math.sin(t * 3) * 0.08, wz, 0.42, "#f4b965", 0.7 * fade(pose.double, 2));
  }
  if (pose.superJump > 0) {
    const a = fade(pose.superJump, 2);
    for (const s of [-1, 1]) {
      r.glow(wx + s * 0.22, wy + 0.1, wz, 0.3, "#7ee08a", 0.7 * a);
    }
  }
  void ev;
}

/* ------------------------------- factory ------------------------------- */

export function createRunner() {
  return {
    /**
     * Draws the selected character. Falls back to the jointed-box rig
     * whenever the baked mesh is unavailable, so the game is playable on
     * the very first frame and stays playable if a download fails.
     */
    draw(r, s, tint, dt, t) {
      const ch = characterById(s.character);
      const pose = readPose(s);
      pose.wx = pose.x + curveAt(pose.z);
      pose.wy = pose.y + hillAt(pose.z);
      pose.wz = pose.z;
      pose.hover = ch.ride === "hoverboard" ? 0.24 : 0;
      pose.wy += pose.hover;

      const ev = evaluate(pose, Math.min(dt, 0.05), ch.ride);
      ev.dt = dt;

      // contact shadow belongs to the ground, not the body
      const groundY = hillAt(pose.z) + 0.012;
      const lift = clamp(1 - pose.y / 2.6, 0.28, 1);
      r.shadow(pose.wx, groundY, pose.z,
        (ch.ride === "bicycle" ? 0.6 : 0.42) * lift + 0.1, 0.34 * lift + 0.08, 0.72 * lift);

      drawAura(r, pose, ev, t, ch);
      drawRideTrail(r, ch.ride, pose, tint);

      const mesh = getMesh(ch.model);
      let feet = null;
      if (mesh && mesh.pivots) {
        place(mesh, pose, ev, ch, 0);
        composeLimbs(mesh, ev);
        feet = footPoints(mesh, ch);
        const dist = pose.wz - r.cam.z;
        if (!drawSkinned(r, mesh, MATS, dist, tint, 0)) drawBoxRig(r, pose, ev, tint, ch);
      } else {
        drawBoxRig(r, pose, ev, tint, ch);
      }

      if (!feet) {
        feet = [
          [pose.wx - 0.16, pose.wy + 0.08, pose.wz, -1],
          [pose.wx + 0.16, pose.wy + 0.08, pose.wz, 1],
        ];
      }
      pose.feet = feet;
      drawRide(r, ch.ride, pose, tint, r.atmos || { night: 0 }, t);
    },

    dispose() {},
  };
}

export { STAND_H, SLIDE_H };
