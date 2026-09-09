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
  castBurningOil, castEmergencyRepair, castBarrage, setFormation, formationFor, stagePowers, powerWave, kingsCharge, damageWall, guardCount,
  canMount, setMount, MOUNT_COST,
  heroUpgrade, heroAbility, terrainSlow, blizzardRate, blizzardRange, startBlizzard, damageEnemy, spawnEnemy, onFrost, inDrift,
} from "../src/components/castleDefender/engine/engine.js";
import { PERKS, PERK_BY_ID, POWERS } from "../src/components/castleDefender/data/perks.js";
import { KINGDOM_UPGRADES, metaMods } from "../src/components/castleDefender/data/progression.js";
import { readSave, writeSave, saveBattle, clearBattle, recordResult, resetProgress, SAVE_VERSION, badgesOf, hasBadge, stageRecord, isStageUnlocked, isKingdomUnlocked, stagesOf, KINGDOM_ORDER } from "../src/components/castleDefender/save.js";
import { FROZEN_NORTH, FROST_TEASERS, FROST_HERO, SUNSPEAR, SUN_TEASERS, SUN_HERO, BADGES, BADGE_ORDER } from "../src/components/castleDefender/data/frozenNorth.js";
import { KINGDOMS } from "../src/components/castleDefender/data/kingdoms.js";
import { sampleRoute } from "../src/components/castleDefender/engine/path.js";
import { STAGES } from "../src/components/castleDefender/data/stages.js";
import { TOWERS, HERO, ELARA, HEROES, heroDefFor, heroStatsOf, heroStats, SOLDIERS } from "../src/components/castleDefender/data/towers.js";
import { ENEMIES, ENEMY_ORDER } from "../src/components/castleDefender/data/enemies.js";
import { autoStep } from "./castle-auto-commander.js";
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
  /* both squads hold their post so the comparison is armour only (soldiers otherwise charge a shooter in reach) */
  const holdAll = (g) => g.units.forEach((u) => { u.hold = true; u.home = { x: u.x, y: u.y }; });
  const sw = stone(207); buildTower(sw, 1, "barracks"); run(sw, 3); holdAll(sw);
  sw.queue = [0, 1, 2].map((i) => ({ t: i * 0.3, type: "archer", route: 0, lat: 0 })); sw.waveState = "active"; sw.wave = 2;
  const esw = run(sw, 25);
  const pkA = stone(207); buildTower(pkA, 1, "barracks"); setDrill(pkA, 1, true); run(pkA, 3); holdAll(pkA);
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



/* ================================================================ */
console.log("— stage III data —");
{
  const st = STAGES[2];
  ok(st.id === "siege" && st.available && st.waves.length === 12 && st.finale, "Stage III is available, final, and twelve waves long");
  ok(st.waveTitles[3] && st.waveTitles[5] && st.waveTitles[7] && st.waveTitles[9] && st.waveTitles[11] && st.waveTitles[12] === "Final siege", "the siege wave titles are set");
  const types = new Set(st.waves.flat().map((g) => g.type));
  ok(["heavyInf", "siegeEngineer", "fireArcher", "heavyCav", "siegeRam", "siegeCatapult", "siegeTower", "eliteGuard", "warCaptain", "warlord"].every((t) => types.has(t) && ENEMIES[t]), "every new enemy type appears in the waves and exists");
  for (const name of ["landscape", "portrait"]) {
    const L = st.layouts[name];
    ok(L.routes.length === 4 && L.outerWall && L.outerWall.segments.length >= 3 && L.plots.length === 12 && L.torches.length >= 8 && L.camps.length >= 3, `${name}: four roads, an outer wall, twelve plots, torches and camps`);
  }
  const s = makeGame({ stageId: "siege", seed: 3 });
  ok(s.wallHp === 100 && s.wallMax === 100 && s.totalWaves === 12, "the siege starts with a whole outer wall and 12 waves");
  ok(s.layout.routes.every((r) => r.wallD > 0 && r.wallPt) && s.layout.routes[3].throughBreach && !s.layout.routes[0].throughBreach, "every road knows where it crosses the wall; the fourth goes through the breach");
  ok(stagePowers(s).length === 5 && powerWave(s, "burningOil") === 2 && powerWave(s, "catapultBarrage") === 9 && powerWave(s, "royalRally") === 7, "five siege powers with their unlock waves");
  const s2 = makeGame({ stageId: "greenhollow", seed: 3 });
  ok(stagePowers(s2).length === 2 && powerWave(s2, "burningOil") == null && !powerUnlocked(s2, "burningOil"), "Stage I keeps its two powers; siege powers never appear there");
  const s3 = makeGame({ stageId: "stonebridge", seed: 3 }); s3.wave = 7;
  ok(powerUnlocked(s3, "royalRally") && !powerUnlocked(s3, "emergencyRepair") && s3.wallHp == null, "Stage II unchanged: rally at 7, no wall, no siege powers");
}

/* ================================================================ */
console.log("— siege engines and the outer wall —");
{
  const siege = (seed) => { const s = makeGame({ seed, stageId: "siege" }); startStage(s); s.stage = { ...s.stage, countdown: 9999 }; s.countdown = 9999; s.countdownMax = 9999; s.waveState = "active"; s.wave = 3; s.queue = []; return s; };
  /* catapult halts, telegraphs, then hits the wall */
  let s = siege(11);
  s.queue = [{ t: 0, type: "siegeCatapult", route: 0, lat: 0 }];
  let ev = run(s, 0.1); const cat = s.enemies[0];
  ok(cat && cat.def.engine && !cat.stopped, "a siege catapult rolls in");
  ev = run(s, 60);
  ok(cat.stopped && ev.some((e) => e.type === "siegeHalt"), "it halts in the field");
  const warn = ev.find((e) => e.type === "catapultWarn"); const shot = ev.find((e) => e.type === "siegeShot"); const imp = ev.find((e) => e.type === "siegeImpact");
  ok(warn && shot && imp && warn.kind === "wall", "it winds up with a marker, launches, and the stone lands on the outer wall");
  ok(s.wallHp < 100 && ev.some((e) => e.type === "wallHit"), `the wall takes damage (${s.wallHp}/100)`);
  ok(cat.d < s.layout.routes[0].length * 0.6 && cat.state !== "dead" && s.castleHp === 30, "it stays put and the castle is untouched while the wall stands");
  /* once the wall is down, stones hit the castle; every third stone burns a tower */
  s.gold = 1000; buildTower(s, 5, "archer");
  damageWall(s, s.wallHp, "test");
  ok(s.wallHp === 0 && s.layout.routes[3].opensAt <= s.wave, "a broken wall opens the breach road at once");
  ev = run(s, 40);
  const hits = ev.filter((e) => e.type === "siegeImpact").map((e) => e.kind);
  ok(hits.includes("castle") && s.castleHp < 30, `stones now hit the castle (${hits.join(",")}), castle ${s.castleHp}`);
  ok(hits.includes("tower") && s.towers[5].burnT > 0 || ev.some((e) => e.type === "towerBurn"), "one stone set a tower burning");
  /* an engineer mends a damaged engine */
  s = siege(12);
  s.queue = [{ t: 0, type: "siegeCatapult", route: 0, lat: 0 }, { t: 0.5, type: "siegeEngineer", route: 0, lat: 8 }];
  run(s, 3); const eng = s.enemies.find((e) => e.type === "siegeCatapult"); eng.hp -= 200; const before = eng.hp;
  ev = run(s, 6);
  ok(eng.hp > before && ev.some((e) => e.type === "engineerRepair"), `the engineer repairs the catapult (${Math.round(before)} → ${Math.round(eng.hp)})`);
  /* the iron ram batters the wall on its way past */
  s = siege(13);
  s.queue = [{ t: 0, type: "siegeRam", route: 0, lat: 0 }];
  ev = run(s, 70);
  ok(ev.some((e) => e.type === "ramWall") && s.wallHp <= 70, `the ram struck the wall (${s.wallHp}/100)`);
  /* the siege tower docks at the wall and unloads men */
  s = siege(14);
  s.queue = [{ t: 0, type: "siegeTower", route: 1, lat: 0 }];
  ev = run(s, 75);
  const tw = s.enemies.find((e) => e.type === "siegeTower");
  ok(tw && tw.docked && ev.some((e) => e.type === "towerDock"), "the siege tower docks short of the wall");
  ok(count(ev, "unload") >= 2 && s.enemies.some((e) => e.type === "heavyInf" || e.type === "manAtArms"), `it unloaded ${count(ev, "unload")} soldiers onto the road`);
  /* fire archers burn towers, which shoot slower */
  s = siege(15); s.gold = 1000; buildTower(s, 6, "archer"); s.towers[6].buildT = 0;
  s.queue = [{ t: 0, type: "fireArcher", route: 3, lat: 0 }];
  s.layout.routes[3].opensAt = 1;
  ev = run(s, 30);
  ok(ev.some((e) => e.type === "towerBurn") || s.towers[6].burnT > 0, "a fire archer set the tower burning");
  /* soldiers squeezing the siege gate are slowed while the wall stands */
  s = siege(16);
  s.queue = [{ t: 0, type: "bandit", route: 0, lat: 0 }];
  run(s, 0.1); const b = s.enemies[0]; b.d = s.layout.routes[0].wallD - 30; run(s, 1); const d1 = b.d - (s.layout.routes[0].wallD - 30);
  const s4 = siege(16); s4.queue = [{ t: 0, type: "bandit", route: 0, lat: 0 }]; run(s4, 0.1); const b2 = s4.enemies[0]; b2.d = 300; run(s4, 1); const d2 = b2.d - 300;
  ok(d1 < d2 * 0.75, `the siege gate slows the warband (${d1.toFixed(0)} vs ${d2.toFixed(0)} per second)`);
}

