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
const VERT_GAP = 0.78;                // seconds between two vertical beats

const START_SAFE = 72;                // metres of clear road at the start
const ROW_GAP_EASY = 1.24;            // seconds between rows at difficulty 0
const ROW_GAP_HARD = 0.66;            // seconds between rows at difficulty 1

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
  cone:    { w: 0.58, h: 0.66, d: 0.58, y: 0,     act: "jump",  sev: "minor", art: "cone" },
  debris:  { w: 0.90, h: 0.42, d: 0.80, y: 0,     act: "jump",  sev: "minor", art: "debris" },
  barrier: { w: 1.72, h: 1.04, d: 0.34, y: 0,     act: "jump",  sev: "major", art: "barrier" },
  crate:   { w: 1.30, h: 1.30, d: 1.30, y: 0,     act: "dodge", sev: "major", art: "crate" },
  sign:    { w: 1.86, h: 0.92, d: 0.26, y: 1.34,  act: "slide", sev: "major", art: "sign" },
  gap:     { w: 1.90, h: 0.46, d: 2.70, y: -0.44, act: "jump",  sev: "major", art: "gap" },
  vehicle: { w: 1.80, h: 1.55, d: 4.10, y: 0,     act: "dodge", sev: "major", art: "vehicle" },
  zone:    { w: 1.86, h: 1.28, d: 1.70, y: 0,     act: "dodge", sev: "major", art: "zone" },
};

/* Row shapes. `lanes` is filled in at build time; each entry describes
   what goes in each of the three lanes, using null for "left open".
   `vert` marks a shape whose solution needs a jump or a slide. */
const SHAPES = [
  {
    id: "singleDodge", vert: false,
    weight: () => 1.0,
    build: (rng) => {
      const l = (rng() * 3) | 0;
      const t = rng() < 0.55 ? "crate" : rng() < 0.5 ? "zone" : "vehicle";
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
      const t = rng() < 0.5 ? "zone" : "crate";
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
      row[order[0]] = rng() < 0.6 ? "crate" : "vehicle";
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
    weight: (d) => 0.14 + d * 0.5,
    build: () => ["sign", "sign", "sign"],
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
      const row = ["sign", "sign", "sign"];
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

export const POWERUPS = ["magnet", "shield", "double", "boost"];

/* ------------------------------ chunks ------------------------------ */

/**
 * Creates the generator. It is sequential on purpose: row spacing and the
 * jump/slide rhythm both depend on where the previous row landed, and
 * carrying that state across chunk boundaries is what stops a brutal
 * combination appearing exactly where two chunks meet.
 */
export function createTrack(seed) {
  const state = {
    seed: seed >>> 0,
    nextChunk: 0,
    lastRowZ: START_SAFE,
    lastVertZ: -999,
    lastPowerZ: 140,
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
    const speed = speedAt(dist);
    const d = difficultyAt(dist);

    /* ------------------------- obstacle rows ------------------------- */
    if (z1 > START_SAFE) {
      const rowGap = speed * (ROW_GAP_EASY + (ROW_GAP_HARD - ROW_GAP_EASY) * d);
      let z = Math.max(state.lastRowZ + rowGap * (0.85 + rng() * 0.4), z0);

      while (z < z1) {
        if (z < START_SAFE) { z += rowGap; continue; }
        const vertOk = (z - state.lastVertZ) >= speed * VERT_GAP;
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
          type: POWERUPS[(rng() * POWERUPS.length) | 0],
          x: LANES[lane], y: 1.05, z: pz, lane, taken: false, ph: rng() * 6.28,
        });
        state.lastPowerZ = z0;
      }
    }

    const decor = [];
    decorateChunk(index, decor);

    return {
      index, z0, z1,
      obstacles,
      coins: pruneCoins(coins, obstacles),
      powerups,
      decor,
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
    reset(newSeed) {
      state.seed = (newSeed ?? state.seed) >>> 0;
      state.nextChunk = 0;
      state.lastRowZ = START_SAFE;
      state.lastVertZ = -999;
      state.lastPowerZ = 140;
      state.recent = [];
    },
  };
}
