/* ------------------------------------------------------------------ *
 * City Bus Simulator — simulation.
 *
 * Runs on a fixed 1/120s step so the physics stay stable regardless of
 * frame rate. The renderer only ever reads state; nothing in here
 * touches the DOM.
 *
 * The world is an irregular grid (see city.js), so nothing here may
 * assume a constant block size: every lane point, junction mouth and
 * spawn slot is derived from the line tables and the road class of the
 * particular road being driven.
 * ------------------------------------------------------------------ */

import {
  GRID, LX, LZ,
  SURFACE_ROAD, SURFACE_PAVE, SURFACE_BLOCK,
  REGION, CITY, SUBURB, TOWN, AIRPORT,
  makeCity, surfaceAt, pushOut, findPath, nearestRoadPose,
  bandIndexX, bandIndexZ, cellIndexX, cellIndexZ, cellRegion, regionAt,
  cellsAround,
  vClass, hClass, laneOffset, laneCount,
  stepLights, lightFor, lightAt, mulberry32,
  roadHeightAt, groundHeightAt, vehicleHeightAt, slopeAlong, tunnelDepthAt,
  clamp, lerp, smooth01,
} from "./city.js";
import { BUS } from "./render.js";

export const CAPACITY = 42;
export const FARE = 3.2;
export const TOP_SPEED = 25.5;      // m/s  (~92 km/h), reached very slowly
export const REVERSE_SPEED = 3.6;   // buses reverse at walking pace
const MASS = 12000;
/* 23kN through 12 tonnes is about 1.9 m/s^2 off the line, falling away as
   the speed rises — a loaded city bus, not a hot hatch. The old 38kN gave
   4.5 m/s^2, which is why nothing about pulling away felt heavy. */
const MAX_FORCE = 23000;
const BRAKE_FORCE = 38000;
const DRAG = 3.6;
const ROLL = 1700;
const GRAVITY = 9.81;
/* Pedals are not switches. A keyboard gives 0 or 1; these rates turn that
   into something an air-braked coach could actually do. */
const THROTTLE_RISE = 1 / 0.42, THROTTLE_FALL = 1 / 0.20;
const BRAKE_RISE = 1 / 0.26, BRAKE_FALL = 1 / 0.17;
/* Lock to lock in a bit under a second at a standstill, longer on the
   move. The old rate reached full lock in half a second at any speed. */
const STEER_RATE = 1.45, STEER_RETURN = 1.9;
const STEER_SLEW = 1.6;             // rad/s limit on the road wheels
const LOCK_LOW = 0.64, LOCK_HIGH = 0.17;   // ~10m kerb radius, then gentle at speed

/* `pace` is the average speed the schedule is written to, in m/s, including
   junctions and dwell time — the world is big enough now that a flat
   allowance per stop would be generous downtown and impossible over the
   mountains. */
export const DIFFICULTY = {
  easy: { label: "Trainee", traffic: 20, peds: 26, pace: 4.0, burn: 0.7, lightPenalty: 15 },
  normal: { label: "Driver", traffic: 32, peds: 40, pace: 5.0, burn: 1, lightPenalty: 25 },
  hard: { label: "Rush hour", traffic: 48, peds: 58, pace: 6.2, burn: 1.5, lightPenalty: 40 },
};
const DWELL = 26;               // seconds allowed at each stop

const CAR_COLORS = [
  "#c0392b", "#2c6fb5", "#e0e3e8", "#2f3640", "#27865c",
  "#d9a441", "#8e44ad", "#b9c0c9", "#1f6f78", "#a8452f",
];
const SHIRTS = ["#e05b4a", "#3f7fd0", "#f2c14e", "#5cae72", "#b06cc4", "#e8e3d6", "#2f9fb5"];
const TROUSERS = ["#2f3640", "#3b4a5a", "#5a4632", "#41474f", "#2b3d34"];
const SKINS = ["#8d5524", "#c68642", "#e0ac69", "#5c3a21", "#a9713b"];

/* ------------------------------- setup ------------------------------- */

/** Driving distance of the whole route, following the road network. */
export function routeLength(city, fromX, fromZ) {
  let total = 0;
  let node = { i: bandIndexX(fromX), j: bandIndexZ(fromZ) };
  for (let k = 0; k < city.stops.length; k += 1) {
    const stop = city.stops[k];
    const path = findPath(node, stop.approach);
    for (let m = 0; m < path.length - 1; m += 1) {
      total += Math.abs(LX[path[m + 1].i] - LX[path[m].i])
        + Math.abs(LZ[path[m + 1].j] - LZ[path[m].j]);
    }
    total += Math.hypot(stop.x - LX[stop.approach.i], stop.z - LZ[stop.approach.j]);
    node = { i: bandIndexX(stop.nodeX), j: bandIndexZ(stop.nodeZ) };
  }
  return total;
}

/** Route length and schedule for the briefing screen, without a full game. */
export function estimateShift({ seed = 7, routeId = null, difficulty = "normal" } = {}) {
  const city = makeCity(seed, routeId);
  const diff = DIFFICULTY[difficulty] || DIFFICULTY.normal;
  const first = city.stops[0];
  const len = routeLength(
    city,
    first.x - Math.sin(first.heading) * 30,
    first.z - Math.cos(first.heading) * 30,
  );
  const seconds = Math.round(
    Math.max(len / diff.pace, city.stops.length * 40) + city.stops.length * DWELL,
  );
  return {
    stops: city.stops.length,
    km: len / 1000,
    minutes: Math.round(seconds / 60),
    route: city.route,
    regions: [...new Set(city.stops.map((s) => s.regionKey))],
  };
}

function makePassengers(rng, stops) {
  for (let i = 0; i < stops.length; i += 1) {
    const s = stops[i];
    s.waiting = [];
    const n = i === stops.length - 1 ? 0 : 2 + Math.floor(rng() * 7);
    for (let k = 0; k < n; k += 1) {
      // destination is always a later stop on the route
      const remaining = stops.length - 1 - i;
      const to = i + 1 + Math.floor(rng() * remaining);
      s.waiting.push({ to: clamp(to, i + 1, stops.length - 1) });
    }
    s.served = false;
    s.boarded = 0;
  }
}

/* ------------------------------------------------------------------ *
 * Traffic
 *
 * Cars follow the lane centreline as a path and steer onto it with pure
 * pursuit, rather than being pinned to it and snapped through 90-degree
 * turns. Junctions are driven as a Bezier arc between the incoming and
 * outgoing lane, so a turn is a curve the car steers around at a sane
 * speed. Longitudinal control picks the lowest of the cruise, corner,
 * traffic-light, lead-vehicle and hazard limits, then reaches it through
 * rate- and jerk-limited acceleration.
 * ------------------------------------------------------------------ */

const STOP_SETBACK = 2.2;                 // stop this far short of the mouth
const COMFORT_DECEL = 3.2;                // m/s^2 for corner entry pacing
/* Planning a light stop at the full braking rate leaves nothing in hand for
   the jerk limiter, so the car arrives still rolling and noses into the
   junction. Planning at a gentler rate makes it start braking earlier and
   actually arrive stopped. */
const LIGHT_DECEL = 2.0;

/* Two temperaments: the SUV is cautious and steady, the executive car is
   smoother and a little quicker. */
const BEHAVIOUR = {
  suv: {
    cruise: [9.5, 12.0], accelMax: 1.7, brakeMax: 4.2, jerk: 3.0,
    headway: 1.6, minGap: 4.2, cornerSpeed: 4.8, lookBase: 5.0, steerGain: 2.2,
  },
  car: {
    cruise: [12.0, 15.0], accelMax: 2.6, brakeMax: 5.2, jerk: 4.5,
    headway: 1.15, minGap: 3.4, cornerSpeed: 6.2, lookBase: 4.2, steerGain: 2.6,
  },
};

/* An open country road is worth going faster on than a downtown street,
   and a dual carriageway faster still. */
const CLASS_PACE = [1.28, 1.0, 1.95];

const wrapAngle = (a) => {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
};

const inGrid = (i, j) => i >= 0 && j >= 0 && i <= GRID && j <= GRID;

/** Half width of the road that crosses direction (di,dj) at node (i,j). */
function crossHalf(i, j, di) {
  return di !== 0 ? vClass(i).half : hClass(j).half;
}

/** Length of the edge leaving (i,j) in direction (di,dj). */
function edgeSpan(i, j, di, dj) {
  return di !== 0
    ? Math.abs(LX[clamp(i + di, 0, GRID)] - LX[i])
    : Math.abs(LZ[clamp(j + dj, 0, GRID)] - LZ[j]);
}

/** Lane centre point on the edge leaving node (i,j) heading (di,dj). */
function lanePoint(i, j, di, dj, u, out, off) {
  const rx = dj, rz = -di;                 // right of travel: right-hand traffic
  const lane = off === undefined ? laneOffset(dj !== 0, dj !== 0 ? i : j, 0) : off;
  out.x = LX[i] + di * u + rx * lane;
  out.z = LZ[j] + dj * u + rz * lane;
  return out;
}

/** Weighted pick of the next heading: mostly straight on, never a U-turn. */
function chooseNext(c, rng) {
  const opts = [];
  const add = (weight, ddi, ddj) => {
    if (!inGrid(c.i + c.di + ddi, c.j + c.dj + ddj)) return;
    for (let w = 0; w < weight; w += 1) opts.push([ddi, ddj]);
  };
  add(7, c.di, c.dj);                       // straight on
  add(2, -c.dj, c.di);                      // one way round
  add(2, c.dj, -c.di);                      // the other
  if (!opts.length) return [-c.di, -c.dj];  // dead end: the only legal move
  return opts[Math.floor(rng() * opts.length)];
}

const _p0 = { x: 0, z: 0 }, _p2 = { x: 0, z: 0 };

/**
 * Builds the junction arc from the current lane into the next. The control
 * point is where the two lane centrelines actually cross, so the curve
 * leaves and enters each lane exactly on tangent — no clipped kerbs and no
 * instant rotation.
 */
