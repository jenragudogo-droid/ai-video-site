/* ------------------------------------------------------------------ *
 * Kianimation Football League — match simulation.
 *
 * Pure logic: no React, no DOM, no canvas. The component feeds it an
 * input object and renders snapshots, which also means a whole match
 * can be simulated headlessly for testing.
 *
 * Units are real football units: metres, metres/second, seconds.
 * The pitch runs x 0..105 (goals at both ends) and y 0..68.
 * ------------------------------------------------------------------ */

import { FORMATIONS, ROLE_LINE } from "./formations.js";
import { clubById } from "./teams.js";

export const PITCH = {
  L: 105,
  W: 68,
  GOAL_W: 7.32,
  GOAL_H: 2.44,
  BOX_D: 16.5,
  BOX_W: 40.32,
  SIX_D: 5.5,
  SIX_W: 18.32,
  CIRCLE: 9.15,
  SPOT: 11,
};

export const HALF_MINUTES = 45;
export const MAX_SUBS = 5;

const GOAL_Y0 = PITCH.W / 2 - PITCH.GOAL_W / 2;
const GOAL_Y1 = PITCH.W / 2 + PITCH.GOAL_W / 2;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (w) => w.rand();
const rndRange = (w, lo, hi) => lo + w.rand() * (hi - lo);

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------ events ------------------------------ */

function emit(w, type, data = {}) {
  w.events.push({ type, minute: Math.floor(w.displayMinute), ...data });
}

export function drainEvents(w) {
  const out = w.events;
  w.events = [];
  return out;
}

/* ---------------------------- match setup ---------------------------- */

function blankStats() {
  return {
    shots: 0,
    onTarget: 0,
    goals: 0,
    passes: 0,
    passesCompleted: 0,
    tackles: 0,
    fouls: 0,
    yellow: 0,
    red: 0,
    corners: 0,
    offsides: 0,
    saves: 0,
    possessionMs: 0,
  };
}

function makeMatchPlayer(data, team, index) {
  return {
    id: data.id,
    uid: `${team}:${data.id}`,
    team,
    data,
    role: data.position,
    slotIdx: index,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    on: false,
    used: false,
    stamina: 100,
    kickCd: 0,
    controlCd: 0,
    tackleCd: 0,
    slideT: 0,
    sprinting: false,
    anim: 0,
    yellow: 0,
    red: false,
    offside: false,
    /* keepers only */
    diveT: 0,
    diveDir: 0,
    holdT: 0,
    runTarget: null,
  };
}

/**
 * config: {
 *   home, away        club ids
 *   homeSetup, awaySetup  { formation, xi:[11 ids], bench:[ids] }
 *   userTeam          0 | 1
 *   halfSeconds       real seconds per half (displayed as 45 minutes)
 *   difficulty        'easy' | 'normal' | 'hard'
 *   knockout          boolean — enables extra time + shootout on a draw
 *   seed              number
 * }
 */
export function makeMatch(config) {
  const home = clubById(config.home);
  const away = clubById(config.away);
  const w = {
    cfg: {
      halfSeconds: config.halfSeconds ?? 180,
      difficulty: config.difficulty ?? "normal",
      knockout: !!config.knockout,
      maxSubs: config.maxSubs ?? MAX_SUBS,
    },
    rand: mulberry32(config.seed ?? 20260819),
    userTeam: config.userTeam ?? 0,
    cpuOnly: (config.userTeam ?? 0) < 0,
    teams: [],
    players: [],
    ball: {
      x: PITCH.L / 2, y: PITCH.W / 2, z: 0,
      vx: 0, vy: 0, vz: 0,
      spin: 0,
      owner: null,
      lastTouch: null,
      lastTouchTeam: -1,
      passFrom: null,
      inFlightShot: false,
      shotPower: 0,
    },
    score: [0, 0],
    stats: [blankStats(), blankStats()],
    events: [],
    log: [],
    phase: "kickoff",
    phaseT: 1.6,
    half: 1,
    halfElapsed: 0,
    displayMinute: 0,
    stoppageAdd: 0,
    restart: null,
    controlled: null,
    switchLock: 0,
    lastGoal: null,
    shootout: null,
    pendingSubs: [[], []],
    subBanner: null,
    subBannerT: 0,
    cardBanner: null,
    cardBannerT: 0,
    refBanner: null,
    refBannerT: 0,
    finished: false,
    result: null,
    kickoffTeam: 0,
    time: 0,
  };

  [home, away].forEach((club, ti) => {
    const setup = ti === 0 ? config.homeSetup : config.awaySetup;
    const formation = FORMATIONS[setup.formation] || FORMATIONS["4-3-3"];
    const team = {
      index: ti,
      club,
      formationId: formation.id,
      formation,
      dir: ti === 0 ? 1 : -1,
      isUser: (config.userTeam ?? 0) === ti,
      subsUsed: 0,
      onPitch: [],
      bench: [],
      mentality: 0,
    };

    const roster = new Map(club.squad.map((p) => [p.id, p]));
    setup.xi.forEach((pid, slotIdx) => {
      const p = makeMatchPlayer(roster.get(pid), ti, slotIdx);
      p.role = formation.slots[slotIdx].role;
      p.natural = roster.get(pid).position;
      p.on = true;
      p.used = true;
      w.players.push(p);
      team.onPitch.push(p);
    });
    setup.bench.forEach((pid) => {
      const p = makeMatchPlayer(roster.get(pid), ti, -1);
      w.players.push(p);
      team.bench.push(p);
    });
    w.teams.push(team);
  });

  w.kickoffTeam = 0;
  resetPositions(w, 0);
  w.controlled = w.userTeam >= 0 ? pickNearestOutfield(w, w.userTeam, PITCH.L / 2, PITCH.W / 2) : null;
  return w;
}

/* ------------------------- shape and positions ------------------------ */

export function slotPos(team, slot) {
  const x = team.dir === 1 ? slot.nx * PITCH.L : PITCH.L - slot.nx * PITCH.L;
  const y = team.dir === 1 ? slot.ny * PITCH.W : PITCH.W - slot.ny * PITCH.W;
  return { x, y };
}

function homeSlot(w, p) {
  const team = w.teams[p.team];
  const slot = team.formation.slots[p.slotIdx] || team.formation.slots[5];
  return slotPos(team, slot);
}

function resetPositions(w, kickoffTeam) {
  w.teams.forEach((team) => {
    team.onPitch.forEach((p) => {
      const base = homeSlot(w, p);
      /* everyone stays in their own half for a kickoff */
      const ownHalfX = team.dir === 1
        ? Math.min(base.x, PITCH.L / 2 - 1.5)
        : Math.max(base.x, PITCH.L / 2 + 1.5);
      p.x = ownHalfX;
      p.y = base.y;
      p.vx = 0;
      p.vy = 0;
      p.offside = false;
      p.diveT = 0;
      p.slideT = 0;
    });
  });

  const taker = w.teams[kickoffTeam].onPitch
    .filter((p) => p.role !== "GK")
    .sort((a, b) => Math.abs(a.x - PITCH.L / 2) - Math.abs(b.x - PITCH.L / 2))[0];
  const support = w.teams[kickoffTeam].onPitch
    .filter((p) => p !== taker && p.role !== "GK")
    .sort((a, b) => dist(a.x, a.y, PITCH.L / 2, PITCH.W / 2) - dist(b.x, b.y, PITCH.L / 2, PITCH.W / 2))[0];

  const dir = w.teams[kickoffTeam].dir;
  taker.x = PITCH.L / 2 - dir * 1.2;
  taker.y = PITCH.W / 2 - 1.2;
  if (support) {
    support.x = PITCH.L / 2 - dir * 3.5;
    support.y = PITCH.W / 2 + 2.5;
  }

  const b = w.ball;
  b.x = PITCH.L / 2;
  b.y = PITCH.W / 2;
  b.z = 0;
  b.vx = 0;
  b.vy = 0;
  b.vz = 0;
  b.spin = 0;
  b.owner = null;
  b.inFlightShot = false;
  b.passFrom = null;
  w.kickoffTaker = taker;
}

/* ------------------------------ utilities ----------------------------- */

export const opponentOf = (team) => (team === 0 ? 1 : 0);

const ownGoalX = (team) => (team.dir === 1 ? 0 : PITCH.L);
const targetGoalX = (team) => (team.dir === 1 ? PITCH.L : 0);

function teamOf(w, p) {
  return w.teams[p.team];
}

function onPitch(w, teamIdx) {
  return w.teams[teamIdx].onPitch;
}

function pickNearestOutfield(w, teamIdx, x, y) {
  let best = null;
  let bestD = Infinity;
  onPitch(w, teamIdx).forEach((p) => {
    if (p.role === "GK") return;
    const d = dist(p.x, p.y, x, y);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  });
  return best;
}

export function controlledPlayer(w) {
  return w.controlled && w.controlled.on ? w.controlled : null;
}

function staminaFactor(p) {
  return 0.66 + 0.34 * (p.stamina / 100);
}

export function topSpeed(p) {
  const base = 4.9 + (p.data.pace / 100) * 3.3;
  return base * staminaFactor(p);
}

/** attribute value after fatigue — tired players lose sharpness too */
function attr(p, key) {
  return p.data[key] * (0.78 + 0.22 * (p.stamina / 100));
}

function pressureOn(w, p) {
  let press = 0;
  onPitch(w, opponentOf(p.team)).forEach((o) => {
    const d = dist(p.x, p.y, o.x, o.y);
    if (d < 6) press += (6 - d) / 6;
  });
  return Math.min(2.2, press);
}

function inBox(x, y, team) {
  const gx = ownGoalX(team);
  const nearGoal = gx === 0 ? x <= PITCH.BOX_D : x >= PITCH.L - PITCH.BOX_D;
  return nearGoal && Math.abs(y - PITCH.W / 2) <= PITCH.BOX_W / 2;
}

/* ------------------------------- movement ----------------------------- */

function steer(w, p, tx, ty, dt, speedScale = 1) {
  const dx = tx - p.x;
  const dy = ty - p.y;
  const d = Math.hypot(dx, dy);
  let want = topSpeed(p) * speedScale;
  if (p.sprinting) want *= 1.16;
  if (w.ball.owner === p) want *= 0.9;
  if (d < 0.35) want *= d / 0.35;

  const nx = d > 0.0001 ? dx / d : 0;
  const ny = d > 0.0001 ? dy / d : 0;
  const desiredVx = nx * want;
  const desiredVy = ny * want;

  const accel = 17 + (p.data.dribbling / 100) * 8;
  const maxStep = accel * dt;
  const ddx = desiredVx - p.vx;
  const ddy = desiredVy - p.vy;
  const dd = Math.hypot(ddx, ddy);
  if (dd > maxStep) {
    p.vx += (ddx / dd) * maxStep;
    p.vy += (ddy / dd) * maxStep;
  } else {
    p.vx = desiredVx;
    p.vy = desiredVy;
  }
}

function integrate(w, p, dt) {
  p.x = clamp(p.x + p.vx * dt, -2.5, PITCH.L + 2.5);
  p.y = clamp(p.y + p.vy * dt, -3, PITCH.W + 3);
  const speed = Math.hypot(p.vx, p.vy);
  p.anim += speed * dt * 1.35;

  /* stamina: standing still recovers a little, sprinting burns fast */
  const effort = speed / Math.max(3.2, topSpeed(p));
  const endurance = 0.55 + (p.data.stamina / 100) * 0.75;
  let drain = (0.035 + effort * effort * 0.3 + (p.sprinting ? 0.15 : 0)) / endurance;
  if (speed < 1.2) drain -= 0.09;
  p.stamina = clamp(p.stamina - drain * dt, 4, 100);

  p.kickCd = Math.max(0, p.kickCd - dt);
  p.controlCd = Math.max(0, p.controlCd - dt);
  p.tackleCd = Math.max(0, p.tackleCd - dt);
  p.slideT = Math.max(0, p.slideT - dt);
  p.diveT = Math.max(0, p.diveT - dt);
}

/* -------------------------------- ball -------------------------------- */

