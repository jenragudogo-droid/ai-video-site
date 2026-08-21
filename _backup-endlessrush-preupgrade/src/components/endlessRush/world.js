/* ------------------------------------------------------------------ *
 * Kianimation Endless Rush — the world the runner runs through.
 *
 * Everything here is a pure function of Z, which is what makes the world
 * endless without storing it. Five biomes cycle forever; the palette,
 * the amount the path snakes and the amount it rolls are all blended
 * across a long overlap zone, so a runner never sees a seam — the city
 * gradually becomes a market, the market thins into forest, and so on.
 *
 * The path curves and undulates, but only visually. `curveAt` and
 * `hillAt` are applied identically to the camera, the runner, every
 * obstacle and every coin at draw time, so the simulation underneath
 * stays a flat, straight, three-lane corridor. Collision maths never has
 * to think about a hill, and a jump clears exactly what it looks like it
 * clears whether the track is climbing or falling.
 * ------------------------------------------------------------------ */

import { lerp, mixHex } from "./render.js";

export const LANE_W = 2.0;
export const LANES = [-LANE_W, 0, LANE_W];
export const TRACK_HALF = 3.35;      // running surface half-width
export const KERB_HALF = 3.95;       // outer edge of the raised kerb

export const CHUNK = 15;             // metres of world generated at a time
const BIOME_LEN = 520;               // metres per biome before it changes
const BLEND = 120;                   // metres of cross-fade between biomes

/* ------------------------------ biomes ------------------------------ */

export const BIOMES = [
  {
    key: "city",
    name: "Downtown",
    skyTop: "#3a76b8", skyLow: "#c2dbf0",
    fog: "#bcd4e8", fogStart: 70, fogEnd: 205,
    road: "#4a4e56", kerb: "#8b9099", lane: "#e6e0d0",
    bands: [[4.0, 7.6, "#8d9098"], [7.6, 400, "#5c6068"]],
    light: 1, night: false,
    curveAmp: 0.6, hillAmp: 0.4,
    props: ["building", "lamp", "sign", "bin", "hydrant"],
    tint: "#f4b965",
  },
  {
    key: "market",
    name: "Market District",
    skyTop: "#4d9ec9", skyLow: "#f6dcae",
    fog: "#eed6ac", fogStart: 58, fogEnd: 175,
    road: "#7c6048", kerb: "#9a7a5e", lane: "#f0e2c0",
    bands: [[4.0, 6.8, "#b08a63"], [6.8, 400, "#8a6a4c"]],
    light: 1.06, night: false,
    curveAmp: 1.7, hillAmp: 0.55,
    props: ["stall", "umbrella", "crateStack", "sack", "lamp", "banner"],
    tint: "#ff9f45",
  },
  {
    key: "forest",
    name: "Greenbelt",
    skyTop: "#3f83aa", skyLow: "#d3e7cc",
    fog: "#cbe1c6", fogStart: 52, fogEnd: 165,
    road: "#6b6152", kerb: "#5a5142", lane: "#d6cfb4",
    bands: [[4.0, 9, "#4b7a41"], [9, 400, "#375f31"]],
    light: 0.93, night: false,
    curveAmp: 4.4, hillAmp: 1.7,
    props: ["tree", "tree", "bush", "rock", "fence", "stump"],
    tint: "#6fd08a",
  },
  {
    key: "mountain",
    name: "Highland Pass",
    skyTop: "#35699f", skyLow: "#dae9f5",
    fog: "#d2e1ef", fogStart: 76, fogEnd: 235,
    road: "#565a62", kerb: "#7c828b", lane: "#e8eef4",
    bands: [[4.0, 8, "#79808e"], [8, 400, "#5e6673"]],
    light: 0.99, night: false,
    curveAmp: 5.4, hillAmp: 3.6,
    props: ["cliff", "boulder", "pine", "railPost", "snowRock", "boulder", "pine", "snowRock"],
    tint: "#9fc6e8",
  },
  {
    key: "night",
    name: "Night City",
    skyTop: "#04050d", skyLow: "#1d2547",
    fog: "#16203c", fogStart: 44, fogEnd: 150,
    road: "#24272f", kerb: "#3a3f4a", lane: "#d6ca9c",
    bands: [[4.0, 7.6, "#2a2e38"], [7.6, 400, "#171a22"]],
    light: 0.56, night: true,
    curveAmp: 1.3, hillAmp: 0.45,
    props: ["towerLit", "neonLamp", "sign", "bin", "towerLit"],
    tint: "#9e62ff",
  },
];

