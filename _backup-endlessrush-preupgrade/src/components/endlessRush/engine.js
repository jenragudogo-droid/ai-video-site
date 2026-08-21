/* ------------------------------------------------------------------ *
 * Kianimation Endless Rush — simulation.
 *
 * Pure state and maths: nothing here touches the DOM, the canvas or
 * audio. The React shell feeds it an input snapshot once per frame and
 * drains an event queue afterwards, which keeps the game logic testable
 * and means a dropped frame can never desynchronise sound from play.
 *
 * The world the simulation sees is flat and straight. The curving,
 * rolling road is a rendering transform applied on top (see world.js),
 * so a jump clears exactly what it looks like it clears no matter what
 * the scenery is doing.
 * ------------------------------------------------------------------ */

import { LANES, LANE_W, CHUNK } from "./world.js";
import {
  createTrack, speedAt, difficultyAt,
  LANE_TIME, SLIDE_TIME, START_SPEED,
} from "./track.js";

/* ---------------------------- constants ---------------------------- */

export const PLAYER_HW = 0.30;      // half-width  (forgiving on purpose)
export const PLAYER_HD = 0.26;      // half-depth
export const STAND_H = 1.72;
export const SLIDE_H = 0.80;

const GRAVITY = 26;
const JUMP_V = 8.84;                // apex 1.50m, airtime 0.68s
const FAST_FALL = -17;              // dive when sliding is pressed mid-air

const AHEAD = 265;                  // metres of track kept in front
const BEHIND = 48;                  // metres kept behind for the camera

const JUMP_BUFFER = 0.14;           // press-early grace before landing
const COYOTE = 0.09;                // press-late grace after a ledge

const MAGNET_R = 6.5;
const STUMBLE_TIME = 0.62;
const BUMP_INVULN = 0.55;

export const POWER_TIME = {
  magnet: 8.5,
  shield: 13,
  double: 10,
  boost: 5.2,
};

export const POWER_LABEL = {
  magnet: "Coin magnet",
  shield: "Shield",
  double: "Double score",
  boost: "Speed surge",
};

export const POWER_ICON = { magnet: "🧲", shield: "🛡", double: "×2", boost: "⚡" };

const BOOST_MUL = 1.42;

/* ------------------------------ helpers ------------------------------ */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function freshStats() {
  return {
    jumps: 0, slides: 0, laneChanges: 0,
    bumps: 0, shieldsUsed: 0, powerups: 0, topSpeed: 0,
  };
}

/* -------------------------------- game -------------------------------- */

export function makeGame({ seed = 1, best = 0 } = {}) {
  const s = {
    seed: seed >>> 0,
    track: createTrack(seed >>> 0),
    phase: "ready",             // ready | running | dead
    t: 0,
    dist: 0,
    z: 0,
    speed: START_SPEED,
    speedTarget: START_SPEED,
    stepDist: 0,

    lane: 1,
    lanePos: 1,                 // continuous, 0..2
    x: 0,
    lean: 0,
    leanV: 0,

    y: 0,
    vy: 0,
    airborne: false,
    groundedFor: 99,
    jumpBuffer: 0,

    sliding: false,
    slideT: 0,
    slideBuffer: 0,

    runPhase: 0,                // running animation clock
    stumble: 0,
    invuln: 0,
    shake: 0,

    score: 0,
    coins: 0,
    best,
    mult: 1,

    powers: { magnet: 0, shield: 0, double: 0, boost: 0 },

    chunks: [],
    events: [],
    fx: [],                     // short-lived visual bursts
    stats: freshStats(),
    causeOfDeath: null,
  };
  fillChunks(s);
  return s;
}

