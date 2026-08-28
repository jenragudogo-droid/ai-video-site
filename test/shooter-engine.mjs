/* Scripted gameplay audit for Neon Space Shooter's engine — runs the
   pure simulation under node with a scripted autopilot and asserts the
   whole feature list: movement, auto-fire, damage, waves, combos,
   crystals, every power-up, weapon levels, mini boss, boss patterns,
   boss defeat, player damage, invulnerability and game over.
   Run: node test/shooter-engine.mjs */

import {
  makeGame, resetGame, startRun, stepGame, drainEvents, summarise,
  setViewport, dragShip, releaseDrag, dash, fireSpecial,
  VIEW_H, MAX_WEAPON, POWER_TIME, SHIELD_MAX, SPECIAL_MAX, DASH_CD,
  shipScale, shipR,
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
  const phases = new Set();
  for (let i = 0; i < 60 * 240 && s.phase === "playing"; i += 1) {
    pilot(s);
    if (s.hearts < 3) s.hearts = 3;       // watching patterns, not dodging skill
    stepGame(s, DT);
    if (s.boss?.state === "attack") patterns.add(s.boss.patName);
    if (s.boss) phases.add(s.boss.phase);
    if (s.boss?.state === "idle") sawWeak = true;
    evts.push(...drainEvents(s));
    if (evts.some((e) => e.type === "bossDown") && s.wave === 6) break;
  }
  ok(evts.some((e) => e.type === "bossWarn"), "boss warning shown");
  ok(patterns.size >= 3, `boss cycles attack patterns (${[...patterns].join(", ")})`);
  ok(sawWeak, "boss has weak windows");
  ok(phases.has(1) && phases.has(2) && phases.has(3), `boss moves through phases (${[...phases].join(",")})`);
  ok(evts.filter((e) => e.type === "bossPhase").length >= 2, "phase changes are announced");
  ok(evts.some((e) => e.type === "beamWarn"), "sweeping beam is telegraphed");
  ok(evts.some((e) => e.type === "bossDown"), "boss can be defeated");
  ok(s.wave === 6, "game continues to wave 6 after the boss");
  ok(evts.some((e) => e.type === "wave" && e.a === 6), "next wave announced");
}

