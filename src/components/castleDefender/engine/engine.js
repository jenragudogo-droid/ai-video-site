/* ------------------------------------------------------------------ *
 * Castle Defender — the simulation.
 *
 * Pure logic: no DOM, no canvas, no audio. The renderer reads this
 * state, the React shell drains `s.events` for sound and effects, and
 * scripted tests run the whole thing under node.
 *
 * World units are the stage layout's units (1600 x 900 landscape or
 * 900 x 1600 portrait). Enemies live on routes as (route, distance);
 * soldiers, the hero and projectiles live in free coordinates.
 * ------------------------------------------------------------------ */

import { buildRoute, sampleRoute, nearestOnRoutes } from "./path.js";
import { expandWave, endlessWave, waveSummary } from "./waves.js";
import { ENEMIES } from "../data/enemies.js";
import {
  TOWERS, towerLevel, upgradeCost, towerValue, SELL_RATE, MAX_LEVEL,
  SOLDIERS, HERO, heroStats, ABILITIES, DIFFICULTY, PIKE_UNITS, DRILL_COST, FORMATIONS,
} from "../data/towers.js";
import { stageById } from "../data/stages.js";
import { PERKS, PERK_BY_ID, RARITY, POWERS } from "../data/perks.js";
import { metaMods } from "../data/progression.js";

/* 1 + a fractional modifier, e.g. mul(s, "archerRange") */
const mul = (s, key) => 1 + ((s.mods && s.mods[key]) || 0);
const add = (s, key) => (s.mods && s.mods[key]) || 0;

export { towerLevel, upgradeCost, towerValue, waveSummary, SELL_RATE, MAX_LEVEL, DRILL_COST, FORMATIONS };

export const PLOT_R = 36;
const ARROW_SPEED = 520;
const BOLT_SPEED = 760;
const STONE_SPEED = 300;
const ENEMY_ARROW_SPEED = 420;
const ENGAGE_DIST = 30;          // melee reach
const DEAD_LINGER = 1.5;         // seconds a fallen body stays in the sim
const SOLDIER_OFFSETS = [[0, -16], [-18, 10], [18, 10], [0, 26], [-30, -6], [30, -6]];

/* Deterministic RNG so a seeded run replays identically under test. */
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* ------------------------------------------------------------------ */
/*                              layouts                                */
/* ------------------------------------------------------------------ */

function resolveLayout(stage, name) {
  const raw = stage.layouts[name] || stage.layouts.landscape;
  const opens = stage.routeOpens || {};
  const routes = raw.routes.map((r, i) => {
    const route = buildRoute(r.points);
    route.opensAt = opens[i] || 1;
    route.width = r.width || 1;
    if (raw.outerWall) {
      /* where this road crosses the outer wall: the gap or the breach,
         whichever it passes closest to. Siege engines aim here, rams
         strike here, siege towers dock just short of it. */
      let best = null; let bd = Infinity;
      for (const pt of [raw.outerWall.gap, raw.outerWall.breach]) {
        route.pts.forEach((q, k) => { const d = (q.x - pt.x) ** 2 + (q.y - pt.y) ** 2; if (d < bd) { bd = d; best = { d: route.dist[k], x: pt.x, y: pt.y, breach: pt === raw.outerWall.breach }; } });
      }
      route.wallD = best.d; route.wallPt = { x: best.x, y: best.y }; route.throughBreach = best.breach;
    }
    return route;
  });
  return { name, ...raw, routes, narrow: raw.narrow || [] };
}

function defaultRally(s, plotIdx) {
  const p = s.layout.plots[plotIdx];
  const near = nearestOnRoutes(s.layout.routes, p.x, p.y);
  if (near && near.dist2 < 170 * 170) return { x: near.x, y: near.y };
  return { x: p.x, y: p.y + 40 };
}

/* ------------------------------------------------------------------ */
/*                              creation                               */
/* ------------------------------------------------------------------ */

export function makeGame({ stageId = "greenhollow", layout = "landscape", difficulty = "normal", mode = "campaign", seed = 1, upgrades = null } = {}) {
  const stage = stageById(stageId);
  const mods = metaMods(upgrades || {});
  const s = {
    mods, perks: [], perkOffer: null, perkPending: false, unlocks: [],
    boostT: 0, rallyT: 0,
    seed,
    rng: mulberry(seed),
    stage,
    mode,
    difficulty,
    diff: DIFFICULTY[difficulty] || DIFFICULTY.normal,
    layout: resolveLayout(stage, layout),
    phase: "ready",             // ready | playing | victory | defeat
    t: 0,
    gold: stage.startGold + (mods.startGold || 0),
    castleHp: stage.castleHp + (mods.castleBonus || 0),
    castleMax: stage.castleHp + (mods.castleBonus || 0),
    wave: 0,
    totalWaves: mode === "endless" ? Infinity : stage.waves.length,
    waveState: "countdown",     // countdown | active
    countdown: stage.firstCountdown || 15,
    countdownMax: stage.firstCountdown || 15,
    waveT: 0,
    queue: [],
    enemies: [],
    units: [],
    towers: stage.layouts.landscape.plots.map(() => null),
    projectiles: [],
    strikes: [],
    zones: [],
    hero: null,
    abilities: { volley: 0, reinforce: 0, watchfire: 0, royalRally: 0, burningOil: 0, emergencyRepair: 0, catapultBarrage: 0 },
    wallHp: stage.layouts.landscape.outerWall ? stage.layouts.landscape.outerWall.hp : null,
    wallMax: stage.layouts.landscape.outerWall ? stage.layouts.landscape.outerWall.hp : null,
    bossPhase: 0,
    stats: { kills: 0, score: 0, early: 0, built: 0, upgrades: 0, gateHits: 0, damageTaken: 0, heroKills: 0, waveBonus: 0 },
    events: [],
    nextId: 1,
    stars: 0,
    lastGateHit: 0,
  };
  s.upgradesUsed = upgrades || null;
  s.hero = makeHero(s);
  return s;
}

export function resetGame(s, opts = {}) {
  const fresh = makeGame({
    stageId: opts.stageId || s.stage.id,
    layout: opts.layout || s.layout.name,
    difficulty: opts.difficulty || s.difficulty,
    mode: opts.mode || s.mode,
    seed: opts.seed ?? ((s.seed * 7919 + 13) | 0),
    upgrades: opts.upgrades ?? s.upgradesUsed ?? null,
  });
  Object.assign(s, fresh);
  return s;
}

export function startStage(s) {
  if (s.phase !== "ready") return;
  s.phase = "playing";
  s.events.push({ type: "start" });
}

/* Swap between the landscape and portrait battlefield. Towers stay on
   their plot index, enemies keep (route, distance), soldiers reset to
   the rally point of the new layout, projectiles are dropped. */
export function setLayout(s, name) {
  if (s.layout.name === name) return;
  s.layout = resolveLayout(s.stage, name);
  s.projectiles.length = 0;
  s.strikes.length = 0;
  s.zones.length = 0;
  s.towers.forEach((t, i) => {
    if (!t) return;
    if (t.type === "barracks") {
      t.rally = defaultRally(s, i);
      s.units.forEach((u) => {
        if (u.tower !== i) return;
        placeSoldierHome(s, u, t);
        u.x = u.home.x; u.y = u.home.y; u.target = null;
      });
    }
  });
  s.units.forEach((u) => {
    if (u.kind === "levy") { u.state = "dead"; u.deadT = 0; u.life = 0; }
  });
  const h = s.hero;
  h.x = s.layout.heroSpawn.x; h.y = s.layout.heroSpawn.y;
  h.post = { x: h.x, y: h.y }; h.moveTarget = null; h.target = null; h.charge = null;
  s.enemies.forEach((e) => syncEnemyPos(s, e));
  s.events.push({ type: "layout", name });
}

export function drainEvents(s) {
  const out = s.events;
  s.events = [];
  return out;
}

/* ------------------------------------------------------------------ */
/*                               units                                 */
/* ------------------------------------------------------------------ */

function makeHero(s) {
  const st = heroStatsFor(s, 1);
  const sp = s.layout.heroSpawn;
  return {
    id: s.nextId++, kind: "hero", unit: "hero", def: HERO,
    level: 1, xp: 0, hp: st.maxHp, maxHp: st.maxHp,
    x: sp.x, y: sp.y, post: { x: sp.x, y: sp.y }, home: { x: sp.x, y: sp.y },
    moveTarget: null, target: null, state: "idle", atkCd: 0, respawnT: 0, face: -1,
    chargeCd: 0, charge: null, animT: s.rng() * 3, hitT: 0, deadT: 0, outOfCombat: 0, tower: -1,
  };
}

function placeSoldierHome(s, u, tower) {
  const off = SOLDIER_OFFSETS[u.slot % SOLDIER_OFFSETS.length];
  u.home = { x: tower.rally.x + off[0], y: tower.rally.y + off[1] };
}

function makeSoldier(s, towerIdx, slot, unitType) {
  const tower = s.towers[towerIdx];
  const def = SOLDIERS[unitType];
  const p = s.layout.plots[towerIdx];
  const hp = Math.round(def.hp * mul(s, "soldierHp"));
  const u = {
    id: s.nextId++, kind: "soldier", unit: unitType, def, tower: towerIdx, slot,
    hp, maxHp: hp, x: p.x, y: p.y + 20, home: null,
    target: null, state: "walk", atkCd: 0, respawnT: 0, face: 1, animT: s.rng() * 3, hitT: 0, deadT: 0,
    order: null, hold: false, forceTarget: null, abilityCd: 0, abilityT: 0,
  };
  placeSoldierHome(s, u, tower);
  return u;
}

function makeLevy(s, x, y, slot) {
  const def = SOLDIERS.reinforcement;
  return {
    id: s.nextId++, kind: "levy", unit: "reinforcement", def, tower: -1, slot,
    hp: def.hp, maxHp: def.hp, x, y, home: { x, y }, life: def.life + add(s, "levyLife"),
    target: null, state: "idle", atkCd: 0, respawnT: 0, face: 1, animT: s.rng() * 3, hitT: 0, deadT: 0,
    order: null, hold: false, forceTarget: null, abilityCd: 0, abilityT: 0,
  };
}

const alive = (u) => u && u.state !== "dead" && u.state !== "respawn";
const getEnemy = (s, id) => (id == null ? null : s.enemies.find((e) => e.id === id) || null);
const getUnit = (s, id) => (id == null ? null : (s.hero.id === id ? s.hero : s.units.find((u) => u.id === id)) || null);

/* hero numbers with perk and kingdom modifiers folded in */
function heroStatsFor(s, level) {
  const st = heroStats(level);
  return {
    ...st,
    maxHp: Math.round(st.maxHp * mul(s, "heroHp")),
    dmg: [st.dmg[0] * mul(s, "heroDmg"), st.dmg[1] * mul(s, "heroDmg")],
    chargeDmg: st.chargeDmg * mul(s, "heroDmg"),
    chargeCd: st.chargeCd * mul(s, "heroChargeCd"),
  };
}

function unitSpeed(u) {
  const f = u.formation && FORMATIONS[u.formation];
  return (u.kind === "hero" ? HERO.speed : u.def.speed) * (f ? f.speed : 1);
}

function unitDmg(s, u) {
  if (u.kind === "hero") { const st = heroStatsFor(s, u.level); return st.dmg[0] + s.rng() * (st.dmg[1] - st.dmg[0]); }
  const f = u.formation && FORMATIONS[u.formation];
  return (u.def.dmg[0] + s.rng() * (u.def.dmg[1] - u.def.dmg[0])) * mul(s, "soldierDmg") * (f ? 1 + f.dmg : 1);
}

function unitArmour(s, u) {
  if (u.kind === "hero") return heroStatsFor(s, u.level).armour + (s.rallyT > 0 ? 0.1 : 0);
  let a = u.def.armour + add(s, "soldierArmour") + (s.rallyT > 0 ? POWERS.royalRally.armour : 0);
  if (u.def.ability && u.def.ability.id === "shieldBrace" && u.abilityT > 0) a += u.def.ability.armour;
  if (u.def.spear) a += add(s, "pikeArmour");
  const f = u.formation && FORMATIONS[u.formation];
  if (f) a += f.armour;
  a = Math.min(0.85, a);
  if (u.def.shieldWall) {
    const buddy = s.units.some((o) => o !== u && o.tower === u.tower && alive(o) && dist2(o.x, o.y, u.x, u.y) < 48 * 48);
    if (buddy) a += u.def.shieldWall;
  }
  return a;
}

function damageUnit(s, u, amount, dtype, src) {
  if (!alive(u)) return;
  if (u.def.block && s.rng() < u.def.block && dtype !== "siege") {
    s.events.push({ type: "block", x: u.x, y: u.y });
    return;
  }
  let armour = unitArmour(s, u);
  if (dtype === "pierce") armour *= 0.5;
  let a = amount * (1 - armour);
  if (u.def.rangedWeakness && (dtype === "arrow" || dtype === "pierce")) a *= u.def.rangedWeakness;
  u.hp -= a;
  u.hitT = 0.28;
  s.events.push({ type: "unitHit", x: u.x, y: u.y, hero: u.kind === "hero", dtype });
  if (u.hp <= 0) killUnit(s, u, src);
}

function killUnit(s, u) {
  u.hp = 0;
  u.state = "dead";
  u.deadT = DEAD_LINGER;
  u.target = null;
  s.enemies.forEach((e) => {
    if (e.target === u.id) e.target = null;
    const i = e.blockers.indexOf(u.id);
    if (i >= 0) e.blockers.splice(i, 1);
  });
  if (u.kind === "hero") {
    u.respawnT = HERO.respawn;
    u.charge = null;
    s.events.push({ type: "heroDown", x: u.x, y: u.y });
  } else if (u.kind === "soldier") {
    const tower = s.towers[u.tower];
    u.respawnT = tower ? TOWERS.barracks.respawn * mul(s, "respawn") : 0;
    u.order = null; u.forceTarget = null; u.hold = false;
    s.events.push({ type: "unitDown", x: u.x, y: u.y });
  } else {
    s.events.push({ type: "unitDown", x: u.x, y: u.y });
  }
}

/* ------------------------------------------------------------------ */
/*                              enemies                                */
/* ------------------------------------------------------------------ */

