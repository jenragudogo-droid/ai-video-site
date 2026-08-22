/* ------------------------------------------------------------------ *
 * Power-ups: three slots, single use, and the combo system. Combos are
 * looked up by the sorted set of the combined slots; unknown mixes are
 * refused (nothing is consumed). Effects live on racer.fx as timers.
 * ------------------------------------------------------------------ */
import { POWERUPS, comboFor, FUSABLE } from "./data.js";

export function freshFx() {
  return {
    boostTime: 0, boostMul: 1, shield: 0, ghost: 0, invinc: 0, magnet: 0,
    magnetMul: 1, frozen: 0, slow: 0, smoke: 0, slowFieldT: 0, jumpMul: 1,
    empShieldT: 0, iceGround: 0, boostShield: false,
  };
}

const WEIGHTS = [
  ["turbo", 14], ["shield", 12], ["rocket", 13], ["oil", 8], ["mine", 8],
  ["freeze", 7], ["emp", 6], ["shockwave", 6], ["smoke", 5], ["ghost", 6],
  ["magnet", 8], ["jump", 6], ["repair", 5], ["slowField", 4], ["teleport", 4],
  ["tripleRocket", 3], ["superTurbo", 3], ["invinc", 2],
];
const SPACE_EXTRA = [["spaceBoost", 8], ["gravityPulse", 6], ["orbitalShield", 6]];

export function randomPowerup(rng, isSpace, behind) {
  const pool = isSpace ? [...WEIGHTS, ...SPACE_EXTRA] : WEIGHTS;
  /* trailing racers roll slightly luckier boxes */
  const lucky = behind ? 1.6 : 1;
  let total = 0;
  const rows = pool.map(([id, w]) => {
    const wt = POWERUPS[id].rare ? w * lucky : w;
    total += wt;
    return [id, wt];
  });
  let roll = rng() * total;
  for (const [id, w] of rows) { roll -= w; if (roll <= 0) return id; }
  return "turbo";
}

/* ------------- using single slots ------------- */
export function activateSlot(race, r, slotIdx) {
  const id = r.slots[slotIdx];
  if (!id) return false;
  r.slots[slotIdx] = null;
  applyItem(race, r, id, 1);
  race.events.push({ t: "use", who: r.id, item: id });
  return true;
}

/* ------------- combos ------------- */
export function tryCombo(race, r, slotIdxs) {
  const ids = slotIdxs.map((i) => r.slots[i]).filter(Boolean);
  if (ids.length < 2) return { ok: false };
  let combo = comboFor(ids);
  let name;
  if (combo) {
    name = combo.name;
  } else if (ids.length === 3 && new Set(ids).size === 3 && ids.every((i) => FUSABLE.has(i))) {
    combo = { effect: "tripleFusion", name: "TRIPLE FUSION", ids };
    name = combo.name;
  } else {
    if (r.isPlayer) race.events.push({ t: "comboFail", who: r.id });
    return { ok: false };
  }
  for (const i of slotIdxs) r.slots[i] = null;
  applyCombo(race, r, combo, ids);
  race.events.push({ t: "combo", who: r.id, name, super: ids.length === 3 });
  r.combosDone = (r.combosDone || 0) + 1;
  if (ids.length === 3) r.superCombosDone = (r.superCombosDone || 0) + 1;
  return { ok: true, name };
}

function fireRocket(race, r, opts = {}) {
  race.projectiles.push({
    kind: opts.kind || "rocket", owner: r.id,
    x: r.body.x, y: r.body.y + 1, z: r.body.z,
    ang: r.body.heading, speed: (opts.speed || 62) + r.body.speed * 0.4,
    turn: opts.turn ?? 2.2, t: 6, power: opts.power || 1,
    freeze: opts.freeze, emp: opts.emp, grav: opts.grav, delay: opts.delay || 0,
  });
}
function dropTrap(race, r, kind, opts = {}) {
  const back = 3.5 + (opts.back || 0);
  race.traps.push({
    kind, owner: r.id, t: opts.life || 18,
    x: r.body.x - Math.sin(r.body.heading) * back,
    y: r.body.y, z: r.body.z - Math.cos(r.body.heading) * back,
    r: opts.r || 2.2, armed: 0.6,
  });
}

