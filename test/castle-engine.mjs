/* Scripted audit of the Castle Defender engine — plays stage I under
   node with a scripted commander and asserts the whole feature list:
   roads, plots, every tower and upgrade, soldiers and rally points,
   the hero and Royal Charge, castle abilities, armour and shields,
   the ram mini-boss, early calls, wave clears, victory, stars, defeat,
   selling, repair and the portrait layout swap.
   Run: node test/castle-engine.mjs */

import {
  makeGame, resetGame, startStage, stepGame, drainEvents, summarise, setLayout,
  buildTower, upgradeTower, sellTower, sellValue, setRally, fireTowerAbility,
  moveHero, heroCharge, castVolley, castReinforce, repairCastle, callWave,
  plotAt, canBuild, nextWaveSummary, towerLevel, PLOT_R, setDrill, canDrill, DRILL_COST,
  serializeGame, restoreGame, BATTLE_FORMAT,
  orderUnits, unitAt, squadOf, isFullSquad, sharedAbility, triggerUnitAbility, offerPerks, choosePerk, skipPerk, powerUnlocked, castWatchfire, castRoyalRally, buildCost, repairCost,
} from "../src/components/castleDefender/engine/engine.js";
import { PERKS, PERK_BY_ID, POWERS } from "../src/components/castleDefender/data/perks.js";
import { KINGDOM_UPGRADES, metaMods } from "../src/components/castleDefender/data/progression.js";
import { readSave, writeSave, saveBattle, clearBattle, recordResult, resetProgress, SAVE_VERSION } from "../src/components/castleDefender/save.js";
import { sampleRoute } from "../src/components/castleDefender/engine/path.js";
import { STAGES } from "../src/components/castleDefender/data/stages.js";
import { TOWERS, HERO, SOLDIERS } from "../src/components/castleDefender/data/towers.js";
import { ENEMIES } from "../src/components/castleDefender/data/enemies.js";
import { displayWave, waveCard, plural } from "../src/components/castleDefender/hudText.js";

let passed = 0;
let failed = 0;
const ok = (cond, name) => {
  if (cond) { passed += 1; console.log(`  ok  ${name}`); }
  else { failed += 1; console.log(`FAIL  ${name}`); }
};
const DT = 1 / 60;

/* scripted runs pick the first offered perk unless a test switches this off */
let AUTO_PERK = true;
function run(s, seconds, each) {
  const steps = Math.round(seconds / DT);
  const evts = [];
  for (let i = 0; i < steps; i += 1) {
    if (s.phase !== "playing") break;
    if (AUTO_PERK && s.perkPending && s.perkOffer) choosePerk(s, s.perkOffer[0]);
    if (each) each(s, i * DT);
    stepGame(s, DT);
    evts.push(...drainEvents(s));
  }
  return evts;
}
const count = (evts, type) => evts.filter((e) => e.type === type).length;

/* ---------------------------------------------------------------- */
console.log("— stage data —");
{
  const st = STAGES[0];
  ok(st.waves.length === 8, "Greenhollow has 8 waves");
  for (const name of ["landscape", "portrait"]) {
    const L = st.layouts[name];
    ok(L.plots.length === 9, `${name}: 9 plots`);
    ok(L.routes.length === 2, `${name}: 2 routes`);
    const gate = L.castle.gate;
    for (const r of L.routes) {
      const last = r.points[r.points.length - 1];
      ok(Math.hypot(last.x - gate.x, last.y - gate.y) < 20, `${name}: route ends at the gate`);
    }
    /* plots must not sit on the road and must be within castle-free ground */
    const s = makeGame({ layout: name });
    s.layout.plots.forEach((p, i) => {
      let minD = Infinity;
      for (const route of s.layout.routes) for (const q of route.pts) minD = Math.min(minD, Math.hypot(q.x - p.x, q.y - p.y));
      ok(minD > PLOT_R + 8 && minD < 200, `${name}: plot ${i} is beside the road (${Math.round(minD)})`);
      const c = L.castle;
      ok(!(p.x > c.x - 30 && p.x < c.x + c.w + 30 && p.y > c.y - 30 && p.y < c.y + c.h + 30), `${name}: plot ${i} is clear of the castle`);
    });
  }
  const t4 = towerLevel("archer", 4);
  ok(t4.ability && t4.ability.id === "arrowStorm" && t4.shooters === 2 && t4.dmg[0] === 14, "tower levels are cumulative");
}

/* ---------------------------------------------------------------- */
console.log("— basics —");
{
  const s = makeGame({ seed: 3 });
  ok(s.phase === "ready" && s.gold === 250 && s.castleHp === 20, "fresh game: ready, 250 gold, 20 castle hp");
  startStage(s);
  ok(s.phase === "playing" && s.wave === 0 && s.waveState === "countdown", "startStage enters the first countdown");
  ok(nextWaveSummary(s)[0].type === "bandit" && nextWaveSummary(s)[0].count === 8, "next wave preview lists 8 bandits");
  const idx = plotAt(s, s.layout.plots[2].x + 10, s.layout.plots[2].y - 5);
  ok(idx === 2, "plotAt resolves a tap near a plot");
  ok(plotAt(s, 5, 5) === -1, "plotAt returns -1 away from plots");
  ok(canBuild(s, 0, "archer") && !canBuild(s, 0, "catapult") === false, "canBuild reflects gold");
  ok(buildTower(s, 0, "archer") && s.gold === 180 && s.towers[0].type === "archer", "archer tower costs 70");
  ok(!buildTower(s, 0, "archer"), "cannot build on an occupied plot");
  { const g = s.gold; s.gold = 10; ok(!buildTower(s, 1, "catapult") && !s.towers[1], "cannot build what you cannot afford"); s.gold = g; }

  /* countdown ticks and the wave starts on its own */
  const evts = run(s, 19);
  ok(s.wave === 1 && s.waveState === "active", "wave 1 starts when the countdown ends");
  ok(count(evts, "wave") === 1, "wave event fired once");
  ok(count(evts, "spawn") >= 1, "bandits are spawning");
}

