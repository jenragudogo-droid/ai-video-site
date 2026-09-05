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
  SOLDIERS, HERO, heroStats, ABILITIES, DIFFICULTY,
} from "../data/towers.js";
import { stageById } from "../data/stages.js";

export { towerLevel, upgradeCost, towerValue, waveSummary, SELL_RATE, MAX_LEVEL };

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
  const routes = raw.routes.map((r, i) => {
    const route = buildRoute(r.points);
    route.opensAt = stage.routeOpens && stage.routeOpens[0] === i ? stage.routeOpens[1] : 1;
    return route;
  });
  return { name, ...raw, routes };
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

export function makeGame({ stageId = "greenhollow", layout = "landscape", difficulty = "normal", mode = "campaign", seed = 1 } = {}) {
  const stage = stageById(stageId);
  const s = {
    seed,
    rng: mulberry(seed),
    stage,
    mode,
    difficulty,
    diff: DIFFICULTY[difficulty] || DIFFICULTY.normal,
    layout: resolveLayout(stage, layout),
    phase: "ready",             // ready | playing | victory | defeat
    t: 0,
    gold: stage.startGold,
    castleHp: stage.castleHp,
    castleMax: stage.castleHp,
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
    abilities: { volley: 0, reinforce: 0 },
    stats: { kills: 0, score: 0, early: 0, built: 0, upgrades: 0, gateHits: 0, damageTaken: 0, heroKills: 0, waveBonus: 0 },
    events: [],
    nextId: 1,
    stars: 0,
    lastGateHit: 0,
  };
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
  const st = heroStats(1);
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
  const u = {
    id: s.nextId++, kind: "soldier", unit: unitType, def, tower: towerIdx, slot,
    hp: def.hp, maxHp: def.hp, x: p.x, y: p.y + 20, home: null,
    target: null, state: "walk", atkCd: 0, respawnT: 0, face: 1, animT: s.rng() * 3, hitT: 0, deadT: 0,
  };
  placeSoldierHome(s, u, tower);
  return u;
}

function makeLevy(s, x, y, slot) {
  const def = SOLDIERS.reinforcement;
  return {
    id: s.nextId++, kind: "levy", unit: "reinforcement", def, tower: -1, slot,
    hp: def.hp, maxHp: def.hp, x, y, home: { x, y }, life: def.life,
    target: null, state: "idle", atkCd: 0, respawnT: 0, face: 1, animT: s.rng() * 3, hitT: 0, deadT: 0,
  };
}

const alive = (u) => u && u.state !== "dead" && u.state !== "respawn";
const getEnemy = (s, id) => (id == null ? null : s.enemies.find((e) => e.id === id) || null);
const getUnit = (s, id) => (id == null ? null : (s.hero.id === id ? s.hero : s.units.find((u) => u.id === id)) || null);

function unitDmg(s, u) {
  if (u.kind === "hero") { const st = heroStats(u.level); return st.dmg[0] + s.rng() * (st.dmg[1] - st.dmg[0]); }
  return u.def.dmg[0] + s.rng() * (u.def.dmg[1] - u.def.dmg[0]);
}

function unitArmour(s, u) {
  if (u.kind === "hero") return heroStats(u.level).armour;
  let a = u.def.armour;
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
  const a = amount * (1 - armour);
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
    u.respawnT = tower ? TOWERS.barracks.respawn : 0;
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
    x: 0, y: 0, tx: 1, ty: 0, face: 1, state: "walk",
    blockers: [], blockT: 0, freeT: 0, target: null, atkCd: 0.6 + s.rng() * 0.4,
    stun: 0, hitT: 0, deadT: 0, animT: s.rng() * 3, sway: s.rng() * Math.PI * 2,
    bounty: Math.round(def.bounty * s.diff.gold),
  };
  syncEnemyPos(s, e);
  s.enemies.push(e);
  s.events.push({ type: "spawn", x: e.x, y: e.y, enemy: type, route });
  if (def.boss === "mini") s.events.push({ type: "miniboss", x: e.x, y: e.y, enemy: type, id: e.id });
  return e;
}

function syncEnemyPos(s, e) {
  const route = s.layout.routes[e.route] || s.layout.routes[0];
  const p = sampleRoute(route, e.d);
  e.x = p.x + p.nx * e.lat;
  e.y = p.y + p.ny * e.lat;
  e.tx = p.tx; e.ty = p.ty;
  if (Math.abs(p.tx) > 0.25) e.face = p.tx < 0 ? -1 : 1;
  e.progress = e.d / route.length;
}

function damageEnemy(s, e, amount, dtype, opts = {}) {
  if (e.state === "dead") return 0;
  let armour = e.def.armour;
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
  s.gold += e.bounty;
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
}

