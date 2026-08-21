/* ------------------------------------------------------------------ *
 * City Bus Simulator — world generation.
 *
 * The world is one connected road network laid out on an *irregular*
 * grid: the spacing between road centrelines varies, so downtown blocks
 * are 60m apart while a countryside road runs 150m between junctions.
 * Keeping the grid topology buys the same three things it always did —
 * an analytic "am I on the road?" test, trivial collision push-out and
 * cheap route planning over intersection nodes — while the varying
 * spacing plus a per-cell region map is what makes a mountain pass feel
 * nothing like Ridge Road.
 *
 * Height is a smooth analytic field. Road nodes sample it, get clamped
 * above the water line and then relaxed so no gradient is undrivable;
 * the road surface between two nodes is a smooth interpolation of them.
 * That one rule gives tunnels and bridges for free: wherever the terrain
 * ends up well above the interpolated road we are inside a hill, and
 * wherever it drops well below we are on a viaduct.
 *
 * Axes: x = east, z = north, y = up. Ghana drives on the right, so the
 * bus is left-hand drive and traffic keeps to the right lane.
 * ------------------------------------------------------------------ */

/* ------------------------------ helpers ------------------------------ */

export function mulberry32(a) {
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

function hash2(i, j, s) {
  let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(s, 2246822519);
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0,1]. */
function vnoise(x, z, s) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const u = smooth01(x - xi);
  const v = smooth01(z - zi);
  const a = hash2(xi, zi, s), b = hash2(xi + 1, zi, s);
  const c = hash2(xi, zi + 1, s), d = hash2(xi + 1, zi + 1, s);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

/* ------------------------------ regions ------------------------------ */

export const CITY = 0, SUBURB = 1, TOWN = 2, COUNTRY = 3;
export const FOREST = 4, MOUNTAIN = 5, COAST = 6, AIRPORT = 7;

export const REGION = [
  {
    id: CITY, key: "city", name: "City Centre",
    ground: "#7d7d72", verge: "#7f8a6e", limit: 13,
    traffic: 1.35, peds: 1.5, trees: 0.25, lights: true,
    sight: 210,
  },
  {
    id: SUBURB, key: "suburb", name: "Suburbs",
    ground: "#6f8258", verge: "#6d8054", limit: 15,
    traffic: 0.85, peds: 0.8, trees: 1.1, lights: true,
    sight: 255,
  },
  {
    id: TOWN, key: "town", name: "Small Town",
    ground: "#79805f", verge: "#748052", limit: 11,
    traffic: 0.8, peds: 1.0, trees: 0.8, lights: true,
    sight: 235,
  },
  {
    id: COUNTRY, key: "country", name: "Countryside",
    ground: "#7f8a4f", verge: "#7c8a4a", limit: 20,
    traffic: 0.45, peds: 0.1, trees: 0.7, lights: false,
    sight: 330,
  },
  {
    id: FOREST, key: "forest", name: "Forest Road",
    ground: "#4e6b3c", verge: "#4a6738", limit: 16,
    traffic: 0.4, peds: 0.05, trees: 3.2, lights: false,
    sight: 265,
  },
  {
    id: MOUNTAIN, key: "mountain", name: "Mountain Pass",
    ground: "#6d6a5c", verge: "#5f6450", limit: 12,
    traffic: 0.35, peds: 0.02, trees: 1.0, lights: false,
    sight: 330,
  },
  {
    id: COAST, key: "coast", name: "Coastal Road",
    ground: "#9c9370", verge: "#8f9066", limit: 16,
    traffic: 0.45, peds: 0.25, trees: 0.35, lights: false,
    sight: 330,
  },
  {
    id: AIRPORT, key: "airport", name: "Airport",
    ground: "#8a8d86", verge: "#7d8768", limit: 18,
    traffic: 0.7, peds: 0.35, trees: 0.2, lights: true,
    sight: 300,
  },
];

const REGION_CHAR = {
  C: CITY, S: SUBURB, T: TOWN, K: COUNTRY,
  F: FOREST, M: MOUNTAIN, O: COAST, A: AIRPORT,
};

/* Rows are written north (top) to south (bottom) so the map reads like a
   map. Each row is one cell of the grid, 13 across. */
const REGION_MAP = [
  "MMMMFFFFKKKKK",   // j = 12  north
  "MMMMFFFFKKKKK",
  "MMMMMFFFKKKKK",
  "MMMMMFFKKKKKK",
  "OTTTSSKKKAAAA",
  "OTTTSSSCAAAAA",
  "OOSSSCCCAAAAA",
  "OOSSCCCCCAAAA",
  "OOSSCCCCCSSSS",
  "OOSSSCCCSSSTT",
  "OOOSSSSSSTTTT",
  "OOOOKKKKKTTTT",
  "OOOOKKKKKKKKK",   // j = 0   south
];

export const GRID = 13;                 // 13 x 13 cells -> 14 x 14 nodes

const COL_W = [150, 135, 110, 96, 72, 62, 62, 66, 80, 100, 130, 120, 145];
const ROW_H = [140, 130, 115, 92, 70, 62, 64, 72, 96, 130, 150, 140, 155];

export const LX = new Float64Array(GRID + 1);
export const LZ = new Float64Array(GRID + 1);
for (let i = 0; i < GRID; i += 1) LX[i + 1] = LX[i] + COL_W[i];
for (let j = 0; j < GRID; j += 1) LZ[j + 1] = LZ[j] + ROW_H[j];

export const SPAN_X = LX[GRID];
export const SPAN_Z = LZ[GRID];
export const CITY_SPAN = Math.max(SPAN_X, SPAN_Z);
/** Nominal block size — only used where something needs a rough scale. */
export const BLOCK = 100;

/** region id per cell, indexed [i * GRID + j] */
export const CELL_REGION = new Uint8Array(GRID * GRID);
for (let j = 0; j < GRID; j += 1) {
  const row = REGION_MAP[GRID - 1 - j];
  for (let i = 0; i < GRID; i += 1) {
    CELL_REGION[i * GRID + j] = REGION_CHAR[row[i]];
  }
}

export function cellRegion(i, j) {
  return CELL_REGION[clamp(i, 0, GRID - 1) * GRID + clamp(j, 0, GRID - 1)];
}

/* ------------------------- fast coordinate lookup ------------------------- */

/* One metre per entry, so "which line / which cell is this?" is an array
   read rather than a search. The tables are a few kB and built once. */
const PAD = 400;                       // world padding either side
const TABLE_X = new Uint8Array(Math.ceil(SPAN_X) + PAD * 2 + 2);
const TABLE_Z = new Uint8Array(Math.ceil(SPAN_Z) + PAD * 2 + 2);
const CELL_X = new Uint8Array(TABLE_X.length);
const CELL_Z = new Uint8Array(TABLE_Z.length);

function buildTables(lines, table, cells, span) {
  for (let m = 0; m < table.length; m += 1) {
    const v = m - PAD;
    let best = 0, bd = Infinity;
    for (let k = 0; k <= GRID; k += 1) {
      const d = Math.abs(v - lines[k]);
      if (d < bd) { bd = d; best = k; }
    }
    table[m] = best;
    let c = 0;
    while (c < GRID - 1 && v >= lines[c + 1]) c += 1;
    cells[m] = c;
  }
  return span;
}
buildTables(LX, TABLE_X, CELL_X, SPAN_X);
buildTables(LZ, TABLE_Z, CELL_Z, SPAN_Z);

/** Index of the nearest north-south road centreline. */
export function bandIndexX(x) {
  const m = Math.round(x) + PAD;
  return TABLE_X[m < 0 ? 0 : m >= TABLE_X.length ? TABLE_X.length - 1 : m];
}
/** Index of the nearest east-west road centreline. */
export function bandIndexZ(z) {
  const m = Math.round(z) + PAD;
  return TABLE_Z[m < 0 ? 0 : m >= TABLE_Z.length ? TABLE_Z.length - 1 : m];
}
export function cellIndexX(x) {
  const m = Math.round(x) + PAD;
  return CELL_X[m < 0 ? 0 : m >= CELL_X.length ? CELL_X.length - 1 : m];
}
export function cellIndexZ(z) {
  const m = Math.round(z) + PAD;
  return CELL_Z[m < 0 ? 0 : m >= CELL_Z.length ? CELL_Z.length - 1 : m];
}

export const bandDistX = (x) => Math.abs(x - LX[bandIndexX(x)]);
export const bandDistZ = (z) => Math.abs(z - LZ[bandIndexZ(z)]);

/** Region at a world position. */
export function regionAt(x, z) {
  return CELL_REGION[cellIndexX(x) * GRID + cellIndexZ(z)];
}

/* ---------------------------- road classes ---------------------------- */

export const RURAL = 0, STREET = 1, HIGHWAY = 2;

/* Rural and street roads deliberately share their carriageway geometry.
   They used to differ (7.6 vs 8.4 half-width), which put an 0.8m step in
   the tarmac edge and a 0.4m jump in the lane centre at every junction
   where the class changed — the "lanes suddenly shift" effect. Only the
   verge, the markings and the speed differ now. */
export const ROAD_CLASS = [
  { half: 8.4, pave: 3.4, lanes: [4.2], kerb: false, limit: 19, name: "rural" },
  { half: 8.4, pave: 3.8, lanes: [4.2], kerb: true, limit: 13, name: "street" },
  { half: 12.2, pave: 2.8, lanes: [3.3, 8.7], kerb: false, limit: 27, name: "highway" },
];

/** Legacy nominal dimensions — the street class, which most roads are. */
export const ROAD_HALF = ROAD_CLASS[STREET].half;
export const PAVE_W = ROAD_CLASS[STREET].pave;
export const LANE = ROAD_CLASS[STREET].lanes[0];
export const KERB = ROAD_HALF + PAVE_W;

/* One highway each way: line 9 runs south-north out through the airport,
   line 2 runs west-east from the coast through the town. */
const HWY_V = 9, HWY_H = 2;

export const VCLASS = new Uint8Array(GRID + 1);
export const HCLASS = new Uint8Array(GRID + 1);

function builtUp(reg) {
  return reg === CITY || reg === TOWN || reg === AIRPORT || reg === SUBURB;
}
for (let i = 0; i <= GRID; i += 1) {
  if (i === HWY_V) { VCLASS[i] = HIGHWAY; continue; }
  let urban = 0;
  for (let j = 0; j < GRID; j += 1) {
    if (builtUp(cellRegion(i - 1, j))) urban += 1;
    if (builtUp(cellRegion(i, j))) urban += 1;
  }
  VCLASS[i] = urban >= GRID ? STREET : RURAL;
}
for (let j = 0; j <= GRID; j += 1) {
  if (j === HWY_H) { HCLASS[j] = HIGHWAY; continue; }
  let urban = 0;
  for (let i = 0; i < GRID; i += 1) {
    if (builtUp(cellRegion(i, j - 1))) urban += 1;
    if (builtUp(cellRegion(i, j))) urban += 1;
  }
  HCLASS[j] = urban >= GRID ? STREET : RURAL;
}

export const vClass = (i) => ROAD_CLASS[VCLASS[clamp(i, 0, GRID)]];
export const hClass = (j) => ROAD_CLASS[HCLASS[clamp(j, 0, GRID)]];

/** Lane centre offset for a vehicle on the given line. */
export function laneOffset(vertical, line, lane) {
  const cls = vertical ? vClass(line) : hClass(line);
  return cls.lanes[Math.min(lane | 0, cls.lanes.length - 1)];
}
export function laneCount(vertical, line) {
  return (vertical ? vClass(line) : hClass(line)).lanes.length;
}

/* ------------------------------ surfaces ------------------------------ */

export const SURFACE_ROAD = 0;
export const SURFACE_PAVE = 1;
export const SURFACE_BLOCK = 2;

export function surfaceAt(x, z) {
  const i = bandIndexX(x), j = bandIndexZ(z);
  const cv = vClass(i), ch = hClass(j);
  const dx = Math.abs(x - LX[i]), dz = Math.abs(z - LZ[j]);
  if (dx <= cv.half || dz <= ch.half) return SURFACE_ROAD;
  /* Kerb radius. A junction of two crossed rectangles has a sharp
     re-entrant corner that a twelve-metre bus cannot turn through; real
     junctions are rounded, and so is this one. */
  const R = Math.min(cv.pave, ch.pave);
  const rx = cv.half + R, rz = ch.half + R;
  if (dx < rx && dz < rz) {
    const ex = rx - dx, ez = rz - dz;
    if (ex * ex + ez * ez > R * R) return SURFACE_ROAD;
  }
  if (dx <= cv.half + cv.pave || dz <= ch.half + ch.pave) return SURFACE_PAVE;
  return SURFACE_BLOCK;
}

/** Distance from a point to the nearest piece of tarmac (0 when on it). */
export function roadEdgeDist(x, z) {
  const i = bandIndexX(x), j = bandIndexZ(z);
  const dx = Math.abs(x - LX[i]) - vClass(i).half;
  const dz = Math.abs(z - LZ[j]) - hClass(j).half;
  return Math.max(0, Math.min(dx, dz));
}

/**
 * Smallest translation that pushes a blocked point back onto the road
 * corridor. Grid alignment means we only ever resolve on one axis.
 */
export function pushOut(x, z, pad = 0) {
  const i = bandIndexX(x), j = bandIndexZ(z);
  const cv = vClass(i), ch = hClass(j);
  const limX = cv.half + cv.pave + pad;
  const limZ = ch.half + ch.pave + pad;
  const ex = Math.abs(x - LX[i]) - limX;
  const ez = Math.abs(z - LZ[j]) - limZ;
  if (ex <= 0 || ez <= 0) return null;
  if (ex < ez) return { dx: x > LX[i] ? -ex : ex, dz: 0 };
  return { dx: 0, dz: z > LZ[j] ? -ez : ez };
}

/* ------------------------------- terrain ------------------------------- */

export const WATER_Y = -9;
const SEA_EDGE = LX[0] - 22;

/* Smooth per-region weight fields, sampled at cell centres and bilinearly
   interpolated so a mountain fades into forest instead of stepping. */
const CX = new Float64Array(GRID);
const CZ = new Float64Array(GRID);
for (let i = 0; i < GRID; i += 1) CX[i] = (LX[i] + LX[i + 1]) / 2;
for (let j = 0; j < GRID; j += 1) CZ[j] = (LZ[j] + LZ[j + 1]) / 2;

function makeField(test) {
  const f = new Float32Array(GRID * GRID);
  for (let i = 0; i < GRID; i += 1) {
    for (let j = 0; j < GRID; j += 1) f[i * GRID + j] = test(CELL_REGION[i * GRID + j]) ? 1 : 0;
  }
  // one blur pass so the field is already soft before interpolation
  const g = new Float32Array(f);
  for (let i = 0; i < GRID; i += 1) {
    for (let j = 0; j < GRID; j += 1) {
      let sum = 0, n = 0;
      for (let a = -1; a <= 1; a += 1) {
        for (let b = -1; b <= 1; b += 1) {
          const ii = clamp(i + a, 0, GRID - 1), jj = clamp(j + b, 0, GRID - 1);
          const w = a === 0 && b === 0 ? 3 : 1;
          sum += f[ii * GRID + jj] * w; n += w;
        }
      }
      g[i * GRID + j] = sum / n;
    }
  }
  return g;
}

function fieldAt(f, x, z) {
  let i = 0;
  while (i < GRID - 2 && x >= CX[i + 1]) i += 1;
  let j = 0;
  while (j < GRID - 2 && z >= CZ[j + 1]) j += 1;
  const tx = smooth01((x - CX[i]) / (CX[i + 1] - CX[i]));
  const tz = smooth01((z - CZ[j]) / (CZ[j + 1] - CZ[j]));
  const a = f[i * GRID + j], b = f[(i + 1) * GRID + j];
  const c = f[i * GRID + j + 1], d = f[(i + 1) * GRID + j + 1];
  return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
}

const F_MOUNTAIN = makeField((r) => r === MOUNTAIN);
const F_FOREST = makeField((r) => r === FOREST);
const F_COAST = makeField((r) => r === COAST);
const F_FLAT = makeField((r) => r === CITY || r === AIRPORT);

const PEAKS = [
  // straddling roads, so the pass tunnels through them
  { x: LX[2], z: (LZ[10] + LZ[11]) / 2, h: 50, r: 46 },
  { x: (LX[0] + LX[1]) / 2, z: LZ[11], h: 46, r: 44 },
  { x: (LX[3] + LX[4]) / 2, z: (LZ[9] + LZ[10]) / 2, h: 42, r: 62 },
  { x: LX[1], z: (LZ[9] + LZ[10]) / 2, h: 34, r: 40 },
];

const RIVER_Z = (LZ[8] + LZ[9]) / 2;
const RIVER_HALF = 26;
const RIVER_END = LX[9];
const GORGE_X = LX[2] + (LX[3] - LX[2]) * 0.45;
const GORGE_HALF = 23;

function riverCut(x, z) {
  const dz = Math.abs(z - RIVER_Z);
  if (dz > RIVER_HALF * 2.1) return 0;
  const reach = 1 - smooth01((x - (RIVER_END - 150)) / 150);
  if (reach <= 0) return 0;
  const t = clamp(1 - dz / (RIVER_HALF * 2.1), 0, 1);
  return 30 * t * t * reach;
}

function gorgeCut(x, z) {
  if (z < LZ[9] - 60) return 0;
  const dx = Math.abs(x - GORGE_X);
  if (dx > GORGE_HALF * 2.1) return 0;
  const reach = smooth01((z - (LZ[9] - 60)) / 90);
  const t = clamp(1 - dx / (GORGE_HALF * 2.1), 0, 1);
  return 44 * t * t * reach;
}

/** Natural ground height, ignoring the roads. */
export function terrainAt(x, z) {
  const m = fieldAt(F_MOUNTAIN, x, z);
  const f = fieldAt(F_FOREST, x, z);
  const o = fieldAt(F_COAST, x, z);
  const flat = fieldAt(F_FLAT, x, z);

  let h = (vnoise(x * 0.0034, z * 0.0034, 11) - 0.5) * 9 * (1 - flat * 0.8);
  if (m > 0.001) {
    /* Broad ridges rather than a fine crumple: a road can follow a long
       swell, but a peak every eighty metres would turn the mountain pass
       into an unbroken chain of tunnels. */
    const ridge = vnoise(x * 0.0040, z * 0.0040, 23) * 0.74
      + vnoise(x * 0.0105, z * 0.0105, 31) * 0.19
      + vnoise(x * 0.031, z * 0.031, 37) * 0.07;
    h += m * m * (20 + 58 * ridge);
  }
  if (f > 0.001) h += f * (7 + 13 * vnoise(x * 0.0052, z * 0.0052, 43));
  for (let k = 0; k < PEAKS.length; k += 1) {
    const p = PEAKS[k];
    const dx = x - p.x, dz = z - p.z;
    const d2 = (dx * dx + dz * dz) / (p.r * p.r);
    if (d2 < 9) h += p.h * Math.exp(-d2 * 0.5);
  }
  if (o > 0.001) h -= o * 4;
  if (x < SEA_EDGE) {
    const t = smooth01((SEA_EDGE - x) / 150);
    h -= 52 * t;
  } else {
    // a shore bluff, so the coast road runs above the water rather than
    // paddling through it
    const bluff = WATER_Y + 2.5 + 9 * smooth01((x - SEA_EDGE) / 70);
    if (h < bluff) h = bluff;
  }
  h -= riverCut(x, z);
  h -= gorgeCut(x, z);
  return h;
}

export const isWater = (x, z) => terrainAt(x, z) < WATER_Y;

/* --------------------------- road height field --------------------------- */

/* Node heights are the terrain, lifted clear of the water and then
   relaxed until no leg is steeper than ~7.5%. A bus can climb that; a
   raw terrain sample through a mountain absolutely cannot. */
const NH = new Float64Array((GRID + 1) * (GRID + 1));
const nk = (i, j) => i * (GRID + 1) + j;

(function buildNodeHeights() {
  for (let i = 0; i <= GRID; i += 1) {
    for (let j = 0; j <= GRID; j += 1) {
      NH[nk(i, j)] = Math.max(WATER_Y + 8.5, terrainAt(LX[i], LZ[j]));
    }
  }
  /* A mountain road is allowed to be much steeper than a suburban street,
     which is what lets it climb a pass instead of boring straight through
     the middle of it. */
  const gradeAt = (x, z) => 0.078 + 0.055 * fieldAt(F_MOUNTAIN, x, z);
  const gradeX = new Float64Array(GRID * (GRID + 1));
  const gradeZ = new Float64Array((GRID + 1) * GRID);
  for (let i = 0; i < GRID; i += 1) {
    for (let j = 0; j <= GRID; j += 1) {
      gradeX[i * (GRID + 1) + j] = gradeAt((LX[i] + LX[i + 1]) / 2, LZ[j]);
    }
  }
  for (let i = 0; i <= GRID; i += 1) {
    for (let j = 0; j < GRID; j += 1) {
      gradeZ[i * GRID + j] = gradeAt(LX[i], (LZ[j] + LZ[j + 1]) / 2);
    }
  }
  /* Resolve a too-steep leg mostly by cutting the high end down rather than
     filling the low end up. Filling propagates a mountain's height right
     across the flat country, which leaves every road out there running on
     an embankment ten metres above its own fields. */
  const DOWN = 0.78, UP = 0.22;
  for (let pass = 0; pass < 80; pass += 1) {
    let worst = 0;
    for (let i = 0; i <= GRID; i += 1) {
      for (let j = 0; j <= GRID; j += 1) {
        const a = nk(i, j);
        if (i < GRID) {
          const b = nk(i + 1, j);
          const span = LX[i + 1] - LX[i];
          const over = Math.abs(NH[b] - NH[a]) - span * gradeX[i * (GRID + 1) + j];
          if (over > 0) {
            const hiK = NH[b] > NH[a] ? b : a;
            const loK = hiK === b ? a : b;
            NH[hiK] -= over * DOWN; NH[loK] += over * UP;
            if (over > worst) worst = over;
          }
        }
        if (j < GRID) {
          const b = nk(i, j + 1);
          const span = LZ[j + 1] - LZ[j];
          const over = Math.abs(NH[b] - NH[a]) - span * gradeZ[i * GRID + j];
          if (over > 0) {
            const hiK = NH[b] > NH[a] ? b : a;
            const loK = hiK === b ? a : b;
            NH[hiK] -= over * DOWN; NH[loK] += over * UP;
            if (over > worst) worst = over;
          }
        }
      }
    }
    for (let i = 0; i <= GRID; i += 1) {
      for (let j = 0; j <= GRID; j += 1) {
        if (NH[nk(i, j)] < WATER_Y + 8.5) NH[nk(i, j)] = WATER_Y + 8.5;
      }
    }
    if (worst < 0.02) break;
  }
})();

export const nodeHeight = (i, j) => NH[nk(clamp(i, 0, GRID), clamp(j, 0, GRID))];

/* ------------------------- the road profile -------------------------
 *
 * Node heights are joined with a monotone cubic, not a smoothstep.
 *
 * A smoothstep leaves every junction a flat spot with zero slope, so a
 * road of constant gradient came out as a chain of humps: level at each
 * node, steepest in the middle of every span. Worse, the peak slope of a
 * smootherstep is 1.875x the average, which turned a legal 13% leg into a
 * 24% wall the bus could not climb.
 *
 * A cubic with limited central-difference tangents runs dead straight
 * through a constant-grade sequence, keeps the slope continuous across
 * junctions, and never overshoots the nodes it passes through.
 * ------------------------------------------------------------------ */
const MZ = new Float64Array((GRID + 1) * (GRID + 1));
const MX = new Float64Array((GRID + 1) * (GRID + 1));

function limitedTangent(sPrev, sNext) {
  if (sPrev === null) return sNext === null ? 0 : sNext;
  if (sNext === null) return sPrev;
  if (sPrev * sNext <= 0) return 0;           // a crest or a dip: level it
  const m = (sPrev + sNext) / 2;
  const lim = 1.2 * Math.min(Math.abs(sPrev), Math.abs(sNext));
  return Math.sign(m) * Math.min(Math.abs(m), lim);
}

(function buildTangents() {
  for (let i = 0; i <= GRID; i += 1) {
    for (let j = 0; j <= GRID; j += 1) {
      MZ[nk(i, j)] = limitedTangent(
        j > 0 ? (NH[nk(i, j)] - NH[nk(i, j - 1)]) / (LZ[j] - LZ[j - 1]) : null,
        j < GRID ? (NH[nk(i, j + 1)] - NH[nk(i, j)]) / (LZ[j + 1] - LZ[j]) : null,
      );
      MX[nk(i, j)] = limitedTangent(
        i > 0 ? (NH[nk(i, j)] - NH[nk(i - 1, j)]) / (LX[i] - LX[i - 1]) : null,
        i < GRID ? (NH[nk(i + 1, j)] - NH[nk(i, j)]) / (LX[i + 1] - LX[i]) : null,
      );
    }
  }
})();

function hermite(h0, h1, m0, m1, span, t) {
  const t2 = t * t, t3 = t2 * t;
  return h0 * (2 * t3 - 3 * t2 + 1)
    + m0 * span * (t3 - 2 * t2 + t)
    + h1 * (-2 * t3 + 3 * t2)
    + m1 * span * (t3 - t2);
}

function vertRoadH(i, z) {
  let j = 0;
  while (j < GRID - 1 && z >= LZ[j + 1]) j += 1;
  const span = LZ[j + 1] - LZ[j];
  const t = clamp((z - LZ[j]) / span, 0, 1);
  return hermite(NH[nk(i, j)], NH[nk(i, j + 1)], MZ[nk(i, j)], MZ[nk(i, j + 1)], span, t);
}
function horzRoadH(j, x) {
  let i = 0;
  while (i < GRID - 1 && x >= LX[i + 1]) i += 1;
  const span = LX[i + 1] - LX[i];
  const t = clamp((x - LX[i]) / span, 0, 1);
  return hermite(NH[nk(i, j)], NH[nk(i + 1, j)], MX[nk(i, j)], MX[nk(i + 1, j)], span, t);
}

/**
 * Height of the road surface at a point on (or near) the network.
 *
 * Off a junction this is simply the profile of the road you are on, which
 * is level across its width. Inside a junction the two profiles are
 * blended by how central you are to each — that warps the junction the way
 * a real one is warped, and, critically, the blend reaches zero exactly at
 * the edge of the box so the grade joins the approaching road cleanly.
 *
 * The old version faded the two together over a twelve-metre skirt that
 * extended well outside the junction. Because the crossing road's height
 * is constant along your path, that fade injected a phantom gradient of up
 * to twenty per cent on the approach to every junction on a hill — enough
 * to stall the bus on a climb and to feel like a hump in the road.
 */
export function roadHeightAt(x, z) {
  const i = bandIndexX(x), j = bandIndexZ(z);
  const cv = vClass(i), ch = hClass(j);
  const dx = Math.abs(x - LX[i]);
  const dz = Math.abs(z - LZ[j]);
  const onV = dx <= cv.half;
  const onH = dz <= ch.half;
  if (onV && onH) {
    const wv = 1 - dx / cv.half;      // centrality to the north-south road
    const wh = 1 - dz / ch.half;      // centrality to the east-west road
    const hv = vertRoadH(i, z);
    const hh = horzRoadH(j, x);
    const sum = wv + wh;
    return sum < 1e-4 ? (hv + hh) / 2 : (hv * wv + hh * wh) / sum;
  }
  if (onV) return vertRoadH(i, z);
  if (onH) return horzRoadH(j, x);
  return dx - cv.half < dz - ch.half ? vertRoadH(i, z) : horzRoadH(j, x);
}

/** Height of the visible ground, which meets the road smoothly. */
export function groundHeightAt(x, z) {
  const t = terrainAt(x, z);
  const r = roadHeightAt(x, z);
  const diff = Math.abs(t - r);
  // where the terrain is far from the road (a hillside above a tunnel, a
  // gorge under a viaduct) it keeps its own shape
  const edge = roadEdgeDist(x, z);
  /* The gap term only applies once we are off the carriageway, or the
     ground would tear away from the tarmac it is supposed to be under. */
  const gap = smooth01((diff - 4.5) / 5) * smooth01((edge - 0.5) / 7);
  const w = Math.max(gap, smooth01((edge - 5) / 26));
  return lerp(r, t, w);
}

/**
 * Height a vehicle rides at. Deliberately *not* the terrain: a bus beside
 * the parapet of a viaduct must stay on the deck, not drop into the gorge
 * the terrain field says is underneath it.
 */
export function vehicleHeightAt(x, z) {
  const road = roadHeightAt(x, z);
  const edge = roadEdgeDist(x, z);
  if (edge <= 2) return road;
  const ground = groundHeightAt(x, z);
  if (ground < road - 1.5) return road;
  return lerp(road, ground, smooth01((edge - 2) / 12));
}

/** Uphill gradient in the direction of travel, as a slope (rise / run). */
export function slopeAlong(x, z, yaw) {
  const s = Math.sin(yaw), c = Math.cos(yaw);
  const h0 = roadHeightAt(x - s * 3, z - c * 3);
  const h1 = roadHeightAt(x + s * 3, z + c * 3);
  return (h1 - h0) / 6;
}

/* ------------------- tunnels, bridges and segment data ------------------- */

const SEG_V = [];    // [line i][span j]
const SEG_H = [];

function classifySegment(vertical, line, span) {
  const a = vertical ? LZ[span] : LX[span];
  const b = vertical ? LZ[span + 1] : LX[span + 1];
  const len = b - a;
  const N = 22;
  let bore = 0, air = 0, wet = 0;
  let t0 = 1, t1 = 0, b0 = 1, b1 = 0;
  for (let k = 1; k < N; k += 1) {
    const u = k / N;
    const v = a + len * u;
    const x = vertical ? LX[line] : v;
    const z = vertical ? v : LZ[line];
    const road = vertical ? vertRoadH(line, z) : horzRoadH(line, x);
    const ter = terrainAt(x, z);
    const over = ter - road;
    const under = road - ter;
    if (over > bore) bore = over;
    if (under > air) air = under;
    if (ter < WATER_Y) wet += 1;
    if (over > 5.5) { if (u < t0) t0 = u; if (u > t1) t1 = u; }
    if (under > 5 || ter < WATER_Y) { if (u < b0) b0 = u; if (u > b1) b1 = u; }
  }
  const cls = vertical ? vClass(line) : hClass(line);
  const seg = {
    vertical, line, span, a, b, len,
    tunnel: null, bridge: null,
    cls, highway: (vertical ? VCLASS[line] : HCLASS[line]) === HIGHWAY,
    region: vertical
      ? cellRegion(line, span)
      : cellRegion(span, line),
  };
  /* A short pinch of rock above the road is a cutting, not a tunnel, and a
     road a few metres proud of a dip is an embankment, not a viaduct. Both
     need real length as well as real depth before they earn the structure. */
  if (bore > 19 && (t1 - t0) * len > 38) {
    seg.tunnel = {
      u0: Math.max(0.04, t0 - 0.06), u1: Math.min(0.96, t1 + 0.06), depth: bore,
    };
  }
  if (((air > 15 && (b1 - b0) * len > 30) || wet >= 2) && b1 > b0) {
    seg.bridge = {
      u0: Math.max(0.02, b0 - 0.05), u1: Math.min(0.98, b1 + 0.05), drop: air,
    };
  }
  return seg;
}

for (let i = 0; i <= GRID; i += 1) {
  SEG_V[i] = [];
  for (let j = 0; j < GRID; j += 1) SEG_V[i][j] = classifySegment(true, i, j);
}
for (let j = 0; j <= GRID; j += 1) {
  SEG_H[j] = [];
  for (let i = 0; i < GRID; i += 1) SEG_H[j][i] = classifySegment(false, j, i);
}

export const segV = (i, j) => SEG_V[clamp(i, 0, GRID)][clamp(j, 0, GRID - 1)];
export const segH = (j, i) => SEG_H[clamp(j, 0, GRID)][clamp(i, 0, GRID - 1)];

/** The road segment a point is on, or null when it is at a junction. */
export function segmentAt(x, z) {
  const i = bandIndexX(x), j = bandIndexZ(z);
  const dx = Math.abs(x - LX[i]), dz = Math.abs(z - LZ[j]);
  if (dx <= vClass(i).half && dz > hClass(j).half) {
    const sj = clamp(cellIndexZ(z), 0, GRID - 1);
    return SEG_V[i][sj];
  }
  if (dz <= hClass(j).half) {
    const si = clamp(cellIndexX(x), 0, GRID - 1);
    return SEG_H[j][si];
  }
  return null;
}

/** How enclosed a point is: 0 open sky, 1 deep inside a tunnel. */
export function tunnelDepthAt(x, z) {
  const seg = segmentAt(x, z);
  if (!seg || !seg.tunnel) return 0;
  const v = seg.vertical ? z : x;
  const u = (v - seg.a) / seg.len;
  const { u0, u1 } = seg.tunnel;
  if (u <= u0 || u >= u1) return 0;
  const edge = Math.min(u - u0, u1 - u) * seg.len;
  return smooth01(edge / 16);
}

export function onBridgeAt(x, z) {
  const seg = segmentAt(x, z);
  if (!seg || !seg.bridge) return false;
  const v = seg.vertical ? z : x;
  const u = (v - seg.a) / seg.len;
  return u > seg.bridge.u0 && u < seg.bridge.u1;
}

/* ---------------------- route planning over the grid ---------------------- */

const nodeKey = (i, j) => i * 100 + j;

/** Breadth-first path between two intersections, returned as node pairs. */
export function findPath(from, to) {
  if (from.i === to.i && from.j === to.j) return [{ ...from }];
  const start = nodeKey(from.i, from.j);
  const goal = nodeKey(to.i, to.j);
  const prev = new Map([[start, -1]]);
  const queue = [start];
  let head = 0;

  while (head < queue.length) {
    const cur = queue[head]; head += 1;
    if (cur === goal) break;
    const i = Math.floor(cur / 100);
    const j = cur % 100;
    const nbrs = [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]];
    // bias toward the goal so paths look sensible, not maze-like
    nbrs.sort(
      (a, b) =>
        (Math.abs(a[0] - to.i) + Math.abs(a[1] - to.j)) -
        (Math.abs(b[0] - to.i) + Math.abs(b[1] - to.j)),
    );
    for (const [ni, nj] of nbrs) {
      if (ni < 0 || nj < 0 || ni > GRID || nj > GRID) continue;
      const k = nodeKey(ni, nj);
      if (prev.has(k)) continue;
      prev.set(k, cur);
      queue.push(k);
    }
  }

  if (!prev.has(goal)) return [{ ...from }];
  const out = [];
  let cur = goal;
  while (cur !== -1) {
    out.push({ i: Math.floor(cur / 100), j: cur % 100 });
    cur = prev.get(cur);
  }
  return out.reverse();
}