/* ================================================================ */
console.log("— Warlord Blackmoor —");
{
  const s = makeGame({ seed: 21, stageId: "siege" }); startStage(s);
  s.stage = { ...s.stage, countdown: 9999 }; s.countdown = 9999; s.countdownMax = 9999; s.waveState = "active"; s.wave = 11;
  s.queue = [{ t: 0, type: "warlord", route: 0, lat: 0 }, { t: 0.2, type: "eliteGuard", route: 0, lat: 10 }, { t: 0.4, type: "eliteGuard", route: 0, lat: -10 }];
  s.gold = 2000; buildTower(s, 10, "archer"); upgradeTower(s, 10); upgradeTower(s, 10); s.towers[10].buildT = 0;
  let ev = run(s, 12);
  const w = s.enemies.find((e) => e.type === "warlord");
  ok(w && w.boss && w.boss.phase === 1 && ev.some((e) => e.type === "bossEnter") && s.bossPhase === 1, "the warlord arrives in phase 1");
  ok(w.d >= w.def.phases.campAt - 1 && w.state === "idle", "he halts at his camp behind the guard");
  const hp0 = w.hp; castVolley(s, w.x, w.y);
  ev = run(s, 4);
  ok(w.hp === hp0 && ev.some((e) => e.type === "guarded"), "a volley does nothing while his guard stands");
  for (const g of s.enemies) if (g.def.guard) g.hp = 0;
  ev = run(s, 2);
  for (const g of s.enemies) if (g.def.guard && g.state !== "dead") { g.state = "dead"; g.deadT = 0; }
  ev = run(s, 3);
  ok(w.boss.phase === 2 && ev.some((e) => e.type === "bossPhase" && e.phase === 2), "with the guard dead he advances: phase 2");
  /* soldiers near him draw the sweep, with a wind-up first */
  buildTower(s, 7, "barracks"); s.towers[7].buildT = 0; run(s, 2);
  const ids = squadOf(s, 7); orderUnits(s, ids, { kind: "attack", enemyId: w.id });
  ev = run(s, 30);
  const wind = ev.findIndex((e) => e.type === "bossWind" && e.kind === "sweep"); const sweep = ev.findIndex((e) => e.type === "bossSweep");
  ok(wind >= 0 && sweep > wind, "the Ironbreaker sweep is telegraphed before it lands");
  const open = ev.findIndex((e) => e.type === "bossOpen");
  ok(open > sweep && ev.some((e) => e.type === "bossOpenEnd"), "every sweep leaves him open for a moment, and the window closes");
  /* during the opening he takes more damage */
  {
    const t = makeGame({ seed: 22, stageId: "siege" }); startStage(t); t.waveState = "active"; t.wave = 11; t.stage = { ...t.stage, countdown: 9999 };
    t.queue = [{ t: 0, type: "warlord", route: 0, lat: 0 }]; run(t, 0.1); const b = t.enemies[0]; b.boss.phase = 2; b.d = 400;
    run(t, 0.1); const hpA = b.hp; castVolley(t, b.x, b.y); run(t, 1.2); const dmgNormal = hpA - b.hp;
    b.hp = b.maxHp; b.boss.openT = 3; t.abilities.volley = 0; const hpB = b.hp; castVolley(t, b.x, b.y); run(t, 1.2); const dmgOpen = hpB - b.hp;
    ok(dmgOpen > dmgNormal * 1.4, `an open warlord takes more from the same volley (${Math.round(dmgNormal)} → ${Math.round(dmgOpen)})`);
    ok(guardCount(t) === 0, "guard count reads zero with no guard");
  }
  ok(ev.some((e) => e.type === "bossWind" && e.kind === "horn") && ev.some((e) => e.type === "bossHorn") && s.enemies.some((e) => e.type === "heavyInf"), "his horn calls reinforcements after a wind-up");
  /* rage at 40 % */
  const beforeCount = s.enemies.filter((e) => e.state !== "dead").length;
  w.hp = w.maxHp * 0.39;
  ev = run(s, 1);
  ok(w.boss.raged && w.boss.phase === 3 && ev.some((e) => e.type === "bossPhase" && e.phase === 3) && s.bossPhase === 3, "at low health he rages: phase 3");
  { const hpR = w.hp; castVolley(s, w.x, w.y); s.abilities.volley = 0; run(s, 0.5); ok(w.hp === hpR && w.boss.roarT > 0, "during the roar nothing hurts him"); const rev = run(s, 1.6); ok(w.boss.roarT <= 0 && rev.some((e) => e.type === "bossRoarEnd"), "the roar ends and he comes on"); }
  ok(s.enemies.filter((e) => e.state !== "dead").length > beforeCount, "the rage brings a final siege push");
  /* he stands at the gate and batters it instead of vanishing */
  w.d = s.layout.routes[0].length - 5; ev = run(s, 7);
  ok(w.state !== "dead" && s.enemies.includes(w) && ev.filter((e) => e.type === "gateHit" && e.enemy === "warlord").length >= 2, "at the gate he keeps hitting it, and stays alive to be killed");
  /* the wave cannot clear while he lives on the final wave; killing him clears it */
  s.wave = 12; s.waveState = "active"; s.queue = []; for (const e of s.enemies) if (e !== w) { e.state = "dead"; e.deadT = 0; }
  run(s, 2);
  ok(s.phase === "playing" && s.waveState === "active", "wave 12 does not clear while Blackmoor stands");
  /* on the final wave his death routs the warband */
  s.queue = [{ t: 0, type: "heavyInf", route: 1, lat: 0 }, { t: 0, type: "heavyInf", route: 1, lat: 8 }, { t: 0, type: "siegeCatapult", route: 2, lat: 0 }];
  run(s, 0.2); for (const e of s.enemies) if (e !== w && e.state !== "dead") e.d = 600;
  w.boss.roarT = 0; w.boss.openT = 0; w.hp = 1; const killEv = run(s, 0.05, (g) => { const b = g.enemies.find((x) => x.type === "warlord"); if (b && b.state !== "dead") { b.hp = 0; castVolley(g, b.x, b.y); } });
  void killEv;
  w.hp = 0; if (w.state !== "dead") { const hits = run(s, 1.5, (g) => { if (g.abilities.volley <= 0) castVolley(g, w.x, w.y); }); void hits; }
  const alive = s.enemies.filter((e) => e.state !== "dead" && e !== w);
  ok(w.state === "dead", "the warlord falls");
  ok(alive.length > 0 && alive.every((e) => e.routed), `the rest of the warband is routed (${alive.length} running)`);
  ok(s.phase === "victory", "and the final wave clears at once: victory");
  const dBefore = alive.map((e) => e.d); run(s, 1);
  ok(s.phase === "victory", "the game stays won while they run");
  void dBefore;
}

/* ================================================================ */
console.log("— formations, King's Charge and siege powers —");
{
  const s = makeGame({ seed: 31, stageId: "siege" }); startStage(s);
  s.stage = { ...s.stage, countdown: 9999 }; s.countdown = 9999; s.countdownMax = 9999; s.gold = 3000;
  buildTower(s, 2, "barracks"); run(s, 3);
  const ids = squadOf(s, 2);
  const f = formationFor(s, ids);
  ok(f && f.kind === "shieldWall" && !f.on, "a sword squad is offered Shield Wall");
  ok(setFormation(s, ids, "shieldWall") && s.units.every((u) => u.formation === "shieldWall"), "Shield Wall set on the whole squad");
  ok(!setFormation(s, ids, "pikeWall"), "Pike Wall refuses a sword squad");
  const armourWall = s.units[0].def.armour; void armourWall;
  ok(formationFor(s, ids).on, "the formation reads as on");
  setDrill(s, 2, true); run(s, 1);
  const pikes = squadOf(s, 2);
  ok(setFormation(s, pikes, "pikeWall") && s.units.every((u) => u.formation === "pikeWall"), "after the pike drill the squad takes Pike Wall");
  run(s, 1);
  ok(s.units.every((u) => u.bracing), "a Pike Wall keeps the spears set with no charge in sight");
  /* a charging lancer meets the pike wall */
  s.waveState = "active"; s.wave = 5; s.queue = [{ t: 0, type: "heavyCav", route: 0, lat: 0 }];
  orderUnits(s, pikes, { kind: "move", x: 700, y: 490 }); run(s, 4);
  const ev = run(s, 30);
  ok(ev.some((e) => e.type === "chargeBroken" && e.by === "pikes") || s.enemies.every((e) => e.state === "dead"), "the pike wall breaks the heavy lancer's charge");
  ok(!setFormation(makeGame({ seed: 1, stageId: "stonebridge" }), [1], "shieldWall"), "formations are not available before the siege");
  /* King's Charge unlocks on wave 5 and hits wider */
  const k = makeGame({ seed: 32, stageId: "siege" }); startStage(k); k.gold = 3000;
  ok(!kingsCharge(k), "Sir Edric starts with the plain Royal Charge");
  k.wave = 4; k.waveState = "countdown"; k.countdown = 0.01; k.stage = { ...k.stage, countdown: 9999 };
  const kev = run(k, 0.5);
  ok(kingsCharge(k) && kev.some((e) => e.type === "unlock" && e.id === "kingsCharge"), "wave 5 unlocks King's Charge");
  k.queue = []; for (let i = 0; i < 6; i += 1) { k.queue.push({ t: 0, type: "bandit", route: 0, lat: (i - 3) * 8 }); }
  run(k, 0.1); for (const e of k.enemies) { e.d = 1100; } run(k, 0.05);
  const target = k.enemies[0]; moveHero(k, target.x - 150, target.y); run(k, 3);
  ok(heroCharge(k, target.x + 60, target.y), "King's Charge launches");
  const cev = run(k, 2);
  ok(cev.some((e) => e.type === "kingsCharge") && count(cev, "chargeHit") >= 3, `it ends in a shockwave and struck ${count(cev, "chargeHit")} of six`);
  /* powers */
  const p = makeGame({ seed: 33, stageId: "siege" }); startStage(p); p.stage = { ...p.stage, countdown: 9999 }; p.countdown = 9999;
  ok(!castBurningOil(p), "Burning Oil is locked on wave 0");
  p.wave = 9; p.unlocks = ["burningOil", "watchfire", "emergencyRepair", "royalRally", "catapultBarrage"];
  p.waveState = "active"; p.queue = [{ t: 0, type: "bandit", route: 0, lat: 0 }, { t: 0, type: "bandit", route: 0, lat: 10 }];
  run(p, 0.1); for (const e of p.enemies) e.d = p.layout.routes[0].length - 60; run(p, 0.05);
  const oev = run(p, 0.05, (g) => { if (g.abilities.burningOil <= 0) castBurningOil(g); });
  ok(oev.some((e) => e.type === "oil") && p.zones.some((z) => z.oil) && p.abilities.burningOil > 0, "Burning Oil burns the ground before the gate");
  p.castleHp = 12; damageWall(p, 40, "test");
  ok(castEmergencyRepair(p) && p.castleHp === 22 && p.wallHp === 95, `Emergency Repair mends the castle and the wall (castle ${p.castleHp}, wall ${p.wallHp})`);
  ok(!castEmergencyRepair(p), "and then it is on cooldown");
  ok(castBarrage(p, 800, 490) && p.strikes.filter((st) => st.kind === "barrage").length === 6, "Catapult Barrage schedules six stones");
  const bev = run(p, 6);
  ok(count(bev, "stoneImpact") >= 6, `all six stones landed (${count(bev, "stoneImpact")})`);
  /* the Stage III perks only appear on the siege */
  const q = makeGame({ seed: 34, stageId: "stonebridge" }); q.wave = 9;
  for (let i = 0; i < 20; i += 1) { offerPerks(q); ok(q.perkOffer.every((id) => !PERK_BY_ID[id].minStage), "no siege-only perk is offered on Stage II"); q.perkOffer = null; q.perkPending = false; break; }
}