function spawnEnemy(s, type, route, lat) {
  const def = ENEMIES[type];
  const e = {
    id: s.nextId++, type, def, route, d: 0, lat,
    hp: Math.round(def.hp * s.diff.hp), maxHp: Math.round(def.hp * s.diff.hp),
    x: 0, y: 0, tx: 1, ty: 0, nx: 0, ny: 1, face: 1, state: "walk",
    blockers: [], blockT: 0, freeT: 0, target: null, atkCd: 0.6 + s.rng() * 0.4,
    stun: 0, hitT: 0, deadT: 0, animT: s.rng() * 3, sway: s.rng() * Math.PI * 2,
    bounty: Math.round(def.bounty * s.diff.gold),
    /* cavalry: charge windup, run and cooldown */
    chargeCd: def.charge ? 2 + s.rng() * 2 : 0, chargeT: 0, charging: false, chargeLeft: 0, chargeHits: null,
    buffT: 0, narrow: false,
    /* Stage III siege engines and the warlord */
    stopped: false, reload: def.engine ? 3.5 : 0, windT: 0, aim: null,
    docked: false, unloadT: 0, unloaded: 0, wallHit: false, repairT: 0,
    boss: def.phases ? { phase: 1, sweepCd: def.phases.sweep.cd * 0.5, hornCd: def.phases.horn.cd * 0.6, windT: 0, windKind: null, raged: false, openT: 0, roarT: 0 } : null,
  };
  syncEnemyPos(s, e);
  s.enemies.push(e);
  s.events.push({ type: "spawn", x: e.x, y: e.y, enemy: type, route });
  if (def.boss === "mini") s.events.push({ type: "miniboss", x: e.x, y: e.y, enemy: type, id: e.id });
  if (def.boss === "final") { s.bossPhase = 1; s.events.push({ type: "bossEnter", x: e.x, y: e.y, enemy: type, id: e.id }); }
  return e;
}

/* ------------------------------ the outer wall ------------------------------ */

function inWallGap(s, x, y) {
  const ow = s.layout.outerWall;
  if (!ow || !(s.wallHp > 0)) return false;
  return dist2(x, y, ow.gap.x, ow.gap.y) < 90 * 90;
}

/* how many of the warlord's guard still stand */
export function guardCount(s) {
  return s.enemies.filter((o) => o.def.guard && o.state !== "dead" && !o.routed).length;
}

export function damageWall(s, amount, src, at) {
  if (!(s.wallHp > 0)) return false;
  const before = s.wallHp;
  s.wallHp = Math.max(0, s.wallHp - amount);
  if (before > s.wallMax * 0.5 && s.wallHp <= s.wallMax * 0.5 && s.wallHp > 0) s.events.push({ type: "wallCrack", x: at ? at.x : s.layout.outerWall.gap.x, y: at ? at.y : s.layout.outerWall.gap.y });
  const ow = s.layout.outerWall;
  s.events.push({ type: "wallHit", x: at ? at.x : ow.gap.x, y: at ? at.y : ow.gap.y, amount, src });
  if (s.wallHp <= 0) {
    s.events.push({ type: "wallBreach", x: ow.breach.x, y: ow.breach.y });
    /* the breach road opens the moment the wall comes down */
    s.layout.routes.forEach((r, i) => {
      if (i > 0 && r.throughBreach && r.opensAt > s.wave) { r.opensAt = Math.max(1, s.wave); s.events.push({ type: "routeOpen", route: i, breach: true }); }
    });
  }
  return true;
}

function syncEnemyPos(s, e) {
  const route = s.layout.routes[e.route] || s.layout.routes[0];
  const p = sampleRoute(route, e.d);
  e.x = p.x + p.nx * e.lat;
  e.y = p.y + p.ny * e.lat;
  e.tx = p.tx; e.ty = p.ty; e.nx = p.nx; e.ny = p.ny;
  if (Math.abs(p.tx) > 0.25) e.face = p.tx < 0 ? -1 : 1;
  e.progress = e.d / route.length;
  e.narrow = inNarrow(s, e.x, e.y);
}

function inNarrow(s, x, y) {
  for (const z of s.layout.narrow) if (dist2(x, y, z.x, z.y) < z.r * z.r) return true;
  return false;
}

function damageEnemy(s, e, amount, dtype, opts = {}) {
  if (e.state === "dead") return 0;
  if (e.boss && e.boss.phase === 1) {
    /* behind his guard: nothing reaches him yet */
    if (s.t - (e.guardedT || -9) > 1.2) { e.guardedT = s.t; s.events.push({ type: "guarded", x: e.x, y: e.y }); }
    return 0;
  }
  if (e.boss && e.boss.roarT > 0) return 0;                       // the rage roar cannot be interrupted
  if (e.boss && e.boss.openT > 0) amount *= 1.6;                   // winded after a sweep: strike now
  let armour = e.def.armour + (e.buffT > 0 ? e.buffArmour : 0);
  if (dtype === "pierce") armour *= 1 - (opts.pierceArmour ?? 0.6);
  else if (dtype === "siege") armour *= 0.5;
  else if (dtype === "fire") armour = 0;
  else if (dtype === "charge") armour *= 0.5;
  let a = amount * (1 - armour);
  if (e.def.shieldBlock && (dtype === "arrow" || dtype === "pierce") && opts.from) {
    const dot = (opts.from.x - e.x) * e.tx + (opts.from.y - e.y) * e.ty;
    if (dot > 0) {
      a *= 1 - e.def.shieldBlock;
      s.events.push({ type: "shieldBlock", x: e.x, y: e.y, id: e.id });
    }
  }
  e.hp -= a;
  e.hitT = 0.25;
  s.events.push({ type: "hit", x: e.x, y: e.y, dtype, amount: a, enemy: e.type });
  if (e.hp <= 0) killEnemy(s, e, opts.src);
  return a;
}

function killEnemy(s, e, src) {
  e.hp = 0;
  e.state = "dead";
  e.deadT = DEAD_LINGER;
  e.blockers.forEach((id) => { const u = getUnit(s, id); if (u) u.target = null; });
  e.blockers = [];
  s.gold += Math.round(e.bounty * mul(s, "bountyMul"));
  s.stats.kills += 1;
  s.stats.score += e.bounty * 10;
  s.events.push({ type: "die", x: e.x, y: e.y, enemy: e.type, boss: e.def.boss || null });
  s.events.push({ type: "coin", x: e.x, y: e.y, amount: e.bounty });
  const h = s.hero;
  if (alive(h) && (src === h || dist2(h.x, h.y, e.x, e.y) < 260 * 260)) {
    if (src === h) s.stats.heroKills += 1;
    gainXp(s, e.def.xp);
  }
  if (e.def.boss === "mini") s.events.push({ type: "minibossDown", x: e.x, y: e.y });
  if (e.def.boss === "final") {
    s.bossPhase = 0;
    let routed = 0;
    if (s.wave >= s.totalWaves) { s.queue.length = 0; for (const o of s.enemies) if (o !== e && o.state !== "dead" && !o.routed) { o.routed = true; o.stun = 0; o.charging = false; o.chargeT = 0; o.stopped = false; o.docked = false; routed += 1; } }
    s.events.push({ type: "bossDown", x: e.x, y: e.y, routed });
  }
}

function gainXp(s, xp) {
  const h = s.hero;
  if (h.level >= HERO.maxLevel) return;
  h.xp += xp;
  while (h.level < HERO.maxLevel && h.xp >= HERO.xpLevels[h.level]) {
    h.level += 1;
    const st = heroStatsFor(s, h.level);
    h.maxHp = st.maxHp;
    h.hp = Math.min(h.maxHp, h.hp + 80);
    s.events.push({ type: "heroLevel", x: h.x, y: h.y, level: h.level });
  }
}

function nearestUnitTo(s, x, y, maxD) {
  let best = null;
  let bd = maxD * maxD;
  const consider = (u) => {
    if (!alive(u)) return;
    const d = dist2(u.x, u.y, x, y);
    if (d < bd) { bd = d; best = u; }
  };
  s.units.forEach(consider);
  consider(s.hero);
  return best;
}

function stepEnemy(s, e, dt) {
  e.animT += dt;
  if (e.hitT > 0) e.hitT -= dt;
  if (e.state === "dead") { e.deadT -= dt; return; }
  if (e.routed) {
    /* the warband breaks: back down the road at a run, gone at the entrance */
    e.state = "walk"; e.blockers = [];
    e.d -= e.def.speed * (e.def.kind === "siege" ? 1.2 : 1.6) * dt;
    syncEnemyPos(s, e); e.face = -e.face;
    if (e.d <= 0) { e.state = "dead"; e.deadT = 0; }
    return;
  }
  if (e.stun > 0) { e.stun -= dt; e.state = "stun"; return; }
  if (e.freeT > 0) e.freeT -= dt;
  const def = e.def;
  const route = s.layout.routes[e.route] || s.layout.routes[0];

  /* prune blockers that died or wandered */
  e.blockers = e.blockers.filter((id) => {
    const u = getUnit(s, id);
    return u && alive(u) && u.target === e.id;
  });
  const blocker = e.blockers.length ? getUnit(s, e.blockers[0]) : null;
  const engaged = blocker && dist2(blocker.x, blocker.y, e.x, e.y) < (ENGAGE_DIST + 26) ** 2;

  if (def.kind === "cavalry" && def.charge) {
    if (stepCharge(s, e, dt, route)) return;
  }

  if (def.kind === "siege") {
    if (def.engine) { stepSiegeCatapult(s, e, dt, route); return; }
    if (def.tower) { stepSiegeTower(s, e, dt, route); return; }
    /* nothing stops a ram; soldiers chase it instead */
    e.state = "walk";
    e.d += def.speed * dt;
    syncEnemyPos(s, e);
    if (def.wallDmg && !e.wallHit && route.wallD != null && e.d >= route.wallD - 20) {
      e.wallHit = true;
      if (s.wallHp > 0) { damageWall(s, def.wallDmg, "ram", route.wallPt); s.events.push({ type: "ramWall", x: e.x, y: e.y }); }
    }
    if (e.d >= route.length) reachGate(s, e);
    return;
  }
  if (def.engineer) stepEngineer(s, e, dt);
  if (e.boss && stepWarlord(s, e, dt)) return;

  if (engaged && def.kind !== "ranged") {
    e.state = "fight";
    e.target = blocker.id;
    e.face = blocker.x < e.x ? -1 : 1;
    if (def.kind === "cavalry") {
      e.blockT += dt;
      const pinned = e.blockers.some((id) => { const u = getUnit(s, id); return u && u.def.spear; });
      if (e.blockT > def.blockTime * (pinned ? 2.2 : 1)) {
        e.blockers.forEach((id) => { const u = getUnit(s, id); if (u) { damageUnit(s, u, 6, "blade", e); u.target = null; u.staggerT = 0.6; } });
        e.blockers = [];
        e.blockT = 0;
        e.freeT = 1.6;
        e.state = "walk";
        s.events.push({ type: "breakFree", x: e.x, y: e.y });
        return;
      }
    }
    e.atkCd -= dt;
    if (e.atkCd <= 0) {
      e.atkCd = def.atk;
      e.attackT = 0.35;
      const dmg = def.dmg[0] + s.rng() * (def.dmg[1] - def.dmg[0]);
      damageUnit(s, blocker, dmg, "blade", e);
      s.events.push({ type: "swing", x: e.x, y: e.y, enemy: true });
    }
    return;
  }

  if (def.kind === "ranged" && def.burns && !engaged) {
    /* fire archers shoot the nearest tower that is not already burning */
    let plot = -1; let bd = def.range * def.range;
    s.towers.forEach((t, i) => { if (!t || t.type === "barracks" || t.burnT > 0 || t.buildT > 0) return; const p = s.layout.plots[i]; const d = dist2(p.x, p.y, e.x, e.y); if (d < bd) { bd = d; plot = i; } });
    if (plot >= 0) {
      const p = s.layout.plots[plot];
      e.state = "shoot";
      e.face = p.x < e.x ? -1 : 1;
      e.atkCd -= dt;
      if (e.atkCd <= 0) {
        e.atkCd = def.atk;
        e.attackT = 0.4;
        s.projectiles.push({ id: s.nextId++, kind: "enemyArrow", fire: true, x: e.x, y: e.y - 30, sx: e.x, sy: e.y - 30, targetKind: "tower", plot, tx: p.x + (s.rng() - 0.5) * 16, ty: p.y - 46, speed: ENEMY_ARROW_SPEED, t: 0, dur: Math.max(0.35, Math.sqrt(bd) / ENEMY_ARROW_SPEED), dmg: 0, dtype: "fire", arc: 40, burn: def.burns });
        s.events.push({ type: "enemyShoot", x: e.x, y: e.y, fire: true });
      }
      return;
    }
  }
  if (def.kind === "ranged") {
    if (engaged) {
      /* pinned in melee: fights back weakly */
      e.state = "fight";
      e.face = blocker.x < e.x ? -1 : 1;
      e.atkCd -= dt;
      if (e.atkCd <= 0) {
        e.atkCd = def.atk * 0.8;
        e.attackT = 0.35;
        damageUnit(s, blocker, (def.dmg[0] + s.rng() * (def.dmg[1] - def.dmg[0])) * 0.6, "blade", e);
        s.events.push({ type: "swing", x: e.x, y: e.y, enemy: true });
      }
      return;
    }
    const tgt = nearestUnitTo(s, e.x, e.y, def.range);
    if (tgt) {
      e.state = "shoot";
      e.face = tgt.x < e.x ? -1 : 1;
      e.atkCd -= dt;
      if (e.atkCd <= 0) {
        e.atkCd = def.atk;
        e.attackT = 0.4;
        const dmg = def.dmg[0] + s.rng() * (def.dmg[1] - def.dmg[0]);
        s.projectiles.push({
          id: s.nextId++, kind: "enemyArrow", x: e.x, y: e.y - 30, sx: e.x, sy: e.y - 30,
          targetId: tgt.id, targetKind: "unit", speed: ENEMY_ARROW_SPEED, t: 0, dur: 0.5,
          dmg, dtype: def.pierce ? "pierce" : "arrow", arc: 24,
        });
        s.events.push({ type: "enemyShoot", x: e.x, y: e.y });
      }
      return;
    }
  }

  e.state = "walk";
  if (e.waiting) { e.state = "idle"; return; }
  let speed = def.speed * (e.buffT > 0 ? e.buffSpeed : 1);
  if (e.boss && e.boss.raged && def.phases.rage.speed) speed = def.phases.rage.speed;
  if (inWallGap(s, e.x, e.y)) speed *= 0.6;          // squeezing through the siege gate under fire
  e.d += speed * dt;
  syncEnemyPos(s, e);
  if (e.d >= route.length) reachGate(s, e);
}

