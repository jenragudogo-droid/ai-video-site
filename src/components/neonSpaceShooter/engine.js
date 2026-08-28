/* ------------------------------------------------------------------ *
 * Neon Space Shooter — the simulation.
 *
 * Pure logic: no DOM, no canvas, no audio. The renderer reads this
 * state and the React shell drains `s.events` for sound and effects,
 * which is what lets scripted gameplay tests run directly under node.
 * Coordinates are logical pixels: the playfield is always VIEW_H tall
 * and the width follows the canvas aspect, so one phone sees a
 * narrower corridor than a desktop but everything moves at the same
 * speed on both.
 * ------------------------------------------------------------------ */

export const VIEW_H = 800;
export const MIN_W = 340;
/* A classic vertical shooter wants a corridor, not a cinema screen: on
   wide desktops the field is capped and letterboxed, or one ship could
   never cover the front. */
export const MAX_W = 720;

export const SHIP_R = 15;          // forgiving hitbox, smaller than the art
export const SHIP_Y = VIEW_H - 96;
const SHIP_SPEED = 430;            // keyboard px/s
const SHIP_FOLLOW = 26;            // touch-drag catch-up rate

export const MAX_WEAPON = 5;
export const MAX_HEARTS = 3;

/* One place for every balance number that changes per enemy type.
   `score` is the base value before the combo multiplier. */
export const ENEMY = {
  basic:   { hp: 1,  r: 17, score: 10,  crystal: 0.22 },
  fast:    { hp: 1,  r: 13, score: 20,  crystal: 0.26 },
  zigzag:  { hp: 2,  r: 16, score: 30,  crystal: 0.3 },
  shooter: { hp: 3,  r: 18, score: 40,  crystal: 0.38 },
  heavy:   { hp: 7,  r: 26, score: 50,  crystal: 1 },
  elite:   { hp: 9,  r: 21, score: 100, crystal: 1 },
  mini:    { hp: 34, r: 34, score: 300, crystal: 1 },
  boss:    { hp: 90, r: 52, score: 1000, crystal: 1 },
};

export const POWER_KINDS = ["upgrade", "double", "triple", "rapid", "shield", "beam", "missiles", "magnet"];
export const POWER_TIME = { double: 12, triple: 12, rapid: 8, beam: 6, missiles: 12, magnet: 12 };
export const POWER_LABEL = {
  upgrade: "WEAPON UP", double: "DOUBLE LASER", triple: "TRIPLE LASER", rapid: "RAPID FIRE",
  shield: "SHIELD", beam: "LASER BEAM", missiles: "MISSILES", magnet: "MAGNET",
};

const COMBO_WINDOW = 3.5;
export const COMBO_LABELS = [
  [20, "UNSTOPPABLE!"],
  [12, "AWESOME!"],
  [8, "GREAT!"],
];

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

export function makeGame({ seed = 1 } = {}) {
  const s = {
    seed,
    rng: mulberry(seed),
    phase: "ready",              // ready | playing | over
    t: 0,
    W: 480,
    H: VIEW_H,

    input: { left: false, right: false },

    ship: { x: 240, y: SHIP_Y, vx: 0, targetX: null, fireCd: 0, tilt: 0 },
    hearts: MAX_HEARTS,
    inv: 0,                      // seconds of post-hit protection
    shield: false,
    weapon: 1,

    power: { double: 0, triple: 0, rapid: 0, beam: 0, missiles: 0, magnet: 0 },
    missileCd: 0,

    shots: [],
    enemyShots: [],
    enemies: [],
    crystals: [],
    drops: [],
    missiles: [],

    score: 0,
    combo: 0,
    comboTimer: 0,
    bestCombo: 0,
    kills: 0,
    crystalRun: 0,

    wave: 0,
    waveState: "announce",       // announce | active | warning | boss | bossdown
    waveTimer: 0,
    queue: [],                   // pending spawns for the active wave
    spawnT: 0,
    gaveFirstChip: false,

    boss: null,
    shake: 0,
    events: [],
  };
  return s;
}

