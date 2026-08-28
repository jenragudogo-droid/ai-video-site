/* Scripted gameplay audit for Neon Space Shooter's engine — runs the
   pure simulation under node with a scripted autopilot and asserts the
   whole feature list: movement, auto-fire, damage, waves, combos,
   crystals, every power-up, weapon levels, mini boss, boss patterns,
   boss defeat, player damage, invulnerability and game over.
   Run: node test/shooter-engine.mjs */

import {
  makeGame, resetGame, startRun, stepGame, drainEvents, summarise,
  setViewport, dragShip, releaseDrag,
  VIEW_H, MAX_WEAPON, POWER_TIME,
} from "../src/components/neonSpaceShooter/engine.js";

let passed = 0;
let failed = 0;
const ok = (cond, name) => {
  if (cond) { passed += 1; console.log(`  ok  ${name}`); }
  else { failed += 1; console.log(`FAIL  ${name}`); }
};

const DT = 1 / 60;

function run(s, seconds, each) {
  const steps = Math.round(seconds / DT);
  const evts = [];
  for (let i = 0; i < steps; i += 1) {
    if (s.phase !== "playing") break;
    if (each) each(s, i * DT);
    stepGame(s, DT);
    evts.push(...drainEvents(s));
  }
  return evts;
}

/* Autopilot: hover under the nearest enemy, sidestep enemy shots. */
function pilot(s) {
  let want = s.W / 2;
  let best = Infinity;
  for (const e of s.enemies) {
    const d = Math.abs(e.y - s.ship.y);
    if (d < best) { best = d; want = e.x; }
  }
  if (s.boss && s.boss.y > 0) want = s.boss.x;
  for (const p of s.enemyShots) {
    if (p.y > s.ship.y - 180 && Math.abs(p.x - s.ship.x) < 60) {
      want = s.ship.x + (p.x > s.ship.x ? -120 : 120);
    }
  }
  if (s.boss?.beamOn && Math.abs(s.boss.beamX - s.ship.x) < 90) {
    want = s.boss.beamX + (s.boss.beamDir > 0 ? -160 : 160);
  }
  s.input.left = want < s.ship.x - 8;
  s.input.right = want > s.ship.x + 8;
}

/* ---------------------------------------------------------------- */
console.log("— basics —");
{
  const s = makeGame({ seed: 7 });
  setViewport(s, 900, 1600);
  ok(s.W >= 340 && s.W <= 1280 && s.H === VIEW_H, "viewport maps into logical bounds");
  startRun(s);
  ok(s.phase === "playing" && s.wave === 1, "startRun enters wave 1");

  const x0 = s.ship.x;
  s.input.right = true;
  run(s, 0.5);
  ok(s.ship.x > x0 + 100, "keyboard right moves the ship");
  s.input.right = false;
  s.input.left = true;
  run(s, 2.0);
  ok(s.ship.x <= 24 + 1, "ship clamps at the left wall");
  s.input.left = false;

  dragShip(s, 300);
  run(s, 0.4);
  ok(Math.abs(s.ship.x - Math.min(300 + 23, s.W - 23)) < 30, "touch drag chases the target");
  releaseDrag(s);

  const evts = run(s, 2);
  ok(evts.some((e) => e.type === "shoot"), "auto-fire emits shots");
  ok(s.shots.length > 0 || evts.length > 0, "player shots exist");
}

/* ---------------------------------------------------------------- */
console.log("— combat, score, combo, crystals —");
{
  const s = makeGame({ seed: 42 });
  setViewport(s, 480, 800);
  startRun(s);
  const evts = run(s, 40, pilot);
  const kills = evts.filter((e) => e.type === "explode" && e.a.kind !== "player" && e.a.kind !== "missile").length;
  ok(kills >= 5, `enemies get destroyed (${kills} explosions)`);
  ok(s.score > 0, `score increases (${Math.round(s.score)})`);
  ok(evts.some((e) => e.type === "combo"), "combo labels fire");
  ok(s.bestCombo >= 2, `combo chains build (best x${s.bestCombo})`);
  const sparks = evts.filter((e) => e.type === "spark").length;
  ok(sparks > 0, "shots visibly hit enemies (spark events)");
  ok(evts.some((e) => e.type === "wave" && e.a >= 2), `waves progress (reached wave ${s.wave})`);
  ok(evts.some((e) => e.type === "crystal") || s.crystals.length > 0 || s.crystalRun > 0,
    `crystals drop and collect (${s.crystalRun} collected)`);
}

