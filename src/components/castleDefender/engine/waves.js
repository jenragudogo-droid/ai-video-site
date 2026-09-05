/* ------------------------------------------------------------------ *
 * Castle Defender — wave scripts and formations.
 *
 * A stage wave is a list of groups; this module turns a group list
 * into a flat, time-sorted spawn queue with a lateral offset per
 * enemy so formations read on screen: a shield wall walks two abreast
 * with archers tucked behind, a cavalry rush comes in a ragged burst,
 * a line marches shoulder to shoulder.
 *
 * Endless mode builds its waves from the same formations with a
 * budget that grows every wave, so later waves are combinations of
 * formations rather than just bigger numbers.
 * ------------------------------------------------------------------ */

import { ENEMIES } from "../data/enemies.js";

/* Lateral spread available on the road (world units either side). */
const LANE = 22;

export function expandWave(groups, rng) {
  const queue = [];
  for (const g of groups) {
    const form = g.form || "column";
    let t = g.at || 0;
    for (let i = 0; i < g.count; i += 1) {
      let lat;
      let dt;
      switch (form) {
        case "line":
          /* two abreast, small stagger so shields overlap visually */
          lat = (i % 2 === 0 ? -1 : 1) * (LANE * 0.7) + (rng() - 0.5) * 6;
          dt = i % 2 === 0 ? 0.15 : g.every;
          break;
        case "shieldwall":
          lat = (i % 2 === 0 ? -1 : 1) * (LANE * 0.8);
          dt = i % 2 === 0 ? 0.05 : g.every;
          break;
        case "rush":
          lat = (rng() - 0.5) * LANE * 2;
          dt = g.every * (0.5 + rng());
          break;
        case "column":
        default:
          lat = (rng() - 0.5) * LANE * 1.2;
          dt = g.every * (0.85 + rng() * 0.3);
          break;
      }
      queue.push({ t, type: g.type, route: g.route || 0, lat });
      t += dt;
    }
  }
  queue.sort((a, b) => a.t - b.t);
  return queue;
}

/* Names of every enemy type a wave list contains, in first-seen
   order, with counts — used by the wave preview banner. */
export function waveSummary(groups) {
  const out = [];
  for (const g of groups) {
    const found = out.find((o) => o.type === g.type);
    if (found) found.count += g.count;
    else out.push({ type: g.type, count: g.count, name: ENEMIES[g.type].name });
  }
  return out;
}

/* ------------------------------ endless ------------------------------ */

const FORMS = [
  { type: "bandit", form: "column", every: 1.0, min: 1, unit: 6 },
  { type: "archer", form: "column", every: 1.5, min: 2, unit: 9 },
  { type: "manAtArms", form: "line", every: 1.5, min: 3, unit: 13 },
  { type: "outrider", form: "rush", every: 0.8, min: 4, unit: 11 },
  { type: "shieldBearer", form: "shieldwall", every: 1.6, min: 6, unit: 16 },
  { type: "crossbow", form: "column", every: 1.7, min: 9, unit: 12 },
];

/* cavalry joins the endless pools from Stage II's map onward */
const CAV_FORMS = [
  { type: "scoutCav", form: "rush", every: 0.8, min: 3, unit: 12 },
  { type: "knightCav", form: "line", every: 1.6, min: 6, unit: 24 },
];

export function endlessWave(n, rng, routesAvailable, stage = null) {
  const budget = 70 + n * 34 + Math.floor(n * n * 1.3);
  const cavalry = !!(stage && stage.number >= 2);
  const pool = FORMS.concat(cavalry ? CAV_FORMS : []).filter((f) => n >= f.min);
  const groups = [];
  let left = budget;
  let at = 0;
  let guard = 0;
  while (left > 8 && guard < 12) {
    guard += 1;
    const f = pool[Math.floor(rng() * pool.length)];
    const maxCount = Math.max(2, Math.floor(left / f.unit));
    const count = Math.min(maxCount, 4 + Math.floor(rng() * 6));
    const route = routesAvailable > 1 && rng() < 0.4 ? Math.floor(rng() * routesAvailable) : 0;
    groups.push({ type: f.type, count, route, at, every: f.every, form: f.form });
    left -= count * f.unit;
    at += 2 + rng() * 4;
  }
  if (n % 5 === 0) {
    if (cavalry && n % 10 === 0) groups.push({ type: "cavCommander", count: 1, route: 0, at: at + 4, every: 6, form: "column" });
    else groups.push({ type: "ram", count: 1 + Math.floor(n / 15), route: 0, at: at + 4, every: 6, form: "column" });
  }
  return groups;
}