function buildCorner(c) {
  const bi = clamp(c.i + c.di, 0, GRID), bj = clamp(c.j + c.dj, 0, GRID);
  const span = edgeSpan(c.i, c.j, c.di, c.dj);
  c.entry = Math.max(6, span - crossHalf(bi, bj, c.di));
  c.off = laneOffset(c.dj !== 0, c.dj !== 0 ? c.i : c.j, c.lane);
  /* The lane for the next road is decided *before* the junction arc is
     built, so a car joining a dual carriageway changes lane along the
     curve instead of stepping five metres sideways once it is on it. */
  c.nlane = Math.min(c.pref, laneCount(c.ndj !== 0, c.ndj !== 0 ? bi : bj) - 1);
  c.noff = laneOffset(c.ndj !== 0, c.ndj !== 0 ? bi : bj, c.nlane);
  c.exit0 = crossHalf(bi, bj, c.ndi);
  const cls = c.dj !== 0 ? vClass(c.i) : hClass(c.j);
  c.cruise = Math.min(c.base * CLASS_PACE[classIndex(cls)] * (c.pace || 1), cls.limit);

  lanePoint(c.i, c.j, c.di, c.dj, c.entry, _p0, c.off);
  lanePoint(bi, bj, c.ndi, c.ndj, c.exit0, _p2, c.noff);
  c.c0x = _p0.x; c.c0z = _p0.z;
  c.c2x = _p2.x; c.c2z = _p2.z;
  const straight = c.ndi === c.di && c.ndj === c.dj;
  if (straight) {
    c.c1x = (_p0.x + _p2.x) / 2;
    c.c1z = (_p0.z + _p2.z) / 2;
  } else if (c.di !== 0) {
    // travelling along x: the incoming lane holds z, the outgoing holds x
    c.c1x = _p2.x; c.c1z = _p0.z;
  } else {
    c.c1x = _p0.x; c.c1z = _p2.z;
  }
  const d1 = Math.hypot(c.c1x - c.c0x, c.c1z - c.c0z);
  const d2 = Math.hypot(c.c2x - c.c1x, c.c2z - c.c1z);
  const chord = Math.hypot(c.c2x - c.c0x, c.c2z - c.c0z);
  c.cornerLen = Math.max(1, (d1 + d2 + chord) / 2);
  c.turning = !straight;
}

function classIndex(cls) {
  return cls.name === "rural" ? 0 : cls.name === "street" ? 1 : 2;
}

function cornerPoint(c, t, out) {
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  const m = 1 - u;
  out.x = m * m * c.c0x + 2 * m * u * c.c1x + u * u * c.c2x;
  out.z = m * m * c.c0z + 2 * m * u * c.c1z + u * u * c.c2z;
  return out;
}

/**
 * A point `ahead` metres further along the route, crossing from the
 * straight into the arc and out onto the next lane as needed. Pure pursuit
 * aims at this.
 */
function pathAhead(c, ahead, out) {
  const bi = clamp(c.i + c.di, 0, GRID), bj = clamp(c.j + c.dj, 0, GRID);
  if (c.phase === "edge") {
    const u = c.s + ahead;
    if (u <= c.entry) return lanePoint(c.i, c.j, c.di, c.dj, u, out, c.off);
    const into = u - c.entry;
    if (into <= c.cornerLen) return cornerPoint(c, into / c.cornerLen, out);
    return lanePoint(bi, bj, c.ndi, c.ndj, c.exit0 + (into - c.cornerLen), out, c.noff);
  }
  const into = c.cs + ahead;
  if (into <= c.cornerLen) return cornerPoint(c, into / c.cornerLen, out);
  return lanePoint(bi, bj, c.ndi, c.ndj, c.exit0 + (into - c.cornerLen), out, c.noff);
}

/** Distance to the junction mouth, or Infinity once inside it. */
function distToJunction(c) {
  return c.phase === "edge" ? c.entry - STOP_SETBACK - c.s : Infinity;
}

function makeCar(rng) {
  const van = rng() < 0.44;                 // a healthy mix of both models
  const kind = van ? "suv" : "car";
  const b = BEHAVIOUR[kind];
  return {
    kind, van, b,
    i: 0, j: 0, di: 0, dj: 1, s: 0,
    lane: 0, nlane: 0, pref: rng() < 0.45 ? 1 : 0,
    phase: "edge", cs: 0,
    ndi: 0, ndj: 1,
    entry: 40, exit0: 8, off: 4.2, noff: 4.2,
    c0x: 0, c0z: 0, c1x: 0, c1z: 0, c2x: 0, c2z: 0, cornerLen: 1, turning: false,
    x: 0, y: 0, z: 0, yaw: 0, yawRate: 0, pitch: 0,
    speed: 3 + rng() * 4,
    accel: 0,
    base: b.cruise[0] + rng() * (b.cruise[1] - b.cruise[0]),
    pace: 1,
    cruise: 10,
    color: CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)],
    w: van ? 2.05 : 1.85,
    l: van ? 4.9 : 4.6,
    h: van ? 1.95 : 1.45,
    brakeGlow: false,
    honk: 0,
    stuck: 0,
    yieldCool: 0,
  };
}

function seatCar(c, i, j, di, dj, s, rng, speedFrac) {
  c.i = i; c.j = j; c.di = di; c.dj = dj; c.s = s;
  c.ndi = di; c.ndj = dj;
  c.phase = "edge"; c.cs = 0;
  const vertical = dj !== 0;
  c.lane = Math.min(c.pref, laneCount(vertical, vertical ? i : j) - 1);
  buildCorner(c);
  lanePoint(i, j, di, dj, s, c, c.off);
  c.y = vehicleHeightAt(c.x, c.z);
  c.yaw = Math.atan2(di, dj);
  c.yawRate = 0;
  if (speedFrac !== undefined) c.speed = c.cruise * speedFrac;
  /* Never drop a car in so close to a junction that it cannot stop for the
     light: a car that arrives already unable to comply reads as a red-light
     runner, which it is, but only because we put it there. */
  const room = Math.max(0, c.entry - STOP_SETBACK - s);
  c.speed = Math.min(c.speed, Math.sqrt(2 * 1.8 * room) + 1.5);
}

/* ------------------------- spawn validation -------------------------- *
 *
 * A lane point derived from the line tables is *usually* on tarmac, but
 * "usually" is what put cars inside buildings and buried in hillsides. The
 * grid is irregular, road classes change width along a line, and a segment
 * can dive into a tunnel bore that is not drawn from the outside — a car
 * sitting in one reads as a car inside a mountain. So nothing is taken on
 * trust: every proposed spot is checked against the world before a car is
 * allowed to appear there, and a failed check just costs another attempt.
 * ------------------------------------------------------------------ */

const SPAWN_CLEAR_BUS = 45;      // never appear in the player's lap
const _footCells = [];

/** Is this point inside the footprint of a building or other solid prop? */
function insideProp(city, x, z, pad) {
  if (!city || !city.scenery) return false;
  cellsAround(x, z, 24, _footCells);
  for (let n = 0; n < _footCells.length; n += 1) {
    const list = city.scenery[_footCells[n]];
    if (!list) continue;
    for (let m = 0; m < list.length; m += 1) {
      const p = list[m];
      // parks and trees are scenery a car may legitimately drive past
      if (p.kind !== "tower" && p.kind !== "house" && p.kind !== "shop"
        && p.kind !== "hangar" && p.kind !== "shed") continue;
      const hw = (p.w || 0) / 2 + pad;
      const hd = (p.d || p.w || 0) / 2 + pad;
      if (Math.abs(x - p.x) <= hw && Math.abs(z - p.z) <= hd) return true;
    }
  }
  return false;
}

/**
 * Everything that has to be true before a car may appear at (x, z):
 * on a road lane, on solid road surface, at a sane height, not buried in
 * a tunnel bore, not inside a building, and not on top of the player.
 */
function spawnValid(state, x, z, di, dj) {
  const { bus, city } = state;
  if (!isFinite(x) || !isFinite(z)) return false;

  // clear of the player, so nothing is ever seen to materialise
  const dx = x - bus.x, dz = z - bus.z;
  if (dx * dx + dz * dz < SPAWN_CLEAR_BUS * SPAWN_CLEAR_BUS) return false;

  /* Check the body, not a point. Half a car hanging over the kerb is the
     same bug as a whole one; sample the nose and tail as well as the middle. */
  const fx = dj !== 0 ? 0 : Math.sign(di);
  const fz = dj !== 0 ? Math.sign(dj) : 0;
  for (let n = -1; n <= 1; n += 1) {
    const px = x + fx * n * 2.6;
    const pz = z + fz * n * 2.6;
    if (surfaceAt(px, pz) !== SURFACE_ROAD) return false;
    const rh = roadHeightAt(px, pz);
    if (!isFinite(rh)) return false;
    /* Ground far above the carriageway means the road is in a bore or a
       deep cutting here. Nothing is drawn over it from outside, so a car
       parked in there looks like a car inside the mountain. */
    if (tunnelDepthAt(px, pz) > 0.01) return false;
    if (groundHeightAt(px, pz) - rh > 3.5) return false;
    if (insideProp(city, px, pz, 1.2)) return false;
  }
  return true;
}

function spawnCar(rng, existing, seedState) {
  const c = makeCar(rng);
  const probe = { x: 0, z: 0 };
  let i = 0, j = 0, di = 0, dj = 0, s = 0;
  let best = null;
  // keep spawns apart so nothing starts overlapping or nose to tail
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const vertical = rng() < 0.5;
    i = Math.floor(rng() * (GRID + 1));
    j = Math.floor(rng() * (GRID + 1));
    di = 0; dj = 0;
    if (vertical) dj = rng() < 0.5 ? 1 : -1; else di = rng() < 0.5 ? 1 : -1;
    if (!inGrid(i + di, j + dj)) { di = -di; dj = -dj; }
    const span = edgeSpan(i, j, di, dj);
    s = 6 + rng() * Math.max(4, span - 30);
    lanePoint(i, j, di, dj, s, probe, laneOffset(dj !== 0, dj !== 0 ? i : j, 0));
    let clear = true;
    for (const o of existing) {
      if ((o.x - probe.x) ** 2 + (o.z - probe.z) ** 2 < 15 * 15) { clear = false; break; }
    }
    if (!clear) continue;
    // remember the first spaced-out spot in case nothing fully valid turns up
    if (!best) best = { i, j, di, dj, s };
    if (!seedState || spawnValid(seedState, probe.x, probe.z, di, dj)) break;
  }
  if (best && seedState && !spawnValid(seedState, probe.x, probe.z, di, dj)) {
    ({ i, j, di, dj, s } = best);
  }
  seatCar(c, i, j, di, dj, s, rng);
  return c;
}

/* ---------------------------- pedestrians ---------------------------- */

const populated = (reg) => reg === CITY || reg === SUBURB || reg === TOWN || reg === AIRPORT;

function paveMid(vertical, line) {
  const cls = vertical ? vClass(line) : hClass(line);
  return cls.half + cls.pave / 2 + 0.2;
}

function cellWalk(i, j) {
  return {
    x0: LX[i] + paveMid(true, i),
    x1: LX[i + 1] - paveMid(true, i + 1),
    z0: LZ[j] + paveMid(false, j),
    z1: LZ[j + 1] - paveMid(false, j + 1),
  };
}

