/* ------------------------------------------------------------------ *
 * compileTrack(def) — pure geometry/data, no three.js. Turns a track
 * definition into sampled centrelines, shortcuts, pickups and flags.
 * Everything lives in WORLD SPACE and never moves with the camera.
 * ------------------------------------------------------------------ */
import { mulberry, sampleLoop, sampleOpen, enrich, chainLength, FLAG } from "./spline.js";

const TAU = Math.PI * 2;
export { FLAG };

function controlPoints(def) {
  const M = 30;
  const pts = [];
  for (let k = 0; k < M; k++) {
    const th = (k / M) * TAU;
    let r = 1;
    for (const [n, a, ph] of def.harm) r += a * Math.sin(n * th + ph);
    let y = def.elevBase;
    for (const [m, e, ps] of def.elev) y += e * Math.sin(m * th + ps);
    if (def.ground !== null && def.world === "earth") y = Math.max(2, y);
    pts.push({ x: Math.cos(th) * r * def.R, y, z: Math.sin(th) * r * def.R });
  }
  return pts;
}

function markRange(samples, f0, f1, flag) {
  const n = samples.length;
  const a = Math.floor(f0 * n), b = Math.floor(f1 * n);
  for (let i = a; i <= b; i++) samples[((i % n) + n) % n].flags |= flag;
}

function lateral(sample, off) {
  return {
    x: sample.x + Math.cos(sample.ang) * off,
    y: sample.y,
    z: sample.z - Math.sin(sample.ang) * off,
  };
}
export { lateral };