function ballAhead(w, p) {
  const speed = Math.hypot(p.vx, p.vy);
  const dirX = speed > 0.4 ? p.vx / speed : teamOf(w, p).dir;
  const dirY = speed > 0.4 ? p.vy / speed : 0;
  return { dirX, dirY, lead: 0.62 + Math.min(speed, 8) * 0.085 };
}

function updateBall(w, dt) {
  const b = w.ball;

  if (b.owner) {
    const p = b.owner;
    const { dirX, dirY, lead } = ballAhead(w, p);
    b.x = p.x + dirX * lead;
    b.y = p.y + dirY * lead;
    b.z = Math.max(0, b.z - dt * 6);
    b.vx = p.vx;
    b.vy = p.vy;
    b.vz = 0;
    b.spin = 0;
    return;
  }

  /* curve from side spin, only while airborne or rolling fast */
  const speed = Math.hypot(b.vx, b.vy);
  if (Math.abs(b.spin) > 0.001 && speed > 3) {
    const nx = b.vx / speed;
    const ny = b.vy / speed;
    const curve = b.spin * dt * 5.5;
    b.vx += -ny * curve;
    b.vy += nx * curve;
    b.spin *= 1 - dt * 0.55;
  }

  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.z += b.vz * dt;

  if (b.z > 0.001) {
    b.vz -= 9.81 * dt;
    const drag = 1 - 0.06 * dt;
    b.vx *= drag;
    b.vy *= drag;
  }
  if (b.z <= 0) {
    b.z = 0;
    if (b.vz < -0.6) {
      b.vz = -b.vz * 0.56;
      b.vx *= 0.88;
      b.vy *= 0.88;
    } else {
      b.vz = 0;
      const roll = Math.max(0, 1 - 0.62 * dt);
      b.vx *= roll;
      b.vy *= roll;
      if (Math.hypot(b.vx, b.vy) < 0.12) {
        b.vx = 0;
        b.vy = 0;
      }
    }
  }
}

function touch(w, p) {
  w.ball.lastTouch = p;
  w.ball.lastTouchTeam = p.team;
}

function takeBall(w, p) {
  const b = w.ball;
  const prev = b.owner;
  if (prev === p) return;
  b.owner = p;
  b.inFlightShot = false;
  b.vz = 0;
  b.z = 0;
  touch(w, p);

  if (b.passFrom && b.passFrom.team === p.team && b.passFrom !== p) {
    w.stats[p.team].passesCompleted += 1;
    if (b.passLong) emit(w, "passCompleteLong", { player: p.data, from: b.passFrom.data });
    else emit(w, "passComplete", { player: p.data, from: b.passFrom.data });
  } else if (b.passFrom && b.passFrom.team !== p.team) {
    w.stats[p.team].tackles += 0;
    emit(w, "interception", { player: p.data, team: p.team });
  }
  b.passFrom = null;
  b.passLong = false;

  if (prev && prev.team !== p.team) {
    emit(w, "possessionWon", { player: p.data, team: p.team });
  }
}

function contestBall(w) {
  const b = w.ball;
  if (b.owner) return;
  if (b.z > 1.9) return;

  let best = null;
  let bestScore = Infinity;
  w.players.forEach((p) => {
    if (!p.on || p.controlCd > 0) return;
    const receiving = w.ball.intended === p && p.receiveUntil > w.time;
    const reach = p.role === "GK"
      ? 1.7 + (p.data.diving / 100) * 0.8 + (p.diveT > 0 ? 0.7 : 0)
      : 1.0 + (p.data.dribbling / 100) * 0.5 + (receiving ? 0.45 : 0);
    const d = dist(p.x, p.y, b.x, b.y);
    if (d > reach) return;
    const score = d - (p.data.dribbling / 100) * 0.25;
    if (score < bestScore) {
      bestScore = score;
      best = p;
    }
  });

  if (!best) return;
  if (best.role === "GK" && b.z < 2.4) {
    keeperClaim(w, best);
    return;
  }
  /* fast balls need a first touch — weaker players lose it */
  const ballSpeed = Math.hypot(b.vx, b.vy);
  const control = attr(best, "dribbling") / 100 + (w.ball.intended === best ? 0.3 : 0);
  if (ballSpeed > 14 && rnd(w) > 0.45 + control * 0.6) {
    /* a deflection: it spins off the defender and can go anywhere,
       including behind for a corner */
    touch(w, best);
    const team = teamOf(w, best);
    const gx = ownGoalX(team);
    const inOwnBox = inBox(best.x, best.y, team);
    if (inOwnBox && rnd(w) < 0.32) {
      /* a block that loops off the defender and out for a corner */
      const away = Math.sign(gx - best.x) || -team.dir;
      b.vx = away * rndRange(w, 6, 12);
      b.vy = rndRange(w, -7, 7);
      b.vz = rndRange(w, 3, 6);
    } else {
      const ang = Math.atan2(b.vy, b.vx) + rndRange(w, -1.5, 1.5);
      const keep = ballSpeed * rndRange(w, 0.22, 0.45);
      b.vx = Math.cos(ang) * keep;
      b.vy = Math.sin(ang) * keep;
      b.vz = Math.max(b.vz, rndRange(w, 0.5, 3));
    }
    b.inFlightShot = false;
    best.controlCd = 0.3;
    return;
  }
  checkOffsideTouch(w, best);
  if (w.phase !== "play") return;
  takeBall(w, best);
}

/** Earliest point on the ball's path this player can actually reach. */
function interceptPoint(w, p, maxT = 2) {
  const b = w.ball;
  const speed = topSpeed(p) * 1.02;
  let bx = b.x;
  let by = b.y;
  let vx = b.vx;
  let vy = b.vy;
  for (let t = 0.08; t <= maxT; t += 0.12) {
    bx += vx * 0.12;
    by += vy * 0.12;
    const roll = b.z > 0.2 ? 0.994 : 0.926;
    vx *= roll;
    vy *= roll;
    if (dist(p.x, p.y, bx, by) <= speed * t + 0.7) return { x: bx, y: by, t };
  }
  return { x: bx, y: by, t: maxT };
}

/* ------------------------------- actions ------------------------------ */

function releaseBall(w, p) {
  const b = w.ball;
  if (b.owner === p) b.owner = null;
  p.kickCd = 0.28;
  p.controlCd = 0.45;
  touch(w, p);
}

function passErrorAngle(w, p, quality, distance) {
  const skill = attr(p, "passing") / 100;
  const press = pressureOn(w, p);
  const base = (1 - skill) * 0.16 + press * 0.026 + distance * 0.0016;
  const spread = base * (1.25 - quality * 0.35);
  return rndRange(w, -spread, spread);
}

function bestPassTarget(w, p, opts = {}) {
  const team = teamOf(w, p);
  const mates = onPitch(w, p.team).filter((m) => m !== p && m.role !== "GK");
  let best = null;
  let bestScore = -Infinity;

  mates.forEach((m) => {
    const d = dist(p.x, p.y, m.x, m.y);
    if (d < 3 || d > (opts.maxDist ?? 42)) return;
    const dx = (m.x - p.x) / d;
    const dy = (m.y - p.y) / d;

    let score = 0;
    if (opts.dirX !== undefined && (opts.dirX || opts.dirY)) {
      const align = dx * opts.dirX + dy * opts.dirY;
      if (align < (opts.strict ? 0.15 : -0.45)) return;
      score += align * 55;
    }
    /* progressive passes are worth more */
    score += (m.x - p.x) * team.dir * 1.15;
    score -= d * 0.32;

    /* how open is he */
    let cover = 0;
    onPitch(w, opponentOf(p.team)).forEach((o) => {
      const od = dist(m.x, m.y, o.x, o.y);
      if (od < 7) cover += (7 - od) * 2.4;
      /* someone standing in the passing lane */
      const t = ((o.x - p.x) * dx + (o.y - p.y) * dy) / d;
      if (t > 0.05 && t < 0.95) {
        const px = p.x + dx * d * t;
        const py = p.y + dy * d * t;
        const lane = dist(px, py, o.x, o.y);
        if (lane < 3.4) cover += (3.4 - lane) * 13;
      }
    });
    score -= cover;
    if (opts.throughBall) {
      score += (m.x - p.x) * team.dir * 0.9 + (m.data.pace - 60) * 0.3;
    }
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  });
  return best;
}

function kickToward(w, p, tx, ty, speed, loft, spin = 0) {
  const b = w.ball;
  const dx = tx - b.x;
  const dy = ty - b.y;
  const d = Math.max(0.6, Math.hypot(dx, dy));
  b.vx = (dx / d) * speed;
  b.vy = (dy / d) * speed;
  b.vz = loft;
  b.spin = spin;
  b.onTargetCounted = false;
  b.z = Math.max(b.z, loft > 0.5 ? 0.1 : 0);
  releaseBall(w, p);
}

export function doPass(w, p, dirX = 0, dirY = 0, opts = {}) {
  const target = opts.target || bestPassTarget(w, p, { dirX, dirY, maxDist: opts.maxDist ?? 34 });
  const team = teamOf(w, p);
  w.stats[p.team].passes += 1;

  if (!target) {
    /* nobody on — clear it, and under pressure in your own box that
       often means putting it behind for a corner */
    const ownGoal = ownGoalX(team);
    const desperate = Math.abs(p.x - ownGoal) < 18 && pressureOn(w, p) > 0.7 && rnd(w) < 0.4;
    const tx = desperate ? ownGoal - team.dir * 5 : p.x + team.dir * rndRange(w, 16, 30);
    const ty = desperate ? p.y + rndRange(w, -8, 8) : p.y + rndRange(w, -22, 22);
    kickToward(w, p, tx, ty, desperate ? 12 : 17, 4.5);
    w.ball.passFrom = p;
    w.ball.passLong = true;
    emit(w, "clearance", { player: p.data, team: p.team });
    markOffsides(w, p);
    return;
  }

  const d = dist(p.x, p.y, target.x, target.y);
  const lead = Math.min(1.1, d / 26);
  const tx = target.x + target.vx * lead;
  const ty = target.y + target.vy * lead;
  const err = passErrorAngle(w, p, 1, d);
  const ang = Math.atan2(ty - p.y, tx - p.x) + err;
  const speed = clamp(7.5 + d * 0.56, 9, 22);
  const loft = d > 26 ? 3.5 : 0;

  kickToward(w, p, p.x + Math.cos(ang) * d, p.y + Math.sin(ang) * d, speed, loft);
  w.ball.passFrom = p;
  w.ball.passLong = d > 26;
  w.ball.intended = target;
  target.controlCd = 0;
  target.receiveUntil = w.time + 2.2;
  emit(w, d > 26 ? "longPass" : "pass", { player: p.data, team: p.team, to: target.data, dist: d });
  markOffsides(w, p);
}

export function doThroughBall(w, p, dirX = 0, dirY = 0) {
  const team = teamOf(w, p);
  const mates = onPitch(w, p.team).filter((m) => m !== p && m.role !== "GK");
  let best = null;
  let bestScore = -Infinity;

  mates.forEach((m) => {
    const runX = m.x + team.dir * (6 + (m.data.pace / 100) * 9);
    const runY = m.y + m.vy * 0.6;
    const d = dist(p.x, p.y, runX, runY);
    if (d < 6 || d > 46) return;
    const ahead = (m.x - p.x) * team.dir;
    if (ahead < -2) return;
    let score = ahead * 1.6 + m.data.pace * 0.32 - d * 0.35;
    if (dirX || dirY) {
      const dx = (runX - p.x) / d;
      const dy = (runY - p.y) / d;
      score += (dx * dirX + dy * dirY) * 40;
    }
    /* would he be offside? */
    if (isOffsidePos(w, m)) score -= 85;
    onPitch(w, opponentOf(p.team)).forEach((o) => {
      const od = dist(runX, runY, o.x, o.y);
      if (od < 6) score -= (6 - od) * 3;
    });
    if (score > bestScore) {
      bestScore = score;
      best = { m, runX, runY, d };
    }
  });

  w.stats[p.team].passes += 1;
  if (!best) {
    doPass(w, p, dirX, dirY);
    return;
  }

  const err = passErrorAngle(w, p, 0.8, best.d);
  const ang = Math.atan2(best.runY - p.y, best.runX - p.x) + err;
  const speed = clamp(11 + best.d * 0.6, 12, 24);
  kickToward(w, p, p.x + Math.cos(ang) * best.d, p.y + Math.sin(ang) * best.d, speed, best.d > 24 ? 2.4 : 0);
  w.ball.passFrom = p;
  w.ball.passLong = false;
  w.ball.intended = best.m;
  best.m.chaseUntil = w.time + 3.2;
  best.m.receiveUntil = w.time + 2.6;
  emit(w, "throughBall", { player: p.data, team: p.team, to: best.m.data });
  markOffsides(w, p);
}