function spawnPed(rng) {
  let i = 0, j = 0;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    i = Math.floor(rng() * GRID);
    j = Math.floor(rng() * GRID);
    if (populated(cellRegion(i, j))) break;
  }
  return {
    i, j,
    t: rng(),
    dir: rng() < 0.5 ? 1 : -1,
    speed: 1.0 + rng() * 0.7,
    phase: rng() * 6.28,
    /* Fixes which model and clothes this person has for the whole shift.
       Rolling it per frame would have them changing outfit as they walk. */
    seed: Math.floor(rng() * 100000),
    shirt: SHIRTS[Math.floor(rng() * SHIRTS.length)],
    trouser: TROUSERS[Math.floor(rng() * TROUSERS.length)],
    skin: SKINS[Math.floor(rng() * SKINS.length)],
    mode: "walk",
    cross: null,
    x: 0, y: 0, z: 0, yaw: 0,
    cool: 0,
  };
}

/* -------------------------------- game -------------------------------- */

export function makeGame({
  seed = 7, mode = "route", difficulty = "normal", dusk = false, routeId = null,
} = {}) {
  const city = makeCity(seed, routeId);
  const rng = mulberry32((seed * 2654435761) >>> 0);
  const diff = DIFFICULTY[difficulty] || DIFFICULTY.normal;
  makePassengers(rng, city.stops);

  const first = city.stops[0];
  // start the bus a little way back from the first stop, facing it
  const back = 30;
  const bx = first.x - Math.sin(first.heading) * back;
  const bz = first.z - Math.cos(first.heading) * back;
  const bus = {
    x: bx, z: bz, y: vehicleHeightAt(bx, bz),
    yaw: first.heading,
    pitch: 0,
    speed: 0,
    steer: 0,
    steerAngle: 0,
    gear: "D",
    throttle: 0,
    brake: 0,
    handbrake: false,
    doors: false,
    doorT: 0,
    indicator: null,
    headlights: dusk,
    fuel: 1,
    damage: 0,
    onboard: [],
    livery: "#f0b429",
    rpm: 0.12,
    shake: 0,
    lateralG: 0,
    engineOn: true,
    kneel: 0,
  };

  const cars = [];
  /* Pass the cars placed so far so spawns keep a sensible gap apart, and
     the world so far so each one can be checked against real geometry. */
  const seedState = { bus, city };
  for (let i = 0; i < diff.traffic; i += 1) cars.push(spawnCar(rng, cars, seedState));
  const peds = [];
  for (let i = 0; i < diff.peds; i += 1) peds.push(spawnPed(rng));

  const state = {
    city, rng, mode, difficulty, diff, dusk, seed, routeId: city.route.id,
    bus, cars, peds,
    t: 0,
    phase: "driving",           // driving | boarding | finished
    routeIdx: 0,
    activeStopId: 0,
    guide: [],
    guideDist: 0,
    guideTimer: 0,
    region: regionAt(bus.x, bus.z),
    regionT: 0,
    regionSeen: [REGION[regionAt(bus.x, bus.z)].key],
    tunnel: 0,
    routeLen: 0,
    timeLeft: Infinity,
    totalTime: 0,
    money: 0,
    penalties: 0,
    carried: 0,
    comfort: 100,
    stars: 0,
    events: [],
    stats: { redLights: 0, collisions: 0, kerbs: 0, pedHits: 0, harshStops: 0, perfectStops: 0 },
    boardTimer: 0,
    alighting: 0,
    lastLightNode: -1,
    lightCooldown: 0,
    hitCooldown: 0,
    stuckT: 0,
    stuckHinted: false,
    message: null,
    messageT: 0,
    acc: 0,
    recycleT: 0,
  };
  state.routeLen = routeLength(city, bus.x, bus.z);
  if (mode !== "free") {
    state.timeLeft = Math.round(
      Math.max(state.routeLen / diff.pace, city.stops.length * 40) + city.stops.length * DWELL,
    );
  }
  refreshGuide(state);
  return state;
}

function say(state, text, tone = "info", life = 3) {
  state.message = { text, tone };
  state.messageT = life;
  state.events.push({ type: "message", text, tone });
}

export function drainEvents(state) {
  const out = state.events;
  state.events = [];
  return out;
}

/* --------------------------- route guidance --------------------------- */

/** The intersection the bus is currently heading towards. */
function nextNodeAhead(bus) {
  const s = Math.sin(bus.yaw), c = Math.cos(bus.yaw);
  if (Math.abs(c) >= Math.abs(s)) {          // travelling along z
    const i = bandIndexX(bus.x);
    let j = cellIndexZ(bus.z);
    if (c >= 0) j += 1;
    return { i, j: clamp(j, 0, GRID) };
  }
  const j = bandIndexZ(bus.z);
  let i = cellIndexX(bus.x);
  if (s >= 0) i += 1;
  return { i: clamp(i, 0, GRID), j };
}

/**
 * Chevrons from where the bus actually is, in the direction it is
 * actually pointing — pathing from the *nearest* intersection would
 * cheerfully tell the driver to turn around and go back for it.
 */
function refreshGuide(state) {
  const { bus, city } = state;
  if (state.activeStopId < 0) { state.guide = []; state.guideDist = 0; return; }
  const stop = city.stops[state.activeStopId];

  const pts = [];
  const addLeg = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.min(30, Math.round(len / 9)));
    for (let s = 1; s <= n; s += 1) {
      const f = s / n;
      pts.push([x0 + (x1 - x0) * f, z0 + (z1 - z0) * f]);
    }
    return len;
  };

  // Already on the right stretch of road, pointing the right way?
  const sn = Math.sin(bus.yaw), cs = Math.cos(bus.yaw);
  const relX = stop.x - bus.x, relZ = stop.z - bus.z;
  const fwd = relX * sn + relZ * cs;
  const lat = relX * cs - relZ * sn;
  const alongAxis = stop.vertical ? Math.abs(cs) > 0.7 : Math.abs(sn) > 0.7;
  const rightWay = Math.cos(bus.yaw - stop.heading) > 0.5;
  if (fwd > 1 && Math.abs(lat) < 12 && alongAxis && rightWay) {
    state.guideDist = addLeg(bus.x, bus.z, stop.x, stop.z);
    state.guide = pts;
    return;
  }

  const start = nextNodeAhead(bus);
  const path = findPath(start, stop.approach);
  let dist = addLeg(bus.x, bus.z, LX[start.i], LZ[start.j]);
  for (let k = 0; k < path.length - 1; k += 1) {
    const a = path[k], b = path[k + 1];
    const di = b.i - a.i, dj = b.j - a.j;
    const rx = dj, rz = -di;                 // right of travel
    const lane = laneOffset(dj !== 0, dj !== 0 ? a.i : a.j, 0) * 0.6;
    const ax = LX[a.i] + rx * lane;
    const az = LZ[a.j] + rz * lane;
    dist += addLeg(ax, az, LX[b.i] + rx * lane, LZ[b.j] + rz * lane);
  }
  const last = path[path.length - 1];
  dist += addLeg(LX[last.i], LZ[last.j], stop.x, stop.z);
  state.guide = pts;
  state.guideDist = dist;
}

export function distanceToStop(state) {
  if (state.activeStopId < 0) return 0;
  const s = state.city.stops[state.activeStopId];
  return Math.hypot(state.bus.x - s.x, state.bus.z - s.z);
}

/* ------------------------------ physics ------------------------------ */

function busCorners(bus, out) {
  const c = Math.cos(bus.yaw), s = Math.sin(bus.yaw);
  const hw = BUS.wid / 2 + 0.08, hl = BUS.len / 2;
  const L = [[-hw, -hl], [hw, -hl], [hw, hl], [-hw, hl]];
  for (let i = 0; i < 4; i += 1) {
    out[i * 2] = bus.x + L[i][0] * c + L[i][1] * s;
    out[i * 2 + 1] = bus.z - L[i][0] * s + L[i][1] * c;
  }
  return out;
}

const cornerBuf = new Float64Array(8);

