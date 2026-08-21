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
 *
 * Two things here are load-bearing for fairness:
 *
 *   - **The track is generated at the character's own speed.** A
 *     hoverboard covers a quarter more ground per second than a runner,
 *     so laying rows out in metres would quietly hand the fastest
 *     character a quarter less time to read each one. Row spacing is
 *     expressed in seconds and multiplied by whoever is riding.
 *   - **Collision is swept, not sampled.** At 33 m/s a runner crosses
 *     most of a thin barrier inside one frame at 30fps.
 * ------------------------------------------------------------------ */

import { LANE_W, CHUNK } from "./world.js";
import {
  createTrack, speedAt, difficultyAt,
  LANE_TIME, SLIDE_TIME, START_SPEED,
} from "./track.js";
import { characterById, DEFAULT_CHARACTER, airTime } from "./characters.js";

/* ---------------------------- constants ---------------------------- */

export const PLAYER_HW = 0.30;      // half-width  (forgiving on purpose)
export const PLAYER_HD = 0.26;      // half-depth
export const STAND_H = 1.72;
export const SLIDE_H = 0.80;

const GRAVITY = 26;
const JUMP_V = 8.84;                // apex 1.50 m, airtime 0.68 s
const FAST_FALL = -17;

const AHEAD = 265;
const BEHIND = 48;

const JUMP_BUFFER = 0.14;
const COYOTE = 0.09;

const MAGNET_R = 6.5;
const STUMBLE_TIME = 0.62;
const BUMP_INVULN = 0.55;

/* ------------------------------ power-ups ------------------------------ */

export const POWER_TIME = {
  magnet: 8.5,
  shield: 13,
  double: 10,
  boost: 5.2,
  jetpack: 9,
  superJump: 11,
};

export const POWER_LABEL = {
  magnet: "Coin magnet",
  shield: "Shield",
  double: "Double score",
  boost: "Speed surge",
  jetpack: "Jetpack",
  superJump: "Super jump",
};

export const POWER_ICON = {
  magnet: "🧲", shield: "🛡", double: "×2", boost: "⚡", jetpack: "🚀", superJump: "⇧",
};

/* Painted on the pickup and on the HUD pill, so a power-up is
   identifiable from thirty metres away by colour alone. */
export const POWER_COLOUR = {
  magnet: "#9e62ff",
  shield: "#5ad1ff",
  double: "#f4b965",
  boost: "#ff8a3d",
  jetpack: "#ff5d7a",
  superJump: "#7ee08a",
};

const BOOST_MUL = 1.42;
const SUPER_JUMP_MUL = 1.55;

/* ------------------------------- flight ------------------------------- */

/* Jetpack cruise.
   Over the street it is high enough to clear everything on it. Over a
   rooftop it drops to skim the deck instead, which both keeps the roof's
   coins within reach and keeps the flight visually connected to the
   thing it is flying over — cruising twelve metres above a roof you are
   supposed to be exploring is just a loading screen with scenery. */
export const FLY_HEIGHT = 5.4;
const FLY_OVER_DECK = 2.6;
const FLY_RISE = 7.5;
const FLY_FALL = 6.2;
const FLY_LOOKAHEAD = 0.9;          // seconds of road to climb for

/* ------------------------------- combat ------------------------------- */

export const ATTACK_TIME = 0.34;    // one swing
export const ATTACK_CD = 0.42;      // before the next one
const COMBO_WINDOW = 0.85;
const ATTACK_REACH = 2.6;           // metres in front
const ATTACK_HALF_W = 0.95;

/* ------------------------------ helpers ------------------------------ */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function freshStats() {
  return {
    jumps: 0, slides: 0, laneChanges: 0,
    bumps: 0, shieldsUsed: 0, powerups: 0, topSpeed: 0,
    enemiesBeaten: 0, attacks: 0, bestCombo: 0, roofMetres: 0, flightMetres: 0,
  };
}

/* -------------------------------- game -------------------------------- */

