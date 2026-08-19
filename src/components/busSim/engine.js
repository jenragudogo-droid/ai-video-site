/* ------------------------------------------------------------------ *
 * City Bus Simulator — simulation.
 *
 * Runs on a fixed 1/120s step so the physics stay stable regardless of
 * frame rate. The renderer only ever reads state; nothing in here
 * touches the DOM.
 * ------------------------------------------------------------------ */

import {
  BLOCK, GRID, ROAD_HALF, KERB, LANE, CITY_SPAN,
  SURFACE_PAVE, SURFACE_BLOCK,
  makeCity, surfaceAt, pushOut, bandIndex, findPath,
  stepLights, lightFor, mulberry32, clamp, lerp,
} from "./city.js";
import { BUS } from "./render.js";

export const CAPACITY = 42;
export const FARE = 3.2;
export const TOP_SPEED = 23.5;      // m/s  (~85 km/h)
export const REVERSE_SPEED = 6.5;
const MASS = 12000;
const MAX_FORCE = 36000;
const BRAKE_FORCE = 30000;
const DRAG = 3.6;
const ROLL = 1700;

export const DIFFICULTY = {
  easy:   { label: "Trainee",   traffic: 16, peds: 26, timePerStop: 105, burn: 0.7, lightPenalty: 15 },
  normal: { label: "Driver",    traffic: 28, peds: 40, timePerStop: 82,  burn: 1,   lightPenalty: 25 },
  hard:   { label: "Rush hour", traffic: 44, peds: 58, timePerStop: 66,  burn: 1.5, lightPenalty: 40 },
};

const CAR_COLORS = [
  "#c0392b", "#2c6fb5", "#e0e3e8", "#2f3640", "#27865c",
  "#d9a441", "#8e44ad", "#b9c0c9", "#1f6f78", "#a8452f",
];
const SHIRTS = ["#e05b4a", "#3f7fd0", "#f2c14e", "#5cae72", "#b06cc4", "#e8e3d6", "#2f9fb5"];
const TROUSERS = ["#2f3640", "#3b4a5a", "#5a4632", "#41474f", "#2b3d34"];
const SKINS = ["#8d5524", "#c68642", "#e0ac69", "#5c3a21", "#a9713b"];

/* ------------------------------- setup ------------------------------- */

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

function spawnCar(rng) {
  const vertical = rng() < 0.5;
  const i = Math.floor(rng() * (GRID + 1));
  const j = Math.floor(rng() * (GRID + 1));
  let di = 0, dj = 0;
  if (vertical) dj = rng() < 0.5 ? 1 : -1;
  else di = rng() < 0.5 ? 1 : -1;
  // turn around if that heading would leave the grid
  if (i + di < 0 || i + di > GRID || j + dj < 0 || j + dj > GRID) { di = -di; dj = -dj; }
  const van = rng() < 0.28;
  return {
    i, j, di, dj,
    s: rng() * BLOCK,
    speed: 6 + rng() * 5,
    maxSpeed: van ? 10 + rng() * 4 : 12 + rng() * 6,
    color: CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)],
    w: van ? 2.2 : 1.85,
    l: van ? 5.6 : 4.4,
    h: van ? 2.4 : 1.55,
    van,
    x: 0, z: 0, yaw: 0,
    brakeGlow: false,
    honk: 0,
  };
}

function spawnPed(rng) {
  const i = Math.floor(rng() * GRID);
  const j = Math.floor(rng() * GRID);
  return {
    i, j,
    t: rng(),
    dir: rng() < 0.5 ? 1 : -1,
    speed: 1.0 + rng() * 0.7,
    phase: rng() * 6.28,
    shirt: SHIRTS[Math.floor(rng() * SHIRTS.length)],
    trouser: TROUSERS[Math.floor(rng() * TROUSERS.length)],
    skin: SKINS[Math.floor(rng() * SKINS.length)],
    mode: "walk",
    cross: null,
    x: 0, z: 0, yaw: 0,
    cool: 0,
  };
}