/* ---------------------------------------------------------------- */
console.log("— towers, damage and armour —");
{
  /* an archer tower alone vs a single bandit, on a controlled spawn */
  const s = makeGame({ seed: 5 });
  startStage(s);
  buildTower(s, 1, "archer");
  s.queue = [{ t: 0, type: "bandit", route: 0, lat: 0 }];
  s.waveState = "active"; s.wave = 1; s.waveT = 0;
  const evts = run(s, 40);
  ok(count(evts, "arrow") > 3, "archer tower fires arrows");
  ok(count(evts, "hit") > 3, "arrows land on the bandit");
  ok(count(evts, "die") === 1 && count(evts, "coin") === 1, "bandit dies and drops a coin");
  ok(s.gold === 250 - 70 + 7 + 50, `bounty and wave-clear bonus were paid (${s.gold})`);
  ok(evts.some((e) => e.type === "waveClear" && e.n === 1), "wave 1 cleared → countdown for wave 2");

  /* armour: a man-at-arms takes far less from arrows than from ballista bolts */
  const a = makeGame({ seed: 9 }); startStage(a); buildTower(a, 1, "archer");
  a.queue = [{ t: 0, type: "manAtArms", route: 0, lat: 0 }]; a.waveState = "active"; a.wave = 1;
  const ea = run(a, 16).filter((e) => e.type === "hit");
  const b = makeGame({ seed: 9 }); startStage(b); buildTower(b, 1, "ballista");
  b.queue = [{ t: 0, type: "manAtArms", route: 0, lat: 0 }]; b.waveState = "active"; b.wave = 1;
  const eb = run(b, 16).filter((e) => e.type === "hit");
  const avg = (l) => l.reduce((x, e) => x + e.amount, 0) / Math.max(1, l.length);
  ok(ea.length > 0 && avg(ea) < 10 * 0.55 + 0.01, `arrows lose 45 % to armour (avg ${avg(ea).toFixed(1)})`);
  ok(eb.length > 0 && avg(eb) > 30, `ballista bolts punch through (avg ${avg(eb).toFixed(1)})`);

  /* shield bearer: arrows from the front are mostly blocked */
  const c = makeGame({ seed: 11 }); startStage(c);
  buildTower(c, 7, "archer");          // near the gate → shoots the bearer head-on
  c.queue = [{ t: 0, type: "shieldBearer", route: 0, lat: 0 }]; c.waveState = "active"; c.wave = 1;
  c.enemies.length = 0;
  const ec = run(c, 40);
  ok(count(ec, "shieldBlock") > 0, "shield bearer blocks arrows arriving from the front");

  /* catapult: area damage hits a whole group, and fire pots leave a zone */
  const d = makeGame({ seed: 13 }); startStage(d); d.gold = 2000;
  buildTower(d, 2, "catapult"); upgradeTower(d, 2); upgradeTower(d, 2); upgradeTower(d, 2);
  ok(d.towers[2].level === 4, "catapult upgraded to level 4");
  d.queue = [0, 1, 2, 3].map((i) => ({ t: i * 0.4, type: "bandit", route: 0, lat: (i - 1.5) * 10 }));
  d.waveState = "active"; d.wave = 1;
  const ed = run(d, 14);
  ok(count(ed, "catapult") >= 1 && count(ed, "stoneImpact") >= 1, "catapult fires and stones land");
  ok(ed.some((e) => e.type === "stoneImpact" && e.fire), "level 4 stones leave burning ground");
  ok(count(ed, "die") >= 2, "the group takes area damage");
}

/* ---------------------------------------------------------------- */
console.log("— barracks, soldiers and blocking —");
{
  const s = makeGame({ seed: 21 }); startStage(s);
  buildTower(s, 1, "barracks");
  ok(s.units.length === 3 && s.units.every((u) => u.unit === "militia"), "barracks deploys three militia");
  run(s, 3);
  ok(s.units.every((u) => Math.hypot(u.x - u.home.x, u.y - u.home.y) < 4), "soldiers walk to the rally point");
  const t = s.towers[1];
  const r0 = { ...t.rally };
  setRally(s, 1, r0.x + 400, r0.y);
  ok(Math.hypot(t.rally.x - s.layout.plots[1].x, t.rally.y - s.layout.plots[1].y) <= TOWERS.barracks.rallyRange + 0.01, "rally point is clamped to the barracks range");
  setRally(s, 1, r0.x, r0.y);

  s.queue = [{ t: 0, type: "bandit", route: 0, lat: 0 }]; s.waveState = "active"; s.wave = 1;
  let blockedAt = null;
  const evts = run(s, 16, (g, tt) => {
    const e = g.enemies[0];
    if (e && e.state === "fight" && blockedAt == null) blockedAt = tt;
  });
  ok(blockedAt != null, "the bandit is stopped by the soldiers");
  ok(count(evts, "swing") > 4, "soldiers and bandit trade blows");
  ok(count(evts, "die") === 1, "the militia kill the bandit");

  /* upgrade swaps the unit type in place, sell removes the soldiers */
  s.gold = 500;
  upgradeTower(s, 1);
  ok(s.units.every((u) => u.unit === "manAtArms" && u.hp === 130), "upgrade turns militia into men-at-arms");
  const g0 = s.gold;
  const val = sellValue(s, 1);
  sellTower(s, 1);
  ok(s.towers[1] === null && s.units.length === 0 && s.gold === g0 + val && val === Math.round((90 + 70) * 0.7), "selling refunds 70 % and dismisses the soldiers");

  /* soldier death and respawn */
  const k = makeGame({ seed: 23 }); startStage(k); buildTower(k, 1, "barracks");
  run(k, 3);
  k.queue = [0, 1, 2, 3, 4, 5].map((i) => ({ t: i * 0.3, type: "manAtArms", route: 0, lat: 0 }));
  k.waveState = "active"; k.wave = 1;
  const ek = run(k, 60);
  ok(count(ek, "unitDown") >= 1, "militia fall to a column of men-at-arms");
  ok(count(ek, "respawn") >= 1, "fallen militia return from the barracks");

  /* the outrider breaks free */
  const o = makeGame({ seed: 25 }); startStage(o); buildTower(o, 1, "barracks"); run(o, 3);
  o.queue = [{ t: 0, type: "outrider", route: 0, lat: 0 }]; o.waveState = "active"; o.wave = 1;
  const eo = run(o, 20);
  ok(count(eo, "breakFree") >= 1 || count(eo, "die") === 1, "outrider is held only briefly (breaks free or dies)");
}

/* ---------------------------------------------------------------- */
console.log("— hero —");
{
  const s = makeGame({ seed: 31 }); startStage(s);
  const h = s.hero;
  const sp = s.layout.heroSpawn;
  ok(h.x === sp.x && h.y === sp.y && h.level === 1 && h.hp === HERO.hp, "hero starts at the gate, level 1");
  moveHero(s, 800, 620);
  run(s, 5);
  ok(Math.hypot(h.x - 800, h.y - 620) < 4, "hero walks to the ordered point");

  /* one blocker holds one enemy, so the second bandit is sent well behind */
  s.queue = [{ t: 0, type: "bandit", route: 0, lat: 0 }, { t: 7, type: "bandit", route: 0, lat: 0 }];
  s.waveState = "active"; s.wave = 1;
  const evts = run(s, 45);
  ok(evts.some((e) => e.type === "swing" && e.hero), "hero engages enemies that reach him");
  ok(count(evts, "die") === 2, "hero kills the bandits");
  ok(h.xp > 0, "hero earns experience");

  /* Royal Charge hits every enemy in its path */
  const c = makeGame({ seed: 33 }); startStage(c);
  const ch = c.hero;
  const p = sampleRoute(c.layout.routes[0], 700);
  moveHero(c, p.x + p.tx * 150, p.y + p.ty * 150); run(c, 10);
  c.queue = [0, 1, 2].map((i) => ({ t: i * 0.1, type: "bandit", route: 0, lat: 0 }));
  c.waveState = "active"; c.wave = 1;
  run(c, 0.4);
  c.enemies.forEach((e, i) => { e.d = 700 - i * 22; e.lat = 0; });
  run(c, DT);
  ok(heroCharge(c, p.x - p.tx * 100, p.y - p.ty * 100), "charge accepted when ready");
  const ec = run(c, 1.2);
  ok(count(ec, "chargeHit") === 3, "charge struck all three bandits");
  ok(ch.chargeCd > 15, "charge is on cooldown");
  ok(!heroCharge(c, p.x, p.y), "cannot charge on cooldown");

  /* the hero falls and returns */
  const f = makeGame({ seed: 35 }); startStage(f);
  const q = sampleRoute(f.layout.routes[0], 500);
  moveHero(f, q.x, q.y); run(f, 10);
  f.hero.hp = 20;
  f.queue = [0, 1, 2, 3].map((i) => ({ t: i * 0.2, type: "manAtArms", route: 0, lat: 0 }));
  f.waveState = "active"; f.wave = 1;
  const ef = run(f, 45);
  ok(count(ef, "heroDown") === 1, "hero can be beaten down");
  ok(count(ef, "heroReturn") === 1, "hero returns after the respawn timer");
}

