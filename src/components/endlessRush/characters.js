/* ------------------------------------------------------------------ *
 * Kianimation Endless Rush — the playable characters.
 *
 * Four humans, all of them real scans from `public/models/`, baked down
 * by `tools/bake-models.mjs`. The first runs on foot; the other three
 * bring something to ride, are bought with coins, and handle noticeably
 * differently.
 *
 * Balance rule for the whole roster: **speed is the cost, not the
 * reward.** Every faster character brings the world at you sooner, and
 * the obstacle course is laid out in seconds rather than metres, so a
 * quicker ride means less time to read each row. What the paid
 * characters actually buy is a *different* problem — a bike that slides
 * through turns, a board that glides between lanes, boots that let you
 * live in the air — not a strictly better one. Nothing here is an
 * upgrade over the free runner; it is a change of instrument.
 * ------------------------------------------------------------------ */

import { L_VOLUME, L_GLOW, clamp } from "./render.js";

export const CHARACTERS = [
  {
    id: "runner",
    name: "Street Runner",
    ride: "none",
    model: "human-male",
    price: 0,
    height: 1.72,
    tagline: "On foot, and the best-behaved of the four.",
    blurb: "Even speed, even jump, the tightest lane changes. Everything else is measured against him.",
    traits: ["Balanced speed", "Normal jump", "Best control"],
    accent: "#f4b965",
    /* multipliers against the base runner */
    speed: 1,
    laneTime: 1,
    jump: 1,
    gravity: 1,
    lowTime: 1,
    airSteer: 1,
  },
  {
    id: "courier",
    name: "Market Courier",
    ride: "bicycle",
    model: "human-female",
    price: 2500,
    height: 1.68,
    tagline: "Quick on the straights, lazy into the corners.",
    blurb: "Carries more speed than anyone on foot, but a bike does not sidestep — it leans, and it takes its time about it. Ducks under low work instead of sliding.",
    traits: ["Faster on the flat", "Wide, slow lane changes", "Ducks instead of sliding"],
    accent: "#6fd08a",
    speed: 1.13,
    laneTime: 1.38,
    jump: 1,
    gravity: 1.05,
    lowTime: 1.25,
    airSteer: 0.8,
  },
  {
    id: "skyrider",
    name: "Skyrider",
    ride: "hoverboard",
    model: "human-young",
    price: 6000,
    height: 1.66,
    tagline: "Fastest thing on the road, and it never quite touches it.",
    blurb: "Glides between lanes almost instantly and floats a long way off a jump. The catch is the pace: the road arrives a quarter faster than anyone else has to read it.",
    traits: ["Very fast", "Instant lane changes", "Long, floaty jumps"],
    accent: "#5ad1ff",
    speed: 1.24,
    laneTime: 0.82,
    jump: 1,
    gravity: 0.84,
    lowTime: 0.95,
    airSteer: 1.15,
  },
  {
    id: "jetkid",
    name: "Jet Kid",
    ride: "jetshoes",
    model: "human-child",
    price: 10000,
    height: 1.42,
    tagline: "Small, quick, and happiest off the ground.",
    blurb: "Winged boots throw you higher than anyone and steer properly in mid-air, which turns a row of barriers into a runway. Landing is the hard part.",
    traits: ["High jump", "Real air control", "Small target"],
    accent: "#9e62ff",
    speed: 1.16,
    laneTime: 0.92,
    jump: 1.1,
    gravity: 0.92,
    lowTime: 1,
    airSteer: 1.5,
  },
];

export const DEFAULT_CHARACTER = "runner";

/* Apex of the jump arc, in metres, for a given character.
   Every jump obstacle has to sit below the *lowest* of these and every
   dodge obstacle above the *highest*, or the roster quietly changes
   which obstacles are passable. `test/obstacles.mjs` enforces both. */
export function jumpApex(ch, jumpV = 8.84, gravity = 26) {
  const v = jumpV * ch.jump;
  return (v * v) / (2 * gravity * ch.gravity);
}

export function airTime(ch, jumpV = 8.84, gravity = 26) {
  return (2 * jumpV * ch.jump) / (gravity * ch.gravity);
}

export function characterById(id) {
  return CHARACTERS.find((c) => c.id === id) || CHARACTERS[0];
}

/** Every baked mesh the roster needs, for preloading. */
export const CHARACTER_MODELS = CHARACTERS.map((c) => c.model);

/* ------------------------------ the rides ------------------------------ */

/*  Drawn procedurally around the character rather than modelled, for the
    same reason the obstacles are: a handful of boxes costs nothing, sorts
    correctly with everything else, and can be posed frame by frame. The
    wheels really do turn — the rotation is the distance travelled divided
    by the wheel radius, so it never looks like it is sliding. */

const WHEEL_R = 0.34;
/* Saddle height. The rig holds a rider's pelvis at roughly 0.52 of their
   own height — about 0.87 m for the courier — so the saddle goes there
   rather than at the 0.70 m a scaled-down toy bike would have, and she
   sits on it instead of hovering over it. */
const SADDLE = 0.86;
const FRONT_HUB = 0.62;               // wheel centres, fore and aft
const REAR_HUB = -0.58;