export function doCross(w, p) {
  const team = teamOf(w, p);
  const gx = targetGoalX(team);
  const tx = gx - team.dir * rndRange(w, 7, 13);
  const ty = PITCH.W / 2 + rndRange(w, -7, 7);
  const d = dist(p.x, p.y, tx, ty);
  const err = passErrorAngle(w, p, 0.7, d);
  const ang = Math.atan2(ty - p.y, tx - p.x) + err;

  w.stats[p.team].passes += 1;
  kickToward(w, p, p.x + Math.cos(ang) * d, p.y + Math.sin(ang) * d, clamp(d * 0.85, 12, 24), 6.4, rndRange(w, -0.6, 0.6));
  w.ball.passFrom = p;
  w.ball.passLong = true;
  emit(w, "cross", { player: p.data, team: p.team });
  markOffsides(w, p);
}

export function doShot(w, p, power = 1, aim = 0, finesse = false) {
  const team = teamOf(w, p);
  const gx = targetGoalX(team);
  const d = dist(p.x, p.y, gx, PITCH.W / 2);
  const aimY = clamp(PITCH.W / 2 + aim * 3.1, GOAL_Y0 + 0.4, GOAL_Y1 - 0.4);

  const skill = attr(p, "shooting") / 100;
  const press = pressureOn(w, p);
  const spreadBase = (1 - skill) * 0.085 + press * 0.012 + Math.max(0, d - 16) * 0.0022;
  const rushed = d < 11 ? 1 + press * 0.35 : 1;
  const spread = (finesse ? spreadBase * 0.68 : spreadBase * (1.15 - power * 0.15)) * rushed;
  const err = rndRange(w, -spread, spread);

  const ang = Math.atan2(aimY - p.y, gx - p.x) + err;
  const speed = finesse ? 20 + power * 6 : 21 + power * 13 + skill * 4;
  /* aim under the bar — wild efforts come from the error angle, not the height */
  const wild = rnd(w) > 0.28 + skill * 0.55;
  const height = wild
    ? rndRange(w, 2.6, 4.6)
    : finesse ? rndRange(w, 0.8, 2.0) : rndRange(w, 0.25, 1.7);
  const flight = d / Math.max(8, speed);
  const vz = Math.max(0, (height + 4.9 * flight * flight) / Math.max(0.25, flight) - 4.9 * flight);
  const spin = finesse ? (p.data.foot === "Left" ? 1 : -1) * rndRange(w, 0.6, 1.4) : rndRange(w, -0.25, 0.25);

  kickToward(w, p, p.x + Math.cos(ang) * d, p.y + Math.sin(ang) * d, speed, clamp(vz, 0, 9), spin);
  const b = w.ball;
  b.inFlightShot = true;
  b.shotPower = power;
  b.passFrom = null;
  w.stats[p.team].shots += 1;
  p.kickCd = 0.42;
  emit(w, "shot", { player: p.data, team: p.team, dist: d, finesse });
}

export function doHeader(w, p, toGoal) {
  const team = teamOf(w, p);
  const b = w.ball;
  const power = 0.5 + (p.data.physical / 100) * 0.28 + ((p.data.look?.height ?? 180) - 178) * 0.006;
  touch(w, p);
  b.owner = null;

  if (toGoal) {
    const gx = targetGoalX(team);
    const aimY = PITCH.W / 2 + rndRange(w, -2.6, 2.6);
    const skill = attr(p, "shooting") / 100;
    const spread = (1 - skill) * 0.1 + 0.02;
    const ang = Math.atan2(aimY - p.y, gx - p.x) + rndRange(w, -spread, spread);
    b.vx = Math.cos(ang) * (13 + power * 8);
    b.vy = Math.sin(ang) * (13 + power * 8);
    b.vz = rndRange(w, -1.5, 1.8);
    b.onTargetCounted = false;
    b.inFlightShot = true;
    b.shotPower = 0.7;
    w.stats[p.team].shots += 1;
    emit(w, "header", { player: p.data, team: p.team });
  } else {
    const ownGoal = ownGoalX(team);
    const nearOwnGoal = Math.abs(p.x - ownGoal) < 14;
    const sliced = nearOwnGoal && rnd(w) < 0.35;
    const tx = sliced ? ownGoal - team.dir * 4 : p.x + team.dir * 18;
    const ty = sliced ? p.y + rndRange(w, -6, 6) : clamp(p.y + rndRange(w, -12, 12), 2, PITCH.W - 2);
    const d = Math.max(1, dist(p.x, p.y, tx, ty));
    b.vx = ((tx - p.x) / d) * (sliced ? 10 : 14);
    b.vy = ((ty - p.y) / d) * (sliced ? 10 : 14);
    b.vz = 4.2;
    emit(w, "headerClear", { player: p.data, team: p.team });
  }
  p.kickCd = 0.4;
  p.controlCd = 0.3;
}

export function doTackle(w, p, slide = false) {
  if (p.tackleCd > 0) return;
  const b = w.ball;
  p.tackleCd = slide ? 1.15 : 0.5;
  if (slide) p.slideT = 0.55;

  const carrier = b.owner;
  const reach = slide ? 3.2 : 2.1;

  /* no carrier — just a lunge at a loose ball */
  if (!carrier || carrier.team === p.team) {
    if (p.controlCd <= 0 && dist(p.x, p.y, b.x, b.y) < reach && b.z < 1.4 && !b.owner) {
      takeBall(w, p);
    }
    return;
  }
  const d = dist(p.x, p.y, carrier.x, carrier.y);
  if (d > reach) return;

  w.stats[p.team].tackles += 1;
  const atk = attr(carrier, "dribbling") * 0.5 + attr(carrier, "physical") * 0.28 + attr(carrier, "pace") * 0.22;
  const def = attr(p, "defending") * 0.58 + attr(p, "physical") * 0.27 + attr(p, "pace") * 0.15;
  const chance = clamp(0.3 + (def - atk) / 210 + (slide ? 0.12 : 0), 0.08, 0.72);

  if (rnd(w) < chance) {
    b.owner = null;
    touch(w, p);
    carrier.controlCd = 0.55;
    carrier.vx *= 0.3;
    carrier.vy *= 0.3;
    if (slide) {
      const team = teamOf(w, p);
      b.vx = team.dir * rndRange(w, 4, 10);
      b.vy = rndRange(w, -6, 6);
      b.vz = 1.2;
      p.controlCd = 0.45;
    } else {
      takeBall(w, p);
    }
    emit(w, "tackleWon", { player: p.data, team: p.team, on: carrier.data });
    return;
  }

  /* missed — was it a foul? */
  const speedIn = Math.hypot(p.vx, p.vy);
  const foulChance = clamp((slide ? 0.4 : 0.16) + speedIn * 0.01 - attr(p, "defending") / 600, 0.05, 0.65);
  if (rnd(w) < foulChance) {
    awardFoul(w, p, carrier, slide, speedIn);
  } else {
    carrier.vx *= 0.86;
    carrier.vy *= 0.86;
    emit(w, "beaten", { player: carrier.data, team: carrier.team });
  }
}

/* ---------------------------- fouls and cards -------------------------- */

function defendersBehind(w, victim) {
  const opp = teamOf(w, victim).dir;
  const goalX = targetGoalX(teamOf(w, victim));
  let count = 0;
  onPitch(w, opponentOf(victim.team)).forEach((o) => {
    if ((goalX - o.x) * opp > 0 && (o.x - victim.x) * opp > 0) count += 1;
  });
  return count;
}

function awardFoul(w, offender, victim, slide, speedIn) {
  w.stats[offender.team].fouls += 1;
  victim.vx = 0;
  victim.vy = 0;
  w.ball.owner = null;
  w.ball.vx *= 0.15;
  w.ball.vy *= 0.15;

  const offenderTeam = teamOf(w, offender);
  const penalty = inBox(victim.x, victim.y, offenderTeam);
  const lastMan = defendersBehind(w, victim) <= 1 && (victim.x - PITCH.L / 2) * teamOf(w, victim).dir > 2;

  let card = null;
  const severity = (slide ? 0.34 : 0.1) + speedIn * 0.012 + rnd(w) * 0.4;
  if (lastMan && !penalty && severity > 0.72) card = "red";
  else if (severity > 0.62) card = "yellow";
  else if (penalty && severity > 0.5) card = "yellow";

  emit(w, "foul", { player: offender.data, team: offender.team, on: victim.data, penalty });

  if (card === "yellow") bookPlayer(w, offender, "yellow");
  else if (card === "red") bookPlayer(w, offender, "red");

  if (penalty) {
    setRestart(w, "penalty", victim.team, 0, 0);
  } else {
    setRestart(w, "freekick", victim.team, victim.x, victim.y);
  }
}

export function bookPlayer(w, p, colour) {
  if (colour === "yellow") {
    p.yellow += 1;
    w.stats[p.team].yellow += 1;
    if (p.yellow >= 2) {
      sendOff(w, p, true);
      return;
    }
    w.cardBanner = { player: p.data, colour: "yellow", team: p.team };
    w.cardBannerT = 2.6;
    emit(w, "yellowCard", { player: p.data, team: p.team });
  } else {
    sendOff(w, p, false);
  }
}

function sendOff(w, p, second) {
  p.red = true;
  p.on = false;
  w.stats[p.team].red += 1;
  const team = w.teams[p.team];
  team.onPitch = team.onPitch.filter((x) => x !== p);
  if (w.ball.owner === p) w.ball.owner = null;
  if (w.controlled === p) w.controlled = pickNearestOutfield(w, w.userTeam, w.ball.x, w.ball.y);
  w.cardBanner = { player: p.data, colour: "red", team: p.team, second };
  w.cardBannerT = 3.2;
  emit(w, "redCard", { player: p.data, team: p.team, second });
}

/* ------------------------------- offside ------------------------------- */

function isOffsidePos(w, p) {
  const team = teamOf(w, p);
  const dir = team.dir;
  if ((p.x - PITCH.L / 2) * dir <= 0) return false;
  if ((p.x - w.ball.x) * dir <= 0.2) return false;
  const oppXs = onPitch(w, opponentOf(p.team)).map((o) => o.x * dir).sort((a, b) => b - a);
  if (oppXs.length < 2) return false;
  const secondLast = oppXs[1];
  return p.x * dir > secondLast + 0.25;
}

function markOffsides(w, kicker) {
  onPitch(w, kicker.team).forEach((m) => {
    m.offside = m !== kicker && isOffsidePos(w, m);
  });
  onPitch(w, opponentOf(kicker.team)).forEach((m) => {
    m.offside = false;
  });
}

function clearOffsides(w) {
  w.players.forEach((p) => {
    p.offside = false;
  });
}

function checkOffsideTouch(w, p) {
  if (!p.offside || w.phase !== "play") return false;
  clearOffsides(w);
  w.stats[p.team].offsides += 1;
  w.ball.owner = null;
  emit(w, "offside", { player: p.data, team: p.team });
  w.refBanner = { text: "OFFSIDE", sub: p.data.name };
  w.refBannerT = 2.2;
  setRestart(w, "freekick", opponentOf(p.team), p.x, p.y);
  return true;
}

/* ------------------------------- restarts ------------------------------ */

