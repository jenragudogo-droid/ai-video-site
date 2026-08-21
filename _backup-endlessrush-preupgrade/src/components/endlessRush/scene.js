/* ------------------------------------------------------------------ *
 * Kianimation Endless Rush — camera and world drawing.
 *
 * Everything the player sees, assembled from the flat simulation state
 * plus the two cosmetic road-shape functions in world.js. The camera is
 * the only piece with memory: it lags the runner through a pair of
 * critically-damped filters so a lane change reads as a swing rather
 * than a snap, and so nothing here can ever look shaky.
 * ------------------------------------------------------------------ */

import {
  L_TERRAIN, L_ROAD, L_MARK, L_VOLUME, L_GLOW,
  clamp, lerp, rgba,
} from "./render.js";
import {
  TRACK_HALF, KERB_HALF, LANE_W,
  atmosphereAt, bandsAt, BAND_SCRATCH,
  curveAt, hillAt, curveSlope, hillSlope, mulberry32,
} from "./world.js";
import { chunksIn } from "./engine.js";

/* ------------------------------- camera ------------------------------- */

const camState = {
  x: 0, y: 3.2, z: -8, yaw: 0, pitch: 0.13, roll: 0, back: 7.4, ready: false,
};

export function resetCamera() {
  camState.ready = false;
}

export function placeCamera(r, s, dt, aspect) {
  const step = Math.min(dt, 0.05);

  /* Framing. These three numbers put the runner's feet about three
     quarters of the way down the frame and his head just above the
     middle, which leaves the top half for the road ahead. Pulling back
     as speed rises shrinks him slightly and buys reaction time exactly
     when it is needed. */
  const tall = aspect < 0.9;
  const backBase = (tall ? 9.9 : 9.0) + clamp(s.speed * 0.075, 0, 1.6)
    + (s.powers.boost > 0 ? 1.4 : 0);
  const upBase = (tall ? 3.15 : 2.92) + clamp(s.y * 0.28, 0, 0.7)
    + (s.sliding ? -0.25 : 0);

  camState.back += (backBase - camState.back) * Math.min(1, step * 3.2);

  const camZ = s.z - camState.back;
  const lookZ = camZ + camState.back + 16;

  // follow the runner's lane part-way: full follow feels glued, none feels loose
  const wantX = curveAt(camZ) + s.x * 0.46;
  const wantY = hillAt(camZ) + upBase;
  camState.x += (wantX - camState.x) * Math.min(1, step * 9);
  camState.y += (wantY - camState.y) * Math.min(1, step * 7);
  camState.z = camZ;

  // aim down the road, plus a touch of the runner's own offset
  const wantYaw = Math.atan(curveSlope(lookZ)) * 0.82
    + Math.atan2(s.x * 0.5 - (camState.x - curveAt(camZ)), camState.back) * 0.5;
  camState.yaw += (wantYaw - camState.yaw) * Math.min(1, step * 6);

  const wantPitch = 0.105 - Math.atan(hillSlope(lookZ)) * 0.55
    + clamp((s.y - 0.2) * 0.032, -0.04, 0.09);
  camState.pitch += (wantPitch - camState.pitch) * Math.min(1, step * 6);

  const wantRoll = -s.lean * 0.045;
  camState.roll += (wantRoll - camState.roll) * Math.min(1, step * 7);

  if (!camState.ready) {
    camState.ready = true;
    camState.x = wantX; camState.y = wantY;
    camState.yaw = wantYaw; camState.pitch = wantPitch; camState.roll = wantRoll;
  }

  // impact shake: a fast decaying wobble, never enough to lose the road
  const sh = s.shake;
  const jx = sh > 0 ? Math.sin(s.t * 61) * sh * 0.16 : 0;
  const jy = sh > 0 ? Math.sin(s.t * 47 + 1.3) * sh * 0.12 : 0;

  r.cam.x = camState.x + jx;
  r.cam.y = camState.y + jy;
  r.cam.z = camState.z;
  r.cam.yaw = camState.yaw;
  r.cam.pitch = camState.pitch;
  r.cam.roll = camState.roll + (sh > 0 ? Math.sin(s.t * 53) * sh * 0.02 : 0);
}

/* -------------------------------- sky -------------------------------- */

const hash = (n) => {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
};