export function resetGame(s, seed) {
  const next = seed === undefined ? ((Math.random() * 0x7fffffff) | 0) : seed;
  s.seed = next >>> 0;
  s.track.reset(s.seed);
  s.phase = "ready";
  s.t = 0; s.dist = 0; s.z = 0;
  s.speed = START_SPEED; s.speedTarget = START_SPEED; s.stepDist = 0;
  s.lane = 1; s.lanePos = 1; s.x = 0; s.lean = 0; s.leanV = 0;
  s.y = 0; s.vy = 0; s.airborne = false; s.groundedFor = 99; s.jumpBuffer = 0;
  s.sliding = false; s.slideT = 0; s.slideBuffer = 0;
  s.runPhase = 0; s.stumble = 0; s.invuln = 0; s.shake = 0;
  s.score = 0; s.coins = 0; s.mult = 1;
  s.powers.magnet = 0; s.powers.shield = 0; s.powers.double = 0; s.powers.boost = 0;
  s.chunks.length = 0;
  s.events.length = 0;
  s.fx.length = 0;
  s.stats = freshStats();
  s.causeOfDeath = null;
  fillChunks(s);
  return s;
}

/* ----------------------------- chunk window ----------------------------- */

function fillChunks(s) {
  const need = s.z + AHEAD;
  let guard = 0;
  while (guard < 64) {
    const last = s.chunks[s.chunks.length - 1];
    if (last && last.z1 >= need) break;
    s.chunks.push(s.track.next());
    guard += 1;
  }
  const cut = s.z - BEHIND;
  while (s.chunks.length && s.chunks[0].z1 < cut) s.chunks.shift();
}

/** Every chunk overlapping a Z window — used by collision and drawing. */
export function chunksIn(s, zFrom, zTo) {
  const out = [];
  for (const c of s.chunks) {
    if (c.z1 < zFrom || c.z0 > zTo) continue;
    out.push(c);
  }
  return out;
}

/* ------------------------------- events ------------------------------- */

function emit(s, type, a) {
  if (s.events.length < 48) s.events.push(a === undefined ? { type } : { type, a });
}

export function drainEvents(s) {
  const out = s.events.slice();
  s.events.length = 0;
  return out;
}

function burst(s, x, y, z, hue, count) {
  s.fx.push({ x, y, z, t: 0, life: 0.5, hue, n: count || 8 });
  if (s.fx.length > 24) s.fx.shift();
}

/* ------------------------------ commands ------------------------------ */

export function moveLane(s, dir) {
  if (s.phase !== "running") return;
  const next = clamp(s.lane + dir, 0, 2);
  if (next === s.lane) return;
  s.lane = next;
  s.leanV = dir;
  s.stats.laneChanges += 1;
  emit(s, "lane");
}

export function jump(s) {
  if (s.phase !== "running") return;
  s.jumpBuffer = JUMP_BUFFER;
}

export function slide(s) {
  if (s.phase !== "running") return;
  s.slideBuffer = JUMP_BUFFER;
}

function doJump(s) {
  s.vy = JUMP_V;
  s.airborne = true;
  s.sliding = false;
  s.slideT = 0;
  s.groundedFor = 99;
  s.jumpBuffer = 0;
  s.stats.jumps += 1;
  emit(s, "jump");
}

function doSlide(s) {
  s.sliding = true;
  s.slideT = SLIDE_TIME;
  s.slideBuffer = 0;
  s.stats.slides += 1;
  emit(s, "slide");
}

export function playerHeight(s) {
  return s.sliding ? SLIDE_H : STAND_H;
}

/* ------------------------------ power-ups ------------------------------ */

function grantPower(s, type) {
  s.powers[type] = POWER_TIME[type];
  s.stats.powerups += 1;
  emit(s, "power", type);
}

export function activePowers(s) {
  const out = [];
  for (const k of ["boost", "shield", "double", "magnet"]) {
    if (s.powers[k] > 0) out.push({ key: k, left: s.powers[k], of: POWER_TIME[k] });
  }
  return out;
}

/* -------------------------------- step -------------------------------- */