/* ---------------------------------------------------------------- */
console.log("— enemy variety over a longer run —");
{
  const s = makeGame({ seed: 1234 });
  setViewport(s, 480, 800);
  startRun(s);
  const seen = new Set();
  const evts = [];
  for (let i = 0; i < 60 * 240 && s.phase === "playing"; i += 1) {
    pilot(s);
    /* keep the pilot honest: heal so we can see late waves */
    if (s.hearts < 3) s.hearts = 3;
    stepGame(s, DT);
    for (const e of s.enemies) seen.add(e.type);
    if (s.boss) seen.add("boss");
    evts.push(...drainEvents(s));
    if (seen.has("boss") && s.wave >= 6) break;
  }
  for (const t of ["basic", "fast", "zigzag", "shooter", "heavy"]) {
    ok(seen.has(t), `${t} enemy appears`);
  }
  ok(evts.some((e) => e.type === "enemyShot"), "shooter drones fire back");
  ok(evts.some((e) => e.type === "bossWarn"), "WARNING before the boss");
  ok(seen.has("boss"), "boss appears on wave 5");
}

/* ---------------------------------------------------------------- */
console.log("— boss fight to the death —");
{
  const s = makeGame({ seed: 5 });
  setViewport(s, 480, 800);
  startRun(s);
  /* jump straight to the boss wave */
  s.wave = 5;
  s.waveState = "announce";
  s.waveTimer = 0.01;
  s.weapon = 5;
  const evts = [];
  const patterns = new Set();
  let sawWeak = false;
  for (let i = 0; i < 60 * 180 && s.phase === "playing"; i += 1) {
    pilot(s);
    if (s.hearts < 3) s.hearts = 3;       // watching patterns, not dodging skill
    stepGame(s, DT);
    if (s.boss?.state === "attack") patterns.add(["spread", "barrage", "beam", "wave"][s.boss.pattern]);
    if (s.boss?.state === "idle") sawWeak = true;
    evts.push(...drainEvents(s));
    if (evts.some((e) => e.type === "bossDown") && s.wave === 6) break;
  }
  ok(evts.some((e) => e.type === "bossWarn"), "boss warning shown");
  ok(patterns.size >= 3, `boss cycles attack patterns (${[...patterns].join(", ")})`);
  ok(sawWeak, "boss has weak windows");
  ok(evts.some((e) => e.type === "beamWarn"), "sweeping beam is telegraphed");
  ok(evts.some((e) => e.type === "bossDown"), "boss can be defeated");
  ok(s.wave === 6, "game continues to wave 6 after the boss");
  ok(evts.some((e) => e.type === "wave" && e.a === 6), "next wave announced");
}

/* ---------------------------------------------------------------- */
console.log("— mini boss —");
{
  const s = makeGame({ seed: 77 });
  setViewport(s, 480, 800);
  startRun(s);
  s.wave = 8;
  s.waveState = "announce";
  s.waveTimer = 0.01;
  s.weapon = 5;
  let sawMini = false;
  for (let i = 0; i < 60 * 90 && s.phase === "playing"; i += 1) {
    pilot(s);
    if (s.hearts < 3) s.hearts = 3;
    stepGame(s, DT);
    if (s.enemies.some((e) => e.type === "mini")) sawMini = true;
    drainEvents(s);
    if (sawMini) break;
  }
  ok(sawMini, "mini boss appears on wave 8");
}