export function drawSky(ctx, W, H, atmos, camZ, quality, horizonY) {
  /* The sky has to meet the ground exactly where the projection puts the
     horizon, otherwise a band of fog floats above the far end of the
     road. The renderer knows; it is not a constant. */
  const horizon = clamp(horizonY ?? H * 0.42, H * 0.08, H * 0.92);

  const g = ctx.createLinearGradient(0, 0, 0, horizon + H * 0.2);
  g.addColorStop(0, atmos.skyTop);
  g.addColorStop(0.72, atmos.skyLow);
  g.addColorStop(1, atmos.fog);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  /* stars, only once the night biome is actually dominant */
  if (atmos.night > 0.25) {
    ctx.globalAlpha = (atmos.night - 0.25) * 1.2;
    ctx.fillStyle = "#e9f0ff";
    const drift = (camZ * 0.06) % 400;
    for (let i = 0; i < 46; i += 1) {
      const x = ((hash(i * 3.1) * 520 - drift) % 520 + 520) % 520;
      const y = hash(i * 7.7) * horizon * 0.8;
      const sz = hash(i * 11.3) < 0.85 ? 1 : 1.8;
      ctx.fillRect((x / 520) * W, y, sz, sz);
    }
    ctx.globalAlpha = 1;
  } else {
    /* a soft sun, low and to the left, matching the key light */
    const sx = W * 0.26, sy = horizon - H * 0.3;
    const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, H * 0.34);
    sg.addColorStop(0, rgba("#fff6dd", 0.6 * (1 - atmos.night)));
    sg.addColorStop(0.35, rgba("#ffe6b0", 0.18 * (1 - atmos.night)));
    sg.addColorStop(1, rgba("#ffe6b0", 0));
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, W, horizon + 4);
  }

  if (quality < 0.75) return;

  /* Parallax horizon silhouette. Cheap, and it stops the far distance
     reading as an empty wall of fog. */
  const layers = atmos.night > 0.4 ? 2 : 1;
  for (let L = 0; L < layers; L += 1) {
    const depth = 0.012 + L * 0.008;
    const amp = H * (0.055 - L * 0.018);
    ctx.fillStyle = rgba(atmos.night > 0.4 ? "#0d1224" : atmos.fog, L === 0 ? 0.55 : 0.4);
    ctx.beginPath();
    ctx.moveTo(0, horizon + 2);
    const seg = Math.max(14, W / 26);
    for (let x = 0; x <= W + seg; x += seg) {
      const n = (x / seg) + Math.floor(camZ * depth);
      const h = (hash(n * 1.7 + L * 40) * 0.7 + hash(n * 0.31 + L * 40) * 0.3) * amp;
      ctx.lineTo(x - ((camZ * depth * seg) % seg), horizon + 2 - h);
    }
    ctx.lineTo(W + seg, horizon + 3);
    ctx.closePath();
    ctx.fill();
  }
}

/* ------------------------------- ground ------------------------------- */

/* Segment lengths grow with distance: close ground follows the hill
   faithfully, far ground is a handful of long quads nobody can tell
   apart from the real thing. */
function segLength(d) {
  if (d < 26) return 2.4;
  if (d < 60) return 4.5;
  if (d < 120) return 8;
  return 14;
}

/* Where the road is missing. Collected once per frame so the ground loop
   can cut its segments at the lip of a hole instead of paving over it. */
const holes = [];

function collectHoles(s, from, to) {
  holes.length = 0;
  for (const c of chunksIn(s, from, to)) {
    for (const o of c.obstacles) {
      if (o.art !== "gap" || o.knock) continue;
      if (o.z + o.d < from || o.z - o.d > to) continue;
      holes.push([o.z - o.d * 0.5, o.z + o.d * 0.5, o.x - o.w * 0.5, o.x + o.w * 0.5]);
    }
  }
  holes.sort((a, b) => a[0] - b[0]);
  return holes;
}

/* Every hole crossing this depth, merged into lateral spans. A row of
   three lane-wide holes is one broken road section, not three, so spans
   within a hand's width of each other are joined — otherwise a ten
   centimetre ridge of tarmac is left standing between them. */
const spans = [];

function holesAt(z) {
  spans.length = 0;
  for (const h of holes) {
    if (z < h[0] || z > h[1]) continue;
    spans.push([h[2], h[3]]);
  }
  if (spans.length < 2) return spans;
  spans.sort((a, b) => a[0] - b[0]);
  let w = 0;
  for (let i = 1; i < spans.length; i += 1) {
    if (spans[i][0] <= spans[w][1] + 0.25) {
      if (spans[i][1] > spans[w][1]) spans[w][1] = spans[i][1];
    } else {
      w += 1;
      spans[w] = spans[i];
    }
  }
  spans.length = w + 1;
  return spans;
}

function anyHoleAt(z) {
  for (const h of holes) {
    if (z >= h[0] && z <= h[1]) return true;
  }
  return false;
}

function nextCut(z, limit) {
  let cut = limit;
  for (const h of holes) {
    if (h[0] > z && h[0] < cut) cut = h[0];
    if (h[1] > z && h[1] < cut) cut = h[1];
  }
  return cut;
}

/* Quads share their far edge with the next segment's near edge. Painting
   two anti-aliased polygons against a shared edge leaves a hairline of
   background showing through, so every segment is stretched a few
   centimetres past its neighbour and the nearer one paints over the
   overlap. */
const SEAM = 0.05;