export function applyItem(race, r, id, mul = 1) {
  const fx = r.fx;
  switch (id) {
    case "turbo": fx.boostTime = Math.max(fx.boostTime, 1.9 * mul * (r.driver?.ability?.id === "hotStart" ? 1.25 : 1)); fx.boostMul = Math.max(fx.boostMul, 1); break;
    case "superTurbo": fx.boostTime = Math.max(fx.boostTime, 2.6 * mul); fx.boostMul = Math.max(fx.boostMul, 1.12); break;
    case "spaceBoost": fx.boostTime = Math.max(fx.boostTime, 2.4 * mul); fx.boostMul = Math.max(fx.boostMul, 1.1); break;
    case "shield": fx.shield += 1 * mul; break;
    case "orbitalShield": fx.shield += 2; break;
    case "rocket": fireRocket(race, r); break;
    case "tripleRocket": for (let i = 0; i < 3; i++) fireRocket(race, r, { delay: i * 0.28 }); break;
    case "freeze": fireRocket(race, r, { kind: "ice", freeze: true, speed: 55 }); break;
    case "emp": zapNearby(race, r, 26, (v) => { v.fx.slow = Math.max(v.fx.slow, 2.2); }); race.events.push({ t: "emp", who: r.id }); break;
    case "shockwave": zapNearby(race, r, 20, (v) => hitRacer(race, v, "shock", r)); race.events.push({ t: "shock", who: r.id }); break;
    case "gravityPulse": pullAhead(race, r, 60); race.events.push({ t: "grav", who: r.id }); break;
    case "oil": dropTrap(race, r, "oil", { r: 3, life: 20 }); break;
    case "mine": dropTrap(race, r, "mine", { r: 2, life: 30 }); break;
    case "smoke": dropTrap(race, r, "smoke", { r: 4, life: 12 }); break;
    case "ghost": fx.ghost = Math.max(fx.ghost, 3.2 * mul); break;
    case "invinc": fx.invinc = Math.max(fx.invinc, 4 * mul); fx.shield += 1; break;
    case "magnet": fx.magnet = Math.max(fx.magnet, 5 * mul); fx.magnetMul = 1; break;
    case "jump": r.body.airborne = true; r.body.vy = 10.5; r.body.airTime = 0; break;
    case "repair": r.damage = 0; r.spinT = 0; r.fx.frozen = 0; break;
    case "slowField": fx.slowFieldT = Math.max(fx.slowFieldT, 4 * mul); break;
    case "teleport": teleportDash(race, r, 40 * mul); break;
    default: break;
  }
}

function applyCombo(race, r, combo, ids) {
  const fx = r.fx;
  switch (combo.effect) {
    case "shieldedTurbo": fx.boostTime = 2.6; fx.shield += 1; fx.boostShield = true; break;
    case "turboRocket": fireRocket(race, r, { speed: 85, power: 1.5, turn: 2.6 }); fx.boostTime = Math.max(fx.boostTime, 1.2); break;
    case "doubleRocket": fireRocket(race, r); fireRocket(race, r, { delay: 0.3 }); break;
    case "rocketBarrage": for (let i = 0; i < 5; i++) fireRocket(race, r, { delay: i * 0.22 }); break;
    case "electricShield": fx.shield += 1; fx.empShieldT = 5; break;
    case "iceRocket": fireRocket(race, r, { kind: "ice", freeze: true, turn: 3, speed: 70 }); break;
    case "iceTrap": dropTrap(race, r, "ice", { r: 4.5, life: 20 }); break;
    case "rocketJump": r.body.airborne = true; r.body.vy = 12; fx.boostTime = 2.2; break;
    case "phantomBoost": fx.ghost = 3.5; fx.boostTime = 2.4; break;
    case "magnetRush": fx.magnet = 6; fx.magnetMul = 2.4; fx.boostTime = 2; break;
    case "strongShield": fx.shield = Math.max(fx.shield, 3); break;
    case "empRocket": fireRocket(race, r, { emp: true, turn: 2.6 }); break;
    case "stickyMinefield": dropTrap(race, r, "oil", { r: 4, life: 20 }); for (let i = 0; i < 3; i++) dropTrap(race, r, "mine", { back: i * 2.4, life: 25 }); break;
    case "blindingSlick": dropTrap(race, r, "oil", { r: 3.5, life: 18 }); dropTrap(race, r, "smoke", { r: 4.5, life: 14 }); break;
    case "quakeLeap": r.body.airborne = true; r.body.vy = 11; r.quakeOnLand = true; break;
    case "frostNova": zapNearby(race, r, 24, (v) => { v.fx.frozen = Math.max(v.fx.frozen, 2.2); }); race.events.push({ t: "frost", who: r.id }); break;
    case "warpStrike": teleportDash(race, r, 55); fx.boostTime = 2; break;
    case "timeBubble": fx.slowFieldT = 5; fx.shield += 1; break;
    case "gravitonMissile": fireRocket(race, r, { grav: true, turn: 2.8 }); break;
    case "overdrive": fx.boostTime = 3.4; fx.boostMul = 1.2; break;
    case "fortress": r.damage = 0; r.spinT = 0; fx.shield = Math.max(fx.shield, 3); break;
    case "cometMode": fx.invinc = 5; fx.boostTime = 3; fx.shield += 1; break;
    case "magnoMissile": fireRocket(race, r, { turn: 6, power: 1.2 }); break;
    case "ionAegis": fx.boostTime = 2.6; fx.shield += 2; break;
    case "twinTurbo": fx.boostTime = 3.6; break;
    case "juggernaut": fx.boostTime = 2.8; fx.shield += 2; fireRocket(race, r, { speed: 80, power: 1.4 }); break;
    case "winterMinefield": dropTrap(race, r, "ice", { r: 5, life: 22 }); for (let i = 0; i < 3; i++) dropTrap(race, r, "mine", { back: i * 2.6, life: 25 }); break;
    case "spectreHarvest": fx.ghost = 4; fx.boostTime = 2.6; fx.magnet = 6; fx.magnetMul = 2.6; break;
    case "tripleFusion": for (const id of ids) applyItem(race, r, id, 1.5); break;
    default: for (const id of ids) applyItem(race, r, id, 1); break;
  }
}