export function compileTrack(def) {
  const rng = mulberry(def.seed * 7919 + 13);
  const ctrl = controlPoints(def);
  const chain = sampleLoop(ctrl, 4);
  const samples = enrich(chain, true, def.width);
  const n = samples.length;
  const length = chainLength(chain, true) || samples[n - 1].s + 4;

  /* flags */
  for (const [f0, f1] of def.tunnels || []) markRange(samples, f0, f1, FLAG.TUNNEL);
  for (const [f0, f1] of def.glassTunnels || []) markRange(samples, f0, f1, FLAG.GLASS);
  for (const f of def.boosts || []) markRange(samples, f, f + 0.008, FLAG.BOOST);
  for (const f of def.jumps || []) markRange(samples, f, f + 0.006, FLAG.JUMP);
  markRange(samples, 0, 0.004, FLAG.START);

  /* Ramp shaping: lift road slightly into each jump so it reads as a kicker. */
  for (const f of def.jumps || []) {
    const c = Math.floor(f * n);
    for (let k = -4; k <= 0; k++) {
      const i = ((c + k) % n + n) % n;
      samples[i].y += (4 + k) * 0.55; // rises 0.55 m per sample into the lip
    }
  }

  /* ---------------- shortcuts ---------------- */
  const shortcuts = (def.shortcuts || []).map((sc, idx) => {
    const i0 = Math.floor(sc.f0 * n), i1 = Math.floor(sc.f1 * n);
    const A = samples[i0], B = samples[i1];
    // Two mid control points pulled toward the chord (a shorter line than
    // the road's bulge) with the shortcut's own elevation character.
    const mids = [0.33, 0.66].map((t, mi) => {
      const cx = A.x + (B.x - A.x) * t, cz = A.z + (B.z - A.z) * t;
      const cy = A.y + (B.y - A.y) * t + sc.dip * (mi === 0 ? 0.8 : 1) + (rng() - 0.5) * 2;
      // small sideways wobble so it doesn't look like a ruler line
      const wob = (rng() - 0.5) * 18;
      return { x: cx + Math.cos(A.ang) * wob, y: cy, z: cz - Math.sin(A.ang) * wob };
    });
    const open = sampleOpen([{ x: A.x, y: A.y, z: A.z }, ...mids, { x: B.x, y: B.y, z: B.z }], 4);
    const ss = enrich(open, false, sc.width);
    const scLen = chainLength(open, false);
    const isTunnel = sc.surface === "cave" || sc.surface === "tube";
    for (const s of ss) {
      if (isTunnel) s.flags |= FLAG.TUNNEL;
      if (sc.surface === "dirt" || sc.surface === "beach") s.flags |= FLAG.DIRT;
      if (sc.surface === "tube") s.flags |= FLAG.GLASS;
    }
    const sStart = A.s, sEnd = B.s > A.s ? B.s : B.s + length;
    return {
      id: `sc${idx}`, name: sc.name, surface: sc.surface, skill: sc.skill,
      samples: ss, len: scLen, entryIdx: i0, exitIdx: i1, sStart, sEnd,
      saves: Math.max(0, (sEnd - sStart) - scLen), // metres of road skipped
    };
  });

  /* ---------------- pickups ---------------- */
  const itemBoxes = [];
  const boxRows = [0.1, 0.3, 0.52, 0.74, 0.92];
  for (const f of boxRows) {
    const i = Math.floor(f * n);
    const s = samples[i];
    for (let k = -1; k <= 1; k++) {
      const p = lateral(s, k * s.w * 0.3);
      itemBoxes.push({ x: p.x, y: s.y + 1.1, z: p.z, seg: i, t: 0 });
    }
  }
  for (const sc of shortcuts) {
    const mid = sc.samples[Math.floor(sc.samples.length / 2)];
    itemBoxes.push({ x: mid.x, y: mid.y + 1.1, z: mid.z, seg: -1, t: 0 });
  }

  const coins = [];
  const coinRuns = [0.05, 0.18, 0.42, 0.6, 0.66, 0.84];
  for (const f of coinRuns) {
    const i = Math.floor(f * n);
    const side = (Math.floor(f * 100) % 2 ? 1 : -1) * 0.25;
    for (let k = 0; k < 6; k++) {
      const s = samples[(i + k * 2) % n];
      const p = lateral(s, side * s.w);
      coins.push({ x: p.x, y: s.y + 0.8, z: p.z });
    }
  }
  for (const sc of shortcuts) {
    for (let k = 0; k < 4; k++) {
      const s = sc.samples[Math.floor((k + 1) / 6 * sc.samples.length)];
      if (s) coins.push({ x: s.x, y: s.y + 0.8, z: s.z });
    }
  }

  /* Hidden K-emblems: tucked wide of the racing line or inside shortcuts. */
  const emblems = [];
  const embSpots = [0.24, 0.47, 0.7].map((f, j) => {
    const i = Math.floor(f * n);
    const s = samples[i];
    const p = lateral(s, (j % 2 ? 1 : -1) * (s.w * 0.5 + 3.5));
    return { x: p.x, y: s.y + 1.2, z: p.z };
  });
  emblems.push(...embSpots);

  /* Shortcut hazards: parked rocks that punish sloppy lines. They sit at
     the edges, never mid-corridor, and are skipped in narrow tubes where
     a boulder would block the route outright. */
  const hazards = [];
  for (const sc of shortcuts) {
    if (sc.surface === "tube" || sc.samples[0].w < 6.5) continue;
    const count = Math.round(sc.skill * 3);
    for (let k = 0; k < count; k++) {
      const s = sc.samples[Math.floor(((k + 1) / (count + 1)) * sc.samples.length)];
      if (!s) continue;
      const off = ((k % 2) ? 1 : -1) * s.w * 0.38;
      const p = lateral(s, off);
      hazards.push({ x: p.x, y: s.y, z: p.z, r: 1.0 });
    }
  }

  /* Start grid: 6 slots behind the line, staggered 2-wide. */
  const grid = [];
  for (let k = 0; k < 6; k++) {
    const i = ((n - 4 - k * 3) % n + n) % n;
    const s = samples[i];
    const p = lateral(s, (k % 2 === 0 ? -1 : 1) * s.w * 0.22);
    grid.push({ x: p.x, y: s.y, z: p.z, heading: s.ang, seg: i });
  }

  /* Minimap polyline, normalised to 0..1 box. */
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const s of samples) { minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x); minZ = Math.min(minZ, s.z); maxZ = Math.max(maxZ, s.z); }
  const span = Math.max(maxX - minX, maxZ - minZ);
  const norm = (p) => ({ x: (p.x - minX) / span, y: (p.z - minZ) / span });
  const minimap = {
    main: samples.filter((_, i) => i % 3 === 0).map(norm),
    shortcuts: shortcuts.map((sc) => sc.samples.filter((_, i) => i % 3 === 0).map(norm)),
    norm,
  };

  return { def, samples, n, length, shortcuts, itemBoxes, coins, emblems, hazards, grid, minimap };
}

/* Locate the nearest sample to a world position, searching around a hint
   index so the cost stays constant. Works on main track (loop) and
   shortcut chains (open). */
export function nearestSample(samples, loop, x, z, hint, span = 24) {
  const n = samples.length;
  let best = hint, bestD = Infinity;
  for (let k = -span; k <= span; k++) {
    let i = hint + k;
    if (loop) i = ((i % n) + n) % n;
    else { if (i < 0 || i >= n) continue; }
    const s = samples[i];
    const d = (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/* Signed lateral offset of (x,z) from sample i's centreline (+ = right). */
export function lateralOffset(s, x, z) {
  /* right-perp of forward (sin a, cos a) is (cos a, -sin a) */
  return (x - s.x) * Math.cos(s.ang) - (z - s.z) * Math.sin(s.ang);
}

/* Road surface height near sample i for a car at (x,z): lerp along the
   segment toward the next sample for smooth slopes. */
export function surfaceY(samples, loop, i, x, z) {
  const n = samples.length;
  const a = samples[i];
  const j = loop ? (i + 1) % n : Math.min(i + 1, n - 1);
  const b = samples[j];
  const dx = b.x - a.x, dz = b.z - a.z;
  const L2 = dx * dx + dz * dz || 1;
  let t = ((x - a.x) * dx + (z - a.z) * dz) / L2;
  t = Math.max(0, Math.min(1, t));
  return a.y + (b.y - a.y) * t;
}
