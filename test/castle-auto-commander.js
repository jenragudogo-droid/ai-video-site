/* Dev-only scripted commander that plays any stage in any kingdom.
   It ranks build plots by how much road they cover instead of using a
   hand-written plan, so a new stage can be balance-tested the day it is
   authored. Shared by the node balance runs and the browser harness. */
import * as E from "../src/components/castleDefender/engine/engine.js";
import { TOWERS } from "../src/components/castleDefender/data/towers.js";
import { sampleRoute } from "../src/components/castleDefender/engine/path.js";

/* plots ordered by road covered, weighted toward the gate end */
export function planFor(g) {
  const L = g.layout;
  const gate = L.castle.gate;
  const pts = [];
  L.routes.forEach((r, ri) => { for (let d = 0; d < r.length; d += 24) { const p = sampleRoute(r, d); pts.push({ x: p.x, y: p.y, near: d / r.length, ri }); } });
  const scored = L.plots.map((p, i) => {
    let cover = 0;
    for (const q of pts) {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < 165) cover += (1 - d / 165) * (0.6 + q.near * 0.9);
    }
    const gateD = Math.hypot(p.x - gate.x, p.y - gate.y);
    return { i, score: cover * (1 + Math.max(0, 1 - gateD / 1200) * 0.6) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.map((x) => x.i);
}

const MIX = ["archer", "barracks", "archer", "ballista", "archer", "catapult", "barracks", "ballista", "archer", "catapult", "archer", "ballista"];

export function autoStep(g, st, opts = {}) {
  st.step = (st.step || 0) + 1;
  if (!st.plan) { st.plan = planFor(g); st.mix = 0; }
  if (g.perkPending && g.perkOffer && !opts.keepPerk) E.choosePerk(g, g.perkOffer[0]);
  if (!opts.noBuild) {
    for (let k = 0; k < st.plan.length; k += 1) {
      const plot = st.plan[k];
      if (g.towers[plot]) continue;
      const type = MIX[k % MIX.length];
      if (E.canBuild(g, plot, type)) { E.buildTower(g, plot, type); return; }
      break;
    }
    /* pike drill where the stage allows it, and mount the second barracks */
    g.towers.forEach((t, i) => { if (t && t.type === "barracks" && !t.pikes && !t.mounted && g.stage.pikes && g.wave >= 4 && g.gold >= E.DRILL_COST + 90 && i === st.plan.find((p) => g.towers[p] && g.towers[p].type === "barracks")) E.setDrill(g, i, true); });
    g.towers.forEach((t, i) => { if (t && t.type === "barracks" && !t.mounted && !t.pikes && E.canMount(g, i) && g.gold >= E.MOUNT_COST + 120) E.setMount(g, i, true); });
    if (g.gold > 180) {
      let best = -1; let bc = Infinity;
      g.towers.forEach((t, i) => { if (!t || t.level >= 4) return; const c = TOWERS[t.type].upgrades[t.level - 1]; if (c < bc && c <= g.gold) { bc = c; best = i; } });
      if (best >= 0) { E.upgradeTower(g, best); return; }
    }
  }
  const h = g.hero;
  const ranged = !!h.def.range;
  const near = g.enemies.filter((e) => e.state !== "dead" && !e.routed && Math.hypot(e.x - h.x, e.y - h.y) < 260);
  if (!opts.noHero) {
    if (ranged) {
      /* Elara: drop a frost arrow on the thickest knot on the road */
      if (h.chargeCd <= 0 && g.enemies.length) {
        let best = null; let bn = 2;
        for (const e of g.enemies) {
          if (e.state === "dead" || e.routed) continue;
          if (Math.hypot(e.x - h.x, e.y - h.y) > h.def.ability.dist) continue;
          const n = g.enemies.filter((o) => o.state !== "dead" && Math.hypot(o.x - e.x, o.y - e.y) < 80).length;
          if (n > bn) { bn = n; best = e; }
        }
        if (best) E.heroCharge(g, best.x, best.y);
      }
      /* she holds a post behind the line and only shifts to cover a road */
      if (h.state === "idle" && !h.moveTarget && !near.length && g.enemies.length) {
        const far = g.enemies.reduce((a, e) => (e.progress > a.progress ? e : a), g.enemies[0]);
        if (far.progress > 0.6) { const gate = g.layout.castle.gate; E.moveHero(g, (far.x + gate.x) / 2, (far.y + gate.y) / 2); }
      }
    } else {
      const charging = near.find((e) => e.def.charge && (e.charging || e.chargeT > 0));
      if (charging && h.chargeCd <= 0 && !h.charge) E.heroCharge(g, charging.x, charging.y);
      else if (near.length >= 3 && h.chargeCd <= 0 && !h.charge) E.heroCharge(g, near[0].x, near[0].y);
      if (h.state === "idle" && !h.moveTarget && !near.length && g.enemies.length) { const far = g.enemies.reduce((a, e) => (e.progress > a.progress ? e : a), g.enemies[0]); if (far.progress > 0.5) E.moveHero(g, far.x, far.y); }
    }
  }
  if (g.abilities.volley <= 0 && g.enemies.length >= 4) { const e = g.enemies[0]; E.castVolley(g, e.x, e.y); }
  if (g.abilities.reinforce <= 0 && g.enemies.some((e) => e.progress > 0.85)) { const e = g.enemies.find((x) => x.progress > 0.85); E.castReinforce(g, e.x, e.y); }
  if (E.powerUnlocked(g, "watchfire") && g.abilities.watchfire <= 0 && g.enemies.length >= 8) E.castWatchfire(g);
  if (E.powerUnlocked(g, "royalRally") && g.abilities.royalRally <= 0 && g.units.some((u) => u.hp < u.maxHp * 0.5)) E.castRoyalRally(g);
  if (E.powerUnlocked(g, "burningOil") && g.abilities.burningOil <= 0 && g.enemies.filter((e) => e.progress > 0.8).length >= 3) E.castBurningOil(g);
  if (E.powerUnlocked(g, "emergencyRepair") && g.abilities.emergencyRepair <= 0 && g.castleHp < g.castleMax - 9) E.castEmergencyRepair(g);
  if (E.powerUnlocked(g, "catapultBarrage") && g.abilities.catapultBarrage <= 0) {
    const eng = g.enemies.find((e) => (e.def.kind === "siege" || e.def.boss) && e.state !== "dead" && !e.routed);
    const tgt = eng || (g.enemies.length >= 6 ? g.enemies[0] : null);
    if (tgt) E.castBarrage(g, tgt.x, tgt.y);
  }
  /* soldiers: pike wall where it exists, and send a squad at siege engines and dens */
  if (!st.formed && g.stage.formations) {
    for (let i = 0; i < g.towers.length; i += 1) {
      const t = g.towers[i];
      if (t && t.type === "barracks" && t.pikes) { const ids = E.squadOf(g, i); if (ids.length) { E.setFormation(g, ids, "pikeWall"); st.formed = true; break; } }
    }
  }
  if (!opts.noOrders && st.step % 120 === 0) {
    const bar = g.towers.map((t, i) => (t && t.type === "barracks" && !t.pikes ? i : -1)).filter((i) => i >= 0);
    const plot = bar[bar.length - 1];
    if (plot >= 0) {
      const ids = E.squadOf(g, plot);
      const eng = g.enemies.find((e) => e.state !== "dead" && !e.routed && (e.def.den || e.def.kind === "siege") && e.progress > 0.25);
      if (ids.length && eng) E.orderUnits(g, ids, { kind: "attack", enemyId: eng.id });
      else if (ids.length && g.units.find((u) => u.id === ids[0])?.order?.kind === "attack") E.orderUnits(g, ids, { kind: "rally" });
    }
    /* knights use the lance when a fight is on */
    for (let i = 0; i < g.towers.length; i += 1) {
      const t = g.towers[i];
      if (!t || !t.mounted) continue;
      const ids = E.squadOf(g, i);
      const ab = ids.length ? E.sharedAbility(g, ids) : null;
      if (ab && ab.ready && g.enemies.some((e) => e.state !== "dead" && ids.some((id) => { const u = g.units.find((x) => x.id === id); return u && Math.hypot(u.x - e.x, u.y - e.y) < 130; }))) E.triggerUnitAbility(g, ids);
    }
  }
  if (g.castleHp < g.castleMax * 0.45 && g.gold > 220) E.repairCastle(g);
  if (!opts.noCall && g.waveState === "countdown" && g.wave >= 2 && g.countdown < g.countdownMax - 4 && g.enemies.length === 0) E.callWave(g);
}

export function installAutoAdvance(win) {
  win.__autoState = win.__autoState || {};
  win.__auto = (sec, opts = {}) => {
    const g = win.__castle.game.current;
    const steps = Math.round(sec * 60);
    for (let i = 0; i < steps; i += 1) {
      if (g.phase !== "playing") break;
      if (opts.until && opts.until(g)) break;
      autoStep(g, win.__autoState, opts);
      E.stepGame(g, 1 / 60);
    }
    return { t: Math.round(g.t), wave: g.wave, ws: g.waveState, enemies: g.enemies.length, castle: g.castleHp, wall: g.wallHp, phase: g.phase, boss: g.bossPhase, blizz: Math.round(g.blizzT) };
  };
}