export function makeGame({ seed = 1, best = 0, character = DEFAULT_CHARACTER } = {}) {
  const profile = characterById(character);
  const s = {
    seed: seed >>> 0,
    character: profile.id,
    profile,
    track: createTrack(seed >>> 0, profile.speed, airTime(profile, JUMP_V, GRAVITY)),
    phase: "ready",
    t: 0,
    dist: 0,
    z: 0,
    speed: START_SPEED * profile.speed,
    speedTarget: START_SPEED * profile.speed,
    stepDist: 0,

    lane: 1,
    lanePos: 1,
    x: 0,
    lean: 0,
    leanV: 0,

    y: 0,
    vy: 0,
    airborne: false,
    groundedFor: 99,
    jumpBuffer: 0,
    surfaceY: 0,
    onRoof: false,
    roofLeaveGrace: 0,

    sliding: false,
    slideT: 0,
    slideBuffer: 0,

    flying: false,
    flyLand: 0,

    attackT: 0,
    attackCd: 0,
    attackKind: "punch",
    attackHit: false,
    combo: 0,
    comboT: 0,

    runPhase: 0,
    stumble: 0,
    invuln: 0,
    shake: 0,

    score: 0,
    coins: 0,
    best,
    mult: 1,

    powers: { magnet: 0, shield: 0, double: 0, boost: 0, jetpack: 0, superJump: 0 },

    chunks: [],
    events: [],
    fx: [],
    stats: freshStats(),
    causeOfDeath: null,
  };
  fillChunks(s);
  return s;
}