function stepBus(state, input, dt) {
  const bus = state.bus;

  // ---- driver inputs -------------------------------------------------
  const steerTarget = (input.steerRight ? 1 : 0) - (input.steerLeft ? 1 : 0);
  if (steerTarget === 0) {
    const k = Math.min(1, (STEER_RETURN + Math.abs(bus.speed) * 0.09) * dt);
    bus.steer += (0 - bus.steer) * k;
  } else {
    const rate = STEER_RATE / (1 + Math.abs(bus.speed) * 0.03);
    bus.steer = clamp(bus.steer + steerTarget * rate * dt, -1, 1);
  }

  const doorsBlocked = bus.doorT > 0.02;
  // rate-limited pedals: a tap on the key is a squeeze, not a switch
  const wantThrottle = doorsBlocked || !bus.engineOn ? 0 : clamp(input.throttle, 0, 1);
  bus.throttle += clamp(wantThrottle - bus.throttle, -THROTTLE_FALL * dt, THROTTLE_RISE * dt);
  const wantBrake = clamp(input.brake, 0, 1);
  bus.brake += clamp(wantBrake - bus.brake, -BRAKE_FALL * dt, BRAKE_RISE * dt);
  bus.handbrake = !!input.handbrake;

  // ---- longitudinal --------------------------------------------------
  const v = bus.speed;
  const av = Math.abs(v);
  let force = 0;

  if (bus.gear === "D") {
    force += bus.throttle * MAX_FORCE * Math.max(0, 1 - Math.max(0, v) / TOP_SPEED);
  } else if (bus.gear === "R") {
    force -= bus.throttle * MAX_FORCE * 0.62 * Math.max(0, 1 - Math.max(0, -v) / REVERSE_SPEED);
  }

  /* Gradient. A real bus holds on a hill rather than rolling backwards the
     moment you lift off, so gravity only bites once it is actually moving
     or the driver is asking for power. */
  const grade = slopeAlong(bus.x, bus.z, bus.yaw);
  bus.grade = grade;
  if (av > 0.35 || bus.throttle > 0.05) {
    force -= MASS * GRAVITY * Math.sin(Math.atan(grade));
  }

  // brakes, handbrake and the door interlock all oppose motion
  const brakeInput = Math.max(bus.brake, bus.handbrake ? 1 : 0, doorsBlocked ? 0.55 : 0);
  let accel;
  if (av > 0.05) {
    force -= Math.sign(v) * brakeInput * BRAKE_FORCE;
    force -= Math.sign(v) * (DRAG * v * v + ROLL);
    accel = force / MASS;
  } else if (bus.handbrake || (brakeInput > 0.02 && Math.abs(force) < brakeInput * BRAKE_FORCE)) {
    // standing on the brake holds the bus still
    bus.speed = 0;
    accel = 0;
  } else if (Math.abs(force) < 1) {
    bus.speed = 0;
    accel = 0;
  } else {
    accel = force / MASS;
  }

  const prevSpeed = bus.speed;
  bus.speed += accel * dt;
  // braking must never drag the bus backwards through zero
  if (brakeInput > 0.02 && Math.sign(bus.speed) !== Math.sign(prevSpeed) && Math.abs(prevSpeed) > 0.01) bus.speed = 0;
  if (bus.gear === "N") bus.speed -= Math.sign(bus.speed) * Math.min(av, (ROLL / MASS) * dt * 3);
  bus.speed = clamp(bus.speed, -REVERSE_SPEED, TOP_SPEED);

  /* ---- steering: bicycle model referenced to the centre of the bus ----
   *
   * The old version integrated the *rear axle* equations but applied them
   * to the body centre, which made the whole coach pivot about its middle:
   * both axles swept sideways at over 2 m/s in a turn, and that is exactly
   * what read as the bus sliding rather than driving.
   *
   * Steering about the centre of mass instead means travelling at a slip
   * angle beta to the heading. With the mass centred between the axles
   * that works out at atan(0.5 * tan(delta)), and the algebra then makes
   * the rear axle's lateral velocity exactly zero — the tyres roll.
   */
  const maxSteer = lerp(LOCK_LOW, LOCK_HIGH, smooth01(av / 16));
  const wantAngle = bus.steer * maxSteer;
  // the road wheels have mass too; they cannot snap to a new angle
  bus.steerAngle += clamp(wantAngle - bus.steerAngle, -STEER_SLEW * dt, STEER_SLEW * dt);

  const beta = Math.atan(0.5 * Math.tan(bus.steerAngle));
  const yawRate = (bus.speed / BUS.wheelbase) * Math.cos(beta) * Math.tan(bus.steerAngle);
  bus.yaw += yawRate * dt;
  if (bus.yaw > Math.PI) bus.yaw -= Math.PI * 2;
  if (bus.yaw < -Math.PI) bus.yaw += Math.PI * 2;

  bus.lateralG = Math.abs(yawRate * bus.speed) / 9.81;

  bus.x += Math.sin(bus.yaw + beta) * bus.speed * dt;
  bus.z += Math.cos(bus.yaw + beta) * bus.speed * dt;

  // ---- comfort -------------------------------------------------------
  const jerk = Math.abs(accel);
  if (bus.lateralG > 0.34) state.comfort -= (bus.lateralG - 0.34) * 9 * dt;
  if (jerk > 3.2 && av > 2) state.comfort -= (jerk - 3.2) * 2.2 * dt;
  if (state.comfort < 0) state.comfort = 0;
  state.comfort = Math.min(100, state.comfort + dt * 0.65);

  // ---- world collision ------------------------------------------------
  /* Resolved over a few passes: a bus wedged into the diagonal corner of
     a block has different corners poking through on different axes, and
     a single pass just flip-flops between them forever. */
  let worst = null;
  let onPave = false;
  for (let iter = 0; iter < 3; iter += 1) {
    busCorners(bus, cornerBuf);
    let pass = null;
    let passDepth = 0;
    onPave = false;
    for (let i = 0; i < 4; i += 1) {
      const px = cornerBuf[i * 2], pz = cornerBuf[i * 2 + 1];
      const surf = surfaceAt(px, pz);
      if (surf === SURFACE_PAVE) onPave = true;
      if (surf === SURFACE_BLOCK) {
        const p = pushOut(px, pz);
        if (p) {
          const d = Math.hypot(p.dx, p.dz);
          if (d > passDepth) { passDepth = d; pass = p; }
        }
      }
    }
    if (!pass) break;
    bus.x += pass.dx * 1.05;
    bus.z += pass.dz * 1.05;
    if (!worst || passDepth > Math.hypot(worst.dx, worst.dz)) worst = pass;
  }

  // world outer bounds
  const M = 10;
  if (bus.x < LX[0] - M) { bus.x = LX[0] - M; bus.speed *= 0.3; }
  if (bus.x > LX[GRID] + M) { bus.x = LX[GRID] + M; bus.speed *= 0.3; }
  if (bus.z < LZ[0] - M) { bus.z = LZ[0] - M; bus.speed *= 0.3; }
  if (bus.z > LZ[GRID] + M) { bus.z = LZ[GRID] + M; bus.speed *= 0.3; }

  // ---- ride height and suspension --------------------------------------
  const targetY = vehicleHeightAt(bus.x, bus.z);
  bus.y = Math.abs(targetY - bus.y) > 3 ? targetY : lerp(bus.y, targetY, Math.min(1, dt * 30));

  /* Twelve tonnes on air springs: the nose dives on the brakes, the tail
     squats under power and the body leans out of a corner. Without this
     the bus reads as a rigid box being slid along a surface, which is a
     large part of why it never felt like a vehicle. */
  const pitchWant = clamp(-accel * 0.021, -0.08, 0.08);
  bus.pitchVel = (bus.pitchVel || 0) + ((pitchWant - (bus.suspPitch || 0)) * 30 - (bus.pitchVel || 0) * 8.5) * dt;
  bus.suspPitch = (bus.suspPitch || 0) + bus.pitchVel * dt;
  const rollWant = clamp(-yawRate * bus.speed * 0.0135, -0.085, 0.085);
  bus.rollVel = (bus.rollVel || 0) + ((rollWant - (bus.roll || 0)) * 24 - (bus.rollVel || 0) * 7.5) * dt;
  bus.roll = (bus.roll || 0) + bus.rollVel * dt;

  // attitude the body is drawn and the camera is carried at
  bus.pitch = Math.atan(grade) + bus.suspPitch;

  if (worst) {
    const impact = av;
    if (impact > 1.4 && state.hitCooldown <= 0) {
      const dmg = Math.min(18, impact * 1.2);
      bus.damage = Math.min(100, bus.damage + dmg);
      state.penalties += Math.round(6 + impact * 1.5);
      state.stats.collisions += 1;
      state.hitCooldown = 0.9;
      bus.shake = Math.min(1, impact / 10);
      state.events.push({ type: "crash", impact });
      say(state, "Watch it! You hit the scenery", "bad", 2);
    }
    /* Only kill motion that is heading into the obstruction. Reversing
       away stays untouched, so a driver can always back out of a scrape
       instead of being pinned there. */
    const nlen = Math.hypot(worst.dx, worst.dz) || 1;
    const into = (Math.sin(bus.yaw) * worst.dx + Math.cos(bus.yaw) * worst.dz) / nlen * bus.speed;
    if (into < 0) bus.speed *= impact > 4 ? 0.1 : 0.5;
  } else if (onPave) {
    if (av > 1.2) {
      bus.shake = Math.max(bus.shake, 0.22);
      bus.speed *= 1 - 0.9 * dt;
      state.comfort -= 8 * dt;
      if (state.hitCooldown <= 0) {
        state.hitCooldown = 1.6;
        state.stats.kerbs += 1;
        state.penalties += 4;
        state.events.push({ type: "kerb" });
        say(state, "Off the road — mind the verge", "warn", 1.8);
      }
    }
  }

  // ---- doors ----------------------------------------------------------
  const doorTarget = bus.doors ? 1 : 0;
  const before = bus.doorT;
  bus.doorT += clamp(doorTarget - bus.doorT, -1, 1) * Math.min(1, dt * 1.9);
  if (Math.abs(bus.doorT - doorTarget) < 0.01) bus.doorT = doorTarget;
  if (before < 1 && bus.doorT >= 1) state.events.push({ type: "doorOpen" });
  if (before > 0 && bus.doorT <= 0) state.events.push({ type: "doorClose" });

  // ---- consumables ----------------------------------------------------
  bus.rpm = clamp(0.12 + Math.abs(bus.speed) / TOP_SPEED * 0.62 + bus.throttle * 0.3, 0, 1);
  bus.fuel = Math.max(0, bus.fuel - dt * (0.00022 + bus.throttle * 0.0008) * state.diff.burn);
  if (bus.fuel <= 0 && bus.engineOn) {
    bus.engineOn = false;
    say(state, "Out of fuel — the depot will not be pleased", "bad", 6);
    state.events.push({ type: "stall" });
  }
  bus.shake = Math.max(0, bus.shake - dt * 2.4);
  state.hitCooldown = Math.max(0, state.hitCooldown - dt);
  state.lightCooldown = Math.max(0, state.lightCooldown - dt);

  // ---- stuck assist ----------------------------------------------------
  if (Math.abs(bus.speed) > 1.2) {
    state.stuckT = 0;
    state.stuckHinted = false;
  } else if (bus.throttle > 0.3) {
    state.stuckT += dt;
  }
  if (state.stuckT > 3 && !state.stuckHinted) {
    state.stuckHinted = true;
    say(state, "Wedged in? Press R for reverse, or T to be towed clear", "warn", 5);
  }
}

/**
 * Lift the bus back onto the nearest lane, pointing the way the route
 * wants it to go. Costs a little money so it is a last resort, not a
 * shortcut — but it means no player is ever trapped in the scenery.
 */
export function recover(state) {
  const { bus, city } = state;
  const stop = state.activeStopId >= 0 ? city.stops[state.activeStopId] : null;
  let hint = bus.yaw;
  if (stop) {
    const dx = stop.x - bus.x, dz = stop.z - bus.z;
    hint = Math.abs(dx) > Math.abs(dz)
      ? (dx >= 0 ? Math.PI / 2 : -Math.PI / 2)
      : (dz >= 0 ? 0 : Math.PI);
  }
  const pose = nearestRoadPose(bus.x, bus.z, hint);
  bus.x = pose.x;
  bus.z = pose.z;
  bus.yaw = pose.yaw;
  bus.y = vehicleHeightAt(bus.x, bus.z);
  bus.speed = 0;
  bus.steer = 0;
  bus.steerAngle = 0;
  bus.gear = "D";
  state.stuckT = 0;
  state.stuckHinted = false;
  state.penalties += 20;
  state.comfort = Math.max(0, state.comfort - 6);
  refreshGuide(state);
  state.events.push({ type: "recover" });
  say(state, "Towed back onto the road (−₵20)", "warn", 3);
}

/* ------------------------------ traffic ------------------------------ */

/* ------------------------------------------------------------------ *
 * Traffic recycling
 *
 * The world is well over a kilometre across, so scattering a few dozen
 * cars over it would leave the road in front of the player empty for
 * minutes at a time. Cars that have drifted far away are quietly moved
 * to a clear stretch nearer the bus instead: the same vehicles, but
 * where they can be seen and reacted to. How many are kept nearby is
 * scaled by the region, so a country lane stays quiet and the city
 * centre stays busy.
 * ------------------------------------------------------------------ */

const RECYCLE_FAR = 420;      // only relocate cars this far out
const RECYCLE_SPAN = 80;      // depth of the band a car may be dropped into
const NEAR_RADIUS = 300;
/* How far the player can actually see is a property of the region, not a
   constant: downtown the skyline closes the view at about 200m, out in the
   country it runs to 330m. Using one pessimistic figure everywhere pushed
   every relocation 300m+ up the road, where a same-direction car simply
   drove away and was never caught — which is why the player never ended up
   behind anybody. */
const sightOf = (state) => REGION[state.region].sight || 300;

