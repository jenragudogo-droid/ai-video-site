/* Dev-only scripted commander for the Siege of Ashford, shared by the
   node balance runs and the browser harness. `siegeStep(g, st)` issues
   one frame of orders; `st` keeps its bookkeeping between calls. */
import * as E from "../src/components/castleDefender/engine/engine.js";
import { TOWERS } from "../src/components/castleDefender/data/towers.js";

export const SIEGE_PLAN = [[1, "archer"], [0, "archer"], [2, "barracks"], [3, "ballista"], [4, "archer"], [5, "barracks"], [7, "ballista"], [6, "catapult"], [8, "archer"], [10, "catapult"], [9, "archer"], [11, "ballista"]];

export function siegeStep(g, st, opts = {}) {
  st.step = (st.step || 0) + 1;
  if (g.perkPending && g.perkOffer && !opts.keepPerk) E.choosePerk(g, g.perkOffer[0]);
  if (!opts.noBuild) {
    for (const [plot, type] of SIEGE_PLAN) { if (!g.towers[plot] && E.canBuild(g, plot, type)) { E.buildTower(g, plot, type); return; } }
    g.towers.forEach((t, i) => { if (t && t.type === "barracks" && !t.pikes && g.wave >= 4 && g.gold >= E.DRILL_COST + 80 && i === 2) E.setDrill(g, i, true); });
    /* the second barracks mounts up once it reaches Royal Guard */
    if (!opts.noMount) g.towers.forEach((t, i) => { if (t && t.type === "barracks" && i === 5 && !t.mounted && !t.pikes && E.canMount(g, i) && g.gold >= E.MOUNT_COST + 60) E.setMount(g, i, true); });
    if (g.gold > 180) { let best = -1; let bestCost = Infinity; g.towers.forEach((t, i) => { if (!t || t.level >= 4) return; const cst = TOWERS[t.type].upgrades[t.level - 1]; if (cst < bestCost && cst <= g.gold) { bestCost = cst; best = i; } }); if (best >= 0) { E.upgradeTower(g, best); return; } }
  }
  const h = g.hero;
  const near = g.enemies.filter((e) => e.state !== "dead" && Math.hypot(e.x - h.x, e.y - h.y) < 220);
  const charging = near.find((e) => e.def.charge && (e.charging || e.chargeT > 0));
  if (!opts.noHero) {
    if (charging && h.chargeCd <= 0 && !h.charge) E.heroCharge(g, charging.x, charging.y);
    else if (near.length >= 3 && h.chargeCd <= 0 && !h.charge) E.heroCharge(g, near[0].x, near[0].y);
    if (h.state === "idle" && !h.moveTarget && near.length === 0 && g.enemies.length) { const far = g.enemies.reduce((a, e) => (e.progress > a.progress ? e : a), g.enemies[0]); if (far.progress > 0.5) E.moveHero(g, far.x, far.y); }
  }
  if (g.abilities.volley <= 0 && g.enemies.length >= 4) { const e = g.enemies[0]; E.castVolley(g, e.x, e.y); }
  if (g.abilities.reinforce <= 0 && g.enemies.some((e) => e.progress > 0.85)) { const e = g.enemies.find((x) => x.progress > 0.85); E.castReinforce(g, e.x, e.y); }
  if (E.powerUnlocked(g, "watchfire") && g.abilities.watchfire <= 0 && g.enemies.length >= 8) E.castWatchfire(g);
  if (E.powerUnlocked(g, "royalRally") && g.abilities.royalRally <= 0 && g.units.some((u) => u.hp < u.maxHp * 0.5)) E.castRoyalRally(g);
  if (E.powerUnlocked(g, "burningOil") && g.abilities.burningOil <= 0 && g.enemies.filter((e) => e.progress > 0.8).length >= 3) E.castBurningOil(g);
  if (E.powerUnlocked(g, "emergencyRepair") && g.abilities.emergencyRepair <= 0 && g.castleHp < g.castleMax - 9) E.castEmergencyRepair(g);
  if (E.powerUnlocked(g, "catapultBarrage") && g.abilities.catapultBarrage <= 0) { const eng = g.enemies.find((e) => e.def.kind === "siege" && e.state !== "dead"); const tgt = eng || (g.enemies.length >= 6 ? g.enemies[0] : null); if (tgt) E.castBarrage(g, tgt.x, tgt.y); }
  if (!st.formed && g.towers[2] && g.towers[2].pikes && g.stage.formations) { const ids = E.squadOf(g, 2); if (ids.length) { E.setFormation(g, ids, "pikeWall"); st.formed = true; } }
  /* knights use the lance when a fight is on */
  if (g.towers[5] && g.towers[5].mounted) { const ids = E.squadOf(g, 5); const ab = ids.length ? E.sharedAbility(g, ids) : null; if (ab && ab.ready && g.enemies.some((e) => e.state !== "dead" && ids.some((id) => { const u = g.units.find((x) => x.id === id); return u && Math.hypot(u.x - e.x, u.y - e.y) < 120; }))) E.triggerUnitAbility(g, ids); }
  if (!opts.noOrders && st.step % 120 === 0 && g.towers[5]) { const ids = E.squadOf(g, 5); const eng = g.enemies.find((e) => e.def.kind === "siege" && e.state !== "dead" && e.progress > 0.3); if (ids.length && eng) E.orderUnits(g, ids, { kind: "attack", enemyId: eng.id }); else if (ids.length && g.units.find((u) => u.id === ids[0])?.order?.kind === "attack") E.orderUnits(g, ids, { kind: "rally" }); }
  if (g.castleHp < 12 && g.gold > 200) E.repairCastle(g);
  if (!opts.noCall && g.waveState === "countdown" && g.wave >= 2 && g.countdown < g.countdownMax - 4 && g.enemies.length === 0) E.callWave(g);
}

/* browser helper: run the siege commander for `sec` simulated seconds or until `until(g)` */
export function installSiegeAdvance(win) {
  win.__siegeState = win.__siegeState || {};
  win.__adv = (sec, opts = {}) => {
    const g = win.__castle.game.current;
    const steps = Math.round(sec * 60);
    for (let i = 0; i < steps; i += 1) {
      if (g.phase !== "playing") break;
      if (opts.until && opts.until(g)) break;
      siegeStep(g, win.__siegeState, opts);
      E.stepGame(g, 1 / 60);
    }
    return { t: Math.round(g.t), wave: g.wave, ws: g.waveState, enemies: g.enemies.length, castle: g.castleHp, wall: g.wallHp, phase: g.phase, boss: g.bossPhase };
  };
}