/* ------------------------------ siege engines ------------------------------ */

/* A siege catapult rolls to its firing position, then lobs stones: at
   the outer wall while it stands, at the castle once it is down, and
   every third stone at the nearest tower to set it burning. Every shot
   is telegraphed with a wind-up and a ground marker. */
function stepSiegeCatapult(s, e, dt, route) {
  const eg = e.def.engine;
  if (!e.stopped) {
    e.state = "walk";
    e.d += e.def.speed * dt;
    syncEnemyPos(s, e);
    if (e.d >= route.length * eg.stopAt || e.d >= route.length - 40) { e.stopped = true; e.state = "idle"; s.events.push({ type: "siegeHalt", x: e.x, y: e.y, id: e.id }); }
    return;
  }
  e.state = e.windT > 0 ? "wind" : "idle";
  if (e.windT > 0) {
    e.windT -= dt;
    if (e.windT <= 0 && e.aim) {
      const d = Math.hypot(e.aim.x - e.x, e.aim.y - e.y);
      s.projectiles.push({ id: s.nextId++, kind: "siegeStone", x: e.x, y: e.y - 40, sx: e.x, sy: e.y - 40, tx: e.aim.x, ty: e.aim.y, t: 0, dur: Math.max(1.1, d / 240), arc: 120 + d * 0.3, hit: e.aim.kind, plot: e.aim.plot, radius: eg.radius, owner: e.id });
      s.events.push({ type: "siegeShot", x: e.x, y: e.y, id: e.id });
      e.aim = null;
      e.reload = eg.reload;
      e.shots = (e.shots || 0) + 1;
    }
    return;
  }
  e.reload -= dt;
  if (e.reload > 0) return;
  /* pick the target */
  let aim = null;
  const third = ((e.shots || 0) % 3) === 2;
  if (third) {
    let best = null; let bd = 460 * 460;
    s.towers.forEach((t, i) => { if (!t || t.type === "barracks" || t.burnT > 0) return; const p = s.layout.plots[i]; const d = dist2(p.x, p.y, e.x, e.y); if (d < bd) { bd = d; best = { x: p.x, y: p.y - 10, kind: "tower", plot: i }; } });
    aim = best;
  }
  if (!aim && s.wallHp > 0 && route.wallPt) aim = { x: route.wallPt.x, y: route.wallPt.y, kind: "wall" };
  if (!aim) { const g = s.layout.castle.gate; aim = { x: g.x + (s.rng() - 0.5) * 60, y: g.y - 20, kind: "castle" }; }
  e.aim = aim;
  e.windT = eg.windup;
  s.events.push({ type: "catapultWarn", x: e.x, y: e.y, tx: aim.x, ty: aim.y, r: eg.radius, windup: eg.windup, id: e.id, kind: aim.kind });
}

/* The siege tower crawls to the wall, drops its ramp and unloads men
   onto the road one after another, battering the wall as it sits. */
function stepSiegeTower(s, e, dt, route) {
  const tw = e.def.tower;
  if (!e.docked) {
    e.state = "walk";
    e.d += e.def.speed * dt;
    syncEnemyPos(s, e);
    const dockD = route.wallD != null ? route.wallD - tw.dockAt * 0.6 : route.length - tw.dockAt;
    if (e.d >= dockD) { e.docked = true; e.state = "docked"; e.unloadT = 1.5; s.events.push({ type: "towerDock", x: e.x, y: e.y, id: e.id }); }
    if (e.d >= route.length) reachGate(s, e);
    return;
  }
  e.state = "docked";
  if (s.wallHp > 0) { e.wallTick = (e.wallTick || 0) + dt; if (e.wallTick >= 1) { e.wallTick -= 1; damageWall(s, tw.wallDps, "tower", route.wallPt); } }
  e.unloadT -= dt;
  if (e.unloadT <= 0) {
    if (e.unloaded < tw.unloads.length) {
      const type = tw.unloads[e.unloaded];
      e.unloaded += 1;
      e.unloadT = tw.unloadEvery;
      const n = spawnEnemy(s, type, e.route, (s.rng() - 0.5) * 20);
      n.d = e.d + 34; syncEnemyPos(s, n);
      s.events.push({ type: "unload", x: n.x, y: n.y, id: e.id });
    } else if (!(s.wallHp > 0)) {
      /* emptied and the wall is down: it rolls on for the gate */
      e.docked = false; e.unloaded = 999; e.def = { ...e.def, tower: null };
    } else e.unloadT = tw.unloadEvery * 2;
  }
}

/* Engineers walk with the engines and mend the nearest damaged one. */
function stepEngineer(s, e, dt) {
  const eg = e.def.engineer;
  e.repairT -= dt;
  let best = null; let bd = eg.radius * eg.radius;
  for (const o of s.enemies) {
    if (o === e || o.state === "dead" || o.def.kind !== "siege") continue;
    const d = dist2(o.x, o.y, e.x, e.y);
    if (d < bd) { bd = d; best = o; }
  }
  /* wait for an engine that is behind on the same road */
  e.waiting = !!(best && best.route === e.route && best.d < e.d - 10 && best.hp < best.maxHp * 0.999 && !e.blockers.length);
  if (best && best.hp < best.maxHp && e.repairT <= 0) {
    e.repairT = 1;
    best.hp = Math.min(best.maxHp, best.hp + eg.rate);
    s.events.push({ type: "engineerRepair", x: best.x, y: best.y - 30, from: { x: e.x, y: e.y } });
  }
}

/* ------------------------------ the warlord ------------------------------ */

/* Returns true when the boss logic consumed the step. Phase 1: he halts
   at his camp behind his guard and cannot be hurt. Phase 2 (guard dead,
   or the final wave): he marches on the gate, sweeping the Ironbreaker
   through anyone close and sounding his horn for reinforcements. Phase 3
   at low health: faster, and a final siege push. Every big attack has
   a wind-up and a marker first. */
function stepWarlord(s, e, dt) {
  const ph = e.def.phases;
  const b = e.boss;
  if (b.phase === 1) {
    const guards = s.enemies.some((o) => o.def.guard && o.state !== "dead");
    const finalWave = s.wave >= s.totalWaves;
    if ((!guards && e.d >= ph.campAt) || finalWave) {
      b.phase = 2; s.bossPhase = 2;
      s.events.push({ type: "bossPhase", phase: 2, x: e.x, y: e.y });
      return false;
    }
    if (e.d < ph.campAt) { e.state = "walk"; e.d += e.def.speed * dt; syncEnemyPos(s, e); }
    else e.state = "idle";
    return true;
  }
  { const route = s.layout.routes[e.route] || s.layout.routes[0]; if (!e.atGate && e.d >= route.length - 40) e.atGate = true; }
  if (e.atGate) {
    /* at the gate he does not spend himself on it: he stands and batters it until he is killed */
    const route = s.layout.routes[e.route] || s.layout.routes[0];
    if (e.d > route.length - 36) { e.d = route.length - 36; syncEnemyPos(s, e); }
    e.gateT = (e.gateT ?? 1) - dt;
    if (e.gateT <= 0) {
      e.gateT = b.raged ? 2 : 3;
      const dmg = 3;
      s.castleHp = Math.max(0, s.castleHp - dmg);
      s.stats.gateHits += 1; s.stats.damageTaken += dmg; s.lastGateHit = s.t;
      e.attackT = 0.35;
      s.events.push({ type: "gateHit", x: e.x, y: e.y, dmg, enemy: e.type, siege: true });
      gateCheck(s);
      if (s.castleHp <= 0 && s.phase === "playing") { s.phase = "defeat"; s.events.push({ type: "defeat" }); return true; }
    }
  }
  if (b.openT > 0) { b.openT -= dt; if (b.openT <= 0) s.events.push({ type: "bossOpenEnd", id: e.id }); }
  if (!b.raged && e.hp <= e.maxHp * ph.rage.at) {
    b.raged = true; b.phase = 3; s.bossPhase = 3;
    b.roarT = 1.6; b.windT = 0; b.windKind = null; b.openT = 0;
    s.events.push({ type: "bossPhase", phase: 3, x: e.x, y: e.y });
    for (const [type, r] of ph.rage.push) {
      const ri = Math.min(r, s.layout.routes.length - 1);
      const n = spawnEnemy(s, type, ri, (s.rng() - 0.5) * 24);
      n.d = s.rng() * 40; syncEnemyPos(s, n);
    }
  }
  if (b.roarT > 0) {
    /* the roar: he plants his feet, immune, while the push arrives; then he comes on faster */
    b.roarT -= dt; e.state = "wind";
    if (b.roarT <= 0) { b.sweepCd = Math.min(b.sweepCd, 2); s.events.push({ type: "bossRoarEnd", x: e.x, y: e.y }); }
    return true;
  }
  if (b.windT > 0) {
    b.windT -= dt;
    e.state = "wind";
    if (b.windT <= 0) {
      if (b.windKind === "sweep") {
        const sw = ph.sweep;
        for (const u of s.units.concat([s.hero])) {
          if (!alive(u) || dist2(u.x, u.y, e.x, e.y) > sw.radius * sw.radius) continue;
          damageUnit(s, u, sw.dmg, "charge", e);
          if (alive(u)) {
            let dx = u.x - e.x; let dy = u.y - e.y; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
            u.x = clamp(u.x + dx * sw.kb, 20, s.layout.w - 20); u.y = clamp(u.y + dy * sw.kb, 20, s.layout.h - 20);
            u.staggerT = sw.stun; u.target = null; if (u.kind === "hero") u.moveTarget = null;
          }
        }
        s.events.push({ type: "bossSweep", x: e.x, y: e.y, r: sw.radius });
        /* the Ironbreaker is heavy: for a moment after the sweep he is open */
        b.openT = b.raged ? 1.8 : 2.6;
        s.events.push({ type: "bossOpen", x: e.x, y: e.y, dur: b.openT, id: e.id });
      } else {
        const h = ph.horn;
        for (const o of s.enemies) if (o !== e && o.state !== "dead") { o.buffT = h.dur; o.buffArmour = h.armour; o.buffSpeed = h.speed; }
        for (const type of h.call) { const n = spawnEnemy(s, type, e.route, (s.rng() - 0.5) * 24); n.d = s.rng() * 30; syncEnemyPos(s, n); }
        s.events.push({ type: "bossHorn", x: e.x, y: e.y });
      }
      b.windKind = null;
    }
    return true;
  }
  b.sweepCd -= dt; b.hornCd -= dt;
  const sw = ph.sweep;
  if (b.openT > 0) {
    /* winded: he can still trade blows with whoever is on him, but starts nothing new */
    const blocker = e.blockers.length ? getUnit(s, e.blockers[0]) : null;
    if (blocker && alive(blocker)) { e.face = blocker.x < e.x ? -1 : 1; e.atkCd -= dt; if (e.atkCd <= 0) { e.atkCd = e.def.atk; e.attackT = 0.35; damageUnit(s, blocker, (e.def.dmg[0] + s.rng() * (e.def.dmg[1] - e.def.dmg[0])) * 0.6, "blade", e); s.events.push({ type: "swing", x: e.x, y: e.y, enemy: true }); } }
    e.state = "stun";
    return true;
  }
  if (b.sweepCd <= 0) {
    const near = s.units.concat([s.hero]).filter((u) => alive(u) && dist2(u.x, u.y, e.x, e.y) < (sw.radius * 0.85) ** 2).length;
    if (near >= 1 && (near >= 2 || e.blockers.length)) {
      b.sweepCd = b.raged ? ph.rage.sweepCd : sw.cd;
      b.windT = sw.windup; b.windKind = "sweep";
      s.events.push({ type: "bossWind", kind: "sweep", x: e.x, y: e.y, r: sw.radius, dur: sw.windup, id: e.id });
      return true;
    }
  }
  if (b.hornCd <= 0) {
    b.hornCd = ph.horn.cd;
    b.windT = ph.horn.windup; b.windKind = "horn";
    s.events.push({ type: "bossWind", kind: "horn", x: e.x, y: e.y, r: 0, dur: ph.horn.windup, id: e.id });
    return true;
  }
  if (e.atGate) {
    /* soldiers who reach him still get a fight */
    const blocker = e.blockers.length ? getUnit(s, e.blockers[0]) : null;
    if (blocker && alive(blocker)) { e.face = blocker.x < e.x ? -1 : 1; e.atkCd -= dt * (b.raged ? ph.rage.atkMul : 1); if (e.atkCd <= 0) { e.atkCd = e.def.atk; e.attackT = 0.35; damageUnit(s, blocker, e.def.dmg[0] + s.rng() * (e.def.dmg[1] - e.def.dmg[0]), "blade", e); s.events.push({ type: "swing", x: e.x, y: e.y, enemy: true }); } }
    e.state = "fight";
    return true;
  }
  /* raged: faster blows */
  if (b.raged && e.atkCd > 0) e.atkCd -= dt * (ph.rage.atkMul - 1);
  return false;
}

/* ------------------------------ cavalry ------------------------------ */

/* Returns true when the charge logic consumed this step. A rider on
   open ground with defenders ahead winds up (telegraph), then runs
   at charge speed, striking every defender it meets once. Pikemen who
   braced take the horse on the point instead and end the charge. */