function setRestart(w, type, team, x, y) {
  if (w.shootout && w.shootout.state === "live") {
    shootoutResolve(w, false);
    return;
  }
  clearOffsides(w);
  const b = w.ball;
  b.owner = null;
  b.vx = 0;
  b.vy = 0;
  b.vz = 0;
  b.z = 0;
  b.spin = 0;
  b.inFlightShot = false;
  b.passFrom = null;

  let bx;
  let by;
  const teamState = w.teams[team];

  if (type === "throw") {
    bx = clamp(x, 1, PITCH.L - 1);
    by = y < PITCH.W / 2 ? 0 : PITCH.W;
  } else if (type === "corner") {
    bx = x < PITCH.L / 2 ? 0.6 : PITCH.L - 0.6;
    by = y < PITCH.W / 2 ? 0.6 : PITCH.W - 0.6;
    w.stats[team].corners += 1;
  } else if (type === "goalkick") {
    const gx = ownGoalX(teamState);
    bx = gx === 0 ? PITCH.SIX_D : PITCH.L - PITCH.SIX_D;
    by = PITCH.W / 2 + (y < PITCH.W / 2 ? -6 : 6);
  } else if (type === "penalty") {
    const gx = targetGoalX(teamState);
    bx = gx === 0 ? PITCH.SPOT : PITCH.L - PITCH.SPOT;
    by = PITCH.W / 2;
  } else {
    bx = clamp(x, 1.5, PITCH.L - 1.5);
    by = clamp(y, 1.5, PITCH.W - 1.5);
  }
  if (bx === undefined) bx = clamp(x, 1.5, PITCH.L - 1.5);
  if (by === undefined) by = clamp(y, 1.5, PITCH.W - 1.5);

  b.x = bx;
  b.y = by;

  const taker = chooseTaker(w, type, team, bx, by);
  w.phase = "dead";
  w.restart = {
    type,
    team,
    x: bx,
    y: by,
    taker,
    setupT: type === "penalty" ? 2.4 : 1.5,
    autoT: type === "penalty" ? 9 : 6.5,
    ready: false,
    aim: 0,
    charge: 0,
  };
  emit(w, type === "penalty" ? "penaltyAwarded" : type, { team, x: bx, y: by });
}

function chooseTaker(w, type, team, x, y) {
  const squad = onPitch(w, team);
  if (type === "goalkick") return squad.find((p) => p.role === "GK") || squad[0];
  if (type === "penalty") {
    return squad
      .filter((p) => p.role !== "GK")
      .sort((a, b) => b.data.shooting - a.data.shooting)[0];
  }
  if (type === "corner" || type === "throw") {
    return squad
      .filter((p) => p.role !== "GK")
      .sort((a, b) => dist(a.x, a.y, x, y) - dist(b.x, b.y, x, y))[0];
  }
  /* free kick: a shooter if it is in range, otherwise the nearest passer */
  const gx = targetGoalX(w.teams[team]);
  const range = Math.abs(gx - x);
  const pool = squad.filter((p) => p.role !== "GK");
  if (range < 30) return pool.sort((a, b) => b.data.shooting + b.data.passing - (a.data.shooting + a.data.passing))[0];
  return pool.sort((a, b) => dist(a.x, a.y, x, y) - dist(b.x, b.y, x, y))[0];
}

function restartTargets(w, p) {
  const r = w.restart;
  const team = teamOf(w, p);
  const attackingRestart = r.team === p.team;
  const base = homeSlot(w, p);

  if (p === r.taker) {
    const off = r.type === "throw" ? (r.y < PITCH.W / 2 ? -0.9 : 0.9) : 0;
    if (r.type === "penalty") {
      const back = team.dir * -2.6;
      return { x: r.x + back, y: r.y };
    }
    return { x: r.x - (r.type === "corner" ? 0 : 0.8), y: r.y + off };
  }

  if (r.type === "penalty") {
    /* everyone outside the box, except the two keepers */
    if (p.role === "GK") {
      const gx = ownGoalX(team);
      return { x: gx + (gx === 0 ? 0.4 : -0.4), y: PITCH.W / 2 };
    }
    const spotSide = r.x < PITCH.L / 2 ? 1 : -1;
    return {
      x: r.x + spotSide * (PITCH.BOX_D + 2 + (p.slotIdx % 5)),
      y: clamp(PITCH.W / 2 + ((p.slotIdx % 6) - 2.5) * 5, 4, PITCH.W - 4),
    };
  }

  if (r.type === "corner") {
    const goalX = attackingRestart ? targetGoalX(team) : ownGoalX(team);
    const towardGoal = goalX === 0 ? 1 : -1;
    if (p.role === "GK") {
      return { x: goalX + towardGoal * 1.4, y: PITCH.W / 2 };
    }
    const box = attackingRestart ? p.slotIdx : p.slotIdx + 2;
    return {
      x: goalX + towardGoal * (6 + (box % 4) * 2.6),
      y: clamp(PITCH.W / 2 + (((box * 3) % 7) - 3) * 3.1, 22, PITCH.W - 22),
    };
  }

  if (r.type === "goalkick" && !attackingRestart) {
    return { x: base.x + team.dir * -3, y: base.y };
  }

  /* everyone else backs off the mandatory distance */
  const dx = base.x - r.x;
  const dy = base.y - r.y;
  const d = Math.hypot(dx, dy) || 1;
  if (!attackingRestart && d < 9.15) {
    return { x: r.x + (dx / d) * 9.6, y: r.y + (dy / d) * 9.6 };
  }
  return base;
}

function takeRestart(w, aimHint = 0, power = 0.7) {
  const r = w.restart;
  const p = r.taker;
  if (!p) {
    w.phase = "play";
    w.restart = null;
    return;
  }
  const team = teamOf(w, p);
  w.ball.x = r.x;
  w.ball.y = r.y;
  w.ball.z = r.type === "throw" ? 1.7 : 0;
  w.ball.owner = null;

  if (r.type === "throw") {
    const target = bestPassTarget(w, p, { maxDist: 24 }) || null;
    if (target) {
      const d = dist(r.x, r.y, target.x, target.y);
      kickToward(w, p, target.x, target.y, clamp(8 + d * 0.6, 9, 17), 3.2);
    } else {
      kickToward(w, p, r.x + team.dir * 12, PITCH.W / 2, 12, 3.2);
    }
    w.ball.passFrom = p;
    emit(w, "throwTaken", { team: p.team });
  } else if (r.type === "corner") {
    doCross(w, p);
  } else if (r.type === "goalkick") {
    const target = bestPassTarget(w, p, { maxDist: 55 });
    const tx = target ? target.x : r.x + team.dir * 42;
    const ty = target ? target.y : PITCH.W / 2 + rndRange(w, -18, 18);
    kickToward(w, p, tx, ty, clamp(16 + (p.data.kicking || 60) * 0.09, 16, 27), 7.4);
    w.ball.passFrom = p;
    w.ball.passLong = true;
    emit(w, "goalkickTaken", { team: p.team });
  } else if (r.type === "penalty") {
    doPenaltyKick(w, p, aimHint, power);
  } else {
    const gx = targetGoalX(team);
    const range = dist(r.x, r.y, gx, PITCH.W / 2);
    if (range < 27 && rnd(w) < 0.6) {
      doShot(w, p, 0.8, aimHint, true);
    } else if (range < 42) {
      doCross(w, p);
    } else {
      doPass(w, p, team.dir, 0, { maxDist: 34 });
    }
    emit(w, "freekickTaken", { team: p.team });
  }

  markOffsides(w, p);
  w.phase = "play";
  w.restart = null;
}

function doPenaltyKick(w, p, aim, power) {
  const team = teamOf(w, p);
  const gx = targetGoalX(team);
  const keeper = onPitch(w, opponentOf(p.team)).find((k) => k.role === "GK");
  const aimY = clamp(PITCH.W / 2 + aim * 3.3, GOAL_Y0 + 0.35, GOAL_Y1 - 0.35);
  const skill = attr(p, "shooting") / 100;
  const spread = (1 - skill) * 0.055 + 0.008;
  const ang = Math.atan2(aimY - p.y, gx - p.x) + rndRange(w, -spread, spread);
  const speed = 22 + power * 9;

  if (keeper) {
    /* the keeper commits: he guesses a side just before contact */
    const guess = rnd(w);
    keeper.diveDir = guess < 0.36 ? -1 : guess < 0.72 ? 1 : 0;
    keeper.diveT = 0.85;
    keeper.penaltyGuess = keeper.diveDir;
  }

  kickToward(w, p, p.x + Math.cos(ang) * 14, p.y + Math.sin(ang) * 14, speed, rndRange(w, 0.2, 2.1));
  w.ball.inFlightShot = true;
  w.ball.shotPower = power;
  w.stats[p.team].shots += 1;
  emit(w, "penaltyTaken", { player: p.data, team: p.team });
}

/* ------------------------------- keeper -------------------------------- */

function keeperClaim(w, gk) {
  const b = w.ball;
  const shot = b.inFlightShot;
  const power = Math.hypot(b.vx, b.vy);
  const handling = attr(gk, "handling") / 100;
  const hold = !shot ? true : rnd(w) < clamp(handling - power * 0.012, 0.15, 0.9);

  if (shot) {
    w.stats[gk.team].saves += 1;
    emit(w, "save", { player: gk.data, team: gk.team, power });
  }
  b.inFlightShot = false;

  if (hold) {
    takeBall(w, gk);
    gk.holdT = rndRange(w, 1.4, 2.4);
  } else {
    const team = teamOf(w, gk);
    b.owner = null;
    touch(w, gk);
    /* keepers push the ball round the post far more often than they
       parry it back into danger */
    const behind = rnd(w) < 0.55;
    b.vx = behind ? -team.dir * rndRange(w, 6, 13) : team.dir * rndRange(w, 5, 12);
    b.vy = rndRange(w, -11, 11);
    b.vz = rndRange(w, 1, 4);
    gk.controlCd = 0.5;
    emit(w, "parry", { player: gk.data, team: gk.team });
  }
}

function keeperUpdate(w, gk, dt) {
  const b = w.ball;
  const team = teamOf(w, gk);
  const gx = ownGoalX(team);
  const towardPitch = gx === 0 ? 1 : -1;

  if (b.owner === gk) {
    gk.holdT -= dt;
    steer(w, gk, gx + towardPitch * 4.5, PITCH.W / 2, dt, 0.6);
    if (gk.holdT <= 0 && w.phase === "play") {
      const target = bestPassTarget(w, gk, { maxDist: 55 });
      if (target) {
        const d = dist(gk.x, gk.y, target.x, target.y);
        kickToward(w, gk, target.x, target.y, clamp(11 + d * 0.55, 12, 26), d > 22 ? 6.5 : 1.2);
        w.ball.passFrom = gk;
        w.ball.passLong = d > 22;
        w.stats[gk.team].passes += 1;
      } else {
        kickToward(w, gk, gk.x + team.dir * 45, PITCH.W / 2 + rndRange(w, -20, 20), 24, 7.5);
        w.ball.passFrom = gk;
        w.ball.passLong = true;
      }
      emit(w, "keeperDistribution", { player: gk.data, team: gk.team });
      markOffsides(w, gk);
    }
    return;
  }

  const ballDist = dist(gk.x, gk.y, gx, PITCH.W / 2);
  const ballToGoal = dist(b.x, b.y, gx, PITCH.W / 2);

  /* stand on the bisector between ball and goal centre */
  const dx = b.x - gx;
  const dy = b.y - PITCH.W / 2;
  const dd = Math.max(0.5, Math.hypot(dx, dy));
  const advance = clamp(1.1 + (1 - Math.min(1, ballToGoal / 40)) * 5.4, 1.1, 6.5);
  let tx = gx + (dx / dd) * advance;
  let ty = PITCH.W / 2 + (dy / dd) * advance * 1.35;

  /* rush out for a loose ball in the box */
  const looseInBox = !b.owner && inBox(b.x, b.y, team) && b.z < 1.6;
  const dangerous = b.owner && b.owner.team !== gk.team && inBox(b.x, b.y, team);
  if (looseInBox || (dangerous && ballToGoal < 12)) {
    tx = b.x;
    ty = b.y;
  }

  /* read the shot and get across the goal */
  if (b.inFlightShot && !b.owner) {
    const vx = b.vx;
    const towardGoal = (gx === 0 && vx < -1) || (gx === PITCH.L && vx > 1);
    if (towardGoal) {
      const t = (gx - b.x) / vx;
      if (t > 0 && t < 1.8) {
        const py = b.y + b.vy * t;
        const reflex = attr(gk, "reflexes") / 100;
        const read = attr(gk, "positioning") / 100;
        const guess = py + rndRange(w, -1, 1) * (1.6 - read * 1.2);
        ty = clamp(guess, GOAL_Y0 - 1.4, GOAL_Y1 + 1.4);
        tx = gx + towardPitch * clamp(advance * 0.35, 0.4, 1.6);
        if (t < 0.7 && gk.diveT <= 0) {
          gk.diveT = 0.5;
          gk.diveDir = Math.sign(guess - gk.y) || 0;
        }
        steer(w, gk, tx, ty, dt, 1.15 + reflex * 0.35);
        clampKeeper(gk, gx);
        return;
      }
    }
  }

  const speedScale = ballToGoal < 25 ? 0.95 : 0.6;
  steer(w, gk, tx, ty, dt, speedScale);
  clampKeeper(gk, gx);
  if (ballDist > 0) gk.holdT = 0;
}