export function makeGame({ seed = 7, mode = "route", difficulty = "normal", dusk = false } = {}) {
  const city = makeCity(seed);
  const rng = mulberry32((seed * 2654435761) >>> 0);
  const diff = DIFFICULTY[difficulty] || DIFFICULTY.normal;
  makePassengers(rng, city.stops);

  const first = city.stops[0];
  // start the bus a little way back from the first stop, facing it
  const back = 26;
  const bus = {
    x: first.x - Math.sin(first.heading) * back,
    z: first.z - Math.cos(first.heading) * back,
    yaw: first.heading,
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
  for (let i = 0; i < diff.traffic; i += 1) cars.push(spawnCar(rng));
  const peds = [];
  for (let i = 0; i < diff.peds; i += 1) peds.push(spawnPed(rng));

  const state = {
    city, rng, mode, difficulty, diff, dusk,
    bus, cars, peds,
    t: 0,
    phase: "driving",           // driving | boarding | finished
    routeIdx: 0,
    activeStopId: 0,
    guide: [],
    guideDist: 0,
    guideTimer: 0,
    timeLeft: mode === "free" ? Infinity : diff.timePerStop * city.stops.length,
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
  };
  refreshGuide(state);
  return state;
}

function say(state, text, tone = "info", life = 3) {
  state.message = { text, tone };
  state.messageT = life;
  state.events.push({ type: "message", text, tone });
}

export function drainEvents(state) {
  const e = state.events;
  state.events = [];
  return e;
}

/* --------------------------- route guidance --------------------------- */

/** The intersection the bus is currently heading towards. */
function nextNodeAhead(bus) {
  const s = Math.sin(bus.yaw), c = Math.cos(bus.yaw);
  if (Math.abs(c) >= Math.abs(s)) {          // travelling along z
    const i = bandIndex(bus.x);
    const j = c >= 0 ? Math.ceil(bus.z / BLOCK) : Math.floor(bus.z / BLOCK);
    return { i, j: clamp(j, 0, GRID) };
  }
  const j = bandIndex(bus.z);
  const i = s >= 0 ? Math.ceil(bus.x / BLOCK) : Math.floor(bus.x / BLOCK);
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
    const n = Math.max(1, Math.min(24, Math.round(len / 8)));
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
  if (fwd > 1 && Math.abs(lat) < 11 && alongAxis && rightWay) {
    state.guideDist = addLeg(bus.x, bus.z, stop.x, stop.z);
    state.guide = pts;
    return;
  }

  const start = nextNodeAhead(bus);
  const path = findPath(start, stop.approach);
  let dist = addLeg(bus.x, bus.z, start.i * BLOCK, start.j * BLOCK);
  for (let k = 0; k < path.length - 1; k += 1) {
    const a = path[k], b = path[k + 1];
    const di = b.i - a.i, dj = b.j - a.j;
    const rx = dj, rz = -di;                 // right of travel
    const ax = a.i * BLOCK + rx * LANE * 0.6;
    const az = a.j * BLOCK + rz * LANE * 0.6;
    dist += addLeg(ax, az, ax + di * BLOCK, az + dj * BLOCK);
  }
  const last = path[path.length - 1];
  dist += addLeg(last.i * BLOCK, last.j * BLOCK, stop.x, stop.z);
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
  const returnRate = 3.4 + Math.abs(bus.speed) * 0.12;
  if (steerTarget === 0) {
    const k = Math.min(1, returnRate * dt);
    bus.steer += (0 - bus.steer) * k;
  } else {
    const rate = 2.6 / (1 + Math.abs(bus.speed) * 0.045);
    bus.steer = clamp(bus.steer + steerTarget * rate * dt, -1, 1);
  }

  const doorsBlocked = bus.doorT > 0.02;
  bus.throttle = doorsBlocked || !bus.engineOn ? 0 : clamp(input.throttle, 0, 1);
  bus.brake = clamp(input.brake, 0, 1);
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

  // ---- steering (bicycle model) --------------------------------------
  const maxSteer = lerp(0.62, 0.085, clamp(av / 19, 0, 1));
  bus.steerAngle = bus.steer * maxSteer;
  const yawRate = (bus.speed / BUS.wheelbase) * Math.tan(bus.steerAngle);
  bus.yaw += yawRate * dt;
  if (bus.yaw > Math.PI) bus.yaw -= Math.PI * 2;
  if (bus.yaw < -Math.PI) bus.yaw += Math.PI * 2;

  bus.lateralG = Math.abs(yawRate * bus.speed) / 9.81;

  bus.x += Math.sin(bus.yaw) * bus.speed * dt;
  bus.z += Math.cos(bus.yaw) * bus.speed * dt;

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
        const p = pushOut(px, pz, KERB);
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

  // city outer bounds
  const M = KERB - 1;
  if (bus.x < -M) { bus.x = -M; bus.speed *= 0.3; }
  if (bus.x > CITY_SPAN + M) { bus.x = CITY_SPAN + M; bus.speed *= 0.3; }
  if (bus.z < -M) { bus.z = -M; bus.speed *= 0.3; }
  if (bus.z > CITY_SPAN + M) { bus.z = CITY_SPAN + M; bus.speed *= 0.3; }

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
      say(state, "Watch it! You hit the wall", "bad", 2);
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
        say(state, "Off the road — mind the kerb", "warn", 1.8);
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
  bus.fuel = Math.max(0, bus.fuel - dt * (0.00034 + bus.throttle * 0.0011) * state.diff.burn);
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
  const kx = clamp(Math.round(bus.x / BLOCK), 0, GRID) * BLOCK;
  const kz = clamp(Math.round(bus.z / BLOCK), 0, GRID) * BLOCK;
  const useVertical = Math.abs(bus.x - kx) < Math.abs(bus.z - kz);

  // face whichever way along this road best matches the route
  const stop = state.activeStopId >= 0 ? city.stops[state.activeStopId] : null;
  let heading;
  if (useVertical) {
    const north = stop ? stop.z >= bus.z : Math.cos(bus.yaw) >= 0;
    heading = north ? 0 : Math.PI;
    bus.x = kx + (north ? LANE : -LANE);
    bus.z = clamp(bus.z, 2, CITY_SPAN - 2);
  } else {
    const east = stop ? stop.x >= bus.x : Math.sin(bus.yaw) >= 0;
    heading = east ? Math.PI / 2 : -Math.PI / 2;
    bus.z = kz + (east ? -LANE : LANE);
    bus.x = clamp(bus.x, 2, CITY_SPAN - 2);
  }
  bus.yaw = heading;
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

function carPose(c) {
  const ax = c.i * BLOCK, az = c.j * BLOCK;
  const rx = c.dj, rz = -c.di;
  c.x = ax + c.di * c.s + rx * LANE;
  c.z = az + c.dj * c.s + rz * LANE;
  c.yaw = Math.atan2(c.di, c.dj);
}

function stepCars(state, dt) {
  const { cars, city, bus, rng } = state;
  const stopLine = BLOCK - ROAD_HALF - 1.6;

  for (let k = 0; k < cars.length; k += 1) {
    const c = cars[k];
    let target = c.maxSpeed;

    // traffic light at the node ahead
    const ni = c.i + c.di, nj = c.j + c.dj;
    const inBounds = ni >= 0 && nj >= 0 && ni <= GRID && nj <= GRID;
    const light = inBounds ? city.lights[ni * (GRID + 1) + nj] : null;
    if (light && c.s < stopLine + 1) {
      const st = lightFor(light, c.dj !== 0);
      const gap = stopLine - c.s;
      if (st !== "green" && gap < 24 && gap > -0.5) {
        target = Math.min(target, Math.max(0, gap * 0.42 - 0.4));
      }
    }

    // follow the car ahead
    for (let m = 0; m < cars.length; m += 1) {
      if (m === k) continue;
      const o = cars[m];
      if (o.i !== c.i || o.j !== c.j || o.di !== c.di || o.dj !== c.dj) continue;
      const gap = o.s - c.s;
      if (gap > 0 && gap < 16) target = Math.min(target, Math.max(0, (gap - 7) * 0.9));
    }

    // yield to the player's bus
    const relx = bus.x - c.x, relz = bus.z - c.z;
    const fwd = relx * Math.sin(c.yaw) + relz * Math.cos(c.yaw);
    const lat = relx * Math.cos(c.yaw) - relz * Math.sin(c.yaw);
    if (fwd > 0 && fwd < 18 && Math.abs(lat) < 3.4) {
      target = Math.min(target, Math.max(0, (fwd - 9) * 0.8));
      if (target < 1 && c.honk <= 0 && Math.abs(bus.speed) < 0.6) {
        c.honk = 4 + rng() * 6;
        state.events.push({ type: "trafficHorn" });
      }
    }
    c.honk = Math.max(0, c.honk - dt);

    const accel = target > c.speed ? 3.4 : -7.5;
    c.speed = clamp(c.speed + accel * dt, 0, c.maxSpeed);
    c.brakeGlow = accel < 0 && c.speed > 0.4;
    c.s += c.speed * dt;

    if (c.s >= BLOCK) {
      c.s -= BLOCK;
      if (inBounds) { c.i = ni; c.j = nj; }
      else { c.di = -c.di; c.dj = -c.dj; }
      // choose the next heading: prefer straight on, never U-turn
      const opts = [];
      const straight = [c.di, c.dj];
      const left = [-c.dj, c.di];
      const right = [c.dj, -c.di];
      for (const [wi, [ddi, ddj]] of [[5, straight], [2, left], [2, right]]) {
        const ti = c.i + ddi, tj = c.j + ddj;
        if (ti < 0 || tj < 0 || ti > GRID || tj > GRID) continue;
        for (let w = 0; w < wi; w += 1) opts.push([ddi, ddj]);
      }
      if (!opts.length) { c.di = -c.di; c.dj = -c.dj; }
      else {
        const pick = opts[Math.floor(rng() * opts.length)];
        c.di = pick[0]; c.dj = pick[1];
      }
      c.speed *= 0.7;
    }
    carPose(c);

    // collision with the bus
    const dx = c.x - bus.x, dz = c.z - bus.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < 30) {
      const bf = dx * Math.sin(bus.yaw) + dz * Math.cos(bus.yaw);
      const bl = dx * Math.cos(bus.yaw) - dz * Math.sin(bus.yaw);
      if (Math.abs(bf) < BUS.len / 2 + c.l / 2 - 0.6 && Math.abs(bl) < BUS.wid / 2 + c.w / 2 - 0.2) {
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
        // Separate them, shoving the car along its own lane. A car that
        // could not be moved would be an immovable wall the bus could
        // pin itself against forever.
        const dist = Math.sqrt(d2) || 1;
        const nx = dx / dist, nz = dz / dist;
        const push = Math.max(0.15, 5.6 - dist) * 0.5;
        const alongCar = nx * Math.sin(c.yaw) + nz * Math.cos(c.yaw);
        c.s = Math.max(0, c.s + alongCar * push * 0.7);
        bus.x -= nx * push * 0.3;
        bus.z -= nz * push * 0.3;
        bus.speed *= 0.8;
        c.speed *= 0.5;
      }
    }
  }
}

/* ---------------------------- pedestrians ---------------------------- */

const PAVE_MID = ROAD_HALF + 3.8 / 2 + 0.2;

function pedPose(p) {
  if (p.mode === "cross" && p.cross) {
    const c = p.cross;
    p.x = lerp(c.x0, c.x1, c.t);
    p.z = lerp(c.z0, c.z1, c.t);
    p.yaw = Math.atan2(c.x1 - c.x0, c.z1 - c.z0);
    return;
  }
  const x0 = p.i * BLOCK + PAVE_MID;
  const x1 = (p.i + 1) * BLOCK - PAVE_MID;
  const z0 = p.j * BLOCK + PAVE_MID;
  const z1 = (p.j + 1) * BLOCK - PAVE_MID;
  const w = x1 - x0, d = z1 - z0;
  const per = 2 * (w + d);
  let t = ((p.t % 1) + 1) % 1;
  let s = t * per;
  if (s < w) { p.x = x0 + s; p.z = z0; p.yaw = Math.PI / 2 * (p.dir > 0 ? 1 : -1); }
  else if (s < w + d) { s -= w; p.x = x1; p.z = z0 + s; p.yaw = p.dir > 0 ? 0 : Math.PI; }
  else if (s < w * 2 + d) { s -= w + d; p.x = x1 - s; p.z = z1; p.yaw = -Math.PI / 2 * (p.dir > 0 ? 1 : -1); }
  else { s -= w * 2 + d; p.x = x0; p.z = z1 - s; p.yaw = p.dir > 0 ? Math.PI : 0; }
}

function stepPeds(state, dt) {
  const { peds, bus, rng } = state;
  for (let k = 0; k < peds.length; k += 1) {
    const p = peds[k];
    p.cool = Math.max(0, p.cool - dt);

    if (p.mode === "cross") {
      const c = p.cross;
      const dx = bus.x - p.x, dz = bus.z - p.z;
      const near = dx * dx + dz * dz < 260 && Math.abs(bus.speed) > 2.5;
      if (!near) c.t += (p.speed / c.len) * dt;
      p.phase += dt * 7 * (near ? 0 : 1);
      if (c.t >= 1) { p.mode = "walk"; p.i = c.ti; p.j = c.tj; p.t = c.tt; p.cool = 8 + rng() * 12; }
    } else {
      const side = BLOCK - PAVE_MID * 2;
      const per = 4 * side;
      p.t += (p.dir * p.speed / per) * dt;
      p.phase += dt * 6;
      // start a crossing now and then, from a mid-block point
      if (p.cool <= 0 && rng() < dt * 0.06) startCross(state, p);
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
  const { rng } = state;
  const vertical = rng() < 0.5;
  const x0 = p.i * BLOCK + PAVE_MID;
  const x1 = (p.i + 1) * BLOCK - PAVE_MID;
  const z0 = p.j * BLOCK + PAVE_MID;
  const z1 = (p.j + 1) * BLOCK - PAVE_MID;
  let sx, sz, ex, ez, ti = p.i, tj = p.j;

  if (vertical) {
    const goEast = rng() < 0.5;
    const line = goEast ? (p.i + 1) * BLOCK : p.i * BLOCK;
    if (goEast && p.i + 1 > GRID - 1) return;
    if (!goEast && p.i - 1 < 0) return;
    const z = z0 + rng() * (z1 - z0);
    sx = line - (goEast ? PAVE_MID : -PAVE_MID);
    ex = line + (goEast ? PAVE_MID : -PAVE_MID);
    sz = z; ez = z;
    ti = goEast ? p.i + 1 : p.i - 1;
  } else {
    const goNorth = rng() < 0.5;
    const line = goNorth ? (p.j + 1) * BLOCK : p.j * BLOCK;
    if (goNorth && p.j + 1 > GRID - 1) return;
    if (!goNorth && p.j - 1 < 0) return;
    const x = x0 + rng() * (x1 - x0);
    sz = line - (goNorth ? PAVE_MID : -PAVE_MID);
    ez = line + (goNorth ? PAVE_MID : -PAVE_MID);
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
  const i = bandIndex(bus.x), j = bandIndex(bus.z);
  const node = i * (GRID + 1) + j;
  const l = city.lights[node];
  if (!l) return;
  const inside = Math.abs(bus.x - l.x) < ROAD_HALF + 0.5 && Math.abs(bus.z - l.z) < ROAD_HALF + 0.5;
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
    return;
  }
  state.routeIdx += 1;
  state.activeStopId = state.routeIdx;
  refreshGuide(state, true);
  say(state, `Next stop: ${city.stops[state.activeStopId].name}`, "info", 4);
  state.events.push({ type: "announce", text: city.stops[state.activeStopId].name });
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
}

/* -------------------------------- step -------------------------------- */

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
      stepCars(state, STEP);
      stepPeds(state, STEP);
      stepLights(state.city.lights, STEP);
      checkRedLight(state);
      stepBoarding(state, STEP);
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