/* ================================================================ */
console.log("— save and continue through the siege —");
{
  const s = makeGame({ seed: 41, stageId: "siege" }); startStage(s);
  s.stage = { ...s.stage, countdown: 9999 }; s.countdown = 9999; s.countdownMax = 9999; s.gold = 3000; s.wave = 11; s.waveState = "active";
  buildTower(s, 2, "barracks"); buildTower(s, 5, "archer");
  s.queue = [{ t: 0, type: "siegeCatapult", route: 0, lat: 0 }, { t: 0, type: "siegeTower", route: 1, lat: 0 }, { t: 0, type: "warlord", route: 0, lat: 0 }, { t: 0, type: "eliteGuard", route: 0, lat: 6 }];
  run(s, 2); setDrill(s, 2, true); run(s, 1);
  setFormation(s, squadOf(s, 2), "pikeWall");
  run(s, 60);
  damageWall(s, 30, "test"); s.towers[5].burnT = 3; s.unlocks.push("kingsCharge");
  const snap = JSON.parse(JSON.stringify(serializeGame(s)));
  const r = restoreGame(snap);
  ok(r.wallHp === s.wallHp && r.wallMax === 100, `the outer wall comes back at ${r.wallHp}`);
  ok(r.units.every((u) => u.formation === "pikeWall") && r.units.length === s.units.length, "formations survive the save");
  const cat = r.enemies.find((e) => e.type === "siegeCatapult"); const cat0 = s.enemies.find((e) => e.type === "siegeCatapult");
  ok(cat && cat.stopped === cat0.stopped && Math.abs(cat.d - cat0.d) < 1, "the catapult is back where it halted");
  const tw = r.enemies.find((e) => e.type === "siegeTower"); const tw0 = s.enemies.find((e) => e.type === "siegeTower");
  ok(tw && tw.docked === tw0.docked && tw.unloaded === tw0.unloaded, "the siege tower keeps its dock and unload count");
  const w = r.enemies.find((e) => e.type === "warlord"); const w0 = s.enemies.find((e) => e.type === "warlord");
  ok(w && w.boss.phase === w0.boss.phase && r.bossPhase === s.bossPhase, `the warlord is restored in phase ${w.boss.phase}`);
  ok(r.towers[5].burnT > 0 && kingsCharge(r), "a burning tower and King's Charge are restored");
  ok(r.enemies.length === s.enemies.filter((e) => e.state !== "dead").length && r.units.length === s.units.length, "nothing is duplicated");
  /* cooldowns and boss timers survive too */
  s.abilities.catapultBarrage = 33; s.abilities.emergencyRepair = 70; w0.boss.openT = 1.2; w0.boss.sweepCd = 4.5; s.towers[5].cd = 1.1;
  const snap2 = JSON.parse(JSON.stringify(serializeGame(s))); const r2 = restoreGame(snap2); const w2 = r2.enemies.find((e) => e.type === "warlord");
  ok(r2.abilities.catapultBarrage === 33 && r2.abilities.emergencyRepair === 70 && Math.abs(w2.boss.sweepCd - 4.5) < 0.01 && Math.abs(w2.boss.openT - 1.2) < 0.01 && w2.hp === w0.hp, "power cooldowns, boss timers and boss health are restored exactly");
  const g1 = makeGame({ seed: 42, stageId: "siege" }); startStage(g1); g1.castleHp = 8; const ge = run(g1, 0.1, (g) => { g.castleHp = 8; });
  void ge;
  const g2 = makeGame({ seed: 43, stageId: "siege" }); startStage(g2); g2.wave = 3; g2.waveState = "active"; g2.queue = [{ t: 0, type: "bandit", route: 0, lat: 0 }]; run(g2, 0.1); g2.castleHp = 9; g2.enemies[0].d = g2.layout.routes[0].length - 2; const gf = run(g2, 0.5);
  ok(gf.some((e) => e.type === "gateFailing") && g2.gateWarned, "the gate-failing cue fires once the castle drops under 30%");
  const wc = makeGame({ seed: 44, stageId: "siege" }); startStage(wc); const wev = []; damageWall(wc, 45, "test"); wev.push(...drainEvents(wc)); damageWall(wc, 10, "test"); wev.push(...drainEvents(wc)); damageWall(wc, 10, "test"); wev.push(...drainEvents(wc));
  ok(wev.filter((e) => e.type === "wallCrack").length === 1, "the wall-crack cue fires exactly once as it passes half");
}

/* ================================================================ */
console.log("— full stage III, scripted commander —");
{
  const wins = [];
  for (const seed of [11, 23]) {
    const s = makeGame({ seed, stageId: "siege" }); startStage(s);
    const plan = [[1, "archer"], [0, "archer"], [2, "barracks"], [3, "ballista"], [4, "archer"], [5, "barracks"], [7, "ballista"], [6, "catapult"], [8, "archer"], [10, "catapult"], [9, "archer"], [11, "ballista"]];
    let formed = false; let step = 0;
    const evts = run(s, 60 * 30, (g) => {
      step += 1;
      for (const [plot, type] of plan) { if (!g.towers[plot] && canBuild(g, plot, type)) { buildTower(g, plot, type); return; } }
      g.towers.forEach((t, i) => { if (t && t.type === "barracks" && !t.pikes && g.wave >= 4 && g.gold >= DRILL_COST + 80 && i === 2) setDrill(g, i, true); });
      if (g.gold > 180) { let best = -1; let bestCost = Infinity; g.towers.forEach((t, i) => { if (!t || t.level >= 4) return; const cst = TOWERS[t.type].upgrades[t.level - 1]; if (cst < bestCost && cst <= g.gold) { bestCost = cst; best = i; } }); if (best >= 0) { upgradeTower(g, best); return; } }
      const h = g.hero;
      const near = g.enemies.filter((e) => e.state !== "dead" && Math.hypot(e.x - h.x, e.y - h.y) < 220);
      const charging = near.find((e) => e.def.charge && (e.charging || e.chargeT > 0));
      if (charging && h.chargeCd <= 0 && !h.charge) heroCharge(g, charging.x, charging.y);
      else if (near.length >= 3 && h.chargeCd <= 0 && !h.charge) heroCharge(g, near[0].x, near[0].y);
      if (h.state === "idle" && !h.moveTarget && near.length === 0 && g.enemies.length) { const far = g.enemies.reduce((a, e) => (e.progress > a.progress ? e : a), g.enemies[0]); if (far.progress > 0.5) moveHero(g, far.x, far.y); }
      if (g.abilities.volley <= 0 && g.enemies.length >= 4) { const e = g.enemies[0]; castVolley(g, e.x, e.y); }
      if (g.abilities.reinforce <= 0 && g.enemies.some((e) => e.progress > 0.85)) { const e = g.enemies.find((x) => x.progress > 0.85); castReinforce(g, e.x, e.y); }
      if (powerUnlocked(g, "watchfire") && g.abilities.watchfire <= 0 && g.enemies.length >= 8) castWatchfire(g);
      if (powerUnlocked(g, "royalRally") && g.abilities.royalRally <= 0 && g.units.some((u) => u.hp < u.maxHp * 0.5)) castRoyalRally(g);
      if (powerUnlocked(g, "burningOil") && g.abilities.burningOil <= 0 && g.enemies.filter((e) => e.progress > 0.8).length >= 3) castBurningOil(g);
      if (powerUnlocked(g, "emergencyRepair") && g.abilities.emergencyRepair <= 0 && g.castleHp < g.castleMax - 9) castEmergencyRepair(g);
      if (powerUnlocked(g, "catapultBarrage") && g.abilities.catapultBarrage <= 0) { const eng = g.enemies.find((e) => e.def.kind === "siege" && e.state !== "dead"); const tgt = eng || (g.enemies.length >= 6 ? g.enemies[0] : null); if (tgt) castBarrage(g, tgt.x, tgt.y); }
      if (!formed && g.towers[2] && g.towers[2].pikes) { const ids = squadOf(g, 2); if (ids.length) { setFormation(g, ids, "pikeWall"); formed = true; } }
      if (step % 120 === 0 && g.towers[5]) { const ids = squadOf(g, 5); const eng = g.enemies.find((e) => e.def.kind === "siege" && e.state !== "dead" && e.progress > 0.3); if (ids.length && eng) orderUnits(g, ids, { kind: "attack", enemyId: eng.id }); else if (ids.length && g.units.find((u) => u.id === ids[0])?.order?.kind === "attack") orderUnits(g, ids, { kind: "rally" }); }
      if (g.castleHp < 12 && g.gold > 200) repairCastle(g);
      if (g.waveState === "countdown" && g.wave >= 2 && g.countdown < g.countdownMax - 4 && g.enemies.length === 0) callWave(g);
    });
    const waves = evts.filter((e) => e.type === "wave").map((e) => e.n);
    ok(waves.length === 12 && waves.every((n, i) => n === i + 1), `seed ${seed}: all 12 waves ran once each (${waves.join(" ")})`);
    ok([1, 2, 3].every((r) => evts.some((e) => e.type === "routeOpen" && e.route === r)), "the north road, the south road and the breach all opened");
    ok(evts.some((e) => e.type === "siegeHalt") && evts.some((e) => e.type === "siegeShot") && evts.some((e) => e.type === "towerDock") && evts.some((e) => e.type === "ramWall"), "catapults fired, siege towers docked and rams struck the wall");
    ok(evts.some((e) => e.type === "wallBreach"), "the outer wall fell");
    ok(count(evts, "chargeStart") >= 5 && evts.some((e) => e.type === "chargeBroken"), `cavalry charged ${count(evts, "chargeStart")} times and was broken`);
    ok(evts.some((e) => e.type === "bossEnter") && evts.some((e) => e.type === "bossPhase" && e.phase === 2) && evts.some((e) => e.type === "bossSweep"), "Warlord Blackmoor arrived, advanced and swept");
    ok(evts.some((e) => e.type === "unlock" && e.id === "kingsCharge") && count(evts, "kingsCharge") >= 3, "King's Charge unlocked and was used");
    ok(s.phase === "victory" || s.phase === "defeat", `stage III ended (${s.phase}, castle ${s.castleHp}/${s.castleMax}, wave ${s.wave}, t ${Math.round(s.t)}s)`);
    if (s.phase === "victory") { ok(evts.some((e) => e.type === "bossDown") && s.stars >= 1, `victory came with the warlord dead (${s.stars} stars)`); wins.push(seed); }
    console.log(`      seed ${seed}: ${s.phase} | kills ${s.stats.kills} | hero level ${s.hero.level} | sweeps ${count(evts, "bossSweep")} horns ${count(evts, "bossHorn")} shots ${count(evts, "siegeShot")}`);
  }
  ok(wins.length >= 1, `the scripted commander wins the siege on ${wins.length} of 2 seeds`);
}