export function resetGame(s, seed, character) {
  const next = seed === undefined ? ((Math.random() * 0x7fffffff) | 0) : seed;
  const profile = characterById(character || s.character);
  s.seed = next >>> 0;
  s.character = profile.id;
  s.profile = profile;
  s.track.reset(s.seed, profile.speed, airTime(profile, JUMP_V, GRAVITY));
  s.phase = "ready";
  s.t = 0; s.dist = 0; s.z = 0;
  s.speed = START_SPEED * profile.speed;
  s.speedTarget = s.speed;
  s.stepDist = 0;
  s.lane = 1; s.lanePos = 1; s.x = 0; s.lean = 0; s.leanV = 0;
  s.y = 0; s.vy = 0; s.airborne = false; s.groundedFor = 99; s.jumpBuffer = 0;
  s.surfaceY = 0; s.onRoof = false; s.roofLeaveGrace = 0;
  s.sliding = false; s.slideT = 0; s.slideBuffer = 0;
  s.flying = false; s.flyLand = 0;
  s.attackT = 0; s.attackCd = 0; s.attackHit = false; s.combo = 0; s.comboT = 0;
  s.runPhase = 0; s.stumble = 0; s.invuln = 0; s.shake = 0;
  s.score = 0; s.coins = 0; s.mult = 1;
  for (const k in s.powers) s.powers[k] = 0;
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

/* ------------------------------- surfaces ------------------------------- */

/**
 * Height of whatever can hold the runner up at a given lane and distance.
 *
 * `ceiling` is how high a surface is allowed to be and still count. A
 * roof deck six metres up does not catch someone running along the
 * street beneath it — they run *under* the building — and it does not
 * catch someone descending past its side either. Without that rule a
 * jetpack that ran out just short of a rooftop would snap the runner up
 * onto the deck from below, usually straight into a water tank.
 */
/**
 * The highest rooftop anywhere in a stretch of road, whatever lane it is
 * in. Flight altitude uses this rather than the deck under the runner's
 * own lane: they can change lanes mid-flight, and dropping back to
 * street cruise while still alongside a roof is what puts a water tank
 * through the middle of them.
 */
export function roofCeilingNear(s, zFrom, zTo) {
  let y = 0;
  for (const c of chunksIn(s, zFrom, zTo)) {
    for (const rf of c.roofs) {
      if (rf.z1 < zFrom || rf.z0 > zTo) continue;
      if (rf.y > y) y = rf.y;
    }
  }
  return y;
}

export function surfaceAt(s, z, lane, ceiling = Infinity) {
  let best = 0;
  for (const c of chunksIn(s, z - 1, z + 1)) {
    for (const rf of c.roofs) {
      if (z < rf.z0 || z > rf.z1) continue;
      if (!rf.lanes[lane]) continue;
      if (rf.y > ceiling) continue;
      if (rf.y > best) best = rf.y;
    }
  }
  return best;
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
  /* In flight, down means *land*. Without it the pack decides where the
     flight ends, and nine seconds of fuel usually carries you clean over
     the roof you were aiming for — so the rooftops would only ever be
     scenery seen from above. Cutting the pack early hands that choice
     back: fly up, cross to the deck, press down, run it on foot. The
     descent is the same protected one the pack ends with, so choosing to
     land is never more dangerous than running out of fuel. */
  if (s.flying) {
    s.powers.jetpack = 0;
    s.flying = false;
    s.flyLand = 1;
    s.invuln = Math.max(s.invuln, 1.4);
    emit(s, "powerEnd", "jetpack");
    return;
  }
  s.slideBuffer = JUMP_BUFFER;
}

/**
 * Throws a punch, a kick or a spin, depending on where the runner is and
 * how recently they last connected. Rate-limited by a cooldown so it
 * cannot be held down, and it never grants invulnerability — an attack
 * is a way to clear the lane ahead, not a way to ignore it.
 */
export function attack(s) {
  if (s.phase !== "running") return;
  if (s.attackCd > 0 || s.attackT > 0) return;
  s.attackKind = s.airborne ? "airKick"
    : s.combo >= 2 ? "spin"
      : s.combo === 1 ? "kick" : "punch";
  s.attackT = ATTACK_TIME;
  s.attackCd = ATTACK_CD + ATTACK_TIME;
  s.attackHit = false;
  s.stats.attacks += 1;
  emit(s, "attack", s.attackKind);
}

function doJump(s) {
  const boost = s.powers.superJump > 0 ? SUPER_JUMP_MUL : 1;
  s.vy = JUMP_V * s.profile.jump * boost;
  s.airborne = true;
  s.sliding = false;
  s.slideT = 0;
  s.groundedFor = 99;
  s.jumpBuffer = 0;
  s.stats.jumps += 1;
  emit(s, s.powers.superJump > 0 ? "superJump" : "jump");
}

function doSlide(s) {
  s.sliding = true;
  s.slideT = SLIDE_TIME * s.profile.lowTime;
  s.slideBuffer = 0;
  s.stats.slides += 1;
  emit(s, s.profile.ride === "bicycle" ? "duck" : "slide");
}

export function playerHeight(s) {
  return s.sliding ? SLIDE_H : STAND_H;
}

/* ------------------------------ power-ups ------------------------------ */

function grantPower(s, type) {
  s.powers[type] = POWER_TIME[type];
  s.stats.powerups += 1;
  if (type === "jetpack") {
    s.flying = true;
    s.sliding = false;
    s.slideT = 0;
    // the pack is a rescue as well as a ride: it lifts you clear of
    // whatever you were about to run into
    s.invuln = Math.max(s.invuln, 0.7);
  }
  emit(s, "power", type);
}

export function activePowers(s) {
  const out = [];
  for (const k of ["jetpack", "boost", "shield", "double", "superJump", "magnet"]) {
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
  const P = s.profile;

  /* ------------------------------ speed ------------------------------ */
  const base = speedAt(s.dist) * P.speed;
  const surge = s.powers.boost > 0
    ? 1 + (BOOST_MUL - 1) * Math.min(1, s.powers.boost / 0.55)
    : 1;
  const stumbleFactor = s.stumble > 0 ? 0.52 + 0.48 * (1 - s.stumble / STUMBLE_TIME) : 1;
  s.speedTarget = base * surge * stumbleFactor;
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
  if (s.attackCd > 0) s.attackCd = Math.max(0, s.attackCd - dt);
  if (s.attackT > 0) s.attackT = Math.max(0, s.attackT - dt);
  if (s.comboT > 0) {
    s.comboT = Math.max(0, s.comboT - dt);
    if (s.comboT === 0) s.combo = 0;
  }
  if (s.roofLeaveGrace > 0) s.roofLeaveGrace = Math.max(0, s.roofLeaveGrace - dt);

  for (const k in s.powers) {
    if (s.powers[k] > 0) {
      s.powers[k] = Math.max(0, s.powers[k] - dt);
      if (s.powers[k] === 0) {
        if (k === "boost") s.invuln = Math.max(s.invuln, 0.3);
        if (k === "jetpack") {
          /* Coming down is a scripted, safe descent: the runner is
             untouchable until their feet are back on something. Being
             dropped out of the sky into a barrier you never had a chance
             to see would be a rotten way to end a good run. */
          s.flying = false;
          s.flyLand = 1;
          s.invuln = Math.max(s.invuln, 1.4);
        }
        emit(s, "powerEnd", k);
      }
    }
  }
  s.mult = s.powers.double > 0 ? 2 : 1;

  /* ------------------------------- lanes ------------------------------- */
  const laneRate = dt / (LANE_TIME * P.laneTime);
  const dLane = s.lane - s.lanePos;
  if (Math.abs(dLane) <= laneRate) s.lanePos = s.lane;
  else s.lanePos += Math.sign(dLane) * laneRate;
  s.x = (s.lanePos - 1) * LANE_W;

  const wantLean = clamp((s.lane - s.lanePos) * 2.4 + s.leanV * 0.35, -1, 1);
  s.lean += (wantLean - s.lean) * Math.min(1, dt * 11);
  s.leanV *= Math.max(0, 1 - dt * 6);

  /* ------------------------- vertical movement ------------------------- */
  /* Only a deck at or below where the runner already is can support
     them; anything higher is a building they are passing, not a floor. */
  const ceiling = s.y + 0.35;
  const ground = surfaceAt(s, s.z, s.lane, ceiling);
  const prevSurface = s.surfaceY;
  s.surfaceY = ground;
  s.onRoof = ground > 0.1;
  if (s.onRoof) s.stats.roofMetres += step;

  if (s.flying) {
    /* Climb for what is *coming*, not for what is underneath: a roof
       edge arrives faster than the pack can lift, and clipping the
       parapet of the building you were aiming for is a rotten way to
       lose a flight. */
    /* Hold the altitude of the tallest deck anywhere close — behind as
       well as ahead, and in every lane — so the pack climbs before the
       parapet arrives and does not sink back down while still over the
       building. */
    const soon = Math.max(ground, roofCeilingNear(s, s.z - 8, s.z + s.speed * FLY_LOOKAHEAD));
    const want = soon > 0.1 ? soon + FLY_OVER_DECK : FLY_HEIGHT;
    s.y += clamp(want - s.y, -FLY_FALL * dt, FLY_RISE * dt);
    s.vy = 0;
    s.airborne = true;
    s.sliding = false;
    s.stats.flightMetres += step;
  } else if (s.flyLand > 0) {
    /* Controlled descent after the pack cuts out.
       The grace is refreshed every frame rather than set once, because
       the fall is as long as the cruise was high — coming down off a
       rooftop takes noticeably longer than coming down off the street,
       and a fixed timer runs out somewhere over the buildings. */
    s.invuln = Math.max(s.invuln, 0.5);
    s.airborne = true;
    s.y -= FLY_FALL * dt;
    if (s.y <= ground) {
      s.y = ground;
      s.vy = 0;
      s.airborne = false;
      s.flyLand = 0;
      s.groundedFor = 0;
      // a beat on the ground before the world can hurt again
      s.invuln = Math.max(s.invuln, 0.45);
      emit(s, "land");
    }
  } else if (s.airborne) {
    if (s.slideBuffer > 0) {
      /* Asking to slide while still in the air dives you down and then
         *holds the intent until the feet land*. Letting the buffer expire
         mid-descent means the input is silently dropped and the runner
         stands up straight into the sign they were trying to duck. */
      if (s.vy > FAST_FALL) { s.vy = FAST_FALL; emit(s, "dive"); }
      s.slideBuffer = JUMP_BUFFER;
    }
    s.vy -= GRAVITY * P.gravity * dt;
    s.y += s.vy * dt;
    if (s.y <= ground) {
      const fell = prevSurface - ground;
      s.y = ground;
      s.vy = 0;
      s.airborne = false;
      s.groundedFor = 0;
      if (s.roofLeaveGrace > 0) {
        // landed after a drop off a deck: a moment to find your feet
        s.invuln = Math.max(s.invuln, 0.4);
        s.roofLeaveGrace = 0;
      }
      emit(s, fell > 2 ? "hardLand" : "land");
    }
  } else {
    s.groundedFor += dt;
    if (ground < prevSurface - 0.2) {
      /* Ran off the end of a roof.
         The fall from six metres takes the better part of a second, and
         for all of it the runner can change lanes but cannot jump or
         slide. Dropping them into a barrier they had no way to answer is
         not difficulty, it is a trapdoor — so the descent is protected,
         exactly like the one at the end of a jetpack flight. */
      s.airborne = true;
      s.vy = 0;
      s.roofLeaveGrace = 1.4;
      s.invuln = Math.max(s.invuln, 1.4);
      emit(s, "roofDrop");
    } else if (ground > prevSurface + 0.2) {
      s.y = ground;   // stepped up onto a deck
    } else {
      s.y = ground;
    }
  }

  if (s.sliding) {
    s.slideT -= dt;
    if (s.slideT <= 0 || s.jumpBuffer > 0) { s.sliding = false; s.slideT = 0; }
  }

  const canJump = (!s.airborne || s.groundedFor < COYOTE) && !s.flying && s.flyLand === 0;
  if (s.jumpBuffer > 0 && canJump) doJump(s);
  else if (s.slideBuffer > 0 && !s.airborne && !s.sliding && !s.flying) doSlide(s);

  s.runPhase += dt * (s.flying ? 2 : s.airborne ? 3 : s.sliding ? 4 : s.speed * 0.78);

  /* ------------------------------ world ------------------------------ */
  fillChunks(s);
  stepEnemies(s, dt);
  resolveAttack(s);
  collectCoins(s, dt);
  collectPowerups(s);
  testObstacles(s);
  animateKnocked(s, dt);
  decayFx(s, dt);

  /* ------------------------------ score ------------------------------ */
  s.score += step * s.mult;
}

/* ------------------------------- enemies ------------------------------- */

export const ENEMY_H = 1.8;
const ENEMY_HW = 0.42;

function stepEnemies(s, dt) {
  for (const c of chunksIn(s, s.z - 20, s.z + 90)) {
    for (const e of c.enemies) {
      if (e.state === "down") {
        e.t += dt;
        e.oy -= 9 * dt * e.t;
        e.oz -= e.push * dt;
        e.spin += dt * 7;
        continue;
      }
      const dz = e.z - s.z;
      // wake up while still a long way off, so there is time to react
      if (e.state === "idle" && dz < 46) { e.state = "alert"; e.t = 0; emit(s, "enemySpot"); }
      if (e.state === "alert") {
        e.t += dt;
        /* Closes some of the gap, but never past the runner: an enemy is
           an obstacle you can also punch, not a chase you cannot win. */
        e.z -= Math.min(e.speed * dt, Math.max(0, dz - 2.5));
        e.bob += dt * 8;
      }
    }
  }
}

function enemyInReach(s) {
  const front = s.z + 0.4;
  const back = s.z + ATTACK_REACH;
  for (const c of chunksIn(s, front - 2, back + 4)) {
    for (const e of c.enemies) {
      if (e.state === "down") continue;
      if (e.z < front - 0.6 || e.z > back) continue;
      if (Math.abs(e.x - s.x) > ATTACK_HALF_W + ENEMY_HW) continue;
      const top = s.y + playerHeight(s);
      if (top < 0.5 || s.y > ENEMY_H) continue;
      return e;
    }
  }
  return null;
}

function resolveAttack(s) {
  if (s.attackT <= 0 || s.attackHit) return;
  // the strike lands in the middle of the swing, not on the key-press
  if (s.attackT > ATTACK_TIME * 0.72) return;
  const e = enemyInReach(s);
  if (!e) return;
  s.attackHit = true;
  e.state = "down";
  e.t = 0;
  e.push = 7 + Math.random() * 5;
  e.spin = 0;
  s.combo = Math.min(3, s.combo + 1);
  s.comboT = COMBO_WINDOW;
  s.stats.enemiesBeaten += 1;
  if (s.combo > s.stats.bestCombo) s.stats.bestCombo = s.combo;
  const reward = 40 * s.combo;
  s.score += reward * s.mult;
  s.coins += s.combo;
  s.shake = Math.max(s.shake, 0.35);
  burst(s, e.x, 1, e.z, "#ffd45c", 12);
  emit(s, "enemyDown", s.combo);
}

/* ------------------------------ collisions ------------------------------ */

/* The Z test is swept. At 33 m/s a runner covers most of a thin barrier
   inside one frame, so testing only the end-of-step position would let a
   fast character tunnel straight through one. */
function overlaps(s, o) {
  const zPrev = s.z - s.stepDist;
  if (o.z + o.d * 0.5 < zPrev - PLAYER_HD) return false;
  if (o.z - o.d * 0.5 > s.z + PLAYER_HD) return false;
  if (Math.abs(o.x - s.x) > o.w * 0.5 + PLAYER_HW) return false;
  const base = o.base || 0;
  const top = s.y + playerHeight(s);
  return s.y < base + o.y + o.h && top > base + o.y;
}

function testObstacles(s) {
  const back = 6 + s.stepDist;
  const cs = chunksIn(s, s.z - back, s.z + 8);

  for (const c of cs) {
    /* enemies first: running into one is a hit, so they have to be
       resolved before the runner is declared safe for the frame */
    for (const e of c.enemies) {
      if (e.state === "down" || e.hit) continue;
      if (Math.abs(e.z - s.z) > 0.5 + s.stepDist) continue;
      if (Math.abs(e.x - s.x) > ENEMY_HW + PLAYER_HW) continue;
      const top = s.y + playerHeight(s);
      if (top < 0.3 || s.y > ENEMY_H) continue;      // flown clean over
      e.hit = true;
      if (s.powers.boost > 0 || s.invuln > 0) {
        e.state = "down"; e.t = 0; e.push = 9; e.spin = 0;
        burst(s, e.x, 1, e.z, "#ffb545", 10);
        emit(s, "smash");
        continue;
      }
      if (s.powers.shield > 0) {
        s.powers.shield = 0;
        s.invuln = 0.9;
        s.stats.shieldsUsed += 1;
        e.state = "down"; e.t = 0; e.push = 8; e.spin = 0;
        s.shake = Math.max(s.shake, 0.8);
        burst(s, e.x, 1, e.z, "#5ad1ff", 14);
        emit(s, "shieldBreak");
        continue;
      }
      s.phase = "dead";
      s.causeOfDeath = "enemy";
      s.shake = 1;
      burst(s, e.x, 1, e.z, "#ff6a4d", 16);
      emit(s, "crash", "enemy");
      emit(s, "gameover");
      return;
    }

    for (const o of c.obstacles) {
      if (o.hit) continue;
      if (o.z < s.z - back) continue;
      if (o.z > s.z + 8) break;
      /* Rooftop clutter belongs to the deck, and the deck is something
         you land on, not something you fly through. Clipping a water
         tank while a rocket pack is still hauling you up over the
         parapet is not an obstacle anyone can read — the roof's hazards
         start counting the moment your feet are on it. */
      if (s.flying && (o.base || 0) > 0) continue;
      if (!overlaps(s, o)) continue;

      if (s.powers.boost > 0) {
        knock(o, s, 1.5);
        s.shake = Math.max(s.shake, 0.5);
        burst(s, o.x, (o.base || 0) + o.y + o.h * 0.5, o.z, "#ffb545", 10);
        emit(s, "smash");
        continue;
      }

      if (o.sev === "minor") {
        if (s.invuln > 0) continue;
        // a swing clears junk out of the lane instead of tripping on it
        if (s.attackT > 0) {
          knock(o, s, 1.2);
          burst(s, o.x, o.y + 0.3, o.z, "#ffd45c", 8);
          emit(s, "smash");
          continue;
        }
        knock(o, s, 1);
        s.stumble = STUMBLE_TIME;
        s.invuln = BUMP_INVULN;
        s.shake = Math.max(s.shake, 0.6);
        s.stats.bumps += 1;
        burst(s, o.x, o.y + 0.3, o.z, "#e8b45a", 6);
        emit(s, "bump");
        continue;
      }

      if (s.powers.shield > 0) {
        s.powers.shield = 0;
        s.invuln = 0.9;
        s.stats.shieldsUsed += 1;
        knock(o, s, 1.3);
        s.shake = Math.max(s.shake, 0.8);
        burst(s, o.x, (o.base || 0) + o.y + o.h * 0.5, o.z, "#5ad1ff", 14);
        emit(s, "shieldBreak");
        continue;
      }

      if (s.invuln > 0) continue;

      s.phase = "dead";
      s.causeOfDeath = o.type;
      s.shake = 1;
      o.hit = true;
      burst(s, o.x, (o.base || 0) + o.y + o.h * 0.5, o.z, "#ff6a4d", 16);
      emit(s, "crash", o.type);
      emit(s, "gameover");
      return;
    }
  }
}

function knock(o, s, force) {
  o.hit = true;
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
  for (const c of chunksIn(s, s.z - 40, s.z + 12)) {
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
        && Math.abs(p.y - py) < 1.6) {
        p.taken = true;
        grantPower(s, p.type);
        burst(s, p.x, p.y, p.z, POWER_COLOUR[p.type] || "#8ee6ff", 12);
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

export function summarise(s) {
  return {
    score: Math.floor(s.score),
    distance: Math.floor(s.dist),
    coins: s.coins,
    topSpeed: Math.round(s.stats.topSpeed * 3.6),
    cause: s.causeOfDeath,
    character: s.character,
    stats: { ...s.stats },
    time: s.t,
  };
}

export { speedAt, difficultyAt, CHUNK, LANE_W };
