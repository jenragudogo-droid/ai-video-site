/* ------------------------------------------------------------------ *
 * City Bus Simulator — world generation.
 *
 * The city is a regular grid, which buys us three things for free:
 * an analytic "am I on the road?" test, trivial collision push-out,
 * and cheap route planning over intersection nodes. Everything here
 * is deterministic from a seed so a route always looks the same.
 *
 * Axes: x = east, z = north, y = up. Ghana drives on the right, so
 * the bus is left-hand drive and traffic keeps to the right lane.
 * ------------------------------------------------------------------ */

export const BLOCK = 78;        // spacing between road centrelines
export const GRID = 6;          // 6 x 6 blocks -> 7 x 7 intersections
export const ROAD_HALF = 8.4;   // asphalt half-width
export const PAVE_W = 3.8;      // pavement (sidewalk) width
export const LANE = 4.2;        // lane centre offset from the centreline
export const KERB = ROAD_HALF + PAVE_W;
export const CITY_SPAN = GRID * BLOCK;

export const SURFACE_ROAD = 0;
export const SURFACE_PAVE = 1;
export const SURFACE_BLOCK = 2;

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

/** Distance from a coordinate to the nearest road centreline. */
export function bandDist(v) {
  const k = clamp(Math.round(v / BLOCK), 0, GRID);
  return Math.abs(v - k * BLOCK);
}

/** Index of the nearest road centreline. */
export function bandIndex(v) {
  return clamp(Math.round(v / BLOCK), 0, GRID);
}

/** What is under this point: asphalt, pavement or a solid block? */
export function surfaceAt(x, z) {
  const dx = bandDist(x);
  const dz = bandDist(z);
  if (dx <= ROAD_HALF || dz <= ROAD_HALF) return SURFACE_ROAD;
  if (dx <= KERB || dz <= KERB) return SURFACE_PAVE;
  return SURFACE_BLOCK;
}

/**
 * Smallest translation that pushes a blocked point back onto tarmac.
 * Grid alignment means we only ever have to resolve on one axis.
 */
export function pushOut(x, z, margin = ROAD_HALF) {
  const kx = clamp(Math.round(x / BLOCK), 0, GRID) * BLOCK;
  const kz = clamp(Math.round(z / BLOCK), 0, GRID) * BLOCK;
  const dx = Math.abs(x - kx);
  const dz = Math.abs(z - kz);
  const ex = dx - margin;
  const ez = dz - margin;
  if (ex <= 0 || ez <= 0) return null;      // already on a road band
  if (ex < ez) return { dx: (x > kx ? -ex : ex), dz: 0 };
  return { dx: 0, dz: (z > kz ? -ez : ez) };
}

/* ---------------------------- palettes ---------------------------- */

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

const STOP_NAMES = [
  "Independence Arch", "Osu Market", "Ridge Hospital", "Labone Junction",
  "Cantonments Circle", "Airport Residential", "Kaneshie Station", "Adabraka",
  "Legon Gate", "Tema Station", "Makola Lane", "Kwame Circle",
  "Achimota Mall", "Dansoman Loop", "Spintex Road", "East Legon",
];

/* --------------------------- generation --------------------------- */

function makeBuildings(rng) {
  const list = [];
  for (let i = 0; i < GRID; i += 1) {
    for (let j = 0; j < GRID; j += 1) {
      const x0 = i * BLOCK + KERB;
      const x1 = (i + 1) * BLOCK - KERB;
      const z0 = j * BLOCK + KERB;
      const z1 = (j + 1) * BLOCK - KERB;
      const spanX = x1 - x0;
      const spanZ = z1 - z0;

      // A park instead of buildings now and then, for variety.
      if (rng() < 0.11) {
        list.push({
          park: true,
          x: (x0 + x1) / 2,
          z: (z0 + z1) / 2,
          w: spanX,
          d: spanZ,
          h: 0,
          wall: "#3f6b46",
        });
        const trees = 4 + Math.floor(rng() * 5);
        for (let t = 0; t < trees; t += 1) {
          list.push({
            tree: true,
            x: x0 + 4 + rng() * (spanX - 8),
            z: z0 + 4 + rng() * (spanZ - 8),
            w: 3.4 + rng() * 2,
            d: 3.4 + rng() * 2,
            h: 6 + rng() * 5,
            wall: rng() < 0.5 ? "#2f7a41" : "#37894a",
          });
        }
        continue;
      }

      const cols = rng() < 0.5 ? 1 : 2;
      const rows = rng() < 0.45 ? 1 : 2;
      const cw = spanX / cols;
      const cd = spanZ / rows;
      for (let c = 0; c < cols; c += 1) {
        for (let r = 0; r < rows; r += 1) {
          const pad = 1.4 + rng() * 3.4;
          const w = cw - pad * 2;
          const d = cd - pad * 2;
          if (w < 8 || d < 8) continue;
          const tall = rng();
          const h =
            tall > 0.9 ? 40 + rng() * 18 :
            tall > 0.62 ? 24 + rng() * 14 :
            9 + rng() * 12;
          const pal = FACADES[Math.floor(rng() * FACADES.length)];
          list.push({
            x: x0 + c * cw + cw / 2,
            z: z0 + r * cd + cd / 2,
            w, d, h,
            wall: pal.wall,
            trim: pal.trim,
            glass: pal.glass,
            roof: ROOFS[Math.floor(rng() * ROOFS.length)],
            floors: Math.max(2, Math.round(h / 3.6)),
            lit: rng() < 0.35,
          });
        }
      }
    }
  }
  return list;
}

