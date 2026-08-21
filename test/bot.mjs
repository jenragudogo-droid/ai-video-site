/* ------------------------------------------------------------------ *
 * Fairness harness.
 *
 * Runs the real engine — real generator, real physics, real collision —
 * driven by a lookahead autopilot. If a competent player can survive ten
 * kilometres at top speed, the "every pattern is survivable" promise in
 * track.js holds in practice and not just in theory.
 *
 * The bot is deliberately not clairvoyant: it only reads what is within
 * a couple of seconds ahead, and it obeys the same lane-change time and
 * jump arc a human does.
 * ------------------------------------------------------------------ */

import {
  makeGame, resetGame, startRun, stepGame, drainEvents, summarise,
  moveLane, jump, slide, attack, chunksIn, surfaceAt, ENEMY_H,
} from "../src/components/endlessRush/engine.js";
import { LANE_TIME } from "../src/components/endlessRush/track.js";

const DT = 1 / 90;

/** Nearest threatening obstacle in each lane, with time-to-arrival. */
function scan(s, horizon) {
  const lanes = [[], [], []];
  // only what is at the runner's own altitude matters: a vent on a roof
  // is not in the way of someone on the street, and vice versa
  /* What the runner is about to be standing on. While in the air over a
     roof, that is the roof; while falling off one, it is the street. */
  const deck = (s.flying || s.flyLand > 0)
    ? surfaceAt(s, s.z + s.speed * 0.6, s.lane, s.y + 0.35)
    : s.surfaceY;
  for (const c of chunksIn(s, s.z - 2, s.z + horizon)) {
    for (const o of c.obstacles) {
      if (o.hit) continue;
      if (Math.abs((o.base || 0) - deck) > 1.5) continue;
      const front = o.z - o.d * 0.5;
      const back = o.z + o.d * 0.5;
      if (back < s.z - 0.4) continue;
      if (front > s.z + horizon) continue;
      lanes[o.lane].push({ o, t: (front - s.z) / s.speed, out: (back - s.z) / s.speed });
    }
    // an enemy blocks a lane exactly like a dodge obstacle; punching is a
    // bonus route, never the assumed one
    for (const e of c.enemies) {
      if (e.state === "down") continue;
      const front = e.z - 0.5;
      const back = e.z + 0.5;
      if (back < s.z - 0.4 || front > s.z + horizon) continue;
      lanes[e.lane].push({
        o: { act: "dodge", sev: "major", enemy: true, h: ENEMY_H },
        t: (front - s.z) / s.speed, out: (back - s.z) / s.speed,
      });
    }
  }
  for (const l of lanes) l.sort((a, b) => a.t - b.t);
  return lanes;
}

/** Seconds of clear road in a lane, treating jump/slide rows as passable. */
function clearance(list, fatalOnly) {
  for (const e of list) {
    if (fatalOnly && e.o.act !== "dodge") continue;
    return Math.max(0, e.t);
  }
  return 99;
}

export function decide(s) {
  /* Steering still matters in the air: the deck or the road you are
     about to land on has lanes, and picking a clear one on the way down
     is what a human does. */
  if (s.flying || s.flyLand > 0 || s.roofLeaveGrace > 0) {
    const lanes = scan(s, s.speed * 3);
    let best = s.lane;
    let bestScore = clearance(lanes[s.lane], true);
    for (let L = 0; L < 3; L += 1) {
      const c = clearance(lanes[L], true);
      if (c > bestScore + 0.05) { bestScore = c; best = L; }
    }
    if (best !== s.lane) moveLane(s, Math.sign(best - s.lane));
    /* Over a deck, in a lane that has one, and settled: come down and
       run it. Flying the whole roof is the lazy line and it would never
       exercise the rooftop obstacles. */
    else if (s.flying && s.surfaceY > 1 && bestScore > 0.8) slide(s);
    return;
  }
  const horizon = s.speed * 2.6;
  const lanes = scan(s, horizon);
  const here = lanes[s.lane];
  const next = here[0];

  // clear the lane if something punchable is close enough
  if (next && next.o.enemy && next.t < 0.3 && next.t > -0.12 && !s.airborne) attack(s);

  /* -------- vertical actions for whatever is in this lane -------- */
  if (next) {
    if (next.o.act === "jump" && next.t < 0.34 * (s.profile?.gravity || 1) && next.t > -0.1 && !s.airborne) {
      jump(s);
      return;
    }
    if (next.o.act === "slide" && next.t < 0.42 && next.t > -0.1 && !s.sliding) {
      slide(s);
      return;
    }
  }

  /* -------- sideways, when this lane is shut --------
     Every lane is considered, not just the neighbours: the way out of a
     two-lane block is often the far side, and the cost of getting there
     is just the lane-change time. */
  const mine = clearance(here, true);
  if (mine >= 0.95) return;

  let best = s.lane;
  let bestScore = mine;
  for (let L = 0; L < 3; L += 1) {
    if (L === s.lane) continue;
    const hops = Math.abs(L - s.lane);
    const cross = hops * LANE_TIME;
    const hard = clearance(lanes[L], true);
    const soft = clearance(lanes[L], false);
    if (hard < cross + 0.14) continue;      // it closes before we arrive
    if (soft < cross + 0.22) continue;      // no time to jump or slide either
    // a two-lane move passes through the middle one; it has to be empty
    // for as long as the crossing takes
    if (hops === 2) {
      const mid = (s.lane + L) / 2;
      let blocked = false;
      for (const e of lanes[mid]) {
        if (e.o.act !== "dodge") continue;
        if (e.t < cross + 0.12 && e.out > -0.05) { blocked = true; break; }
      }
      if (blocked) continue;
    }
    const score = hard - hops * 0.04;       // mild preference for staying put
    if (score > bestScore + 0.02) { bestScore = score; best = L; }
  }
  if (best !== s.lane) moveLane(s, Math.sign(best - s.lane));
}

