/* ------------------------------------------------------------------ *
 * Kianimation Endless Rush — software 3D renderer on a 2D canvas.
 *
 * Same family as the Bus Simulator's renderer, but specialised for a
 * corridor: the camera always trails the runner down +Z, so the whole
 * scene is naturally depth-sortable and the painter's algorithm is
 * exact rather than approximate.
 *
 * The pipeline per frame is:
 *   1. begin()      — reset the draw list, recompute the camera basis
 *   2. quad/box/... — world-space geometry is transformed into camera
 *                     space, clipped against the near plane and pushed
 *                     onto a flat list with a (layer, depth) sort key
 *   3. flush(ctx)   — one sort, then one pass of fills
 *
 * Three things keep it cheap enough for a mid-range phone:
 *   - Every colour string is built once and cached by
 *     (base, light bucket, fog bucket). String building, not maths, is
 *     what usually costs a canvas renderer its frame budget.
 *   - Boxes emit only the two or three faces that actually face the
 *     camera, so a crate is 3 fills rather than 6.
 *   - Draw-list entries are recycled in place, so a steady-state frame
 *     allocates essentially nothing and the collector stays quiet.
 * ------------------------------------------------------------------ */

const NEAR = 0.3;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/* Painting order for things that lie flat on the ground, then volumes.
   Ground decals never enter the depth sort against each other in a way
   that matters — they are coplanar — so giving them their own layers
   avoids z-fighting flicker as the camera moves. */
export const L_SKY = 0;
export const L_TERRAIN = 1;   // open ground either side of the track
export const L_ROAD = 2;      // the running surface
export const L_MARK = 3;      // lane lines, kerbs, decals
export const L_SHADOW = 4;    // contact shadows
export const L_VOLUME = 5;    // everything that stands up
export const L_GLOW = 6;      // emissive halos, painted over volumes

/* ------------------------------- colour ------------------------------- */