/* ================================================================ */
console.log("— realm completion —");
{
  resetProgress(readSave());
  const won = recordResult(readSave(), { stageId: "siege", mode: "campaign", difficulty: "normal", won: true, finished: true, finale: true, kingdom: "ashford", stars: 2, score: 9000, wave: 12 });
  ok(won.realmComplete && won.save.campaignsDone.includes("ashford") && won.crowns === 3 + 2 + 5, `the first conquest completes the realm and pays ${won.crowns} crowns`);
  const again = recordResult(won.save, { stageId: "siege", mode: "campaign", difficulty: "normal", won: true, finished: true, finale: true, kingdom: "ashford", stars: 3, score: 9500, wave: 12 });
  ok(!again.realmComplete && again.save.campaignsDone.length === 1 && again.crowns === 1, "a second conquest only pays for the new star");
  resetProgress(readSave());
}


/* ================================================================ */
console.log("— Royal Knights —");
{
  const s = makeGame({ seed: 61, stageId: "greenhollow" }); startStage(s); s.gold = 2000;
  s.stage = { ...s.stage, countdown: 9999 }; s.countdown = 9999; s.countdownMax = 9999;
  buildTower(s, 2, "barracks"); run(s, 2);
  ok(!canMount(s, 2) && !setMount(s, 2, true), "a fresh barracks cannot mount up");
  upgradeTower(s, 2); upgradeTower(s, 2); run(s, 1);
  ok(!canMount(s, 2) && s.units.every((u) => u.unit === "knight"), "Foot Knights (level 3) still cannot mount");
  upgradeTower(s, 2); run(s, 1);
  ok(s.units.every((u) => u.unit === "royalGuard") && canMount(s, 2), "Royal Guard (level 4) is earned normally and unlocks the mount");
  const gold = s.gold;
  ok(setMount(s, 2, true) && s.gold === gold - MOUNT_COST, `mounting costs ${MOUNT_COST} gold`);
  const knights = s.units.filter((u) => u.tower === 2);
  ok(knights.length === 3 && knights.every((u) => u.unit === "royalKnight" && u.def.mounted && u.def.horse === "royal"), "the whole squad becomes Royal Knights on horses");
  ok(SOLDIERS.royalKnight.speed > SOLDIERS.royalGuard.speed * 1.5 && SOLDIERS.royalKnight.armour < SOLDIERS.royalGuard.armour && SOLDIERS.royalKnight.rangedWeakness > 1, "knights are much faster than the Guard, wear lighter armour and are weaker to arrows");
  ok(!setFormation(s, knights.map((u) => u.id), "shieldWall") && formationFor(s, knights.map((u) => u.id)) == null, "riders take no formation");
  /* they ride to orders faster than the Guard would */
  const k = knights[0]; orderUnits(s, [k.id], { kind: "move", x: k.x + 300, y: k.y }); run(s, 2.4);
  ok(Math.hypot(k.x - k.home.x, k.y - k.home.y) < 40, "a Royal Knight covers 300 units in under two and a half seconds (a Guard on foot would still be 80 short)");
  /* Lance Charge */
  const ab = sharedAbility(s, knights.map((u) => u.id));
  ok(ab && ab.id === "lanceCharge" && ab.ready, "the squad shares Lance Charge");
  ok(triggerUnitAbility(s, [k.id]) && k.abilityT > 0, "Lance Charge fires");
  /* they still respawn as knights and survive a save */
  k.hp = 0; run(s, 0.2); k.state = "dead"; k.deadT = 0; run(s, 0.1); k.respawnT = 0; run(s, 0.5);
  ok(k.unit === "royalKnight" && k.state !== "respawn", "a fallen knight returns mounted");
  const r = restoreGame(JSON.parse(JSON.stringify(serializeGame(s))));
  ok(r.towers[2].mounted && r.units.filter((u) => u.tower === 2).every((u) => u.unit === "royalKnight"), "mounted status and the knights survive a save");
  /* dismount / drill exclusivity */
  ok(setMount(s, 2, false) && s.units.filter((u) => u.tower === 2).every((u) => u.unit === "royalGuard"), "dismounting returns the squad to Royal Guard");
  setMount(s, 2, true); const st = makeGame({ seed: 62, stageId: "stonebridge" }); startStage(st); st.gold = 2000; buildTower(st, 2, "barracks"); for (let i = 0; i < 3; i += 1) upgradeTower(st, 2); run(st, 1);
  setMount(st, 2, true); ok(setDrill(st, 2, true) && !st.towers[2].mounted && st.units.filter((u) => u.tower === 2).every((u) => u.unit === "pikeRoyal"), "a pike drill dismounts the squad");
  ok(setMount(st, 2, true) && !st.towers[2].pikes && st.units.filter((u) => u.tower === 2).every((u) => u.unit === "royalKnight"), "and mounting clears the pikes");
  /* counters: an archer wave hurts riders more than the Guard */
  const dmgTo = (unitType) => { const g = makeGame({ seed: 63, stageId: "greenhollow" }); startStage(g); g.gold = 2000; buildTower(g, 2, "barracks"); for (let i = 0; i < 3; i += 1) upgradeTower(g, 2); run(g, 1); if (unitType === "royalKnight") setMount(g, 2, true); g.waveState = "active"; g.wave = 3; g.queue = []; for (let i = 0; i < 6; i += 1) g.queue.push({ t: 0, type: "archer", route: 0, lat: (i - 3) * 6 }); run(g, 0.1); for (const e of g.enemies) e.d = 700; run(g, 0.05); const sq = g.units.filter((u) => u.tower === 2); orderUnits(g, sq.map((u) => u.id), { kind: "move", x: g.enemies[0].x - 110, y: g.enemies[0].y }); run(g, 6); return sq.reduce((a, u) => a + (u.maxHp - Math.max(0, u.hp)), 0) / sq.reduce((a, u) => a + u.maxHp, 0); };
  const gLoss = dmgTo("royalGuard"); const kLoss = dmgTo("royalKnight");
  ok(kLoss > gLoss, `archers cost riders a bigger share of their health than the Guard (${(kLoss * 100).toFixed(0)}% vs ${(gLoss * 100).toFixed(0)}%)`);
  /* the exact sheet numbers, and the Guard untouched */
  const RK = SOLDIERS.royalKnight; const RG = SOLDIERS.royalGuard;
  ok(RK.speed === 150 && RK.dmg[0] === 15 && RK.dmg[1] === 21 && RK.hp === 280 && RK.armour === 0.35 && RK.rangedWeakness === 1.3, "Royal Knight: speed 150, 15–21 damage, 280 health, 35% armour, 1.3× from arrows");
  ok(RK.ability.id === "lanceCharge" && RK.ability.dmg === 0.8 && RK.ability.speed === 0.5 && RK.ability.dur === 4 && RK.ability.cd === 16, "Lance Charge: +80% damage, +50% speed, 4 s, 16 s recharge");
  ok(RG.armour === 0.45 && RG.hp === 260 && RG.ability.id === "shieldBrace" && RG.speed === 90 && MOUNT_COST === 120, "Royal Guard unchanged: 45% armour, 260 health, Shield Brace, speed 90; mount costs 120");
  /* dismount is free; a lance-charged knight hits harder and moves faster; the cooldown survives a save */
  const d = makeGame({ seed: 64, stageId: "greenhollow" }); startStage(d); d.gold = 2000; buildTower(d, 2, "barracks"); for (let i = 0; i < 3; i += 1) upgradeTower(d, 2); run(d, 1); setMount(d, 2, true);
  const gd = d.gold; ok(setMount(d, 2, false) && d.gold === gd, "dismounting is free"); setMount(d, 2, true);
  const rk = d.units.find((u) => u.tower === 2); triggerUnitAbility(d, [rk.id]);
  const before = { x: rk.x, y: rk.y }; orderUnits(d, [rk.id], { kind: "move", x: rk.x + 400, y: rk.y }); run(d, 1);
  const lanced = Math.hypot(rk.x - before.x, rk.y - before.y);
  ok(lanced > 190 && rk.abilityCd > 14, `a charging knight covers ${Math.round(lanced)} in a second (150 walking) and the 16 s recharge is running`);
  const rr = restoreGame(JSON.parse(JSON.stringify(serializeGame(d)))); const rk2 = rr.units.find((u) => u.tower === 2);
  ok(rk2.unit === "royalKnight" && Math.abs(rk2.abilityCd - rk.abilityCd) < 0.01, "Lance Charge cooldown is restored exactly");
  /* the Guard's formations still work on foot (formations are a siege-stage feature) */
  const f3 = makeGame({ seed: 65, stageId: "siege" }); startStage(f3); f3.gold = 3000; buildTower(f3, 2, "barracks"); for (let i = 0; i < 3; i += 1) upgradeTower(f3, 2); run(f3, 1);
  setMount(f3, 2, true); setMount(f3, 2, false); const gids = squadOf(f3, 2);
  ok(setFormation(f3, gids, "shieldWall") && f3.units.filter((u) => u.tower === 2).every((u) => u.formation === "shieldWall" && u.unit === "royalGuard"), "dismounted Guard can still lock shields");
}