function makeStreetProps(rng) {
  const props = [];
  for (let i = 0; i <= GRID; i += 1) {
    for (let j = 0; j < GRID; j += 1) {
      for (let k = 0; k < 3; k += 1) {
        const z = j * BLOCK + 16 + k * 22 + rng() * 6;
        const side = rng() < 0.5 ? -1 : 1;
        props.push({ type: rng() < 0.68 ? "lamp" : "tree", x: i * BLOCK + side * (ROAD_HALF + 2.0), z });
      }
    }
  }
  for (let j = 0; j <= GRID; j += 1) {
    for (let i = 0; i < GRID; i += 1) {
      for (let k = 0; k < 3; k += 1) {
        const x = i * BLOCK + 16 + k * 22 + rng() * 6;
        const side = rng() < 0.5 ? -1 : 1;
        props.push({ type: rng() < 0.68 ? "lamp" : "tree", x, z: j * BLOCK + side * (ROAD_HALF + 2.0) });
      }
    }
  }
  return props;
}

/**
 * Bus stops sit on a road segment, on the right-hand kerb of the
 * direction the bus will be travelling when it arrives.
 */
function makeStops(rng, count) {
  const stops = [];
  const used = new Set();
  const names = STOP_NAMES.slice();
  let guard = 0;

  while (stops.length < count && guard < 400) {
    guard += 1;
    const vertical = rng() < 0.5;
    const line = Math.floor(rng() * (GRID + 1));
    const seg = Math.floor(rng() * GRID);
    const key = `${vertical ? "v" : "h"}${line}:${seg}`;
    if (used.has(key)) continue;

    // keep stops apart so the route is not a stutter of hops
    const t = 0.32 + rng() * 0.36;
    const along = seg * BLOCK + t * BLOCK;
    const dir = rng() < 0.5 ? 1 : -1;      // travel direction along the road
    const x = vertical ? line * BLOCK : along;
    const z = vertical ? along : line * BLOCK;

    let tooClose = false;
    for (const s of stops) {
      if (Math.hypot(s.x - x, s.z - z) < BLOCK * 0.85) { tooClose = true; break; }
    }
    if (tooClose) continue;
    used.add(key);

    // heading of the bus when it pulls in (radians, 0 = +z / north)
    const heading = vertical ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    // the kerb on the bus's right
    const rx = Math.cos(heading);
    const rz = -Math.sin(heading);
    const bayX = x + rx * LANE;
    const bayZ = z + rz * LANE;
    const shelterX = x + rx * (ROAD_HALF + 1.9);
    const shelterZ = z + rz * (ROAD_HALF + 1.9);

    // the intersection a bus should arrive from, so it pulls in on the
    // correct side of the road rather than overshooting and doubling back
    const approach = vertical
      ? { i: line, j: dir > 0 ? seg : seg + 1 }
      : { i: dir > 0 ? seg : seg + 1, j: line };

    stops.push({
      id: stops.length,
      name: names.splice(Math.floor(rng() * names.length), 1)[0] || `Stop ${stops.length + 1}`,
      x: bayX, z: bayZ,
      nodeX: x, nodeZ: z,
      shelterX, shelterZ,
      heading,
      vertical,
      line, seg, dir,
      approach,
    });
  }
  return stops;
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
    const nbrs = [
      [i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1],
    ];
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
  return { i: bandIndex(x), j: bandIndex(z) };
}

/* ------------------------- traffic light state ------------------------- */

export function makeLights(rng) {
  const lights = [];
  for (let i = 0; i <= GRID; i += 1) {
    for (let j = 0; j <= GRID; j += 1) {
      lights.push({
        i, j,
        x: i * BLOCK,
        z: j * BLOCK,
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

/** 'green' | 'amber' | 'red' for a bus travelling along the given axis. */
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

/* ------------------------------ the city ------------------------------ */

export function makeCity(seed = 7) {
  const rng = mulberry32(seed >>> 0);
  const buildings = makeBuildings(rng);
  const props = makeStreetProps(rng);
  const stops = makeStops(rng, 8);
  const lights = makeLights(rng);
  return { seed, buildings, props, stops, lights, rng };
}