export function drawGround(r, s, atmos, tint) {
  const camZ = r.cam.z;
  const far = camZ + r.drawDist;
  collectHoles(s, camZ - 6, far);

  let z = Math.floor((camZ - 14) / 2) * 2;

  while (z < far) {
    const len = segLength(z - camZ);
    const z2 = Math.min(z + len, nextCut(z, far), far);
    if (z2 <= z + 0.01) { z += 0.05; continue; }
    const zm = (z + z2) * 0.5;
    const zEdge = z2 + SEAM;

    const c1 = curveAt(z), c2 = curveAt(zEdge);
    const y1 = hillAt(z), y2 = hillAt(zEdge);

    /* side terrain bands, far edge first */
    /* The outer band only has to reach the edge of the frustum at its own
       depth. Painting it 400 m wide right under the camera is hundreds of
       thousands of pixels of pure overdraw every frame. */
    const reach = Math.min(400, 24 + Math.max(0, zm - camZ) * 1.25);
    const n = bandsAt(zm);
    for (let i = n - 1; i >= 0; i -= 1) {
      const b = BAND_SCRATCH[i];
      const to = Math.min(b.to, reach);
      if (to <= b.from) continue;
      for (let side = -1; side <= 1; side += 2) {
        const a0 = side * b.from, a1 = side * to;
        r.quad(
          c1 + a0, y1 - 0.02, z, c1 + a1, y1 - 0.02, z,
          c2 + a1, y2 - 0.02, zEdge, c2 + a0, y2 - 0.02, zEdge,
          b.hex, 0.95 * tint, L_TERRAIN,
        );
      }
    }

    /* the running surface, cut around whatever is missing from it */
    const pave = (x0, x1) => {
      if (x1 - x0 < 0.02) return;
      r.quad(
        c1 + x0, y1, z, c1 + x1, y1, z,
        c2 + x1, y2, zEdge, c2 + x0, y2, zEdge,
        atmos.road, 1 * tint, L_ROAD,
      );
    };

    const cut = holesAt(zm);
    if (!cut.length) {
      pave(-TRACK_HALF, TRACK_HALF);
    } else {
      let cursor = -TRACK_HALF;
      for (const span of cut) {
        pave(cursor, Math.min(span[0], TRACK_HALF));
        if (span[1] > cursor) cursor = span[1];
        drawShaft(r, span, z, zEdge, c1, c2, y1, y2, tint, zm);
      }
      pave(Math.max(cursor, -TRACK_HALF), TRACK_HALF);
    }

    /* kerbs, raised just enough to catch the light */
    for (let side = -1; side <= 1; side += 2) {
      const i0 = side * TRACK_HALF, i1 = side * KERB_HALF;
      r.quad(
        c1 + i0, y1 + 0.14, z, c1 + i1, y1 + 0.14, z,
        c2 + i1, y2 + 0.14, zEdge, c2 + i0, y2 + 0.14, zEdge,
        atmos.kerb, 1.02 * tint, L_ROAD,
      );
      if (z - camZ < 70) {
        r.quad(
          c1 + i0, y1, z, c2 + i0, y2, zEdge,
          c2 + i0, y2 + 0.14, zEdge, c1 + i0, y1 + 0.14, z,
          atmos.kerb, 0.68 * tint, L_MARK,
        );
      }
    }

    z = z2;
  }

  /* dashed lane lines, spaced so they scroll cleanly */
  const DASH = 2.4, GAP = 3.6;
  const period = DASH + GAP;
  const startD = Math.floor((camZ - 6) / period) * period;
  const lineFar = camZ + Math.min(r.drawDist, 150);
  for (let d = startD; d < lineFar; d += period) {
    const za = d, zb = d + DASH;
    if (anyHoleAt(za) || anyHoleAt(zb)) continue;
    const ca = curveAt(za), cb = curveAt(zb);
    const ya = hillAt(za) + 0.008, yb = hillAt(zb) + 0.008;
    for (const lx of [-LANE_W * 0.5, LANE_W * 0.5]) {
      r.quad(
        ca + lx - 0.075, ya, za, ca + lx + 0.075, ya, za,
        cb + lx + 0.075, yb, zb, cb + lx - 0.075, yb, zb,
        atmos.lane, 1.05 * tint, L_MARK,
      );
    }
  }
}

/* The inside of a broken section: floor, the far wall you actually see
   into, and the two cut edges. The near wall faces away from the camera
   and is never drawn. */
const HOLE_DEPTH = 1.7;

function drawShaft(r, span, z, z2, c1, c2, y1, y2, tint, zm) {
  const L = span[0], R = span[1];
  const fy1 = y1 - HOLE_DEPTH, fy2 = y2 - HOLE_DEPTH;
  r.quad(
    c1 + L, fy1, z, c1 + R, fy1, z,
    c2 + R, fy2, z2, c2 + L, fy2, z2,
    "#15181f", 0.7 * tint, L_ROAD,
  );
  // the wall the runner is looking into; the near one faces away
  let backZ = -Infinity;
  for (const h of holes) {
    if (zm < h[0] || zm > h[1]) continue;
    if (h[1] > backZ) backZ = h[1];
  }
  if (backZ > -Infinity && z2 >= backZ - 0.08) {
    r.quad(
      c2 + L, fy2, backZ, c2 + R, fy2, backZ,
      c2 + R, y2, backZ, c2 + L, y2, backZ,
      "#232833", 0.85 * tint, L_ROAD,
    );
  }
  for (const x of [L, R]) {
    r.quad(
      c1 + x, y1, z, c2 + x, y2, z2,
      c2 + x, fy2, z2, c1 + x, fy1, z,
      "#1b1f27", 0.6 * tint, L_ROAD,
    );
  }
}