function zapNearby(race, r, radius, fn) {
  for (const v of race.racers) {
    if (v === r || v.finished) continue;
    const d = Math.hypot(v.body.x - r.body.x, v.body.z - r.body.z);
    if (d < radius) fn(v);
  }
}
function pullAhead(race, r, radius) {
  for (const v of race.racers) {
    if (v === r || v.finished) continue;
    const gap = progressGap(race, v, r);
    if (gap > 0 && gap < radius) {
      v.body.speed *= 0.45;
      v.fx.slow = Math.max(v.fx.slow, 1.4);
    }
  }
}
function teleportDash(race, r, dist) {
  const b = r.body;
  const track = race.track;
  const onSc = b.route >= 0;
  const samples = onSc ? track.shortcuts[b.route].samples : track.samples;
  const n = samples.length;
  const jumpSamples = Math.round(dist / 4);
  let target = onSc ? Math.min(n - 2, b.routeSeg + jumpSamples) : (b.seg + jumpSamples) % n;
  const s = samples[target];
  /* lap bookkeeping: teleporting across the start line must not skip the lap */
  if (!onSc && target < b.seg && b.seg - target > n / 2) b.lapCross = true;
  b.x = s.x; b.y = s.y + 0.2; b.z = s.z;
  b.heading = s.ang; b.velAng = s.ang;
  if (onSc) b.routeSeg = target; else b.seg = target;
  race.events.push({ t: "teleport", who: r.id });
}

export function progressGap(race, a, b) {
  /* how far a is ahead of b, metres along the lap (can be negative) */
  const L = race.track.length;
  const pa = a.body.lap * L + a.body.sProg;
  const pb = b.body.lap * L + b.body.sProg;
  return pa - pb;
}

/* A hit lands on a racer (rocket, mine, shock...). Returns true if it stuck. */
export function hitRacer(race, r, kind, from) {
  const fx = r.fx;
  if (fx.invinc > 0 || fx.ghost > 0) return false;
  if (fx.shield > 0) {
    fx.shield -= 1;
    if (fx.empShieldT > 0 && from && from !== r) {
      from.fx.slow = Math.max(from.fx.slow, 1.6);
    }
    race.events.push({ t: "shieldBreak", who: r.id });
    return false;
  }
  r.damage = (r.damage || 0) + 1;
  const dur = 0.6 + (1 - r.st.dura) * 0.9;
  r.spinT = kind === "shock" ? dur * 0.7 : dur;
  r.spinDir = Math.random() > 0.5 ? 1 : -1;
  r.body.speed *= kind === "mine" ? 0.3 : 0.4;
  if (kind === "ice") r.fx.frozen = Math.max(r.fx.frozen, 2);
  r.timesHit = (r.timesHit || 0) + 1;
  if (from && from.isPlayer && race.mode === "powerBattle") race.battleHits = (race.battleHits || 0) + 1;
  race.events.push({ t: "hit", who: r.id, kind });
  return true;
}