/**
 * Snaps a car onto the lane of the road passing through (x, z), heading in
 * the given axis direction. Returns false if that would put it on top of a
 * junction or outside the grid.
 */
function placeOnLane(out, x, z, di, dj) {
  const vertical = dj !== 0;
  const line = vertical ? bandIndexX(x) : bandIndexZ(z);
  const along = vertical ? z : x;
  const dir = vertical ? dj : di;
  const cell = vertical ? cellIndexZ(z) : cellIndexX(x);
  const node = clamp(dir > 0 ? cell : cell + 1, 0, GRID);
  const base = vertical ? LZ[node] : LX[node];
  const u = dir > 0 ? along - base : base - along;
  const i = vertical ? line : node;
  const j = vertical ? node : line;
  if (!inGrid(i, j) || !inGrid(i + di, j + dj)) return false;
  const span = edgeSpan(i, j, di, dj);
  if (u < 8 || u > span - 28) return false;
  out.i = i; out.j = j; out.di = di; out.dj = dj; out.s = u;
  return true;
}

/**
 * Puts a car on the road the bus is currently driving, far enough ahead to
 * arrive unseen. Roughly half come the other way, which is what makes a
 * street feel used rather than staged.
 */
function placeAheadOfBus(out, state, rng) {
  const { bus } = state;
  const sy = Math.sin(bus.yaw), cy = Math.cos(bus.yaw);
  const vertical = Math.abs(cy) >= Math.abs(sy);      // bus running along z
  const line = vertical ? bandIndexX(bus.x) : bandIndexZ(bus.z);
  const dir = (vertical ? Math.sign(cy) : Math.sign(sy)) || 1;
  const along0 = vertical ? bus.z : bus.x;
  const dist = sightOf(state) + 8 + rng() * RECYCLE_SPAN;
  const along = along0 + dir * dist;
  const lo = vertical ? LZ[0] + 10 : LX[0] + 10;
  const hi = vertical ? LZ[GRID] - 10 : LX[GRID] - 10;
  // the road ran out; shortening it would drop the car in plain sight
  if (along < lo || along > hi) return false;
  /* Mostly traffic going the same way. Oncoming cars are seen for two
     seconds and gone; a car ahead in your own lane is what turns a street
     into something you have to drive in. */
  out.slower = rng() < 0.7;
  const travel = out.slower ? dir : -dir;
  const di = vertical ? 0 : travel;
  const dj = vertical ? travel : 0;
  const x = vertical ? LX[line] : along;
  const z = vertical ? along : LZ[line];
  return placeOnLane(out, x, z, di, dj);
}

/**
 * Drops a car on a nearby road that is outside the camera's field of view —
 * off to the side or behind — so it appears without being seen to appear and
 * then drives into frame within a few seconds.
 */
function placeOffCamera(out, state, rng) {
  const { bus } = state;
  const vertical = rng() < 0.5;
  const line = Math.floor(rng() * (GRID + 1));
  const travel = rng() < 0.5 ? 1 : -1;
  const di = vertical ? 0 : travel;
  const dj = vertical ? travel : 0;
  const lo = vertical ? LZ[0] + 10 : LX[0] + 10;
  const hi = vertical ? LZ[GRID] - 10 : LX[GRID] - 10;
  const along = lo + rng() * (hi - lo);
  const x = vertical ? LX[line] : along;
  const z = vertical ? along : LZ[line];

  const dx = x - bus.x, dz = z - bus.z;
  const d = Math.hypot(dx, dz);
  if (d < 55 || d > 135) return false;
  const fwd = (dx * Math.sin(bus.yaw) + dz * Math.cos(bus.yaw)) / d;
  if (fwd > Math.cos(1.31)) return false;         // within ~75 deg: on screen
  out.slower = false;
  return placeOnLane(out, x, z, di, dj);
}

function recycleTraffic(state, dt) {
  state.recycleT = (state.recycleT || 0) - dt;
  if (state.recycleT > 0) return;
  state.recycleT = 0.5;

  const { cars, bus, rng } = state;
  const reg = REGION[state.region];
  const sight = sightOf(state);
  const sy = Math.sin(bus.yaw), cy = Math.cos(bus.yaw);
  let near = 0;
  let ahead = 0;
  for (let k = 0; k < cars.length; k += 1) {
    const c = cars[k];
    const dx = c.x - bus.x, dz = c.z - bus.z;
    if (dx * dx + dz * dz < NEAR_RADIUS * NEAR_RADIUS) near += 1;
    const f = dx * sy + dz * cy;
    const l = dx * cy - dz * sy;
    /* "Ahead" means near enough to be traffic you are driving in, not a
       dot on the horizon — otherwise one car placed 220m up the road
       satisfies the test for the next half-minute. */
    if (f > 6 && f < 150 && Math.abs(l) < 7 && Math.cos(c.yaw - bus.yaw) > 0.5) ahead += 1;
  }
  const want = Math.round(cars.length * clamp(reg.traffic * 0.62, 0.12, 1));
  /* Population alone is not enough. Cars scattered over the side streets
     satisfy the head-count while the road the player is actually on stays
     empty for minutes at a time, so there is a second condition: while the
     bus is moving there should be somebody in front of it. */
  let needAhead = bus.speed > 2.5 && ahead === 0;
  if (near >= want && !needAhead) return;

  const probe = { x: 0, z: 0 };
  const slot = { i: 0, j: 0, di: 0, dj: 0, s: 0, slower: false };
  for (let k = 0; k < cars.length && (near < want || needAhead); k += 1) {
    const c = cars[k];
    const dx = c.x - bus.x, dz = c.z - bus.z;
    const d2 = dx * dx + dz * dz;
    const far = d2 > RECYCLE_FAR * RECYCLE_FAR;
    /* When the road ahead is the thing that needs filling, any car the
       player cannot currently see is fair game, not just the distant ones. */
    let offScreen = false;
    if (!far && needAhead) {
      const d = Math.sqrt(d2) || 1;
      offScreen = d > sight || (dx * sy + dz * cy) / d < Math.cos(1.31);
    }
    if (!far && !offScreen) continue;

    for (let attempt = 0; attempt < 24; attempt += 1) {
      let placed = false;
      /* Prefer the road the bus is actually on. Scattering traffic over the
         whole grid leaves cars near the bus but almost never in front of it,
         so the player never sees one followed, queued behind or given way to.
         Alternate between traffic met head-on down the road ahead and cross
         traffic arriving from just outside the frame. */
      const wantCross = !needAhead && (k + attempt) % 2 === 0;
      if (attempt < 18) {
        const ok = wantCross
          ? (placeOffCamera(slot, state, rng) || placeAheadOfBus(slot, state, rng))
          : (placeAheadOfBus(slot, state, rng) || placeOffCamera(slot, state, rng));
        if (ok) {
          lanePoint(slot.i, slot.j, slot.di, slot.dj, slot.s, probe,
            laneOffset(slot.dj !== 0, slot.dj !== 0 ? slot.i : slot.j, 0));
          placed = true;
        }
      }
      if (!placed) {
        const vertical = rng() < 0.5;
        const i = Math.floor(rng() * (GRID + 1));
        const j = Math.floor(rng() * (GRID + 1));
        let di = 0, dj = 0;
        if (vertical) dj = rng() < 0.5 ? 1 : -1; else di = rng() < 0.5 ? 1 : -1;
        if (!inGrid(i + di, j + dj)) { di = -di; dj = -dj; }
        // leave room to read the next junction rather than landing on it
        const span = edgeSpan(i, j, di, dj);
        if (span < 45) continue;
        const u = 8 + rng() * (span - 40);
        slot.i = i; slot.j = j; slot.di = di; slot.dj = dj; slot.s = u;
        slot.slower = false;
        lanePoint(i, j, di, dj, u, probe, laneOffset(dj !== 0, dj !== 0 ? i : j, 0));
      }

      const sight = sightOf(state);
      const d = Math.hypot(probe.x - bus.x, probe.z - bus.z);
      if (d < 55 || d > sight + 10 + RECYCLE_SPAN) continue;
      /* Whichever branch proposed this spot, a car must never appear where
         the player can see it happen: inside the draw distance and inside
         the camera cone is out of bounds. */
      const fwdN = ((probe.x - bus.x) * Math.sin(bus.yaw)
        + (probe.z - bus.z) * Math.cos(bus.yaw)) / d;
      if (d < sight && fwdN > Math.cos(1.31)) continue;
      /* Drop most of them ahead of the bus. Spreading them evenly around
         it wastes the slower vehicles behind the camera, which is exactly
         where the SUVs ended up once the bus had overtaken them. */
      if (attempt < 16) {
        const fx = (probe.x - bus.x) * Math.sin(bus.yaw) + (probe.z - bus.z) * Math.cos(bus.yaw);
        if (fx < d * 0.15) continue;
      }
      let clear = true;
      for (let m = 0; m < cars.length; m += 1) {
        if (m === k) continue;
        const o = cars[m];
        if ((o.x - probe.x) ** 2 + (o.z - probe.z) ** 2 < 16 * 16) { clear = false; break; }
      }
      if (!clear) continue;
      /* The lane maths says this is a lane; the world has the final word.
         Off the tarmac, inside a building, or down a tunnel bore that is
         not drawn from out here — any of those and the car would appear
         somewhere impossible, so the slot is thrown away and another
         tried. This is the check that was missing. */
      if (!spawnValid(state, probe.x, probe.z, slot.di, slot.dj)) continue;

      // every check passed: only now does the car actually move
      /* A car dropped up the road in the player's own direction gets a
         gentler pace, so the bus closes on it instead of watching it
         disappear. Plenty of real traffic dawdles. */
      c.pace = slot.slower ? 0.58 + rng() * 0.2 : 1;
      seatCar(c, slot.i, slot.j, slot.di, slot.dj, slot.s, rng, 0.5 + rng() * 0.4);
      c.accel = 0;
      c.stuck = 0;
      c.yieldCool = 0;
      if (!far) near += 0; else near += 1;
      if (slot.slower) needAhead = false;
      break;
    }
  }
}

const _tgt = { x: 0, z: 0 };
const _ideal = { x: 0, z: 0 };

