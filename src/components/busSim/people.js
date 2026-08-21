/* ------------------------------------------------------------------ *
 * City Bus Simulator — where people stand and what they wear.
 *
 * The models themselves are drawn by the glTF layer in vehicles.js; this
 * module decides the two things that make a crowd look like a crowd
 * rather than a row of clones: where each person is placed, and which of
 * the shared models they are wearing today.
 *
 * Appearance is derived from a stable integer rather than stored, so a
 * passenger looks the same after a save and reload without the save file
 * having to carry anything about them.
 * ------------------------------------------------------------------ */

import { roadHeightAt, groundHeightAt, surfaceAt, SURFACE_ROAD } from "./city.js";

/** Model keys, in the order the loader registers them. */
export const PEOPLE_KINDS = ["adult-male", "adult-female", "young-female", "child"];

/* Shirt colours the player was asked for, kept muted enough to sit in a
   street scene: a pavement of primary-red T-shirts reads as a toy set. */
export const SHIRT_COLORS = [
  "#c0453c", "#2f62aa", "#3d8a58", "#d8b13c", "#8b9099", "#e8e6e0",
  "#a5563f", "#4a7fa8", "#6d7f4a", "#c7784a", "#5b5f6b", "#d9cdb8",
];
export const TROUSER_COLORS = [
  "#2b2f36", "#33507e", "#5c4632", "#3f4249", "#243a5c", "#6b5a44",
];

/* Adults, one teenager and one child. The child is a child model at a
   child's height — an adult scaled down has an adult's head on a small
   body, which is exactly what it looks like. */
export const PERSON_HEIGHT = {
  "adult-male": 1.78,
  "adult-female": 1.66,
  "young-female": 1.62,
  child: 1.38,
};

/* Grown-ups outnumber children on a street, and one model appearing four
   times in a row is more obvious than any colour repeat, so the mix is
   deliberately uneven. */
const KIND_MIX = [0, 1, 0, 2, 1, 0, 3, 1, 0, 2, 1, 3];

/** Deterministic scramble — same seed, same person, every reload. */
function hash(n) {
  let h = (n | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Everything about how one person looks. `seed` only has to be stable and
 * different from its neighbours' — a stop id times a hundred plus the
 * queue position does the job.
 */
export function lookFor(seed) {
  const h = hash(seed);
  const kind = PEOPLE_KINDS[KIND_MIX[h % KIND_MIX.length]];
  return {
    kind,
    shirt: SHIRT_COLORS[(h >>> 4) % SHIRT_COLORS.length],
    trous: TROUSER_COLORS[(h >>> 11) % TROUSER_COLORS.length],
    /* A queue of people all facing exactly the same way is the giveaway.
       These are small enough to read as people not standing to attention,
       and stable enough not to twitch. */
    turn: (((h >>> 17) & 255) / 255 - 0.5) * 1.15,
    lean: (((h >>> 25) & 31) / 31 - 0.5) * 0.05,
    scale: 0.955 + ((h >>> 7) & 63) / 63 * 0.09,
  };
}

/**
 * Lays a queue of people out on the pavement beside a stop.
 *
 * The shelter is a 7.4m box centred 1.9m back from the kerb, so the strip
 * between it and the kerb is where people actually wait. Positions run
 * along that strip with uneven gaps and a little depth variation; nobody
 * is placed in the carriageway, and each one is dropped onto the ground
 * at their own feet rather than the stop's single height, which matters
 * on the hill stops.
 */
export function stopCrowd(stop, count, out) {
  out.length = 0;
  if (!stop || count <= 0) return out;
  const h = stop.heading;
  const ax = Math.sin(h), az = Math.cos(h);          // along the kerb
  const ox = Math.cos(h), oz = -Math.sin(h);         // away from the road
  const n = Math.min(count, 7);
  const spread = 2.5 + n * 0.42;
  for (let i = 0; i < n; i += 1) {
    const look = lookFor(stop.id * 97 + i);
    const j = hash(stop.id * 131 + i * 7);
    // uneven gaps, and two rough ranks so a long queue is not a straight line
    const t = n === 1 ? 0 : (i / (n - 1)) - 0.5;
    const along = t * spread + (((j & 255) / 255) - 0.5) * 0.7;
    const back = 0.62 + (((j >>> 8) & 255) / 255) * 0.78;
    const px = stop.nodeX + ox * (stop.shelterSize + back) + ax * along;
    const pz = stop.nodeZ + oz * (stop.shelterSize + back) + az * along;
    // never let rounding put somebody in the road
    if (surfaceAt(px, pz) === SURFACE_ROAD) continue;
    const gy = roadHeightAt(px, pz);
    out.push({
      x: px, z: pz,
      y: Math.max(gy, Math.min(gy + 0.3, groundHeightAt(px, pz))),
      // looking back up the road for the bus, give or take
      yaw: h + Math.PI + look.turn * 0.55,
      kind: look.kind, shirt: look.shirt, trous: look.trous,
      scale: look.scale, lean: look.lean,
    });
  }
  return out;
}

/** The model dressing for a walking pedestrian the simulation owns. */
export function pedLook(p) {
  if (!p.look) p.look = lookFor(p.seed || 0);
  return p.look;
}