export function setViewport(s, w, h) {
  const aspect = h > 0 ? w / h : 0.6;
  s.W = Math.round(Math.min(MAX_W, Math.max(MIN_W, VIEW_H * aspect)));
  s.ship.x = Math.min(Math.max(s.ship.x, SHIP_R + 8), s.W - SHIP_R - 8);
}

export function resetGame(s) {
  const fresh = makeGame({ seed: (s.rng() * 0x7fffffff) | 0 });
  fresh.W = s.W;
  fresh.ship.x = s.W / 2;
  Object.assign(s, fresh);
}

export function startRun(s) {
  s.phase = "playing";
  s.wave = 1;
  s.waveState = "announce";
  s.waveTimer = 1.4;
  s.ship.x = s.W / 2;
  emit(s, "wave", 1);
}

export function drainEvents(s) {
  const out = s.events;
  s.events = [];
  return out;
}

export function summarise(s) {
  return { score: Math.round(s.score), crystals: s.crystalRun, wave: s.wave, bestCombo: s.bestCombo, kills: s.kills };
}

function emit(s, type, a, x, y) { s.events.push({ type, a, x, y }); }

/* Touch drag: the shell feeds finger movement in as a target, and the
   ship chases it fast enough to feel 1:1 without teleporting. */
export function dragShip(s, dx) {
  const base = s.ship.targetX == null ? s.ship.x : s.ship.targetX;
  s.ship.targetX = Math.min(Math.max(base + dx, SHIP_R + 8), s.W - SHIP_R - 8);
}
export function releaseDrag(s) { s.ship.targetX = null; }

/* ------------------------------- waves ------------------------------- */

const isBossWave = (w) => w % 5 === 0;
const hasMini = (w) => w % 5 === 3 && w > 3;

/* Every wave is described the same way: a list of spawns with delays.
   Difficulty comes from count, mix, speed and hp all creeping up. */
function buildWave(s, w) {
  const q = [];
  const rng = s.rng;
  const n = Math.min(6 + w * 2, 26);
  const types = ["basic"];
  if (w >= 2) types.push("fast");
  if (w >= 3) types.push("zigzag");
  if (w >= 4) types.push("shooter", "heavy");
  let t = 0.5;
  for (let i = 0; i < n; i += 1) {
    /* Later entries in a wave lean towards the nastier types. */
    const bias = Math.min(types.length, 1 + ((i / n) * types.length + rng() * 2) | 0);
    const type = types[Math.min(types.length - 1, Math.max(0, bias - 1))];
    q.push({ at: t, type, x: 0.08 + rng() * 0.84 });
    t += Math.max(0.28, 1.15 - w * 0.06) * (0.6 + rng() * 0.8);
  }
  if (w >= 6) {
    const elites = Math.min(1 + ((w - 6) / 4 | 0), 3);
    for (let i = 0; i < elites; i += 1) q.push({ at: 1.5 + i * 4, type: "elite", x: 0.2 + rng() * 0.6 });
  }
  if (hasMini(w)) q.push({ at: 2.5, type: "mini", x: 0.5 });
  q.sort((a, b) => a.at - b.at);
  return q;
}

function speedScale(w) { return 1 + Math.min(w * 0.05, 0.9); }
function hpBonus(w) { return (w / 3) | 0; }

function spawnEnemy(s, type, fx) {
  const def = ENEMY[type];
  const w = s.wave;
  const e = {
    type,
    x: fx * s.W,
    y: -40,
    baseX: fx * s.W,
    vy: 0,
    vx: 0,
    t: 0,
    r: def.r,
    hp: def.hp + (type === "basic" || type === "fast" ? Math.min(hpBonus(w), 1) : hpBonus(w)),
    fireCd: 1.2 + s.rng() * 1.6,
    dir: s.rng() < 0.5 ? -1 : 1,
    seed: s.rng() * Math.PI * 2,
  };
  e.maxHp = e.hp;
  const k = speedScale(w);
  switch (type) {
    case "basic": e.vy = 78 * k; break;
    case "fast": e.vy = 132 * k; break;
    case "zigzag": e.vy = 88 * k; e.vx = 112 * k * e.dir; break;
    case "shooter": e.vy = 56 * k; break;
    case "heavy": e.vy = 44 * k; break;
    case "elite": e.vy = 90; e.homeY = 90 + s.rng() * 70; break;
    case "mini": e.vy = 70; e.homeY = 120; e.hp = e.maxHp = 34 + w * 4; break;
    default: break;
  }
  s.enemies.push(e);
  return e;
}