/* ------------------------------- scenery ------------------------------- */

/* Windows are by far the most expensive thing on screen — a tall block
   can want sixty little quads on its own. They are capped, held to the
   near half of the view, and dropped entirely once the frame budget is
   under pressure. Nothing else in the scene repays that many fills. */
const WINDOW_BUDGET = 12;

function windowGrid(r, d, wx, wy, wz, tint) {
  const cols = Math.min(4, Math.max(1, Math.round(d.w / 1.6)));
  const rows = Math.min(6, Math.max(1, Math.round(d.h / 3.2)));
  if (cols * rows > WINDOW_BUDGET) return;
  const rng = mulberry32(d.s * 2654435761);
  const faceX = wx - Math.sign(d.side) * (d.w * 0.5 + 0.02);
  const lit = d.lit ? 1 : 0;
  for (let c = 0; c < cols; c += 1) {
    for (let rw = 0; rw < rows; rw += 1) {
      const on = rng();
      const y = wy + 1.3 + rw * (d.h / rows);
      const z = wz - d.d * 0.5 + 0.6 + c * ((d.d - 1.2) / Math.max(1, cols - 1 || 1));
      if (y > wy + d.h - 0.6) continue;
      const bright = lit ? (on < 0.55 ? "#ffd88a" : "#2a2f3c") : "#22303f";
      r.quad(
        faceX, y, z - 0.34, faceX, y, z + 0.34,
        faceX, y + 0.8, z + 0.34, faceX, y + 0.8, z - 0.34,
        bright, lit && on < 0.55 ? 1.35 : 0.8 * tint, L_VOLUME,
      );
    }
  }
}

let windowsOn = true;

/* Level of detail.
   0 — close enough to see the joinery
   1 — the silhouette is all that survives, so build it from fewer boxes
   2 — a few pixels wide and half-eaten by fog; one box is plenty

   This is the single biggest lever on frame cost. A forest chunk holds
   half a dozen trees, twelve chunks are on screen at once, and a full
   tree is a dozen filled polygons — which is nine hundred fills for
   scenery nobody is looking at. */
function lodAt(r, z) {
  const d = z - r.cam.z;
  return d < 46 ? 0 : d < 104 ? 1 : 2;
}