/** Which biome pair is in play at this distance, and how far between. */
export function biomeAt(z) {
  const n = BIOMES.length;
  const i = Math.floor(z / BIOME_LEN);
  const local = z - i * BIOME_LEN;
  const a = ((i % n) + n) % n;
  const hold = BIOME_LEN - BLEND;
  if (local < hold) return { a, b: a, t: 0, index: i };
  const raw = (local - hold) / BLEND;
  return { a, b: (a + 1) % n, t: raw * raw * (3 - 2 * raw), index: i };
}

/* Colour blends are quantised to 24 steps. A cross-fade that produced a
   brand-new hex string every frame would defeat the renderer's palette
   cache — which is the single thing keeping the fill loop cheap. Two
   dozen steps over two minutes of blending is invisible. */
const QSTEP = 24;
const qmix = (a, b, t) => (t <= 0 ? a : t >= 1 ? b : mixHex(a, b, Math.round(t * QSTEP) / QSTEP));

/** Blended atmosphere at a distance — everything the renderer needs. */
export function atmosphereAt(z, out) {
  const { a, b, t } = biomeAt(z);
  const A = BIOMES[a];
  const B = BIOMES[b];
  const o = out || {};
  o.a = a; o.b = b; o.t = t;
  o.name = t > 0.5 ? B.name : A.name;
  o.skyTop = qmix(A.skyTop, B.skyTop, t);
  o.skyLow = qmix(A.skyLow, B.skyLow, t);
  o.fog = qmix(A.fog, B.fog, t);
  o.road = qmix(A.road, B.road, t);
  o.kerb = qmix(A.kerb, B.kerb, t);
  o.lane = qmix(A.lane, B.lane, t);
  o.tint = t > 0.5 ? B.tint : A.tint;
  o.fogStart = lerp(A.fogStart, B.fogStart, t);
  o.fogEnd = lerp(A.fogEnd, B.fogEnd, t);
  o.light = lerp(A.light, B.light, t);
  o.night = lerp(A.night ? 1 : 0, B.night ? 1 : 0, t);
  return o;
}

/* Reused scratch — `bandsAt` is called once per road segment per frame,
   so it must not allocate. */
const BAND_SCRATCH = [
  { from: 0, to: 0, hex: "" },
  { from: 0, to: 0, hex: "" },
  { from: 0, to: 0, hex: "" },
];

/**
 * Side terrain bands at this distance, blended between the two active
 * biomes. Returns how many of BAND_SCRATCH are valid; the array itself
 * is reused between calls, so read it before calling again.
 */
export function bandsAt(z) {
  const { a, b, t } = biomeAt(z);
  const A = BIOMES[a].bands;
  const B = BIOMES[b].bands;
  const n = Math.min(BAND_SCRATCH.length, Math.max(A.length, B.length));
  for (let i = 0; i < n; i += 1) {
    const pa = A[Math.min(i, A.length - 1)];
    const pb = B[Math.min(i, B.length - 1)];
    const slot = BAND_SCRATCH[i];
    slot.from = lerp(pa[0], pb[0], t);
    slot.to = lerp(pa[1], pb[1], t);
    slot.hex = qmix(pa[2], pb[2], t);
  }
  return n;
}

export { BAND_SCRATCH };

/* --------------------------- path shaping --------------------------- */

/* Two slow sines of incommensurable period: the path never repeats in a
   way a player can feel, and the derivative stays small enough that the
   camera yaw needed to follow it is only a few degrees. */
function curveWave(z) {
  return Math.sin(z * 0.0121) + Math.sin(z * 0.00534 + 2.1) * 1.5;
}
function hillWave(z) {
  return Math.sin(z * 0.0087 + 1.3) + Math.sin(z * 0.0032 + 0.4) * 0.6;
}

function ampCurve(z) {
  const { a, b, t } = biomeAt(z);
  return lerp(BIOMES[a].curveAmp, BIOMES[b].curveAmp, t);
}
function ampHill(z) {
  const { a, b, t } = biomeAt(z);
  return lerp(BIOMES[a].hillAmp, BIOMES[b].hillAmp, t);
}

/** Lateral offset of the path at this distance. Purely cosmetic. */
export function curveAt(z) {
  return curveWave(z) * ampCurve(z);
}

/** Height of the path at this distance. Also purely cosmetic. */
export function hillAt(z) {
  return hillWave(z) * ampHill(z);
}

/** dX/dZ of the path — the camera yaws by this to look along the road. */
export function curveSlope(z) {
  return (curveAt(z + 2) - curveAt(z - 2)) * 0.25;
}