/** Nearest intersection node to a world position. */
export function nearestNode(x, z) {
  return { i: bandIndexX(x), j: bandIndexZ(z) };
}

/* ------------------------- traffic light state ------------------------- */

const LIGHT_AT = new Int16Array((GRID + 1) * (GRID + 1)).fill(-1);

export function makeLights(rng) {
  const lights = [];
  LIGHT_AT.fill(-1);
  for (let i = 0; i <= GRID; i += 1) {
    for (let j = 0; j <= GRID; j += 1) {
      // a signal head only where at least three of the four surrounding
      // cells are built up — country crossroads are give-way
      let urban = 0;
      for (const [a, b] of [[i - 1, j - 1], [i, j - 1], [i - 1, j], [i, j]]) {
        if (a < 0 || b < 0 || a >= GRID || b >= GRID) continue;
        if (REGION[cellRegion(a, b)].lights) urban += 1;
      }
      if (urban < 3) continue;
      LIGHT_AT[nk(i, j)] = lights.length;
      lights.push({
        i, j,
        x: LX[i], z: LZ[j],
        y: NH[nk(i, j)],
        // phase 0: north-south green. phase 1: NS amber.
        // phase 2: east-west green. phase 3: EW amber.
        t: rng() * 26,
        cycle: [14 + rng() * 6, 3, 14 + rng() * 6, 3],
        phase: Math.floor(rng() * 4),
      });
    }
  }
  return lights;
}