function stepCharge(s, e, dt, route) {
  const ch = e.def.charge;
  if (e.charging) {
    const speed = e.def.speed * ch.speedMul * (e.narrow ? 0.6 : 1);
    const step = speed * dt;
    e.d += step;
    e.chargeLeft -= step;
    syncEnemyPos(s, e);
    e.state = "charge";
    if (e.narrow) e.chargeLeft = Math.min(e.chargeLeft, 40);
    for (const u of s.units.concat([s.hero])) {
      if (!alive(u) || e.chargeHits.has(u.id)) continue;
      if (dist2(u.x, u.y, e.x, e.y) > 38 * 38) continue;
      e.chargeHits.add(u.id);
      if (u.def.brace && u.bracing) {
        /* the pike takes the horse */
        /* the horse's own momentum drives it onto the point: armour does not help */
        damageEnemy(s, e, ch.spearDmg * (e.def.spearWeakness || 1), "pierce", { src: u, pierceArmour: 1 });
        damageUnit(s, u, ch.dmg * 0.3, "charge", e);
        s.events.push({ type: "chargeBroken", x: e.x, y: e.y, by: "pikes", enemy: e.type });
        endCharge(s, e, true);
        if (e.state !== "dead") { e.stun = 0.9; e.d = Math.max(0, e.d - 18); syncEnemyPos(s, e); }
        return true;
      }
      const narrowMul = e.narrow ? 0.5 : 1;
      damageUnit(s, u, ch.dmg * narrowMul, "charge", e);
      if (alive(u)) {
        u.staggerT = ch.stun;
        u.x += e.tx * ch.kb * 0.5 + e.nx * ch.kb * (u.slot % 2 ? 1 : -1);
        u.y += e.ty * ch.kb * 0.5 + e.ny * ch.kb * (u.slot % 2 ? 1 : -1);
        if (u.kind === "hero") { u.moveTarget = null; }
        u.target = null;
      }
      s.events.push({ type: "cavImpact", x: u.x, y: u.y, hero: u.kind === "hero" });
    }
    if (e.d >= route.length) { reachGate(s, e); return true; }
    if (e.chargeLeft <= 0) endCharge(s, e, false);
    return true;
  }
  if (e.chargeT > 0) {
    e.chargeT -= dt;
    e.state = "rear";
    if (e.chargeT <= 0) {
      e.charging = true;
      e.chargeLeft = ch.dist;
      e.chargeHits = new Set();
      e.blockers.forEach((id) => { const u = getUnit(s, id); if (u) u.target = null; });
      e.blockers = [];
      s.events.push({ type: "chargeStart", x: e.x, y: e.y, enemy: e.type, tx: e.tx, ty: e.ty });
    }
    return true;
  }
  if (e.chargeCd > 0) { e.chargeCd -= dt; return false; }
  if (e.narrow || e.blockers.length) return false;
  /* defenders ahead within reach and roughly on the road? */
  let ahead = false;
  for (const u of s.units.concat([s.hero])) {
    if (!alive(u)) continue;
    const dx = u.x - e.x; const dy = u.y - e.y;
    const along = dx * e.tx + dy * e.ty;
    const side = Math.abs(dx * e.nx + dy * e.ny);
    if (along > 60 && along < ch.dist * 0.85 && side < 70) { ahead = true; break; }
  }
  if (!ahead) return false;
  e.chargeT = ch.buildup;
  e.chargeCd = ch.cd;
  s.events.push({ type: "chargeWarn", x: e.x, y: e.y, enemy: e.type, tx: e.tx, ty: e.ty, dist: ch.dist, buildup: ch.buildup, id: e.id });
  return true;
}

function endCharge(s, e, broken) {
  e.charging = false;
  e.chargeT = 0;
  e.chargeLeft = 0;
  e.chargeHits = null;
  e.chargeCd = e.def.charge.cd + (broken ? 4 : 0);
  e.state = "walk";
}

/* the commander's banner: nearby cavalry ride harder and shrug off more */
function stepAuras(s, dt) {
  for (const e of s.enemies) if (e.buffT > 0) e.buffT -= dt;
  for (const c of s.enemies) {
    if (c.state === "dead" || !c.def.aura) continue;
    const r2 = c.def.aura.radius ** 2;
    for (const e of s.enemies) {
      if (e === c || e.state === "dead" || (e.def.kind !== "cavalry" && !c.def.aura.all)) continue;
      if (dist2(e.x, e.y, c.x, c.y) < r2) { e.buffT = 0.4; e.buffArmour = c.def.aura.armour; e.buffSpeed = c.def.aura.speed; }
    }
  }
}

function gateCheck(s) {
  if (!s.gateWarned && s.castleHp > 0 && s.castleHp <= s.castleMax * 0.3) { s.gateWarned = true; s.events.push({ type: "gateFailing", x: s.layout.castle.gate.x, y: s.layout.castle.gate.y }); }
}

function reachGate(s, e) {
  if (e.def.persist && e.state !== "dead") { e.atGate = true; return; }   // the warlord holds the gate instead (see stepWarlord)
  const dmg = e.def.gateDmg;
  s.castleHp = Math.max(0, s.castleHp - dmg);
  gateCheck(s);
  s.stats.gateHits += 1;
  s.stats.damageTaken += dmg;
  s.lastGateHit = s.t;
  e.state = "dead";
  e.deadT = 0;
  e.blockers.forEach((id) => { const u = getUnit(s, id); if (u) u.target = null; });
  e.blockers = [];
  s.events.push({ type: "gateHit", x: e.x, y: e.y, dmg, enemy: e.type, siege: e.def.kind === "siege" });
  if (s.castleHp <= 0 && s.phase === "playing") {
    s.phase = "defeat";
    s.events.push({ type: "defeat" });
  }
}

/* ------------------------------------------------------------------ */
/*                        soldiers and the hero                        */
/* ------------------------------------------------------------------ */

