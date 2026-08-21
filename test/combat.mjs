/* ------------------------------------------------------------------ *
 * Combat, deterministically.
 *
 * Whether a browser autopilot happens to meet an enemy inside its time
 * budget is luck, and a test that depends on luck fails for reasons that
 * have nothing to do with the code. This plants an enemy in front of the
 * runner and checks the things that must always be true:
 *
 *   - a swing in range puts them down
 *   - a swing out of range does not
 *   - walking into one is a collision, not a free pass
 *   - the cooldown really does rate-limit
 *   - the chain escalates punch -> kick -> spin and resets when it lapses
 *   - a defeated enemy pays out, and never twice
 * ------------------------------------------------------------------ */

import {
  makeGame, resetGame, startRun, stepGame, attack, drainEvents,
  chunksIn, ATTACK_TIME, ATTACK_CD,
} from "../src/components/endlessRush/engine.js";
import { CHARACTERS } from "../src/components/endlessRush/characters.js";
import { decide } from "./bot.mjs";

const DT = 1 / 90;
const LANES = [-2.4, 0, 2.4];

let pass = 0;
let fail = 0;
const failures = [];
const check = (name, ok, detail) => {
  if (ok) { pass += 1; console.log(`  ok    ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail += 1; failures.push(name); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
};

/** A clean runner with exactly one enemy `ahead` metres in front. */
function scene(ahead, character = "runner") {
  const s = makeGame({ seed: 777, character });
  resetGame(s, 777, character);
  startRun(s);
  for (const c of s.chunks) {
    c.obstacles.length = 0;
    c.powerups.length = 0;
    c.enemies.length = 0;
    c.coins.length = 0;
  }
  const z = s.z + ahead;
  for (const c of s.chunks) {
    if (z >= c.z0 && z < c.z1) {
      c.enemies.push({
        lane: 1, x: LANES[1], z, state: "alert", t: 0, bob: 0,
        speed: 0, hit: false, push: 0, spin: 0, seed: 3,
      });
    }
  }
  return s;
}

const clean = (s) => {
  for (const c of s.chunks) { c.obstacles.length = 0; c.powerups.length = 0; c.coins.length = 0; }
};

const enemiesOf = (s) => chunksIn(s, s.z - 20, s.z + 60).flatMap((c) => c.enemies);

/* ---------------------- a swing in range connects ---------------------- */
{
  const s = scene(2.0);
  attack(s);
  for (let i = 0; i < 40; i += 1) { clean(s); stepGame(s, {}, DT); }
  const e = enemiesOf(s)[0];
  check("a swing in range puts an enemy down", e && e.state === "down", e && e.state);
  check("the runner survives it", s.phase === "running", s.causeOfDeath);
  check("beating one is scored", s.stats.enemiesBeaten === 1, `${s.stats.enemiesBeaten}`);
}

/* -------------------- a swing at nothing connects with nothing ---------- */
{
  const s = scene(30);
  attack(s);
  for (let i = 0; i < 40; i += 1) { clean(s); stepGame(s, {}, DT); }
  check("a swing at empty road hits nothing", s.stats.enemiesBeaten === 0);
  check("but it still counts as a swing", s.stats.attacks === 1);
}

/* ---------------------- ignoring one is a collision --------------------- */
{
  const s = scene(6);
  for (let i = 0; i < 90 * 3 && s.phase === "running"; i += 1) { clean(s); stepGame(s, {}, DT); }
  check("running into an enemy ends the run", s.phase === "dead", s.phase);
  check("and the results card says why", s.causeOfDeath === "enemy", s.causeOfDeath);
}

/* ---------------------------- the cooldown ---------------------------- */
{
  const s = scene(60);
  let accepted = 0;
  for (let i = 0; i < 20; i += 1) {
    const before = s.stats.attacks;
    attack(s);
    if (s.stats.attacks > before) accepted += 1;
    clean(s); stepGame(s, {}, DT);
  }
  check("mashing the key does not mash the fists", accepted === 1, `${accepted} of 20 presses`);

  // and it does clear, after ATTACK_TIME + ATTACK_CD
  const need = Math.ceil((ATTACK_TIME + ATTACK_CD) / DT) + 2;
  for (let i = 0; i < need; i += 1) { clean(s); stepGame(s, {}, DT); }
  const before = s.stats.attacks;
  attack(s);
  check("the cooldown expires and lets the next one through",
    s.stats.attacks === before + 1, `${(ATTACK_TIME + ATTACK_CD).toFixed(2)}s`);
}

/* ------------------------- punch, kick, spin ------------------------- */
{
  const kinds = [];
  const s = scene(60);                       // start with nobody in reach
  const plant = () => {
    const z = s.z + 2.0;
    for (const c of s.chunks) {
      if (z >= c.z0 && z < c.z1) {
        c.enemies.push({
          lane: 1, x: LANES[1], z, state: "alert", t: 0, bob: 0,
          speed: 0, hit: false, push: 0, spin: 0, seed: 9,
        });
      }
    }
  };
  for (let round = 0; round < 3; round += 1) {
    /* Plant *then* swing. Swinging first and planting afterwards means
       every blow after the first lands on empty road, the chain never
       advances, and the test reports three punches while the game is
       working perfectly. */
    plant();
    attack(s);
    kinds.push(s.attackKind);
    /* The gap between blows has to clear the cooldown *and* stay inside
       the combo window, and those two numbers leave a fairly narrow lane:
       the fists free up at ATTACK_TIME + ATTACK_CD = 0.76s, and the chain
       lapses 0.85s after the previous blow *landed*, which is about 0.95s
       after it was thrown. 0.82s sits in the middle. Waiting less than
       0.76s means attack() silently refuses and the test reads three
       punches off a stale attackKind. */
    for (let i = 0; i < 74; i += 1) { clean(s); stepGame(s, {}, DT); }
  }
  check("the chain escalates punch -> kick -> spin",
    kinds[0] === "punch" && kinds[1] === "kick" && kinds[2] === "spin", kinds.join(" -> "));
  check("all three landed", s.stats.enemiesBeaten === 3, `${s.stats.enemiesBeaten} of 3`);

  // let the combo window lapse and it should start again at a punch
  for (let i = 0; i < 200; i += 1) { clean(s); stepGame(s, {}, DT); }
  attack(s);
  check("a lapsed chain resets to a punch", s.attackKind === "punch", s.attackKind);
}

/* ---------------------- airborne is its own move ---------------------- */
{
  const s = scene(60);
  s.airborne = true;
  s.y = 1.2;
  attack(s);
  check("a swing in mid-air is a jumping kick", s.attackKind === "airKick", s.attackKind);
}

/* ------------------------- nobody dies twice ------------------------- */
{
  const s = scene(2.0);
  attack(s);
  for (let i = 0; i < 40; i += 1) { clean(s); stepGame(s, {}, DT); }
  const scored = s.stats.enemiesBeaten;
  const coins = s.coins;
  for (let i = 0; i < 120; i += 1) { clean(s); stepGame(s, {}, DT); }
  check("a downed enemy is not beaten again",
    s.stats.enemiesBeaten === scored, `${scored} -> ${s.stats.enemiesBeaten}`);
  check("and does not keep paying out", s.coins === coins, `${coins} -> ${s.coins}`);
  check("nor does the corpse kill you", s.phase === "running", s.causeOfDeath);
}

/* ------------------------ every character can fight ------------------- */
for (const ch of CHARACTERS) {
  const s = scene(2.0, ch.id);
  attack(s);
  for (let i = 0; i < 40; i += 1) { clean(s); stepGame(s, {}, DT); }
  const e = enemiesOf(s)[0];
  check(`${ch.id} can beat one`, e && e.state === "down" && s.phase === "running",
    e ? e.state : "no enemy");
}

/* --------------------------- the warning ---------------------------- */
{
  /* Driven by the autopilot. Left to itself the runner hits the first
     barrier at eighty metres and never reaches an enemy at all, which
     looks exactly like "enemies never warn you". */
  const s = makeGame({ seed: 5150 });
  resetGame(s, 5150);
  startRun(s);
  let spotted = 0;
  const dzAtWarning = [];
  for (let i = 0; i < 90 * 60 * 4 && s.dist < 4000; i += 1) {
    decide(s);
    stepGame(s, {}, DT);
    if (s.phase !== "running") break;
    for (const ev of drainEvents(s)) {
      if (ev.type !== "enemySpot") continue;
      spotted += 1;
      const ahead = enemiesOf(s).filter((e) => e.state !== "down" && e.z > s.z);
      if (ahead.length) dzAtWarning.push(Math.min(...ahead.map((e) => e.z - s.z)));
    }
  }
  const nearest = dzAtWarning.length ? Math.min(...dzAtWarning) : null;
  check("enemies announce themselves before arriving", spotted > 0,
    `${spotted} warnings over ${Math.round(s.dist)} m`);
  check("and the warning comes with room to react",
    nearest !== null && nearest > 20, nearest === null ? "none seen" : `${nearest.toFixed(0)} m out`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) console.log(`failed: ${failures.join(", ")}`);
process.exit(fail ? 1 : 0);