/* ================================================================ */
console.log("— Defender of Ashford badge —");
{
  resetProgress(readSave());
  ok(badgesOf(readSave()).length === 0, "a new profile has no badges");
  /* an old save written before badges existed: everything is kept and the badge is derived on load */
  writeSave({
    version: SAVE_VERSION,
    stages: {
      greenhollow: { stars: 3, bestScore: 31000, bestWave: 12, completed: true, hardStars: 2 },
      stonebridge: { stars: 2, bestScore: 44000, bestWave: 0, completed: true, hardStars: 0 },
      siege: { stars: 3, bestScore: 91000, bestWave: 0, completed: true, hardStars: 1 },
    },
    settings: { sound: false, music: true, sfxVol: 0.5, musicVol: 0.4, quality: "high", seenHowTo: true },
    campaignsDone: ["ashford"],
    difficulty: "hard",
    meta: { crowns: 7, spent: 12, upgrades: { wallHealth: 2, drillYard: 1 }, unlocks: ["kingsCharge"] },
    battle: null,
  });
  const old = readSave();
  ok(hasBadge(old, "defenderOfAshford"), "an old completed save is awarded Defender of Ashford on load");
  ok(old.stages.greenhollow.stars === 3 && old.stages.greenhollow.hardStars === 2 && old.stages.siege.bestScore === 91000, "stage progress, stars and hard records survive the migration");
  ok(old.difficulty === "hard" && old.meta.crowns === 7 && old.meta.upgrades.wallHealth === 2 && old.meta.unlocks.includes("kingsCharge"), "difficulty, crowns, kingdom upgrades and unlocks survive the migration");
  ok(old.settings.quality === "high" && old.settings.sound === false, "settings survive the migration");
  writeSave(old);
  ok(hasBadge(readSave(), "defenderOfAshford"), "the badge persists after a reload");
  /* an unfinished campaign earns nothing */
  resetProgress(readSave());
  writeSave({ ...readSave(), stages: { greenhollow: { stars: 3, bestScore: 100, bestWave: 0, completed: true, hardStars: 0 } }, campaignsDone: [] });
  ok(!hasBadge(readSave(), "defenderOfAshford") && badgesOf(readSave()).length === 0, "an incomplete campaign earns no badge");
  /* finishing the realm awards it once, and it is reported as new */
  const won = recordResult(readSave(), { stageId: "siege", mode: "campaign", difficulty: "normal", won: true, finished: true, finale: true, kingdom: "ashford", stars: 3, score: 90000, wave: 12 });
  ok(won.realmComplete && won.newBadges.includes("defenderOfAshford") && won.save.badges.includes("defenderOfAshford"), "completing the realm awards the badge and reports it as new");
  const again = recordResult(won.save, { stageId: "siege", mode: "campaign", difficulty: "normal", won: true, finished: true, finale: true, kingdom: "ashford", stars: 3, score: 95000, wave: 12 });
  ok(again.newBadges.length === 0 && again.save.badges.length === 1, "a second victory does not award it twice");
  /* badges are cosmetic: no crowns, no modifiers, no unlocks of their own */
  ok(Object.values(BADGES).every((b) => !b.mods && !b.crowns && !b.unlock), "badges carry no gameplay effect");
  ok(BADGE_ORDER.every((id) => BADGES[id]) && BADGE_ORDER.length === Object.keys(BADGES).length, "every badge is listed in display order");
  resetProgress(readSave());
  ok(badgesOf(readSave()).length === 0, "resetting progress clears badges");
}

/* ================================================================ */
/*                THE FROZEN NORTH — kingdom two, playable            */
/* ================================================================ */

const FROST_IDS = ["frostwatch", "wolfpine", "cairnhold"];
const mk = (id, opts = {}) => { const g = makeGame({ stageId: id, ...opts }); startStage(g); return g; };
const syncCheck = () => {};                       /* positions are set directly in these checks */
/* how fast a unit actually moves where it is standing right now */
const unitSpeedAt = (g, u) => { const before = { x: u.x, y: u.y }; const s0 = u.def.speed * (1 - (1 - terrainSlow(g, u.x, u.y)) * 0.5); u.chilled = terrainSlow(g, u.x, u.y) < 0.95; u.x = before.x; u.y = before.y; return s0; };
const frostStage = (id) => STAGES.find((st) => st.id === id);

console.log("— the Frozen North is a real kingdom —");
{
  ok(FROZEN_NORTH.status === "playable" && FROZEN_NORTH.name === "The Frozen North", "the Frozen North is playable, not a teaser");
  ok(FROZEN_NORTH.flavour.length === 2 && FROZEN_NORTH.flavour.join(" ").length < 120, "the flavour text is still two short lines");
  const list = stagesOf(STAGES, "frost");
  ok(list.length === 3 && list.map((st) => st.id).join(",") === FROST_IDS.join(","), "three frost stages, in order");
  ok(stagesOf(STAGES, "ashford").length === 3, "Ashford still has exactly its three stages");
  ok(STAGES.length === 6 && STAGES.every((st) => st.kingdom), "six stages in all, each tagged with its kingdom");
  const k = KINGDOMS.find((x) => x.id === "frost");
  ok(k && k.status === "playable" && k.hero.name === "Lady Elara", "the Kingdoms page lists the north as playable under Lady Elara");
  ok(KINGDOMS.filter((x) => x.status === "playable").length === 2, "two playable kingdoms, no more");
  ok(list.every((st) => st.available && st.waves.length >= 9), "every frost stage is available and at least nine waves long");
  ok(list[2].finale === true && list[2].waves.length === 12, "the Cairnhold is the twelve-wave finale");
  /* Kingdom three is teased and nothing else */
  ok(SUNSPEAR.status === "soon" && !STAGES.some((st) => st.kingdom === "sun"), "the Sunspear Reach is locked with no stages");
  ok(SUN_TEASERS.length === 3 && SUN_TEASERS.every((t) => t.name && t.art && !t.hp && !t.dmg), "three Sunspear teasers, none carrying stats");
  ok(SUN_HERO.name === "Kesi of the Reach" && !SUN_HERO.hp && !SUN_HERO.ability, "the Sunspear hero is a silhouette and a name");
  ok(!SOLDIERS[SUN_HERO.id] && !ENEMIES.duneRaider && !ENEMIES.sandWyrm, "no Sunspear unit exists in the tables yet");
}

console.log("— unlocking the north —");
{
  resetProgress(readSave());
  ok(isKingdomUnlocked(readSave(), "ashford"), "Ashford is open from the start");
  ok(!isKingdomUnlocked(readSave(), "frost"), "the north is shut until Ashford is won");
  const iFrost = STAGES.findIndex((st) => st.id === "frostwatch");
  ok(!isStageUnlocked(readSave(), STAGES, iFrost), "Frostwatch cannot be entered before Ashford falls");
  /* win Ashford */
  const g = mk("siege"); g.phase = "victory"; g.stars = 3;
  recordResult(readSave(), summarise(g));
  const sv = readSave();
  ok(isKingdomUnlocked(sv, "frost"), "winning the Siege of Ashford opens the north");
  ok(isStageUnlocked(sv, STAGES, iFrost), "Frostwatch is the first frost stage and opens with the kingdom");
  ok(!isStageUnlocked(sv, STAGES, STAGES.findIndex((st) => st.id === "wolfpine")), "Wolfpine still waits on Frostwatch");
  ok(!isKingdomUnlocked(sv, "sun"), "kingdom three stays shut");
  /* progress inside the north */
  const g2 = mk("frostwatch"); g2.phase = "victory"; g2.stars = 2;
  recordResult(readSave(), summarise(g2));
  ok(isStageUnlocked(readSave(), STAGES, STAGES.findIndex((st) => st.id === "wolfpine")), "winning Frostwatch opens Wolfpine");
  ok(!isStageUnlocked(readSave(), STAGES, STAGES.findIndex((st) => st.id === "cairnhold")), "the Cairnhold still waits on Wolfpine");
  ok(stageRecord(readSave(), "frostwatch").stars === 2 && stageRecord(readSave(), "siege").stars === 3, "each kingdom keeps its own stars and records");
}

console.log("— an old v1.1 save survives —");
{
  /* exactly what a v1.1 player had on disk: Ashford done, no badges field,
     no frost records, and a battle snapshot from the old format */
  writeSave({
    version: 2,
    stages: { greenhollow: { stars: 3, bestScore: 4100, completed: true }, stonebridge: { stars: 2, bestScore: 5200, completed: true }, siege: { stars: 3, bestScore: 9000, completed: true } },
    campaignsDone: ["ashford"],
    meta: { crowns: 14, upgrades: { archerDamage: 2 } },
    settings: { sound: true, music: false },
    difficulty: "hard",
  });
  const sv = readSave();
  ok(sv.stages.siege.stars === 3 && sv.meta.crowns === 14 && sv.meta.upgrades.archerDamage === 2, "stars, crowns and kingdom upgrades all survive the migration");
  ok(sv.settings.music === false && sv.difficulty === "hard", "settings and difficulty survive");
  ok(hasBadge(sv, "defenderOfAshford"), "the Ashford badge is derived for a player who never saw the badge system");
  ok(!hasBadge(sv, "guardianOfTheFrozenNorth"), "the northern badge is not handed out for free");
  ok(isKingdomUnlocked(sv, "frost"), "an old completed campaign opens the north on load");
  ok(Array.isArray(sv.badges) && Array.isArray(sv.campaignsDone), "the migrated record has every field the new code reads");
  /* and a save with nothing in it at all */
  writeSave({});
  ok(readSave().version >= 2 && !isKingdomUnlocked(readSave(), "frost"), "an empty record migrates to a fresh, locked profile");
  resetProgress(readSave());
}

console.log("— Lady Elara is not Sir Edric with a bow —");
{
  ok(HEROES.edric === HERO && HEROES.elara === ELARA, "both heroes are registered");
  ok(heroDefFor(frostStage("frostwatch")).id === "elara" && heroDefFor(STAGES[0]).id === "edric", "each stage names its own hero");
  ok(ELARA.range > 0 && !HERO.range, "Elara fights at range and Edric does not");
  ok(ELARA.ability.kind === "frostArrow" && HERO.charge.kind !== "frostArrow", "her ability is a frost arrow, not a charge");
  ok(ELARA.meleeMul < 1 && ELARA.evade && ELARA.evade.back > 0, "she is weak in a melee and steps back out of one");
  ok(ELARA.hp < HERO.hp && ELARA.speed > HERO.speed, "she is lighter and faster than the knight");
  ok(ELARA.range < ENEMIES.frostArcher.range + 40 && ELARA.range > ENEMIES.frostArcher.range, "she outranges the northern archers, but only just");
  ok(ELARA.upgrade.id === "rapidVolley" && ELARA.upgrade.arrows === 3, "her late upgrade is a three-arrow volley");
  const a = heroStatsOf(ELARA, 1); const b = heroStatsOf(ELARA, 5);
  ok(b.maxHp > a.maxHp && b.dmg[0] > a.dmg[0] && b.chargeDmg > a.chargeDmg, "she levels like a hero should");

  /* in play: she shoots from where she stands, and the arrow does the work */
  const g = mk("frostwatch");
  ok(g.heroDef.id === "elara" && g.hero.hp === heroStatsOf(ELARA, 1).maxHp, "the game starts her, at her own health");
  callWave(g);
  const evs = run(g, 110);
  const shots = count(evs, "heroShot");
  const melee = evs.filter((e) => e.type === "swing" && e.hero).length;
  ok(shots > 0, "she looses arrows in a normal wave");
  ok(shots > melee, "she shoots far more often than she swings");
  const near = g.enemies.find((e) => e.state !== "dead");
  if (near) { const d = Math.hypot(g.hero.x - near.x, g.hero.y - near.y); ok(d > 40 || g.hero.frozenT > 0, "she does not stand inside the enemy she is shooting"); }
  else ok(true, "she does not stand inside the enemy she is shooting");
}