/** The signal at an intersection, or null where the junction is unlit. */
export function lightAt(lights, i, j) {
  if (i < 0 || j < 0 || i > GRID || j > GRID) return null;
  const k = LIGHT_AT[nk(i, j)];
  return k < 0 ? null : lights[k];
}

/** 'green' | 'amber' | 'red' for a vehicle travelling along the given axis. */
export function lightFor(light, vertical) {
  const p = light.phase;
  if (vertical) {
    if (p === 0) return "green";
    if (p === 1) return "amber";
    return "red";
  }
  if (p === 2) return "green";
  if (p === 3) return "amber";
  return "red";
}

export function stepLights(lights, dt) {
  for (const l of lights) {
    l.t += dt;
    const dur = l.cycle[l.phase];
    if (l.t >= dur) {
      l.t -= dur;
      l.phase = (l.phase + 1) % 4;
    }
  }
}

/* ---------------------------- scenery palettes ---------------------------- */

const FACADES = [
  { wall: "#8d9bb0", trim: "#6d7b90", glass: "#22405f" },
  { wall: "#b9a58e", trim: "#95826c", glass: "#2a4a63" },
  { wall: "#a8b3a0", trim: "#87927f", glass: "#1f3d54" },
  { wall: "#c2a99b", trim: "#9c8477", glass: "#2d4a66" },
  { wall: "#94a4b8", trim: "#748498", glass: "#1b3a58" },
  { wall: "#cbb894", trim: "#a49470", glass: "#274661" },
  { wall: "#9f8f9e", trim: "#7d6f7d", glass: "#243f5c" },
  { wall: "#7f93a3", trim: "#647787", glass: "#1d3b56" },
];
const ROOFS = ["#4a5262", "#565f6d", "#3f4855", "#5d6472"];
const HOUSE_WALL = ["#d8cbb4", "#c9b89c", "#e0d5c0", "#bfae94", "#d2c0a4", "#cdd2c6"];
const HOUSE_ROOF = ["#8c4a35", "#7a4331", "#95563d", "#6c5648", "#a05a3f"];
const SHOP_WALL = ["#e2d7c2", "#d6c6ae", "#cfd8d2", "#e6cfb6"];
const AWNING = ["#c0392b", "#2c6fb5", "#27865c", "#d9a441", "#8e44ad"];
const CROPS = ["#b9a54c", "#94a648", "#7d9a3f", "#c2b25a", "#6f8f3c", "#a89a4a"];
const LEAF_BROAD = ["#2f7a41", "#37894a", "#3f9152", "#2a6d3a", "#468f4f"];
const LEAF_PINE = ["#25603a", "#2c6b41", "#1f5433", "#2f7247"];