export function stepGame(s, input, dt) {
  if (s.phase !== "running") {
    s.t += dt;
    decayFx(s, dt);
    return;
  }

  s.t += dt;

  /* ------------------------------ speed ------------------------------ */
  const base = speedAt(s.dist);
  /* The surge ramps out over its last half second instead of ending on a
     cliff. The track ahead was laid out for the unboosted speed, so a
     runner dropped back into it at forty per cent over pace — with the
     invulnerability already gone — would eat an obstacle that was never
     theirs to avoid. */
  const surge = s.powers.boost > 0
    ? 1 + (BOOST_MUL - 1) * Math.min(1, s.powers.boost / 0.55)
    : 1;
  const stumbleFactor = s.stumble > 0 ? 0.52 + 0.48 * (1 - s.stumble / STUMBLE_TIME) : 1;
  s.speedTarget = base * surge * stumbleFactor;
  /* Slowing down is quicker than speeding up. When a surge ends the
     runner is still travelling 40% faster than the track ahead was laid
     out for, so that excess has to bleed off in a fraction of a second
     rather than over the next two rows. */
  const rate = s.speedTarget < s.speed ? 11 : 5.5;
  s.speed += (s.speedTarget - s.speed) * Math.min(1, dt * rate);
  if (s.speed > s.stats.topSpeed) s.stats.topSpeed = s.speed;

  const step = s.speed * dt;
  s.stepDist = step;
  s.dist += step;
  s.z = s.dist;

  /* ------------------------------ timers ------------------------------ */
  if (s.stumble > 0) s.stumble = Math.max(0, s.stumble - dt);
  if (s.invuln > 0) s.invuln = Math.max(0, s.invuln - dt);
  if (s.shake > 0) s.shake = Math.max(0, s.shake - dt * 2.4);
  if (s.jumpBuffer > 0) s.jumpBuffer -= dt;
  if (s.slideBuffer > 0) s.slideBuffer -= dt;
  for (const k in s.powers) {
    if (s.powers[k] > 0) {
      s.powers[k] = Math.max(0, s.powers[k] - dt);
      if (s.powers[k] === 0) {
        // a moment's grace as a surge unwinds, so the hand-back is never fatal
        if (k === "boost") s.invuln = Math.max(s.invuln, 0.3);
        emit(s, "powerEnd", k);
      }
    }
  }
  s.mult = s.powers.double > 0 ? 2 : 1;

  /* ------------------------------- lanes ------------------------------- */
  const laneRate = dt / LANE_TIME;
  const dLane = s.lane - s.lanePos;
  if (Math.abs(dLane) <= laneRate) {
    s.lanePos = s.lane;
  } else {
    s.lanePos += Math.sign(dLane) * laneRate;
  }
  s.x = (s.lanePos - 1) * LANE_W;

  // body lean: leads the movement, then settles back upright
  const wantLean = clamp((s.lane - s.lanePos) * 2.4 + s.leanV * 0.35, -1, 1);
  s.lean += (wantLean - s.lean) * Math.min(1, dt * 11);
  s.leanV *= Math.max(0, 1 - dt * 6);

  /* ---------------------------- jump / slide ---------------------------- */
  if (s.airborne) {
    if (s.slideBuffer > 0 && s.vy > FAST_FALL) {
      s.vy = FAST_FALL;             // dive: get back down and slide sooner
      s.slideBuffer = JUMP_BUFFER;  // keep the intent alive until landing
      emit(s, "dive");
    }
    s.vy -= GRAVITY * dt;
    s.y += s.vy * dt;
    if (s.y <= 0) {
      s.y = 0;
      s.vy = 0;
      s.airborne = false;
      s.groundedFor = 0;
      emit(s, "land");
    }
  } else {
    s.groundedFor += dt;
  }

  if (s.sliding) {
    s.slideT -= dt;
    if (s.slideT <= 0 || s.jumpBuffer > 0) {
      s.sliding = false;
      s.slideT = 0;
    }
  }

  const canJump = !s.airborne || s.groundedFor < COYOTE;
  if (s.jumpBuffer > 0 && canJump) doJump(s);
  else if (s.slideBuffer > 0 && !s.airborne && !s.sliding) doSlide(s);

  // run cycle speeds up with the runner
  s.runPhase += dt * (s.airborne ? 3 : s.sliding ? 4 : s.speed * 0.78);

  /* ------------------------------ world ------------------------------ */
  fillChunks(s);
  collectCoins(s, dt);
  collectPowerups(s);
  testObstacles(s, dt);
  animateKnocked(s, dt);
  decayFx(s, dt);

  /* ------------------------------ score ------------------------------ */
  s.score += step * s.mult;
}