/* ---------------------------------------------------------------- */
console.log("— castle abilities and repair —");
{
  const s = makeGame({ seed: 41 }); startStage(s);
  const p = sampleRoute(s.layout.routes[0], 400);
  s.queue = [0, 1, 2].map((i) => ({ t: i * 0.2, type: "bandit", route: 0, lat: 0 }));
  s.waveState = "active"; s.wave = 1;
  run(s, 0.8);
  s.enemies.forEach((e) => { e.d = 400; });
  run(s, DT);
  ok(castVolley(s, p.x, p.y), "volley cast");
  ok(!castVolley(s, p.x, p.y), "volley on cooldown");
  const ev = run(s, 1.2);
  ok(count(ev, "strike") === 1 && count(ev, "hit") >= 3, "volley lands on all three bandits");
  ok(castReinforce(s, p.x, p.y) && s.units.length === 2, "reinforcements arrive");
  run(s, 16);
  ok(s.units.length === 0, "levies leave after 15 seconds");

  s.castleHp = 10; s.gold = 100;
  ok(repairCastle(s) && s.castleHp === 15 && s.gold === 40, "repair costs 60 for 5 hp");
  ok(!repairCastle(s), "cannot repair without gold");
}

/* ---------------------------------------------------------------- */
console.log("— the ram and the gate —");
{
  const s = makeGame({ seed: 51 }); startStage(s);
  buildTower(s, 5, "barracks");
  run(s, 3);
  s.queue = [{ t: 0, type: "ram", route: 0, lat: 0 }];
  s.waveState = "active"; s.wave = 5;
  const evts = run(s, 90);
  ok(count(evts, "miniboss") === 1, "ram announces itself as a mini-boss");
  const gate = evts.find((e) => e.type === "gateHit");
  ok(gate && gate.dmg === 8 && gate.siege, "the ram is unblockable and hits the gate for 8");
  ok(s.castleHp === 12, "castle health drops to 12");
  ok(evts.some((e) => e.type === "swing" && !e.enemy), "soldiers chase and strike the ram on the way");

  /* defeat */
  const d = makeGame({ seed: 53 }); startStage(d);
  d.queue = [0, 1, 2].map((i) => ({ t: i * 0.5, type: "ram", route: 0, lat: 0 }));
  d.waveState = "active"; d.wave = 1;
  const ed = run(d, 120);
  ok(d.phase === "defeat" && count(ed, "defeat") === 1 && d.castleHp === 0, "three rams bring the castle down → defeat");
  const sum = summarise(d);
  ok(!sum.won && sum.stars === 0, "summary reports the loss");
}

/* ---------------------------------------------------------------- */
console.log("— layout swap —");
{
  const s = makeGame({ seed: 61 }); startStage(s);
  buildTower(s, 1, "barracks"); buildTower(s, 2, "archer");
  s.queue = [{ t: 0, type: "bandit", route: 0, lat: 0 }]; s.waveState = "active"; s.wave = 1;
  run(s, 2);
  const e = s.enemies[0];
  const dBefore = e.d;
  setLayout(s, "portrait");
  ok(s.layout.w === 900 && s.layout.h === 1600, "portrait world is 900 x 1600");
  ok(s.towers[1].type === "barracks" && s.towers[2].type === "archer", "towers keep their plots");
  ok(Math.abs(e.d - dBefore) < 0.01 && e.x >= 0 && e.x <= 900, "enemy keeps its road distance and lands inside the new world");
  ok(s.units.every((u) => u.x >= 0 && u.x <= 900 && u.y >= 0 && u.y <= 1600), "soldiers relocate into the new world");
  const ev = run(s, 30);
  ok(count(ev, "die") === 1 || s.enemies.length === 0, "play continues in portrait");
}

/* ---------------------------------------------------------------- */
console.log("— full stage I, scripted commander —");
{
  const s = makeGame({ seed: 77 });
  startStage(s);
  /* opening: two archers by the road, then a barracks at the bridge */
  const plan = [
    [0, "archer"], [1, "archer"], [2, "barracks"], [4, "ballista"], [3, "archer"], [5, "catapult"], [6, "archer"], [7, "ballista"], [8, "archer"],
  ];
  const log = [];
  let called = 0;
  const evts = run(s, 60 * 12, (g, tt) => {
    /* build in order whenever affordable, then upgrade the cheapest upgrade */
    for (const [plot, type] of plan) {
      if (!g.towers[plot] && canBuild(g, plot, type)) { buildTower(g, plot, type); return; }
    }
    if (g.gold > 140) {
      let best = -1; let bestCost = Infinity;
      g.towers.forEach((t, i) => {
        if (!t || t.level >= 4) return;
        const c = TOWERS[t.type].upgrades[t.level - 1];
        if (c < bestCost && c <= g.gold) { bestCost = c; best = i; }
      });
      if (best >= 0) { upgradeTower(g, best); return; }
    }
    /* hero holds the bridge; charges when a crowd is near */
    const h = g.hero;
    const near = g.enemies.filter((e) => e.state !== "dead" && Math.hypot(e.x - h.x, e.y - h.y) < 200);
    if (near.length >= 3 && h.chargeCd <= 0 && !h.charge) heroCharge(g, near[0].x, near[0].y);
    if (h.state === "idle" && !h.moveTarget && near.length === 0 && g.enemies.length) {
      const far = g.enemies.reduce((a, e) => (e.progress > a.progress ? e : a), g.enemies[0]);
      if (far.progress > 0.55) moveHero(g, far.x, far.y);
    }
    /* castle abilities on the thickest crowd */
    if (g.abilities.volley <= 0 && g.enemies.length >= 4) { const e = g.enemies[0]; castVolley(g, e.x, e.y); }
    if (g.abilities.reinforce <= 0 && g.enemies.some((e) => e.progress > 0.85)) { const e = g.enemies.find((x) => x.progress > 0.85); castReinforce(g, e.x, e.y); }
    if (g.castleHp < 14 && g.gold > 200) repairCastle(g);
    /* early calls after wave 2 once the field is calm */
    if (g.waveState === "countdown" && g.wave >= 2 && g.countdown < g.countdownMax - 4 && g.enemies.length === 0) { if (callWave(g)) called += 1; }
  });
  const waves = evts.filter((e) => e.type === "wave").map((e) => e.n);
  log.push(`waves started: ${waves.join(",")}`);
  ok(waves.length === 8, `all 8 waves ran (${waves.join(" ")})`);
  ok(evts.some((e) => e.type === "routeOpen" && e.route === 1), "the second route opened on wave 4");
  ok(evts.some((e) => e.type === "spawn" && e.route === 1), "enemies used the second route");
  ok(count(evts, "miniboss") >= 1, "the ram mini-boss appeared");
  ok(count(evts, "earlyBonus") >= 1 && called >= 1, "early calls paid a bonus");
  ok(count(evts, "waveClear") === 8, "every wave was cleared");
  ok(s.phase === "victory", `stage I won (castle ${s.castleHp}/${s.castleMax}, score ${s.stats.score})`);
  const sum = summarise(s);
  ok(sum.won && sum.stars >= 1 && sum.stars <= 3, `stars awarded: ${sum.stars}`);
  ok(s.hero.level >= 2, `hero levelled up (level ${s.hero.level})`);
  ok(s.towers.filter(Boolean).length >= 7, `commander built ${s.towers.filter(Boolean).length} towers`);
  ok(s.towers.some((t) => t && t.level === 4), "at least one tower reached level 4");
  const types = new Set(evts.filter((e) => e.type === "spawn").map((e) => e.enemy));
  ok(["bandit", "archer", "manAtArms", "outrider", "shieldBearer", "ram"].every((t) => types.has(t)), "all six stage I enemy types appeared");
  console.log(`      ${log.join(" | ")} | time ${Math.round(s.t)}s | kills ${s.stats.kills}`);

  /* the same seed replays identically */
  const r = makeGame({ seed: 77 }); startStage(r);
  buildTower(r, 0, "archer"); run(r, 25);
  const r2 = makeGame({ seed: 77 }); startStage(r2);
  buildTower(r2, 0, "archer"); run(r2, 25);
  ok(r.gold === r2.gold && r.enemies.length === r2.enemies.length, "seeded runs are deterministic");

  resetGame(s);
  ok(s.phase === "ready" && s.gold === 250 && s.towers.every((t) => !t) && s.enemies.length === 0, "resetGame returns to a fresh stage");
}