function gainXp(s, xp) {
  const h = s.hero;
  if (h.level >= HERO.maxLevel) return;
  h.xp += xp;
  while (h.level < HERO.maxLevel && h.xp >= HERO.xpLevels[h.level]) {
    h.level += 1;
    const st = heroStats(h.level);
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

  if (def.kind === "siege") {
    /* nothing stops a ram; soldiers chase it instead */
    e.state = "walk";
    e.d += def.speed * dt;
    syncEnemyPos(s, e);
    if (e.d >= route.length) reachGate(s, e);
    return;
  }

  if (engaged && def.kind !== "ranged") {
    e.state = "fight";
    e.target = blocker.id;
    e.face = blocker.x < e.x ? -1 : 1;
    if (def.kind === "cavalry") {
      e.blockT += dt;
      if (e.blockT > def.blockTime) {
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
  e.d += def.speed * dt;
  syncEnemyPos(s, e);
  if (e.d >= route.length) reachGate(s, e);
}

function reachGate(s, e) {
  const dmg = e.def.gateDmg;
  s.castleHp = Math.max(0, s.castleHp - dmg);
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
    if (e.state === "dead") continue;
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
  const speed = u.kind === "hero" ? HERO.speed : u.def.speed;
  const atk = u.kind === "hero" ? HERO.atk : u.def.atk;

  let e = getEnemy(s, u.target);
  if (e && (e.state === "dead" || e.freeT > 0)) { u.target = null; e = null; }
  if (e && dist2(e.x, e.y, opts.cx, opts.cy) > (opts.radius + 90) ** 2) {
    /* enemy pulled us too far from post: let go */
    const i = e.blockers.indexOf(u.id);
    if (i >= 0) e.blockers.splice(i, 1);
    u.target = null; e = null;
  }
  if (!e) {
    e = findEngagement(s, u, opts.cx, opts.cy, opts.radius);
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
        damageEnemy(s, e, unitDmg(s, u), "blade", { src: u });
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
  const radius = u.kind === "levy" ? 90 : TOWERS.barracks.rallyRange;
  const busy = stepFighter(s, u, dt, { cx: u.home.x, cy: u.home.y, radius });
  if (busy) return;
  const arrived = dist2(u.x, u.y, u.home.x, u.home.y) < 9;
  if (!arrived) { u.state = "walk"; moveToward(u, u.home.x, u.home.y, u.def.speed, dt); }
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
    const st = heroStats(h.level);
    for (const e of s.enemies) {
      if (e.state === "dead" || c.hits.has(e.id)) continue;
      if (dist2(e.x, e.y, h.x, h.y) < (HERO.charge.width) ** 2) {
        c.hits.add(e.id);
        damageEnemy(s, e, st.chargeDmg, "charge", { src: h });
        if (e.state !== "dead") {
          e.stun = HERO.charge.stun;
          e.d = Math.max(0, e.d - HERO.charge.kb);
          e.blockers = [];
          syncEnemyPos(s, e);
        }
        s.events.push({ type: "chargeHit", x: e.x, y: e.y });
      }
    }
    if (c.left <= 0) {
      h.charge = null;
      h.post = { x: h.x, y: h.y };
      h.moveTarget = null;
      h.state = "idle";
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

function towerTarget(s, plotIdx, lvl) {
  const p = s.layout.plots[plotIdx];
  let best = null;
  let bp = -1;
  const r2 = lvl.range * lvl.range;
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
  if (t.type === "barracks") return;
  const lvl = towerLevel(t.type, t.level);
  t.cd -= dt;
  let e = getEnemy(s, t.target);
  if (!e || e.state === "dead" || dist2(e.x, e.y, p.x, p.y) > lvl.range * lvl.range) { e = towerTarget(s, i, lvl); t.target = e ? e.id : null; }
  if (e) {
    const want = Math.atan2(e.y - p.y, e.x - p.x);
    let diff = want - t.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    t.angle += diff * Math.min(1, dt * 8);
  }
  if (t.cd > 0 || !e) return;
  t.cd = lvl.rate;
  t.fireT = 0.35;
  const dmg = lvl.dmg[0] + s.rng() * (lvl.dmg[1] - lvl.dmg[0]);
  if (t.type === "archer") {
    t.shooter = (t.shooter + 1) % lvl.shooters;
    const from = { x: p.x + (lvl.shooters > 1 ? (t.shooter ? 12 : -12) : 0), y: p.y - (t.level >= 3 ? 74 : 52) };
    fireArrow(s, from, e, dmg, "arrow");
    s.events.push({ type: "arrow", x: from.x, y: from.y });
  } else if (t.type === "ballista") {
    const from = { x: p.x + Math.cos(t.angle) * 18, y: p.y - 30 + Math.sin(t.angle) * 10 };
    fireBolt(s, from, e, dmg, lvl);
    s.events.push({ type: "bolt", x: from.x, y: from.y });
  } else if (t.type === "catapult") {
    const dur = Math.max(0.7, Math.hypot(e.x - p.x, e.y - p.y) / STONE_SPEED);
    const land = predictLanding(s, e, dur);
    fireStone(s, { x: p.x, y: p.y - 40 }, land.x, land.y, dmg, lvl);
    s.events.push({ type: "catapult", x: p.x, y: p.y });
  }
}

/* ------------------------------------------------------------------ */
/*                            projectiles                              */
/* ------------------------------------------------------------------ */

function stepProjectile(s, pr, dt) {
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
        damageEnemy(s, tgt, pr.dmg, pr.dtype, { from: pr.from });
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
  if (s.mode === "endless") return endlessWave(n, s.rng, s.layout.routes.length);
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
  if (s.stage.routeOpens && s.wave === s.stage.routeOpens[1] && s.mode !== "endless") {
    s.events.push({ type: "routeOpen", route: s.stage.routeOpens[0] });
  }
}

export function callWave(s) {
  if (s.phase !== "playing" || s.waveState !== "countdown" || s.wave >= s.totalWaves) return false;
  const bonus = s.wave === 0 ? 0 : Math.round(60 * (s.countdown / s.countdownMax));
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
    s.countdown -= dt;
    if (s.countdown <= 0) beginWave(s);
    return;
  }
  s.waveT += dt;
  while (s.queue.length && s.queue[0].t <= s.waveT) {
    const q = s.queue.shift();
    spawnEnemy(s, q.type, q.route, q.lat);
  }
  if (s.queue.length === 0 && !s.enemies.some((e) => e.state !== "dead")) {
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
  }
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
  if (s.abilities.volley > 0) s.abilities.volley -= dt;
  if (s.abilities.reinforce > 0) s.abilities.reinforce -= dt;

  stepWaves(s, dt);
  if (s.phase !== "playing") return;

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
      s.events.push({ type: "strike", x: st.x, y: st.y, r: st.r, kind: st.kind });
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

export function canBuild(s, plotIdx, type) {
  if (s.phase !== "playing") return false;
  if (s.towers[plotIdx]) return false;
  return s.gold >= TOWERS[type].cost;
}

export function buildTower(s, plotIdx, type) {
  if (!canBuild(s, plotIdx, type)) return false;
  s.gold -= TOWERS[type].cost;
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
  const cost = upgradeCost(t.type, t.level);
  return cost != null && s.gold >= cost;
}

export function upgradeTower(s, plotIdx) {
  if (!canUpgrade(s, plotIdx)) return false;
  const t = s.towers[plotIdx];
  s.gold -= upgradeCost(t.type, t.level);
  t.level += 1;
  t.buildT = 0.7;
  s.stats.upgrades += 1;
  if (t.type === "barracks") {
    const lvl = towerLevel(t.type, t.level);
    s.units.forEach((u) => {
      if (u.tower !== plotIdx) return;
      u.unit = lvl.unit;
      u.def = SOLDIERS[lvl.unit];
      u.maxHp = u.def.hp;
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
  s.units.forEach((u) => { if (u.tower === plotIdx) placeSoldierHome(s, u, t); });
  s.events.push({ type: "rally", x, y });
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
  let dist = Math.min(HERO.charge.dist, Math.max(80, l));
  /* never charge out of the world: shorten the run to the map edge */
  const W = s.layout.w; const Hh = s.layout.h; const m = 24;
  if (dx < 0) dist = Math.min(dist, (h.x - m) / -dx);
  if (dx > 0) dist = Math.min(dist, (W - m - h.x) / dx);
  if (dy < 0) dist = Math.min(dist, (h.y - m) / -dy);
  if (dy > 0) dist = Math.min(dist, (Hh - m - h.y) / dy);
  if (dist < 20) return false;
  h.charge = { dx, dy, left: dist, hits: new Set() };
  h.chargeCd = heroStats(h.level).chargeCd;
  h.moveTarget = null; h.target = null;
  h.face = dx < 0 ? -1 : 1;
  s.events.push({ type: "charge", x: h.x, y: h.y, dx, dy });
  return true;
}

export function castVolley(s, x, y) {
  if (s.phase !== "playing" || s.abilities.volley > 0) return false;
  const ab = ABILITIES.volley;
  s.abilities.volley = ab.cd;
  s.strikes.push({ id: s.nextId++, x, y, r: ab.radius, dmg: ab.dmg, dtype: "arrow", t: ab.delay, kind: "volley" });
  s.events.push({ type: "volley", x, y });
  return true;
}

export function castReinforce(s, x, y) {
  if (s.phase !== "playing" || s.abilities.reinforce > 0) return false;
  const ab = ABILITIES.reinforce;
  s.abilities.reinforce = ab.cd;
  for (let i = 0; i < ab.count; i += 1) s.units.push(makeLevy(s, x + (i ? 18 : -18), y + (i ? 6 : -6), i));
  s.events.push({ type: "reinforce", x, y });
  return true;
}

export function repairCastle(s) {
  const ab = ABILITIES.repair;
  if (s.phase !== "playing" || s.gold < ab.cost || s.castleHp >= s.castleMax) return false;
  s.gold -= ab.cost;
  s.castleHp = Math.min(s.castleMax, s.castleHp + ab.hp);
  s.events.push({ type: "repair", amount: ab.hp });
  return true;
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