function stepCars(state, dt) {
  const { cars, city, bus, rng } = state;

  for (let k = 0; k < cars.length; k += 1) {
    const c = cars[k];
    const b = c.b;
    let target = c.cruise;

    /* ---- ease off for the corner we are about to take ---- */
    const dJunc = distToJunction(c);
    if (c.phase === "corner") {
      if (c.turning) target = Math.min(target, b.cornerSpeed);
    } else if (c.turning && dJunc < 55) {
      // plan the deceleration so it is gradual rather than a late stab
      const v = Math.sqrt(Math.max(0, b.cornerSpeed * b.cornerSpeed
        + 2 * COMFORT_DECEL * Math.max(0, dJunc)));
      target = Math.min(target, v);
    }

    /* ---- traffic light at the node ahead ---- */
    const ni = c.i + c.di, nj = c.j + c.dj;
    const light = lightAt(city.lights, ni, nj);
    if (light && c.phase === "edge") {
      const st = lightFor(light, c.dj !== 0);
      // hold slightly past the line too: a car that crept over must not
      // simply give up and drive on through the red
      if (st !== "green" && dJunc > -2.5) {
        // amber is only worth stopping for if it can be done comfortably
        const canStop = dJunc > (c.speed * c.speed) / (2 * b.brakeMax) - 1;
        if (st === "red" || canStop) {
          /* A pure sqrt profile only ever approaches the line asymptotically,
             so the car creeps across it and then finds the light behind it.
             Flattening the last half metre to zero makes it actually stop. */
          const v = dJunc <= 0.8
            ? 0
            : Math.sqrt(2 * LIGHT_DECEL * (dJunc - 0.8));
          target = Math.min(target, v);
        }
      }
    } else if (!light && c.phase === "edge" && dJunc < 26 && dJunc > 0) {
      // unlit crossroads: slow to a give-way pace before entering
      target = Math.min(target, 7.5 + dJunc * 0.2);
    }

    /* ---- lead vehicle and hazards, the bus included ---- */
    const sy = Math.sin(c.yaw), cy = Math.cos(c.yaw);
    for (let m = -1; m < cars.length; m += 1) {
      if (m === k) continue;
      const o = m < 0 ? bus : cars[m];
      const ow = m < 0 ? BUS.wid : o.w;
      const ol = m < 0 ? BUS.len : o.l;
      const dx = o.x - c.x, dz = o.z - c.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 55 * 55) continue;

      const fwd = dx * sy + dz * cy;
      const lat = dx * cy - dz * sy;
      // something directly ahead in my lane: hold a speed-dependent gap
      if (fwd > 0) {
        const halfW = (c.w + ow) / 2 + 0.4 + fwd * 0.05;
        if (Math.abs(lat) < halfW) {
          const gap = fwd - (c.l + ol) / 2;
          const safe = Math.max(0, (gap - b.minGap) / b.headway);
          if (safe < target) target = safe;
        }
      }

      /* Cross traffic never reads as "ahead" until it is too late, so also
         compare where the two of us will be in a moment. */
      if (c.yieldCool <= 0 && d2 < 34 * 34) {
        const oSpeed = m < 0 ? Math.abs(bus.speed) : o.speed;
        const osy = Math.sin(o.yaw), ocy = Math.cos(o.yaw);
        const T = 1.2;
        const px = (c.x + sy * c.speed * T) - (o.x + osy * oSpeed * T);
        const pz = (c.z + cy * c.speed * T) - (o.z + ocy * oSpeed * T);
        const clearance = (c.l + ol) * 0.42;
        if (px * px + pz * pz < clearance * clearance && fwd > -2) {
          // only one of a pair may give way, or both sit there for ever
          const yields = m < 0 ? true
            : (c.speed < o.speed || (c.speed === o.speed && k > m));
          if (yields) target = Math.min(target, 0);
        }
      }
    }

    /* ---- grumble at the player when blocked ---- */
    const bdx = bus.x - c.x, bdz = bus.z - c.z;
    const bfwd = bdx * sy + bdz * cy;
    const blat = bdx * cy - bdz * sy;
    if (bfwd > 0 && bfwd < 20 && Math.abs(blat) < 3.4
      && target < 1.2 && c.honk <= 0 && Math.abs(bus.speed) < 0.6) {
      c.honk = 4 + rng() * 6;
      state.events.push({ type: "trafficHorn" });
    }
    c.honk = Math.max(0, c.honk - dt);
    c.yieldCool = Math.max(0, c.yieldCool - dt);

    /* ---- nothing has moved for a while: relax the rules so it clears ---- */
    if (c.speed < 0.4) c.stuck += dt; else c.stuck = 0;
    if (c.stuck > 5) {
      target = Math.max(target, 2.2);
      c.yieldCool = 2.5;
      if (c.stuck > 14) c.stuck = 0;
    }

    /* ---- longitudinal: rate and jerk limited ---- */
    target = clamp(target, 0, c.cruise);
    /* Plain proportional control fades to nothing as the error shrinks, so a
       car asked to stop would creep forward for ever and drift across the
       line. Asking for a full stop needs real braking authority behind it. */
    const want = target <= 0.05 && c.speed > 0
      ? -Math.max(1.6, Math.min(b.brakeMax, c.speed / 0.35))
      : clamp((target - c.speed) * 1.6, -b.brakeMax, b.accelMax);
    c.accel += clamp(want - c.accel, -b.jerk * dt, b.jerk * dt);
    c.speed = Math.max(0, c.speed + c.accel * dt);
    if (c.speed < 0.05 && target <= 0.05) { c.speed = 0; c.accel = 0; }
    if (c.speed === 0 && c.accel < 0) c.accel = 0;
    c.brakeGlow = c.accel < -0.35 && c.speed > 0.3;

    const travel = c.speed * dt;

    /* ---- advance along the route ---- */
    if (c.phase === "edge") {
      c.s += travel;
      if (c.s >= c.entry) {
        c.cs = c.s - c.entry;
        c.phase = "corner";
      }
    } else {
      c.cs += travel;
      if (c.cs >= c.cornerLen) {
        const over = c.cs - c.cornerLen;
        const exit0 = c.exit0;
        c.i = clamp(c.i + c.di, 0, GRID);
        c.j = clamp(c.j + c.dj, 0, GRID);
        c.di = c.ndi; c.dj = c.ndj;
        c.lane = c.nlane;
        c.s = exit0 + over;
        c.phase = "edge";
        const nxt = chooseNext(c, rng);
        c.ndi = nxt[0]; c.ndj = nxt[1];
        buildCorner(c);
      }
    }

    /* ---- steering: aim at a point down the path ---- */
    const look = clamp(b.lookBase + c.speed * 0.75, 4, 16);
    pathAhead(c, look, _tgt);
    const desired = Math.atan2(_tgt.x - c.x, _tgt.z - c.z);
    const err = wrapAngle(desired - c.yaw);
    // a real car cannot pivot on the spot: yaw rate is bounded by speed
    const maxRate = Math.min(1.5, 0.18 + c.speed / 6);
    const wanted = clamp(err * b.steerGain, -maxRate, maxRate);
    c.yawRate += clamp(wanted - c.yawRate, -6 * dt, 6 * dt);
    c.yaw = wrapAngle(c.yaw + c.yawRate * dt);

    c.x += Math.sin(c.yaw) * travel;
    c.z += Math.cos(c.yaw) * travel;

    /* Pure pursuit corrects its own drift, but a shunt from the bus can
       throw a car far enough off that it would never find the lane again. */
    pathAhead(c, 0, _ideal);
    const offX = _ideal.x - c.x, offZ = _ideal.z - c.z;
    const off = Math.hypot(offX, offZ);
    if (off > 1.2) {
      const pull = Math.min(1, (off - 1.2) * 0.9 * dt);
      c.x += offX * pull;
      c.z += offZ * pull;
    }

    /* ---- follow the road surface ---- */
    /* Follow the surface tightly. At 12 the height lagged 20cm behind on a
       mountain grade, which reads as the car sinking into the climb and
       floating over the crest. */
    const ty = vehicleHeightAt(c.x, c.z);
    c.y = Math.abs(ty - c.y) > 3 ? ty : lerp(c.y, ty, Math.min(1, dt * 26));
    c.pitch = Math.atan(slopeAlong(c.x, c.z, c.yaw));
  }

  /* ---- never let two cars occupy the same patch of road ---- */
  for (let a = 0; a < cars.length; a += 1) {
    for (let bi = a + 1; bi < cars.length; bi += 1) {
      const p = cars[a], q = cars[bi];
      const dx = q.x - p.x, dz = q.z - p.z;
      const d2 = dx * dx + dz * dz;
      const rad = (p.l + q.l) * 0.34;
      if (d2 > rad * rad || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const push = (rad - d) * 0.5;
      const nx = dx / d, nz = dz / d;
      p.x -= nx * push; p.z -= nz * push;
      q.x += nx * push; q.z += nz * push;
      // bleed speed off at a believable rate rather than slamming it down
      const shed = 3.5 * dt;
      if (p.speed > q.speed) p.speed = Math.max(0, p.speed - shed);
      else q.speed = Math.max(0, q.speed - shed);
    }
  }

  /* ---- collisions with the player's bus ---- */
  for (let k = 0; k < cars.length; k += 1) {
    const c = cars[k];
    const dx = c.x - bus.x, dz = c.z - bus.z;
    const d2 = dx * dx + dz * dz;
    if (d2 >= 100) continue;
    const bf = dx * Math.sin(bus.yaw) + dz * Math.cos(bus.yaw);
    const bl = dx * Math.cos(bus.yaw) - dz * Math.sin(bus.yaw);
    if (Math.abs(bf) >= BUS.len / 2 + c.l / 2 - 0.6) continue;
    if (Math.abs(bl) >= BUS.wid / 2 + c.w / 2 - 0.2) continue;

    const rel = Math.abs(bus.speed - c.speed * Math.cos(bus.yaw - c.yaw));
    if (state.hitCooldown <= 0 && rel > 0.8) {
      state.hitCooldown = 1.1;
      state.stats.collisions += 1;
      state.penalties += Math.round(10 + rel * 2.2);
      state.bus.damage = Math.min(100, state.bus.damage + rel * 1.8);
      state.bus.shake = Math.min(1, rel / 9);
      state.events.push({ type: "crash", impact: rel });
      say(state, "Collision with traffic", "bad", 2.2);
    }
    // Separate them. A car that could not be moved would be an immovable
    // wall the bus could pin itself against forever.
    const dist = Math.sqrt(d2) || 1;
    const nx = dx / dist, nz = dz / dist;
    const push = Math.max(0.15, 5.8 - dist) * 0.5;
    c.x += nx * push * 0.55;
    c.z += nz * push * 0.55;
    bus.x -= nx * push * 0.3;
    bus.z -= nz * push * 0.3;
    bus.speed *= 0.8;
    c.speed *= 0.45;
    c.yieldCool = 1.5;
  }
}

/* ---------------------------- pedestrians ---------------------------- */