/* ------------------------------ collisions ------------------------------ */

/* The Z test is swept, not sampled. At 27 m/s a runner covers most of a
   thin barrier's depth inside one frame, so testing only the position at
   the end of the step would let a fast run tunnel straight through one.
   Sweeping from where the runner was to where they now are makes the
   test exact rather than merely early. */
function overlaps(s, o) {
  const zPrev = s.z - s.stepDist;
  if (o.z + o.d * 0.5 < zPrev - PLAYER_HD) return false;
  if (o.z - o.d * 0.5 > s.z + PLAYER_HD) return false;
  if (Math.abs(o.x - s.x) > o.w * 0.5 + PLAYER_HW) return false;
  const top = s.y + playerHeight(s);
  return s.y < o.y + o.h && top > o.y;
}

function testObstacles(s, dt) {
  const back = 6 + s.stepDist;
  const cs = chunksIn(s, s.z - back, s.z + 8);
  for (const c of cs) {
    for (const o of c.obstacles) {
      if (o.hit) continue;
      if (o.z < s.z - back) continue;
      if (o.z > s.z + 8) break;
      if (!overlaps(s, o)) continue;

      /* ---- a surge ploughs straight through anything ---- */
      if (s.powers.boost > 0) {
        knock(o, s, 1.5);
        s.shake = Math.max(s.shake, 0.5);
        burst(s, o.x, o.y + o.h * 0.5, o.z, "#ffb545", 10);
        emit(s, "smash");
        continue;
      }

      /* ---- small junk: a stumble, not a run-ender ---- */
      if (o.sev === "minor") {
        if (s.invuln > 0) continue;
        knock(o, s, 1);
        s.stumble = STUMBLE_TIME;
        s.invuln = BUMP_INVULN;
        s.shake = Math.max(s.shake, 0.6);
        s.stats.bumps += 1;
        burst(s, o.x, o.y + o.h * 0.5, o.z, "#e8b45a", 6);
        emit(s, "bump");
        continue;
      }

      /* ---- shield eats one serious hit ---- */
      if (s.powers.shield > 0) {
        s.powers.shield = 0;
        s.invuln = 0.9;
        s.stats.shieldsUsed += 1;
        knock(o, s, 1.3);
        s.shake = Math.max(s.shake, 0.8);
        burst(s, o.x, o.y + o.h * 0.5, o.z, "#5ad1ff", 14);
        emit(s, "shieldBreak");
        continue;
      }

      if (s.invuln > 0) continue;

      /* ---- end of the run ---- */
      s.phase = "dead";
      s.causeOfDeath = o.type;
      s.shake = 1;
      o.hit = true;
      burst(s, o.x, o.y + o.h * 0.5, o.z, "#ff6a4d", 16);
      emit(s, "crash", o.type);
      emit(s, "gameover");
      return;
    }
  }
  void dt;
}

function knock(o, s, force) {
  o.hit = true;
  // a hole in the road cannot be knocked aside; it just stops being lethal
  if (o.art === "gap") return;
  const away = Math.sign(o.x - s.x) || (Math.random() < 0.5 ? -1 : 1);
  o.knock = {
    t: 0,
    vx: away * (2 + Math.random() * 3) * force,
    vy: (3 + Math.random() * 3) * force,
    vz: (3 + Math.random() * 4) * force,
    spin: (Math.random() - 0.5) * 12,
    ox: 0, oy: 0, oz: 0, rot: 0,
  };
}