/* ------------------------------ generation ------------------------------ */

/* Everything is bucketed by cell so the draw loop only walks the handful
   of cells near the camera instead of the whole world. */
function makeBuckets() {
  const b = new Array(GRID * GRID);
  for (let k = 0; k < b.length; k += 1) b[k] = [];
  return b;
}

function pushProp(buckets, p) {
  const i = cellIndexX(p.x), j = cellIndexZ(p.z);
  buckets[i * GRID + j].push(p);
}

function cellInner(i, j) {
  const cvL = vClass(i), cvR = vClass(i + 1);
  const chB = hClass(j), chT = hClass(j + 1);
  return {
    x0: LX[i] + cvL.half + cvL.pave,
    x1: LX[i + 1] - cvR.half - cvR.pave,
    z0: LZ[j] + chB.half + chB.pave,
    z1: LZ[j + 1] - chT.half - chT.pave,
  };
}

function addTree(buckets, rng, x, z, pine, scale = 1) {
  const y = groundHeightAt(x, z);
  if (y < WATER_Y + 0.5) return;
  const h = (pine ? 9 + rng() * 9 : 6.5 + rng() * 6) * scale;
  pushProp(buckets, {
    kind: pine ? "pine" : "tree",
    x, z, y, h,
    w: (pine ? 3.2 + rng() * 1.8 : 4.2 + rng() * 2.6) * scale,
    leaf: pine
      ? LEAF_PINE[Math.floor(rng() * LEAF_PINE.length)]
      : LEAF_BROAD[Math.floor(rng() * LEAF_BROAD.length)],
    r: 5 * scale,
  });
}