function drawDecorItem(r, d, tint, atmos, t, lod) {
  const z = d.z;
  const cx = curveAt(z);
  const gy = hillAt(z);
  const x = d.x + cx;

  switch (d.k) {
    case "building": {
      r.box(x, gy, z, d.w * 0.5, d.h * 0.5, d.d * 0.5, d.c, tint, L_VOLUME);
      if (z - r.cam.z < 52 && z > r.cam.z && windowsOn) windowGrid(r, d, x, gy, z, tint);
      break;
    }
    case "lamp": {
      const armDir = -Math.sign(d.x);
      const hx = x + armDir * 1.0;
      if (lod < 2) {
        r.box(x, gy, z, 0.075, d.h * 0.5, 0.075, d.c, tint);
        r.box(x + armDir * 0.5, gy + d.h - 0.12, z, 0.55, 0.055, 0.07, d.c, tint);
        r.box(hx, gy + d.h - 0.3, z, 0.19, 0.09, 0.16, d.glow ? "#ffe6a8" : "#c9cdd4", 1.2 * tint);
      }
      if (atmos.night > 0.22) {
        r.glow(hx, gy + d.h - 0.32, z, 2.6, d.c2 || "#ffcf80", 0.5 * atmos.night);
        r.glow(hx, gy + 0.05, z, 2.2, d.c2 || "#ffcf80", 0.18 * atmos.night);
      }
      break;
    }
    case "sign": {
      r.box(x, gy, z, 0.055, d.h * 0.5, 0.055, d.c, tint);
      r.box(x, gy + d.h - 0.05, z, 0.4, 0.3, 0.05, d.c2, 1.1 * tint);
      break;
    }
    case "box":
      r.box(x, gy + (d.y || 0), z, d.w * 0.5, d.h * 0.5, d.d * 0.5, d.c, tint);
      break;
    case "stall": {
      const side = Math.sign(d.x);
      r.box(x, gy, z, d.w * 0.5, 0.42, 0.62, d.c, tint);                  // table
      if (lod === 0) {
        for (const px of [-1, 1]) {
          for (const pz of [-0.55, 0.55]) {
            r.box(x + side * px * (d.w * 0.5 - 0.08), gy, z + pz, 0.055, 1.1, 0.055, d.c, tint);
          }
        }
      } else {
        r.box(x, gy, z - 0.55, d.w * 0.5, 1.05, 0.05, d.c, 0.9 * tint);
      }
      // canopy, tilted toward the street
      r.quad(
        x - d.w * 0.62, gy + 2.2, z - 0.75, x + d.w * 0.62, gy + 2.2, z - 0.75,
        x + d.w * 0.62, gy + 2.05, z + 0.85, x - d.w * 0.62, gy + 2.05, z + 0.85,
        d.c2, 1.1 * tint, L_VOLUME,
      );
      r.box(x, gy + 0.86, z, d.w * 0.34, 0.16, 0.34, d.c2, 1.05 * tint);  // goods
      break;
    }
    case "umbrella": {
      r.box(x, gy, z, 0.05, d.h * 0.5, 0.05, "#6b4a29", tint);
      const rr = d.r;
      for (let i = 0; i < (lod === 0 ? 4 : 2); i += 1) {
        const a0 = (i / 4) * Math.PI * 2;
        const a1 = ((i + 1) / 4) * Math.PI * 2;
        r.poly([
          x, gy + d.h + 0.34, z,
          x + Math.cos(a0) * rr, gy + d.h - 0.1, z + Math.sin(a0) * rr,
          x + Math.cos(a1) * rr, gy + d.h - 0.1, z + Math.sin(a1) * rr,
        ], d.c, (i % 2 ? 0.86 : 1.06) * tint, L_VOLUME);
      }
      break;
    }
    case "banner": {
      const side = Math.sign(d.x);
      r.box(x, gy, z, 0.05, d.h * 0.5, 0.05, "#6b4a29", tint);
      r.quad(
        x, gy + d.h - 0.1, z - 0.05, x - side * 0.9, gy + d.h - 0.1, z - 0.05,
        x - side * 0.9, gy + d.h - 1.1, z - 0.05, x, gy + d.h - 1.1, z - 0.05,
        d.c, 1.05 * tint, L_VOLUME,
      );
      break;
    }
    case "tree": {
      const rr = d.r;
      if (lod === 2) {
        r.box(x, gy + d.h * 0.3, z, rr * 0.85, d.h * 0.36, rr * 0.85, d.c2, tint);
        break;
      }
      r.box(x, gy, z, 0.16, d.h * 0.28, 0.16, d.c, tint);
      const layers = lod === 0 ? 3 : 1;
      for (let i = 0; i < layers; i += 1) {
        const k = layers === 1 ? 0.5 : i / 2;
        r.box(x + (d.s % 5 - 2) * 0.04, gy + d.h * 0.45 + k * rr * 0.9,
          z, rr * (1 - k * 0.32), rr * (layers === 1 ? 0.8 : 0.46), rr * (1 - k * 0.32),
          d.c2, (0.9 + k * 0.22) * tint);
      }
      break;
    }
    case "pine": {
      if (lod === 2) {
        r.box(x, gy + d.h * 0.24, z, d.r * 0.62, d.h * 0.36, d.r * 0.62, d.c2, tint);
        break;
      }
      r.box(x, gy, z, 0.13, d.h * 0.2, 0.13, d.c, tint);
      for (let i = 0; i < (lod === 0 ? 3 : 2); i += 1) {
        const k = i / 3;
        const rr = d.r * (1 - k * 0.42);
        const y = gy + d.h * (0.28 + k * 0.26);
        r.poly([x, y + d.h * 0.34, z, x - rr, y, z - rr, x + rr, y, z - rr],
          d.c2, (1 + k * 0.16) * tint, L_VOLUME);
        r.poly([x, y + d.h * 0.34, z, x + rr, y, z - rr, x + rr, y, z + rr],
          d.c2, (0.82 + k * 0.16) * tint, L_VOLUME);
        r.poly([x, y + d.h * 0.34, z, x + rr, y, z + rr, x - rr, y, z + rr],
          d.c2, (0.7 + k * 0.16) * tint, L_VOLUME);
        r.poly([x, y + d.h * 0.34, z, x - rr, y, z + rr, x - rr, y, z - rr],
          d.c2, (0.88 + k * 0.16) * tint, L_VOLUME);
      }
      break;
    }
    case "bush":
      r.box(x, gy, z, d.r, d.r * 0.7, d.r, d.c, tint);
      break;
    case "rock":
      r.boxRot(x, gy - d.r * 0.2, z, d.r, d.r * 0.55, d.r * 0.82,
        (d.r * 7) % 1.6, d.c, tint);
      break;
    case "fence": {
      r.box(x, gy, z, 0.06, 0.5, 0.06, d.c, tint);
      r.box(x, gy + 0.62, z, 0.05, 0.045, 1.6, d.c, 1.05 * tint);
      break;
    }
    case "cliff": {
      r.boxRot(x, gy - 1.4, z, d.w * 0.5, d.h * 0.5, d.d * 0.5, d.rot || 0, d.c, tint);
      // a second, smaller mass offset from the first breaks the silhouette
      // so a pass never looks like a row of office blocks
      if (lod === 2) break;
      r.boxRot(
        x + (d.s % 5 - 2) * 0.5, gy - 1 + d.h * 0.42, z + (d.s % 3 - 1) * 0.8,
        d.w * 0.31, d.h * 0.3, d.d * 0.33, (d.rot || 0) + 0.7, d.c, 0.92 * tint,
      );
      break;
    }

    /* -------- structures spanning the track, all well overhead -------- */
    case "gantry": {
      r.box(cx - 4.6, gy, z, 0.14, 2.9, 0.14, d.c, tint);
      r.box(cx + 4.6, gy, z, 0.14, 2.9, 0.14, d.c, tint);
      r.box(cx, gy + d.h, z, 5, 0.16, 0.16, d.c, 1.06 * tint);
      r.box(cx - 1.4, gy + d.h - 0.75, z, 1.5, 0.36, 0.1, d.c2, 1.1 * tint);
      if (d.glow && atmos.night > 0.3) {
        r.glow(cx - 1.4, gy + d.h - 0.5, z, 2.4, "#9e62ff", 0.45 * atmos.night);
      }
      break;
    }
    case "tunnel": {
      for (let i = -1; i <= 1; i += 2) {
        r.box(cx + i * 4.5, gy, z, 0.5, 3.1, 1.1, d.c, tint);
      }
      r.box(cx, gy + d.h, z, 5, 0.6, 1.1, d.c, 0.9 * tint);
      r.box(cx, gy + d.h - 0.3, z + 1.1, 4.4, 0.24, 0.12, d.c2, 0.7 * tint);
      break;
    }
    case "bridge": {
      for (let i = -1; i <= 1; i += 2) {
        r.box(cx + i * 4.2, gy, z - 1, 0.1, 1.1, 0.1, d.c, tint);
        r.box(cx + i * 4.2, gy, z + 1, 0.1, 1.1, 0.1, d.c, tint);
        r.box(cx + i * 4.2, gy + 1.9, z, 0.09, 0.06, 1.4, d.c2, 1.1 * tint);
        r.poly([
          cx + i * 4.2, gy + d.h, z,
          cx + i * 4.2, gy + 1.1, z - 2.4,
          cx + i * 4.2, gy + 1.1, z + 2.4,
        ], d.c2, 0.8 * tint, L_VOLUME);
      }
      break;
    }
    case "canopy": {
      for (let i = -1; i <= 1; i += 2) {
        r.box(cx + i * 5, gy, z, 0.24, 3.2, 0.24, d.c, tint);
        r.box(cx + i * 2.6, gy + d.h - 0.4, z, 2.6, 0.14, 0.2, d.c, 0.9 * tint);
      }
      r.box(cx, gy + d.h, z, 5.4, 0.5, 0.9, d.c2, 0.92 * tint);
      break;
    }
    case "bunting": {
      const n = 7;
      for (let i = 0; i <= n; i += 1) {
        const u = i / n;
        const bx = cx - 4.6 + u * 9.2;
        const sag = Math.sin(u * Math.PI) * 0.6;
        const by = gy + d.h - sag + Math.sin(t * 2 + i) * 0.04;
        r.quad(
          bx - 0.16, by, z, bx + 0.16, by, z,
          bx + 0.16, by - 0.42, z, bx - 0.16, by - 0.42, z,
          i % 2 ? d.c : d.c2, 1.1 * tint, L_VOLUME,
        );
      }
      r.box(cx - 5, gy, z, 0.09, 2.7, 0.09, "#6b4a29", tint);
      r.box(cx + 5, gy, z, 0.09, 2.7, 0.09, "#6b4a29", tint);
      break;
    }
    default:
      break;
  }
}