function wheel(r, x, y, z, radius, angle, tint, spokes) {
  const N = 9;
  const rim = "#1c1f25";
  for (let i = 0; i < N; i += 1) {
    const a0 = angle + (i / N) * Math.PI * 2;
    const a1 = angle + ((i + 1) / N) * Math.PI * 2;
    r.poly([
      x, y, z,
      x, y + Math.sin(a0) * radius, z + Math.cos(a0) * radius,
      x, y + Math.sin(a1) * radius, z + Math.cos(a1) * radius,
    ], i % 2 && spokes ? "#4a5058" : rim, (i % 2 ? 0.9 : 0.72) * tint, L_VOLUME);
  }
  if (spokes) {
    for (let i = 0; i < 3; i += 1) {
      const a = angle + (i / 3) * Math.PI * 2;
      r.poly([
        x - 0.012, y, z,
        x + 0.012, y + Math.sin(a) * (radius - 0.04), z + Math.cos(a) * (radius - 0.04),
        x - 0.012, y + Math.sin(a) * (radius - 0.04), z + Math.cos(a) * (radius - 0.04),
      ], "#98a0aa", 1.1 * tint, L_VOLUME);
    }
  }
}

/**
 * Draws whatever the character is riding.
 * `p` carries the world placement plus enough of the pose to keep the
 * ride attached: the same lean, the same bob, the same ground height.
 *
 * Note `wx`/`wy`, not `x`/`y`. The road's curve and hills are cosmetic —
 * the simulation is dead straight and flat, and the bend is added at
 * draw time to the camera, the runner and everything on the road alike.
 * A ride drawn at the simulation position instead of the drawn one sits
 * up to a metre to the side of its own rider, which is precisely what a
 * bicycle riding along beside its courier looks like.
 */