function clampKeeper(gk, gx) {
  const minX = gx === 0 ? -1.2 : PITCH.L - 18;
  const maxX = gx === 0 ? 18 : PITCH.L + 1.2;
  gk.x = clamp(gk.x, minX, maxX);
  gk.y = clamp(gk.y, PITCH.W / 2 - 16, PITCH.W / 2 + 16);
}

function keeperReach(w, gk) {
  const diving = attr(gk, "diving") / 100;
  return 1.15 + diving * 1.35 + (gk.diveT > 0 ? 1.15 : 0);
}

/* ---------------------------- ball out of play ------------------------- */

function checkBounds(w) {
  const b = w.ball;
  if (w.phase !== "play") return;

  /* goal lines */
  if (b.x <= 0 || b.x >= PITCH.L) {
    const atHome = b.x <= 0;
    const goalX = atHome ? 0 : PITCH.L;
    const defendingTeam = w.teams.find((t) => ownGoalX(t) === goalX);
    const attackingTeam = w.teams[opponentOf(defendingTeam.index)];
    const insideMouth = b.y > GOAL_Y0 - 0.2 && b.y < GOAL_Y1 + 0.2 && b.z < PITCH.GOAL_H + 0.2;

    if (insideMouth) {
      const keeper = onPitch(w, defendingTeam.index).find((k) => k.role === "GK");
      /* save chance at the line — deflections count too */
      if (keeper) {
        const reach = keeperReach(w, keeper);
        const dy = Math.abs(b.y - keeper.y);
        const highBall = b.z > 2.1 ? 0.55 : 1;
        if (dy < reach * highBall) {
          const power = Math.hypot(b.vx, b.vy);
          const chance = clamp(0.93 - Math.max(0, power - 20) * 0.007 - (dy / reach) * 0.28, 0.42, 0.97);
          if (rnd(w) < chance) {
            b.x = goalX + (atHome ? 0.4 : -0.4);
            keeper.diveT = Math.max(keeper.diveT, 0.55);
            keeper.diveDir = Math.sign(b.y - keeper.y) || 0;
            keeperClaim(w, keeper);
            return;
          }
        }
      }

      /* woodwork */
      const postHit = Math.abs(b.y - GOAL_Y0) < 0.14 || Math.abs(b.y - GOAL_Y1) < 0.14;
      const barHit = Math.abs(b.z - PITCH.GOAL_H) < 0.14;
      if ((postHit || barHit) && b.inFlightShot) {
        b.x = goalX + (atHome ? 0.35 : -0.35);
        b.vx *= -0.55;
        b.vy = barHit ? b.vy * 0.6 : -b.vy * 0.6;
        b.vz = barHit ? -2 : b.vz * 0.5;
        b.inFlightShot = false;
        emit(w, barHit ? "crossbar" : "post", { team: attackingTeam.index });
        return;
      }

      if (b.z <= PITCH.GOAL_H) {
        scoreGoal(w, attackingTeam.index);
        return;
      }
    }

    /* corner or goal kick */
    const lastTeam = b.lastTouchTeam;
    if (b.inFlightShot && lastTeam === attackingTeam.index) w.stats[attackingTeam.index].onTarget += 0;
    b.inFlightShot = false;

    if (lastTeam === defendingTeam.index) {
      setRestart(w, "corner", attackingTeam.index, goalX, b.y);
    } else {
      setRestart(w, "goalkick", defendingTeam.index, goalX, b.y);
    }
    return;
  }

  /* touchlines */
  if (b.y <= 0 || b.y >= PITCH.W) {
    const throwTeam = b.lastTouchTeam === 0 ? 1 : 0;
    b.inFlightShot = false;
    setRestart(w, "throw", throwTeam, b.x, b.y <= 0 ? 0 : PITCH.W);
  }
}

/** track shots on target as the ball travels goalwards */
function trackOnTarget(w) {
  const b = w.ball;
  if (!b.inFlightShot || b.onTargetCounted) return;
  const shooterTeam = b.lastTouchTeam;
  if (shooterTeam < 0) return;
  const team = w.teams[shooterTeam];
  const gx = targetGoalX(team);
  const vx = b.vx;
  if ((gx === 0 && vx >= -0.5) || (gx === PITCH.L && vx <= 0.5)) return;
  const t = (gx - b.x) / vx;
  if (t < 0 || t > 2.5) return;
  const py = b.y + b.vy * t;
  const pz = b.z + b.vz * t - 4.9 * t * t;
  if (py > GOAL_Y0 && py < GOAL_Y1 && pz > 0 && pz < PITCH.GOAL_H) {
    w.stats[shooterTeam].onTarget += 1;
    b.onTargetCounted = true;
  }
}

function scoreGoal(w, teamIdx) {
  if (w.shootout && w.shootout.state === "live") {
    shootoutResolve(w, true);
    return;
  }
  w.score[teamIdx] += 1;
  w.stats[teamIdx].goals += 1;
  const scorer = w.ball.lastTouch;
  const assist = w.ball.assistFrom;
  w.lastGoal = {
    team: teamIdx,
    scorer: scorer ? scorer.data : null,
    assist: assist && assist.team === teamIdx ? assist.data : null,
    minute: Math.floor(w.displayMinute),
    ownGoal: scorer ? scorer.team !== teamIdx : false,
  };
  w.log.push({ ...w.lastGoal, type: "goal" });
  emit(w, "goal", { team: teamIdx, scorer: scorer ? scorer.data : null, score: [...w.score] });

  w.phase = "goal";
  w.phaseT = 3.4;
  w.kickoffTeam = opponentOf(teamIdx);
  w.ball.owner = null;
  w.ball.inFlightShot = false;
  clearOffsides(w);
}

/* --------------------------------- AI ---------------------------------- */

const DIFFICULTY = {
  easy: { think: 0.34, err: 1.35, press: 0.78, tackle: 0.55, line: 0.85 },
  normal: { think: 0.22, err: 1.0, press: 1.0, tackle: 0.75, line: 1.0 },
  hard: { think: 0.14, err: 0.78, press: 1.18, tackle: 0.9, line: 1.12 },
};

function diff(w, team) {
  /* the user's own team-mates always behave at "normal" quality */
  if (w.teams[team].isUser) return DIFFICULTY.normal;
  return DIFFICULTY[w.cfg.difficulty] || DIFFICULTY.normal;
}

function offsideLineX(w, teamIdx) {
  const dir = w.teams[teamIdx].dir;
  const xs = onPitch(w, opponentOf(teamIdx)).map((o) => o.x * dir).sort((a, b) => b - a);
  const secondLast = xs.length >= 2 ? xs[1] : (dir === 1 ? PITCH.L : 0) * dir;
  return secondLast * dir;
}

function shapeTarget(w, p) {
  const team = teamOf(w, p);
  const b = w.ball;
  const base = homeSlot(w, p);
  const attacking = b.owner ? b.owner.team === p.team : false;
  const adv = (b.x - PITCH.L / 2) * team.dir;
  const line = p.role === "GK" ? "gk"
    : ["LB", "CB", "RB", "LWB", "RWB"].includes(p.role) ? "def"
      : ["LW", "RW", "ST", "CF"].includes(p.role) ? "att" : "mid";

  let push;
  if (attacking) push = clamp(adv * 0.55 + 7, -8, 27);
  else push = clamp(adv * 0.62 - 2, -14, 18);
  if (line === "def") push *= 0.85;
  if (line === "att") push *= 1.12;

  let x = base.x + team.dir * push;
  const yPull = line === "def" ? 0.42 : line === "mid" ? 0.33 : 0.2;
  let y = base.y + (b.y - PITCH.W / 2) * yPull;

  if (attacking && line === "att") {
    /* make a run, but stay onside */
    const lineX = offsideLineX(w, p.team);
    const runX = x + team.dir * (p.chaseUntil > w.time ? 12 : 4);
    x = team.dir === 1 ? Math.min(runX, lineX + 0.6) : Math.max(runX, lineX - 0.6);
  }
  if (attacking && (p.role === "LB" || p.role === "RB" || p.role === "LWB" || p.role === "RWB")) {
    /* overlap when the ball is on this player's flank */
    const sameSide = Math.abs(b.y - base.y) < 20;
    if (sameSide && adv > -6) x += team.dir * 8;
  }

  return {
    x: clamp(x, 1.5, PITCH.L - 1.5),
    y: clamp(y, 1.5, PITCH.W - 1.5),
  };
}

function nearestOpponentToBall(w, teamIdx) {
  const b = w.ball;
  let best = null;
  let bestD = Infinity;
  onPitch(w, teamIdx).forEach((p) => {
    if (p.role === "GK") return;
    const d = dist(p.x, p.y, b.x, b.y);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  });
  return best;
}

function carrierDecision(w, p, dt) {
  const team = teamOf(w, p);
  const d = diff(w, p.team);
  const gx = targetGoalX(team);
  const goalDist = dist(p.x, p.y, gx, PITCH.W / 2);
  const press = pressureOn(w, p);

  p.think = (p.think ?? 0) - dt;
  if (p.think > 0) {
    /* keep carrying toward the target chosen last decision */
    const t = p.runTarget || { x: gx, y: PITCH.W / 2 };
    steer(w, p, t.x, t.y, dt, 1);
    return;
  }
  p.think = d.think + rnd(w) * 0.12;
  p.sprinting = press > 0.4 && p.stamina > 25;

  const angleOk = Math.abs(p.y - PITCH.W / 2) < 16 + Math.max(0, 24 - goalDist) * 0.5;
  const shootUrge = goalDist < 17 && angleOk ? 0.62 : goalDist < 26 && angleOk ? 0.13 : 0;
  const shooting = attr(p, "shooting") / 100;
  /* a defender right in front of the shot puts most players off */
  let blocked = false;
  onPitch(w, opponentOf(p.team)).forEach((o) => {
    if (o.role === "GK") return;
    if ((o.x - p.x) * team.dir > 0 && (o.x - p.x) * team.dir < 2.6 && Math.abs(o.y - p.y) < 1.7) blocked = true;
  });

  if (!blocked && p.kickCd <= 0 && rnd(w) < shootUrge * (0.55 + shooting * 0.7)) {
    doShot(w, p, clamp(goalDist / 26, 0.45, 1), rndRange(w, -0.9, 0.9), goalDist < 20 && rnd(w) < 0.4);
    return;
  }

  const wide = Math.abs(p.y - PITCH.W / 2) > 18;
  const finalThird = (p.x - PITCH.L / 2) * team.dir > 14;
  if (p.kickCd <= 0 && wide && finalThird && rnd(w) < 0.35) {
    doCross(w, p);
    return;
  }

  if (p.kickCd <= 0 && rnd(w) < 0.16 + press * 0.1) {
    if (rnd(w) < 0.3) doThroughBall(w, p, team.dir, 0);
    else doPass(w, p, team.dir, (rnd(w) - 0.5) * 0.7);
    return;
  }

  if (press > 1.1 && p.kickCd <= 0) {
    doPass(w, p, team.dir, (rnd(w) - 0.5) * 1.2);
    return;
  }

  /* dribble into space toward goal */
  let bestX = gx;
  let bestY = PITCH.W / 2;
  let bestScore = -Infinity;
  for (let a = -3; a <= 3; a += 1) {
    const ang = Math.atan2(PITCH.W / 2 - p.y, gx - p.x) + a * 0.34;
    const tx = p.x + Math.cos(ang) * 9;
    const ty = p.y + Math.sin(ang) * 9;
    if (tx < 1 || tx > PITCH.L - 1 || ty < 2 || ty > PITCH.W - 2) continue;
    let score = -Math.abs(a) * 1.2 + (tx - p.x) * team.dir;
    onPitch(w, opponentOf(p.team)).forEach((o) => {
      const od = dist(tx, ty, o.x, o.y);
      if (od < 8) score -= (8 - od) * 2.2;
    });
    if (score > bestScore) {
      bestScore = score;
      bestX = tx;
      bestY = ty;
    }
  }
  p.runTarget = { x: bestX, y: bestY };
  steer(w, p, bestX, bestY, dt, 1);
}