/* ------------------------------ obstacles ------------------------------ */

const STRIPE_A = "#e8552f";
const STRIPE_B = "#f2ede2";

function drawObstacle(r, o, tint, atmos) {
  const k = o.knock;
  const cx = curveAt(o.z);
  const gy = hillAt(o.z);
  const x = o.x + cx + (k ? k.ox : 0);
  const y = gy + o.y + (k ? k.oy : 0);
  const z = o.z + (k ? k.oz : 0);
  const rot = k ? k.rot : 0;

  if (!k && o.art !== "gap") {
    r.shadow(o.x + cx, gy + 0.014, o.z, o.w * 0.55, o.d * 0.5, 0.6);
  }

  switch (o.art) {
    case "cone":
      r.boxRot(x, y, z, 0.26, 0.09, 0.26, rot, "#3b3b40", tint);
      r.boxRot(x, y + 0.16, z, 0.16, 0.2, 0.16, rot, STRIPE_A, 1.08 * tint);
      r.boxRot(x, y + 0.42, z, 0.11, 0.09, 0.11, rot, STRIPE_B, 1.15 * tint);
      r.boxRot(x, y + 0.56, z, 0.07, 0.1, 0.07, rot, STRIPE_A, 1.08 * tint);
      break;

    case "debris":
      for (let i = 0; i < 3; i += 1) {
        r.boxRot(x + (i - 1) * 0.22, y + i * 0.02, z + (i % 2 ? 0.16 : -0.14),
          0.34, 0.07, 0.11, rot + i * 0.7 + (o.seed % 7) * 0.2, "#7d6242", tint);
      }
      break;

    case "barrier": {
      // two feet, a striped board and a reflective top rail
      r.boxRot(x - 0.7, y, z, 0.11, 0.16, 0.3, rot, "#4a4f57", tint);
      r.boxRot(x + 0.7, y, z, 0.11, 0.16, 0.3, rot, "#4a4f57", tint);
      r.boxRot(x, y + 0.3, z, o.w * 0.5, 0.3, 0.07, rot, STRIPE_B, 1.05 * tint);
      for (let i = 0; i < 4; i += 1) {
        r.boxRot(x - o.w * 0.5 + 0.24 + i * 0.44, y + 0.31, z - 0.045,
          0.13, 0.28, 0.02, rot, STRIPE_A, 1.12 * tint);
      }
      r.boxRot(x, y + 0.9, z, o.w * 0.5 + 0.03, 0.07, 0.09, rot, "#e8b24a", 1.2 * tint);
      break;
    }

    case "crate": {
      r.boxRot(x, y, z, 0.62, 0.62, 0.62, rot, "#8a6136", tint);
      r.boxRot(x, y + 0.55, z, 0.65, 0.06, 0.65, rot, "#6b4a29", 1.1 * tint);
      r.boxRot(x, y + 0.02, z, 0.65, 0.06, 0.65, rot, "#6b4a29", 1.1 * tint);
      break;
    }

    case "sign": {
      // hangs from a gantry: the runner slides under the panel
      r.box(o.x + cx - 1.15, gy, o.z, 0.075, 1.2, 0.075, "#5a616b", tint);
      r.box(o.x + cx + 1.15, gy, o.z, 0.075, 1.2, 0.075, "#5a616b", tint);
      r.boxRot(x, y, z, o.w * 0.5, o.h * 0.5, 0.09, rot, "#e8b24a", 1.08 * tint);
      r.boxRot(x, y + 0.18, z - 0.1, o.w * 0.5 - 0.16, 0.28, 0.02, rot, "#22262e", 1.15 * tint);
      break;
    }

    case "gap": {
      /* The shaft is cut into the road surface itself (see drawShaft) so
         it sorts correctly against the tarmac. All that is left here is
         the dressing: torn lips and a few bars of exposed reinforcement. */
      const half = o.d * 0.5;
      const zf = o.z - half, zb = o.z + half;
      const cf = curveAt(zf), cb = curveAt(zb);
      const yf = hillAt(zf), yb = hillAt(zb);
      r.box(cf + o.x, yf + 0.01, zf - 0.1, o.w * 0.5, 0.035, 0.12, "#c9542f", 1.15 * tint);
      r.box(cb + o.x, yb + 0.01, zb + 0.1, o.w * 0.5, 0.035, 0.12, "#c9542f", 1.15 * tint);
      for (let i = 0; i < 4; i += 1) {
        const bx = cf + o.x - 0.6 + i * 0.4;
        r.box(bx, yf - 0.22, zf + 0.06 + (i % 2) * 0.05, 0.022, 0.13, 0.022, "#8a5b32", 1.2 * tint);
      }
      break;
    }

    case "vehicle": {
      const body = o.seed % 4;
      const paint = ["#3f6ea8", "#a8452f", "#4a8a5e", "#6d6a76"][body];
      r.boxRot(x, y + 0.34, z, 0.9, 0.5, o.d * 0.5, rot, paint, tint);
      r.boxRot(x, y + 1.22, z + 0.35, 0.82, 0.28, o.d * 0.28, rot, paint, 1.06 * tint);
      r.boxRot(x, y + 1.3, z + 0.34, 0.7, 0.2, o.d * 0.24, rot, "#26303c", 1.1 * tint);
      for (const wz of [-o.d * 0.32, o.d * 0.3]) {
        for (const wx of [-0.88, 0.88]) {
          r.boxRot(x + wx, y, z + wz, 0.12, 0.17, 0.32, rot, "#1c1f25", tint);
        }
      }
      r.box(x, y + 0.5, z - o.d * 0.5 - 0.02, 0.72, 0.1, 0.03, "#e8543a", 1.2 * tint);
      if (atmos.night > 0.35) {
        r.glow(x - 0.55, y + 0.55, z - o.d * 0.5, 1.1, "#ff5a3c", 0.35 * atmos.night);
        r.glow(x + 0.55, y + 0.55, z - o.d * 0.5, 1.1, "#ff5a3c", 0.35 * atmos.night);
      }
      break;
    }

    case "zone": {
      r.boxRot(x, y, z, o.w * 0.5, 0.1, o.d * 0.42, rot, "#4d5259", tint);
      r.boxRot(x - 0.6, y + 0.18, z, 0.14, 0.5, 0.14, rot, "#e8b24a", 1.1 * tint);
      r.boxRot(x + 0.6, y + 0.18, z, 0.14, 0.5, 0.14, rot, "#e8b24a", 1.1 * tint);
      r.boxRot(x, y + 0.86, z, o.w * 0.5, 0.22, 0.07, rot, "#f2b13c", 1.14 * tint);
      for (let i = 0; i < 4; i += 1) {
        r.boxRot(x - o.w * 0.5 + 0.28 + i * 0.44, y + 0.87, z - 0.045,
          0.11, 0.2, 0.02, rot, "#2b2f36", 1.16 * tint);
      }
      r.boxRot(x - 0.5, y + 1.3, z, 0.1, 0.14, 0.1, rot, STRIPE_A, 1.1 * tint);
      if (atmos.night > 0.3) r.glow(x, y + 1.35, z, 1.4, "#ffb545", 0.4 * atmos.night);
      break;
    }
    default:
      break;
  }
}