function findEngagement(s, u, cx, cy, radius) {
  let best = null;
  let bd = radius * radius;
  for (const e of s.enemies) {
    if (e.state === "dead" || e.routed) continue;
    if (e.freeT > 0) continue;
    const limit = e.def.kind === "siege" ? 3 : 2;
    if (e.blockers.length >= limit && !e.blockers.includes(u.id)) continue;
    const d = dist2(e.x, e.y, cx, cy);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function moveToward(u, tx, ty, speed, dt) {
  const dx = tx - u.x;
  const dy = ty - u.y;
  const d = Math.hypot(dx, dy);
  if (d < 1) return true;
  const step = Math.min(d, speed * dt);
  u.x += (dx / d) * step;
  u.y += (dy / d) * step;
  if (Math.abs(dx) > 2) u.face = dx < 0 ? -1 : 1;
  return d - step < 2;
}

function fightSpot(s, u, e) {
  /* stand on the side of the enemy that faces the soldier's home,
     fanned by blocker slot so two soldiers do not overlap */
  const slot = Math.max(0, e.blockers.indexOf(u.id));
  let ax = u.home.x - e.x;
  let ay = u.home.y - e.y;
  const l = Math.hypot(ax, ay) || 1;
  ax /= l; ay /= l;
  const rot = slot === 0 ? 0 : (slot === 1 ? 1.1 : -1.1);
  const c = Math.cos(rot); const sn = Math.sin(rot);
  const rx = ax * c - ay * sn;
  const ry = ax * sn + ay * c;
  const reach = ENGAGE_DIST + (e.def.r || 14) * 0.6;
  return { x: e.x + rx * reach, y: e.y + ry * reach };
}

function stepFighter(s, u, dt, opts) {
  u.animT += dt;
  if (u.hitT > 0) u.hitT -= dt;
  if (u.staggerT > 0) { u.staggerT -= dt; u.state = "idle"; return; }
  const speed = unitSpeed(u);
  const atk = u.kind === "hero" ? HERO.atk : u.def.atk;

  /* an ordered attack sticks to its target wherever it goes */
  if (u.forceTarget != null) {
    const ft = getEnemy(s, u.forceTarget);
    if (!ft || ft.state === "dead") { u.forceTarget = null; if (u.order && u.order.kind === "attack") u.order = null; }
    else if (u.target !== ft.id) {
      const old = getEnemy(s, u.target); if (old) { const i = old.blockers.indexOf(u.id); if (i >= 0) old.blockers.splice(i, 1); }
      u.target = ft.id; if (!ft.blockers.includes(u.id)) ft.blockers.push(u.id);
    }
  }
  let e = getEnemy(s, u.target);
  if (e && (e.state === "dead" || (e.freeT > 0 && u.forceTarget == null))) { u.target = null; e = null; }
  if (e && u.forceTarget == null && dist2(e.x, e.y, opts.cx, opts.cy) > (opts.radius + 90) ** 2) {
    /* enemy pulled us too far from post: let go */
    const i = e.blockers.indexOf(u.id);
    if (i >= 0) e.blockers.splice(i, 1);
    u.target = null; e = null;
  }
  if (!e) {
    e = findEngagement(s, u, opts.cx, opts.cy, opts.radius);
    if (!e && u.kind === "hero") {
      /* Sir Edric does not stand and take arrows: he goes for a shooter in reach */
      let bd = 230 * 230;
      for (const o of s.enemies) { if (o.state !== "shoot" || o.def.kind !== "ranged" || o.freeT > 0 || o.blockers.length >= 2) continue; const d = dist2(o.x, o.y, u.x, u.y); if (d < bd) { bd = d; e = o; } }
    }
    if (e) {
      u.target = e.id;
      if (!e.blockers.includes(u.id)) e.blockers.push(u.id);
    }
  }
  if (e) {
    const spot = fightSpot(s, u, e);
    const near = dist2(u.x, u.y, e.x, e.y) < (ENGAGE_DIST + (e.def.r || 14)) ** 2;
    if (!near) {
      u.state = "walk";
      moveToward(u, spot.x, spot.y, speed * 1.1, dt);
      u.face = e.x < u.x ? -1 : 1;
    } else {
      u.state = "fight";
      u.face = e.x < u.x ? -1 : 1;
      /* rams keep rolling: shuffle along with them */
      if (e.def.kind === "siege") moveToward(u, spot.x, spot.y, speed, dt);
      u.atkCd -= dt;
      if (u.atkCd <= 0) {
        u.atkCd = atk;
        u.attackT = 0.3;
        const fm = u.formation && FORMATIONS[u.formation];
        const bonus = e.def.kind === "cavalry" && u.def.vsCavalry ? u.def.vsCavalry * (fm && fm.vsCavalry ? fm.vsCavalry : 1) : 1;
        damageEnemy(s, e, unitDmg(s, u) * bonus, "blade", { src: u });
        s.events.push({ type: "swing", x: u.x, y: u.y, enemy: false, hero: u.kind === "hero" });
      }
    }
    return true;
  }
  return false;
}

function stepSoldier(s, u, dt) {
  if (u.state === "dead") {
    u.deadT -= dt;
    if (u.deadT <= 0) {
      if (u.kind === "levy") { u.remove = true; return; }
      u.state = "respawn";
    }
    return;
  }
  if (u.state === "respawn") {
    u.respawnT -= dt;
    const tower = s.towers[u.tower];
    if (!tower) { u.remove = true; return; }
    if (u.respawnT <= 0) {
      u.hp = u.maxHp;
      const p = s.layout.plots[u.tower];
      u.x = p.x; u.y = p.y + 24;
      u.state = "walk";
      s.events.push({ type: "respawn", x: u.x, y: u.y });
    }
    return;
  }
  if (u.kind === "levy") {
    u.life -= dt;
    if (u.life <= 0) { u.state = "dead"; u.deadT = 0.01; u.fade = true; s.events.push({ type: "levyLeave", x: u.x, y: u.y }); return; }
  }
  const radius = u.hold ? 48 : u.kind === "levy" ? 90 : TOWERS.barracks.rallyRange;
  if (u.abilityCd > 0) u.abilityCd -= dt;
  if (u.abilityT > 0) u.abilityT -= dt;
  if (u.def.brace) {
    /* pikemen set their feet when a charge is coming their way, or on command */
    const was = u.bracing;
    u.bracing = u.abilityT > 0 || u.formation === "pikeWall" || s.enemies.some((e) => e.state !== "dead" && e.def.charge && (e.chargeT > 0 || e.charging) && dist2(e.x, e.y, u.x, u.y) < 320 * 320);
    if (u.bracing && !was) s.events.push({ type: "brace", x: u.x, y: u.y });
  }
  const busy = stepFighter(s, u, dt, { cx: u.home.x, cy: u.home.y, radius });
  if (busy) return;
  const arrived = dist2(u.x, u.y, u.home.x, u.home.y) < 9;
  if (!arrived) { u.state = "walk"; moveToward(u, u.home.x, u.home.y, unitSpeed(u), dt); }
  else u.state = "idle";
}

function stepHero(s, h, dt) {
  if (h.chargeCd > 0) h.chargeCd -= dt;
  if (h.state === "dead") {
    h.deadT -= dt;
    if (h.deadT <= 0) h.state = "respawn";
    return;
  }
  if (h.state === "respawn") {
    h.respawnT -= dt;
    if (h.respawnT <= 0) {
      h.hp = h.maxHp;
      h.x = s.layout.heroSpawn.x; h.y = s.layout.heroSpawn.y;
      h.post = { x: h.x, y: h.y }; h.moveTarget = null; h.target = null;
      h.state = "idle";
      s.events.push({ type: "heroReturn", x: h.x, y: h.y });
    }
    return;
  }
  h.animT += dt;
  if (h.hitT > 0) h.hitT -= dt;

  if (h.charge) {
    const c = h.charge;
    const step = Math.min(c.left, 900 * dt);
    h.x += c.dx * step; h.y += c.dy * step;
    c.left -= step;
    h.state = "charge";
    const st = heroStatsFor(s, h.level);
    const king = kingsCharge(s);
    const width = king ? HERO.kingsCharge.width : HERO.charge.width;
    for (const e of s.enemies) {
      if (e.state === "dead" || c.hits.has(e.id)) continue;
      if (dist2(e.x, e.y, h.x, h.y) < width * width) {
        c.hits.add(e.id);
        const counter = e.def.charge && (e.charging || e.chargeT > 0);
        damageEnemy(s, e, st.chargeDmg * (counter ? 1.5 : 1) * (king ? HERO.kingsCharge.dmgMul : 1), "charge", { src: h });
        if (counter && e.state !== "dead") {
          endCharge(s, e, true);
          e.stun = 1.5;
          s.events.push({ type: "chargeBroken", x: e.x, y: e.y, by: "hero", enemy: e.type });
        }
        if (e.state !== "dead" && e.def.kind !== "siege" && !(e.boss && e.boss.phase === 1)) {
          e.stun = Math.max(e.stun, king ? HERO.kingsCharge.stun : HERO.charge.stun);
          e.d = Math.max(0, e.d - (king ? HERO.kingsCharge.kb : HERO.charge.kb));
          e.blockers = [];
          syncEnemyPos(s, e);
        }
        s.events.push({ type: "chargeHit", x: e.x, y: e.y, king });
      }
    }
    if (c.left <= 0) {
      h.charge = null;
      h.post = { x: h.x, y: h.y };
      h.moveTarget = null;
      h.state = "idle";
      if (king) {
        /* the King's Charge ends in a shockwave */
        const kc = HERO.kingsCharge;
        for (const e of s.enemies) {
          if (e.state === "dead" || dist2(e.x, e.y, h.x, h.y) > kc.wave * kc.wave) continue;
          damageEnemy(s, e, st.chargeDmg * kc.waveDmg, "charge", { src: h });
          if (e.state !== "dead" && e.def.kind !== "siege" && !(e.boss && e.boss.phase === 1)) { e.stun = Math.max(e.stun, 0.8); e.d = Math.max(0, e.d - 30); e.blockers = []; syncEnemyPos(s, e); }
        }
        s.events.push({ type: "kingsCharge", x: h.x, y: h.y, r: kc.wave });
      }
    }
    return;
  }

  if (h.moveTarget) {
    h.state = "walk";
    h.target = null;
    const done = moveToward(h, h.moveTarget.x, h.moveTarget.y, HERO.speed, dt);
    if (done) { h.post = { x: h.x, y: h.y }; h.moveTarget = null; h.state = "idle"; }
    h.outOfCombat += dt;
  } else {
    const busy = stepFighter(s, h, dt, { cx: h.post.x, cy: h.post.y, radius: HERO.engageRange });
    if (busy) h.outOfCombat = 0;
    else {
      h.outOfCombat += dt;
      const arrived = dist2(h.x, h.y, h.post.x, h.post.y) < 9;
      if (!arrived) { h.state = "walk"; moveToward(h, h.post.x, h.post.y, HERO.speed, dt); }
      else h.state = "idle";
    }
  }
  if (h.outOfCombat > 2.5 && h.hp < h.maxHp) h.hp = Math.min(h.maxHp, h.hp + HERO.regen * dt);
}

/* ------------------------------------------------------------------ */
/*                               towers                                */
/* ------------------------------------------------------------------ */

function makeTower(s, plotIdx, type) {
  const t = { type, level: 1, cd: 0.4, target: null, angle: -Math.PI / 2, abilityCd: 0, rally: null, shooter: 0, buildT: 0.8 };
  if (type === "barracks") t.rally = defaultRally(s, plotIdx);
  return t;
}

function towerRange(s, t, lvl) {
  let r = lvl.range * (s.boostT > 0 ? 1 + POWERS.watchfire.range : 1);
  if (t.type === "archer") r *= mul(s, "archerRange");
  return r;
}

function towerTarget(s, plotIdx, lvl) {
  const p = s.layout.plots[plotIdx];
  let best = null;
  let bp = -1;
  const range = towerRange(s, s.towers[plotIdx], lvl);
  const r2 = range * range;
  const min2 = (lvl.minRange || 0) ** 2;
  for (const e of s.enemies) {
    if (e.state === "dead") continue;
    const d = dist2(e.x, e.y, p.x, p.y);
    if (d > r2 || d < min2) continue;
    if (e.progress > bp) { bp = e.progress; best = e; }
  }
  return best;
}

function fireArrow(s, from, e, dmg, dtype, extra = {}) {
  const d = Math.hypot(e.x - from.x, e.y - from.y);
  s.projectiles.push({
    id: s.nextId++, kind: "arrow", x: from.x, y: from.y, sx: from.x, sy: from.y,
    targetId: e.id, targetKind: "enemy", speed: ARROW_SPEED, t: 0, dur: Math.max(0.18, d / ARROW_SPEED),
    dmg, dtype, arc: 26 + d * 0.1, from: { x: from.x, y: from.y }, ...extra,
  });
}

function fireBolt(s, from, e, dmg, lvl, extra = {}) {
  const d = Math.hypot(e.x - from.x, e.y - from.y);
  s.projectiles.push({
    id: s.nextId++, kind: "bolt", x: from.x, y: from.y, sx: from.x, sy: from.y,
    targetId: e.id, targetKind: "enemy", speed: BOLT_SPEED, t: 0, dur: Math.max(0.12, d / BOLT_SPEED),
    dmg, dtype: "pierce", pierceArmour: lvl.pierceArmour, pierce: (lvl.pierceCount || 1) - 1, hits: new Set(), arc: 0,
    from: { x: from.x, y: from.y }, ...extra,
  });
}

function fireStone(s, from, x, y, dmg, lvl, extra = {}) {
  const d = Math.hypot(x - from.x, y - from.y);
  s.projectiles.push({
    id: s.nextId++, kind: "stone", x: from.x, y: from.y, sx: from.x, sy: from.y, tx: x, ty: y,
    speed: STONE_SPEED, t: 0, dur: Math.max(0.7, d / STONE_SPEED), dmg, dtype: "siege", radius: lvl.radius,
    fire: lvl.fire || null, arc: 90 + d * 0.25, ...extra,
  });
}

function predictLanding(s, e, dur) {
  if (e.state !== "walk") return { x: e.x, y: e.y };
  const route = s.layout.routes[e.route];
  const p = sampleRoute(route, e.d + e.def.speed * dur * 0.9);
  return { x: p.x + p.nx * e.lat, y: p.y + p.ny * e.lat };
}

function stepTower(s, i, t, dt) {
  const p = s.layout.plots[i];
  if (t.buildT > 0) { t.buildT -= dt; return; }
  if (t.abilityCd > 0) t.abilityCd -= dt;
  if (t.burnT > 0) t.burnT -= dt;
  if (t.type === "barracks") return;
  const lvl = towerLevel(t.type, t.level);
  t.cd -= dt;
  let e = getEnemy(s, t.target);
  const range = towerRange(s, t, lvl);
  if (!e || e.state === "dead" || dist2(e.x, e.y, p.x, p.y) > range * range) { e = towerTarget(s, i, lvl); t.target = e ? e.id : null; }
  if (e) {
    const want = Math.atan2(e.y - p.y, e.x - p.x);
    let diff = want - t.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    t.angle += diff * Math.min(1, dt * 8);
  }
  if (t.cd > 0 || !e) return;
  t.cd = lvl.rate / (t.type === "archer" ? mul(s, "archerRate") : t.type === "catapult" ? mul(s, "catapultRate") : 1);
  if (t.burnT > 0) t.cd *= 1 + (t.burnSlow || 0.4);
  t.fireT = 0.35;
  let dmg = lvl.dmg[0] + s.rng() * (lvl.dmg[1] - lvl.dmg[0]);
  if (t.type === "archer") {
    dmg *= mul(s, "archerDmg");
    t.shooter = (t.shooter + 1) % lvl.shooters;
    const from = { x: p.x + (lvl.shooters > 1 ? (t.shooter ? 12 : -12) : 0), y: p.y - (t.level >= 3 ? 74 : 52) };
    const pierce = add(s, "archerPierce");
    fireArrow(s, from, e, dmg, pierce > 0 ? "pierce" : "arrow", pierce > 0 ? { pierceArmour: pierce, fire: true } : {});
    s.events.push({ type: "arrow", x: from.x, y: from.y, fire: pierce > 0 });
  } else if (t.type === "ballista") {
    dmg *= mul(s, "ballistaDmg");
    const from = { x: p.x + Math.cos(t.angle) * 18, y: p.y - 30 + Math.sin(t.angle) * 10 };
    fireBolt(s, from, e, dmg, { ...lvl, pierceCount: (lvl.pierceCount || 1) + add(s, "ballistaPierce") });
    s.events.push({ type: "bolt", x: from.x, y: from.y });
  } else if (t.type === "catapult") {
    dmg *= mul(s, "catapultDmg");
    const dur = Math.max(0.7, Math.hypot(e.x - p.x, e.y - p.y) / STONE_SPEED);
    const land = predictLanding(s, e, dur);
    fireStone(s, { x: p.x, y: p.y - 40 }, land.x, land.y, dmg, { ...lvl, radius: lvl.radius * mul(s, "catapultRadius") });
    s.events.push({ type: "catapult", x: p.x, y: p.y });
  }
}

/* ------------------------------------------------------------------ */
/*                            projectiles                              */
/* ------------------------------------------------------------------ */

function stepProjectile(s, pr, dt) {
  if (pr.kind === "siegeStone") {
    pr.t += dt / pr.dur;
    const f = Math.min(1, pr.t);
    pr.x = pr.sx + (pr.tx - pr.sx) * f;
    pr.y = pr.sy + (pr.ty - pr.sy) * f;
    pr.z = Math.sin(f * Math.PI) * pr.arc;
    if (pr.t >= 1) {
      pr.done = true;
      const owner = getEnemy(s, pr.owner);
      const eg = owner && owner.def.engine ? owner.def.engine : ENEMIES.siegeCatapult.engine;
      /* soldiers under the stone are hurt too */
      for (const u of s.units.concat([s.hero])) if (alive(u) && dist2(u.x, u.y, pr.tx, pr.ty) < pr.radius * pr.radius) damageUnit(s, u, 26, "siege", null);
      if (pr.hit === "wall" && s.wallHp > 0) damageWall(s, eg.wallDmg, "catapult", { x: pr.tx, y: pr.ty });
      else if (pr.hit === "tower" && s.towers[pr.plot]) { const t = s.towers[pr.plot]; t.burnT = Math.max(t.burnT || 0, eg.towerBurn); s.events.push({ type: "towerBurn", plot: pr.plot, x: pr.tx, y: pr.ty + 10 }); }
      else if (pr.hit === "castle" || pr.hit === "wall") {
        s.castleHp = Math.max(0, s.castleHp - eg.castleDmg);
        s.stats.damageTaken += eg.castleDmg; s.lastGateHit = s.t;
        s.events.push({ type: "gateHit", x: pr.tx, y: pr.ty, dmg: eg.castleDmg, enemy: "siegeCatapult", siege: true, stone: true });
        gateCheck(s);
        if (s.castleHp <= 0 && s.phase === "playing") { s.phase = "defeat"; s.events.push({ type: "defeat" }); }
      }
      s.events.push({ type: "siegeImpact", x: pr.tx, y: pr.ty, kind: pr.hit, radius: pr.radius });
    }
    return;
  }
  if (pr.kind === "stone") {
    pr.t += dt / pr.dur;
    const f = Math.min(1, pr.t);
    pr.x = pr.sx + (pr.tx - pr.sx) * f;
    pr.y = pr.sy + (pr.ty - pr.sy) * f;
    pr.z = Math.sin(f * Math.PI) * pr.arc;
    if (pr.t >= 1) {
      areaDamage(s, pr.tx, pr.ty, pr.radius, pr.dmg, "siege");
      if (pr.fire) s.zones.push({ id: s.nextId++, x: pr.tx, y: pr.ty, r: pr.fire.radius, t: pr.fire.dur, dps: pr.fire.dps, tick: 0 });
      s.events.push({ type: "stoneImpact", x: pr.tx, y: pr.ty, fire: !!pr.fire, radius: pr.radius });
      pr.done = true;
    }
    return;
  }
  if (pr.through) {
    /* a bolt that already hit its mark keeps flying straight */
    const step = pr.speed * dt;
    pr.x += pr.dx * step; pr.y += pr.dy * step;
    pr.left -= step;
    for (const e of s.enemies) {
      if (e.state === "dead" || pr.hits.has(e.id)) continue;
      if (dist2(e.x, e.y, pr.x, pr.y) < 18 * 18) {
        pr.hits.add(e.id);
        damageEnemy(s, e, pr.dmg, "pierce", { pierceArmour: pr.pierceArmour, from: pr.from });
        pr.pierce -= 1;
        if (pr.pierce < 0) { pr.done = true; return; }
      }
    }
    if (pr.left <= 0) pr.done = true;
    return;
  }
  if (pr.targetKind === "tower") {
    pr.t += dt / pr.dur;
    const f = Math.min(1, pr.t);
    pr.x = pr.sx + (pr.tx - pr.sx) * f; pr.y = pr.sy + (pr.ty - pr.sy) * f; pr.z = Math.sin(f * Math.PI) * pr.arc;
    pr.dx = pr.tx - pr.sx; pr.dy = pr.ty - pr.sy; const l = Math.hypot(pr.dx, pr.dy) || 1; pr.dx /= l; pr.dy /= l;
    if (pr.t >= 1) {
      pr.done = true;
      const t = s.towers[pr.plot];
      if (t) { t.burnT = Math.max(t.burnT || 0, pr.burn.dur); t.burnSlow = pr.burn.slow; s.events.push({ type: "towerBurn", plot: pr.plot, x: pr.tx, y: pr.ty + 46 }); }
      else s.events.push({ type: "miss", x: pr.tx, y: pr.ty + 46, kind: pr.kind });
    }
    return;
  }
  const tgt = pr.targetKind === "enemy" ? getEnemy(s, pr.targetId) : getUnit(s, pr.targetId);
  const tgtAlive = tgt && (pr.targetKind === "enemy" ? tgt.state !== "dead" : alive(tgt));
  if (tgtAlive) { pr.tx = tgt.x; pr.ty = tgt.y - (pr.targetKind === "enemy" ? 22 : 24); }
  else if (pr.tx == null) { pr.tx = pr.sx + 60; pr.ty = pr.sy + 30; }
  pr.t += dt / pr.dur;
  const f = Math.min(1, pr.t);
  pr.x = pr.sx + (pr.tx - pr.sx) * f;
  pr.y = pr.sy + (pr.ty - pr.sy) * f;
  pr.z = Math.sin(f * Math.PI) * pr.arc;
  pr.dx = pr.tx - pr.sx; pr.dy = pr.ty - pr.sy;
  const l = Math.hypot(pr.dx, pr.dy) || 1;
  pr.dx /= l; pr.dy /= l;
  if (pr.t >= 1) {
    pr.done = true;
    if (!tgtAlive) { s.events.push({ type: "miss", x: pr.tx, y: pr.ty, kind: pr.kind }); return; }
    if (pr.targetKind === "enemy") {
      if (pr.kind === "bolt") {
        pr.hits.add(tgt.id);
        damageEnemy(s, tgt, pr.dmg, "pierce", { pierceArmour: pr.pierceArmour, from: pr.from });
        if (pr.pierce > 0) { pr.done = false; pr.through = true; pr.left = 150; }
      } else {
        damageEnemy(s, tgt, pr.dmg, pr.dtype, { from: pr.from, pierceArmour: pr.pierceArmour });
      }
    } else {
      damageUnit(s, tgt, pr.dmg, pr.dtype, null);
    }
  }
}

function areaDamage(s, x, y, r, dmg, dtype) {
  let n = 0;
  for (const e of s.enemies) {
    if (e.state === "dead") continue;
    const d = dist2(e.x, e.y, x, y);
    if (d <= r * r) {
      const fall = 1 - 0.4 * Math.sqrt(d) / r;
      damageEnemy(s, e, dmg * fall, dtype);
      n += 1;
    }
  }
  return n;
}

/* ------------------------------------------------------------------ */
/*                          waves and the clock                        */
/* ------------------------------------------------------------------ */

function waveGroups(s, n) {
  if (s.mode === "endless") return endlessWave(n, s.rng, s.layout.routes.length, s.stage);
  return s.stage.waves[n - 1] || [];
}

export function nextWaveSummary(s) {
  if (s.wave >= s.totalWaves) return [];
  return waveSummary(waveGroups(s, s.wave + 1));
}

function beginWave(s) {
  s.wave += 1;
  const groups = waveGroups(s, s.wave);
  s.queue = expandWave(groups, s.rng);
  s.waveT = 0;
  s.waveState = "active";
  s.events.push({ type: "wave", n: s.wave, total: s.totalWaves, summary: waveSummary(groups) });
  for (const id of stagePowers(s)) {
    const w = powerWave(s, id);
    if (w && w === s.wave && !s.unlocks.includes(id)) { s.unlocks.push(id); s.events.push({ type: "unlock", id, name: POWERS[id].name }); }
  }
  if (s.stage.heroUpgradeWave && s.wave === s.stage.heroUpgradeWave && !s.unlocks.includes("kingsCharge")) { s.unlocks.push("kingsCharge"); s.events.push({ type: "unlock", id: "kingsCharge", name: HERO.kingsCharge.name, hero: true }); }
  if (s.mode !== "endless") {
    s.layout.routes.forEach((r, i) => {
      if (i > 0 && r.opensAt === s.wave) {
        /* the breach road opening means the sappers have brought the wall down */
        if (r.throughBreach && s.wallHp > 0) { damageWall(s, s.wallHp, "sappers", s.layout.outerWall.breach); s.events.push({ type: "routeOpen", route: i, breach: true }); return; }
        s.events.push({ type: "routeOpen", route: i, breach: !!r.throughBreach });
      }
    });
  }
  if (s.wave >= s.totalWaves) for (const e of s.enemies) if (e.boss && e.boss.phase === 1 && e.state !== "dead") { e.boss.phase = 2; s.bossPhase = 2; s.events.push({ type: "bossPhase", phase: 2, x: e.x, y: e.y }); }
}

export function callWave(s) {
  if (s.phase !== "playing" || s.waveState !== "countdown" || s.wave >= s.totalWaves || s.perkPending) return false;
  const bonus = s.wave === 0 ? 0 : Math.round(60 * mul(s, "earlyBonus") * (s.countdown / s.countdownMax));
  if (bonus > 0) {
    s.gold += bonus;
    s.stats.early += bonus;
    s.stats.score += bonus * 10;
    s.events.push({ type: "earlyBonus", amount: bonus });
  }
  beginWave(s);
  return true;
}

function stepWaves(s, dt) {
  if (s.waveState === "countdown") {
    if (s.wave >= s.totalWaves) return;
    if (s.perkPending) return;          // the clock waits while the player chooses a perk
    s.countdown -= dt;
    if (s.countdown <= 0) beginWave(s);
    return;
  }
  s.waveT += dt;
  while (s.queue.length && s.queue[0].t <= s.waveT) {
    const q = s.queue.shift();
    spawnEnemy(s, q.type, q.route, q.lat);
  }
  if (s.queue.length === 0 && !s.enemies.some((e) => e.state !== "dead" && !e.routed && !(e.def.persist && s.wave < s.totalWaves))) {
    const bonus = Math.round((40 + 10 * s.wave) * s.diff.gold);
    s.gold += bonus;
    s.stats.waveBonus += bonus;
    s.stats.score += 200 * s.wave;
    s.events.push({ type: "waveClear", n: s.wave, bonus });
    if (s.wave >= s.totalWaves) {
      s.phase = "victory";
      s.stars = starsFor(s);
      s.stats.score += Math.round((s.castleHp / s.castleMax) * 5000);
      s.events.push({ type: "victory", stars: s.stars });
      return;
    }
    s.waveState = "countdown";
    s.countdownMax = s.stage.countdown || 20;
    s.countdown = s.countdownMax;
    if (isPerkWave(s, s.wave)) offerPerks(s);
  }
}

/* ------------------------------ perks and powers ------------------------------ */

/* castle powers available on this stage, in HUD order */
export function stagePowers(s) {
  const extra = s.stage.powers ? Object.keys(s.stage.powers) : [];
  const base = ["watchfire", "royalRally"].filter((id) => !extra.includes(id));
  return base.concat(extra).sort((a, b) => (powerWave(s, a) || 0) - (powerWave(s, b) || 0));
}

/* the wave a power joins on for this stage, or null when it never does */
export function powerWave(s, id) {
  const def = POWERS[id];
  if (!def) return null;
  if (s.stage.powers && s.stage.powers[id] != null) return s.stage.powers[id];
  if (def.stageOnly) return null;
  return def.unlockWave || 0;
}

function isPerkWave(s, wave) {
  if (s.mode === "endless") return wave % 4 === 0;
  const list = s.stage.perkWaves || [];
  return list.includes(wave) && wave < s.totalWaves;
}

/* three distinct perks, weighted by rarity, gated by wave, never a repeat */
export function offerPerks(s) {
  const pool = PERKS.filter((p) => !s.perks.includes(p.id) && s.wave >= RARITY[p.rarity].minWave && (!p.minStage || (s.stage.number || 1) >= p.minStage));
  const offer = [];
  for (let n = 0; n < 3 && pool.length; n += 1) {
    const total = pool.reduce((a, p) => a + RARITY[p.rarity].weight, 0);
    let r = s.rng() * total;
    let pick = pool[pool.length - 1];
    for (const p of pool) { r -= RARITY[p.rarity].weight; if (r <= 0) { pick = p; break; } }
    offer.push(pick.id);
    pool.splice(pool.indexOf(pick), 1);
  }
  s.perkOffer = offer;
  s.perkPending = offer.length > 0;
  if (s.perkPending) s.events.push({ type: "perkOffer", wave: s.wave, offer: offer.slice() });
  return offer;
}

export function choosePerk(s, id) {
  if (!s.perkPending || !s.perkOffer || !s.perkOffer.includes(id)) return false;
  const perk = PERK_BY_ID[id];
  if (!perk) return false;
  applyMods(s, perk.mods);
  s.perks.push(id);
  s.perkOffer = null;
  s.perkPending = false;
  s.events.push({ type: "perk", id, name: perk.name, rarity: perk.rarity });
  return true;
}

export function skipPerk(s) {
  if (!s.perkPending) return false;
  s.perkOffer = null;
  s.perkPending = false;
  return true;
}

function applyMods(s, mods) {
  for (const [k, v] of Object.entries(mods)) {
    if (k === "castleBonus") { s.castleMax += v; s.castleHp = Math.min(s.castleMax, s.castleHp + v); continue; }
    if (k === "goldNow") { s.gold += v; continue; }
    s.mods[k] = (s.mods[k] || 0) + v;
  }
  /* squads already in the field grow with their new health modifiers */
  s.units.forEach((u) => {
    if (u.kind !== "soldier") return;
    const maxHp = Math.round(u.def.hp * mul(s, "soldierHp"));
    if (maxHp !== u.maxHp) { u.hp = Math.round(u.hp * maxHp / u.maxHp); u.maxHp = maxHp; }
  });
  const st = heroStatsFor(s, s.hero.level);
  if (st.maxHp !== s.hero.maxHp) { s.hero.hp = Math.round(s.hero.hp * st.maxHp / s.hero.maxHp); s.hero.maxHp = st.maxHp; }
}

export function powerUnlocked(s, id) {
  const w = powerWave(s, id);
  return w != null && s.wave >= w;
}

/* King's Charge: Sir Edric's Stage III upgrade, once unlocked */
export function kingsCharge(s) {
  return (s.unlocks || []).includes("kingsCharge");
}

export function castBurningOil(s) {
  if (s.phase !== "playing" || !powerUnlocked(s, "burningOil") || s.abilities.burningOil > 0) return false;
  const ab = POWERS.burningOil;
  s.abilities.burningOil = ab.cd * mul(s, "abilityCd");
  const g = s.layout.castle.gate;
  const hs = s.layout.heroSpawn;
  /* the oil lands on the road just outside the gate, toward the field */
  let dx = hs.x - g.x; let dy = hs.y - g.y; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
  const x = g.x + dx * 70; const y = g.y + dy * 70;
  const r = ab.radius * mul(s, "oilRadius");
  areaDamage(s, x, y, r, ab.dmg * mul(s, "oilDmg"), "fire");
  s.zones.push({ id: s.nextId++, x, y, r: r * 0.9, t: ab.dur, dps: ab.dps * mul(s, "oilDmg"), tick: 0, oil: true });
  s.events.push({ type: "oil", x, y, r });
  return true;
}

export function castEmergencyRepair(s) {
  if (s.phase !== "playing" || !powerUnlocked(s, "emergencyRepair") || s.abilities.emergencyRepair > 0) return false;
  const ab = POWERS.emergencyRepair;
  if (s.castleHp >= s.castleMax && !(s.wallHp != null && s.wallHp > 0 && s.wallHp < s.wallMax)) return false;
  s.abilities.emergencyRepair = ab.cd * mul(s, "abilityCd") * mul(s, "emergencyCd");
  s.castleHp = Math.min(s.castleMax, s.castleHp + ab.hp + add(s, "emergencyHp"));
  if (s.wallHp != null && s.wallHp > 0) s.wallHp = Math.min(s.wallMax, s.wallHp + ab.wall);
  s.lastRepair = s.t;
  s.events.push({ type: "emergencyRepair", x: s.layout.castle.gate.x, y: s.layout.castle.gate.y });
  return true;
}

export function castBarrage(s, x, y) {
  if (s.phase !== "playing" || !powerUnlocked(s, "catapultBarrage") || s.abilities.catapultBarrage > 0) return false;
  const ab = POWERS.catapultBarrage;
  s.abilities.catapultBarrage = ab.cd * mul(s, "abilityCd");
  for (let i = 0; i < ab.stones; i += 1) {
    const a = s.rng() * Math.PI * 2; const d = i === 0 ? 0 : s.rng() * ab.spread;
    s.strikes.push({ id: s.nextId++, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d * 0.6, r: ab.radius * mul(s, "catapultRadius"), dmg: ab.dmg * mul(s, "catapultDmg"), dtype: "siege", t: ab.delay + i * 0.65, kind: "barrage" });
  }
  s.events.push({ type: "barrage", x, y, r: ab.spread + ab.radius });
  return true;
}

/* formations: a standing order on the selected soldiers, or null to break it */
export function setFormation(s, ids, kind) {
  if (s.phase !== "playing" || !s.stage.formations) return false;
  const def = kind ? FORMATIONS[kind] : null;
  if (kind && !def) return false;
  let changed = false;
  for (const id of ids) {
    const u = getUnit(s, id);
    if (!u || u.kind !== "soldier" || !alive(u)) continue;
    if (def && def.needs === "spear" && !u.def.spear) continue;
    if (def && def.needs === "shield" && u.def.spear) continue;
    u.formation = kind || null;
    changed = true;
  }
  if (changed) { const u = getUnit(s, ids[0]); s.events.push({ type: "formation", kind, x: u ? u.x : 0, y: u ? u.y : 0 }); }
  return changed;
}

/* which formation the selection could take, if any */
export function formationFor(s, ids) {
  if (!s.stage.formations) return null;
  const units = ids.map((id) => getUnit(s, id)).filter((u) => u && u.kind === "soldier" && alive(u));
  if (!units.length) return null;
  const spears = units.filter((u) => u.def.spear).length;
  const kind = spears >= units.length / 2 ? "pikeWall" : "shieldWall";
  const on = units.every((u) => u.formation === kind);
  return { kind, on, ...FORMATIONS[kind] };
}

export function castWatchfire(s) {
  if (s.phase !== "playing" || !powerUnlocked(s, "watchfire") || s.abilities.watchfire > 0) return false;
  s.abilities.watchfire = POWERS.watchfire.cd * mul(s, "abilityCd");
  s.boostT = POWERS.watchfire.dur;
  s.events.push({ type: "watchfire", x: s.layout.castle.gate.x, y: s.layout.castle.gate.y });
  return true;
}

export function castRoyalRally(s) {
  if (s.phase !== "playing" || !powerUnlocked(s, "royalRally") || s.abilities.royalRally > 0) return false;
  s.abilities.royalRally = POWERS.royalRally.cd * mul(s, "abilityCd") * mul(s, "royalRallyCd");
  s.rallyT = POWERS.royalRally.dur;
  for (const u of s.units) if (alive(u)) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * POWERS.royalRally.heal);
  if (alive(s.hero)) s.hero.hp = Math.min(s.hero.maxHp, s.hero.hp + s.hero.maxHp * 0.25);
  s.events.push({ type: "royalRally", x: s.hero.x, y: s.hero.y });
  return true;
}

export function starsFor(s) {
  const r = s.castleHp / s.castleMax;
  if (r >= 0.9) return 3;
  if (r >= 0.5) return 2;
  return 1;
}

/* ------------------------------------------------------------------ */
/*                             main step                               */
/* ------------------------------------------------------------------ */

export function stepGame(s, dt) {
  if (s.phase !== "playing") return;
  s.t += dt;
  for (const k of Object.keys(s.abilities)) if (s.abilities[k] > 0) s.abilities[k] -= dt;
  if (s.boostT > 0) s.boostT -= dt;
  if (s.rallyT > 0) s.rallyT -= dt;

  stepWaves(s, dt);
  if (s.phase !== "playing") return;

  stepAuras(s, dt);
  for (const e of s.enemies) {
    if (e.attackT > 0) e.attackT -= dt;
    stepEnemy(s, e, dt);
  }
  for (const u of s.units) {
    if (u.attackT > 0) u.attackT -= dt;
    stepSoldier(s, u, dt);
  }
  if (s.hero.attackT > 0) s.hero.attackT -= dt;
  stepHero(s, s.hero, dt);
  s.towers.forEach((t, i) => { if (t) stepTower(s, i, t, dt); });
  for (const pr of s.projectiles) stepProjectile(s, pr, dt);

  for (const st of s.strikes) {
    st.t -= dt;
    if (st.t <= 0) {
      areaDamage(s, st.x, st.y, st.r, st.dmg, st.dtype);
      if (st.kind === "barrage") s.events.push({ type: "stoneImpact", x: st.x, y: st.y, fire: false, radius: st.r });
      else s.events.push({ type: "strike", x: st.x, y: st.y, r: st.r, kind: st.kind });
      st.done = true;
    }
  }
  for (const z of s.zones) {
    z.t -= dt;
    z.tick -= dt;
    if (z.tick <= 0) {
      z.tick = 0.25;
      areaDamage(s, z.x, z.y, z.r, z.dps * 0.25, "fire");
    }
  }

  if (s.phase !== "playing") return;
  s.enemies = s.enemies.filter((e) => !(e.state === "dead" && e.deadT <= 0));
  s.units = s.units.filter((u) => !u.remove);
  s.projectiles = s.projectiles.filter((p) => !p.done);
  s.strikes = s.strikes.filter((p) => !p.done);
  s.zones = s.zones.filter((z) => z.t > 0);
}

/* ------------------------------------------------------------------ */
/*                           player actions                            */
/* ------------------------------------------------------------------ */

export function plotAt(s, x, y, radius = PLOT_R) {
  let best = -1;
  let bd = radius * radius;
  s.layout.plots.forEach((p, i) => {
    const d = dist2(p.x, p.y, x, y);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

export function buildCost(s, type) { return Math.round(TOWERS[type].cost * mul(s, "towerCost")); }
export function upgradeCostFor(s, type, level) { const c = upgradeCost(type, level); return c == null ? null : Math.round(c * mul(s, "towerCost")); }

export function canBuild(s, plotIdx, type) {
  if (s.phase !== "playing") return false;
  if (s.towers[plotIdx]) return false;
  return s.gold >= buildCost(s, type);
}

export function buildTower(s, plotIdx, type) {
  if (!canBuild(s, plotIdx, type)) return false;
  s.gold -= buildCost(s, type);
  const t = makeTower(s, plotIdx, type);
  s.towers[plotIdx] = t;
  s.stats.built += 1;
  if (type === "barracks") {
    const lvl = towerLevel(type, 1);
    for (let i = 0; i < lvl.soldiers; i += 1) s.units.push(makeSoldier(s, plotIdx, i, lvl.unit));
  }
  const p = s.layout.plots[plotIdx];
  s.events.push({ type: "build", x: p.x, y: p.y, tower: type });
  return true;
}

export function canUpgrade(s, plotIdx) {
  const t = s.towers[plotIdx];
  if (!t || s.phase !== "playing") return false;
  const cost = upgradeCostFor(s, t.type, t.level);
  return cost != null && s.gold >= cost;
}

export function upgradeTower(s, plotIdx) {
  if (!canUpgrade(s, plotIdx)) return false;
  const t = s.towers[plotIdx];
  s.gold -= upgradeCostFor(s, t.type, t.level);
  t.level += 1;
  t.buildT = 0.7;
  s.stats.upgrades += 1;
  if (t.type === "barracks") {
    const lvl = towerLevel(t.type, t.level);
    const unit = t.pikes ? PIKE_UNITS[t.level - 1] : lvl.unit;
    s.units.forEach((u) => {
      if (u.tower !== plotIdx) return;
      u.unit = unit;
      u.def = SOLDIERS[unit];
      u.maxHp = Math.round(u.def.hp * mul(s, "soldierHp"));
      u.hp = u.maxHp;
    });
  }
  const p = s.layout.plots[plotIdx];
  s.events.push({ type: "upgrade", x: p.x, y: p.y, tower: t.type, level: t.level });
  return true;
}

export function sellValue(s, plotIdx) {
  const t = s.towers[plotIdx];
  return t ? Math.round(towerValue(t.type, t.level) * SELL_RATE) : 0;
}

export function sellTower(s, plotIdx) {
  const t = s.towers[plotIdx];
  if (!t || s.phase !== "playing") return false;
  s.gold += sellValue(s, plotIdx);
  s.towers[plotIdx] = null;
  s.units.forEach((u) => {
    if (u.tower === plotIdx) {
      u.remove = true;
      s.enemies.forEach((e) => { const i = e.blockers.indexOf(u.id); if (i >= 0) e.blockers.splice(i, 1); if (e.target === u.id) e.target = null; });
    }
  });
  s.units = s.units.filter((u) => !u.remove);
  const p = s.layout.plots[plotIdx];
  s.events.push({ type: "sell", x: p.x, y: p.y });
  return true;
}

export function setRally(s, plotIdx, x, y) {
  const t = s.towers[plotIdx];
  if (!t || t.type !== "barracks") return false;
  const p = s.layout.plots[plotIdx];
  const dx = x - p.x; const dy = y - p.y;
  const d = Math.hypot(dx, dy);
  const R = TOWERS.barracks.rallyRange;
  if (d > R) { x = p.x + (dx / d) * R; y = p.y + (dy / d) * R; }
  t.rally = { x, y };
  s.units.forEach((u) => { if (u.tower === plotIdx) { placeSoldierHome(s, u, t); u.order = null; u.hold = false; u.forceTarget = null; } });
  s.events.push({ type: "rally", x, y });
  return true;
}

/* Pike Drill: swap a barracks squad between swords and pikes. */
export function canDrill(s, plotIdx) {
  const t = s.towers[plotIdx];
  return !!(t && t.type === "barracks" && s.stage.pikes && s.phase === "playing");
}

export function setDrill(s, plotIdx, pikes) {
  if (!canDrill(s, plotIdx)) return false;
  const t = s.towers[plotIdx];
  if (!!t.pikes === !!pikes) return true;
  if (s.gold < DRILL_COST) return false;
  s.gold -= DRILL_COST;
  t.pikes = !!pikes;
  const unit = pikes ? PIKE_UNITS[t.level - 1] : towerLevel("barracks", t.level).unit;
  s.units.forEach((u) => {
    if (u.tower !== plotIdx) return;
    const ratio = u.maxHp ? u.hp / u.maxHp : 1;
    u.unit = unit;
    u.def = SOLDIERS[unit];
    u.maxHp = Math.round(u.def.hp * mul(s, "soldierHp"));
    u.hp = Math.max(1, Math.round(u.maxHp * ratio));
    u.bracing = false;
  });
  const p = s.layout.plots[plotIdx];
  s.events.push({ type: "drill", x: p.x, y: p.y, pikes: !!pikes });
  return true;
}

export function towerAbility(s, plotIdx) {
  const t = s.towers[plotIdx];
  if (!t) return null;
  const lvl = towerLevel(t.type, t.level);
  return lvl.ability || null;
}

export function fireTowerAbility(s, plotIdx, x, y) {
  const t = s.towers[plotIdx];
  if (!t || s.phase !== "playing") return false;
  const lvl = towerLevel(t.type, t.level);
  const ab = lvl.ability;
  if (!ab || t.abilityCd > 0) return false;
  const p = s.layout.plots[plotIdx];
  if (dist2(x, y, p.x, p.y) > (lvl.range * 1.15) ** 2) return false;
  t.abilityCd = ab.cd;
  if (ab.id === "arrowStorm") {
    for (let i = 0; i < ab.volleys; i += 1) {
      const a = s.rng() * Math.PI * 2;
      const r = Math.sqrt(s.rng()) * ab.radius * 0.8;
      s.strikes.push({ id: s.nextId++, x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, r: 30, dmg: ab.dmg, dtype: "arrow", t: 0.6 + i * 0.16, kind: "storm" });
    }
  } else if (ab.id === "skewer") {
    let best = null; let bd = 80 * 80;
    for (const e of s.enemies) { if (e.state === "dead") continue; const d = dist2(e.x, e.y, x, y); if (d < bd) { bd = d; best = e; } }
    if (!best) { t.abilityCd = 0; return false; }
    fireBolt(s, { x: p.x, y: p.y - 30 }, best, ab.dmg, { ...lvl, pierceCount: 2 }, { big: true });
  } else if (ab.id === "barrage") {
    for (let i = 0; i < ab.count; i += 1) {
      const a = s.rng() * Math.PI * 2;
      const r = i === 0 ? 0 : 30 + s.rng() * 30;
      fireStone(s, { x: p.x, y: p.y - 40 }, x + Math.cos(a) * r, y + Math.sin(a) * r, lvl.dmg[1], lvl, { delay: i * 0.25 });
    }
  }
  s.events.push({ type: "towerAbility", x, y, id: ab.id, plot: plotIdx });
  return true;
}

export function moveHero(s, x, y) {
  const h = s.hero;
  if (!alive(h) || h.charge || s.phase !== "playing") return false;
  h.moveTarget = { x: clamp(x, 20, s.layout.w - 20), y: clamp(y, 20, s.layout.h - 20) };
  h.target = null;
  s.events.push({ type: "heroMove", x, y });
  return true;
}

export function heroCharge(s, x, y) {
  const h = s.hero;
  if (!alive(h) || h.charge || h.chargeCd > 0 || s.phase !== "playing") return false;
  let dx = x - h.x; let dy = y - h.y;
  const l = Math.hypot(dx, dy);
  if (l < 8) return false;
  dx /= l; dy /= l;
  let dist = Math.min(kingsCharge(s) ? HERO.kingsCharge.dist : HERO.charge.dist, Math.max(80, l));
  /* never charge out of the world: shorten the run to the map edge */
  const W = s.layout.w; const Hh = s.layout.h; const m = 24;
  if (dx < 0) dist = Math.min(dist, (h.x - m) / -dx);
  if (dx > 0) dist = Math.min(dist, (W - m - h.x) / dx);
  if (dy < 0) dist = Math.min(dist, (h.y - m) / -dy);
  if (dy > 0) dist = Math.min(dist, (Hh - m - h.y) / dy);
  if (dist < 20) return false;
  h.charge = { dx, dy, left: dist, hits: new Set() };
  h.chargeCd = heroStatsFor(s, h.level).chargeCd;
  h.moveTarget = null; h.target = null;
  h.face = dx < 0 ? -1 : 1;
  s.events.push({ type: "charge", x: h.x, y: h.y, dx, dy });
  return true;
}

export function castVolley(s, x, y) {
  if (s.phase !== "playing" || s.abilities.volley > 0) return false;
  const ab = ABILITIES.volley;
  s.abilities.volley = ab.cd * mul(s, "abilityCd");
  s.strikes.push({ id: s.nextId++, x, y, r: ab.radius * mul(s, "volleyRadius"), dmg: ab.dmg * mul(s, "volleyDmg"), dtype: "arrow", t: ab.delay, kind: "volley" });
  s.events.push({ type: "volley", x, y });
  return true;
}

export function castReinforce(s, x, y) {
  if (s.phase !== "playing" || s.abilities.reinforce > 0) return false;
  const ab = ABILITIES.reinforce;
  s.abilities.reinforce = ab.cd * mul(s, "abilityCd");
  const n = ab.count + add(s, "reinforceCount");
  for (let i = 0; i < n; i += 1) { const off = SOLDIER_OFFSETS[i % SOLDIER_OFFSETS.length]; s.units.push(makeLevy(s, x + off[0], y + off[1], i)); }
  s.events.push({ type: "reinforce", x, y });
  return true;
}

export function repairCost(s) { return Math.max(10, Math.round(ABILITIES.repair.cost * mul(s, "repairCost"))); }

export function repairCastle(s) {
  const ab = ABILITIES.repair;
  if (s.phase !== "playing" || s.gold < repairCost(s) || s.castleHp >= s.castleMax) return false;
  s.gold -= repairCost(s);
  s.castleHp = Math.min(s.castleMax, s.castleHp + ab.hp);
  s.events.push({ type: "repair", amount: ab.hp });
  return true;
}

/* ------------------------------------------------------------------ */
/*                           soldier orders                            */
/* ------------------------------------------------------------------ */

/* nearest living soldier or levy to a world point (the hero is his own) */
export function unitAt(s, x, y, radius = 26) {
  let best = null;
  let bd = radius * radius;
  for (const u of s.units) {
    if (!alive(u)) continue;
    const d = dist2(u.x, u.y - 18, x, y);
    if (d < bd) { bd = d; best = u; }
  }
  return best;
}

export function squadOf(s, plotIdx) {
  return s.units.filter((u) => u.tower === plotIdx && u.state !== "respawn").map((u) => u.id);
}

/* True when the selection is exactly one whole barracks squad (two or
   more soldiers), so the HUD and renderer can show it differently. */
export function isFullSquad(s, ids) {
  if (!ids || ids.length < 2) return false;
  const first = getUnit(s, ids[0]);
  if (!first || first.tower == null || first.tower < 0) return false;
  const sq = squadOf(s, first.tower);
  return sq.length >= 2 && sq.length === ids.length && sq.every((id) => ids.includes(id));
}

/* order: { kind: "move"|"hold"|"attack"|"gate"|"tower"|"rally", x, y, enemyId, plot } */
export function orderUnits(s, ids, order) {
  if (s.phase !== "playing" || !ids || !ids.length) return false;
  const units = ids.map((id) => getUnit(s, id)).filter((u) => u && u.kind !== "hero" && alive(u));
  if (!units.length) return false;
  const spread = (x, y) => units.map((u, i) => { const off = SOLDIER_OFFSETS[i % SOLDIER_OFFSETS.length]; return { u, x: x + off[0], y: y + off[1] }; });
  const clampX = (x) => clamp(x, 20, s.layout.w - 20);
  const clampY = (y) => clamp(y, 20, s.layout.h - 20);
  let ev;
  switch (order.kind) {
    case "move": {
      for (const p of spread(order.x, order.y)) { p.u.home = { x: clampX(p.x), y: clampY(p.y) }; p.u.order = { kind: "move" }; p.u.hold = false; p.u.forceTarget = null; p.u.target = null; }
      ev = { type: "order", kind: "move", x: order.x, y: order.y };
      break;
    }
    case "hold": {
      for (const u of units) { u.home = { x: u.x, y: u.y }; u.order = { kind: "hold" }; u.hold = true; u.forceTarget = null; }
      ev = { type: "order", kind: "hold", x: units[0].x, y: units[0].y };
      break;
    }
    case "attack": {
      const e = getEnemy(s, order.enemyId);
      if (!e || e.state === "dead") return false;
      for (const u of units) { u.forceTarget = e.id; u.order = { kind: "attack" }; u.hold = false; }
      ev = { type: "order", kind: "attack", x: e.x, y: e.y };
      break;
    }
    case "gate": {
      const g = s.layout.heroSpawn;
      for (const p of spread(g.x - 30, g.y + 10)) { p.u.home = { x: clampX(p.x), y: clampY(p.y) }; p.u.order = { kind: "gate" }; p.u.hold = false; p.u.forceTarget = null; p.u.target = null; }
      ev = { type: "order", kind: "gate", x: g.x, y: g.y };
      break;
    }
    case "tower": {
      if (order.plot == null || order.plot < 0) return false;
      const r = defaultRally(s, order.plot);
      for (const p of spread(r.x, r.y)) { p.u.home = { x: clampX(p.x), y: clampY(p.y) }; p.u.order = { kind: "tower", plot: order.plot }; p.u.hold = false; p.u.forceTarget = null; p.u.target = null; }
      ev = { type: "order", kind: "tower", x: r.x, y: r.y };
      break;
    }
    case "rally": {
      for (const u of units) {
        const t = s.towers[u.tower];
        if (u.kind === "soldier" && t) placeSoldierHome(s, u, t);
        u.order = null; u.hold = false; u.forceTarget = null; u.target = null;
      }
      ev = { type: "order", kind: "rally", x: units[0].home.x, y: units[0].home.y };
      break;
    }
    default: return false;
  }
  if (ev) s.events.push(ev);
  return true;
}

/* the ability every selected unit shares, or null */
export function sharedAbility(s, ids) {
  const units = ids.map((id) => getUnit(s, id)).filter((u) => u && alive(u));
  if (!units.length) return null;
  const ab = units[0].def.ability;
  if (!ab || !units.every((u) => u.def.ability && u.def.ability.id === ab.id)) return null;
  const ready = units.some((u) => u.abilityCd <= 0);
  return { ...ab, ready, cd: Math.max(...units.map((u) => u.abilityCd)) };
}

export function triggerUnitAbility(s, ids) {
  if (s.phase !== "playing") return false;
  let used = false;
  for (const id of ids) {
    const u = getUnit(s, id);
    if (!u || !alive(u) || !u.def.ability || u.abilityCd > 0) continue;
    u.abilityCd = u.def.ability.cd;
    u.abilityT = u.def.ability.dur;
    used = true;
    s.events.push({ type: "unitAbility", id: u.def.ability.id, x: u.x, y: u.y });
  }
  return used;
}

/* ------------------------------------------------------------------ */
/*                              summary                                */
/* ------------------------------------------------------------------ */

export function summarise(s) {
  return {
    stageId: s.stage.id,
    mode: s.mode,
    difficulty: s.difficulty,
    won: s.phase === "victory",
    finished: s.phase === "victory" || s.phase === "defeat",
    finale: !!s.stage.finale, kingdom: s.stage.kingdom || "ashford", perks: (s.perks || []).slice(),
    wave: s.wave,
    totalWaves: s.totalWaves === Infinity ? null : s.totalWaves,
    castleHp: s.castleHp,
    castleMax: s.castleMax,
    stars: s.phase === "victory" ? s.stars : 0,
    score: s.stats.score,
    kills: s.stats.kills,
    gold: s.gold,
    heroLevel: s.hero.level,
    time: s.t,
    early: s.stats.early,
  };
}

/* ------------------------------------------------------------------ */
/*                        save and restore a battle                     */
/* ------------------------------------------------------------------ */

export const BATTLE_FORMAT = 2;

/* A compact, plain-JSON picture of a battle in progress. Transient
   things (projectiles, particles, strikes) are dropped; everything that
   matters to the player — wave, gold, castle, towers, squads, hero,
   living enemies, perks — is kept. */
export function serializeGame(s) {
  const unitOf = (u) => ({
    kind: u.kind, unit: u.unit, tower: u.tower, slot: u.slot, hp: Math.round(u.hp * 10) / 10, maxHp: u.maxHp,
    x: Math.round(u.x), y: Math.round(u.y), home: u.home ? { x: Math.round(u.home.x), y: Math.round(u.home.y) } : null,
    state: u.state === "dead" || u.state === "respawn" ? u.state : "idle", respawnT: u.respawnT || 0, deadT: u.deadT || 0,
    life: u.life, face: u.face, order: u.order || null, hold: !!u.hold, abilityCd: u.abilityCd || 0, formation: u.formation || null,
  });
  return {
    v: BATTLE_FORMAT,
    stageId: s.stage.id, layout: s.layout.name, difficulty: s.difficulty, mode: s.mode,
    seed: ((s.seed * 31 + Math.floor(s.t * 977)) | 0) || 1,
    t: s.t, gold: s.gold, castleHp: s.castleHp, castleMax: s.castleMax,
    wave: s.wave, waveState: s.waveState, countdown: s.countdown, countdownMax: s.countdownMax, waveT: s.waveT,
    queue: s.queue.map((q) => ({ ...q })),
    stats: { ...s.stats }, abilities: { ...s.abilities }, nextId: s.nextId,
    towers: s.towers.map((t) => (t ? { type: t.type, level: t.level, cd: t.cd, abilityCd: t.abilityCd, rally: t.rally ? { ...t.rally } : null, pikes: !!t.pikes, shooter: t.shooter || 0, angle: t.angle || 0, burnT: t.burnT || 0 } : null)),
    wallHp: s.wallHp, wallMax: s.wallMax, bossPhase: s.bossPhase || 0, gateWarned: !!s.gateWarned,
    units: s.units.filter((u) => !u.remove).map(unitOf),
    hero: { level: s.hero.level, xp: s.hero.xp, hp: Math.round(s.hero.hp), maxHp: s.hero.maxHp, x: Math.round(s.hero.x), y: Math.round(s.hero.y), post: { ...s.hero.post }, state: s.hero.state === "dead" || s.hero.state === "respawn" ? s.hero.state : "idle", respawnT: s.hero.respawnT || 0, deadT: s.hero.deadT || 0, chargeCd: Math.max(0, s.hero.chargeCd || 0) },
    enemies: s.enemies.filter((e) => e.state !== "dead").map((e) => ({
      type: e.type, route: e.route, d: Math.round(e.d * 10) / 10, lat: e.lat, hp: Math.round(e.hp), maxHp: e.maxHp, chargeCd: Math.max(0, e.chargeCd || 0), stun: e.stun || 0,
      stopped: !!e.stopped, reload: e.reload || 0, shots: e.shots || 0, docked: !!e.docked, unloaded: e.unloaded || 0, unloadT: e.unloadT || 0, wallHit: !!e.wallHit,
      boss: e.boss ? { phase: e.boss.phase, sweepCd: e.boss.sweepCd, hornCd: e.boss.hornCd, raged: !!e.boss.raged, atGate: !!e.atGate, openT: e.boss.openT || 0, roarT: e.boss.roarT || 0 } : null,
      routed: !!e.routed,
    })),
    zones: s.zones.map((z) => ({ x: z.x, y: z.y, r: z.r, t: z.t, dps: z.dps })),
    perks: (s.perks || []).slice(), mods: { ...(s.mods || {}) }, perkOffer: s.perkOffer ? s.perkOffer.slice() : null, perkPending: !!s.perkPending, unlocks: (s.unlocks || []).slice(),
  };
}

/* Rebuilds a playing game from serializeGame() output. Throws on a
   format it does not understand; callers treat that as "no save". */
export function restoreGame(data, opts = {}) {
  if (!data || data.v !== BATTLE_FORMAT) throw new Error("unsupported battle format");
  const s = makeGame({ stageId: data.stageId, layout: opts.layout || data.layout, difficulty: data.difficulty, mode: data.mode, seed: data.seed || 1 });
  s.phase = "playing";
  s.t = data.t || 0; s.gold = data.gold; s.castleHp = data.castleHp; s.castleMax = data.castleMax || s.castleMax;
  s.wave = data.wave; s.waveState = data.waveState; s.countdown = data.countdown; s.countdownMax = data.countdownMax; s.waveT = data.waveT || 0;
  s.queue = (data.queue || []).map((q) => ({ ...q }));
  s.stats = { ...s.stats, ...(data.stats || {}) };
  s.abilities = { ...s.abilities, ...(data.abilities || {}) };
  s.perks = (data.perks || []).slice(); s.mods = { ...(data.mods || {}) };
  s.perkOffer = data.perkOffer ? data.perkOffer.slice() : null; s.perkPending = !!data.perkPending; s.unlocks = (data.unlocks || []).slice();
  /* towers */
  (data.towers || []).forEach((t, i) => {
    if (!t || i >= s.towers.length) return;
    const tower = makeTower(s, i, t.type);
    tower.level = t.level; tower.cd = t.cd || 0; tower.abilityCd = t.abilityCd || 0; tower.buildT = 0;
    tower.pikes = !!t.pikes; tower.shooter = t.shooter || 0; tower.angle = t.angle || tower.angle; tower.burnT = t.burnT || 0;
    if (t.type === "barracks") tower.rally = t.rally && s.layout.name === data.layout ? { ...t.rally } : defaultRally(s, i);
    s.towers[i] = tower;
  });
  /* squads and levies */
  const sameLayout = s.layout.name === data.layout;
  for (const u of data.units || []) {
    if (!SOLDIERS[u.unit]) continue;
    let unit;
    if (u.kind === "levy") unit = makeLevy(s, u.x, u.y, u.slot || 0);
    else {
      if (!s.towers[u.tower] || s.towers[u.tower].type !== "barracks") continue;
      unit = makeSoldier(s, u.tower, u.slot || 0, u.unit);
    }
    unit.hp = Math.min(u.hp, unit.maxHp); unit.respawnT = u.respawnT || 0; unit.deadT = u.deadT || 0; unit.face = u.face || 1;
    if (u.life != null) unit.life = u.life;
    unit.order = u.order || null; unit.hold = !!u.hold; unit.abilityCd = u.abilityCd || 0; unit.formation = u.formation && FORMATIONS[u.formation] ? u.formation : null;
    if (sameLayout) { unit.x = u.x; unit.y = u.y; if (u.home) unit.home = { ...u.home }; }
    else { unit.x = unit.home.x; unit.y = unit.home.y; unit.order = null; unit.hold = false; }
    unit.state = u.state === "dead" || u.state === "respawn" ? u.state : "idle";
    if (unit.state === "dead" && unit.deadT <= 0) unit.state = "respawn";
    s.units.push(unit);
  }
  /* the hero */
  const h = s.hero; const hd = data.hero || {};
  h.level = hd.level || 1; h.xp = hd.xp || 0;
  const st = heroStats(h.level); h.maxHp = st.maxHp; h.hp = Math.min(h.maxHp, hd.hp ?? h.maxHp);
  h.chargeCd = hd.chargeCd || 0; h.respawnT = hd.respawnT || 0; h.deadT = hd.deadT || 0;
  h.state = hd.state === "dead" || hd.state === "respawn" ? hd.state : "idle";
  if (sameLayout && hd.post) { h.x = hd.x; h.y = hd.y; h.post = { ...hd.post }; }
  /* living enemies keep their road distance, so any layout works */
  for (const e of data.enemies || []) {
    if (!ENEMIES[e.type]) continue;
    const en = spawnEnemy(s, e.type, e.route || 0, e.lat || 0);
    en.d = e.d; en.hp = Math.min(e.hp, en.maxHp); en.chargeCd = e.chargeCd || 0; en.stun = e.stun || 0;
    en.stopped = !!e.stopped; en.reload = e.reload || en.reload; en.shots = e.shots || 0; en.docked = !!e.docked; en.unloaded = e.unloaded || 0; en.unloadT = e.unloadT || 0; en.wallHit = !!e.wallHit;
    if (en.boss && e.boss) { en.boss.phase = e.boss.phase || 1; en.boss.sweepCd = e.boss.sweepCd || 0; en.boss.hornCd = e.boss.hornCd || 0; en.boss.raged = !!e.boss.raged; en.atGate = !!e.boss.atGate; en.boss.openT = e.boss.openT || 0; en.boss.roarT = e.boss.roarT || 0; }
    en.routed = !!e.routed;
    syncEnemyPos(s, en);
  }
  if (data.wallHp != null && s.wallHp != null) { s.wallHp = data.wallHp; s.wallMax = data.wallMax || s.wallMax; if (s.wallHp <= 0) s.layout.routes.forEach((r) => { if (r.throughBreach && r.opensAt > s.wave) r.opensAt = Math.max(1, s.wave); }); }
  s.bossPhase = data.bossPhase || (s.enemies.find((e) => e.boss)?.boss.phase ?? 0);
  s.gateWarned = !!data.gateWarned;
  s.events = [];
  s.zones = (data.zones || []).map((z) => ({ id: s.nextId++, x: z.x, y: z.y, r: z.r, t: z.t, dps: z.dps, tick: 0 }));
  s.nextId = Math.max(s.nextId, data.nextId || 0);
  return s;
}