/* ---------------------------------------------------------------- */
console.log("— endless mode —");
{
  const s = makeGame({ seed: 91, mode: "endless" }); startStage(s);
  s.gold = 5000;
  [0, 1, 2, 3, 4].forEach((i) => buildTower(s, i, i === 2 ? "barracks" : "archer"));
  const evts = run(s, 120, (g) => { if (g.waveState === "countdown" && g.countdown < g.countdownMax - 1) callWave(g); });
  const waves = evts.filter((e) => e.type === "wave");
  ok(waves.length >= 2, `endless keeps generating waves (${waves.length} in 2 minutes)`);
  ok(waves.every((w) => w.summary.length >= 1), "endless waves have a composition");
  ok(s.phase !== "victory", "endless never declares victory");
  const spawned = new Set(evts.filter((e) => e.type === "spawn").map((e) => e.enemy));
  ok(!spawned.has("scoutCav") && !spawned.has("knightCav"), "stage I endless stays cavalry-free");

  const e2 = makeGame({ seed: 93, mode: "endless", stageId: "stonebridge" }); startStage(e2);
  e2.gold = 9000; [0, 1, 2, 3, 4, 7].forEach((i) => buildTower(e2, i, i === 2 ? "barracks" : "archer"));
  const ev2 = run(e2, 240, (g) => { if (g.waveState === "countdown" && g.countdown < g.countdownMax - 1) callWave(g); });
  const sp2 = new Set(ev2.filter((e) => e.type === "spawn").map((e) => e.enemy));
  ok(sp2.has("scoutCav") || sp2.has("knightCav"), `stage II endless fields cavalry (${[...sp2].join(", ")})`);
}


/* ---------------------------------------------------------------- */
console.log("— edge cases —");
{
  /* selling a barracks mid-fight releases the enemy it was blocking */
  const s = makeGame({ seed: 101 }); startStage(s); buildTower(s, 1, "barracks"); run(s, 3);
  s.queue = [{ t: 0, type: "bandit", route: 0, lat: 0 }]; s.waveState = "active"; s.wave = 1;
  run(s, 14, (g) => { const e = g.enemies[0]; if (e && e.state === "fight" && g.towers[1]) sellTower(g, 1); });
  const e = s.enemies[0];
  ok(!s.towers[1] && s.units.length === 0, "barracks sold while fighting: soldiers dismissed");
  ok(!e || e.blockers.length === 0, "the released bandit has no blockers left");
  const ev = run(s, 60);
  ok(count(ev, "gateHit") === 1 || count(ev, "die") === 1, "the bandit walks on to the gate (or dies)");

  /* upgrading a barracks mid-fight keeps the soldiers engaged */
  const u = makeGame({ seed: 103 }); startStage(u); buildTower(u, 1, "barracks"); run(u, 3);
  u.queue = [{ t: 0, type: "manAtArms", route: 0, lat: 0 }]; u.waveState = "active"; u.wave = 1; u.gold = 999;
  let upgraded = false;
  const eu = run(u, 40, (g) => { const e = g.enemies[0]; if (e && e.state === "fight" && !upgraded) { upgraded = upgradeTower(g, 1); } });
  ok(upgraded && u.units.every((x) => x.unit === "manAtArms"), "barracks upgraded mid-fight");
  ok(count(eu, "die") === 1, "the upgraded soldiers finish the man-at-arms");

  /* charging toward the map edge is clamped and never leaves the world */
  const c = makeGame({ seed: 105 }); startStage(c);
  moveHero(c, 30, 30); run(c, 20);
  ok(!heroCharge(c, -500, -500), "a charge that would leave the map is refused");
  ok(heroCharge(c, 400, 30), "a charge along the edge is accepted");
  run(c, 2);
  ok(c.hero.x >= 0 && c.hero.y >= 0 && c.hero.x <= 1600, `hero stays inside the world (${Math.round(c.hero.x)}, ${Math.round(c.hero.y)})`);

  /* layout swap while a barracks has a custom rally point resets it sanely */
  const l = makeGame({ seed: 107 }); startStage(l); buildTower(l, 2, "barracks"); setRally(l, 2, l.layout.plots[2].x + 100, l.layout.plots[2].y);
  setLayout(l, "portrait");
  const p2 = l.layout.plots[2];
  ok(Math.hypot(l.towers[2].rally.x - p2.x, l.towers[2].rally.y - p2.y) <= 200, "rally point re-derived for the portrait plot");
  setLayout(l, "landscape");
  ok(l.layout.w === 1600, "and back to landscape");

  /* abilities cannot be cast before the stage starts or after it ends */
  const v = makeGame({ seed: 109 });
  ok(!castVolley(v, 100, 100) && !buildTower(v, 0, "archer") && !moveHero(v, 100, 100), "no actions while the stage is not playing");
}

/* ================================================================ */
console.log("— stage II data —");
{
  const st = STAGES[1];
  ok(st.available && st.pikes && st.waves.length === 10, "Stonebridge Ford is available with 10 waves and pike drill");
  for (const name of ["landscape", "portrait"]) {
    const L = st.layouts[name];
    ok(L.plots.length === 10 && L.routes.length === 3, `${name}: 10 plots, 3 routes`);
    const s = makeGame({ stageId: "stonebridge", layout: name });
    const gate = L.castle.gate;
    for (const r of L.routes) { const last = r.points[r.points.length - 1]; ok(Math.hypot(last.x - gate.x, last.y - gate.y) < 20, `${name}: route ends at the gate`); }
    s.layout.plots.forEach((p, i) => {
      let minD = Infinity;
      for (const route of s.layout.routes) for (const q of route.pts) minD = Math.min(minD, Math.hypot(q.x - p.x, q.y - p.y));
      ok(minD > PLOT_R + 8 && minD < 200, `${name}: plot ${i} beside a road (${Math.round(minD)})`);
      const c = L.castle;
      ok(!(p.x > c.x - 30 && p.x < c.x + c.w + 30 && p.y > c.y - 30 && p.y < c.y + c.h + 30), `${name}: plot ${i} clear of the castle`);
      for (const f of L.fields) ok(!(p.x > f.x - 36 && p.x < f.x + f.w + 36 && p.y > f.y - 20 && p.y < f.y + f.h + 20), `${name}: plot ${i} clear of the fields`);
    });
    ok(s.layout.routes[1].opensAt === 4 && s.layout.routes[2].opensAt === 7, `${name}: routes 1 and 2 open on waves 4 and 7`);
    ok(s.layout.narrow.length === 2, `${name}: bridge and wall gap are narrow zones`);
    /* the narrow zones sit on the roads */
    for (const z of L.narrow) {
      let minD = Infinity;
      for (const route of s.layout.routes) for (const q of route.pts) minD = Math.min(minD, Math.hypot(q.x - z.x, q.y - z.y));
      ok(minD < 30, `${name}: narrow zone "${z.name}" is on a road`);
    }
  }
  const s1 = makeGame({ stageId: "greenhollow" });
  ok(s1.layout.routes[1].opensAt === 4, "stage I still opens its second road on wave 4");
}