/** dY/dZ of the path — used to pitch the camera over a crest. */
export function hillSlope(z) {
  return (hillAt(z + 2) - hillAt(z - 2)) * 0.25;
}

/* ------------------------------- random ------------------------------- */

/** Small, fast, seedable PRNG. Same seed always builds the same world. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------- scenery ------------------------------- */

const CITY_WALLS = ["#7b8290", "#69707d", "#8a8f99", "#5e6672", "#93877a"];
const NIGHT_WALLS = ["#2b3040", "#232838", "#333a4d", "#1d2230"];
const MARKET_CLOTH = ["#d94f3d", "#e8a33d", "#3f9e78", "#4a7fc1", "#c05fa8", "#e6d35c"];
const WOOD = ["#8a6136", "#7a552f", "#9a7043", "#6b4a29"];
const LEAF = ["#3c7a3a", "#2f6631", "#4a8c42", "#356e38", "#57964b"];
const ROCKS = ["#6f7681", "#5e6570", "#828a95", "#545b66"];

const pick = (rng, arr) => arr[(rng() * arr.length) | 0];

/**
 * Fills `out` with scenery for one chunk of track.
 *
 * Objects are placed in a band beside the running surface. Nothing here
 * is ever collidable — the obstacle course is generated separately in
 * track.js — so scenery can be as dense as the frame budget allows
 * without ever making a run unfair.
 */
export function decorateChunk(index, out) {
  const z0 = index * CHUNK;
  const rng = mulberry32((index * 2654435761) ^ 0x9e3779b9);
  const { a, b, t } = biomeAt(z0 + CHUNK * 0.5);
  out.length = 0;

  for (let side = -1; side <= 1; side += 2) {
    // during a cross-fade each slot independently picks which biome it
    // belongs to, so the two styles interleave instead of hard-cutting
    const count = 3 + ((rng() * 3) | 0);
    for (let i = 0; i < count; i += 1) {
      const bi = rng() < t ? b : a;
      const biome = BIOMES[bi];
      const z = z0 + ((i + rng() * 0.9) / count) * CHUNK;
      const kind = pick(rng, biome.props);
      emit(out, kind, side, z, rng);
    }
  }

  // occasional structure spanning the track, high above the runner's head
  if (rng() < 0.16) {
    const bi = rng() < t ? b : a;
    emitSpan(out, BIOMES[bi], z0 + rng() * CHUNK, rng);
  }
  return out;
}