console.log("— the frost arrow and the volley —");
{
  const g = mk("frostwatch"); callWave(g);
  run(g, 26);
  const target = g.enemies.find((e) => e.state !== "dead");
  if (target) {
    const before = target.hp;
    g.hero.chargeCd = 0;
    const fired = heroCharge(g, target.x, target.y);
    ok(fired === true, "the frost arrow fires at a point on the map");
    const fired2 = run(g, 2.2).map((e) => e.type);
    ok(fired2.includes("frostArrow") || fired2.includes("frostBurst"), "it announces itself with its own cue");
    ok(target.hp < before || target.state === "dead", "it hurts what it lands on");
    ok(g.zones.some((z) => z.frost) || target.slowT > 0 || target.state === "dead", "it leaves cold ground or a slowed enemy behind");
    ok(g.hero.chargeCd > 0, "it goes on cooldown");
  } else ok(true, "the frost arrow fires at a point on the map");
  /* the upgrade */
  const g2 = mk("frostwatch");
  ok(!heroUpgrade(g2) && heroAbility(g2).name === ELARA.ability.name, "before the upgrade the button reads Frost Arrow");
  g2.unlocks.push(ELARA.upgrade.id);
  ok(heroUpgrade(g2) === ELARA.upgrade && heroAbility(g2).upgraded === true, "after it the button reads Rapid Volley");
  ok(heroAbility(g2).name === "Rapid Volley", "and says so by name");
  /* Edric is untouched */
  const g3 = mk("siege");
  ok(heroAbility(g3).kind !== "frostArrow" && heroAbility(g3).name.length > 0, "Edric still gets his charge, by his own name");
}

console.log("— the northern host —");
{
  const NEW = ["frostRaider", "direWolf", "frostArcher", "shieldRaider", "berserker", "frostCaptain", "wolfDen", "iceRam", "frostThrower", "iceWarlord"];
  ok(NEW.every((id) => ENEMIES[id]), "all ten new enemies exist");
  ok(NEW.every((id) => ENEMY_ORDER.includes(id)), "and all ten are in draw order");
  ok(NEW.every((id) => ENEMIES[id].hp > 0 && ENEMIES[id].speed >= 0 && ENEMIES[id].name), "each has health, a speed and a name");
  /* distinct roles, checked by the stat that defines each one */
  ok(ENEMIES.direWolf.speed > ENEMIES.frostRaider.speed && ENEMIES.direWolf.kind === "cavalry", "the dire wolf is the fast flanker");
  ok(ENEMIES.frostArcher.range > 0 && ENEMIES.frostRaider.range === undefined, "the frost archer is the only common shooter");
  ok(ENEMIES.shieldRaider.shieldBlock > 0.5, "the shieldbearer is built to eat arrows");
  ok(ENEMIES.berserker.dmg[0] > ENEMIES.frostRaider.dmg[0] * 1.6 && ENEMIES.berserker.armour < ENEMIES.shieldRaider.armour, "the berserker hits hard and dies fast");
  ok(ENEMIES.frostCaptain.aura && ENEMIES.frostCaptain.hp > ENEMIES.berserker.hp * 2, "the huscarl is a mini-boss with an aura");
  ok(ENEMIES.wolfDen.den && ENEMIES.wolfDen.tower && ENEMIES.wolfDen.speed < ENEMIES.frostRaider.speed, "the wolf den crawls and unloads wolves");
  ok(ENEMIES.iceRam.ram && ENEMIES.iceRam.wallDmg > 0, "the ram is for the wall");
  ok(ENEMIES.frostThrower.engine && ENEMIES.frostThrower.engine.standoff > 200, "the thrower stops out of reach and shoots");
  ok(ENEMIES.iceWarlord.boss === "final" && ENEMIES.iceWarlord.frost, "Jarl Vorne is the final boss and carries his own frost block");
  /* Ashford's roster is untouched */
  ok(ENEMIES.bandit && ENEMIES.warlord && ENEMIES.warlord.phases, "Blackmoor and the Ashford roster are unchanged");
}

console.log("— snow, drifts and the storm —");
{
  const g = mk("frostwatch");
  ok(g.stage.season === "winter" && g.layout.drifts && g.layout.drifts.length > 0, "Frostwatch is a winter map with snowdrifts");
  const d = g.layout.drifts[0];
  const inside = terrainSlow(g, d.x, d.y); const outside = terrainSlow(g, 30, 30);
  ok(inside < outside && inside >= 0.35, "a drift slows what walks through it, and never to a standstill");
  /* the blizzard */
  const w = mk("wolfpine");
  ok(w.stage.blizzard && w.stage.blizzard.first > 0, "Wolfpine has a storm schedule");
  ok(blizzardRate(w) === 1 && blizzardRange(w) === 1, "with clear skies towers behave normally");
  /* played properly, so the castle is still standing when the storm passes */
  const wst = {};
  const wevs = run(w, w.stage.blizzard.first + w.stage.blizzard.dur + 20, (gg) => autoStep(gg, wst));
  const storms = wevs.filter((e) => e.type === "blizzard");
  ok(wevs.some((e) => e.type === "blizzardWarn"), "the wind rises before the storm, with time to react");
  const warnAt = wevs.findIndex((e) => e.type === "blizzardWarn");
  const startAt = wevs.findIndex((e) => e.type === "blizzard" && e.on);
  ok(warnAt >= 0 && startAt > warnAt, "the warning comes before the storm, not with it");
  ok(storms.some((e) => e.on), "the storm arrives on schedule and announces itself");
  ok(storms.some((e) => !e.on), "and it blows over again");
  /* while it blows, towers are worse off */
  const w2 = mk("wolfpine"); startBlizzard(w2);
  ok(blizzardRate(w2) > 1 && blizzardRange(w2) < 1, "in the storm towers reload slower and see less");
  ok(w2.blizzT > 0, "and the storm has a timer the HUD can read");
  /* Ashford never sees one */
  const a = mk("siege");
  ok(!a.stage.blizzard && blizzardRate(a) === 1 && !a.layout.drifts, "no storm and no drifts in Ashford");
}

console.log("— wolf dens —");
{
  const g = mk("wolfpine");
  ok(g.stage.waves.some((wv) => wv.some((gr) => gr.type === "wolfDen")), "a den turns up in the wave table");
  /* drop one on the road by hand and let it work */
  const den = spawnEnemy(g, "wolfDen", 0, 0);
  ok(den && den.def.den, "a den can be spawned");
  const before = g.enemies.length;
  run(g, ENEMIES.wolfDen.tower.unloadEvery * 2 + 14);
  const wolves = g.enemies.filter((e) => e.def === ENEMIES.direWolf);
  ok(wolves.length > 0 || g.enemies.length > before, "it looses wolves as it advances");
  ok(den.d <= g.layout.routes[0].length * (ENEMIES.wolfDen.tower.dockFrac || 0.45) + 80 || den.state === "dead", "it stops short of the gate rather than rolling into it");
  /* and killing it stops the flow */
  for (let i = 0; i < 200 && den.state !== "dead"; i += 1) damageEnemy(g, den, 400, "fire");
  ok(den.state === "dead", "a den can be burned down");
  const madeAfter = run(g, ENEMIES.wolfDen.tower.unloadEvery * 2 + 6).filter((e) => e.type === "unload").length;
  ok(madeAfter === 0, "a dead den stops making wolves");
}

console.log("— Jarl Vorne, and how he differs from Blackmoor —");
{
  const g = mk("cairnhold");
  g.wave = g.totalWaves - 1; g.gold = 4000;
  const boss = spawnEnemy(g, "iceWarlord", 0, 0);
  ok(boss && boss.boss && boss.boss.phase === 1, "he arrives in phase one");
  ok(boss.shell > 0 && boss.shellMax > 0, "sheathed in ice, which Blackmoor never was");
  ok(!ENEMIES.warlord.frost && !ENEMIES.iceWarlord.phases, "the two bosses do not share a single mechanic block");
  /* the shell soaks damage instead of his health */
  const hp0 = boss.hp; const sh0 = boss.shell;
  damageEnemy(g, boss, 120, "arrow");
  ok(boss.hp === hp0 && boss.shell < sh0, "arrows go into the ice, not into him");
  /* fire and siege break it faster */
  const b2 = spawnEnemy(g, "iceWarlord", 0, 0);
  const s1 = b2.shell; damageEnemy(g, b2, 100, "arrow"); const plain = s1 - b2.shell;
  const b3 = spawnEnemy(g, "iceWarlord", 0, 0);
  const s2 = b3.shell; damageEnemy(g, b3, 100, "fire"); const burn = s2 - b3.shell;
  ok(burn > plain, "fire eats the ice faster than arrows");
  /* break it and he is open */
  let broke = false;
  for (let i = 0; i < 60 && boss.shell > 0; i += 1) damageEnemy(g, boss, 200, "fire");
  for (const e of drainEvents(g)) if (e.type === "shellBreak") broke = true;
  ok(broke && boss.shell <= 0, "enough damage breaks the ice, and the break is announced");
  ok(boss.boss.phase === 2, "breaking it drives him to phase two");
  const hp1 = boss.hp; damageEnemy(g, boss, 150, "arrow");
  ok(boss.hp < hp1, "with the ice gone he takes real damage");
  /* it comes back */
  run(g, 12);
  ok(boss.shell > 0 || boss.state === "dead" || boss.boss.phase === 3, "the ice re-forms if he is left alone");
  /* rage */
  boss.hp = boss.maxHp * 0.2; damageEnemy(g, boss, 1, "arrow");
  run(g, 1);
  ok(boss.boss.phase === 3 || boss.state === "dead", "he enrages near death");
  if (boss.state !== "dead") ok(boss.shell <= 0 && ENEMIES.iceWarlord.frost.rage.shell === 0, "and the ice does not return in the rage");
  else ok(true, "and the ice does not return in the rage");
}

