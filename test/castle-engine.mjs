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
  plotAt, canBuild, nextWaveSummary, towerLevel, PLOT_R,
} from "../src/components/castleDefender/engine/engine.js";
import { sampleRoute } from "../src/components/castleDefender/engine/path.js";
import { STAGES } from "../src/components/castleDefender/data/stages.js";
import { TOWERS, HERO } from "../src/components/castleDefender/data/towers.js";
import { ENEMIES } from "../src/components/castleDefender/data/enemies.js";

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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
