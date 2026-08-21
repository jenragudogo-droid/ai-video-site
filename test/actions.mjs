/* Functional test: run the real engine straight at each obstacle and
   check the advertised action actually saves you, and that doing
   nothing (or the wrong thing) does not. */
import {
  makeGame, resetGame, startRun, stepGame, drainEvents, jump, slide,
} from "../src/components/endlessRush/engine.js";
import { OBSTACLE } from "../src/components/endlessRush/track.js";

const DT = 1 / 90;

function trial(type, action, { atSpeed = null } = {}) {
  const s = makeGame({ seed: 909 });
  resetGame(s, 909);
  startRun(s);
  // move first, then settle, so the chunk window and the speed ramp both
  // catch up before anything is planted
  if (atSpeed) { s.dist = 3000; s.z = 3000; }
  // ride out the settle untouchable, then start the measurement clean
  for (let i = 0; i < 140; i++) { s.invuln = 9; stepGame(s, null, DT); }
  s.invuln = 0;
  s.stats.bumps = 0;
  s.phase = "running";

  // clear the road, then plant one obstacle straight ahead
  for (const c of s.chunks) { c.obstacles.length = 0; c.coins.length = 0; c.powerups.length = 0; }
  const spec = OBSTACLE[type];
  const oz = s.z + 14;
  const c = s.chunks.find((ch) => ch.z0 <= oz && ch.z1 > oz) || s.chunks[s.chunks.length - 1];
  const o = { type, art: spec.art, lane: s.lane, x: [-2, 0, 2][s.lane], y: spec.y, z: oz,
    w: spec.w, h: spec.h, d: spec.d, act: spec.act, sev: spec.sev, hit: false, seed: 3 };
  c.obstacles.push(o);

  let acted = false;
  for (let i = 0; i < 400 && s.phase === "running"; i++) {
    const tta = (o.z - o.d * 0.5 - s.z) / s.speed;
    if (!acted && action === "jump" && tta < 0.32) { jump(s); acted = true; }
    if (!acted && action === "slide" && tta < 0.24) { slide(s); acted = true; }
    stepGame(s, null, DT);
    // the generator keeps laying fresh track ahead; keep the lane clear so
    // the only thing under test is the obstacle we planted
    for (const ch of s.chunks) {
      if (ch.obstacles.length && ch.obstacles[0] !== o) ch.obstacles.length = 0;
      ch.coins.length = 0;
      ch.powerups.length = 0;
    }
    drainEvents(s);
    if (s.z > o.z + 6) break;
  }
  return s.phase === "running" && !s.stats.bumps ? "passed" : s.phase === "running" ? "bumped" : "DIED";
}

const MAJOR = Object.entries(OBSTACLE).filter(([, o]) => o.sev === "major");
console.log("obstacle     act     doing nothing   jumping     sliding     verdict");
let fails = 0;
for (const [name, spec] of MAJOR) {
  const none = trial(name, "none");
  const j = trial(name, "jump");
  const sl = trial(name, "slide");
  const want = spec.act;
  const right = want === "jump" ? j : want === "slide" ? sl : null;
  let ok;
  if (want === "dodge") ok = none === "DIED" && j === "DIED" && sl === "DIED";
  else ok = none === "DIED" && right === "passed";
  if (!ok) fails += 1;
  console.log(`  ${name.padEnd(12)} ${want.padEnd(7)} ${none.padEnd(15)} ${j.padEnd(11)} ${sl.padEnd(11)} ${ok ? "ok" : "✗"}`);
}

console.log("\n--- same again at top speed (27 m/s) ---");
for (const [name, spec] of MAJOR) {
  const none = trial(name, "none", { atSpeed: 27 });
  const j = trial(name, "jump", { atSpeed: 27 });
  const sl = trial(name, "slide", { atSpeed: 27 });
  const want = spec.act;
  const right = want === "jump" ? j : want === "slide" ? sl : null;
  let ok;
  if (want === "dodge") ok = none === "DIED";
  else ok = none === "DIED" && right === "passed";
  if (!ok) fails += 1;
  console.log(`  ${name.padEnd(12)} ${want.padEnd(7)} ${none.padEnd(15)} ${j.padEnd(11)} ${sl.padEnd(11)} ${ok ? "ok" : "✗"}`);
}
console.log(fails === 0 ? "\nevery obstacle behaves as advertised" : `\n${fails} FAILURES`);
process.exit(fails ? 1 : 0);