/* ================================================================ */
console.log("— cavalry —");
const stone = (seed) => { const s = makeGame({ stageId: "stonebridge", seed }); startStage(s); return s; };
{
  /* a knight charges a militia squad on the open road */
  const s = stone(201);
  buildTower(s, 1, "barracks"); run(s, 3);
  s.queue = [{ t: 0, type: "knightCav", route: 0, lat: 0 }]; s.waveState = "active"; s.wave = 5;
  const ev = run(s, 40);
  ok(count(ev, "chargeWarn") >= 1, "knight telegraphs a charge");
  ok(count(ev, "chargeStart") >= 1, "the charge begins after the windup");
  ok(count(ev, "cavImpact") >= 1, "the charge hits soldiers");
  ok(ev.some((e) => e.type === "unitHit" && e.dtype === "charge"), "charge impact deals damage");
  const warn = ev.find((e) => e.type === "chargeWarn"); const start = ev.find((e) => e.type === "chargeStart");
  ok(warn && start && Math.abs(warn.buildup - 1.6) < 0.01, "warning carries the windup time");

  /* no charge inside a narrow zone: put the knight on the bridge with a squad ahead */
  const n = stone(203);
  buildTower(n, 6, "barracks"); run(n, 3);
  n.queue = [{ t: 0, type: "knightCav", route: 1, lat: 0 }]; n.waveState = "active"; n.wave = 5;
  let warnedInNarrow = false;
  run(n, 30, (g) => { const e = g.enemies[0]; if (e && e.chargeT > 0 && e.narrow) warnedInNarrow = true; });
  ok(!warnedInNarrow, "charges never start in a narrow zone");

  /* pikes: braced pikemen break the charge and hurt the horse */
  const pk = stone(205);
  buildTower(pk, 1, "barracks");
  ok(canDrill(pk, 1), "pike drill available on stage II barracks");
  const g0 = pk.gold;
  ok(setDrill(pk, 1, true) && pk.gold === g0 - DRILL_COST && pk.units.every((u) => u.unit === "pikeMilitia" && u.def.spear), "drill switches the squad to pikemen for 40 gold");
  ok(setDrill(pk, 1, true) && pk.gold === g0 - DRILL_COST, "re-selecting the same drill is free");
  run(pk, 3);
  pk.queue = [{ t: 0, type: "knightCav", route: 0, lat: 0 }]; pk.waveState = "active"; pk.wave = 5;
  const epk = run(pk, 40);
  ok(count(epk, "brace") >= 1, "pikemen brace when the charge is coming");
  ok(epk.some((e) => e.type === "chargeBroken" && e.by === "pikes"), "braced pikes break the charge");
  ok(count(epk, "die") === 1, "the knight dies to the pikes");
  const knightHits = epk.filter((e) => e.type === "hit" && e.enemy === "knightCav").map((e) => e.amount);
  ok(Math.max(...knightHits) >= 60, `the pike took the horse for ${Math.round(Math.max(...knightHits))} damage`);

  /* pikes pay for it against archers */
  const sw = stone(207); buildTower(sw, 1, "barracks"); run(sw, 3);
  sw.queue = [0, 1, 2].map((i) => ({ t: i * 0.3, type: "archer", route: 0, lat: 0 })); sw.waveState = "active"; sw.wave = 2;
  const esw = run(sw, 25);
  const pkA = stone(207); buildTower(pkA, 1, "barracks"); setDrill(pkA, 1, true); run(pkA, 3);
  pkA.queue = [0, 1, 2].map((i) => ({ t: i * 0.3, type: "archer", route: 0, lat: 0 })); pkA.waveState = "active"; pkA.wave = 2;
  const epkA = run(pkA, 25);
  const hpLeft = (g) => g.units.reduce((a, u) => a + Math.max(0, u.hp), 0);
  ok(hpLeft(pkA) < hpLeft(sw) || count(epkA, "unitDown") > count(esw, "unitDown"), "pikemen suffer more from archers than swordsmen");

  /* upgrading a pike barracks keeps pikes */
  pkA.gold = 500; upgradeTower(pkA, 1);
  ok(pkA.units.every((u) => u.unit === "pikeManAtArms"), "upgrade keeps the pike drill");
  ok(setDrill(pkA, 1, false) && pkA.units.every((u) => u.unit === "manAtArms"), "drill back to swords");

  /* stage I barracks cannot drill (nothing changes there) */
  const s1 = makeGame({ seed: 1 }); startStage(s1); buildTower(s1, 1, "barracks");
  ok(!canDrill(s1, 1) && !setDrill(s1, 1, true), "no pike drill on stage I");

  /* scouts slip past a block quickly */
  const sc = stone(209); buildTower(sc, 1, "barracks"); run(sc, 3);
  sc.queue = [{ t: 0, type: "scoutCav", route: 0, lat: 0 }]; sc.waveState = "active"; sc.wave = 3;
  const esc = run(sc, 30);
  ok(count(esc, "breakFree") >= 1 || count(esc, "gateHit") === 1 || count(esc, "die") === 1, "scout breaks free or is dealt with");

  /* the hero's Royal Charge breaks a charge */
  const h = stone(211);
  const p = sampleRoute(h.layout.routes[0], 500);
  moveHero(h, p.x + p.tx * 120, p.y + p.ty * 120); run(h, 12);
  h.queue = [{ t: 0, type: "knightCav", route: 0, lat: 0 }]; h.waveState = "active"; h.wave = 5;
  let broke = false;
  const eh = run(h, 40, (g) => {
    const e = g.enemies[0];
    if (e && (e.chargeT > 0 || e.charging) && g.hero.chargeCd <= 0 && !g.hero.charge && Math.hypot(e.x - g.hero.x, e.y - g.hero.y) < 240) heroCharge(g, e.x, e.y);
  });
  broke = eh.some((e) => e.type === "chargeBroken" && e.by === "hero");
  ok(broke, "Royal Charge interrupts an enemy cavalry charge");

  /* the commander buffs nearby cavalry and is a mini-boss */
  const c = stone(213);
  c.queue = [{ t: 0, type: "cavCommander", route: 0, lat: 0 }, { t: 0.5, type: "knightCav", route: 0, lat: 10 }]; c.waveState = "active"; c.wave = 10;
  const ec = run(c, 4);
  ok(count(ec, "miniboss") === 1, "the commander announces himself as a mini-boss");
  const knight = c.enemies.find((e) => e.type === "knightCav");
  ok(knight && knight.buffT > 0 && knight.buffSpeed > 1, "knights near the commander are buffed");
}