function fillCity(buckets, rng, i, j) {
  const { x0, x1, z0, z1 } = cellInner(i, j);
  const spanX = x1 - x0, spanZ = z1 - z0;
  if (spanX < 10 || spanZ < 10) return;

  if (rng() < 0.12) {
    const y = groundHeightAt((x0 + x1) / 2, (z0 + z1) / 2);
    pushProp(buckets, {
      kind: "park", x: (x0 + x1) / 2, z: (z0 + z1) / 2, y,
      w: spanX, d: spanZ, r: Math.max(spanX, spanZ) * 0.6, wall: "#3f6b46",
    });
    const trees = 4 + Math.floor(rng() * 5);
    for (let t = 0; t < trees; t += 1) {
      addTree(buckets, rng, x0 + 4 + rng() * (spanX - 8), z0 + 4 + rng() * (spanZ - 8), false);
    }
    return;
  }

  const cols = spanX > 78 ? 2 : 1;
  const rows = spanZ > 78 ? 2 : 1;
  const cw = spanX / cols, cd = spanZ / rows;
  for (let c = 0; c < cols; c += 1) {
    for (let rr = 0; rr < rows; rr += 1) {
      const pad = 1.4 + rng() * 3.2;
      const w = cw - pad * 2, d = cd - pad * 2;
      if (w < 8 || d < 8) continue;
      const tall = rng();
      const h = tall > 0.88 ? 42 + rng() * 22 : tall > 0.6 ? 25 + rng() * 15 : 10 + rng() * 12;
      const pal = FACADES[Math.floor(rng() * FACADES.length)];
      const x = x0 + c * cw + cw / 2, z = z0 + rr * cd + cd / 2;
      pushProp(buckets, {
        kind: "tower", x, z, y: groundHeightAt(x, z), w, d, h,
        wall: pal.wall, trim: pal.trim, glass: pal.glass,
        roof: ROOFS[Math.floor(rng() * ROOFS.length)],
        floors: Math.max(2, Math.round(h / 3.6)),
        r: Math.max(w, d) * 0.75 + h * 0.2,
      });
    }
  }
}

