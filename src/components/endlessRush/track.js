/* ------------------------------------------------------------------ *
 * Kianimation Endless Rush — endless track generation.
 *
 * The track is built one 15-metre chunk at a time, always a few hundred
 * metres ahead of the runner, and thrown away once it is behind. Nothing
 * is ever stored for the whole run, so a twenty-minute session costs the
 * same memory as the first ten seconds.
 *
 * The important promise this file makes is that **every pattern it emits
 * is survivable**. That is not left to luck:
 *
 *   1. Row shapes are chosen from a table that is safe by construction —
 *      no shape ever asks for two different things at once.
 *   2. Rows that need a jump or a slide are spaced by at least the time
 *      it takes to land and act again, so the runner is never asked to
 *      slide while still in the air from the previous jump.
 *   3. Whatever comes out is then run through `solvable()`, a breadth
 *      first search over the rows that starts from *each* of the three
 *      lanes in turn and only passes if all three have a route through.
 *      Lane changes cost real time, so the search cannot cheat by
 *      teleporting sideways.
 *   4. If a chunk somehow fails, `repair()` opens a lane and it is
 *      checked again. A chunk that cannot be repaired is emitted empty
 *      rather than emitted unfair.
 * ------------------------------------------------------------------ */

import { CHUNK, LANES, mulberry32, decorateChunk } from "./world.js";

/* ---------------------------- tuning ---------------------------- */

export const START_SPEED = 11.5;      // m/s at the starting line
export const TOP_SPEED = 27;          // m/s the ramp approaches
const SPEED_RAMP = 1450;              // metres for the ramp's time constant

export const LANE_TIME = 0.17;        // seconds to cross one lane
export const JUMP_AIRTIME = 0.68;     // seconds off the ground
export const SLIDE_TIME = 0.62;       // seconds low to the ground
/* Seconds between two rows that need a jump or a slide.
   It has to be longer than the rider's own airtime, or the game can ask
   for a slide while they are still coming down from the last jump — an
   input that simply cannot be obeyed. The floaty characters hang for
   0.81 s, so a fixed 0.78 was quietly unfair to exactly the characters
   people pay for. */
const VERT_GAP_MIN = 0.8;
const VERT_GAP_MARGIN = 0.22;

const START_SAFE = 72;                // metres of clear road at the start
const ROW_GAP_EASY = 1.24;            // seconds between rows at difficulty 0
const ROW_GAP_HARD = 0.66;            // seconds between rows at difficulty 1

/* ------------------------------ rooftops ------------------------------ */

/* How far ahead a roof is committed to before it is built. It has to be
   more than ROOF_RUNUP, because the jetpack that reaches the roof is
   planted that far in front of it and that road must not have been
   generated yet when the roof is decided. */
const ROOF_LEAD = 60;
const ROOF_RUNUP = 34;                // metres of road between pack and deck
const ROOF_LANDING = 16;              // metres of empty deck to touch down on

/** Running speed at a given distance. Smooth, asymptotic, never a jump. */
export function speedAt(dist) {
  return START_SPEED + (TOP_SPEED - START_SPEED) * (1 - Math.exp(-dist / SPEED_RAMP));
}

/** 0 → 1 difficulty. Reaches ~0.5 at 1 km and ~0.8 at 2.3 km. */
export function difficultyAt(dist) {
  return 1 - Math.exp(-Math.max(0, dist - START_SAFE) / 1450);
}

/* --------------------------- obstacles --------------------------- */

/*  act  — what a runner in this lane has to do:
 *           "dodge" cannot be passed at all, only avoided sideways
 *           "jump"  is cleared by being in the air
 *           "slide" is cleared by being low
 *  sev  — "major" ends the run, "minor" costs speed and a stumble
 */