/* ================================================================ */
console.log("— full stage II, scripted commander —");
{
  const s = stone(277);
  const plan = [[1, "archer"], [0, "archer"], [2, "barracks"], [4, "ballista"], [3, "archer"], [8, "barracks"], [7, "ballista"], [6, "archer"], [5, "catapult"], [9, "archer"]];
  let called = 0;
  const evts = run(s, 60 * 16, (g) => {
    for (const [plot, type] of plan) { if (!g.towers[plot] && canBuild(g, plot, type)) { buildTower(g, plot, type); return; } }
    g.towers.forEach((t, i) => { if (t && t.type === "barracks" && !t.pikes && g.wave >= 3 && g.gold >= DRILL_COST + 60) setDrill(g, i, true); });
    if (g.gold > 160) {
      let best = -1; let bestCost = Infinity;
      g.towers.forEach((t, i) => { if (!t || t.level >= 4) return; const cst = TOWERS[t.type].upgrades[t.level - 1]; if (cst < bestCost && cst <= g.gold) { bestCost = cst; best = i; } });
      if (best >= 0) { upgradeTower(g, best); return; }
    }
    const h = g.hero;
    const near = g.enemies.filter((e) => e.state !== "dead" && Math.hypot(e.x - h.x, e.y - h.y) < 220);
    const charging = near.find((e) => e.def.charge && (e.charging || e.chargeT > 0));
    if (charging && h.chargeCd <= 0 && !h.charge) heroCharge(g, charging.x, charging.y);
    else if (near.length >= 3 && h.chargeCd <= 0 && !h.charge) heroCharge(g, near[0].x, near[0].y);
    if (h.state === "idle" && !h.moveTarget && near.length === 0 && g.enemies.length) { const far = g.enemies.reduce((a, e) => (e.progress > a.progress ? e : a), g.enemies[0]); if (far.progress > 0.5) moveHero(g, far.x, far.y); }
    if (g.abilities.volley <= 0 && g.enemies.length >= 4) { const e = g.enemies[0]; castVolley(g, e.x, e.y); }
    if (g.abilities.reinforce <= 0 && g.enemies.some((e) => e.progress > 0.85)) { const e = g.enemies.find((x) => x.progress > 0.85); castReinforce(g, e.x, e.y); }
    if (g.castleHp < 14 && g.gold > 200) repairCastle(g);
    if (g.waveState === "countdown" && g.wave >= 2 && g.countdown < g.countdownMax - 4 && g.enemies.length === 0) { if (callWave(g)) called += 1; }
  });
  const waves = evts.filter((e) => e.type === "wave").map((e) => e.n);
  ok(waves.length === 10, `all 10 waves ran (${waves.join(" ")})`);
  ok(evts.some((e) => e.type === "routeOpen" && e.route === 1) && evts.some((e) => e.type === "routeOpen" && e.route === 2), "both extra roads opened");
  ok(evts.some((e) => e.type === "spawn" && e.route === 2), "enemies used the third road");
  ok(count(evts, "chargeStart") >= 5, `cavalry charged ${count(evts, "chargeStart")} times`);
  ok(evts.some((e) => e.type === "chargeBroken"), "at least one charge was broken");
  ok(evts.some((e) => e.type === "miniboss" && e.enemy === "cavCommander"), "Captain Malric appeared");
  ok(s.phase === "victory" || s.phase === "defeat", `stage II ended (${s.phase}, castle ${s.castleHp}/${s.castleMax}, score ${s.stats.score}, wave ${s.wave})`);
  ok(s.phase === "victory", "the scripted commander wins stage II");
  const types = new Set(evts.filter((e) => e.type === "spawn").map((e) => e.enemy));
  ok(["scoutCav", "knightCav", "cavCommander", "crossbow", "outrider", "shieldBearer"].every((t) => types.has(t)), "every stage II enemy type appeared");
  console.log(`      time ${Math.round(s.t)}s | kills ${s.stats.kills} | hero level ${s.hero.level} | early calls ${called}`);
}

/* ================================================================ */
console.log("— wave display —");
{
  /* totals come from stage data, never a constant */
  const s1 = makeGame({ seed: 1 }); const s2 = makeGame({ seed: 1, stageId: "stonebridge" });
  ok(s1.totalWaves === STAGES[0].waves.length && s1.totalWaves === 8, "stage I total is its own wave count (8)");
  ok(s2.totalWaves === STAGES[1].waves.length && s2.totalWaves === 10, "stage II total is its own wave count (10)");
  const d0 = displayWave(0, "countdown", 10);
  ok(d0.counter === "1 / 10" && d0.left === 9 && d0.note === "9 left" && !d0.final, "before the first wave the pill reads 1 / 10 with 9 left");
  const d6 = displayWave(6, "active", 10);
  ok(d6.counter === "6 / 10" && d6.left === 4 && d6.note === "4 left", "during wave 6 the pill reads 6 / 10 with 4 left");
  const d6c = displayWave(6, "countdown", 10);
  ok(d6c.counter === "7 / 10" && d6c.left === 3, "the countdown after wave 6 announces 7 / 10");
  const d10 = displayWave(10, "active", 10);
  ok(d10.counter === "10 / 10" && d10.final && d10.note === "Final wave", "wave 10 is marked final");
  const d9c = displayWave(9, "countdown", 10);
  ok(d9c.counter === "10 / 10" && d9c.final, "the countdown into the last wave is already marked final");
  const de = displayWave(12, "active", Infinity);
  ok(de.counter === "12" && de.endless && de.note === "Endless", "endless mode shows the wave alone");
  const c5 = waveCard(5, 10, STAGES[1].waveTitles, []);
  ok(c5.title === "Wave 5 / 10" && c5.sub === "Armoured knights" && c5.kind === "waveBig", "named waves get their subtitle");
  ok(plural("Crossbowman", 4) === "4 Crossbowmen" && plural("Man-at-Arms", 8) === "8 Men-at-Arms" && plural("Bandit", 1) === "1 Bandit" && plural("Cavalry Scout", 6) === "6 Cavalry Scouts", "wave lists pluralise properly");
  const c1 = waveCard(1, 10, STAGES[1].waveTitles, [{ count: 10, name: "Bandit" }]);
  ok(c1.title === "Wave 1 / 10" && c1.sub === "10 Bandits" && c1.kind === "wave", "plain waves list their composition");
  const c10 = waveCard(10, 10, STAGES[1].waveTitles, []);
  ok(c10.title === "Final wave" && c10.sub === "10 / 10 · Captain Malric approaches" && c10.kind === "final", "the final wave card names Captain Malric");
  const c8 = waveCard(8, 8, STAGES[0].waveTitles, []);
  ok(c8.title === "Final wave" && c8.sub === "8 / 8 · The last push", "stage I's final wave uses its own total");

  /* the sequence of wave events is 1..10 with no gaps or repeats, restart goes back to the start */
  const g = makeGame({ seed: 5, stageId: "stonebridge" }); startStage(g); g.gold = 20000;
  const kinds = ["archer", "archer", "barracks", "ballista", "ballista", "catapult", "archer", "ballista", "barracks", "archer"];
  kinds.forEach((k, i) => { buildTower(g, i, k); upgradeTower(g, i); upgradeTower(g, i); upgradeTower(g, i); });
  setDrill(g, 2, true); setDrill(g, 8, true);
  const evts = run(g, 60 * 14, (x) => { if (x.waveState === "countdown" && x.countdown < x.countdownMax - 1 && x.enemies.length === 0) callWave(x); });
  const seq = evts.filter((e) => e.type === "wave").map((e) => e.n);
  ok(seq.join(",") === "1,2,3,4,5,6,7,8,9,10", `wave events run 1 to 10 exactly once each (${seq.join(",")})`);
  const malric = evts.find((e) => e.type === "spawn" && e.enemy === "cavCommander");
  const waveAtMalric = evts.slice(0, evts.indexOf(malric)).filter((e) => e.type === "wave").length;
  ok(malric && waveAtMalric === 10, "Captain Malric spawns during wave 10");
  ok(evts.filter((e) => e.type === "wave" && e.total === 10).length === 10, "every wave event carries the stage total");
  resetGame(g);
  const dr = displayWave(g.wave, g.waveState, g.totalWaves);
  ok(g.wave === 0 && dr.counter === "1 / 10", "restart resets the display to 1 / 10");
}