function fillHouses(buckets, rng, i, j, density, shops) {
  const { x0, x1, z0, z1 } = cellInner(i, j);
  const spanX = x1 - x0, spanZ = z1 - z0;
  if (spanX < 14 || spanZ < 14) return;
  // houses face the roads, so lay them in a ring around the plot edge
  const per = Math.max(1, Math.round((spanX + spanZ) / 46 * density));
  for (let k = 0; k < per * 2; k += 1) {
    const edge = k % 4;
    const t = 0.1 + rng() * 0.8;
    let x, z, yaw;
    if (edge === 0) { x = x0 + spanX * t; z = z0 + 7 + rng() * 5; yaw = Math.PI; }
    else if (edge === 1) { x = x0 + spanX * t; z = z1 - 7 - rng() * 5; yaw = 0; }
    else if (edge === 2) { x = x0 + 7 + rng() * 5; z = z0 + spanZ * t; yaw = Math.PI / 2; }
    else { x = x1 - 7 - rng() * 5; z = z0 + spanZ * t; yaw = -Math.PI / 2; }
    if (x < x0 + 3 || x > x1 - 3 || z < z0 + 3 || z > z1 - 3) continue;
    const y = groundHeightAt(x, z);
    if (y < WATER_Y + 1) continue;
    const isShop = shops && rng() < 0.42;
    const w = isShop ? 9 + rng() * 5 : 8 + rng() * 4;
    const d = isShop ? 8 + rng() * 4 : 7.5 + rng() * 3.5;
    pushProp(buckets, {
      kind: isShop ? "shop" : "house",
      x, z, y, yaw, w, d,
      h: isShop ? 4.4 + rng() * 2.6 : 3.4 + rng() * 2.6,
      wall: isShop
        ? SHOP_WALL[Math.floor(rng() * SHOP_WALL.length)]
        : HOUSE_WALL[Math.floor(rng() * HOUSE_WALL.length)],
      roof: HOUSE_ROOF[Math.floor(rng() * HOUSE_ROOF.length)],
      awning: AWNING[Math.floor(rng() * AWNING.length)],
      r: 9,
    });
    if (!isShop && rng() < 0.55) {
      addTree(buckets, rng, x + (rng() - 0.5) * 14, z + (rng() - 0.5) * 14, rng() < 0.3, 0.85);
    }
  }
}

function fillCountry(buckets, rng, i, j) {
  const { x0, x1, z0, z1 } = cellInner(i, j);
  const spanX = x1 - x0, spanZ = z1 - z0;
  if (spanX < 20 || spanZ < 20) return;

  // crop fields laid out as a couple of big patches
  const patches = 2 + Math.floor(rng() * 3);
  for (let p = 0; p < patches; p += 1) {
    const w = spanX * (0.34 + rng() * 0.3);
    const d = spanZ * (0.3 + rng() * 0.32);
    const x = x0 + w / 2 + rng() * (spanX - w);
    const z = z0 + d / 2 + rng() * (spanZ - d);
    const y = groundHeightAt(x, z);
    if (y < WATER_Y + 1) continue;
    pushProp(buckets, {
      kind: "field", x, z, y, w, d,
      wall: CROPS[Math.floor(rng() * CROPS.length)],
      r: Math.max(w, d) * 0.6,
    });
  }
  if (rng() < 0.5) {
    const x = x0 + 14 + rng() * (spanX - 28);
    const z = z0 + 14 + rng() * (spanZ - 28);
    const y = groundHeightAt(x, z);
    if (y > WATER_Y + 1) {
      pushProp(buckets, {
        kind: "farm", x, z, y, yaw: rng() * Math.PI,
        w: 13 + rng() * 6, d: 9 + rng() * 4, h: 6.5 + rng() * 2.5,
        wall: rng() < 0.5 ? "#9c5b3f" : "#7d6a55", roof: "#4c525a", r: 14,
      });
    }
  }
  const trees = Math.round(2 + rng() * 5);
  for (let t = 0; t < trees; t += 1) {
    addTree(buckets, rng, x0 + rng() * spanX, z0 + rng() * spanZ, rng() < 0.25);
  }
}

function fillForest(buckets, rng, i, j) {
  const { x0, x1, z0, z1 } = cellInner(i, j);
  const spanX = x1 - x0, spanZ = z1 - z0;
  if (spanX < 12 || spanZ < 12) return;
  const n = Math.round((spanX * spanZ) / 340);
  for (let t = 0; t < Math.min(90, n); t += 1) {
    addTree(buckets, rng, x0 + rng() * spanX, z0 + rng() * spanZ, rng() < 0.7);
  }
}

function fillMountain(buckets, rng, i, j) {
  const { x0, x1, z0, z1 } = cellInner(i, j);
  const spanX = x1 - x0, spanZ = z1 - z0;
  if (spanX < 12 || spanZ < 12) return;
  const rocks = Math.round((spanX * spanZ) / 1500);
  for (let k = 0; k < Math.min(26, rocks); k += 1) {
    const x = x0 + rng() * spanX, z = z0 + rng() * spanZ;
    const y = groundHeightAt(x, z);
    pushProp(buckets, {
      kind: "rock", x, z, y,
      w: 4 + rng() * 11, d: 4 + rng() * 11, h: 3 + rng() * 12,
      yaw: rng() * Math.PI,
      wall: rng() < 0.5 ? "#7a7466" : "#6b6a63", r: 12,
    });
  }
  const trees = Math.round((spanX * spanZ) / 2600);
  for (let t = 0; t < Math.min(22, trees); t += 1) {
    const x = x0 + rng() * spanX, z = z0 + rng() * spanZ;
    if (terrainAt(x, z) > 88) continue;      // above the tree line
    addTree(buckets, rng, x, z, true, 0.85);
  }
}