export const OBSTACLE = {
  /* ---- jump over: solid to the ground, low enough to clear ---- */
  cone:      { w: 0.58, h: 0.66, d: 0.58, y: 0,      act: "jump",  sev: "minor", art: "cone" },
  debris:    { w: 0.90, h: 0.42, d: 0.80, y: 0,      act: "jump",  sev: "minor", art: "debris" },
  /* 0.84 m, not 1.00 m. The jump arc only clears a metre for about a
     third of a second, and test/window.mjs measured the resulting press
     window at 0.24-0.26s for the two heavier characters — half what every
     other obstacle allows, and test/latency.mjs showed barrier deaths
     climbing from one to seven as input lag went from 20ms to 110ms while
     nothing else moved at all. Dropping the rail to the height of a real
     pedestrian barrier costs nothing in readability and roughly doubles
     the time a player has to answer it. */
  barrier:   { w: 1.72, h: 0.84, d: 0.34, y: 0,      act: "jump",  sev: "major", art: "barrier" },
  gap:       { w: 1.90, h: 0.46, d: 2.70, y: -0.44,  act: "jump",  sev: "major", art: "gap" },

  /* ---- slide under: the box starts in the air and the art shows it ----
     `y` is the underside. Anything below it is open road, and the posts
     that hold these up are drawn at the very edge of the box so the gap
     a player can see is exactly the gap collision allows. */
  sign:      { w: 1.86, h: 0.92, d: 0.26, y: 1.34,   act: "slide", sev: "major", art: "sign" },
  worksArch: { w: 1.86, h: 0.86, d: 0.62, y: 1.00,   act: "slide", sev: "major", art: "worksArch" },
  pipe:      { w: 1.86, h: 0.70, d: 0.70, y: 1.06,   act: "slide", sev: "major", art: "pipe" },

  /* ---- dodge: full height, filled to the ground, no gap to tempt anyone ---- */
  crate:     { w: 1.30, h: 2.04, d: 1.30, y: 0,      act: "dodge", sev: "major", art: "crate" },
  vehicle:   { w: 1.80, h: 2.04, d: 4.10, y: 0,      act: "dodge", sev: "major", art: "vehicle" },
  hoarding:  { w: 1.86, h: 2.06, d: 0.46, y: 0,      act: "dodge", sev: "major", art: "hoarding" },
  parkedSuv: { w: 1.86, h: 2.08, d: 4.30, y: 0,      act: "dodge", sev: "major", art: "parkedSuv" },
};

/* Every obstacle above must satisfy this, and the test suite checks it.
   A "slide" obstacle whose box touches the ground is unslideable; a
   "jump" obstacle taller than the jump arc is unjumpable; a "dodge"
   obstacle with a gap under it is a lie the art tells the player. */
export const SLIDE_CLEARANCE = 0.86;   // player height while sliding
export const JUMP_APEX = 1.50;         // the default runner's feet

/* A "dodge" obstacle has to out-reach *every* character's jump, or a
   player who hops it is quietly proving the label wrong — and the
   generator, which assumes dodge means impassable, is reasoning about a
   different game from the one being played. The tallest jumper on the
   roster reaches 1.95 m, so dodge obstacles start above two metres.
   A hoarding really is that tall; so is a stack of crates. */
export const DODGE_MIN_TOP = 2.00;

/* The other side of the same coin: a jump obstacle must be clearable by
   the *worst* jumper, and a slide obstacle must leave room under it for
   the tallest low profile. */
export const JUMP_MAX_TOP = 1.30;
export const SLIDE_MIN_UNDERSIDE = 0.95;

/* Row shapes. `lanes` is filled in at build time; each entry describes
   what goes in each of the three lanes, using null for "left open".
   `vert` marks a shape whose solution needs a jump or a slide. */