function pedPose(p) {
  if (p.mode === "cross" && p.cross) {
    const c = p.cross;
    p.x = lerp(c.x0, c.x1, c.t);
    p.z = lerp(c.z0, c.z1, c.t);
    p.yaw = Math.atan2(c.x1 - c.x0, c.z1 - c.z0);
    p.y = roadHeightAt(p.x, p.z);
    return;
  }
  const { x0, x1, z0, z1 } = cellWalk(p.i, p.j);
  const w = Math.max(2, x1 - x0), d = Math.max(2, z1 - z0);
  const per = 2 * (w + d);
  const t = ((p.t % 1) + 1) % 1;
  let s = t * per;
  if (s < w) { p.x = x0 + s; p.z = z0; p.yaw = Math.PI / 2 * (p.dir > 0 ? 1 : -1); }
  else if (s < w + d) { s -= w; p.x = x1; p.z = z0 + s; p.yaw = p.dir > 0 ? 0 : Math.PI; }
  else if (s < w * 2 + d) { s -= w + d; p.x = x1 - s; p.z = z1; p.yaw = -Math.PI / 2 * (p.dir > 0 ? 1 : -1); }
  else { s -= w * 2 + d; p.x = x0; p.z = z1 - s; p.yaw = p.dir > 0 ? Math.PI : 0; }
  p.y = roadHeightAt(p.x, p.z);
}

function stepPeds(state, dt) {
  const { peds, bus, rng } = state;
  for (let k = 0; k < peds.length; k += 1) {
    const p = peds[k];
    p.cool = Math.max(0, p.cool - dt);

    /* Out in the country there is nobody about, so anyone whose block is
       far behind is quietly relocated to a populated cell near the bus. */
    if ((p.x - bus.x) ** 2 + (p.z - bus.z) ** 2 > 460 * 460) {
      const bi = cellIndexX(bus.x), bj = cellIndexZ(bus.z);
      if (populated(cellRegion(bi, bj))) {
        p.i = clamp(bi + (rng() < 0.5 ? 0 : 1) - 1, 0, GRID - 1);
        p.j = clamp(bj + (rng() < 0.5 ? 0 : 1) - 1, 0, GRID - 1);
        p.mode = "walk";
        p.t = rng();
      }
    }

    if (p.mode === "cross") {
      const c = p.cross;
      const dx = bus.x - p.x, dz = bus.z - p.z;
      const d2 = dx * dx + dz * dz;
      /* Somebody caught in the road as a bus bears down gets on with it.
         The old rule stopped them dead, which left a figure standing in
         the carriageway for as long as the bus took to arrive; hurrying
         clears the lane, and only a bus close enough to actually hit them
         is worth waiting behind. */
      const hurry = d2 < 900 && Math.abs(bus.speed) > 2.5 ? 1.9 : 1;
      const halt = d2 < 42 && Math.abs(bus.speed) > 2.5;
      const near = halt;
      if (!near) c.t += (p.speed * hurry / c.len) * dt;
      p.phase += dt * 7 * (near ? 0 : hurry);
      if (c.t >= 1) { p.mode = "walk"; p.i = c.ti; p.j = c.tj; p.t = c.tt; p.cool = 8 + rng() * 12; }
    } else {
      const { x0, x1, z0, z1 } = cellWalk(p.i, p.j);
      const per = 2 * (Math.max(2, x1 - x0) + Math.max(2, z1 - z0));
      p.t += (p.dir * p.speed / per) * dt;
      p.phase += dt * 6;
      /* Start a crossing now and then, from a mid-block point. A crossing
         takes a dozen seconds, so this rate is what decides how much of
         the population is standing in the carriageway at any moment: the
         old figure kept most of them out there at once, which passed as
         background motion when they were boxes and reads as a crowd
         blocking the road now they are people. */
      if (p.cool <= 0 && rng() < dt * 0.012) startCross(state, p);
    }
    pedPose(p);

    // contact with the bus
    const dx = p.x - bus.x, dz = p.z - bus.z;
    if (dx * dx + dz * dz < 60) {
      const bf = dx * Math.sin(bus.yaw) + dz * Math.cos(bus.yaw);
      const bl = dx * Math.cos(bus.yaw) - dz * Math.sin(bus.yaw);
      if (Math.abs(bf) < BUS.len / 2 + 0.4 && Math.abs(bl) < BUS.wid / 2 + 0.4 && Math.abs(bus.speed) > 1.2) {
        if (state.hitCooldown <= 0) {
          state.hitCooldown = 2;
          state.stats.pedHits += 1;
          state.penalties += 65;
          state.comfort -= 20;
          state.events.push({ type: "pedHit" });
          say(state, "You knocked a pedestrian — huge penalty", "bad", 4);
        }
        // move them clear so it cannot repeat every frame
        p.mode = "walk";
        p.t += 0.06;
        p.cool = 15;
      }
    }
  }
}

function startCross(state, p) {
  const { rng, bus, peds } = state;
  /* Nobody steps off the kerb in front of a moving coach. Without this a
     pedestrian could start a crossing the instant before the bus arrived,
     then freeze mid-lane waiting for it — a person standing in the road,
     which is exactly what it looked like. */
  const bdx = p.x - bus.x, bdz = p.z - bus.z;
  const bd = Math.hypot(bdx, bdz);
  if (bd < 80 && Math.abs(bus.speed) > 2) {
    const fwd = (bdx * Math.sin(bus.yaw) + bdz * Math.cos(bus.yaw)) / (bd || 1);
    if (fwd > 0.2) return;
  }
  /* Nor do four people cross abreast. They share a pavement loop, so they
     bunch up, and without this they set off together as a knot. */
  for (let k = 0; k < peds.length; k += 1) {
    const o = peds[k];
    if (o === p || o.mode !== "cross") continue;
    if ((o.x - p.x) ** 2 + (o.z - p.z) ** 2 < 12 * 12) return;
  }
  const vertical = rng() < 0.5;
  const { x0, x1, z0, z1 } = cellWalk(p.i, p.j);
  let sx, sz, ex, ez, ti = p.i, tj = p.j;

  if (vertical) {
    const goEast = rng() < 0.5;
    if (goEast && p.i + 1 > GRID - 1) return;
    if (!goEast && p.i - 1 < 0) return;
    const line = goEast ? p.i + 1 : p.i;
    const mid = paveMid(true, line);
    const at = LX[line];
    const z = z0 + rng() * Math.max(1, z1 - z0);
    sx = at - (goEast ? mid : -mid);
    ex = at + (goEast ? mid : -mid);
    sz = z; ez = z;
    ti = goEast ? p.i + 1 : p.i - 1;
  } else {
    const goNorth = rng() < 0.5;
    if (goNorth && p.j + 1 > GRID - 1) return;
    if (!goNorth && p.j - 1 < 0) return;
    const line = goNorth ? p.j + 1 : p.j;
    const mid = paveMid(false, line);
    const at = LZ[line];
    const x = x0 + rng() * Math.max(1, x1 - x0);
    sz = at - (goNorth ? mid : -mid);
    ez = at + (goNorth ? mid : -mid);
    sx = x; ex = x;
    tj = goNorth ? p.j + 1 : p.j - 1;
  }
  const len = Math.hypot(ex - sx, ez - sz);
  if (!len) return;
  p.mode = "cross";
  p.cross = { x0: sx, z0: sz, x1: ex, z1: ez, t: 0, len, ti, tj, tt: p.t };
}

/* ---------------------------- traffic rules ---------------------------- */

function checkRedLight(state) {
  const { bus, city } = state;
  if (Math.abs(bus.speed) < 1.5) return;
  const i = bandIndexX(bus.x), j = bandIndexZ(bus.z);
  const node = i * (GRID + 1) + j;
  const l = lightAt(city.lights, i, j);
  if (!l) return;
  const inside = Math.abs(bus.x - l.x) < vClass(i).half + 0.5
    && Math.abs(bus.z - l.z) < hClass(j).half + 0.5;
  if (!inside) { if (state.lastLightNode === node) state.lastLightNode = -1; return; }
  if (state.lastLightNode === node) return;
  state.lastLightNode = node;

  const vertical = Math.abs(Math.cos(bus.yaw)) > Math.abs(Math.sin(bus.yaw));
  const st = lightFor(l, vertical);
  if (st === "red") {
    state.stats.redLights += 1;
    state.penalties += state.diff.lightPenalty;
    state.events.push({ type: "redLight" });
    say(state, "Ran a red light", "bad", 2.6);
  }
}

/* ------------------------------ boarding ------------------------------ */

function stepBoarding(state, dt) {
  const { bus, city } = state;
  if (state.activeStopId < 0) return;
  const stop = city.stops[state.activeStopId];
  const d = Math.hypot(bus.x - stop.x, bus.z - stop.z);
  const stopped = Math.abs(bus.speed) < 0.35;

  if (state.phase === "driving") {
    if (d < 8.5 && stopped && bus.doorT >= 1) {
      state.phase = "boarding";
      state.boardTimer = 0;
      // score the stop quality
      const kerbGap = Math.abs(
        stop.vertical ? bus.x - stop.x : bus.z - stop.z,
      );
      const aligned = d < 4.2 && kerbGap < 1.6;
      if (aligned) {
        state.stats.perfectStops += 1;
        state.money += 25;
        say(state, "Textbook stop — passenger bonus", "good", 2.6);
      } else {
        say(state, `Stopped at ${stop.name}`, "info", 2.2);
      }
      state.events.push({ type: "arrive" });
      state.events.push({ type: "autosave" });
    }
    return;
  }

  // boarding: alight first, then board
  state.boardTimer += dt;
  const tick = 0.34;
  if (state.boardTimer >= tick) {
    state.boardTimer -= tick;
    const idx = bus.onboard.findIndex((p) => p.to === stop.id);
    if (idx >= 0) {
      bus.onboard.splice(idx, 1);
      state.events.push({ type: "step" });
      return;
    }
    if (stop.waiting.length && bus.onboard.length < CAPACITY) {
      const p = stop.waiting.shift();
      bus.onboard.push(p);
      state.money += FARE;
      state.carried += 1;
      stop.boarded += 1;
      state.events.push({ type: "coin" });
      return;
    }
    // everyone is aboard
    if (!stop.served) {
      stop.served = true;
      state.events.push({ type: "ready" });
      say(state, "All aboard — close the doors to continue", "good", 4);
    }
  }
}

function advanceStop(state) {
  const { city } = state;
  state.phase = "driving";
  const wasLast = state.routeIdx >= city.stops.length - 1;
  if (wasLast) {
    if (state.mode !== "free") {
      finish(state);
      return;
    }
    // free drive never ends: loop the route and refill the shelters
    state.routeIdx = 0;
    state.activeStopId = 0;
    makePassengers(state.rng, city.stops);
    state.bus.onboard.length = 0;
    refreshGuide(state);
    say(state, `Round again — next stop: ${city.stops[0].name}`, "info", 4);
    state.events.push({ type: "announce", text: city.stops[0].name });
    state.events.push({ type: "autosave" });
    return;
  }
  state.routeIdx += 1;
  state.activeStopId = state.routeIdx;
  refreshGuide(state);
  const next = city.stops[state.activeStopId];
  say(state, `Next stop: ${next.name}`, "info", 4);
  state.events.push({ type: "announce", text: next.name });
  state.events.push({ type: "autosave" });
}