export function drawRide(r, kind, p, tint, atmos, t) {
  const px = p.wx ?? p.x;
  const py = p.wy ?? p.y;
  switch (kind) {
    case "bicycle": {
      const spin = -p.dist / WHEEL_R;
      const frame = "#2f9e6b";
      const lean = p.lean * 0.34;
      const zc = Math.cos(lean), zs = Math.sin(lean);
      const off = (dx, dy) => [px + dx * zc - dy * zs, py + dx * zs + dy * zc];

      for (const [dz, ang] of [[FRONT_HUB, spin], [REAR_HUB, spin]]) {
        const [wx, wy] = off(0, WHEEL_R);
        wheel(r, wx, wy - WHEEL_R, p.z + dz, WHEEL_R, ang, tint, true);
      }

      /* The frame is a flat truss in the plane the wheels turn in, so it
         is drawn the same way they are: thin quads at ±x rather than
         boxes. A box wide enough to see from the side reads as a green
         billboard with a bicycle behind it, which is what the first pass
         of this looked like. */
      const tube = (y0, z0, y1, z1, w, shade) => {
        const dy = y1 - y0, dz = z1 - z0;
        const len = Math.hypot(dy, dz) || 1;
        const ny = (-dz / len) * w, nz = (dy / len) * w;
        for (const sx of [-0.018, 0.018]) {
          const [c0x, c0y] = off(sx, y0 + ny);
          const [c1x, c1y] = off(sx, y0 - ny);
          const [c2x, c2y] = off(sx, y1 - ny);
          const [c3x, c3y] = off(sx, y1 + ny);
          const zz0 = p.z + z0 + nz, zz1 = p.z + z0 - nz;
          const zz2 = p.z + z1 - nz, zz3 = p.z + z1 + nz;
          r.poly([c0x, c0y, zz0, c1x, c1y, zz1, c2x, c2y, zz2], frame, shade * tint, L_VOLUME);
          r.poly([c0x, c0y, zz0, c2x, c2y, zz2, c3x, c3y, zz3], frame, shade * tint, L_VOLUME);
        }
      };

      const BB_Y = 0.30, BB_Z = 0.02;               // bottom bracket
      const HEAD_Y = SADDLE + 0.06, HEAD_Z = 0.50;  // top of the head tube
      const SEAT_Z = -0.42;
      tube(BB_Y, BB_Z, SADDLE, SEAT_Z, 0.022, 1.0);        // seat tube
      tube(BB_Y, BB_Z, HEAD_Y, HEAD_Z, 0.024, 1.12);       // down tube
      tube(SADDLE, SEAT_Z, HEAD_Y, HEAD_Z, 0.02, 0.92);    // top tube
      tube(BB_Y, BB_Z, WHEEL_R, REAR_HUB, 0.016, 0.84);    // chain stay
      tube(SADDLE - 0.04, SEAT_Z, WHEEL_R, REAR_HUB, 0.015, 0.8);   // seat stay
      tube(HEAD_Y - 0.06, HEAD_Z, WHEEL_R, FRONT_HUB, 0.018, 0.96); // fork

      const [bx, by] = off(0, SADDLE);
      const [hx, hy] = off(0, HEAD_Y);
      r.box(bx, by + 0.03, p.z + SEAT_Z, 0.085, 0.035, 0.115, "#22262e", tint);   // saddle
      r.box(hx, hy + 0.05, p.z + HEAD_Z, 0.24, 0.028, 0.035, "#22262e", 1.1 * tint); // bars
      r.box(hx - 0.24, hy + 0.05, p.z + HEAD_Z, 0.05, 0.038, 0.038, "#d8543f", 1.1 * tint);
      r.box(hx + 0.24, hy + 0.05, p.z + HEAD_Z, 0.05, 0.038, 0.038, "#d8543f", 1.1 * tint);
      // pedals, turning with the wheels
      const pa = spin * 0.55;
      for (const s of [-1, 1]) {
        const py = BB_Y + Math.sin(pa + (s > 0 ? 0 : Math.PI)) * 0.16;
        const pz = BB_Z + Math.cos(pa + (s > 0 ? 0 : Math.PI)) * 0.16;
        const [px2, py2] = off(s * 0.11, py);
        r.box(px2, py2, p.z + pz, 0.05, 0.02, 0.07, "#22262e", 1.1 * tint);
      }
      if (atmos.night > 0.3) r.glow(px, py + 0.62, p.z + 0.66, 1.5, "#fff0c0", 0.5 * atmos.night);
      break;
    }

    case "hoverboard": {
      /* The board sits under the feet and the character stands *on* it —
         the hover gap is small and lit from beneath, so it reads as
         floating rather than as a figure stranded in mid-air. */
      const hover = p.hover;
      const bob = Math.sin(t * 5.5) * 0.02;
      const by = py + bob;
      const tilt = p.lean * 0.2;
      r.boxRot(px, by - 0.09, p.z, 0.29, 0.045, 0.68, tilt, "#2b3242", tint);
      r.boxRot(px, by - 0.05, p.z, 0.26, 0.02, 0.63, tilt, "#5ad1ff", 1.25 * tint);
      r.boxRot(px, by - 0.13, p.z + 0.44, 0.2, 0.035, 0.16, tilt, "#1b2028", tint);
      r.boxRot(px, by - 0.13, p.z - 0.44, 0.2, 0.035, 0.16, tilt, "#1b2028", tint);
      // thrust: two jets angled back and down, brighter the faster you go
      const heat = clamp(0.4 + p.speedNorm * 0.7, 0, 1.2);
      for (const s of [-1, 1]) {
        r.glow(px + s * 0.17, by - 0.12 - hover * 0.3, p.z - 0.6, 0.42, "#5ad1ff", 0.7 * heat);
        r.glow(px + s * 0.17, by - 0.14, p.z - 0.86 - heat * 0.2, 0.3, "#b8ecff", 0.5 * heat);
      }
      r.glow(px, by - 0.2 - hover * 0.5, p.z, 1.05, "#5ad1ff", 0.34 + hover * 0.2);
      break;
    }

    case "jetshoes": {
      const heat = clamp(0.35 + p.speedNorm * 0.5 + (p.airborne ? 0.65 : 0), 0, 1.4);
      for (const [fx, fy, fz, side] of p.feet) {
        // boot, then a wing either side of it
        r.box(fx, fy - 0.03, fz, 0.09, 0.055, 0.15, "#2b3242", tint);
        for (const s of [-1, 1]) {
          r.poly([
            fx + s * 0.08, fy + 0.03, fz - 0.02,
            fx + s * 0.26, fy + 0.14, fz - 0.14,
            fx + s * 0.09, fy + 0.02, fz - 0.17,
          ], "#9e62ff", 1.2 * tint, L_VOLUME);
          r.poly([
            fx + s * 0.08, fy + 0.03, fz - 0.02,
            fx + s * 0.24, fy + 0.02, fz - 0.16,
            fx + s * 0.26, fy + 0.14, fz - 0.14,
          ], "#7a45d0", 1.05 * tint, L_VOLUME);
        }
        r.glow(fx, fy - 0.02, fz - 0.2, 0.3 + heat * 0.12, side < 0 ? "#c79cff" : "#9e62ff", 0.55 * heat);
      }
      break;
    }
    default:
      break;
  }
}

/* ---------------------------- ride-specific FX ---------------------------- */

/** A short trail behind the fast rides, so speed reads even head-on. */
export function drawRideTrail(r, kind, p, tint) {
  if (kind !== "hoverboard" && kind !== "jetshoes") return;
  /* The trail is a speed cue. On the shop turntable nobody is moving, so
     it is just a glowing smear hanging in the air behind a standing
     figure. */
  if (p.still) return;
  const n = 4;
  const px = p.wx ?? p.x;
  const py = p.wy ?? p.y;
  for (let i = 1; i <= n; i += 1) {
    const k = i / n;
    r.glow(
      px - p.lean * 0.2 * k,
      py + (kind === "hoverboard" ? 0.02 : 0.12) + k * 0.05,
      p.z - 0.8 - k * 1.5,
      0.38 - k * 0.06,
      kind === "hoverboard" ? "#5ad1ff" : "#9e62ff",
      (0.4 - k * 0.07) * clamp(p.speedNorm + 0.3, 0, 1.4),
    );
  }
  void tint;
  void L_GLOW;
}