function animateKnocked(s, dt) {
  const cs = chunksIn(s, s.z - 40, s.z + 12);
  for (const c of cs) {
    for (const o of c.obstacles) {
      const k = o.knock;
      if (!k) continue;
      k.t += dt;
      if (k.t > 2.2) { o.knock = null; continue; }
      k.vy -= 22 * dt;
      k.ox += k.vx * dt;
      k.oy += k.vy * dt;
      k.oz += k.vz * dt;
      k.rot += k.spin * dt;
      if (o.y + k.oy < -1.5) k.vy = 0;
    }
  }
}

function decayFx(s, dt) {
  for (let i = s.fx.length - 1; i >= 0; i -= 1) {
    const f = s.fx[i];
    f.t += dt;
    if (f.t >= f.life) s.fx.splice(i, 1);
  }
}

/* -------------------------------- coins -------------------------------- */

function collectCoins(s, dt) {
  const magnet = s.powers.magnet > 0;
  const boost = s.powers.boost > 0;
  const cs = chunksIn(s, s.z - 3, s.z + MAGNET_R + 6);
  const py = s.y + (s.sliding ? 0.5 : 0.9);

  for (const c of cs) {
    for (const coin of c.coins) {
      if (coin.taken) continue;
      const dz = coin.z - s.z;
      /* Retire a coin the moment it is behind the runner. The camera
         trails by ten metres, so a missed coin left alive would swell to
         fill a quarter of the screen on its way past the lens. */
      if (dz < -1) { coin.taken = true; continue; }
      if (dz > MAGNET_R + 6) break;

      coin.ph += dt * 4.2;

      if (magnet && dz < MAGNET_R && dz > -1.5) {
        const pull = Math.min(1, dt * 7);
        coin.x += (s.x - coin.x) * pull;
        coin.y += (py - coin.y) * pull;
        coin.z += (s.z + 0.4 - coin.z) * pull * 0.9;
      } else if (boost && dz < 3 && Math.abs(coin.x - s.x) < 1.2) {
        const pull = Math.min(1, dt * 9);
        coin.x += (s.x - coin.x) * pull;
        coin.y += (py - coin.y) * pull;
      }

      if (Math.abs(dz) < 1.0
        && Math.abs(coin.x - s.x) < 0.95
        && Math.abs(coin.y - py) < 1.15) {
        coin.taken = true;
        s.coins += 1;
        s.score += 10 * s.mult;
        emit(s, "coin");
      }
    }
  }
}

function collectPowerups(s) {
  const cs = chunksIn(s, s.z - 3, s.z + 8);
  const py = s.y + (s.sliding ? 0.5 : 0.95);
  for (const c of cs) {
    for (const p of c.powerups) {
      if (p.taken) continue;
      const dz = p.z - s.z;
      if (dz < -2) { p.taken = true; continue; }
      if (dz > 8) break;
      if (Math.abs(dz) < 1.2
        && Math.abs(p.x - s.x) < 1.05
        && Math.abs(p.y - py) < 1.5) {
        p.taken = true;
        grantPower(s, p.type);
        burst(s, p.x, p.y, p.z, "#8ee6ff", 12);
      }
    }
  }
}

/* ------------------------------- lifecycle ------------------------------- */

export function startRun(s) {
  s.phase = "running";
  s.t = 0;
  emit(s, "start");
}

/** Everything the game-over screen needs, in one object. */
export function summarise(s) {
  return {
    score: Math.floor(s.score),
    distance: Math.floor(s.dist),
    coins: s.coins,
    topSpeed: Math.round(s.stats.topSpeed * 3.6),
    cause: s.causeOfDeath,
    stats: { ...s.stats },
    time: s.t,
  };
}

export { speedAt, difficultyAt, LANES, CHUNK };