const SHAPES = [
  {
    id: "singleDodge", vert: false,
    weight: () => 1.0,
    build: (rng) => {
      const l = (rng() * 3) | 0;
      const r = rng();
      const t = r < 0.42 ? "crate" : r < 0.66 ? "hoarding" : r < 0.86 ? "vehicle" : "parkedSuv";
      const row = [null, null, null];
      row[l] = t;
      return row;
    },
  },
  {
    id: "doubleDodge", vert: false,
    weight: (d) => 0.12 + d * 0.85,
    build: (rng) => {
      const open = (rng() * 3) | 0;
      const t = rng() < 0.5 ? "hoarding" : "crate";
      const row = [t, t, t];
      row[open] = null;
      return row;
    },
  },
  {
    id: "mixed", vert: true,
    weight: (d) => 0.28 + d * 0.5,
    build: (rng) => {
      // one lane simply blocked, one lane jumpable, one lane open
      const order = shuffle3(rng);
      const row = [null, null, null];
      row[order[0]] = rng() < 0.55 ? "crate" : rng() < 0.6 ? "vehicle" : "hoarding";
      row[order[1]] = rng() < 0.5 ? "barrier" : "cone";
      return row;
    },
  },
  {
    id: "jumpAll", vert: true,
    weight: (d) => 0.3 + d * 0.45,
    build: (rng) => {
      const t = rng() < 0.42 ? "gap" : "barrier";
      return [t, t, t];
    },
  },
  {
    id: "slideAll", vert: true,
    weight: (d) => 0.16 + d * 0.5,
    build: (rng) => {
      const t = rng() < 0.4 ? "worksArch" : rng() < 0.6 ? "pipe" : "sign";
      return [t, t, t];
    },
  },
  {
    id: "jumpTwo", vert: true,
    weight: (d) => d * 0.62,
    build: (rng) => {
      const blocked = (rng() * 3) | 0;
      const row = ["barrier", "barrier", "barrier"];
      row[blocked] = rng() < 0.5 ? "crate" : "vehicle";
      return row;
    },
  },
  {
    id: "slideTwo", vert: true,
    weight: (d) => d * 0.46,
    build: (rng) => {
      const blocked = (rng() * 3) | 0;
      const t = rng() < 0.5 ? "worksArch" : "sign";
      const row = [t, t, t];
      row[blocked] = "crate";
      return row;
    },
  },
  {
    id: "scatter", vert: true,
    weight: (d) => 0.22 + d * 0.3,
    build: (rng) => {
      // a light row of knockable junk: never fatal, but it costs speed
      const row = [null, null, null];
      for (let i = 0; i < 3; i += 1) {
        if (rng() < 0.62) row[i] = rng() < 0.55 ? "cone" : "debris";
      }
      if (!row[0] && !row[1] && !row[2]) row[(rng() * 3) | 0] = "cone";
      return row;
    },
  },
];