function spawnBoss(s) {
  const w = s.wave;
  const b = {
    type: "boss",
    x: s.W / 2, y: -140,
    r: ENEMY.boss.r,
    hp: 150 + w * 18,
    t: 0,
    state: "enter",             // enter | idle | attack
    stateT: 0,
    pattern: -1,
    patT: 0,
    shotsLeft: 0,
    beamX: 0, beamDir: 1, beamOn: false,
    seed: s.rng() * 7,
  };
  b.maxHp = b.hp;
  s.boss = b;
  s.waveState = "boss";
}

/* ------------------------------ shooting ------------------------------ */

function fireCooldown(s) {
  const base = [0, 0.32, 0.24, 0.24, 0.24, 0.2][s.weapon];
  return s.power.rapid > 0 ? base * 0.45 : base;
}

function firePlayer(s) {
  const x = s.ship.x, y = s.ship.y - 26;
  const dmg = s.weapon >= 5 ? 2 : 1;
  const v = 760;
  let lanes = 1;
  if (s.weapon >= 3) lanes = 2;
  if (s.weapon >= 4) lanes = 3;
  if (s.power.double > 0) lanes = Math.max(lanes, 2);
  if (s.power.triple > 0) lanes = Math.max(lanes, 3);
  const heavy = s.weapon >= 5;
  if (lanes === 1) {
    s.shots.push({ x, y, vx: 0, vy: -v, dmg, heavy });
  } else if (lanes === 2) {
    s.shots.push({ x: x - 11, y, vx: 0, vy: -v, dmg, heavy });
    s.shots.push({ x: x + 11, y, vx: 0, vy: -v, dmg, heavy });
  } else {
    s.shots.push({ x, y, vx: 0, vy: -v, dmg, heavy });
    s.shots.push({ x: x - 13, y: y + 6, vx: -128, vy: -v, dmg, heavy });
    s.shots.push({ x: x + 13, y: y + 6, vx: 128, vy: -v, dmg, heavy });
  }
  emit(s, "shoot");
}

function enemyFire(s, x, y, tx, ty, speed) {
  const dx = tx - x, dy = ty - y;
  const d = Math.hypot(dx, dy) || 1;
  s.enemyShots.push({ x, y, vx: (dx / d) * speed, vy: (dy / d) * speed });
}

const enemyShotSpeed = (s) => Math.min(170 + s.wave * 7, 275);

/* -------------------------------- drops -------------------------------- */

function dropCrystal(s, x, y, n = 1) {
  for (let i = 0; i < n; i += 1) {
    s.crystals.push({
      x: x + (s.rng() - 0.5) * 30 * (n > 1 ? 1.6 : 0.4),
      y: y + (s.rng() - 0.5) * 18,
      vx: (s.rng() - 0.5) * 40,
      vy: 55 + s.rng() * 35,
      t: s.rng() * 7,
    });
  }
}

function pickPowerKind(s) {
  /* The weapon chip carries the level system, so it stays common until
     the weapon is maxed and then stops appearing at all. */
  const pool = [];
  if (s.weapon < MAX_WEAPON) pool.push("upgrade", "upgrade", "upgrade");
  pool.push("double", "triple", "rapid", "beam", "missiles", "magnet");
  if (!s.shield) pool.push("shield", "shield");
  return pool[(s.rng() * pool.length) | 0];
}

function dropPower(s, x, y, kind) {
  s.drops.push({ x, y, vy: 72, kind: kind || pickPowerKind(s), t: s.rng() * 7 });
}