function defenderAI(w, p, dt, presser, cover) {
  const b = w.ball;
  const d = diff(w, p.team);
  const carrier = b.owner;

  /* head a high ball clear — taller players get to it from further away */
  if (!carrier && b.z > 1.5 && b.z < 3.3 && p.kickCd <= 0) {
    const reach = 1.5 + ((p.data.look?.height ?? 180) - 178) * 0.02;
    if (dist(p.x, p.y, b.x, b.y) < reach) {
      doHeader(w, p, false);
      return;
    }
  }

  if (p === presser) {
    const tx = carrier ? carrier.x + carrier.vx * 0.22 : b.x + b.vx * 0.3;
    const ty = carrier ? carrier.y + carrier.vy * 0.22 : b.y + b.vy * 0.3;
    p.sprinting = p.stamina > 22;
    steer(w, p, tx, ty, dt, 1.02 * d.press);
    if (carrier && carrier.team !== p.team) {
      const gap = dist(p.x, p.y, carrier.x, carrier.y);
      if (gap < 1.5 && p.tackleCd <= 0 && rnd(w) < d.tackle * dt * 1.9) {
        doTackle(w, p, rnd(w) < 0.12 && gap > 1.1);
      }
    } else if (!carrier && p.controlCd <= 0 && dist(p.x, p.y, b.x, b.y) < 1.6 && b.z < 1.5) {
      takeBall(w, p);
    }
    return;
  }

  const shape = shapeTarget(w, p);
  if (p === cover && carrier) {
    const team = teamOf(w, p);
    const gx = ownGoalX(team);
    /* the nearest presser may be the player the user is controlling, so
       the covering man has to be ready to make the challenge himself */
    const pressBusy = presser && presser !== w.controlled;
    const tightness = pressBusy ? 0.6 : 0.85;
    const tx = lerp(carrier.x, gx, pressBusy ? 0.22 : 0.1);
    const ty = lerp(carrier.y, PITCH.W / 2, pressBusy ? 0.2 : 0.08);
    p.sprinting = !pressBusy && p.stamina > 25;
    steer(w, p, lerp(shape.x, tx, tightness), lerp(shape.y, ty, tightness), dt, pressBusy ? 0.95 : 1.02);
    const gap = dist(p.x, p.y, carrier.x, carrier.y);
    if (gap < 1.5 && p.tackleCd <= 0 && rnd(w) < d.tackle * dt * (pressBusy ? 0.7 : 1.7)) {
      doTackle(w, p, false);
    }
    return;
  }

  /* zone marking: pick up the nearest dangerous opponent close to my zone */
  let mark = null;
  let markD = 9;
  onPitch(w, opponentOf(p.team)).forEach((o) => {
    if (o.role === "GK") return;
    const dd = dist(shape.x, shape.y, o.x, o.y);
    if (dd < markD) {
      markD = dd;
      mark = o;
    }
  });

  let tx = shape.x;
  let ty = shape.y;
  if (mark) {
    const mteam = teamOf(w, p);
    const mgx = ownGoalX(mteam);
    const gside = Math.sign(mgx - mark.x) || mteam.dir * -1;
    const deep = Math.abs(mark.x - mgx) < 30;
    const tight = deep ? 0.85 : 0.55;
    tx = lerp(shape.x, mark.x + gside * 1.2, tight);
    ty = lerp(shape.y, mark.y, tight);
  }
  const team = teamOf(w, p);
  const gx = ownGoalX(team);
  const ballBehind = Math.abs(b.x - gx) < Math.abs(p.x - gx) - 1;
  p.sprinting = (ballBehind || dist(p.x, p.y, tx, ty) > 12) && p.stamina > 25;
  steer(w, p, tx, ty, dt, ballBehind ? 1.04 : 0.92);

  /* read a pass and step across it */
  if (!b.owner && b.z < 1.6 && p.controlCd <= 0) {
    const lane = dist(p.x, p.y, b.x + b.vx * 0.18, b.y + b.vy * 0.18);
    if (lane < 4.5 && rnd(w) < attr(p, "defending") / 100 * d.press * dt * 2.2) {
      const ip = interceptPoint(w, p, 1.1);
      if (ip) {
        p.sprinting = p.stamina > 20;
        steer(w, p, ip.x, ip.y, dt, 1.05);
      }
    }
  }
}

function attackerSupportAI(w, p, dt) {
  const b = w.ball;
  const shape = shapeTarget(w, p);
  let tx = shape.x;
  let ty = shape.y;

  /* the closest team-mate offers a short option, others hold width */
  const mates = onPitch(w, p.team).filter((m) => m !== p && m !== b.owner);
  const supportRank = mates.filter((m) => dist(m.x, m.y, b.x, b.y) < dist(p.x, p.y, b.x, b.y)).length;
  if (supportRank < 2 && b.owner && b.owner.team === p.team) {
    const team = teamOf(w, p);
    tx = lerp(shape.x, b.owner.x + team.dir * 7, 0.35);
    ty = lerp(shape.y, b.owner.y + (p.y > b.owner.y ? 7 : -7), 0.35);
  }
  p.sprinting = p.chaseUntil > w.time && p.stamina > 20;
  steer(w, p, tx, ty, dt, 0.94);

  /* chase a loose ball if closest */
  if (!b.owner && b.z < 1.8) {
    const mine = dist(p.x, p.y, b.x, b.y);
    const closest = w.players.every((o) => !o.on || o === p || dist(o.x, o.y, b.x, b.y) > mine - 0.2);
    if (mine < 14 && closest) {
      p.sprinting = p.stamina > 18;
      steer(w, p, b.x + b.vx * 0.25, b.y + b.vy * 0.25, dt, 1.05);
    }
  }

  /* head a high ball in the box */
  if (!b.owner && b.z > 1.6 && b.z < 3.1 && dist(p.x, p.y, b.x, b.y) < 1.9 && p.kickCd <= 0) {
    const team = teamOf(w, p);
    const goalDist = dist(p.x, p.y, targetGoalX(team), PITCH.W / 2);
    doHeader(w, p, goalDist < 20);
  }
}

function updateAI(w, dt) {
  /* Both teams think in the same frame, so whoever is updated first
     reacts to the other's actions a frame late. Alternating the order
     keeps that advantage from always landing on the same side. */
  w.aiFlip = !w.aiFlip;
  const order = w.aiFlip ? [w.teams[1], w.teams[0]] : [w.teams[0], w.teams[1]];
  order.forEach((team) => {
    const idx = team.index;
    const b = w.ball;
    const defending = !b.owner || b.owner.team !== idx;
    const presser = defending ? nearestOpponentToBall(w, idx) : null;
    let cover = null;
    if (defending) {
      let bestD = Infinity;
      onPitch(w, idx).forEach((p) => {
        if (p === presser || p.role === "GK") return;
        const d = dist(p.x, p.y, b.x, b.y);
        if (d < bestD) {
          bestD = d;
          cover = p;
        }
      });
    }

    team.onPitch.forEach((p) => {
      if (p === w.controlled && team.isUser) return;
      if (p.role === "GK") {
        keeperUpdate(w, p, dt);
        return;
      }
      if (b.owner === p) {
        carrierDecision(w, p, dt);
        return;
      }
      /* the intended receiver runs onto the ball */
      if (!b.owner && p.receiveUntil > w.time && b.intended === p) {
        const ip = interceptPoint(w, p, 2.2);
        p.sprinting = p.stamina > 15 && dist(p.x, p.y, ip.x, ip.y) > 4;
        steer(w, p, ip.x, ip.y, dt, 1.06);
        if (!b.owner && b.z > 1.5 && b.z < 3.1 && dist(p.x, p.y, b.x, b.y) < 1.9 && p.kickCd <= 0) {
          const gd = dist(p.x, p.y, targetGoalX(team), PITCH.W / 2);
          doHeader(w, p, gd < 18);
        }
        return;
      }
      if (defending) defenderAI(w, p, dt, presser, cover);
      else attackerSupportAI(w, p, dt);
    });
  });
}

/* ------------------------------ user input ----------------------------- */

export function makeInput() {
  return {
    mx: 0, my: 0,
    sprint: false,
    pass: false,
    through: false,
    shoot: false,
    shootPower: 1,
    cross: false,
    tackle: false,
    switchPlayer: false,
  };
}

function autoSwitch(w) {
  const b = w.ball;
  if (w.userTeam < 0 || w.switchLock > 0) return;
  const team = w.teams[w.userTeam];
  if (b.owner && b.owner.team === w.userTeam) {
    /* the keeper plays himself: taking control of him would leave the
       ball frozen in his hands, so give the player an outfielder */
    if (b.owner.role === "GK") {
      const out = pickNearestOutfield(w, w.userTeam, b.x, b.y);
      if (out) w.controlled = out;
    } else {
      w.controlled = b.owner;
    }
    return;
  }
  const nearest = pickNearestOutfield(w, w.userTeam, b.x, b.y);
  if (nearest && nearest !== w.controlled) {
    const cur = w.controlled;
    const curD = cur && cur.on ? dist(cur.x, cur.y, b.x, b.y) : Infinity;
    if (dist(nearest.x, nearest.y, b.x, b.y) < curD - 3) w.controlled = nearest;
  }
  if (!w.controlled || !w.controlled.on) w.controlled = nearest || team.onPitch[0];
}

function updateUser(w, input, dt) {
  const p = controlledPlayer(w);
  if (!p) return;
  const b = w.ball;
  const team = teamOf(w, p);
  const hasBall = b.owner === p;

  p.sprinting = input.sprint && p.stamina > 6;

  const mag = Math.hypot(input.mx, input.my);
  if (mag > 0.12) {
    const nx = input.mx / mag;
    const ny = input.my / mag;
    const scale = Math.min(1, mag);
    const want = topSpeed(p) * (p.sprinting ? 1.16 : 1) * (hasBall ? 0.92 : 1) * scale;
    const accel = (17 + (p.data.dribbling / 100) * 8) * dt;
    const dvx = nx * want - p.vx;
    const dvy = ny * want - p.vy;
    const dd = Math.hypot(dvx, dvy);
    if (dd > accel) {
      p.vx += (dvx / dd) * accel;
      p.vy += (dvy / dd) * accel;
    } else {
      p.vx = nx * want;
      p.vy = ny * want;
    }
    p.faceX = nx;
    p.faceY = ny;
  } else {
    const decel = 22 * dt;
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > decel) {
      p.vx -= (p.vx / sp) * decel;
      p.vy -= (p.vy / sp) * decel;
    } else {
      p.vx = 0;
      p.vy = 0;
    }
  }

  const dirX = p.faceX ?? team.dir;
  const dirY = p.faceY ?? 0;

  if (hasBall && p.kickCd <= 0) {
    if (input.shoot) {
      doShot(w, p, clamp(input.shootPower, 0.25, 1), clamp(dirY * 1.1, -1, 1), input.shootPower < 0.42);
    } else if (input.through) {
      doThroughBall(w, p, dirX, dirY);
    } else if (input.cross) {
      doCross(w, p);
    } else if (input.pass) {
      doPass(w, p, dirX, dirY);
    }
  } else if (!hasBall) {
    if (input.tackle) doTackle(w, p, input.sprint);
    if (input.switchPlayer) {
      const others = onPitch(w, w.userTeam)
        .filter((o) => o !== p && o.role !== "GK")
        .sort((a, c) => dist(a.x, a.y, b.x, b.y) - dist(c.x, c.y, b.x, b.y));
      if (others[0]) {
        w.controlled = others[0];
        w.switchLock = 1.1;
      }
    }
    /* head a high ball */
    if ((input.shoot || input.pass) && !b.owner && b.z > 1.5 && b.z < 3.2 && dist(p.x, p.y, b.x, b.y) < 2 && p.kickCd <= 0) {
      doHeader(w, p, !!input.shoot);
    }
  }

  input.pass = false;
  input.through = false;
  input.shoot = false;
  input.cross = false;
  input.tackle = false;
  input.switchPlayer = false;
}