function fillCoast(buckets, rng, i, j) {
  const { x0, x1, z0, z1 } = cellInner(i, j);
  const spanX = x1 - x0, spanZ = z1 - z0;
  if (spanX < 12 || spanZ < 12) return;
  const n = Math.round((spanX * spanZ) / 2200);
  for (let k = 0; k < Math.min(18, n); k += 1) {
    const x = x0 + rng() * spanX, z = z0 + rng() * spanZ;
    const y = groundHeightAt(x, z);
    if (y < WATER_Y + 0.5) continue;
    if (rng() < 0.45) {
      pushProp(buckets, {
        kind: "rock", x, z, y, w: 3 + rng() * 6, d: 3 + rng() * 6, h: 1.6 + rng() * 3.4,
        yaw: rng() * Math.PI, wall: "#8e8873", r: 7,
      });
    } else {
      addTree(buckets, rng, x, z, false, 0.7);
    }
  }
  if (rng() < 0.35) {
    const x = x0 + 12 + rng() * Math.max(1, spanX - 24);
    const z = z0 + 12 + rng() * Math.max(1, spanZ - 24);
    const y = groundHeightAt(x, z);
    if (y > WATER_Y + 1) {
      pushProp(buckets, {
        kind: "house", x, z, y, yaw: rng() * Math.PI, w: 8, d: 7, h: 3.6,
        wall: "#e8e2d2", roof: "#3f6f86", awning: "#2c6fb5", r: 9,
      });
    }
  }
}

function fillAirport(buckets, rng, i, j) {
  const { x0, x1, z0, z1 } = cellInner(i, j);
  const spanX = x1 - x0, spanZ = z1 - z0;
  if (spanX < 26 || spanZ < 26) return;
  const roll = rng();
  const cxp = (x0 + x1) / 2, czp = (z0 + z1) / 2;
  const y = groundHeightAt(cxp, czp);
  if (roll < 0.34) {
    pushProp(buckets, {
      kind: "terminal", x: cxp, z: czp, y,
      w: spanX * 0.72, d: spanZ * 0.4, h: 15 + rng() * 8,
      wall: "#c3cad2", glass: "#33566f", roof: "#8f979f",
      r: Math.max(spanX, spanZ) * 0.5,
    });
  } else if (roll < 0.62) {
    pushProp(buckets, {
      kind: "hangar", x: cxp, z: czp, y, yaw: rng() < 0.5 ? 0 : Math.PI / 2,
      w: spanX * 0.5, d: spanZ * 0.34, h: 12 + rng() * 5,
      wall: "#9aa3ab", roof: "#7c858d", r: Math.max(spanX, spanZ) * 0.4,
    });
  } else {
    pushProp(buckets, {
      kind: "apron", x: cxp, z: czp, y,
      w: spanX * 0.86, d: spanZ * 0.8, wall: "#8b8f92",
      r: Math.max(spanX, spanZ) * 0.6,
    });
    if (rng() < 0.5) {
      pushProp(buckets, {
        kind: "plane", x: cxp, z: czp, y, yaw: rng() * Math.PI * 2,
        w: 26 + rng() * 12, h: 7, r: 24,
      });
    }
  }
}

function makeScenery(rng) {
  const buckets = makeBuckets();
  for (let i = 0; i < GRID; i += 1) {
    for (let j = 0; j < GRID; j += 1) {
      switch (CELL_REGION[i * GRID + j]) {
        case CITY: fillCity(buckets, rng, i, j); break;
        case SUBURB: fillHouses(buckets, rng, i, j, 1, false); break;
        case TOWN: fillHouses(buckets, rng, i, j, 1.25, true); break;
        case COUNTRY: fillCountry(buckets, rng, i, j); break;
        case FOREST: fillForest(buckets, rng, i, j); break;
        case MOUNTAIN: fillMountain(buckets, rng, i, j); break;
        case COAST: fillCoast(buckets, rng, i, j); break;
        case AIRPORT: fillAirport(buckets, rng, i, j); break;
        default: break;
      }
    }
  }
  return buckets;
}

/* --------------------------- roadside furniture --------------------------- */

function makeStreetProps(rng) {
  const buckets = makeBuckets();
  const add = (p) => pushProp(buckets, p);

  for (let i = 0; i <= GRID; i += 1) {
    const cls = vClass(i);
    for (let j = 0; j < GRID; j += 1) {
      const seg = SEG_V[i][j];
      const reg = REGION[cellRegion(i, j)];
      const lit = reg.lights;
      const step = lit ? 26 : 60;
      const off = cls.half + (lit ? 2.0 : 2.6);
      for (let v = LZ[j] + 18; v < LZ[j + 1] - 14; v += step) {
        const z = v + rng() * 8;
        const u = (z - seg.a) / seg.len;
        if (seg.tunnel && u > seg.tunnel.u0 - 0.02 && u < seg.tunnel.u1 + 0.02) continue;
        if (seg.bridge && u > seg.bridge.u0 - 0.02 && u < seg.bridge.u1 + 0.02) continue;
        const side = rng() < 0.5 ? -1 : 1;
        const x = LX[i] + side * off;
        const type = lit ? (rng() < 0.7 ? "lamp" : "tree") : (rng() < 0.22 ? "lamp" : "post");
        add({ kind: type, x, z, y: roadHeightAt(LX[i], z), r: 7, side });
      }
      // guardrails on mountain, coast, bridges and viaducts
      const needRail = seg.bridge
        || cellRegion(i, j) === MOUNTAIN || cellRegion(i, j) === COAST
        || cellRegion(Math.max(0, i - 1), j) === MOUNTAIN;
      if (needRail) {
        add({
          kind: "rail", vertical: true, line: i, a: seg.a + 6, b: seg.b - 6,
          off: cls.half + 1.1, x: LX[i], z: (seg.a + seg.b) / 2,
          r: seg.len * 0.55,
        });
      }
      if (seg.highway && j % 2 === 0) {
        const z = LZ[j] + seg.len * 0.5;
        add({
          kind: "sign", x: LX[i] + cls.half + 3.4, z, y: roadHeightAt(LX[i], z),
          yaw: 0, big: true, r: 9,
        });
      }
    }
  }

  for (let j = 0; j <= GRID; j += 1) {
    const cls = hClass(j);
    for (let i = 0; i < GRID; i += 1) {
      const seg = SEG_H[j][i];
      const reg = REGION[cellRegion(i, j)];
      const lit = reg.lights;
      const step = lit ? 26 : 60;
      const off = cls.half + (lit ? 2.0 : 2.6);
      for (let v = LX[i] + 18; v < LX[i + 1] - 14; v += step) {
        const x = v + rng() * 8;
        const u = (x - seg.a) / seg.len;
        if (seg.tunnel && u > seg.tunnel.u0 - 0.02 && u < seg.tunnel.u1 + 0.02) continue;
        if (seg.bridge && u > seg.bridge.u0 - 0.02 && u < seg.bridge.u1 + 0.02) continue;
        const side = rng() < 0.5 ? -1 : 1;
        const z = LZ[j] + side * off;
        const type = lit ? (rng() < 0.7 ? "lamp" : "tree") : (rng() < 0.22 ? "lamp" : "post");
        add({ kind: type, x, z, y: roadHeightAt(x, LZ[j]), r: 7, side });
      }
      const needRail = seg.bridge
        || cellRegion(i, j) === MOUNTAIN || cellRegion(i, j) === COAST
        || cellRegion(i, Math.max(0, j - 1)) === MOUNTAIN;
      if (needRail) {
        add({
          kind: "rail", vertical: false, line: j, a: seg.a + 6, b: seg.b - 6,
          off: cls.half + 1.1, x: (seg.a + seg.b) / 2, z: LZ[j],
          r: seg.len * 0.55,
        });
      }
      if (seg.highway && i % 2 === 0) {
        const x = LX[i] + seg.len * 0.5;
        add({
          kind: "sign", x, z: LZ[j] + cls.half + 3.4, y: roadHeightAt(x, LZ[j]),
          yaw: Math.PI / 2, big: true, r: 9,
        });
      }
    }
  }
  return buckets;
}

/* ------------------------------- bus stops ------------------------------- */

const STOP_NAMES = {
  city: [
    "Independence Arch", "Makola Lane", "Ridge Hospital", "Kwame Circle",
    "Adabraka", "Tema Station", "Osu Market", "Liberty Square",
  ],
  suburb: [
    "Labone Junction", "Cantonments Circle", "East Legon", "Airport Residential",
    "Dzorwulu Gardens", "Roman Ridge",
  ],
  town: [
    "Nsawam High Street", "Aburi Market", "Dodowa Square", "Oyibi Corner",
    "Mampong Clock Tower",
  ],
  country: [
    "Palm Grove Farm", "Kpone Crossroads", "Millet Fields", "Old Mill Lane",
    "Nyanyano Turn",
  ],
  forest: [
    "Atewa Forest Gate", "Cedar Hollow", "Kakum Trailhead", "Silverwood Bend",
  ],
  mountain: [
    "Akwapim Summit", "Eagle Rock Viewpoint", "Cloud Pass", "Quarry Bend",
  ],
  coast: [
    "Labadi Beach", "Lighthouse Point", "Fisherman's Cove", "Cliff Road",
  ],
  airport: [
    "Terminal 3 Arrivals", "Terminal 2 Departures", "Cargo Village", "Airport Junction",
  ],
};