/* Per-frame updates: projectiles, traps, timed effects. */
export function updatePowerups(race, dt) {
  const { projectiles, traps, racers } = race;

  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    if (p.delay > 0) { p.delay -= dt; continue; }
    p.t -= dt;
    if (p.t <= 0) { projectiles.splice(i, 1); continue; }
    /* home on the nearest racer ahead of the owner */
    const owner = racers.find((r) => r.id === p.owner);
    let target = null, bestGap = Infinity;
    if (owner) {
      for (const v of racers) {
        if (v === owner || v.finished || v.fx.ghost > 0) continue;
        const gap = progressGap(race, v, owner);
        if (gap > -6 && gap < 240 && gap < bestGap) { bestGap = gap; target = v; }
      }
    }
    if (target) {
      const want = Math.atan2(target.body.x - p.x, target.body.z - p.z);
      let d = want - p.ang;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      p.ang += Math.max(-p.turn * dt, Math.min(p.turn * dt, d));
      p.y += ((target.body.y + 1) - p.y) * Math.min(1, 3 * dt);
    }
    p.x += Math.sin(p.ang) * p.speed * dt;
    p.z += Math.cos(p.ang) * p.speed * dt;
    /* collision with racers */
    for (const v of racers) {
      if (v.id === p.owner || v.finished) continue;
      const d = Math.hypot(v.body.x - p.x, v.body.z - p.z);
      if (d < 2.4 && Math.abs(v.body.y + 1 - p.y) < 2.5) {
        if (p.freeze) { if (v.fx.invinc <= 0 && v.fx.shield <= 0) { v.fx.frozen = Math.max(v.fx.frozen, 2.2); v.body.speed *= 0.5; race.events.push({ t: "frozenHit", who: v.id }); } else hitRacer(race, v, "rocket", racers.find((r) => r.id === p.owner)); }
        else if (p.emp) { v.fx.slow = Math.max(v.fx.slow, 2.5); v.fx.boostTime = 0; race.events.push({ t: "empHit", who: v.id }); }
        else if (p.grav) { hitRacer(race, v, "rocket", racers.find((r) => r.id === p.owner)); v.body.speed = -6; }
        else hitRacer(race, v, "rocket", racers.find((r) => r.id === p.owner));
        projectiles.splice(i, 1);
        break;
      }
    }
  }

  for (let i = traps.length - 1; i >= 0; i--) {
    const tr = traps[i];
    tr.t -= dt;
    tr.armed = Math.max(0, tr.armed - dt);
    if (tr.t <= 0) { traps.splice(i, 1); continue; }
    for (const v of racers) {
      if (v.finished || (tr.armed > 0 && v.id === tr.owner)) continue;
      const d = Math.hypot(v.body.x - tr.x, v.body.z - tr.z);
      if (d < tr.r + 1 && Math.abs(v.body.y - tr.y) < 2) {
        if (tr.kind === "oil") {
          if (v.fx.invinc <= 0) { v.oilT = 1.2; v.body.velAng += (Math.random() - 0.5) * 0.5; v.body.speed *= 0.99; }
        } else if (tr.kind === "ice") {
          if (v.fx.invinc <= 0) { v.fx.iceGround = 0.9; }
        } else if (tr.kind === "smoke") {
          v.smokeT = 1.4;
        } else if (tr.kind === "mine") {
          const owner = racers.find((r) => r.id === tr.owner);
          hitRacer(race, v, "mine", owner);
          traps.splice(i, 1);
          race.events.push({ t: "mineBoom", x: tr.x, z: tr.z });
          break;
        }
      }
    }
  }

  /* timers + auras */
  for (const r of racers) {
    const fx = r.fx;
    for (const k of ["boostTime", "ghost", "invinc", "magnet", "frozen", "slow", "slowFieldT", "empShieldT", "iceGround"]) {
      if (fx[k] > 0) fx[k] = Math.max(0, fx[k] - dt);
    }
    if (fx.boostTime <= 0) { fx.boostMul = 1; fx.boostShield = false; }
    if (r.spinT > 0) r.spinT = Math.max(0, r.spinT - dt);
    if (r.oilT > 0) r.oilT = Math.max(0, r.oilT - dt);
    if (r.smokeT > 0) r.smokeT = Math.max(0, r.smokeT - dt);
    /* quake leap landing */
    if (r.quakeOnLand && !r.body.airborne) {
      r.quakeOnLand = false;
      zapNearby(race, r, 22, (v) => { if (v !== r) hitRacer(race, v, "shock", r); });
      race.events.push({ t: "shock", who: r.id });
    }
    /* slow field aura */
    if (fx.slowFieldT > 0) {
      zapNearby(race, r, 18, (v) => { if (v !== r) v.fx.slow = Math.max(v.fx.slow, 0.25); });
    }
  }
}