function shuffle3(rng) {
  const a = [0, 1, 2];
  for (let i = 2; i > 0; i -= 1) {
    const j = (rng() * (i + 1)) | 0;
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function pickShape(rng, d, allowVert) {
  let total = 0;
  const w = [];
  for (let i = 0; i < SHAPES.length; i += 1) {
    const s = SHAPES[i];
    const weight = (!allowVert && s.vert) ? 0 : s.weight(d);
    w.push(weight);
    total += weight;
  }
  if (total <= 0) return SHAPES[0];
  let r = rng() * total;
  for (let i = 0; i < SHAPES.length; i += 1) {
    r -= w[i];
    if (r <= 0) return SHAPES[i];
  }
  return SHAPES[0];
}

/* --------------------------- solvability --------------------------- */

/* Rows are collapsed to what each lane demands, then searched. */
function rowsFrom(obstacles) {
  const byZ = new Map();
  for (const o of obstacles) {
    // anything standing on a rooftop is a different corridor entirely
    if (o.base) continue;
    const key = Math.round(o.z * 2) / 2;
    let row = byZ.get(key);
    if (!row) { row = { z: key, lane: [null, null, null] }; byZ.set(key, row); }
    // when two obstacles share a lane the stricter demand wins
    const cur = row.lane[o.lane];
    if (!cur || rank(o.act) > rank(cur)) row.lane[o.lane] = o.act;
  }
  // long obstacles reach into neighbouring rows
  const rows = [...byZ.values()].sort((p, q) => p.z - q.z);
  for (const row of rows) {
    for (const o of obstacles) {
      if (o.base) continue;
      if (o.d <= 1.5) continue;
      if (Math.abs(o.z - row.z) > (o.d * 0.5 + 0.4)) continue;
      const cur = row.lane[o.lane];
      if (!cur || rank(o.act) > rank(cur)) row.lane[o.lane] = o.act;
    }
  }
  return rows;
}

const rank = (a) => (a === "dodge" ? 3 : a === "slide" ? 2 : a === "jump" ? 1 : 0);

/* Half-depth of the runner's collision box, mirrored from engine.js. It
   is repeated rather than imported so the generator has no dependency on
   the simulation — this file must be safe to run on its own. */
const RUNNER_HD = 0.3;

/**
 * Can the runner get from `from` to `to` somewhere between two rows?
 *
 * Only matters for a two-lane move, because that one passes *through*
 * the middle lane, and a parked vehicle four metres long can still be
 * sitting in it. The runner picks when to cross, so the move is possible
 * as long as one clear window of the required length exists anywhere in
 * the stretch between the two rows.
 */
function crossingOk(obstacles, from, to, z0, z1, speed) {
  const hops = Math.abs(to - from);
  if (hops < 2) return true;
  const mid = (from + to) / 2;
  /* Generous on purpose. A window that is *exactly* wide enough is a
     window nobody actually makes: it assumes the runner commits on the
     first possible frame and holds a perfect line. 1.6× the raw crossing
     distance plus a metre and a half is the difference between a pattern
     that is technically survivable and one that is fair. */
  const need = speed * LANE_TIME * hops * 1.6 + 1.5;
  const start = Math.max(z0, z1 - speed * 3);   // no point looking further back

  const blocks = [];
  for (const o of obstacles) {
    if (o.base) continue;
    if (o.lane !== mid) continue;
    if (o.act !== "dodge") continue;
    const a = o.z - o.d * 0.5 - RUNNER_HD;
    const b = o.z + o.d * 0.5 + RUNNER_HD;
    if (b < start || a > z1) continue;
    blocks.push([a, b]);
  }
  if (!blocks.length) return z1 - start >= need;

  blocks.sort((p, q) => p[0] - q[0]);
  let cursor = start;
  for (const [a, b] of blocks) {
    if (a - cursor >= need) return true;
    if (b > cursor) cursor = b;
  }
  return z1 - cursor >= need;
}

/** How many lanes can be crossed in the run-up to a row. */
function maxHops(gap, speed) {
  /* 1.4× the raw lane time, because a lane change has to *finish*
     before the row arrives — a runner caught halfway across still clips
     the corner of whatever is in the lane they are leaving. */
  return Math.min(2, Math.floor(gap / (speed * LANE_TIME * 1.6)));
}

/**
 * Walks the rows and reports whether the sequence is fair.
 *
 * Stronger than "a route exists". A route existing is not enough: if a
 * runner can legitimately end up in lane 2 at one row and find every
 * option shut at the next, the pattern punished a choice that looked
 * perfectly reasonable when it was made. That is the single thing that
 * makes an endless runner feel cheap.
 *
 * So the walk carries the whole set of lanes the runner could be in, and
 * fails if *any* of them is a dead end at the following row. Combined
 * with starting from all three lanes, that also subsumes the weaker
 * "solvable from wherever they happen to be" check.
 */
function analyse(rows, obstacles, speed) {
  let reach = [true, true, true];
  let prevZ = rows[0].z - speed * 2;

  for (const row of rows) {
    const hops = maxHops(row.z - prevZ, speed);
    const next = [false, false, false];

    for (let l = 0; l < 3; l += 1) {
      if (!reach[l]) continue;
      let escaped = false;
      for (let m = 0; m < 3; m += 1) {
        if (Math.abs(m - l) > hops) continue;
        // "dodge" cannot be answered from inside the lane; everything else can
        if (row.lane[m] === "dodge") continue;
        if (!crossingOk(obstacles, l, m, prevZ, row.z, speed)) continue;
        next[m] = true;
        escaped = true;
      }
      if (!escaped) return row.z;      // a reachable lane with nowhere to go
    }

    if (!next[0] && !next[1] && !next[2]) return row.z;
    reach = next;
    prevZ = row.z;
  }
  return -1;
}

/** Where the pattern first becomes unfair, or -1 when it never does. */
export function firstFailure(obstacles, speed) {
  const rows = rowsFrom(obstacles);
  if (!rows.length) return -1;
  return analyse(rows, obstacles, speed);
}

/** True when the pattern is fair from any lane and contains no traps. */
export function solvable(obstacles, speed) {
  return firstFailure(obstacles, speed) < 0;
}

/**
 * Opens up the chunk being generated so it can pass validation.
 *
 * Only ever edits the new obstacles: everything from earlier chunks has
 * already been drawn on screen and must not move under the runner. When
 * the failure sits in the carried-over context, there is nothing local to
 * fix, so the newest row is dropped instead and the walk is retried —
 * repeated enough times that leaves the chunk empty, which is always
 * fair.
 */
function repairAt(obstacles, failZ) {
  if (!obstacles.length) return;
  const rows = rowsFrom(obstacles);

  // the new row closest to where the walk gave up
  let target = null;
  for (const row of rows) {
    const d = Math.abs(row.z - failZ);
    if (!target || d < target.d) target = { row, d };
  }
  if (!target) { obstacles.length = 0; return; }

  const row = target.row;
  const lane = row.lane.indexOf("dodge");
  if (lane < 0) {
    // nothing blocking to open — drop the whole row and try again
    for (let i = obstacles.length - 1; i >= 0; i -= 1) {
      if (Math.abs(obstacles[i].z - row.z) <= obstacles[i].d * 0.5 + 0.6) obstacles.splice(i, 1);
    }
    return;
  }
  for (let i = obstacles.length - 1; i >= 0; i -= 1) {
    const o = obstacles[i];
    if (o.lane === lane && Math.abs(o.z - row.z) <= o.d * 0.5 + 0.6) obstacles.splice(i, 1);
  }
}

/* ------------------------------ coins ------------------------------ */

const COIN_Y = 0.86;
const COIN_STEP = 1.75;

function addCoinLine(out, lane, z0, count, step) {
  for (let i = 0; i < count; i += 1) {
    out.push({ x: LANES[lane], y: COIN_Y, z: z0 + i * step, lane, taken: false, ph: i * 0.7 });
  }
}

function addCoinArc(out, lane, zCentre, span) {
  const n = Math.max(4, Math.round(span / COIN_STEP));
  for (let i = 0; i <= n; i += 1) {
    const u = i / n;
    out.push({
      x: LANES[lane],
      y: COIN_Y + Math.sin(Math.PI * u) * 1.15,
      z: zCentre - span * 0.5 + span * u,
      lane, taken: false, ph: i * 0.7,
    });
  }
}

function addCoinZig(out, z0, count, step, rng) {
  let lane = (rng() * 3) | 0;
  const dir = rng() < 0.5 ? 1 : -1;
  for (let i = 0; i < count; i += 1) {
    out.push({ x: LANES[lane], y: COIN_Y, z: z0 + i * step, lane, taken: false, ph: i * 0.7 });
    if (i % 2 === 1) {
      lane += dir;
      if (lane < 0) lane = 1;
      if (lane > 2) lane = 1;
    }
  }
}

/** Drops any coin that would sit inside an obstacle. */
function pruneCoins(coins, obstacles) {
  return coins.filter((c) => {
    for (const o of obstacles) {
      if (c.sky) return true;                    // nothing up there to hit
      if (!!o.base !== !!c.roof) continue;
      if (o.lane !== c.lane) continue;
      if (Math.abs(o.z - c.z) > o.d * 0.5 + 0.5) continue;
      const top = o.y + o.h;
      if (c.y - 0.3 < top && c.y + 0.3 > o.y) return false;
      if (o.act === "dodge") return false;
    }
    return true;
  });
}

/* ---------------------------- power-ups ---------------------------- */

/* Weighted so the useful-but-situational ones stay special. The jetpack
   is the rarest because it changes the game for nine seconds. */
export const POWERUPS = [
  ["magnet", 20], ["shield", 20], ["double", 18],
  ["boost", 16], ["superJump", 14], ["jetpack", 12],
];

function pickPower(rng) {
  let total = 0;
  for (const [, w] of POWERUPS) total += w;
  let r = rng() * total;
  for (const [k, w] of POWERUPS) { r -= w; if (r <= 0) return k; }
  return "magnet";
}

/* ------------------------------ chunks ------------------------------ */

/**
 * Creates the generator. It is sequential on purpose: row spacing and the
 * jump/slide rhythm both depend on where the previous row landed, and
 * carrying that state across chunk boundaries is what stops a brutal
 * combination appearing exactly where two chunks meet.
 */
export function createTrack(seed, speedMul = 1, airTime = 0.68) {
  const state = {
    seed: seed >>> 0,
    /* Row spacing is expressed in seconds and converted to metres at the
       speed the rider will actually be doing. Without this a hoverboard,
       which covers a quarter more ground per second, would arrive at
       every row a quarter earlier than the layout assumed — the fastest
       character would silently be playing an unfair game. */
    speedMul,
    vertGap: Math.max(VERT_GAP_MIN, airTime + VERT_GAP_MARGIN),
    nextChunk: 0,
    lastRowZ: START_SAFE,
    lastVertZ: -999,
    lastPowerZ: 140,
    lastEnemyZ: 260,
    lastRoofZ: 320,
    roofPlan: null,
    recent: [],
    repairs: 0,          // how often a pattern had to be opened up
    emptied: 0,          // how often one had to be abandoned entirely
  };

  function buildChunk(index) {
    const z0 = index * CHUNK;
    const z1 = z0 + CHUNK;
    const rng = mulberry32((state.seed ^ (index * 2246822519)) >>> 0);
    const obstacles = [];
    const coins = [];
    const powerups = [];

    const dist = z0;
    const speed = speedAt(dist) * state.speedMul;
    const d = difficultyAt(dist);

    /* ------------------------- obstacle rows ------------------------- */
    if (z1 > START_SAFE) {
      const rowGap = speed * (ROW_GAP_EASY + (ROW_GAP_HARD - ROW_GAP_EASY) * d);
      let z = Math.max(state.lastRowZ + rowGap * (0.85 + rng() * 0.4), z0);

      while (z < z1) {
        if (z < START_SAFE) { z += rowGap; continue; }
        const vertOk = (z - state.lastVertZ) >= speed * state.vertGap;
        const shape = pickShape(rng, d, vertOk);
        const row = shape.build(rng);

        let usedVert = false;
        for (let lane = 0; lane < 3; lane += 1) {
          const type = row[lane];
          if (!type) continue;
          const spec = OBSTACLE[type];
          if (spec.act === "jump" || spec.act === "slide") usedVert = true;
          obstacles.push({
            type, art: spec.art, lane,
            x: LANES[lane], y: spec.y, z,
            w: spec.w, h: spec.h, d: spec.d,
            act: spec.act, sev: spec.sev,
            hit: false, seed: (rng() * 1000) | 0,
          });
        }
        if (usedVert) state.lastVertZ = z;
        state.lastRowZ = z;
        z += rowGap * (0.85 + rng() * 0.45);
      }
    }

    /* --------------------- guarantee it can be run ---------------------
       Validation runs over the new rows *plus* everything still standing
       from the previous few chunks. Checking a chunk on its own leaves a
       blind spot exactly at the seam, where a two-lane escape can be
       walled off by a vehicle that was generated just before the
       boundary — which is precisely where an unfair pattern is hardest
       to spot and most infuriating to run into. */
    const context = state.recent;
    for (let tries = 0; tries < 10; tries += 1) {
      const failZ = firstFailure(context.concat(obstacles), speed);
      if (failZ < 0) break;
      if (!obstacles.length) break;
      repairAt(obstacles, failZ);
      state.repairs += 1;
    }
    if (!solvable(context.concat(obstacles), speed)) {
      obstacles.length = 0;
      state.emptied += 1;
    }

    /* Carry forward whatever is still close enough to matter for the
       next chunk. Three seconds of running at the current speed is more
       than any single manoeuvre needs. */
    const keep = z1 - Math.max(45, speed * 3.5);
    state.recent = context.filter((o) => o.z + o.d > keep).concat(obstacles);

    /* ----------------------------- coins ----------------------------- */
    const jumpRows = obstacles.filter((o) => o.act === "jump" && o.sev === "major");
    if (jumpRows.length && rng() < 0.7) {
      const o = jumpRows[(rng() * jumpRows.length) | 0];
      addCoinArc(coins, o.lane, o.z, 7.5);
    }
    const roll = rng();
    if (roll < 0.34) {
      addCoinLine(coins, (rng() * 3) | 0, z0 + rng() * 3, 6 + ((rng() * 4) | 0), COIN_STEP);
    } else if (roll < 0.58) {
      addCoinZig(coins, z0 + rng() * 3, 8 + ((rng() * 4) | 0), COIN_STEP, rng);
    } else if (roll < 0.7) {
      const lane = (rng() * 3) | 0;
      addCoinLine(coins, lane, z0 + rng() * 4, 4, COIN_STEP);
      if (lane > 0) addCoinLine(coins, lane - 1, z0 + rng() * 4, 3, COIN_STEP);
    }

    /* --------------------------- power-ups --------------------------- */
    if (z0 - state.lastPowerZ > 230 + rng() * 140) {
      // find a lane with nothing in it anywhere across the chunk
      const busy = [false, false, false];
      for (const o of obstacles) busy[o.lane] = true;
      let lane = busy.indexOf(false);
      if (lane < 0) lane = (rng() * 3) | 0;
      const pz = z0 + CHUNK * (0.3 + rng() * 0.4);
      const clear = obstacles.every(
        (o) => o.lane !== lane || Math.abs(o.z - pz) > o.d * 0.5 + 3,
      );
      if (clear) {
        powerups.push({
          type: pickPower(rng),
          x: LANES[lane], y: 1.05, z: pz, lane, taken: false, ph: rng() * 6.28,
        });
        state.lastPowerZ = z0;
      }
    }

    /* ------------------------------ enemies ------------------------------
       An enemy is an obstacle you are also allowed to punch. It is
       generated exactly like a "dodge" row — through the same validator,
       with the same guarantee that another lane is open — so the fight is
       always optional and never the only way through. */
    const enemies = [];
    if (z0 > 260 && z0 - state.lastEnemyZ > 150 + rng() * 130) {
      const free = [0, 1, 2].filter((L) => obstacles.every(
        (o) => o.lane !== L || Math.abs(o.z - (z0 + CHUNK * 0.5)) > o.d * 0.5 + 6,
      ));
      if (free.length >= 2) {
        const lane = free[(rng() * free.length) | 0];
        const ez = z0 + CHUNK * (0.25 + rng() * 0.5);
        const probe = {
          type: "enemy", art: "enemy", lane, x: LANES[lane], y: 0, z: ez,
          w: 0.84, h: 1.8, d: 0.8, act: "dodge", sev: "major", hit: false, seed: 1,
        };
        if (solvable(state.recent.concat(obstacles, [probe]), speed)) {
          /* The probe exists only so the validator reserves a lane for
             the fight. It is never added to the obstacle list, because
             the enemy moves and owns its own collision — leaving a
             static copy behind would hit the player twice. It does go
             into the carried-over context so the next chunk still knows
             this lane was spoken for. */
          state.recent = state.recent.concat([probe]);
          enemies.push({
            lane, x: LANES[lane], z: ez,
            kind: rng() < 0.5 ? "bruiser" : "runner",
            speed: 2 + rng() * 3,
            state: "idle", t: 0, bob: rng() * 6.28,
            oy: 0, oz: 0, spin: 0, push: 0, hit: false,
            seed: (rng() * 1000) | 0,
          });
          state.lastEnemyZ = z0;
        }
      }
    }

    /* ------------------------------ rooftops ------------------------------
       A roof is a deck a few storeys up with its own coins and its own
       light scenery. There is no jump from the street that reaches it —
       it is somewhere the jetpack takes you — and running off the end
       simply drops you back to the road, so no gap up there can ever be
       impossible.

       Roofs are *planned* several chunks before they are *built*. The
       jetpack that gets you up there has to sit about thirty-five metres
       earlier, and by the time a roof could be rolled at random that
       road has already been generated and handed out. So the decision is
       parked in `state.roofPlan`, the jetpack is planted by whichever
       chunk turns out to contain its spot, and the deck itself is
       emitted by whichever chunk contains its start. */
    if (!state.roofPlan && z0 > 320 && z0 - state.lastRoofZ > 380 + rng() * 320) {
      const len = 46 + rng() * 44;
      const rz = z0 + ROOF_LEAD;
      state.roofPlan = {
        z0: rz,
        z1: rz + len,
        len,
        y: 5.6 + rng() * 1.4,
        lanes: rng() < 0.65 ? [true, true, true]
          : rng() < 0.5 ? [true, true, false] : [false, true, true],
        seed: (rng() * 1000) | 0,
        gz: rz - ROOF_RUNUP,
        jetDone: false,
      };
      state.lastRoofZ = rz + len;
    }

    /* The jetpack for a planned roof, planted in the chunk that holds it
       rather than in the chunk that made the plan. */
    const plan = state.roofPlan;
    const jetHere = plan && !plan.jetDone && plan.gz >= z0 && plan.gz < z1;
    if (jetHere) {
      const lane = (rng() * 3) | 0;
      powerups.push({
        type: "jetpack", x: LANES[lane], y: 1.05, z: plan.gz,
        lane, taken: false, ph: rng() * 6.28, forRoof: true,
      });
      plan.jetDone = true;
      state.lastPowerZ = z0;
    }

    const roofs = [];
    if (plan && plan.z0 >= z0 && plan.z0 < z1) {
      const { len, y, lanes } = plan;
      roofs.push({ z0: plan.z0, z1: plan.z1, y, lanes, seed: plan.seed });
      state.roofPlan = null;

      // a coin trail the length of the deck, in a lane the roof actually has
      const rlane = lanes[1] ? 1 : lanes[0] ? 0 : 2;
      for (let i = 0; i < Math.floor(len / 2.2); i += 1) {
        coins.push({
          x: LANES[rlane], y: y + 0.9, z: plan.z0 + 4 + i * 2.2,
          lane: rlane, taken: false, ph: i * 0.7, roof: true,
        });
      }
      if (rng() < 0.75) {
        const plane = lanes[2] ? 2 : lanes[0] ? 0 : 1;
        powerups.push({
          type: pickPower(rng), x: LANES[plane], y: y + 1.05,
          z: plan.z0 + 10 + rng() * (len - 20), lane: plane, taken: false,
          ph: rng() * 6.28, roof: true,
        });
      }
      /* Rooftop clutter is safe by construction rather than by
         validation: never in the landing zone, never two at the same
         distance, and never more than one lane at a time — so two lanes
         are always open and no arrangement of vents can wall the deck
         off. */
      const usable = len - ROOF_LANDING - 8;
      const slots = Math.max(0, Math.floor(usable / 13));
      let lastLane = -1;
      for (let i = 0; i < slots; i += 1) {
        if (rng() < 0.28) continue;
        const open = [0, 1, 2].filter((L) => lanes[L] && L !== lastLane);
        if (!open.length) continue;
        const cl = open[(rng() * open.length) | 0];
        lastLane = cl;
        const kind = rng() < 0.45 ? "vent" : rng() < 0.72 ? "tank" : "aircon";
        const dims = kind === "tank" ? [1.05, 1.5, 1.05]
          : kind === "vent" ? [0.8, 0.9, 0.8] : [1.15, 0.85, 1.0];
        obstacles.push({
          type: kind, art: kind, lane: cl, x: LANES[cl], y: 0, base: y,
          z: plan.z0 + ROOF_LANDING + i * 13 + rng() * 4,
          w: dims[0], h: dims[1], d: dims[2],
          act: "dodge", sev: "major", hit: false, seed: (rng() * 1000) | 0,
        });
      }
    }

    /* Coins at flight altitude. They are unreachable on foot and the
       whole point of a pack, so they only appear where one has just been
       planted or where a roof is coming. */
    if (jetHere || roofs.length) {
      const lane = (rng() * 3) | 0;
      const startZ = z0 + 6 + rng() * 6;
      for (let i = 0; i < 10; i += 1) {
        coins.push({
          x: LANES[lane], y: 5.4 + Math.sin(i * 0.5) * 0.5, z: startZ + i * 2.6,
          lane, taken: false, ph: i * 0.7, sky: true,
        });
      }
    }

    const decor = [];
    decorateChunk(index, decor);

    /* A chunk's bounds have to cover what it actually contains, not just
       the fifteen metres it was allotted. A roof is up to ninety metres
       long and its coins and clutter go with it, all held by the chunk
       that emitted the deck — and `chunksIn` decides what to collide and
       what to draw purely from `z0`/`z1`. Left at z0+CHUNK, everything
       past the first few metres of every rooftop silently stopped
       existing: you would run onto a deck and fall through the far end
       of it. */
    let zEnd = z1;
    const reach = (z) => { if (z > zEnd) zEnd = z; };
    for (const o of obstacles) reach(o.z + o.d * 0.5);
    for (const c of coins) reach(c.z);
    for (const p of powerups) reach(p.z);
    for (const e of enemies) reach(e.z);
    for (const rf of roofs) reach(rf.z1);

    return {
      index, z0, z1: zEnd,
      obstacles,
      coins: pruneCoins(coins, obstacles),
      powerups,
      decor,
      enemies,
      roofs,
    };
  }

  return {
    state,
    /** Next chunk in sequence. Chunks must be pulled in order. */
    next() {
      const c = buildChunk(state.nextChunk);
      state.nextChunk += 1;
      return c;
    },
    reset(newSeed, newSpeedMul, newAirTime) {
      state.seed = (newSeed ?? state.seed) >>> 0;
      if (newSpeedMul) state.speedMul = newSpeedMul;
      if (newAirTime) state.vertGap = Math.max(VERT_GAP_MIN, newAirTime + VERT_GAP_MARGIN);
      state.nextChunk = 0;
      state.lastRowZ = START_SAFE;
      state.lastVertZ = -999;
      state.lastPowerZ = 140;
      state.lastEnemyZ = 260;
      state.lastRoofZ = 320;
      state.roofPlan = null;
      state.recent = [];
    },
  };
}