/* ================================================================ */
console.log("— save and continue —");
{
  const s = makeGame({ seed: 401, stageId: "stonebridge" }); startStage(s);
  s.gold = 900;
  buildTower(s, 1, "archer"); buildTower(s, 2, "barracks"); buildTower(s, 4, "ballista"); upgradeTower(s, 1); setDrill(s, 2, true);
  run(s, 20, (g) => { if (g.waveState === "countdown" && g.countdown < g.countdownMax - 1) callWave(g); });
  run(s, 25);                       // mid-wave: enemies on the road
  moveHero(s, 700, 500); run(s, 4);
  const snap = serializeGame(s);
  ok(snap.v === BATTLE_FORMAT && snap.stageId === "stonebridge" && snap.wave === s.wave, "serializeGame records the stage and wave");
  ok(JSON.stringify(snap).length < 40000, `battle save is compact (${JSON.stringify(snap).length} bytes)`);
  const r = restoreGame(JSON.parse(JSON.stringify(snap)));
  ok(r.phase === "playing" && r.wave === s.wave && r.waveState === s.waveState, "restore keeps the wave and its state");
  ok(r.gold === s.gold && r.castleHp === s.castleHp, "restore keeps gold and castle health");
  ok(r.towers[1].type === "archer" && r.towers[1].level === 2 && r.towers[2].pikes && r.towers[4].type === "ballista", "restore keeps towers, levels and the pike drill");
  ok(r.units.length === s.units.filter((u) => !u.remove).length && r.units.every((u) => u.unit === "pikeMilitia"), "restore keeps the squad as pikemen");
  ok(r.enemies.length === s.enemies.filter((e) => e.state !== "dead").length, "restore keeps every living enemy");
  ok(Math.abs(r.hero.x - Math.round(s.hero.x)) <= 1 && r.hero.level === s.hero.level, "restore keeps the hero where he stood");
  ok(r.queue.length === s.queue.length, "restore keeps the pending spawns");
  /* the restored game plays on to the end */
  r.gold = 20000;
  [0, 3, 5, 6, 7, 8, 9].forEach((i) => { buildTower(r, i, i === 8 ? "barracks" : "ballista"); upgradeTower(r, i); upgradeTower(r, i); upgradeTower(r, i); });
  upgradeTower(r, 1); upgradeTower(r, 1); upgradeTower(r, 2); upgradeTower(r, 2); upgradeTower(r, 2); setDrill(r, 8, true);
  const ev = run(r, 60 * 14, (g) => { if (g.waveState === "countdown" && g.countdown < g.countdownMax - 1 && g.enemies.length === 0) callWave(g); });
  ok(r.phase === "victory", `a restored battle can be played to victory (wave ${r.wave}, castle ${r.castleHp})`);
  ok(ev.filter((e) => e.type === "wave").map((e) => e.n).every((n, i, a) => i === 0 || n === a[i - 1] + 1), "wave numbers stay consecutive after a restore");
  /* a restore into the other layout still works */
  const rp = restoreGame(snap, { layout: "portrait" });
  ok(rp.layout.name === "portrait" && rp.enemies.every((e) => e.x >= 0 && e.x <= 900) && rp.units.every((u) => u.x >= 0 && u.x <= 900), "restoring into portrait relocates everyone inside the new map");
  /* bad formats fail safely */
  let threw = false; try { restoreGame({ v: 1, stageId: "greenhollow" }); } catch { threw = true; }
  ok(threw, "an unsupported battle format is rejected, not crashed through");

  /* the save record: versioned, migrates, keeps and clears the battle slot */
  const fresh = resetProgress(readSave());
  ok(fresh.version === SAVE_VERSION && fresh.battle === null && fresh.meta.crowns === 0, "fresh save is version 2 with no battle");
  const withBattle = saveBattle(fresh, snap);
  ok(readSave().battle && readSave().battle.stageId === "stonebridge" && readSave().battle.wave === snap.wave, "battle slot round-trips through storage");
  const cleared = clearBattle(withBattle);
  ok(cleared.battle === null && readSave().battle === null, "clearBattle empties the slot");
  writeSave({ stages: { greenhollow: { stars: 2, bestScore: 100, completed: true } }, settings: { music: false } });
  const migrated = readSave();
  ok(migrated.version === SAVE_VERSION && migrated.stages.greenhollow.stars === 2 && migrated.settings.music === false && migrated.battle === null, "a version-1 record migrates with progress and settings kept");
  writeSave({ version: SAVE_VERSION, stages: {}, battle: { v: 1, stageId: "greenhollow" } });
  ok(readSave().battle && (() => { try { restoreGame(readSave().battle); return false; } catch { return true; } })(), "a stale battle in the slot is rejected on restore");
  const quit = recordResult(saveBattle(readSave(), snap), { stageId: "stonebridge", mode: "campaign", difficulty: "normal", won: false, finished: false, stars: 0, score: 1200, wave: 3 });
  ok(quit.save.battle && quit.save.battle.stageId === "stonebridge" && quit.save.stages.stonebridge.bestScore === 1200, "quitting to the menu keeps the saved battle and still banks the score");
  const won = recordResult(quit.save, { stageId: "stonebridge", mode: "campaign", difficulty: "normal", won: true, finished: true, stars: 2, score: 5000, wave: 10 });
  ok(won.save.battle === null && won.crowns === 5 && won.save.meta.crowns === 5, "victory clears the battle and pays crowns (3 first-clear + 2 stars)");
  const lost = recordResult(saveBattle(won.save, snap), { stageId: "stonebridge", mode: "campaign", difficulty: "normal", won: false, finished: true, stars: 0, score: 100, wave: 4 });
  ok(lost.save.battle === null, "defeat clears the battle too");
  resetProgress(readSave());
}

/* ================================================================ */
console.log("— soldier orders —");
{
  const s = makeGame({ seed: 501, stageId: "stonebridge" }); startStage(s); s.gold = 900;
  s.stage = { ...s.stage, countdown: 9999 }; s.countdown = 9999; s.countdownMax = 9999;   // no surprise waves during the drill
  buildTower(s, 2, "barracks"); run(s, 3);
  const ids = squadOf(s, 2);
  ok(ids.length === 3, "squad lookup finds three soldiers");
  const one = s.units[0];
  ok(isFullSquad(s, ids) && !isFullSquad(s, [one.id]) && !isFullSquad(s, ids.slice(0, 2)), "a whole squad is recognised; one or two of its soldiers are not");
  ok(unitAt(s, one.x, one.y - 18, 26) === one, "unitAt picks the tapped soldier");
  ok(orderUnits(s, [one.id], { kind: "move", x: 700, y: 560 }), "move order accepted");
  run(s, 6);
  ok(Math.hypot(one.x - 700, one.y - 560) < 30 && Math.hypot(s.units[1].x - 700, s.units[1].y - 560) > 120, "only the ordered soldier walked; the others stayed");
  ok(orderUnits(s, ids, { kind: "move", x: 900, y: 520 }), "squad move accepted"); run(s, 8);
  ok(s.units.every((u) => Math.hypot(u.x - 900, u.y - 520) < 45), "the whole squad regroups around the point");
  ok(orderUnits(s, [one.id], { kind: "hold" }) && one.hold, "hold order sets the soldier's feet");
  /* a held soldier does not chase an enemy passing at rally range */
  s.queue = [{ t: 0, type: "bandit", route: 0, lat: 0 }]; s.waveState = "active"; s.wave = 1;
  const e = (() => { run(s, 0.1); return s.enemies[0]; })();
  e.d = 640; run(s, 1 / 60);
  const far = Math.hypot(e.x - one.x, e.y - one.y);
  run(s, 2);
  ok(far > 60 ? one.target !== e.id : true, "a held soldier ignores enemies beyond arm's reach");
  ok(orderUnits(s, ids, { kind: "attack", enemyId: e.id }), "attack order accepted");
  const ev = run(s, 25);
  ok(ev.some((x) => x.type === "swing" && !x.enemy) && count(ev, "die") >= 1, "the squad hunts the ordered target down");
  ok(s.units.every((u) => u.forceTarget == null && (!u.order || u.order.kind !== "attack")), "the attack order clears when the target dies");
  ok(orderUnits(s, ids, { kind: "gate" }), "defend-gate order accepted"); run(s, 12);
  ok(s.units.every((u) => Math.hypot(u.x - s.layout.heroSpawn.x, u.y - s.layout.heroSpawn.y) < 90), "the squad stands at the gate");
  ok(orderUnits(s, ids, { kind: "tower", plot: 4 }), "defend-tower order accepted"); run(s, 12);
  const p4 = s.layout.plots[4];
  ok(s.units.every((u) => Math.hypot(u.x - p4.x, u.y - p4.y) < 200), "the squad moves to the tower's road");
  ok(orderUnits(s, ids, { kind: "rally" }), "return-to-rally accepted"); run(s, 10);
  ok(s.units.every((u) => Math.hypot(u.x - s.towers[2].rally.x, u.y - s.towers[2].rally.y) < 40 && !u.order), "the squad is back at its rally point");
  ok(!orderUnits(s, [s.hero.id], { kind: "hold" }), "the hero takes no squad orders");
  /* abilities: pikes brace on command, knights raise shields */
  setDrill(s, 2, true);
  const ab = sharedAbility(s, ids);
  ok(ab && ab.id === "braceSpears" && ab.ready, "pikemen share Brace Spears");
  ok(triggerUnitAbility(s, ids), "Brace Spears used"); run(s, 0.5);
  ok(s.units.every((u) => u.bracing && u.abilityCd > 10), "pikes are braced with the ability on cooldown");
  ok(!sharedAbility(s, ids).ready, "ability not ready while cooling down");
  setDrill(s, 2, false); s.gold = 900; upgradeTower(s, 2); upgradeTower(s, 2);
  const ab2 = sharedAbility(s, squadOf(s, 2));
  ok(ab2 && ab2.id === "shieldBrace", "foot knights share Shield Brace");
  ok(!sharedAbility(s, [ids[0]]) || SOLDIERS[s.units[0].unit].ability, "militia have no ability button");
}