/* ---------------------------------------------------------------- */
console.log("— power-ups and weapon levels —");
{
  const s = makeGame({ seed: 9 });
  setViewport(s, 480, 800);
  startRun(s);
  run(s, 2);

  /* weapon chip */
  const w0 = s.weapon;
  s.drops.push({ x: s.ship.x, y: s.ship.y - 10, vy: 0, kind: "upgrade", t: 0 });
  let evts = run(s, 0.2);
  ok(s.weapon === w0 + 1 && evts.some((e) => e.type === "upgrade"), "weapon chip raises the level");

  /* count lanes at each level via a single volley */
  const lanesAt = (level) => {
    s.weapon = level;
    s.power.double = 0; s.power.triple = 0;
    s.shots.length = 0;
    s.ship.fireCd = 0;
    stepGame(s, DT / 4);
    return s.shots.length;
  };
  ok(lanesAt(1) === 1, "level 1 fires a single laser");
  ok(lanesAt(3) === 2, "level 3 fires a double laser");
  ok(lanesAt(4) === 3, "level 4 fires a triple spread");
  ok(lanesAt(5) === 3 && s.shots.every((p) => p.dmg === 2), "level 5 shots hit harder");
  s.weapon = 1;

  for (const kind of ["double", "triple", "rapid", "beam", "missiles", "magnet"]) {
    s.drops.push({ x: s.ship.x, y: s.ship.y - 10, vy: 0, kind, t: 0 });
    evts = run(s, 0.15);
    ok(s.power[kind] > 0 && evts.some((e) => e.type === "power" && e.a === kind), `${kind} power-up activates`);
    if (kind !== "magnet") s.power[kind] = 0;
  }

  /* double / triple override the level-1 gun */
  s.power.double = POWER_TIME.double;
  s.shots.length = 0; s.ship.fireCd = 0;
  stepGame(s, DT / 4);
  ok(s.shots.length === 2, "double-laser power-up fires two lasers at level 1");
  s.power.double = 0;
  s.power.triple = POWER_TIME.triple;
  s.shots.length = 0; s.ship.fireCd = 0;
  stepGame(s, DT / 4);
  ok(s.shots.length === 3, "triple-laser power-up fires three lasers at level 1");
  s.power.triple = 0;

  /* rapid fire: cooldown shrinks */
  s.ship.fireCd = 0; s.shots.length = 0;
  stepGame(s, DT / 4);
  const slowCd = s.ship.fireCd;
  s.power.rapid = POWER_TIME.rapid;
  s.ship.fireCd = 0;
  stepGame(s, DT / 4);
  ok(s.ship.fireCd < slowCd * 0.6, "rapid fire shortens the cooldown");
  s.power.rapid = 0;

  /* beam kills without discrete shots */
  s.power.beam = POWER_TIME.beam;
  s.enemies.length = 0; s.queue.length = 0; s.waveState = "active";
  s.enemies.push({ type: "basic", x: s.ship.x, y: s.ship.y - 300, baseX: s.ship.x, vy: 0, vx: 0, t: 0, r: 17, hp: 2, maxHp: 2, fireCd: 99, dir: 1, seed: 0 });
  evts = run(s, 0.6, (st) => { st.input.left = false; st.input.right = false; });
  ok(evts.some((e) => e.type === "explode"), "laser beam destroys enemies");
  s.power.beam = 0;

  /* missiles home and hit */
  s.power.missiles = POWER_TIME.missiles;
  s.enemies.push({ type: "basic", x: Math.max(40, s.ship.x - 150), y: 300, baseX: 200, vy: 0, vx: 0, t: 0, r: 17, hp: 2, maxHp: 2, fireCd: 99, dir: 1, seed: 0 });
  evts = run(s, 3);
  ok(evts.some((e) => e.type === "missile"), "missiles launch");
  ok(evts.some((e) => e.type === "explode" && e.a.kind === "missile") || s.enemies.length === 0,
    "missiles reach their target");
  s.power.missiles = 0;

  /* magnet: a far crystal comes home */
  s.crystals.length = 0;
  s.power.magnet = POWER_TIME.magnet;
  s.crystals.push({ x: Math.min(s.W - 20, s.ship.x + 190), y: s.ship.y - 60, vx: 0, vy: 0, t: 0 });
  const c0 = s.crystalRun;
  run(s, 2.5, (st) => { st.input.left = false; st.input.right = false; });
  ok(s.crystalRun > c0, "magnet pulls distant crystals in");
}