/* ---------------------------- substitutions ---------------------------- */

export function canSub(w, teamIdx) {
  return w.teams[teamIdx].subsUsed < w.cfg.maxSubs;
}

/** Queued while the ball is live, applied at the next stoppage. */
export function requestSub(w, teamIdx, offId, onId) {
  const team = w.teams[teamIdx];
  if (!canSub(w, teamIdx)) return { ok: false, reason: "No substitutions left" };
  const off = team.onPitch.find((p) => p.id === offId);
  const on = team.bench.find((p) => p.id === onId);
  if (!off || !on) return { ok: false, reason: "Player not available" };
  if (on.used) return { ok: false, reason: "Already used" };
  if (w.pendingSubs[teamIdx].some((s) => s.offId === offId || s.onId === onId)) {
    return { ok: false, reason: "Already queued" };
  }
  w.pendingSubs[teamIdx].push({ offId, onId });
  emit(w, "subPrepared", { team: teamIdx, on: on.data, off: off.data });
  if (w.phase !== "play") applyPendingSubs(w);
  return { ok: true };
}

export function applyPendingSubs(w) {
  w.pendingSubs.forEach((queue, teamIdx) => {
    const team = w.teams[teamIdx];
    while (queue.length) {
      const { offId, onId } = queue.shift();
      const off = team.onPitch.find((p) => p.id === offId);
      const on = team.bench.find((p) => p.id === onId);
      if (!off || !on || on.used || !canSub(w, teamIdx)) continue;

      on.on = true;
      on.used = true;
      on.slotIdx = off.slotIdx;
      on.role = off.role;
      on.x = off.x;
      on.y = off.y;
      on.vx = 0;
      on.vy = 0;
      on.stamina = clamp(100 - w.displayMinute * 0.08, 82, 100);

      off.on = false;
      if (w.ball.owner === off) w.ball.owner = null;
      team.onPitch = team.onPitch.map((p) => (p === off ? on : p));
      team.bench = team.bench.filter((p) => p !== on);
      team.subsUsed += 1;
      if (w.controlled === off) w.controlled = on;

      w.subBanner = { team: teamIdx, on: on.data, off: off.data };
      w.subBannerT = 3.4;
      w.log.push({ type: "sub", team: teamIdx, on: on.data, off: off.data, minute: Math.floor(w.displayMinute) });
      emit(w, "substitution", { team: teamIdx, on: on.data, off: off.data });
    }
  });
}

/** The CPU manager: bring on fresh legs when his players are tiring. */
function considerAiSubs(w) {
  w.teams.forEach((team) => {
    if (team.isUser && w.userTeam >= 0) return;
    if (team.subsUsed >= w.cfg.maxSubs) return;
    if (w.pendingSubs[team.index].length) return;
    if (w.displayMinute - (team.lastSubMinute ?? -20) < 8) return;

    const tired = team.onPitch
      .filter((p) => p.role !== "GK")
      .sort((a, b) => a.stamina - b.stamina)[0];
    if (!tired) return;

    const urgent = tired.stamina < 32;
    if (!urgent && (tired.stamina > 52 || w.displayMinute < 50)) return;
    if (team.subsUsed >= 3 && !urgent) return;

    const line = ROLE_LINE[tired.role];
    const replacement = team.bench
      .filter((p) => !p.used && p.data.position !== "GK")
      .sort((a, b) => {
        const fitA = ROLE_LINE[a.data.position] === line ? 8 : 0;
        const fitB = ROLE_LINE[b.data.position] === line ? 8 : 0;
        return (b.data.overall + fitB) - (a.data.overall + fitA);
      })[0];
    if (!replacement) return;

    team.lastSubMinute = w.displayMinute;
    requestSub(w, team.index, tired.id, replacement.id);
  });
}

/* -------------------------- clock and structure ------------------------ */

const HALF_BASE = { 1: 0, 2: 45, 3: 90, 4: 105 };
const HALF_LENGTH = { 1: 45, 2: 45, 3: 15, 4: 15 };

function halfSeconds(w) {
  return w.cfg.halfSeconds * (HALF_LENGTH[w.half] / 45);
}

function updateClock(w, dt) {
  if (w.phase === "goal" || w.phase === "halftime" || w.phase === "fulltime" ||
      w.phase === "etBreak" || w.phase === "shootout" || w.phase === "ended") return;
  w.halfElapsed += dt;
  const frac = w.halfElapsed / halfSeconds(w);
  w.displayMinute = HALF_BASE[w.half] + frac * HALF_LENGTH[w.half];

  const endMinute = HALF_BASE[w.half] + HALF_LENGTH[w.half];
  if (!w.warned5 && w.half <= 2 && w.displayMinute >= endMinute - 5) {
    w.warned5 = true;
    emit(w, "fiveMinutesLeft", { half: w.half });
  }

  if (w.displayMinute >= endMinute) {
    const dangerous = w.phase === "play" && (inBox(w.ball.x, w.ball.y, w.teams[0]) || inBox(w.ball.x, w.ball.y, w.teams[1]));
    if (!dangerous || w.displayMinute >= endMinute + 1.6) endHalf(w);
  }
}

function endHalf(w) {
  w.displayMinute = HALF_BASE[w.half] + HALF_LENGTH[w.half];
  considerAiSubs(w);
  applyPendingSubs(w);
  w.ball.owner = null;
  w.ball.vx = 0;
  w.ball.vy = 0;
  w.restart = null;

  if (w.half === 1) {
    w.phase = "halftime";
    emit(w, "halftime", { score: [...w.score] });
    return;
  }
  if (w.half === 2) {
    const drawn = w.score[0] === w.score[1];
    if (w.cfg.knockout && drawn) {
      w.phase = "etBreak";
      emit(w, "fulltimeDraw", { score: [...w.score] });
    } else {
      finishMatch(w);
    }
    return;
  }
  if (w.half === 3) {
    w.phase = "etBreak";
    emit(w, "extraTimeHalftime", { score: [...w.score] });
    return;
  }
  /* end of the second period of extra time */
  if (w.score[0] === w.score[1]) {
    startShootout(w);
  } else {
    finishMatch(w);
  }
}

function finishMatch(w) {
  w.phase = "fulltime";
  w.finished = true;
  const [a, b] = w.score;
  w.result = {
    score: [...w.score],
    winner: a === b ? null : a > b ? 0 : 1,
    onPenalties: false,
  };
  emit(w, "fulltime", { score: [...w.score] });
}

/** Called by the UI from the halftime / extra time break screens. */
export function startNextPeriod(w) {
  if (w.phase === "halftime") {
    w.half = 2;
    w.kickoffTeam = 1;
  } else if (w.phase === "etBreak" && w.half === 2) {
    w.half = 3;
    w.kickoffTeam = 0;
  } else if (w.phase === "etBreak" && w.half === 3) {
    w.half = 4;
    w.kickoffTeam = 1;
  } else {
    return;
  }
  /* teams change ends at the break */
  if (w.half === 2 || w.half === 3) {
    w.teams.forEach((t) => {
      t.dir *= -1;
    });
  }
  w.halfElapsed = 0;
  w.warned5 = false;
  w.displayMinute = HALF_BASE[w.half];
  applyPendingSubs(w);
  resetPositions(w, w.kickoffTeam);
  w.phase = "kickoff";
  w.phaseT = 1.8;
  w.players.forEach((p) => {
    if (p.on) p.stamina = clamp(p.stamina + (w.half === 2 ? 16 : 8), 0, 100);
  });
  emit(w, "periodStart", { half: w.half });
}

/* ----------------------------- shootout -------------------------------- */

function startShootout(w) {
  const takers = w.teams.map((team) =>
    team.onPitch
      .filter((p) => p.role !== "GK")
      .sort((a, b) => b.data.shooting - a.data.shooting)
      .slice(0, 11));
  w.shootout = {
    takers,
    idx: [0, 0],
    scores: [0, 0],
    kicks: [[], []],
    turn: 0,
    round: 1,
    state: "setup",
    timer: 1.4,
    aim: 0,
    lastResult: null,
    winner: null,
  };
  w.phase = "shootout";
  emit(w, "shootoutStart", {});
}

function shootoutSetup(w) {
  const s = w.shootout;
  const teamIdx = s.turn;
  const team = w.teams[teamIdx];
  const taker = s.takers[teamIdx][s.idx[teamIdx] % s.takers[teamIdx].length];
  const keeper = onPitch(w, opponentOf(teamIdx)).find((k) => k.role === "GK");
  const gx = targetGoalX(team);
  const spotX = gx === 0 ? PITCH.SPOT : PITCH.L - PITCH.SPOT;

  w.players.forEach((p) => {
    if (!p.on) return;
    p.vx = 0;
    p.vy = 0;
    if (p === taker) {
      p.x = spotX - team.dir * 3;
      p.y = PITCH.W / 2;
    } else if (p === keeper) {
      p.x = gx + (gx === 0 ? 0.45 : -0.45);
      p.y = PITCH.W / 2;
    } else {
      p.x = PITCH.L / 2 + (p.team === 0 ? -6 : 6);
      p.y = 6 + ((p.slotIdx + 3) % 10) * 5.6;
    }
  });

  const b = w.ball;
  b.x = spotX;
  b.y = PITCH.W / 2;
  b.z = 0;
  b.vx = 0;
  b.vy = 0;
  b.vz = 0;
  b.owner = null;
  b.inFlightShot = false;
  b.onTargetCounted = false;
  s.taker = taker;
  s.keeper = keeper;
  s.state = "aim";
  s.timer = w.teams[teamIdx].isUser ? 6 : 1.3;
  s.aim = 0;
}

function shootoutResolve(w, scored) {
  const s = w.shootout;
  if (!s || s.state !== "live") return;
  const teamIdx = s.turn;
  s.kicks[teamIdx].push(scored);
  if (scored) s.scores[teamIdx] += 1;
  s.idx[teamIdx] += 1;
  s.state = "result";
  s.timer = 2;
  s.lastResult = { team: teamIdx, scored, player: s.taker ? s.taker.data : null };
  emit(w, scored ? "shootoutScored" : "shootoutMissed", { team: teamIdx, scores: [...s.scores] });

  const a = s.kicks[0].length;
  const bTaken = s.kicks[1].length;
  const left0 = Math.max(0, 5 - a);
  const left1 = Math.max(0, 5 - bTaken);
  const inFirstFive = a <= 5 && bTaken <= 5;

  if (inFirstFive) {
    if (s.scores[0] > s.scores[1] + left1) s.winner = 0;
    else if (s.scores[1] > s.scores[0] + left0) s.winner = 1;
  }
  if (a >= 5 && bTaken >= 5 && a === bTaken && s.scores[0] !== s.scores[1]) {
    s.winner = s.scores[0] > s.scores[1] ? 0 : 1;
  }
  if (s.winner !== null) {
    w.phase = "fulltime";
    w.finished = true;
    w.result = { score: [...w.score], winner: s.winner, onPenalties: true, shootout: [...s.scores] };
    emit(w, "shootoutWin", { team: s.winner, scores: [...s.scores] });
  }
}