function emit(out, kind, side, z, rng) {
  const near = 4.6 + rng() * 1.4;
  const x = side * near;

  switch (kind) {
    case "building": {
      const w = 3.2 + rng() * 4.4;
      const h = 7 + rng() * 17;
      const d = 5 + rng() * 7;
      out.push({
        k: "building", x: side * (near + w * 0.55 + 1.2), z, w, h, d,
        c: pick(rng, CITY_WALLS), c2: "#2e343f", s: (rng() * 1000) | 0, side,
      });
      break;
    }
    case "towerLit": {
      const w = 3.4 + rng() * 4.6;
      const h = 10 + rng() * 22;
      const d = 5 + rng() * 7;
      out.push({
        k: "building", x: side * (near + w * 0.55 + 1.2), z, w, h, d,
        c: pick(rng, NIGHT_WALLS), c2: "#ffd88a", s: (rng() * 1000) | 0, side, lit: 1,
      });
      break;
    }
    case "lamp":
      out.push({ k: "lamp", x, z, h: 4.4 + rng() * 1.2, side, c: "#5a6068", glow: 0 });
      break;
    case "neonLamp":
      out.push({
        k: "lamp", x, z, h: 4.6 + rng() * 1.1, side, c: "#343a46",
        glow: 1, c2: rng() < 0.3 ? "#9e62ff" : "#ffcf7a",
      });
      break;
    case "sign":
      out.push({
        k: "sign", x, z, h: 2.1 + rng() * 0.9, side,
        c: "#6d7580", c2: rng() < 0.5 ? "#d9d3c4" : "#e8b44d",
      });
      break;
    case "bin":
      out.push({ k: "box", x, z, w: 0.6, h: 0.9, d: 0.6, c: "#3f4a3f" });
      break;
    case "hydrant":
      out.push({ k: "box", x, z, w: 0.3, h: 0.75, d: 0.3, c: "#b8452f" });
      break;
    case "stall":
      out.push({
        k: "stall", x: side * (near + 0.9), z, side,
        w: 1.5 + rng() * 0.9, c: pick(rng, WOOD), c2: pick(rng, MARKET_CLOTH),
      });
      break;
    case "umbrella":
      out.push({
        k: "umbrella", x: side * (near + 0.5), z,
        h: 2.3 + rng() * 0.5, c: pick(rng, MARKET_CLOTH), r: 1.2 + rng() * 0.5,
      });
      break;
    case "crateStack": {
      const n = 1 + ((rng() * 3) | 0);
      for (let i = 0; i < n; i += 1) {
        out.push({
          k: "box", x: x + (rng() - 0.5) * 0.7, z: z + (rng() - 0.5) * 0.7,
          w: 0.42, h: 0.42, d: 0.42, y: i * 0.84, c: pick(rng, WOOD),
        });
      }
      break;
    }
    case "sack":
      out.push({ k: "box", x, z, w: 0.4, h: 0.34, d: 0.4, c: "#c9b184" });
      break;
    case "banner":
      out.push({
        k: "banner", x, z, side, h: 2.6 + rng() * 0.6,
        c: pick(rng, MARKET_CLOTH), c2: pick(rng, MARKET_CLOTH),
      });
      break;
    case "tree":
      out.push({
        k: "tree", x: side * (near + rng() * 3), z,
        h: 4.5 + rng() * 5, r: 1.1 + rng() * 0.9,
        c: pick(rng, WOOD), c2: pick(rng, LEAF), s: (rng() * 100) | 0,
      });
      break;
    case "pine":
      out.push({
        k: "pine", x: side * (near + rng() * 4), z,
        h: 5 + rng() * 6, r: 1 + rng() * 0.7, c: "#4a3a28", c2: pick(rng, LEAF),
      });
      break;
    case "bush":
      out.push({ k: "bush", x, z, r: 0.5 + rng() * 0.5, c: pick(rng, LEAF) });
      break;
    case "stump":
      out.push({ k: "box", x, z, w: 0.42, h: 0.5, d: 0.42, c: "#6b4a29" });
      break;
    case "rock":
    case "boulder":
      out.push({
        k: "rock", x: side * (near + rng() * 2.5), z,
        r: 0.5 + rng() * (kind === "boulder" ? 1.8 : 0.7), c: pick(rng, ROCKS),
      });
      break;
    case "snowRock":
      out.push({ k: "rock", x: side * (near + rng() * 3), z, r: 0.6 + rng() * 1.2, c: "#c9d6e2" });
      break;
    case "fence":
      out.push({ k: "fence", x: side * 4.35, z, side, c: "#7a5a35" });
      break;
    case "railPost":
      out.push({ k: "fence", x: side * 4.35, z, side, c: "#8d949e" });
      break;
    case "cliff": {
      /* Wide, low and turned off-axis. Tall narrow blocks read as
         office towers, which is exactly what a mountain pass must not
         look like. */
      out.push({
        k: "cliff", x: side * (near + 5.5 + rng() * 6), z,
        w: 5 + rng() * 7, h: 4 + rng() * 9, d: 6 + rng() * 8,
        rot: (rng() - 0.5) * 1.1, c: pick(rng, ROCKS),
        s: (rng() * 100) | 0,
      });
      break;
    }
    default:
      break;
  }
}

/* A gantry, tunnel ring, canopy or banner line arching over the track.
   Everything sits above 5m so it reads as depth, never as an obstacle. */
function emitSpan(out, biome, z, rng) {
  switch (biome.key) {
    case "city":
      out.push({ k: "gantry", z, h: 5.6, c: "#6a707a", c2: "#3f4650" });
      break;
    case "night":
      out.push({ k: "gantry", z, h: 5.6, c: "#2c313c", c2: "#9e62ff", glow: 1 });
      break;
    case "market":
      out.push({
        k: "bunting", z, h: 5.2,
        c: MARKET_CLOTH[(rng() * MARKET_CLOTH.length) | 0],
        c2: MARKET_CLOTH[(rng() * MARKET_CLOTH.length) | 0],
      });
      break;
    case "forest":
      out.push({ k: "canopy", z, h: 5.4, c: "#5a4326", c2: pick(rng, LEAF) });
      break;
    case "mountain":
      out.push(rng() < 0.45
        ? { k: "tunnel", z, h: 6.2, c: "#5c626c", c2: "#2b3037" }
        : { k: "bridge", z, h: 5.4, c: "#8d949e", c2: "#6b727c" });
      break;
    default:
      break;
  }
}