function finish(state) {
  state.phase = "finished";
  state.activeStopId = -1;
  const timeBonus = state.mode === "free" ? 0 : Math.max(0, Math.round(state.timeLeft * 1.6));
  const comfortBonus = Math.round(state.comfort * 1.4);
  state.money += timeBonus + comfortBonus;
  state.finalTimeBonus = timeBonus;
  state.finalComfortBonus = comfortBonus;
  const net = Math.max(0, state.money - state.penalties);
  state.net = net;
  const perfect = state.stats.perfectStops;
  let stars = 1;
  if (net > 260 && state.stats.pedHits === 0) stars = 2;
  if (net > 420 && state.stats.redLights <= 1 && state.stats.pedHits === 0) stars = 3;
  if (net > 560 && state.stats.collisions <= 1 && state.comfort > 70 && perfect >= 4) stars = 4;
  if (net > 700 && state.stats.collisions === 0 && state.stats.redLights === 0 && state.comfort > 85) stars = 5;
  state.stars = stars;
  state.events.push({ type: "finish", stars });
  state.events.push({ type: "routeDone" });
}

/* -------------------------------- step -------------------------------- */

function trackRegion(state, dt) {
  const { bus } = state;
  const reg = regionAt(bus.x, bus.z);
  state.tunnel = tunnelDepthAt(bus.x, bus.z);
  if (reg === state.region) { state.regionT += dt; return; }
  // require a moment inside the new region so a corner does not flicker
  state.regionT += dt;
  if (state.regionT < 1.1) return;
  state.region = reg;
  state.regionT = 0;
  const key = REGION[reg].key;
  if (!state.regionSeen.includes(key)) state.regionSeen.push(key);
  say(state, `Now entering ${REGION[reg].name}`, "info", 3.2);
  state.events.push({ type: "region", key, name: REGION[reg].name });
}

export function stepGame(state, input, frameDt) {
  const dt = Math.min(0.05, frameDt);
  state.acc += dt;
  const STEP = 1 / 120;
  let guard = 0;
  while (state.acc >= STEP && guard < 10) {
    state.acc -= STEP;
    guard += 1;
    if (state.phase !== "finished") {
      stepBus(state, input, STEP);
      recycleTraffic(state, STEP);
      stepCars(state, STEP);
      stepPeds(state, STEP);
      stepLights(state.city.lights, STEP);
      checkRedLight(state);
      stepBoarding(state, STEP);
      trackRegion(state, STEP);
      state.t += STEP;
      state.totalTime += STEP;
      if (state.mode === "route" && state.phase !== "finished") {
        state.timeLeft -= STEP;
        if (state.timeLeft <= 0) { state.timeLeft = 0; finish(state); }
      }
    }
  }

  state.messageT = Math.max(0, state.messageT - dt);
  if (state.messageT === 0) state.message = null;

  state.guideTimer -= dt;
  if (state.guideTimer <= 0 && state.phase === "driving") {
    state.guideTimer = 0.7;
    refreshGuide(state);
  }
  return state;
}

/* --------------------------- save and restore --------------------------- */

/** Everything needed to put the player back where they were. */
export function snapshot(state) {
  const { bus, city } = state;
  return {
    seed: state.seed,
    routeId: state.routeId,
    mode: state.mode,
    difficulty: state.difficulty,
    dusk: state.dusk,
    bus: {
      x: bus.x, z: bus.z, yaw: bus.yaw,
      gear: bus.gear, fuel: bus.fuel, damage: bus.damage,
      headlights: bus.headlights, indicator: bus.indicator,
      onboard: bus.onboard.map((p) => p.to),
    },
    routeIdx: state.routeIdx,
    activeStopId: state.activeStopId,
    phase: state.phase === "finished" ? "driving" : state.phase,
    region: state.region,
    regionSeen: state.regionSeen.slice(),
    money: state.money,
    penalties: state.penalties,
    carried: state.carried,
    comfort: state.comfort,
    timeLeft: Number.isFinite(state.timeLeft) ? state.timeLeft : null,
    totalTime: state.totalTime,
    stats: { ...state.stats },
    stops: city.stops.map((s) => ({
      served: !!s.served,
      boarded: s.boarded || 0,
      waiting: (s.waiting || []).map((p) => p.to),
    })),
  };
}

/**
 * Rebuilds a game from a snapshot. The world itself is regenerated from
 * the seed, so only the mutable state has to be restored — and the bus
 * position is validated against the freshly built roads before it is
 * trusted, which is what stops a stale save dropping the player inside a
 * building or off the end of a bridge.
 */
export function restore(snap) {
  const state = makeGame({
    seed: snap.seed,
    mode: snap.mode,
    difficulty: snap.difficulty,
    dusk: snap.dusk,
    routeId: snap.routeId,
  });
  const { bus, city } = state;

  const n = Math.min(snap.stops ? snap.stops.length : 0, city.stops.length);
  for (let i = 0; i < n; i += 1) {
    const s = city.stops[i], t = snap.stops[i];
    s.served = !!t.served;
    s.boarded = t.boarded || 0;
    s.waiting = (t.waiting || []).map((to) => ({ to: clamp(to | 0, 0, city.stops.length - 1) }));
  }

  state.routeIdx = clamp(snap.routeIdx | 0, 0, city.stops.length - 1);
  state.activeStopId = snap.activeStopId >= 0
    ? clamp(snap.activeStopId | 0, 0, city.stops.length - 1)
    : state.routeIdx;
  state.phase = snap.phase === "boarding" ? "boarding" : "driving";
  state.money = +snap.money || 0;
  state.penalties = +snap.penalties || 0;
  state.carried = snap.carried | 0;
  state.comfort = clamp(+snap.comfort || 100, 0, 100);
  state.totalTime = +snap.totalTime || 0;
  state.timeLeft = snap.mode === "free" || snap.timeLeft === null
    ? Infinity
    : Math.max(0, +snap.timeLeft || 0);
  if (snap.stats) Object.assign(state.stats, snap.stats);
  if (Array.isArray(snap.regionSeen)) state.regionSeen = snap.regionSeen.slice();

  const b = snap.bus || {};
  bus.gear = b.gear === "R" || b.gear === "N" ? b.gear : "D";
  bus.fuel = Number.isFinite(+b.fuel) ? clamp(+b.fuel, 0, 1) : 1;
  bus.damage = clamp(+b.damage || 0, 0, 100);
  bus.headlights = !!b.headlights;
  bus.indicator = b.indicator === "left" || b.indicator === "right" ? b.indicator : null;
  bus.onboard = (b.onboard || []).slice(0, CAPACITY)
    .map((to) => ({ to: clamp(to | 0, 0, city.stops.length - 1) }));

  const placed = placeBusSafely(state, +b.x, +b.z, +b.yaw);
  state.region = regionAt(bus.x, bus.z);
  state.regionT = 0;
  refreshGuide(state);
  // traffic is regenerated, so make sure nothing spawned on top of the bus
  clearAround(state, 22);
  return { state, moved: !placed };
}

/**
 * Puts the bus at the saved spot when that spot is still legal, and on the
 * nearest lane when it is not.
 */
function placeBusSafely(state, x, z, yaw) {
  const { bus } = state;
  const ok = Number.isFinite(x) && Number.isFinite(z) && Number.isFinite(yaw)
    && x > LX[0] - 40 && x < LX[GRID] + 40
    && z > LZ[0] - 40 && z < LZ[GRID] + 40;
  if (ok) {
    bus.x = x; bus.z = z; bus.yaw = yaw;
    // every corner of the bus has to be off the blocks
    busCorners(bus, cornerBuf);
    let clean = true;
    for (let i = 0; i < 4; i += 1) {
      if (surfaceAt(cornerBuf[i * 2], cornerBuf[i * 2 + 1]) === SURFACE_BLOCK) { clean = false; break; }
    }
    if (clean && surfaceAt(x, z) !== SURFACE_BLOCK) {
      bus.y = vehicleHeightAt(bus.x, bus.z);
      bus.speed = 0;
      return true;
    }
  }
  const pose = nearestRoadPose(
    Number.isFinite(x) ? x : bus.x,
    Number.isFinite(z) ? z : bus.z,
    Number.isFinite(yaw) ? yaw : bus.yaw,
  );
  bus.x = pose.x; bus.z = pose.z; bus.yaw = pose.yaw;
  bus.y = vehicleHeightAt(bus.x, bus.z);
  bus.speed = 0;
  return false;
}

/** Shove any traffic that happens to be sitting on the bus out of the way. */
function clearAround(state, radius) {
  const { cars, bus, rng } = state;
  for (let k = 0; k < cars.length; k += 1) {
    const c = cars[k];
    if ((c.x - bus.x) ** 2 + (c.z - bus.z) ** 2 > radius * radius) continue;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const i = Math.floor(rng() * (GRID + 1));
      const j = Math.floor(rng() * (GRID + 1));
      let di = 0, dj = 0;
      if (rng() < 0.5) dj = rng() < 0.5 ? 1 : -1; else di = rng() < 0.5 ? 1 : -1;
      if (!inGrid(i + di, j + dj)) { di = -di; dj = -dj; }
      const span = edgeSpan(i, j, di, dj);
      if (span < 45) continue;
      const s = 8 + rng() * (span - 40);
      seatCar(c, i, j, di, dj, s, rng);
      if ((c.x - bus.x) ** 2 + (c.z - bus.z) ** 2 > 90 * 90) break;
    }
  }
}

/* --------------------------- player commands --------------------------- */

export function toggleDoors(state) {
  const bus = state.bus;
  if (Math.abs(bus.speed) > 0.7 && !bus.doors) {
    say(state, "Come to a stop before opening the doors", "warn", 2);
    return;
  }
  if (bus.doors && state.phase === "boarding") {
    const stop = state.city.stops[state.activeStopId];
    if (stop && !stop.served && (stop.waiting.length || state.bus.onboard.some((p) => p.to === stop.id))) {
      say(state, "Passengers are still boarding", "warn", 2);
      return;
    }
    bus.doors = false;
    advanceStop(state);
    return;
  }
  bus.doors = !bus.doors;
}

export function toggleGear(state) {
  const bus = state.bus;
  if (Math.abs(bus.speed) > 0.6) {
    say(state, "Stop fully before changing gear", "warn", 1.8);
    return;
  }
  bus.gear = bus.gear === "D" ? "R" : bus.gear === "R" ? "N" : "D";
  state.events.push({ type: "gear" });
}

export function setIndicator(state, side) {
  state.bus.indicator = state.bus.indicator === side ? null : side;
  state.events.push({ type: "indicator", on: !!state.bus.indicator });
}

export function toggleHeadlights(state) {
  state.bus.headlights = !state.bus.headlights;
}

export function ringBell(state) {
  state.events.push({ type: "bell" });
}

export { clamp, lerp };