function shootoutStep(w, dt, input) {
  const s = w.shootout;
  s.timer -= dt;
  const userTurn = w.teams[s.turn].isUser;

  if (s.state === "setup") {
    if (s.timer <= 0) shootoutSetup(w);
    return;
  }

  if (s.state === "aim") {
    if (userTurn) {
      s.aim = clamp(s.aim + input.mx * dt * 1.6, -1, 1);
      if (input.shoot || s.timer <= 0) {
        input.shoot = false;
        doPenaltyKick(w, s.taker, s.aim, clamp(input.shootPower || 0.85, 0.4, 1));
        s.state = "live";
        s.timer = 4.5;
      }
    } else if (s.timer <= 0) {
      const skill = s.taker ? s.taker.data.shooting / 100 : 0.7;
      doPenaltyKick(w, s.taker, rndRange(w, -1, 1) * (0.55 + skill * 0.4), rndRange(w, 0.7, 1));
      s.state = "live";
      s.timer = 4.5;
    }
    return;
  }

  if (s.state === "live") {
    updateBall(w, dt);
    const keeper = s.keeper;
    if (keeper) {
      keeper.diveT = Math.max(0, keeper.diveT - dt);
      const reach = keeperReach(w, keeper);
      const b = w.ball;
      const gx = ownGoalX(w.teams[keeper.team]);
      if (Math.abs(b.x - gx) < 1.6 && Math.abs(b.y - keeper.y) < reach && b.z < 2.5 && b.vz < 4) {
        const guessedRight = keeper.penaltyGuess === Math.sign(b.y - PITCH.W / 2) || keeper.penaltyGuess === 0;
        const chance = clamp((guessedRight ? 0.62 : 0.12) + attr(keeper, "reflexes") / 400, 0.05, 0.85);
        if (rnd(w) < chance) {
          emit(w, "save", { player: keeper.data, team: keeper.team, power: Math.hypot(b.vx, b.vy) });
          shootoutResolve(w, false);
          return;
        }
      }
      /* dive animation across the goal */
      if (keeper.diveT > 0) keeper.y = clamp(keeper.y + keeper.diveDir * dt * 6.5, PITCH.W / 2 - 4.2, PITCH.W / 2 + 4.2);
    }

    const b = w.ball;
    const scoringTeam = w.teams[s.turn];
    const gx = targetGoalX(scoringTeam);
    const crossed = gx === 0 ? b.x <= 0 : b.x >= PITCH.L;
    if (crossed) {
      const inGoal = b.y > GOAL_Y0 && b.y < GOAL_Y1 && b.z < PITCH.GOAL_H;
      shootoutResolve(w, inGoal);
      return;
    }
    if (b.y <= 0 || b.y >= PITCH.W || s.timer <= 0) shootoutResolve(w, false);
    return;
  }

  if (s.state === "result" && s.timer <= 0 && s.winner === null) {
    s.turn = opponentOf(s.turn);
    if (s.turn === 0) s.round += 1;
    s.state = "setup";
    s.timer = 0.9;
  }
}

/* ------------------------------- main step ----------------------------- */

const FIXED = 1 / 60;

export function stepMatch(w, dtMs, input) {
  let acc = Math.min(dtMs, 120) / 1000;
  while (acc > 0) {
    const dt = Math.min(FIXED, acc);
    tick(w, dt, input);
    acc -= dt;
  }
}

function tick(w, dt, input) {
  w.time += dt;
  w.switchLock = Math.max(0, w.switchLock - dt);
  w.subBannerT = Math.max(0, w.subBannerT - dt);
  w.cardBannerT = Math.max(0, w.cardBannerT - dt);
  w.refBannerT = Math.max(0, w.refBannerT - dt);
  if (w.subBannerT === 0) w.subBanner = null;
  if (w.cardBannerT === 0) w.cardBanner = null;
  if (w.refBannerT === 0) w.refBanner = null;

  if (w.phase === "shootout") {
    shootoutStep(w, dt, input);
    w.players.forEach((p) => {
      if (p.on) p.anim += Math.hypot(p.vx, p.vy) * dt;
    });
    return;
  }

  if (w.phase === "halftime" || w.phase === "fulltime" || w.phase === "etBreak" || w.phase === "ended") {
    return;
  }

  updateClock(w, dt);

  if (w.phase === "goal") {
    w.phaseT -= dt;
    w.players.forEach((p) => {
      if (!p.on) return;
      p.vx *= 0.9;
      p.vy *= 0.9;
      integrate(w, p, dt);
    });
    if (w.phaseT <= 0) {
      applyPendingSubs(w);
      resetPositions(w, w.kickoffTeam);
      w.phase = "kickoff";
      w.phaseT = 1.5;
    }
    return;
  }

  if (w.phase === "kickoff") {
    w.phaseT -= dt;
    if (w.phaseT <= 0) {
      w.phase = "play";
      const taker = w.kickoffTaker && w.kickoffTaker.on
        ? w.kickoffTaker
        : pickNearestOutfield(w, w.kickoffTeam, PITCH.L / 2, PITCH.W / 2);
      if (taker) takeBall(w, taker);
      clearOffsides(w);
      emit(w, "kickoff", { team: w.kickoffTeam, half: w.half });
    }
    return;
  }

  if (w.phase === "dead") {
    deadBallTick(w, dt, input);
    return;
  }

  /* ------------------------------ live play ------------------------------ */
  autoSwitch(w);
  updateUser(w, input, dt);
  updateAI(w, dt);
  w.players.forEach((p) => {
    if (p.on) integrate(w, p, dt);
  });
  updateBall(w, dt);
  contestBall(w);
  trackOnTarget(w);
  checkBounds(w);

  const owner = w.ball.owner;
  if (owner) w.stats[owner.team].possessionMs += dt * 1000;
}

function deadBallTick(w, dt, input) {
  const r = w.restart;
  if (!r) {
    w.phase = "play";
    return;
  }
  if (!r.subsChecked) {
    r.subsChecked = true;
    considerAiSubs(w);
  }
  applyPendingSubs(w);

  r.setupT -= dt;
  r.autoT -= dt;

  const b = w.ball;
  b.x = r.x;
  b.y = r.y;
  b.z = r.type === "throw" ? 1.6 : 0;
  b.vx = 0;
  b.vy = 0;
  b.vz = 0;
  b.owner = null;

  w.teams.forEach((team) => {
    team.onPitch.forEach((p) => {
      const t = restartTargets(w, p);
      steer(w, p, t.x, t.y, dt, 0.72);
      integrate(w, p, dt);
    });
  });

  const userTakes = w.teams[r.team].isUser && r.taker;
  if (userTakes) w.controlled = r.taker;

  if (r.setupT > 0) return;
  r.ready = true;

  if (userTakes) {
    if (r.type === "penalty") {
      r.aim = clamp(r.aim + input.mx * dt * 1.5, -1, 1);
      if (input.shoot) {
        input.shoot = false;
        takeRestart(w, r.aim, clamp(input.shootPower || 0.85, 0.4, 1));
        return;
      }
    } else if (input.pass || input.shoot || input.cross || input.through) {
      const aim = clamp((input.my || 0) * -1, -1, 1);
      const power = input.shoot ? clamp(input.shootPower, 0.3, 1) : 0.7;
      const wantShot = input.shoot && (r.type === "freekick");
      input.pass = false;
      input.shoot = false;
      input.cross = false;
      input.through = false;
      if (wantShot) {
        const taker = r.taker;
        w.ball.x = r.x;
        w.ball.y = r.y;
        doShot(w, taker, power, aim, power < 0.55);
        markOffsides(w, taker);
        w.phase = "play";
        w.restart = null;
      } else {
        takeRestart(w, aim, power);
      }
      return;
    }
    if (r.autoT <= 0) takeRestart(w, 0, 0.75);
    return;
  }

  if (r.autoT <= 4.6 || (r.type === "penalty" && r.autoT <= 5.6)) {
    takeRestart(w, rndRange(w, -0.9, 0.9), rndRange(w, 0.7, 1));
  }
}

/* ------------------------------ snapshots ------------------------------ */

export function possession(w) {
  const a = w.stats[0].possessionMs;
  const b = w.stats[1].possessionMs;
  const total = a + b;
  if (total < 500) return [50, 50];
  const pa = Math.round((a / total) * 100);
  return [pa, 100 - pa];
}

export function statLines(w) {
  const [pa, pb] = possession(w);
  const acc = (s) => (s.passes ? Math.round((s.passesCompleted / s.passes) * 100) : 0);
  return [
    { label: "Possession", home: `${pa}%`, away: `${pb}%` },
    { label: "Shots", home: w.stats[0].shots, away: w.stats[1].shots },
    { label: "On target", home: w.stats[0].onTarget, away: w.stats[1].onTarget },
    { label: "Passes", home: w.stats[0].passes, away: w.stats[1].passes },
    { label: "Pass accuracy", home: `${acc(w.stats[0])}%`, away: `${acc(w.stats[1])}%` },
    { label: "Tackles", home: w.stats[0].tackles, away: w.stats[1].tackles },
    { label: "Fouls", home: w.stats[0].fouls, away: w.stats[1].fouls },
    { label: "Offsides", home: w.stats[0].offsides, away: w.stats[1].offsides },
    { label: "Corners", home: w.stats[0].corners, away: w.stats[1].corners },
    { label: "Saves", home: w.stats[0].saves, away: w.stats[1].saves },
    { label: "Yellow cards", home: w.stats[0].yellow, away: w.stats[1].yellow },
    { label: "Red cards", home: w.stats[0].red, away: w.stats[1].red },
  ];
}

export function hudSnapshot(w) {
  const p = controlledPlayer(w);
  const s = w.shootout;
  return {
    score: [...w.score],
    minute: Math.min(HALF_BASE[w.half] + HALF_LENGTH[w.half], Math.floor(w.displayMinute)),
    half: w.half,
    phase: w.phase,
    controlled: p
      ? {
        name: p.data.name,
        number: p.data.number,
        role: p.role,
        stamina: Math.round(p.stamina),
        yellow: p.yellow,
        rating: p.data.overall,
      }
      : null,
    possession: possession(w),
    subsUsed: [w.teams[0].subsUsed, w.teams[1].subsUsed],
    cards: w.teams.map((t) => ({
      yellow: w.stats[t.index].yellow,
      red: w.stats[t.index].red,
    })),
    banner: w.cardBanner
      ? { kind: "card", ...w.cardBanner }
      : w.subBanner
        ? { kind: "sub", ...w.subBanner }
        : w.refBanner
          ? { kind: "ref", ...w.refBanner }
          : w.restart
            ? { kind: "restart", type: w.restart.type, team: w.restart.team, ready: w.restart.ready }
            : null,
    lastGoal: w.lastGoal,
    shootout: s ? { scores: [...s.scores], kicks: s.kicks.map((k) => [...k]), turn: s.turn, state: s.state, aim: s.aim } : null,
    finished: w.finished,
    result: w.result,
  };
}

/** Live squad view for the substitution menu. */
export function squadView(w, teamIdx) {
  const team = w.teams[teamIdx];
  return {
    onPitch: team.onPitch.map((p) => ({
      id: p.id,
      name: p.data.name,
      number: p.data.number,
      role: p.role,
      natural: p.data.position,
      rating: p.data.overall,
      stamina: Math.round(p.stamina),
      yellow: p.yellow,
      isGK: p.role === "GK",
    })),
    bench: team.bench.map((p) => ({
      id: p.id,
      name: p.data.name,
      number: p.data.number,
      role: p.data.position,
      natural: p.data.position,
      rating: p.data.overall,
      stamina: Math.round(p.stamina),
      used: p.used,
      isGK: p.data.position === "GK",
    })),
    subsUsed: team.subsUsed,
    subsLeft: w.cfg.maxSubs - team.subsUsed,
    pending: w.pendingSubs[teamIdx].map((s) => ({ ...s })),
  };
}