/* -------------------------- coins and power-ups -------------------------- */

const POWER_COLOUR = {
  magnet: "#9e62ff",
  shield: "#5ad1ff",
  double: "#f4b965",
  boost: "#ff8a3d",
};

const POWER_GLYPH = { magnet: "U", shield: "◆", double: "×2", boost: "≫" };

function glyph(ctx, sx, sy, scale, arg, alpha) {
  const size = Math.max(7, scale * 0.42);
  if (size < 7) return;
  ctx.save();
  ctx.globalAlpha = clamp(alpha, 0, 1);
  ctx.font = `700 ${size}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#0b0d12";
  ctx.fillText(arg, sx, sy + size * 0.04);
  ctx.restore();
}

export function drawPickups(r, s, tint, t) {
  const cs = chunksIn(s, s.z - 2, r.cam.z + r.drawDist);
  const behind = s.z - 0.8;
  for (const c of cs) {
    for (const coin of c.coins) {
      if (coin.taken || coin.z < behind) continue;
      const cx = curveAt(coin.z);
      const gy = hillAt(coin.z);
      r.coin(coin.x + cx, gy + coin.y, coin.z, 0.27, coin.ph, "#f7c948", "#b8862a");
    }
    for (const p of c.powerups) {
      if (p.taken || p.z < behind) continue;
      const cx = curveAt(p.z);
      const gy = hillAt(p.z);
      const bob = Math.sin(t * 2.4 + p.ph) * 0.16;
      const px = p.x + cx;
      const py = gy + p.y + bob;
      const col = POWER_COLOUR[p.type] || "#f4b965";
      r.boxRot(px, py - 0.28, p.z, 0.3, 0.3, 0.3, t * 1.7 + p.ph, col, 1.15 * tint);
      r.glow(px, py, p.z, 1.5, col, 0.6);
      r.custom(px, py, p.z, glyph, POWER_GLYPH[p.type] || "?", L_GLOW);
    }
  }
  void tint;
}

/* ------------------------------- effects ------------------------------- */

export function drawFx(r, s) {
  for (const f of s.fx) {
    const k = f.t / f.life;
    const cx = curveAt(f.z);
    const gy = hillAt(f.z);
    for (let i = 0; i < f.n; i += 1) {
      const a = (i / f.n) * Math.PI * 2 + f.t * 3;
      const spread = k * 2.1;
      r.glow(
        f.x + cx + Math.cos(a) * spread,
        gy + f.y + Math.sin(a * 1.7) * spread * 0.7 + k * 0.5,
        f.z + Math.sin(a) * spread * 0.6,
        0.42 * (1 - k * 0.5), f.hue, (1 - k) * 0.75,
      );
    }
  }
}

/* ------------------------------ whole world ------------------------------ */

const atmos = {};

export function currentAtmosphere(z) {
  return atmosphereAt(z, atmos);
}

export function drawWorld(r, s, quality, dt, t) {
  const a = atmosphereAt(s.z + 30, atmos);
  const tint = a.light;
  const dist = lerp(150, r.drawDist, 1);
  void dist;

  windowsOn = quality > 0.82;

  r.setAtmosphere(a.fog, a.fogStart * quality, a.fogEnd * quality, a.fogEnd * quality + 12);
  r.begin();

  drawGround(r, s, a, tint);

  /* Fog closes in somewhere between 150 m and 235 m depending on the
     biome, so drawing scenery past that is paying for pixels nobody can
     tell from the fog colour. */
  const far = r.cam.z + Math.min(r.drawDist, (a.fogEnd * 0.86) * quality);
  const cs = chunksIn(s, r.cam.z - 20, far);
  for (const c of cs) {
    for (const d of c.decor) {
      if (d.z > far || d.z < r.cam.z - 20) continue;
      drawDecorItem(r, d, tint, a, t, lodAt(r, d.z));
    }
    for (const o of c.obstacles) {
      if (o.z > r.cam.z + Math.min(r.drawDist, 165) || o.z < r.cam.z - 22) continue;
      drawObstacle(r, o, tint, a);
    }
  }

  drawPickups(r, s, tint, t);
  drawFx(r, s);
  void dt;
  return a;
}