export function run({ seed = 12345, maxDist = 10000, drive = true, quiet = true, character } = {}) {
  const s = makeGame({ seed, character });
  resetGame(s, seed, character);
  startRun(s);

  let ticks = 0;
  const events = { bump: 0, crash: 0, coin: 0, power: 0, smash: 0, shieldBreak: 0, enemyDown: 0, attack: 0 };
  let deathAt = null;

  while (s.phase === "running" && s.dist < maxDist && ticks < 4_000_000) {
    if (drive) decide(s);
    stepGame(s, null, DT);
    for (const e of drainEvents(s)) {
      if (events[e.type] !== undefined) events[e.type] += 1;
      if (e.type === "crash") deathAt = { dist: s.dist, type: e.a, lane: s.lane, speed: s.speed };
    }
    ticks += 1;
  }

  const out = { ...summarise(s), seed, events, deathAt, survived: s.phase === "running" };
  if (!quiet) console.log(JSON.stringify(out, null, 2));
  return out;
}

/* --------------------------- reporting --------------------------- */

if (process.argv[1] && process.argv[1].endsWith("bot.mjs")) {
  const mode = process.argv[2] || "sweep";

  if (mode === "idle") {
    // sanity: a player who does nothing must die, and die early
    const r = run({ seed: 7, drive: false, maxDist: 4000 });
    console.log(`idle bot: died at ${Math.round(r.distance)} m (${r.deathAt?.type})`);
    process.exit(r.survived ? 1 : 0);
  }

  const seeds = Number(process.argv[3] || 40);
  const target = Number(process.argv[4] || 10000);
  const t0 = Date.now();

  for (const character of ["runner", "courier", "skyrider", "jetkid"]) {
    let survived = 0;
    const deaths = [];
    for (let i = 0; i < seeds; i += 1) {
      const r = run({ seed: 1000 + i * 7919, maxDist: target, character });
      if (r.survived) survived += 1;
      else deaths.push({ seed: r.seed, dist: Math.round(r.distance), ...r.deathAt, type: r.deathAt?.type });
    }
    console.log(`${character.padEnd(9)} survived ${survived}/${seeds} to ${target} m`
      + (deaths.length ? `   deaths: ${deaths.slice(0, 5).map((d) => `${d.dist}m/${d.type}`).join(", ")}` : ""));
  }
  console.log(`(${Date.now() - t0} ms)`);
  const sample = run({ seed: 1000, maxDist: target });
  console.log("sample run:", JSON.stringify({
    score: sample.score, distance: sample.distance, coins: sample.coins,
    topSpeed: sample.topSpeed, events: sample.events,
  }));
}

/* --------------------------- density report --------------------------- */
export function density(seed, dist) {
  const s = makeGame({ seed });
  resetGame(s, seed);
  startRun(s);
  const seen = new Set();
  let obstacles = 0, coins = 0, powers = 0, empty = 0, chunks = 0;
  while (s.dist < dist) {
    stepGame(s, null, DT * 6);
    s.phase = "running";
    s.y = 0; s.sliding = false;
    for (const c of s.chunks) {
      if (seen.has(c.index)) continue;
      seen.add(c.index);
      chunks += 1;
      if (!c.obstacles.length) empty += 1;
      obstacles += c.obstacles.length;
      coins += c.coins.length;
      powers += c.powerups.length;
    }
  }
  return { chunks, obstacles, coins, powers, emptyPct: Math.round((empty / chunks) * 100),
    obsPer100m: +(obstacles / (dist / 100)).toFixed(1),
    coinsPer100m: +(coins / (dist / 100)).toFixed(1) };
}