function collectPower(s, kind) {
  if (kind === "upgrade") {
    if (s.weapon < MAX_WEAPON) {
      s.weapon += 1;
      emit(s, "upgrade", s.weapon);
    } else {
      s.score += 150;
      emit(s, "power", "upgrade");
    }
    return;
  }
  if (kind === "shield") { s.shield = true; emit(s, "power", "shield"); return; }
  s.power[kind] = POWER_TIME[kind];
  emit(s, "power", kind);
}

/* ------------------------------- damage ------------------------------- */

function multiplier(s) { return 1 + 0.1 * Math.min(s.combo, 20); }

function killEnemy(s, e, quiet) {
  s.kills += 1;
  s.combo += 1;
  s.comboTimer = COMBO_WINDOW;
  if (s.combo > s.bestCombo) s.bestCombo = s.combo;
  s.score += Math.round(ENEMY[e.type].score * multiplier(s));
  if (s.combo >= 2) {
    let label = `COMBO x${s.combo}`;
    for (const [at, name] of COMBO_LABELS) if (s.combo >= at) { label = name; break; }
    emit(s, "combo", label);
  }
  const big = e.type === "heavy" || e.type === "elite" || e.type === "mini";
  emit(s, "explode", { kind: e.type, big }, e.x, e.y);
  if (!quiet) {
    const c = ENEMY[e.type].crystal;
    if (s.rng() < c) dropCrystal(s, e.x, e.y, big ? 3 + ((s.rng() * 3) | 0) : 1);
    if (e.type === "mini") dropPower(s, e.x, e.y);
    else if (s.rng() < 0.085) dropPower(s, e.x, e.y);
  }
  if (big) s.shake = Math.min(s.shake + 5, 9);
}

function hurtPlayer(s, why) {
  if (s.inv > 0 || s.phase !== "playing") return;
  if (s.shield) {
    s.shield = false;
    s.inv = 1.2;
    emit(s, "shieldBreak");
    return;
  }
  s.hearts -= 1;
  s.inv = 2.2;
  s.combo = 0;
  s.comboTimer = 0;
  s.shake = Math.min(s.shake + 8, 12);
  emit(s, "hit", why, s.ship.x, s.ship.y);
  if (s.hearts <= 0) {
    s.phase = "over";
    emit(s, "explode", { kind: "player", big: true }, s.ship.x, s.ship.y);
    emit(s, "gameover");
  }
}

/* --------------------------------- boss --------------------------------- */

const BOSS_PATTERNS = ["spread", "barrage", "beam", "wave"];

