/* Catmull-Rom spline helpers + deterministic RNG for Turbo Rush.
   All world geometry is generated from these — no external assets. */

export function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cr = (p0, p1, p2, p3, t) => {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
};

/* Sample a closed Catmull-Rom loop through `pts` ({x,y,z}) into roughly
   equally spaced samples ~`spacing` apart. Returns array of {x,y,z}. */
export function sampleLoop(pts, spacing) {
  const n = pts.length;
  const raw = [];
  const per = 8; // dense pre-pass per segment
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    for (let j = 0; j < per; j++) {
      const t = j / per;
      raw.push({ x: cr(p0.x, p1.x, p2.x, p3.x, t), y: cr(p0.y, p1.y, p2.y, p3.y, t), z: cr(p0.z, p1.z, p2.z, p3.z, t) });
    }
  }
  return respace(raw, spacing, true);
}

/* Sample an open Catmull-Rom through pts (ends clamped). */
export function sampleOpen(pts, spacing) {
  const n = pts.length;
  const raw = [];
  const per = 10;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
    for (let j = 0; j < per; j++) {
      const t = j / per;
      raw.push({ x: cr(p0.x, p1.x, p2.x, p3.x, t), y: cr(p0.y, p1.y, p2.y, p3.y, t), z: cr(p0.z, p1.z, p2.z, p3.z, t) });
    }
  }
  raw.push({ ...pts[n - 1] });
  return respace(raw, spacing, false);
}

function respace(raw, spacing, loop) {
  const out = [raw[0]];
  let acc = 0;
  const N = raw.length;
  const last = loop ? N : N - 1;
  for (let i = 0; i < last; i++) {
    const a = raw[i], b = raw[(i + 1) % N];
    const d = Math.hypot(b.x - a.x, b.z - a.z, b.y - a.y);
    acc += d;
    if (acc >= spacing) { out.push({ x: b.x, y: b.y, z: b.z }); acc = 0; }
  }
  return out;
}

/* Total XZ length of a sample chain. */
export function chainLength(samples, loop) {
  let len = 0;
  const n = samples.length;
  const last = loop ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = samples[i], b = samples[(i + 1) % n];
    len += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return len;
}

/* Enrich a chain of points into full track samples:
   forward angle, per-sample cumulative distance s, default width. */
export function enrich(samples, loop, width) {
  const n = samples.length;
  let s = 0;
  const out = samples.map((p, i) => {
    const b = samples[(i + 1) % n];
    const a = samples[(i - 1 + n) % n];
    const nx = (loop || i < n - 1) ? b : p;
    const px = (loop || i > 0) ? a : p;
    const ang = Math.atan2(nx.x - px.x, nx.z - px.z);
    if (i > 0) {
      const q = samples[i - 1];
      s += Math.hypot(p.x - q.x, p.z - q.z);
    }
    return { x: p.x, y: p.y, z: p.z, ang, s, w: width, flags: 0 };
  });
  return out;
}

/* Curvature at sample i (radians of heading change per metre). */
export function curvatureAt(samples, i, loop) {
  void loop;
  const n = samples.length;
  const a = samples[(i - 2 + n) % n], b = samples[(i + 2) % n];
  let d = b.ang - a.ang;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const ds = Math.max(1, Math.abs(b.s - a.s) < 1 ? 8 : Math.abs(((b.s - a.s) + 1e9) % 1e9));
  return d / Math.min(ds, 40);
}

export const FLAG = { TUNNEL: 1, BOOST: 2, JUMP: 4, DIRT: 8, GLASS: 16, NORAIL: 32, START: 64 };