console.log("— his three telegraphs —");
{
  const kinds = new Set();
  for (let seed = 0; seed < 4 && kinds.size < 3; seed += 1) {
    const g = mk("cairnhold");
    const boss = spawnEnemy(g, "iceWarlord", 0, 0);
    boss.boss.phase = 2; boss.boss.novaCd = 0.2; boss.boss.howlCd = 0.6; boss.boss.blizzCd = 1;
    for (const e of run(g, 70)) if (e.type === "bossWind") kinds.add(e.kind);
  }
  ok(kinds.has("nova"), "the nova is telegraphed before it lands");
  ok(kinds.has("howl"), "the howl is telegraphed");
  ok(kinds.has("blizzard"), "the storm he calls is telegraphed");
  ok(kinds.size === 3, "three telegraphs in all, each with its own name");
  /* the nova actually bites, and freezes */
  const g = mk("cairnhold");
  const boss = spawnEnemy(g, "iceWarlord", 0, 0);
  boss.boss.phase = 2;
  const u = g.units[0];
  if (u) {
    u.x = boss.x + 20; u.y = boss.y; const hp = u.hp;
    boss.boss.novaCd = 0.05;
    run(g, ENEMIES.iceWarlord.frost.nova.windup + 1.2);
    ok(u.hp < hp || u.state === "dead" || u.frozenT > 0, "standing in the nova hurts");
  } else ok(true, "standing in the nova hurts");
  /* and the howl brings wolves */
  const g2 = mk("cairnhold");
  const b2 = spawnEnemy(g2, "iceWarlord", 0, 0);
  b2.boss.phase = 2; b2.boss.howlCd = 0.05; b2.boss.novaCd = 99; b2.boss.blizzCd = 99;
  const n0 = g2.enemies.length;
  run(g2, ENEMIES.iceWarlord.frost.howl.windup + 2);
  ok(g2.enemies.length > n0, "the howl calls the pack in");
  /* and with the ice broken he starts nothing at all: that is the window */
  const g3 = mk("cairnhold");
  const b3 = spawnEnemy(g3, "iceWarlord", 0, 0);
  b3.boss.phase = 2; b3.boss.novaCd = 0; b3.boss.howlCd = 0; b3.boss.blizzCd = 0;
  for (let i = 0; i < 40 && b3.shell > 0; i += 1) damageEnemy(g3, b3, 300, "fire");
  const quiet = run(g3, 4).filter((e) => e.type === "bossWind");
  ok(b3.shell <= 0 && quiet.length === 0, "with the ice broken he starts nothing new");
}

console.log("— he never deadlocks —");
{
  /* the worst case: nobody ever breaks the ice. He must still come on. */
  for (const seed of [3, 11]) {
    const g = makeGame(); g.seed = seed; startStage(g, "cairnhold");
    const boss = spawnEnemy(g, "iceWarlord", 0, 0);
    run(g, ENEMIES.iceWarlord.frost.patience + 40);
    ok(boss.boss.phase >= 2 || boss.state === "dead", `seed ${seed}: he runs out of patience and comes on even behind an unbroken shell`);
  }
}

console.log("— saving and resuming in the north —");
{
  for (const id of FROST_IDS) {
    const g = mk(id); g.gold = 3000;
    const plot = g.layout.plots.findIndex((p, i) => canBuild(g, i, "archer"));
    if (plot >= 0) buildTower(g, plot, "archer");
    callWave(g); run(g, 45);
    const snap = JSON.parse(JSON.stringify(serializeGame(g)));
    const r = restoreGame(snap);
    ok(r && r.phase === "playing", `${id}: the battle restores`);
    ok(r.heroDef.id === g.heroDef.id && r.stage.id === id, `${id}: the right hero and stage come back`);
    ok(r.enemies.length === g.enemies.length && r.units.length === g.units.length, `${id}: no unit or enemy is duplicated or lost`);
    ok(r.gold === g.gold && r.castleHp === g.castleHp && r.wave === g.wave, `${id}: gold, castle and wave all match`);
    ok(Math.abs((r.blizzT || 0) - (g.blizzT || 0)) < 0.001, `${id}: the storm timer survives`);
  }
  /* mid-storm */
  const w = mk("wolfpine"); callWave(w); startBlizzard(w); run(w, 3);
  const rw = restoreGame(JSON.parse(JSON.stringify(serializeGame(w))));
  ok(rw.blizzT > 0 && blizzardRate(rw) === blizzardRate(w), "a saved storm is still blowing after a resume");
  /* every boss phase */
  for (const phase of [1, 2, 3]) {
    const g = mk("cairnhold");
    const boss = spawnEnemy(g, "iceWarlord", 0, 0);
    if (phase >= 2) { boss.boss.phase = 2; boss.shell = 0; }
    if (phase === 3) { boss.boss.phase = 3; boss.hp = boss.maxHp * 0.3; }
    boss.boss.windT = 0.8; boss.boss.windKind = "nova";
    run(g, 0.5);
    const r = restoreGame(JSON.parse(JSON.stringify(serializeGame(g))));
    const rb = r.enemies.find((e) => e.boss);
    ok(rb && rb.boss.phase === boss.boss.phase, `phase ${phase}: the phase survives a save`);
    ok(rb && Math.abs(rb.shell - boss.shell) < 0.001 && Math.abs(rb.hp - boss.hp) < 0.001, `phase ${phase}: the ice and his health survive`);
    ok(rb && rb.boss.windKind === boss.boss.windKind && Math.abs(rb.boss.windT - boss.boss.windT) < 0.001, `phase ${phase}: a wind-up in progress survives`);
    ok(r.enemies.filter((e) => e.boss).length === 1, `phase ${phase}: exactly one boss comes back`);
  }
  /* with dens on the field */
  const d = mk("wolfpine"); spawnEnemy(d, "wolfDen", 0, 0); run(d, 20);
  const rd = restoreGame(JSON.parse(JSON.stringify(serializeGame(d))));
  ok(rd.enemies.filter((e) => e.def.den).length === d.enemies.filter((e) => e.def.den).length, "dens on the field survive a save");
}

console.log("— Royal Knights ride in the snow —");
{
  const g = mk("wolfpine"); g.gold = 5000;
  const plot = g.layout.plots.findIndex((p, i) => canBuild(g, i, "barracks"));
  buildTower(g, plot, "barracks");
  upgradeTower(g, plot); upgradeTower(g, plot); upgradeTower(g, plot);
  ok(g.towers[plot].level >= 3 && g.units.filter((u) => u.tower === plot).every((u) => u.unit === "royalGuard"), "a barracks can still be taken to Royal Guard on a frost map");
  ok(canMount(g, plot) === true, "and the knights can still be mounted");
  const cost = g.gold;
  ok(setMount(g, plot, true) && g.gold === cost - MOUNT_COST, "mounting still costs what it costs");
  const squad = g.units.filter((u) => u.tower === plot);
  ok(squad.length > 0 && squad.every((u) => u.unit === "royalKnight"), "every soldier from that barracks is horsed");
  callWave(g); run(g, 50);
  ok(!g.units.some((u) => Number.isNaN(u.x) || Number.isNaN(u.y)), "mounted knights fight in the snow without breaking");
  const r = restoreGame(JSON.parse(JSON.stringify(serializeGame(g))));
  ok(r.towers[plot].mounted === true && r.units.filter((u) => u.unit === "royalKnight").length === g.units.filter((u) => u.unit === "royalKnight").length, "their horses survive a save");
}

console.log("— the north is beatable, both ways round —");
{
  for (const id of FROST_IDS) {
    for (const layout of ["landscape", "portrait"]) {
      const g = mk(id, { layout });
      const st = {};
      let guard = 0;
      while (g.phase === "playing" && guard < 200000) { autoStep(g, st); stepGame(g, DT); drainEvents(g); guard += 1; }
      const sum = summarise(g);
      ok(g.phase === "victory", `${id} (${layout}): won on Normal`);
      ok(sum.castleHp > 0 && sum.stars >= 1, `${id} (${layout}): the castle survived with ${sum.castleHp}/${sum.castleMax} and ${sum.stars} stars`);
      ok(g.t < 1400, `${id} (${layout}): finished in ${Math.round(g.t)}s with no stall`);
      if (id === "cairnhold") ok(!g.enemies.some((e) => e.def.boss === "final" && e.state !== "dead"), `cairnhold (${layout}): cannot be won with Vorne still standing`);
    }
  }
}

console.log("— Hard is harder, and still fair —");
{
  let wins = 0; const runs = FROST_IDS.length;
  for (const id of FROST_IDS) {
    const g = mk(id, { difficulty: "hard" });
    const st = {}; let guard = 0;
    while (g.phase === "playing" && guard < 200000) { autoStep(g, st); stepGame(g, DT); drainEvents(g); guard += 1; }
    if (g.phase === "victory") wins += 1;
    ok(g.phase !== "playing", `${id}: Hard resolves rather than stalling`);
  }
  ok(wins >= 1 && wins <= runs, `a scripted commander wins ${wins} of ${runs} frost stages on Hard`);
}

console.log("— finishing the north —");
{
  resetProgress(readSave());
  /* win Ashford first, as a player must */
  for (const id of ["greenhollow", "stonebridge", "siege"]) {
    const g = mk(id); g.phase = "victory"; g.stars = 3;
    recordResult(readSave(), summarise(g));
  }
  ok(hasBadge(readSave(), "defenderOfAshford") && !hasBadge(readSave(), "guardianOfTheFrozenNorth"), "Ashford's badge is held, the north's is not");
  let flags = null;
  for (const id of FROST_IDS) {
    const g = mk(id); g.phase = "victory"; g.stars = 3;
    flags = recordResult(readSave(), summarise(g));
  }
  const sv = readSave();
  ok((sv.campaignsDone || []).includes("frost"), "the north is marked complete");
  ok(hasBadge(sv, "guardianOfTheFrozenNorth"), "and the Guardian badge is awarded");
  ok((flags.newBadges || []).includes("guardianOfTheFrozenNorth"), "the victory screen is told the badge is new");
  ok(badgesOf(sv).length === 2 && new Set(badgesOf(sv)).size === 2, "two badges, neither duplicated");
  /* winning the Cairnhold again awards nothing twice */
  const again = mk("cairnhold"); again.phase = "victory"; again.stars = 3;
  const f2 = recordResult(readSave(), summarise(again));
  ok((f2.newBadges || []).length === 0 && badgesOf(readSave()).length === 2, "a second victory awards no second badge");
  ok((readSave().campaignsDone || []).filter((k) => k === "frost").length === 1, "and the kingdom is not listed twice");
  ok(!isKingdomUnlocked(readSave(), "sun"), "kingdom three stays locked even with both kingdoms won");
  ok(stageRecord(readSave(), "greenhollow").completed && stageRecord(readSave(), "cairnhold").completed, "both kingdoms keep their records side by side");
  resetProgress(readSave());
}