function stepBoss(s, dt) {
  const b = s.boss;
  b.t += dt;
  b.stateT += dt;
  const sp = enemyShotSpeed(s);

  if (b.state === "enter") {
    b.y += (110 - b.y) * Math.min(1, dt * 1.6);
    if (b.y > 106) { b.state = "idle"; b.stateT = 0; }
  } else {
    /* A slow strafe keeps the fight moving without ever cornering the
       player: the boss body never comes below y ≈ 170. */
    b.x = s.W / 2 + Math.sin(b.t * 0.55 + b.seed) * (s.W * 0.5 - b.r - 24);
    b.y = 110 + Math.sin(b.t * 1.3) * 10;
  }

  if (b.state === "idle" && b.stateT > 1.7) {
    b.state = "attack";
    b.stateT = 0;
    b.patT = 0;
    b.pattern = (b.pattern + 1) % BOSS_PATTERNS.length;
    b.shotsLeft = { spread: 3, barrage: 9, beam: 0, wave: 12 }[BOSS_PATTERNS[b.pattern]];
    if (BOSS_PATTERNS[b.pattern] === "beam") {
      b.beamDir = s.ship.x > b.x ? 1 : -1;
      b.beamX = b.x;
      b.beamOn = false;
      emit(s, "beamWarn");
    }
    if (BOSS_PATTERNS[b.pattern] === "wave") b.gapX = 0.15 + s.rng() * 0.7;
  }

  if (b.state !== "attack") return;
  const pat = BOSS_PATTERNS[b.pattern];
  b.patT += dt;

  if (pat === "spread") {
    /* three aimed fans, half a second apart */
    if (b.shotsLeft > 0 && b.patT > 0.55 * (4 - b.shotsLeft)) {
      b.shotsLeft -= 1;
      for (let i = -2; i <= 2; i += 1) {
        const dx = s.ship.x - b.x, dy = s.ship.y - b.y;
        const ang = Math.atan2(dy, dx) + i * 0.17;
        s.enemyShots.push({ x: b.x, y: b.y + 30, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp });
      }
      emit(s, "bossShot");
    }
    if (b.shotsLeft === 0 && b.patT > 2.2) { b.state = "idle"; b.stateT = 0; }
  } else if (pat === "barrage") {
    if (b.shotsLeft > 0 && b.patT > (9 - b.shotsLeft) * 0.22) {
      b.shotsLeft -= 1;
      const x = (0.08 + s.rng() * 0.84) * s.W;
      s.enemyShots.push({ x, y: b.y + 20, vx: 0, vy: sp * 1.05 });
      emit(s, "bossShot");
    }
    if (b.shotsLeft === 0 && b.patT > 2.4) { b.state = "idle"; b.stateT = 0; }
  } else if (pat === "beam") {
    /* 0.9s of telegraph, then the beam sweeps across the field slower
       than the ship can move, so it is always escapable. */
    if (b.patT < 0.9) {
      b.beamX = b.x;
    } else if (b.patT < 2.4) {
      if (!b.beamOn) { b.beamOn = true; emit(s, "beamFire"); }
      b.beamX += b.beamDir * dt * 300;
      if (Math.abs(s.ship.x - b.beamX) < 26) hurtPlayer(s, "beam");
    } else {
      b.beamOn = false;
      b.state = "idle"; b.stateT = 0;
    }
  } else if (pat === "wave") {
    /* a rolling curtain with a guaranteed gap around a random column */
    if (b.shotsLeft > 0 && b.patT > (12 - b.shotsLeft) * 0.16) {
      b.shotsLeft -= 1;
      const i = 12 - b.shotsLeft;
      const fx = (i % 12) / 12;
      if (Math.abs(fx - b.gapX) > 0.13) {
        s.enemyShots.push({ x: fx * s.W, y: 40, vx: Math.sin(i) * 30, vy: sp * 0.92 });
      }
    }
    if (b.shotsLeft === 0 && b.patT > 2.2) { b.state = "idle"; b.stateT = 0; }
  }
}

function damageBoss(s, dmg) {
  const b = s.boss;
  /* Idle is the advertised weak window. */
  b.hp -= b.state === "idle" ? dmg * 1.5 : dmg;
  if (b.hp <= 0) {
    emit(s, "explode", { kind: "boss", big: true }, b.x, b.y);
    emit(s, "bossDown");
    s.score += Math.round(ENEMY.boss.score * multiplier(s) + s.wave * 50);
    s.kills += 1;
    dropCrystal(s, b.x, b.y, 12);
    dropPower(s, b.x - 30, b.y);
    dropPower(s, b.x + 30, b.y, s.weapon < MAX_WEAPON ? "upgrade" : undefined);
    s.boss = null;
    s.shake = 12;
    s.waveState = "bossdown";
    s.waveTimer = 2.4;
  }
}

/* --------------------------------- step --------------------------------- */