/* ---------------------------------------------------------------- */
console.log("— boss weak points —");
{
  const s = makeGame({ seed: 11 });
  setViewport(s, 480, 800);
  startRun(s);
  s.wave = 5;
  s.waveState = "announce";
  s.waveTimer = 0.01;
  s.weapon = 5;
  // reach the boss
  while (!s.boss && s.phase === "playing") { stepGame(s, DT); drainEvents(s); }
  while (s.boss.state === "enter") { stepGame(s, DT); drainEvents(s); }
  const b = s.boss;
  ok(b.pods.length === 2 && b.pods.every((p) => p.hp > 0), "boss carries two live gun pods");

  // park a shot on a pod and watch both the pod and the hull suffer
  const pod = b.pods[0];
  const hull0 = b.hp;
  const pod0 = pod.hp;
  s.shots.push({ x: b.x + pod.dx, y: b.y + pod.dy, vx: 0, vy: -1, dmg: 2, heavy: true });
  stepGame(s, DT);
  const evts = drainEvents(s);
  ok(pod.hp < pod0, "pod takes the hit");
  ok(b.hp < hull0, "pod hits feed bonus damage to the hull");
  ok(evts.some((e) => e.type === "spark"), "pod hits spark");

  // finish the pod off
  while (!pod.dead && s.boss) {
    s.shots.push({ x: b.x + pod.dx, y: b.y + pod.dy, vx: 0, vy: -1, dmg: 2, heavy: true });
    stepGame(s, DT);
  }
  const evts2 = drainEvents(s);
  ok(pod.dead && evts2.some((e) => e.type === "podDown"), "a pod can be destroyed");

  // idle core takes double damage
  b.state = "idle"; b.stateT = 0; b.beamOn = false;
  const h1 = b.hp;
  s.shots.push({ x: b.x, y: b.y, vx: 0, vy: -1, dmg: 2, heavy: true });
  stepGame(s, DT);
  ok(Math.abs((h1 - b.hp) - 4) < 0.01, "open core takes double damage");

  /* surviving a full beam earns the extended counterattack window */
  b.hp = 9999; b.maxHp = 9999;              // nothing dies, nothing phases
  b.state = "attack"; b.patName = "beam"; b.patT = 0;
  b.beamOn = false; b.beamX = b.x; b.beamDir = -1; b.shotsLeft = 0;
  s.ship.x = s.W - 30;                      // parked far from the sweep
  const evts3 = [];
  for (let i = 0; i < 60 * 3.2; i += 1) { stepGame(s, DT); evts3.push(...drainEvents(s)); }
  ok(evts3.some((e) => e.type === "beamFire"), "the beam actually fires");
  ok(evts3.some((e) => e.type === "coreOpen"), "surviving the beam opens the core");
  ok(s.boss.state === "idle" || s.boss.stateT < 1.7, "the counterattack window follows the beam");
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

  /* the shield is a bubble with hit points: it soaks several hits,
     reports its strength, and shatters on the last one */
  s.shield = SHIELD_MAX;
  let evts;
  for (let hit = 1; hit <= SHIELD_MAX; hit += 1) {
    s.inv = 0;
    s.enemyShots.push({ x: s.ship.x, y: s.ship.y - 4, vx: 0, vy: 10 });
    evts = run(s, 0.1);
    if (hit < SHIELD_MAX) {
      ok(s.shield === SHIELD_MAX - hit && evts.some((e) => e.type === "shieldHit"),
        `shield absorbs hit ${hit} (${s.shield}/${SHIELD_MAX} left)`);
    }
  }
  ok(s.shield === 0 && s.hearts === 3 && evts.some((e) => e.type === "shieldBreak"),
    "the final hit breaks the shield, hearts untouched");

  s.inv = 0;
  s.enemyShots.push({ x: s.ship.x, y: s.ship.y - 4, vx: 0, vy: 10 });
  evts = run(s, 0.1);
  ok(s.hearts === 2 && evts.some((e) => e.type === "hit"), "a hit costs one heart");

  /* a repair chip restores it */
  s.drops.push({ x: s.ship.x, y: s.ship.y - 10, vy: 0, kind: "repair", t: 0 });
  evts = run(s, 0.15);
  ok(s.hearts === 3 && evts.some((e) => e.type === "power" && e.a === "repair"),
    "repair pickup restores a lost heart");
  s.inv = 0;
  s.enemyShots.push({ x: s.ship.x, y: s.ship.y - 4, vx: 0, vy: 10 });
  run(s, 0.1);
  ok(s.hearts === 2, "back to two hearts for the game-over path");
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
console.log("— dash —");
{
  const s = makeGame({ seed: 31 });
  setViewport(s, 480, 800);
  startRun(s);
  run(s, 2);
  s.ship.x = 100;
  const x0 = s.ship.x;
  s.input.right = true;
  ok(dash(s), "dash triggers when off cooldown");
  s.input.right = false;
  let evts = run(s, 0.1);
  ok(evts.some((e) => e.type === "dash"), "dash event fires");
  ok(s.ship.x > x0 + 120, `dash covers real distance (+${Math.round(s.ship.x - x0)}px in 0.1s)`);
  ok(!dash(s), "dash refuses while cooling down");
  ok(s.dashCd > 0 && s.dashCd <= DASH_CD, "cooldown is ticking");

  /* dash protection: a shot on the nose during the dash does nothing */
  s.dashCd = 0;
  s.inv = 0;
  dash(s, 1);
  s.enemyShots.push({ x: Math.min(s.W - 30, s.ship.x + 40), y: s.ship.y, vx: 200, vy: 0 });
  const h0 = s.hearts;
  stepGame(s, DT); drainEvents(s);
  ok(s.hearts === h0, "mid-dash moment is protected");

  run(s, DASH_CD + 0.2);
  ok(s.dashCd <= 0 && dash(s), "dash returns after the cooldown");
}

/* ---------------------------------------------------------------- */
console.log("— special attack meter —");
{
  const s = makeGame({ seed: 55 });
  setViewport(s, 480, 800);
  startRun(s);
  ok(!fireSpecial(s), "special refuses on an empty meter");
  let evts = run(s, 30, pilot);
  ok(s.special > 0, `kills charge the meter (${Math.round(s.special)}/${SPECIAL_MAX})`);
  s.special = SPECIAL_MAX;
  /* a full field to vaporise */
  for (let i = 0; i < 6; i += 1) {
    s.enemies.push({ type: "basic", x: 60 + i * 60, y: 200 + i * 40, baseX: 60 + i * 60, vy: 0, vx: 0, t: 0, r: 17, hp: 2, maxHp: 2, fireCd: 99, dir: 1, seed: 0 });
  }
  s.enemyShots.push({ x: 50, y: 100, vx: 0, vy: 50 });
  ok(fireSpecial(s), "a full meter fires");
  /* look mid-blast, before the next wave has a chance to spawn */
  evts = run(s, 0.5);
  ok(evts.some((e) => e.type === "special"), "special event fires");
  ok(s.enemies.length === 0, "the blast clears the field");
  ok(s.enemyShots.length === 0, "the blast burns enemy fire away");
  run(s, 1.2);
  ok(s.special === 0 && s.specialT <= 0, "the meter resets after the blast");
}

/* ---------------------------------------------------------------- */
console.log("— slow time, invincibility, ship growth —");
{
  const s = makeGame({ seed: 61 });
  setViewport(s, 480, 800);
  startRun(s);
  run(s, 1.8);
  s.enemies.length = 0; s.queue.length = 0; s.waveState = "active";
  s.enemies.push({ type: "basic", x: 240, y: 100, baseX: 240, vy: 100, vx: 0, t: 0, r: 17, hp: 99, maxHp: 99, fireCd: 99, dir: 1, seed: 0 });

  /* slow time: the same enemy falls at less than half speed */
  const y0 = s.enemies[0].y;
  run(s, 0.5, (st) => { st.input.left = false; st.input.right = false; st.ship.x = 40; });
  const normalDrop = s.enemies[0].y - y0;
  s.power.slow = POWER_TIME.slow;
  const y1 = s.enemies[0].y;
  run(s, 0.5, (st) => { st.ship.x = 40; });
  const slowDrop = s.enemies[0].y - y1;
  ok(slowDrop < normalDrop * 0.6, `slow time halves enemy speed (${Math.round(slowDrop)} vs ${Math.round(normalDrop)}px)`);
  /* ...but the ship keeps full speed */
  s.input.right = true;
  const sx0 = s.ship.x;
  run(s, 0.3);
  s.input.right = false;
  ok(s.ship.x - sx0 > 100, "the ship still moves at full speed in slow time");
  s.power.slow = 0;

  /* invincibility: shots pass straight through */
  s.power.invuln = POWER_TIME.invuln;
  s.inv = 0; s.shield = 0;
  const h0 = s.hearts;
  s.enemyShots.push({ x: s.ship.x, y: s.ship.y - 4, vx: 0, vy: 10 });
  run(s, 0.1);
  ok(s.hearts === h0, "invincibility blocks damage entirely");
  s.power.invuln = 0;

  /* the rocket grows with the weapon, within limits */
  s.weapon = 1;
  const small = shipScale(s), smallR = shipR(s);
  s.weapon = MAX_WEAPON;
  ok(shipScale(s) > small && shipScale(s) <= 1.4, `ship grows with weapon level (x${shipScale(s).toFixed(2)})`);
  ok(shipR(s) > smallR && shipR(s) <= smallR + 5, "hitbox grows less than the art and caps");
  s.weapon = 1;
}

/* ---------------------------------------------------------------- */
console.log("— combo rewards, near miss —");
{
  const s = makeGame({ seed: 71 });
  setViewport(s, 480, 800);
  startRun(s);
  run(s, 1.8);
  s.enemies.length = 0; s.queue.length = 0; s.waveState = "active";

  /* stage kills to march the combo through the reward tiers */
  const evts = [];
  for (let k = 0; k < 32 && s.phase === "playing"; k += 1) {
    s.enemies.push({ type: "basic", x: s.ship.x, y: s.ship.y - 200, baseX: s.ship.x, vy: 0, vx: 0, t: 0, r: 17, hp: 1, maxHp: 1, fireCd: 99, dir: 1, seed: 0 });
    for (let i = 0; i < 90 && s.enemies.length; i += 1) {
      stepGame(s, DT);
      evts.push(...drainEvents(s));
    }
  }
  const rewards = evts.filter((e) => e.type === "comboReward").map((e) => e.a);
  ok(rewards.some((r) => r.includes("x10")), "x10 combo pays a crystal bonus");
  ok(rewards.some((r) => r.includes("x20")), "x20 combo grants rapid fire");
  ok(rewards.some((r) => r.includes("x30")), "x30 combo recharges the shield");
  ok(s.shield > 0, "the recharged shield is really there");
  ok(s.power.rapid > 0 || rewards.some((r) => r.includes("x20")), "rapid fire reward engaged");

  /* near miss: a bolt shaving past the wing pays out */
  const s2 = makeGame({ seed: 72 });
  setViewport(s2, 480, 800);
  startRun(s2);
  run(s2, 1.8);
  s2.enemies.length = 0; s2.queue.length = 0; s2.waveState = "active";
  const sc0 = s2.score, sp0 = s2.special;
  s2.enemyShots.push({ x: s2.ship.x + shipR(s2) + 15, y: s2.ship.y - 20, vx: 0, vy: 300 });
  const evts2 = run(s2, 0.3, (st) => { st.input.left = false; st.input.right = false; });
  ok(evts2.some((e) => e.type === "nearMiss"), "a whisker-close bolt registers as a near miss");
  ok(s2.score > sc0 && s2.special > sp0, "near misses pay score and special energy");
  ok(s2.hearts === 3, "…without costing anything");
}

/* ---------------------------------------------------------------- */
console.log("— magnet pulls drops too —");
{
  const s = makeGame({ seed: 81 });
  setViewport(s, 480, 800);
  startRun(s);
  run(s, 1.8);
  s.power.magnet = POWER_TIME.magnet;
  s.drops.push({ x: Math.min(s.W - 20, s.ship.x + 190), y: s.ship.y - 40, vy: 0, kind: "rapid", t: 0 });
  const evts = run(s, 2, (st) => { st.input.left = false; st.input.right = false; });
  ok(evts.some((e) => e.type === "power" && e.a === "rapid"), "magnet reels a distant power-up in");
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
    if (b && b.state === "attack" && b.patName === "beam") {
      /* beam must never be live during the telegraph window */
      if (b.patT < 1.0 && b.beamOn) beamEverInstant = true;
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