/* ================================================================ */
console.log("— perks and powers —");
{
  const s = makeGame({ seed: 601, stageId: "stonebridge" }); startStage(s);
  ok(!s.perkPending && s.perks.length === 0, "no perk at the start");
  s.gold = 20000;
  ["archer", "archer", "barracks", "ballista", "ballista", "catapult", "archer", "ballista", "barracks", "archer"].forEach((k, i) => { buildTower(s, i, k); upgradeTower(s, i); upgradeTower(s, i); upgradeTower(s, i); });
  setDrill(s, 2, true); setDrill(s, 8, true);
  let offers = [];
  AUTO_PERK = false;
  const evts = run(s, 60 * 6, (g) => {
    if (g.perkPending) { offers.push(g.perkOffer.slice()); choosePerk(g, g.perkOffer[0]); }
    if (g.waveState === "countdown" && g.countdown < g.countdownMax - 1 && g.enemies.length === 0) callWave(g);
  });
  ok(offers.length >= 2 && offers.every((o) => o.length === 3 && new Set(o).size === 3), `milestone waves offered three distinct perks (${offers.length} offers)`);
  const offerWaves = evts.filter((e) => e.type === "perkOffer").map((e) => e.wave);
  ok(offerWaves[0] === 3 && offerWaves[1] === 6, `offers came after waves 3 and 6 (${offerWaves.join(",")})`);
  ok(s.perks.length === offers.length && new Set(s.perks).size === s.perks.length, "each choice was recorded once, never repeated");
  AUTO_PERK = true;
  ok(evts.some((e) => e.type === "unlock" && e.id === "watchfire"), "Watchfire unlocks when its wave begins");

  /* the clock waits for the choice */
  const w = makeGame({ seed: 603, stageId: "stonebridge" }); startStage(w); w.wave = 3; w.waveState = "countdown"; w.countdown = 10; w.countdownMax = 20;
  offerPerks(w);
  ok(w.perkPending && w.perkOffer.length === 3, "offerPerks sets a pending choice");
  AUTO_PERK = false;
  run(w, 3);
  ok(Math.abs(w.countdown - 10) < 0.01 && !callWave(w), "the countdown waits and early calls are refused while a perk is pending");
  ok(skipPerk(w) && !w.perkPending, "a perk can be skipped"); run(w, 1); ok(w.countdown < 10, "the clock runs again");
  AUTO_PERK = true;

  /* modifiers do what they say */
  const m = makeGame({ seed: 605, stageId: "stonebridge" }); startStage(m); m.gold = 5000; m.wave = 6; m.waveState = "countdown";
  m.perkOffer = ["longFletch", "hardyLevies", "quarry"]; m.perkPending = true;
  ok(choosePerk(m, "hardyLevies") && m.mods.soldierHp === 0.15, "Hardy Levies adds +15% soldier health");
  buildTower(m, 2, "barracks");
  ok(m.units[0].maxHp === Math.round(SOLDIERS.militia.hp * 1.15), "new soldiers spawn with the bonus health");
  m.perkOffer = ["quarry"]; m.perkPending = true; choosePerk(m, "quarry");
  ok(buildCost(m, "archer") === 63, "Royal Quarry makes towers 10% cheaper (70 → 63)");
  m.perkOffer = ["masons"]; m.perkPending = true; choosePerk(m, "masons");
  ok(repairCost(m) === 45, "Guild Masons cut repair to 45");
  m.perkOffer = ["stoutWalls"]; m.perkPending = true; const before = m.castleMax; choosePerk(m, "stoutWalls");
  ok(m.castleMax === before + 4 && m.castleHp === before + 4, "Stout Walls adds castle health now and to the maximum");
  m.perkOffer = ["kingsPurse"]; m.perkPending = true; const g0 = m.gold; choosePerk(m, "kingsPurse");
  ok(m.gold === g0 + 200 && m.mods.bountyMul === 0.2, "The King's Purse pays 200 now and raises bounties");
  ok(!choosePerk(m, "longFletch"), "cannot choose without an offer");
  ok(PERKS.every((p) => PERK_BY_ID[p.id] && p.mods && p.rarity), "every perk is well formed");

  /* wave-gated castle powers */
  const pw = makeGame({ seed: 607, stageId: "stonebridge" }); startStage(pw);
  ok(!powerUnlocked(pw, "watchfire") && !castWatchfire(pw), "Watchfire is locked before wave 4");
  pw.wave = 4;
  ok(powerUnlocked(pw, "watchfire") && castWatchfire(pw) && pw.boostT > 0 && !castWatchfire(pw), "Watchfire fires once unlocked and then cools down");
  pw.wave = 7; buildTower(pw, 2, "barracks"); pw.units[0].hp = 10;
  ok(castRoyalRally(pw) && pw.units[0].hp > 10 && pw.rallyT > 0, "Royal Rally heals the squads");
  ok(POWERS.watchfire.unlockWave === 4 && POWERS.royalRally.unlockWave === 7, "power unlock waves are data");

  /* kingdom upgrades feed a new battle */
  const mods = metaMods({ treasury: 2, fletchers: 3, wallHealth: 1 });
  ok(mods.startGold === 80 && Math.abs(mods.archerDmg - 0.18) < 1e-9 && mods.castleBonus === 2, "metaMods sums bought levels");
  const k = makeGame({ seed: 609, stageId: "greenhollow", upgrades: { treasury: 2, wallHealth: 1 } });
  ok(k.gold === 330 && k.castleMax === 22 && k.castleHp === 22, "a new battle starts with the kingdom's gold and walls");
  ok(KINGDOM_UPGRADES.every((u) => u.cost.length === 3 && u.mods), "every kingdom upgrade has three priced levels");
  const snap = serializeGame(m);
  const back = restoreGame(snap);
  ok(back.perks.length === m.perks.length && back.mods.soldierHp === 0.15 && back.castleMax === m.castleMax, "perks and modifiers survive a save");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