/**
 * Bus stops sit on a road segment, on the right-hand kerb of the
 * direction the bus will be travelling when it arrives. Tunnels, bridges
 * and the fast lanes of a highway are excluded.
 */
function makeStopCandidates(rng) {
  const byRegion = {};
  for (const r of REGION) byRegion[r.key] = [];
  const names = {};
  for (const k of Object.keys(STOP_NAMES)) names[k] = STOP_NAMES[k].slice();
  const used = new Set();

  for (let attempt = 0; attempt < 6000; attempt += 1) {
    const vertical = rng() < 0.5;
    const line = Math.floor(rng() * (GRID + 1));
    const span = Math.floor(rng() * GRID);
    const cls = vertical ? vClass(line) : hClass(line);
    if (cls === ROAD_CLASS[HIGHWAY]) continue;
    const seg = vertical ? SEG_V[line][span] : SEG_H[line][span];
    if (seg.tunnel || seg.bridge) continue;
    const key = `${vertical ? "v" : "h"}${line}:${span}`;
    if (used.has(key)) continue;

    const t = 0.34 + rng() * 0.32;
    const along = seg.a + seg.len * t;
    const dir = rng() < 0.5 ? 1 : -1;
    const x = vertical ? LX[line] : along;
    const z = vertical ? along : LZ[line];
    const reg = REGION[regionAt(x, z)];
    const bucket = byRegion[reg.key];
    if (bucket.length >= 7) continue;

    /* Stops in the same district have to be a proper ride apart; two stops
       either side of a regional boundary only have to not be the same
       stop. */
    let tooClose = false;
    for (const key2 of Object.keys(byRegion)) {
      const min = key2 === reg.key ? 108 : 62;
      for (const s of byRegion[key2]) {
        if (Math.hypot(s.nodeX - x, s.nodeZ - z) < min) { tooClose = true; break; }
      }
      if (tooClose) break;
    }
    if (tooClose) continue;
    used.add(key);

    const heading = vertical ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    const rx = Math.cos(heading);
    const rz = -Math.sin(heading);
    const lane = cls.lanes[0];
    const bayX = x + rx * lane;
    const bayZ = z + rz * lane;
    const shelterX = x + rx * (cls.half + 1.9);
    const shelterZ = z + rz * (cls.half + 1.9);
    const pool = names[reg.key];
    const name = pool && pool.length
      ? pool.splice(Math.floor(rng() * pool.length), 1)[0]
      : `${reg.name} ${bucket.length + 1}`;

    bucket.push({
      name,
      region: reg.id, regionKey: reg.key, regionName: reg.name,
      x: bayX, z: bayZ,
      y: roadHeightAt(bayX, bayZ),
      nodeX: x, nodeZ: z,
      shelterX, shelterZ,
      shelterY: roadHeightAt(shelterX, shelterZ),
      heading, vertical, line, seg: span, dir,
      approach: vertical
        ? { i: line, j: dir > 0 ? span : span + 1 }
        : { i: dir > 0 ? span : span + 1, j: line },
      shelterSize: cls.half,
    });
  }
  return byRegion;
}

/* Route templates: each is a chain of regions, so a shift reads as a
   journey across the map rather than laps of one district. */
export const ROUTES = [
  {
    id: "circular", name: "City Circular", number: "12",
    regions: ["city", "city", "suburb", "town", "suburb", "city", "city", "suburb"],
  },
  {
    id: "airport", name: "Airport Express", number: "A1",
    regions: ["city", "city", "suburb", "airport", "airport", "airport", "suburb", "city"],
  },
  {
    id: "coast", name: "Coast Road Service", number: "7",
    regions: ["city", "suburb", "coast", "coast", "coast", "town", "town", "suburb"],
  },
  {
    id: "highland", name: "Highland Line", number: "44",
    regions: ["city", "suburb", "country", "forest", "mountain", "mountain", "forest", "town"],
  },
  {
    id: "country", name: "Country Service", number: "23",
    regions: ["city", "city", "suburb", "country", "country", "country", "town", "suburb"],
  },
];

/* When a district has run out of stops, borrow from somewhere that at
   least belongs on the same kind of road. */
const NEIGHBOURS = {
  city: ["suburb", "town", "airport", "country"],
  suburb: ["town", "city", "country", "airport"],
  town: ["suburb", "country", "city", "coast"],
  country: ["suburb", "town", "forest", "coast"],
  forest: ["mountain", "country", "town", "suburb"],
  mountain: ["forest", "country", "town", "suburb"],
  coast: ["town", "country", "suburb", "city"],
  airport: ["suburb", "city", "country", "town"],
};

function buildRoute(rng, candidates, template) {
  const pool = {};
  for (const k of Object.keys(candidates)) pool[k] = candidates[k].slice();
  const stops = [];
  let prev = null;
  for (const want of template.regions) {
    let list = pool[want];
    if (!list || !list.length) {
      const near = (NEIGHBOURS[want] || []).find((k) => pool[k] && pool[k].length);
      const alt = near || Object.keys(pool).find((k) => pool[k].length);
      if (!alt) break;
      list = pool[alt];
    }
    let bestK = 0;
    if (prev) {
      let bd = Infinity;
      for (let k = 0; k < list.length; k += 1) {
        const d = Math.hypot(list[k].nodeX - prev.nodeX, list[k].nodeZ - prev.nodeZ);
        if (d < bd) { bd = d; bestK = k; }
      }
    } else {
      bestK = Math.floor(rng() * list.length);
    }
    const pick = list.splice(bestK, 1)[0];
    pick.id = stops.length;
    stops.push(pick);
    prev = pick;
  }
  return stops;
}

/* ------------------------------- the world ------------------------------- */

export function makeCity(seed = 7, routeId = null) {
  const rng = mulberry32(seed >>> 0);
  const scenery = makeScenery(rng);
  const props = makeStreetProps(rng);
  const candidates = makeStopCandidates(rng);
  const template = routeId
    ? ROUTES.find((r) => r.id === routeId) || ROUTES[0]
    : ROUTES[Math.floor(rng() * ROUTES.length)];
  const stops = buildRoute(rng, candidates, template);
  const lights = makeLights(rng);
  return {
    seed, scenery, props, stops, lights, rng,
    route: template,
    regionsVisited: [...new Set(stops.map((s) => s.regionKey))],
  };
}

/** Props and scenery in the cells around a point, for the draw loop. */
export function cellsAround(x, z, radius, out) {
  out.length = 0;
  const i0 = cellIndexX(x - radius), i1 = cellIndexX(x + radius);
  const j0 = cellIndexZ(z - radius), j1 = cellIndexZ(z + radius);
  for (let i = i0; i <= i1; i += 1) {
    for (let j = j0; j <= j1; j += 1) out.push(i * GRID + j);
  }
  return out;
}

/** Nearest valid on-road position to a point, used by save restore. */
export function nearestRoadPose(x, z, yaw) {
  const i = bandIndexX(x), j = bandIndexZ(z);
  const cv = vClass(i), ch = hClass(j);
  const dx = x - LX[i], dz = z - LZ[j];
  const useVertical = Math.abs(dx) - cv.half <= Math.abs(dz) - ch.half;
  if (useVertical) {
    const north = Math.cos(yaw) >= 0;
    return {
      x: LX[i] + (north ? cv.lanes[0] : -cv.lanes[0]),
      z: clamp(z, LZ[0] + 6, LZ[GRID] - 6),
      yaw: north ? 0 : Math.PI,
    };
  }
  const east = Math.sin(yaw) >= 0;
  return {
    x: clamp(x, LX[0] + 6, LX[GRID] - 6),
    z: LZ[j] + (east ? -ch.lanes[0] : ch.lanes[0]),
    yaw: east ? Math.PI / 2 : -Math.PI / 2,
  };
}