/* ---------------------------------------------------------------- */
console.log("— getting hit, shield, hearts, game over, retry —");
{
  const s = makeGame({ seed: 3 });
  setViewport(s, 480, 800);
  startRun(s);
  run(s, 1);

  /* shield soaks exactly one hit */
  s.shield = true;
  s.enemyShots.push({ x: s.ship.x, y: s.ship.y - 4, vx: 0, vy: 10 });
  let evts = run(s, 0.1);
  ok(!s.shield && s.hearts === 3 && evts.some((e) => e.type === "shieldBreak"),
    "shield absorbs one hit and breaks");

  s.inv = 0;
  s.enemyShots.push({ x: s.ship.x, y: s.ship.y - 4, vx: 0, vy: 10 });
  evts = run(s, 0.1);
  ok(s.hearts === 2 && evts.some((e) => e.type === "hit"), "a hit costs one heart");
  ok(s.inv > 0, "hit protection window opens");

  /* protected: an immediate second shot does nothing */
  s.enemyShots.push({ x: s.ship.x, y: s.ship.y - 4, vx: 0, vy: 10 });
  run(s, 0.1);
  ok(s.hearts === 2, "protection blocks the follow-up hit");

  s.inv = 0;
  s.enemyShots.push({ x: s.ship.x, y: s.ship.y - 4, vx: 0, vy: 10 });
  run(s, 0.1);
  s.inv = 0;
  s.enemyShots.push({ x: s.ship.x, y: s.ship.y - 4, vx: 0, vy: 10 });
  evts = run(s, 0.1);
  ok(s.hearts === 0 && s.phase === "over" && evts.some((e) => e.type === "gameover"),
    "losing every heart ends the game");

  const sum = summarise(s);
  ok(typeof sum.score === "number" && typeof sum.crystals === "number" && sum.wave >= 1,
    "summary carries score, crystals and wave");

  resetGame(s);
  startRun(s);
  ok(s.phase === "playing" && s.hearts === 3 && s.score === 0 && s.wave === 1, "retry resets cleanly");
}

/* ---------------------------------------------------------------- */
console.log("— fairness spot-checks —");
{
  const s = makeGame({ seed: 21 });
  setViewport(s, 480, 800);
  startRun(s);
  s.wave = 5;
  s.waveState = "announce";
  s.waveTimer = 0.01;
  let beamEverInstant = false;
  for (let i = 0; i < 60 * 60 && s.phase === "playing"; i += 1) {
    pilot(s);
    if (s.hearts < 3) s.hearts = 3;
    stepGame(s, DT);
    const b = s.boss;
    if (b && b.state === "attack" && ["spread", "barrage", "beam", "wave"][b.pattern] === "beam") {
      /* beam must never be live in its first frames — telegraph first */
      if (b.patT < 0.5 && b.beamOn) beamEverInstant = true;
    }
    drainEvents(s);
  }
  ok(!beamEverInstant, "boss beam always telegraphs before firing");

  /* enemy shots only spawn from on-screen shooters well above the ship */
  const s2 = makeGame({ seed: 8 });
  setViewport(s2, 480, 800);
  startRun(s2);
  let lowShot = false;
  for (let i = 0; i < 60 * 120 && s2.phase === "playing"; i += 1) {
    pilot(s2);
    if (s2.hearts < 3) s2.hearts = 3;
    const before = s2.enemyShots.length;
    stepGame(s2, DT);
    for (let j = before; j < s2.enemyShots.length; j += 1) {
      if (s2.enemyShots[j].y > s2.H * 0.8) lowShot = true;
    }
    drainEvents(s2);
    if (s2.wave > 4) break;
  }
  ok(!lowShot, "no enemy shot spawns on top of the player");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