export function stepGame(s, dt) {
  if (s.phase !== "playing") return;
  s.t += dt;
  const ship = s.ship;

  /* ------ ship movement ------ */
  let move = 0;
  if (s.input.left) move -= 1;
  if (s.input.right) move += 1;
  if (move !== 0) {
    ship.targetX = null;
    ship.x += move * SHIP_SPEED * dt;
    ship.tilt += (move - ship.tilt) * Math.min(1, dt * 8);
  } else if (ship.targetX != null) {
    const dx = ship.targetX - ship.x;
    ship.x += dx * Math.min(1, dt * SHIP_FOLLOW);
    ship.tilt += (Math.max(-1, Math.min(1, dx / 40)) - ship.tilt) * Math.min(1, dt * 10);
  } else {
    ship.tilt += (0 - ship.tilt) * Math.min(1, dt * 6);
  }
  ship.x = Math.min(Math.max(ship.x, SHIP_R + 8), s.W - SHIP_R - 8);

  /* ------ timers ------ */
  if (s.inv > 0) s.inv -= dt;
  if (s.shake > 0) s.shake = Math.max(0, s.shake - dt * 18);
  for (const k of Object.keys(s.power)) {
    if (s.power[k] > 0) {
      s.power[k] -= dt;
      if (s.power[k] <= 0) { s.power[k] = 0; emit(s, "powerEnd", k); }
    }
  }
  if (s.comboTimer > 0) {
    s.comboTimer -= dt;
    if (s.comboTimer <= 0) s.combo = 0;
  }

  /* ------ auto-fire ------ */
  ship.fireCd -= dt;
  if (s.power.beam <= 0 && ship.fireCd <= 0) {
    firePlayer(s);
    ship.fireCd = fireCooldown(s);
  }

  /* ------ homing missiles ------ */
  if (s.power.missiles > 0) {
    s.missileCd -= dt;
    if (s.missileCd <= 0 && (s.enemies.length > 0 || s.boss)) {
      s.missileCd = 0.55;
      s.missiles.push({ x: ship.x, y: ship.y - 10, vx: (s.rng() - 0.5) * 160, vy: -260, t: 0 });
      emit(s, "missile");
    }
  }

  /* ------ waves ------ */
  if (s.waveState === "announce") {
    s.waveTimer -= dt;
    if (s.waveTimer <= 0) {
      if (isBossWave(s.wave)) {
        s.waveState = "warning";
        s.waveTimer = 2.2;
        emit(s, "bossWarn");
      } else {
        s.waveState = "active";
        s.queue = buildWave(s, s.wave);
        s.spawnT = 0;
        if (s.wave === 2 && !s.gaveFirstChip) {
          /* the level system should always get going, luck or not */
          s.gaveFirstChip = true;
          dropPower(s, s.W / 2, -20, "upgrade");
        }
      }
    }
  } else if (s.waveState === "warning") {
    s.waveTimer -= dt;
    if (s.waveTimer <= 0) spawnBoss(s);
  } else if (s.waveState === "active") {
    s.spawnT += dt;
    while (s.queue.length && s.queue[0].at <= s.spawnT) {
      const it = s.queue.shift();
      spawnEnemy(s, it.type, it.x);
    }
    if (!s.queue.length && !s.enemies.length) {
      s.wave += 1;
      s.waveState = "announce";
      s.waveTimer = 1.6;
      emit(s, "wave", s.wave);
    }
  } else if (s.waveState === "bossdown") {
    s.waveTimer -= dt;
    if (s.waveTimer <= 0 && !s.enemies.length) {
      s.wave += 1;
      s.waveState = "announce";
      s.waveTimer = 1.6;
      emit(s, "wave", s.wave);
    }
  }

  /* ------ enemies ------ */
  const sp = enemyShotSpeed(s);
  for (let i = s.enemies.length - 1; i >= 0; i -= 1) {
    const e = s.enemies[i];
    e.t += dt;
    switch (e.type) {
      case "fast":
        e.x = e.baseX + Math.sin(e.t * 3.2 + e.seed) * 46;
        e.y += e.vy * dt;
        break;
      case "zigzag":
        e.x += e.vx * dt;
        if (e.x < e.r + 6 || e.x > s.W - e.r - 6) e.vx = -e.vx;
        e.y += e.vy * dt;
        break;
      case "shooter":
        e.y += e.vy * dt;
        e.fireCd -= dt;
        if (e.fireCd <= 0 && e.y > 30 && e.y < s.H * 0.62) {
          e.fireCd = 2.3 + s.rng() * 0.9;
          enemyFire(s, e.x, e.y + e.r, s.ship.x, s.ship.y, sp);
          emit(s, "enemyShot");
        }
        break;
      case "elite":
      case "mini": {
        if (e.y < e.homeY) e.y += e.vy * dt;
        else e.y = e.homeY + Math.sin(e.t * 1.4) * 12;
        e.x += Math.sin(e.t * 0.9 + e.seed) * dt * 130;
        e.x = Math.min(Math.max(e.x, e.r + 8), s.W - e.r - 8);
        e.fireCd -= dt;
        if (e.fireCd <= 0) {
          e.fireCd = e.type === "mini" ? 2.1 : 2.6;
          const n = e.type === "mini" ? 1 : 0;
          for (let k = -1 - n; k <= 1 + n; k += 1) {
            const dx = s.ship.x - e.x, dy = s.ship.y - e.y;
            const ang = Math.atan2(dy, dx) + k * 0.2;
            s.enemyShots.push({ x: e.x, y: e.y + e.r, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp });
          }
          emit(s, "enemyShot");
        }
        break;
      }
      default:
        e.y += e.vy * dt;
    }

    /* collide with the ship */
    const rr = e.r + SHIP_R;
    if ((e.x - ship.x) * (e.x - ship.x) + (e.y - ship.y) * (e.y - ship.y) < rr * rr) {
      hurtPlayer(s, "crash");
      if (s.phase === "playing" && e.type !== "mini" && e.type !== "elite") {
        emit(s, "explode", { kind: e.type, big: false }, e.x, e.y);
        s.enemies.splice(i, 1);
      }
      continue;
    }

    /* escaping off the bottom breaks the chain but costs nothing else */
    if (e.y > s.H + 60) {
      s.enemies.splice(i, 1);
      s.combo = 0;
      s.comboTimer = 0;
    }
  }

  /* ------ boss ------ */
  if (s.boss) stepBoss(s, dt);
  if (s.boss) {
    const b = s.boss;
    const rr = b.r + SHIP_R;
    if ((b.x - ship.x) * (b.x - ship.x) + (b.y - ship.y) * (b.y - ship.y) < rr * rr) hurtPlayer(s, "crash");
  }

  /* ------ player shots ------ */
  for (let i = s.shots.length - 1; i >= 0; i -= 1) {
    const p = s.shots[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    let dead = p.y < -30 || p.x < -20 || p.x > s.W + 20;
    if (!dead) {
      for (let j = s.enemies.length - 1; j >= 0; j -= 1) {
        const e = s.enemies[j];
        const rr = e.r + 6;
        if ((e.x - p.x) * (e.x - p.x) + (e.y - p.y) * (e.y - p.y) < rr * rr) {
          e.hp -= p.dmg;
          dead = true;
          emit(s, "spark", null, p.x, p.y);
          if (e.hp <= 0) { killEnemy(s, e); s.enemies.splice(j, 1); }
          break;
        }
      }
      if (!dead && s.boss) {
        const b = s.boss;
        const rr = b.r + 6;
        if (b.y > -20 && (b.x - p.x) * (b.x - p.x) + (b.y - p.y) * (b.y - p.y) < rr * rr) {
          dead = true;
          emit(s, "spark", null, p.x, p.y);
          damageBoss(s, p.dmg);
        }
      }
    }
    if (dead) s.shots.splice(i, 1);
  }

  /* ------ laser beam: constant damage in a strip above the ship ------ */
  if (s.power.beam > 0) {
    const bx = ship.x, half = 15, dps = 11;
    for (let j = s.enemies.length - 1; j >= 0; j -= 1) {
      const e = s.enemies[j];
      if (e.y < ship.y && Math.abs(e.x - bx) < half + e.r) {
        e.hp -= dps * dt;
        if (e.hp <= 0) { killEnemy(s, e); s.enemies.splice(j, 1); }
      }
    }
    if (s.boss && s.boss.y > -20 && Math.abs(s.boss.x - bx) < half + s.boss.r) {
      damageBoss(s, dps * dt);
    }
  }

  /* ------ missiles ------ */
  for (let i = s.missiles.length - 1; i >= 0; i -= 1) {
    const m = s.missiles[i];
    m.t += dt;
    /* home on the nearest target */
    let tx = null, ty = null, best = Infinity;
    for (const e of s.enemies) {
      const d = (e.x - m.x) * (e.x - m.x) + (e.y - m.y) * (e.y - m.y);
      if (d < best) { best = d; tx = e.x; ty = e.y; }
    }
    if (s.boss) {
      const d = (s.boss.x - m.x) * (s.boss.x - m.x) + (s.boss.y - m.y) * (s.boss.y - m.y);
      if (d < best) { best = d; tx = s.boss.x; ty = s.boss.y; }
    }
    if (tx != null) {
      const d = Math.sqrt(best) || 1;
      m.vx += ((tx - m.x) / d) * 1600 * dt;
      m.vy += ((ty - m.y) / d) * 1600 * dt;
      const v = Math.hypot(m.vx, m.vy) || 1;
      const cap = 430;
      if (v > cap) { m.vx = (m.vx / v) * cap; m.vy = (m.vy / v) * cap; }
    }
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    let dead = m.t > 4 || m.y < -30 || m.x < -30 || m.x > s.W + 30;
    if (!dead) {
      for (let j = s.enemies.length - 1; j >= 0; j -= 1) {
        const e = s.enemies[j];
        const rr = e.r + 9;
        if ((e.x - m.x) * (e.x - m.x) + (e.y - m.y) * (e.y - m.y) < rr * rr) {
          dead = true;
          e.hp -= 3;
          emit(s, "explode", { kind: "missile", big: false }, m.x, m.y);
          if (e.hp <= 0) { killEnemy(s, e); s.enemies.splice(j, 1); }
          break;
        }
      }
      if (!dead && s.boss) {
        const b = s.boss;
        const rr = b.r + 9;
        if (b.y > -20 && (b.x - m.x) * (b.x - m.x) + (b.y - m.y) * (b.y - m.y) < rr * rr) {
          dead = true;
          emit(s, "explode", { kind: "missile", big: false }, m.x, m.y);
          damageBoss(s, 3);
        }
      }
    }
    if (dead) s.missiles.splice(i, 1);
  }

  /* ------ enemy shots ------ */
  for (let i = s.enemyShots.length - 1; i >= 0; i -= 1) {
    const p = s.enemyShots[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.y > s.H + 20 || p.y < -30 || p.x < -20 || p.x > s.W + 20) {
      s.enemyShots.splice(i, 1);
      continue;
    }
    const rr = SHIP_R + 6;
    if ((p.x - ship.x) * (p.x - ship.x) + (p.y - ship.y) * (p.y - ship.y) < rr * rr) {
      s.enemyShots.splice(i, 1);
      hurtPlayer(s, "shot");
    }
  }

  /* ------ crystals ------ */
  const magnetR = s.power.magnet > 0 ? 240 : 78;
  for (let i = s.crystals.length - 1; i >= 0; i -= 1) {
    const c = s.crystals[i];
    c.t += dt;
    const dx = ship.x - c.x, dy = ship.y - c.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < magnetR * magnetR) {
      const d = Math.sqrt(d2) || 1;
      const pull = s.power.magnet > 0 ? 1400 : 900;
      c.vx += (dx / d) * pull * dt;
      c.vy += (dy / d) * pull * dt;
    } else {
      c.vx *= 1 - Math.min(1, dt * 2);
    }
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    if (d2 < 28 * 28) {
      s.crystals.splice(i, 1);
      s.crystalRun += 1;
      s.score += 5;
      emit(s, "crystal", null, c.x, c.y);
    } else if (c.y > s.H + 30) {
      s.crystals.splice(i, 1);
    }
  }

  /* ------ power-up drops ------ */
  for (let i = s.drops.length - 1; i >= 0; i -= 1) {
    const p = s.drops[i];
    p.t += dt;
    p.y += p.vy * dt;
    p.x += Math.sin(p.t * 2.2) * dt * 30;
    const dx = ship.x - p.x, dy = ship.y - p.y;
    if (dx * dx + dy * dy < 34 * 34) {
      s.drops.splice(i, 1);
      collectPower(s, p.kind);
    } else if (p.y > s.H + 30) {
      s.drops.splice(i, 1);
    }
  }
}