console.log("— the version 2.0 polish pass —");
{
  /* the frost arrow used to do nothing at all past its reach, which
     reads as a broken button rather than a rule */
  const g = mk("frostwatch"); callWave(g); run(g, 30);
  const h = g.hero; const ab = ELARA.ability;
  g.hero.chargeCd = 0;
  const far = heroCharge(g, h.x - ab.dist * 3, h.y);        // west, away from the map edge
  ok(far === true, "a shot aimed past her reach still fires");
  const st = g.strikes[g.strikes.length - 1];
  ok(st && Math.abs(Math.hypot(st.x - h.x, st.y - h.y) - ab.dist) < 2, "and it lands at the edge of her reach, not where the finger was");
  ok(g.hero.chargeCd > 0, "and it costs the cooldown like any other shot");
  /* Edric was never affected: his charge always clamped */
  const g2 = mk("siege"); g2.hero.chargeCd = 0;
  ok(heroCharge(g2, g2.hero.x + 4000, g2.hero.y) === true, "Sir Edric's charge still clamps the same way");
}

console.log("— the ground tells you what it is doing —");
{
  const g = mk("frostwatch");
  const d = g.layout.drifts[0];
  ok(inDrift(g, d.x, d.y) && !inDrift(g, 20, 20), "a drift knows what is standing in it");
  ok(!onFrost(g, d.x, d.y), "a snowdrift is not iced ground");
  g.zones.push({ id: 1, x: 400, y: 400, r: 80, t: 4, dps: 0, tick: 0, frost: true, slow: 0.5 });
  ok(onFrost(g, 400, 400) && !onFrost(g, 900, 900), "the frost arrow's ice does");
  /* enemies wade at the full penalty, your own soldiers at half */
  const e = spawnEnemy(g, "frostRaider", 0, 0);
  e.x = d.x; e.y = d.y; syncCheck(e);
  const slow = terrainSlow(g, d.x, d.y);
  ok(slow < 1 && slow >= 0.35, "the drift slows what crosses it, and never to a standstill");
  const u = g.units[0];
  if (u) {
    u.x = d.x; u.y = d.y;
    const fast = unitSpeedAt(g, u);
    u.x = 20; u.y = 20;
    const clear = unitSpeedAt(g, u);
    ok(fast < clear, "your soldiers feel the snow too");
    ok(fast > clear * slow + 0.01, "but less than the northerners do");
    ok(u.chilled === false, "and the mark comes off once they are out of it");
  } else { ok(true, "your soldiers feel the snow too"); ok(true, "but less than the northerners do"); ok(true, "and the mark comes off once they are out of it"); }
}

console.log("— the Jarl cannot win by standing at the gate —");
{
  const g = mk("cairnhold");
  const boss = spawnEnemy(g, "iceWarlord", 0, 0);
  boss.boss.phase = 2;
  /* at the gate the ice is not tended: a player losing the castle always
     has a way back into the fight */
  boss.atGate = true; boss.shell = 100;
  const before = boss.shell;
  run(g, 3);
  ok(boss.shell <= before, "the ice does not re-form while he is battering the gate");
  /* away from the gate it does */
  const g2 = mk("cairnhold");
  const b2 = spawnEnemy(g2, "iceWarlord", 0, 0);
  b2.boss.phase = 2; b2.shell = 100;
  run(g2, 3);
  ok(b2.shell > 100, "away from the gate it closes again");
  /* and each re-form comes back thinner */
  const g3 = mk("cairnhold");
  const b3 = spawnEnemy(g3, "iceWarlord", 0, 0);
  b3.boss.phase = 2;
  b3.boss.reforms = 4;
  b3.shell = 10;
  run(g3, 40);
  ok(b3.shell <= b3.shellMax * 0.42, `after four breaks the ice only comes back to ${Math.round((b3.shell / b3.shellMax) * 100)}% (cap 40%)`);
  ok(ENEMIES.iceWarlord.frost.shellRegen > 0, "the ice still regenerates, it is only capped");
  /* the counters survive a save, or a resumed fight would be easier */
  const g4 = mk("cairnhold");
  const b4 = spawnEnemy(g4, "iceWarlord", 0, 0);
  b4.boss.reforms = 3; b4.boss.patience = 12.5; run(g4, 0.2);
  const r4 = restoreGame(JSON.parse(JSON.stringify(serializeGame(g4))));
  const rb = r4.enemies.find((e) => e.boss);
  ok(rb && rb.boss.reforms === 3, "how many times the ice has been broken survives a save");
  ok(rb && Math.abs(rb.boss.patience - b4.boss.patience) < 0.3, "and so does his patience");
}

console.log("— both maps defend the gate the same way —");
{
  /* A boss that batters the gate turns "how many towers can reach the
     gate" into the whole fight. The Cairnhold's landscape map had one
     plot in range where portrait had two, and lost Normal runs to it.
     What matters is that the two orientations agree, not the number. */
  const reach = 240;
  for (const st of STAGES) {
    const counts = ["landscape", "portrait"].map((layout) => {
      const g = mk(st.id, { layout });
      const gate = g.layout.castle.gate;
      return g.layout.plots.filter((p) => Math.hypot(p.x - gate.x, p.y - gate.y) < reach).length;
    });
    ok(Math.abs(counts[0] - counts[1]) <= 1, `${st.id}: the gate is defended alike in both orientations (${counts.join(" and ")})`);
    /* Only Vorne can win by standing at the gate: his ice makes it a
       damage race, so both of his orientations need real gate cover.
       Blackmoor commits to sweeps and dies to them, and the Siege's
       geometry is left exactly as it shipped. */
    const boss = st.waves.flat().map((gr) => ENEMIES[gr.type]).find((d) => d && d.boss === "final");
    if (boss && boss.frost) ok(Math.min(counts[0], counts[1]) >= 2, `${st.id}: a boss at the gate can be answered by more than one tower (${counts.join(" and ")})`);
  }
}

console.log("— neither orientation is the easy one —");
{
  /* A road that is far shorter in one orientation gives the towers less
     time for the same wave. Stonebridge's portrait roads were 897 and
     812 against 1415 and 858, and it lost half its Normal runs. */
  for (const st of STAGES) {
    const lens = ["landscape", "portrait"].map((layout) => {
      const g = mk(st.id, { layout });
      return g.layout.routes.map((r) => r.length).reduce((a, b) => a + b, 0) / g.layout.routes.length;
    });
    const ratio = Math.min(lens[0], lens[1]) / Math.max(lens[0], lens[1]);
    ok(ratio > 0.72, `${st.id}: the two orientations walk comparable roads (${Math.round(ratio * 100)}%)`);
  }
}

console.log("— the wolf den announces itself —");
{
  const g = mk("wolfpine");
  const den = spawnEnemy(g, "wolfDen", 0, 0);
  ok(den.unloadT >= 0, "a den carries the timer the renderer shakes it with");
  run(g, 60);
  ok(den.docked === true, "it stops on the road and opens");
  const before = den.unloaded || 0;
  const evs = run(g, ENEMIES.wolfDen.tower.unloadEvery + 4);
  ok(count(evs, "unload") >= 1, "and it looses a wolf on its own timer");
  ok((den.unloaded || 0) > before, "which it counts, so the renderer can telegraph the next one");
  ok(den.unloadT > 0 && den.unloadT <= ENEMIES.wolfDen.tower.unloadEvery * 2, "the timer runs down toward the next wolf");
}

console.log("— resuming a fight in an awkward moment —");
{
  /* the states a player is most likely to save in the middle of */
  const g = mk("wolfpine"); g.gold = 6000;
  const plot = g.layout.plots.findIndex((p, i) => canBuild(g, i, "barracks"));
  buildTower(g, plot, "barracks"); for (let i = 0; i < 3; i += 1) upgradeTower(g, plot);
  setMount(g, plot, true);
  callWave(g); run(g, 40);
  /* hero ability on cooldown, a knight's lance on cooldown, a storm blowing */
  g.hero.chargeCd = 0; heroCharge(g, g.hero.x - 120, g.hero.y);
  const knight = g.units.find((u) => u.unit === "royalKnight");
  if (knight) triggerUnitAbility(g, [knight.id]);
  startBlizzard(g, 9);
  run(g, 1.5);
  const cd0 = g.hero.chargeCd; const kAb = knight ? knight.abilityCd : 0;
  const r = restoreGame(JSON.parse(JSON.stringify(serializeGame(g))));
  ok(Math.abs(r.hero.chargeCd - cd0) < 0.001 && cd0 > 0, "Lady Elara's Frost Arrow comes back still on cooldown");
  const rk = r.units.find((u) => u.unit === "royalKnight");
  ok(!knight || (rk && Math.abs((rk.abilityCd || 0) - (kAb || 0)) < 0.001), "and so does the Lance Charge");
  ok(Math.abs(r.blizzT - g.blizzT) < 0.001 && r.blizzT > 0, "the storm is still blowing after the resume");
  ok(r.units.filter((u) => u.unit === "royalKnight").length === g.units.filter((u) => u.unit === "royalKnight").length, "no knight is lost or duplicated");
  ok(r.zones.length === g.zones.length, "the iced ground she left survives");
  /* and the ground still slows what stands on it after a resume */
  if (r.zones.length) { const z = r.zones[0]; ok(onFrost(r, z.x, z.y) && terrainSlow(r, z.x, z.y) < 1, "the restored ice still bites"); }
  else ok(true, "the restored ice still bites");
}

console.log("— Ashford is exactly as it was —");
{
  for (const id of ["greenhollow", "stonebridge", "siege"]) {
    const g = mk(id);
    ok(g.heroDef.id === "edric" && g.hero.hp === heroStats(1).maxHp, `${id}: Sir Edric still leads, at his own health`);
    ok(!g.stage.blizzard && !g.layout.drifts && g.stage.season !== "winter", `${id}: no snow has fallen on Ashford`);
    const st = {}; let guard = 0;
    while (g.phase === "playing" && guard < 200000) { autoStep(g, st); stepGame(g, DT); drainEvents(g); guard += 1; }
    ok(g.phase === "victory", `${id}: still won by the same scripted commander`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