export function hexToRgb(hex) {
  const h = hex.charCodeAt(0) === 35 ? hex.slice(1) : hex;
  const n = parseInt(
    h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h,
    16,
  );
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r, g, b) {
  const c = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Blend two hex colours. Used for biome cross-fades. */
export function mixHex(a, b, t) {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return rgbToHex(lerp(r1, r2, t), lerp(g1, g2, t), lerp(b1, b2, t));
}

export function rgba(hex, alpha) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/* Light is bucketed to 24 steps and fog to 34. A face lit at 0.7412 and
   one lit at 0.7439 are indistinguishable on screen but would otherwise
   be two different cache entries and two string builds every frame. */
const LIGHT_STEPS = 24;
const FOG_STEPS = 34;

function makePalette() {
  let cache = new Map();
  let fogR = 0, fogG = 0, fogB = 0;
  let fogKey = "";

  return {
    setFog(hex) {
      // quantised so a slow biome cross-fade only rebuilds the cache a
      // couple of dozen times instead of on every single frame
      const [r, g, b] = hexToRgb(hex);
      const key = `${r >> 3}_${g >> 3}_${b >> 3}`;
      if (key === fogKey) return;
      fogKey = key;
      fogR = r; fogG = g; fogB = b;
      cache = new Map();
    },
    /** base hex, light multiplier (0..1.4), fog amount (0..1) → css */
    get(hex, light, fog) {
      const li = clamp(Math.round(light * LIGHT_STEPS), 0, LIGHT_STEPS + 8);
      const fi = clamp(Math.round(fog * FOG_STEPS), 0, FOG_STEPS);
      const key = `${hex}|${li}|${fi}`;
      let css = cache.get(key);
      if (css !== undefined) return css;
      const [r0, g0, b0] = hexToRgb(hex);
      const l = li / LIGHT_STEPS;
      const f = fi / FOG_STEPS;
      const r = lerp(Math.min(255, r0 * l), fogR, f);
      const g = lerp(Math.min(255, g0 * l), fogG, f);
      const b = lerp(Math.min(255, b0 * l), fogB, f);
      css = `rgb(${r | 0},${g | 0},${b | 0})`;
      /* Biome cross-fades feed in slightly different base colours every
         frame. Callers quantise those, but a hard cap here means a long
         session can never grow this map without bound. */
      if (cache.size > 1400) cache.clear();
      cache.set(key, css);
      return css;
    },
    clear() { cache = new Map(); fogKey = ""; },
  };
}

/* ------------------------------- glows ------------------------------- */

/* Every street lamp and lit window wants a soft halo. Building a fresh
   radial gradient for each one, every frame, is one of the few things
   that will genuinely sink a canvas renderer — a night city can ask for
   forty of them. Each colour is baked into a small offscreen sprite once
   and then blitted, which turns a gradient construction into a scaled
   drawImage. */
const glowSprites = new Map();
const GLOW_SPRITE = 96;

function glowSprite(hex) {
  let c = glowSprites.get(hex);
  if (c !== undefined) return c;
  if (typeof document === "undefined") { glowSprites.set(hex, null); return null; }
  c = document.createElement("canvas");
  c.width = GLOW_SPRITE;
  c.height = GLOW_SPRITE;
  const g = c.getContext("2d");
  const half = GLOW_SPRITE / 2;
  const grad = g.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0, rgba(hex, 0.85));
  grad.addColorStop(0.45, rgba(hex, 0.3));
  grad.addColorStop(1, rgba(hex, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, GLOW_SPRITE, GLOW_SPRITE);
  glowSprites.set(hex, c);
  return c;
}

/* Chunks are walked near-to-far, so the halos that arrive first are the
   ones closest to the runner: capping the count keeps the nearest and
   drops the ones already buried in fog. */
const MAX_GLOWS = 30;

/* ------------------------------ draw list ------------------------------ */

const KIND_POLY = 0;
const KIND_ELLIPSE = 1;
const KIND_GLOW = 2;
const KIND_CUSTOM = 3;

function drawWire(ctx, _a, _b, _c, arg) {
  ctx.save();
  ctx.strokeStyle = arg.css;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (const [i, j] of arg.edges) {
    const p = arg.pts[i], q = arg.pts[j];
    if (!p || !q) continue;
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(q[0], q[1]);
  }
  ctx.stroke();
  ctx.restore();
}

function newItem() {
  return {
    kind: 0, layer: 0, z: 0, n: 0,
    pts: new Float64Array(24),
    fill: "", alpha: 1, stroke: "", strokeW: 1,
    a: 0, b: 0, c: 0, d: 0, e: 0,
    fn: null, arg: null,
  };
}

/* ------------------------------- renderer ------------------------------- */

export function createRenderer() {
  const pal = makePalette();

  const cam = {
    x: 0, y: 2.2, z: -6,
    pitch: 0.12,     // radians, positive looks down
    yaw: 0,          // radians, positive turns right
    roll: 0,         // screen-space tilt, radians
  };

  let W = 320, H = 240, cx = 160, cy = 120, focal = 300;
  let cosY = 1, sinY = 0, cosP = 1, sinP = 0;
  let cosR = 1, sinR = 0;
  let fogStart = 60, fogEnd = 210, drawDist = 220;

  /* The draw list grows to the high-water mark of a frame and is then
     reused forever: `count` is the only thing reset between frames, so a
     steady-state frame allocates nothing at all. */
  const list = [];
  let count = 0;
  let glowCount = 0;

  // scratch buffers for the clipper, reused every call
  const vx = new Float64Array(12);
  const vy = new Float64Array(12);
  const vz = new Float64Array(12);
  const ox = new Float64Array(12);
  const oy = new Float64Array(12);
  const oz = new Float64Array(12);

  function take() {
    let it = list[count];
    if (!it) { it = newItem(); list[count] = it; }
    count += 1;
    it.alpha = 1;
    it.stroke = "";
    it.fn = null;
    it.arg = null;
    return it;
  }

  /** Hands the most recent item straight back — used by the callers that
      only discover the thing is off-screen after projecting it. */
  function drop() { count -= 1; }

  function setSize(w, h) {
    W = Math.max(1, w);
    H = Math.max(1, h);
    cx = W / 2;
    cy = H / 2;
    /* Portrait windows get a taller field of view so the runner is not
       staring at a keyhole; wide desktop windows pull it back in so the
       horizon does not bow. */
    const aspect = W / H;
    const fovY = aspect < 0.85 ? 1.02 : aspect < 1.5 ? 0.9 : 0.78;
    focal = (H * 0.5) / Math.tan(fovY * 0.5);
  }

  function setAtmosphere(fogHex, start, end, dist) {
    pal.setFog(fogHex);
    fogStart = start;
    fogEnd = end;
    drawDist = dist ?? end;
  }

  function begin() {
    count = 0;
    glowCount = 0;
    cosY = Math.cos(cam.yaw); sinY = Math.sin(cam.yaw);
    cosP = Math.cos(cam.pitch); sinP = Math.sin(cam.pitch);
    cosR = Math.cos(cam.roll); sinR = Math.sin(cam.roll);
  }

  /** World point → camera space. Writes into the v* scratch at index i. */
  function toCam(i, x, y, z) {
    const dx = x - cam.x;
    const dy = y - cam.y;
    const dz = z - cam.z;
    // yaw about Y: +yaw turns the camera to the right
    const fz = dz * cosY + dx * sinY;
    const rx = dx * cosY - dz * sinY;
    /* Pitch about X. A positive pitch tips the camera *down*, so a point
       below the lens must end up nearer the optical axis, not further
       from it — hence +fz·sin rather than −fz·sin. */
    const uy = dy * cosP + fz * sinP;
    const fz2 = fz * cosP - dy * sinP;
    vx[i] = rx; vy[i] = uy; vz[i] = fz2;
  }

  /** Camera space → screen, with the screen-space roll applied last. */
  function sx(i) {
    const k = focal / vz[i];
    const px = vx[i] * k;
    const py = -vy[i] * k;
    return cx + px * cosR - py * sinR;
  }
  function sy(i) {
    const k = focal / vz[i];
    const px = vx[i] * k;
    const py = -vy[i] * k;
    return cy + px * sinR + py * cosR;
  }

  /* Sutherland–Hodgman against the single near plane. Returns the vertex
     count in the o* scratch, or 0 when the polygon is entirely behind. */
  function clipNear(n) {
    let m = 0;
    for (let i = 0; i < n; i += 1) {
      const j = (i + 1) % n;
      const zi = vz[i], zj = vz[j];
      const insideI = zi >= NEAR;
      const insideJ = zj >= NEAR;
      if (insideI) { ox[m] = vx[i]; oy[m] = vy[i]; oz[m] = zi; m += 1; }
      if (insideI !== insideJ) {
        const t = (NEAR - zi) / (zj - zi);
        ox[m] = vx[i] + (vx[j] - vx[i]) * t;
        oy[m] = vy[i] + (vy[j] - vy[i]) * t;
        oz[m] = NEAR;
        m += 1;
      }
    }
    if (m === 0) return 0;
    for (let i = 0; i < m; i += 1) { vx[i] = ox[i]; vy[i] = oy[i]; vz[i] = oz[i]; }
    return m;
  }

  function fogAt(dist) {
    if (dist <= fogStart) return 0;
    if (dist >= fogEnd) return 1;
    const t = (dist - fogStart) / (fogEnd - fogStart);
    return t * t * (3 - 2 * t);   // smoothstep, so the horizon has no seam
  }

  /**
   * A convex polygon in world space.
   * `pts` is a flat [x,y,z, x,y,z, ...] array.
   */
  function poly(pts, hex, light, layer, depthBias) {
    const n = pts.length / 3;
    if (n < 3 || n > 10) return;
    let sumZ = 0;
    let anyNear = false;
    for (let i = 0; i < n; i += 1) {
      const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];
      toCam(i, x, y, z);
      sumZ += vz[i];
      if (vz[i] < drawDist) anyNear = true;
    }
    if (!anyNear) return;
    const depth = sumZ / n;
    if (depth > drawDist) return;
    const m = clipNear(n);
    if (m < 3) return;

    // off-screen rejection on the projected bounding box
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const it = take();
    for (let i = 0; i < m; i += 1) {
      const px = sx(i), py = sy(i);
      it.pts[i * 2] = px;
      it.pts[i * 2 + 1] = py;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
    if (maxX < -8 || minX > W + 8 || maxY < -8 || minY > H + 8) {
      drop();
      return;
    }
    it.kind = KIND_POLY;
    it.layer = layer;
    it.z = depth + (depthBias || 0);
    it.n = m;
    it.fill = pal.get(hex, light, fogAt(Math.max(0, depth)));
  }

  /* --------------------------- primitives --------------------------- */

  const qbuf = new Float64Array(12);

  function quad(x1, y1, z1, x2, y2, z2, x3, y3, z3, x4, y4, z4, hex, light, layer, bias) {
    qbuf[0] = x1; qbuf[1] = y1; qbuf[2] = z1;
    qbuf[3] = x2; qbuf[4] = y2; qbuf[5] = z2;
    qbuf[6] = x3; qbuf[7] = y3; qbuf[8] = z3;
    qbuf[9] = x4; qbuf[10] = y4; qbuf[11] = z4;
    poly(qbuf, hex, light, layer, bias);
  }

  /** Flat quad on the ground plane at height y. */
  function ground(x1, z1, x2, z2, y, hex, light, layer, bias) {
    quad(x1, y, z1, x2, y, z1, x2, y, z2, x1, y, z2, hex, light, layer, bias);
  }

  /* Face light factors. The key light sits high, ahead and to the left,
     so the top of a box is brightest, the face pointing back at the
     runner is mid, and the two sides split either side of that. */
  const LIGHT_TOP = 1.0;
  const LIGHT_FRONT = 0.8;
  const LIGHT_BACK = 0.58;
  const LIGHT_LEFT = 0.63;
  const LIGHT_RIGHT = 0.72;

  /**
   * An axis-aligned box. Only the faces turned toward the camera are
   * emitted. `tint` scales every face, which is how the biome day/night
   * light level is applied.
   */
  function box(x, y, z, sx2, sy2, sz2, hex, tint, layer) {
    const t = tint === undefined ? 1 : tint;
    const x0 = x - sx2, x1 = x + sx2;
    const y0 = y, y1 = y + sy2 * 2;
    const z0 = z - sz2, z1 = z + sz2;
    const lay = layer === undefined ? L_VOLUME : layer;

    if (cam.y > y1) quad(x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1, hex, LIGHT_TOP * t, lay);
    if (cam.z < z0) quad(x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, hex, LIGHT_FRONT * t, lay);
    else if (cam.z > z1) quad(x1, y0, z1, x0, y0, z1, x0, y1, z1, x1, y1, z1, hex, LIGHT_BACK * t, lay);
    if (cam.x < x0) quad(x0, y0, z1, x0, y0, z0, x0, y1, z0, x0, y1, z1, hex, LIGHT_LEFT * t, lay);
    else if (cam.x > x1) quad(x1, y0, z0, x1, y0, z1, x1, y1, z1, x1, y1, z0, hex, LIGHT_RIGHT * t, lay);
  }

  /** A box rotated about Y — used for tilted crates, signs and limbs. */
  function boxRot(x, y, z, sx2, sy2, sz2, ang, hex, tint, layer) {
    const t = tint === undefined ? 1 : tint;
    const c = Math.cos(ang), s = Math.sin(ang);
    const lay = layer === undefined ? L_VOLUME : layer;
    const y0 = y, y1 = y + sy2 * 2;
    // corners in plan, clockwise
    const px = [-sx2, sx2, sx2, -sx2];
    const pz = [-sz2, -sz2, sz2, sz2];
    const wx = [0, 0, 0, 0], wz = [0, 0, 0, 0];
    for (let i = 0; i < 4; i += 1) {
      wx[i] = x + px[i] * c - pz[i] * s;
      wz[i] = z + px[i] * s + pz[i] * c;
    }
    // top
    quad(wx[0], y1, wz[0], wx[1], y1, wz[1], wx[2], y1, wz[2], wx[3], y1, wz[3], hex, LIGHT_TOP * t, lay);
    // sides, back-face culled by winding relative to the camera
    const sideLight = [LIGHT_FRONT, LIGHT_RIGHT, LIGHT_BACK, LIGHT_LEFT];
    for (let i = 0; i < 4; i += 1) {
      const j = (i + 1) % 4;
      const ex = wx[j] - wx[i], ez = wz[j] - wz[i];
      const nx = ez, nz = -ex;                 // outward normal in plan
      const vxc = cam.x - wx[i], vzc = cam.z - wz[i];
      if (nx * vxc + nz * vzc <= 0) continue;  // facing away
      quad(wx[i], y0, wz[i], wx[j], y0, wz[j], wx[j], y1, wz[j], wx[i], y1, wz[i],
        hex, sideLight[i] * t, lay);
    }
  }

  /** A vertical billboard quad, always square-on to the camera. */
  function billboard(x, y, z, halfW, halfH, hex, light, layer) {
    const nx = cosY, nz = -sinY;   // right vector of the camera in plan
    quad(
      x - nx * halfW, y - halfH, z - nz * halfW,
      x + nx * halfW, y - halfH, z + nz * halfW,
      x + nx * halfW, y + halfH, z + nz * halfW,
      x - nx * halfW, y + halfH, z - nz * halfW,
      hex, light, layer === undefined ? L_VOLUME : layer,
    );
  }

  /** A ground-hugging contact shadow. */
  function shadow(x, y, z, rx, rz, alpha) {
    toCam(0, x, y, z);
    if (vz[0] < NEAR) return;
    const d = vz[0];
    if (d > drawDist) return;
    const it = take();
    it.kind = KIND_ELLIPSE;
    it.layer = L_SHADOW;
    it.z = d;
    it.a = sx(0);
    it.b = sy(0);
    it.c = (focal * rx) / d;
    it.d = (focal * rz) / d * Math.max(0.18, Math.sin(cam.pitch) + 0.12);
    it.e = cam.roll;
    it.fill = "#000";
    it.alpha = alpha * (1 - fogAt(d)) * 0.55;
    if (it.c < 0.4 || it.alpha <= 0.01) drop();
  }

  /** A spinning coin: an ellipse whose width breathes with its phase. */
  function coin(x, y, z, radius, phase, faceHex, edgeHex) {
    toCam(0, x, y, z);
    if (vz[0] < NEAR) return;
    const d = vz[0];
    if (d > drawDist * 0.85) return;
    const r = (focal * radius) / d;
    if (r < 0.6) return;
    const it = take();
    it.kind = KIND_ELLIPSE;
    it.layer = L_VOLUME;
    it.z = d;
    it.a = sx(0);
    it.b = sy(0);
    const w = Math.abs(Math.cos(phase));
    it.c = Math.max(r * 0.1, r * w);
    it.d = r;
    it.e = cam.roll;
    const f = fogAt(d);
    it.fill = pal.get(w > 0.45 ? faceHex : edgeHex, 0.85 + w * 0.45, f);
    /* A rim. Without it a run of coins receding into the distance merges
       into one gold smear as soon as two of them overlap on screen. */
    it.stroke = r > 3 ? pal.get(edgeHex, 0.45, f) : "";
    it.strokeW = Math.max(1, r * 0.12);
    it.alpha = 1;
  }

  /** An emissive halo — street lamps, windows, power-up auras. */
  function glow(x, y, z, radius, hex, strength) {
    if (glowCount >= MAX_GLOWS) return;
    toCam(0, x, y, z);
    if (vz[0] < NEAR) return;
    const d = vz[0];
    if (d > drawDist) return;
    const r = (focal * radius) / d;
    if (r < 1) return;
    const it = take();
    it.kind = KIND_GLOW;
    it.layer = L_GLOW;
    it.z = d;
    it.a = sx(0);
    it.b = sy(0);
    it.c = r;
    it.fill = hex;
    it.alpha = clamp(strength * (1 - fogAt(d) * 0.7), 0, 1);
    if (it.alpha < 0.02) drop();
    else glowCount += 1;
  }

  /**
   * A wireframe box in world space, drawn on top of everything.
   * Development only: this is how collision boxes are checked against the
   * art that is supposed to represent them.
   */
  function wire(x, y, z, sx2, sy2, sz2, css) {
    const x0 = x - sx2, x1 = x + sx2;
    const y0 = y, y1 = y + sy2 * 2;
    const z0 = z - sz2, z1 = z + sz2;
    const P = [
      [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
      [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1],
    ];
    const E = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7]];
    const pts = [];
    for (const p of P) {
      toCam(0, p[0], p[1], p[2]);
      pts.push(vz[0] > NEAR ? [sx(0), sy(0)] : null);
    }
    const it = take();
    it.kind = KIND_CUSTOM;
    it.layer = L_GLOW + 1;
    it.z = 0;
    it.a = 0; it.b = 0; it.c = 1;
    it.arg = { pts, edges: E, css };
    it.fn = drawWire;
  }

  /** Escape hatch for anything the primitives above cannot express. */
  function custom(x, y, z, fn, arg, layer) {
    toCam(0, x, y, z);
    if (vz[0] < NEAR) return;
    const d = vz[0];
    if (d > drawDist) return;
    const it = take();
    it.kind = KIND_CUSTOM;
    it.layer = layer === undefined ? L_VOLUME : layer;
    it.z = d;
    it.a = sx(0);
    it.b = sy(0);
    it.c = focal / d;
    it.fn = fn;
    it.arg = arg;
    it.alpha = 1 - fogAt(d);
  }

  /** Project a world point for callers that need screen coordinates. */
  function project(x, y, z, out) {
    toCam(0, x, y, z);
    if (vz[0] < NEAR) return null;
    const o = out || {};
    o.x = sx(0);
    o.y = sy(0);
    o.z = vz[0];
    o.scale = focal / vz[0];
    return o;
  }

  /** Screen Y of the true horizon, for lining the sky up with geometry. */
  function horizonY() {
    return cy - focal * Math.tan(cam.pitch);
  }

  function byDepth(p, q) {
    if (p.layer !== q.layer) return p.layer - q.layer;
    return q.z - p.z;
  }

  const view = [];

  function flush(ctx) {
    view.length = 0;
    for (let i = 0; i < count; i += 1) view.push(list[i]);
    view.sort(byDepth);

    let lastFill = "";
    let lastAlpha = 1;
    ctx.globalAlpha = 1;
    ctx.lineJoin = "round";

    for (let i = 0; i < view.length; i += 1) {
      const it = view[i];
      if (it.alpha !== lastAlpha) { ctx.globalAlpha = it.alpha; lastAlpha = it.alpha; }

      if (it.kind === KIND_POLY) {
        if (it.fill !== lastFill) { ctx.fillStyle = it.fill; lastFill = it.fill; }
        ctx.beginPath();
        ctx.moveTo(it.pts[0], it.pts[1]);
        for (let k = 1; k < it.n; k += 1) ctx.lineTo(it.pts[k * 2], it.pts[k * 2 + 1]);
        ctx.closePath();
        ctx.fill();
      } else if (it.kind === KIND_ELLIPSE) {
        if (it.fill !== lastFill) { ctx.fillStyle = it.fill; lastFill = it.fill; }
        ctx.beginPath();
        ctx.ellipse(it.a, it.b, it.c, it.d, it.e, 0, Math.PI * 2);
        ctx.fill();
        if (it.stroke) {
          ctx.strokeStyle = it.stroke;
          ctx.lineWidth = it.strokeW;
          ctx.stroke();
        }
      } else if (it.kind === KIND_GLOW) {
        const sprite = glowSprite(it.fill);
        if (sprite) ctx.drawImage(sprite, it.a - it.c, it.b - it.c, it.c * 2, it.c * 2);
      } else if (it.kind === KIND_CUSTOM && it.fn) {
        it.fn(ctx, it.a, it.b, it.c, it.arg, it.alpha);
        lastFill = "";
        lastAlpha = 1;
        ctx.globalAlpha = 1;
      }
    }
    ctx.globalAlpha = 1;
  }

  return {
    cam,
    get width() { return W; },
    get height() { return H; },
    get focal() { return focal; },
    get drawDist() { return drawDist; },
    setSize,
    setAtmosphere,
    horizonY,
    begin,
    flush,
    poly,
    quad,
    ground,
    box,
    boxRot,
    wire,
    billboard,
    shadow,
    coin,
    glow,
    custom,
    project,
    fogAt,
    colour: (hex, light, dist) => pal.get(hex, light, fogAt(dist)),
    resetPalette: () => pal.clear(),
    get items() { return count; },
  };
}
