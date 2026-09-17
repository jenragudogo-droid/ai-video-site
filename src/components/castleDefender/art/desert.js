/* ------------------------------------------------------------------ *
 * Castle Defender — the Sunspear Reach battlefield art.
 *
 * Kingdom three is fought on pale, open ground. Ashford is green and
 * the north is white-blue, so the Reach is bleached rather than orange:
 * the red only shows where something casts a shadow. Same idiom as the
 * rest of the world — flat fills under one thin dark outline, a lit
 * edge and a shaded edge instead of gradients on figures, a soft ground
 * shadow under everything, and no assets but paths.
 *
 * Everything here is a pure draw call: a ctx goes in, pixels come out,
 * any state touched is put back. No engine state is read.
 * ------------------------------------------------------------------ */

import { rgba, shade } from "./palette.js";
import { SUN } from "./sunspear.js";

const OUT = "rgba(52, 26, 14, 0.6)";
const TAU = Math.PI * 2;

export const DESERT = {
  /* Noon sand, not sunset sand: the teaser panel can afford saturated
     dunes, a battlefield you stare at for ten minutes cannot. */
  sand: "#e6bd83", sandLight: "#f6dcae", sandDark: "#bf8a4e",
  /* The road is the single most important line on the board. In the
     north it had to run darker and browner than the snow; pale sand
     needs the same answer — packed red earth, well below the ground
     around it in value, so a route reads at a glance. */
  road: "#b4703c", roadDark: "#93542a", roadEdge: "#70391a", pebble: "#f2ddb2",
  rock: "#b58a5c", rockDark: "#7c5530", dryGrass: "#c2a95e",
  palm: SUN.palm, palmDark: SUN.palmDark,
  stone: SUN.stone, stoneLit: SUN.stoneLit, stoneDark: SUN.stoneDark,
  banner: SUN.banner, bannerTrim: SUN.bannerTrim,
  ember: "#ff7a26", emberLight: "#ffd867",
  shadow: "rgba(92, 44, 18, 0.3)",
};

/* wyrm and chariot livery: bronze and hide, kept off the ground palette
   because nothing on the ground plane should be painted in them */
const HIDE = "#a8663a"; const HIDE_LIT = "#c98a4e"; const BELLY = "#e6c493"; const PLATE = "#7a4520";
const BRONZE = "#b98436"; const BRONZE_LIT = "#e8c169"; const BRONZE_DARK = "#7d5520";
const HORSE = "#8d5a34"; const HORSE_DARK = "#6a3f22";
const CEDAR = "#7a5230"; const CEDAR_DARK = "#4a3320";

function outlined(ctx, fill, path, lw = 1.4) {
  ctx.beginPath(); path(); ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = OUT; ctx.lineWidth = lw; ctx.stroke();
}

/* the soft ellipse everything stands in; offset right because the sun
   sits high and to the left everywhere in this game */
function groundShadow(ctx, x, y, rx, ry, a = 1) {
  ctx.fillStyle = rgba("#5c2c12", 0.3 * a); ctx.beginPath(); ctx.ellipse(x + rx * 0.16, y + 2, rx, ry, 0, 0, TAU); ctx.fill();
}

function seeded(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* integer frame counter → a 0..1 loop phase */
function phase(frame, len) { return ((frame % len) + len) % len / len; }

/* ------------------------------ ground decor ------------------------------ */

/* A date palm, the Reach's answer to frostPine. rng varies the lean,
   the frond count and the fruit so a grove is not one tree stamped
   six times — a palm silhouette is distinctive enough that repeats show. */
export function desertPalm(ctx, x, y, s, rng) {
  const lean = (rng() - 0.5) * 12;                 // which way the wind has bent it
  const hgt = (40 + rng() * 10) * s; const fronds = 6 + Math.floor(rng() * 3);
  const tx = x + lean * s * 0.5; const ty = y - hgt;
  groundShadow(ctx, x + 4 * s, y, 15 * s, 5 * s);
  /* trunk: the outline is a fat stroke under a thinner fill stroke */
  const trunk = () => { ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + lean * 0.3 * s, y - hgt * 0.55, tx, ty); ctx.stroke(); };
  ctx.strokeStyle = OUT; ctx.lineWidth = 5.4 * s; trunk();
  ctx.strokeStyle = CEDAR; ctx.lineWidth = 3.4 * s; trunk();
  ctx.strokeStyle = rgba("#000000", 0.22); ctx.lineWidth = 1 * s;   // ring scars where old fronds fell off
  for (let i = 1; i < 6; i += 1) { const k = i / 6; const px = x + (tx - x) * k; ctx.beginPath(); ctx.moveTo(px - 2 * s, y - hgt * k); ctx.lineTo(px + 2 * s, y - hgt * k); ctx.stroke(); }
  for (let i = 0; i < fronds; i += 1) {
    const a = -Math.PI / 2 + (i - (fronds - 1) / 2) * (0.78 + rng() * 0.12); const L = (17 + rng() * 6) * s;
    const ex = tx + Math.cos(a) * L; const ey = ty + Math.sin(a) * L * 0.72 + 3 * s;
    outlined(ctx, i % 2 ? DESERT.palm : DESERT.palmDark, () => {
      ctx.moveTo(tx, ty); ctx.quadraticCurveTo((tx + ex) / 2, ey - 8 * s, ex, ey);
      ctx.quadraticCurveTo((tx + ex) / 2, ey + 1.5 * s, tx, ty + 2.5 * s); ctx.closePath();
    }, 1);
  }
  /* a cluster of dates under the crown on about half the trees */
  if (rng() < 0.5) {
    ctx.fillStyle = "#6e3520";
    for (let i = 0; i < 5; i += 1) { ctx.beginPath(); ctx.arc(tx + (i % 3 - 1) * 2.4 * s, ty + (3 + (i >> 1) * 2.4) * s, 1.5 * s, 0, TAU); ctx.fill(); }
  }
}

/* Low thorn scrub. Drawn as spokes rather than blobs: a round bush on
   sand reads as a rock, a spiky one does not. */
export function dryShrub(ctx, x, y, s, rng) {
  groundShadow(ctx, x, y, 9 * s, 3 * s, 0.8);
  const n = 7 + Math.floor(rng() * 4); ctx.lineCap = "round";
  for (let i = 0; i < n; i += 1) {
    const a = -Math.PI / 2 + (i / (n - 1) - 0.5) * 2.5 + (rng() - 0.5) * 0.3; const L = (7 + rng() * 6) * s;
    const ex = x + Math.cos(a) * L; const ey = y + Math.sin(a) * L;
    ctx.strokeStyle = "#6b5326"; ctx.lineWidth = 1.8 * s; ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + Math.cos(a) * L * 0.5, y + Math.sin(a) * L * 0.8, ex, ey); ctx.stroke();
    /* the lit side of each twig, one stroke offset up-left */
    ctx.strokeStyle = rgba(DESERT.dryGrass, 0.8); ctx.lineWidth = 0.9 * s; ctx.beginPath(); ctx.moveTo(x - 0.5 * s, y - 0.5 * s); ctx.lineTo(ex - 0.5 * s, ey - 0.8 * s); ctx.stroke();
  }
  /* a few dead leaves caught in it */
  ctx.fillStyle = rgba("#8a6b2e", 0.85);
  for (let i = 0; i < 3; i += 1) { ctx.beginPath(); ctx.ellipse(x + (rng() - 0.5) * 12 * s, y - rng() * 7 * s, 2 * s, 1.1 * s, rng() * 3, 0, TAU); ctx.fill(); }
}

/* A decorative dune lying on the ground plane: sunlit crest, shaded lee
   behind it. No outline on the lee edge — a hard line here makes the
   mound look like a wall rather than sand. */
export function sandDune(ctx, x, y, w, h, rng) {
  const cx = x + (rng() - 0.5) * w * 0.3;         // where along the ridge the crest sits
  ctx.save();
  /* the lee shadow, thrown down-right, is what gives the mound its mass */
  ctx.fillStyle = rgba("#8a4a1e", 0.2); ctx.beginPath(); ctx.ellipse(x + w * 0.1, y + h * 0.28, w * 0.54, h * 0.5, 0, 0, TAU); ctx.fill();
  /* the body of the dune: a long low arc closed along the ground line */
  const body = () => {
    ctx.moveTo(x - w / 2, y); ctx.quadraticCurveTo(cx - w * 0.2, y - h * 1.25, cx, y - h);
    ctx.quadraticCurveTo(cx + w * 0.26, y - h * 0.7, x + w / 2, y); ctx.closePath();
  };
  ctx.beginPath(); body(); ctx.fillStyle = DESERT.sand; ctx.fill(); ctx.strokeStyle = rgba("#7a3c16", 0.35); ctx.lineWidth = 1.2; ctx.stroke();
  /* lee side: everything past the crest falls into shade */
  ctx.save(); ctx.beginPath(); body(); ctx.clip();
  ctx.fillStyle = rgba(DESERT.sandDark, 0.55); ctx.beginPath(); ctx.moveTo(cx, y - h * 1.05); ctx.lineTo(x + w / 2 + 2, y - h * 0.2); ctx.lineTo(x + w / 2 + 2, y + 2); ctx.lineTo(cx, y + 2); ctx.closePath(); ctx.fill();
  /* wind ripples raking across the windward face */
  ctx.strokeStyle = rgba(DESERT.sandDark, 0.3); ctx.lineWidth = 1.1;
  for (let i = 1; i < 4; i += 1) { ctx.beginPath(); ctx.moveTo(x - w / 2, y - h * 0.1 * i); ctx.quadraticCurveTo(cx - w * 0.16, y - h * (0.2 + 0.18 * i), cx, y - h * (0.12 + 0.2 * i)); ctx.stroke(); }
  ctx.restore();
  /* the crest itself, the one bright line */
  ctx.strokeStyle = rgba(DESERT.sandLight, 0.95); ctx.lineWidth = 2.6;
  ctx.beginPath(); ctx.moveTo(cx - w * 0.3, y - h * 0.58); ctx.quadraticCurveTo(cx - w * 0.16, y - h * 1.12, cx, y - h);
  ctx.quadraticCurveTo(cx + w * 0.14, y - h * 0.9, cx + w * 0.22, y - h * 0.62); ctx.stroke();
  ctx.restore();
}

/* Loose sand: a gameplay zone that slows your soldiers, so it has to be
   unmistakable and it has to survive a road being painted over the same
   spot. A flat pale disc does neither — this is a sunken bowl with a
   scalloped edge, a shadowed inner lip on the sun side and ripples, and
   the fill is a light wash so it lightens road and sand alike. */
export function drawLooseSand(ctx, x, y, r, seed) {
  const rng = seeded(seed); const N = 16; const edge = [];
  for (let i = 0; i < N; i += 1) { const a = (i / N) * TAU; const rr = r * (0.86 + rng() * 0.2); edge.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.62]); }
  const trace = () => {
    ctx.moveTo(edge[0][0], edge[0][1]);
    for (let i = 1; i <= N; i += 1) { const p = edge[i % N]; const q = edge[(i + 1) % N]; ctx.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2); }
    ctx.closePath();
  };
  ctx.save();
  /* the hollow reads because it is darker at the near-side rim */
  ctx.fillStyle = rgba("#8a4a1e", 0.16); ctx.beginPath(); ctx.ellipse(x, y + r * 0.08, r * 1.04, r * 0.66, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); trace(); ctx.fillStyle = rgba(DESERT.sandLight, 0.82); ctx.fill();
  ctx.strokeStyle = rgba("#7a3c16", 0.4); ctx.lineWidth = 1.4; ctx.stroke();
  ctx.save(); ctx.beginPath(); trace(); ctx.clip();
  /* the lip on the sun side casts inward; the far side catches light */
  ctx.strokeStyle = rgba("#a8632c", 0.34); ctx.lineWidth = 5; ctx.beginPath(); ctx.ellipse(x, y - r * 0.06, r * 0.94, r * 0.58, 0, Math.PI * 1.02, Math.PI * 1.98); ctx.stroke();
  ctx.strokeStyle = rgba("#ffffff", 0.5); ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(x, y + r * 0.04, r * 0.9, r * 0.56, 0, Math.PI * 0.1, Math.PI * 0.9); ctx.stroke();
  /* ripples: nested arcs, not concentric rings, so it looks blown */
  ctx.strokeStyle = rgba("#b9793c", 0.42); ctx.lineWidth = 1.3;
  for (let i = 0; i < 4; i += 1) { const k = 0.24 + i * 0.2; ctx.beginPath(); ctx.ellipse(x + (rng() - 0.5) * r * 0.2, y + (rng() - 0.5) * r * 0.14, r * k, r * k * 0.6, 0.25, Math.PI * 0.08, Math.PI * 0.96); ctx.stroke(); }
  /* grains that have blown out over the rim */
  ctx.fillStyle = rgba(DESERT.sandLight, 0.9);
  for (let i = 0; i < 18; i += 1) { const a = rng() * TAU; const d = r * (0.4 + rng() * 0.6); ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.62, 1.4 + rng(), 0.9, 0, 0, TAU); ctx.fill(); }
  ctx.restore(); ctx.restore();
}

/* The Reach's outer curtain wall, the counterpart of siege.js's
   drawOuterWall: sandstone laid in big courses with stepped merlons.
   `hpFrac` 1→0 walks it from sound, to cracked, to missing merlons, to
   a heap. `orient` says whether the run is seen face-on ("h") or nearly
   edge-on ("v"), which decides whether the light lies on the cap or
   rakes down the near face. */
export function drawSandstoneWall(ctx, a, b, hpFrac, orient = "h") {
  const dx = b.x - a.x; const dy = b.y - a.y; const L = Math.hypot(dx, dy);
  if (L < 1) return;
  const hp = Math.max(0, Math.min(1, hpFrac)); const vertical = orient === "v"; const gone = 1 - hp;
  const face = hp > 0.5 ? DESERT.stone : shade(DESERT.stone, -0.1);
  ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(Math.atan2(dy, dx));
  if (hp <= 0) {
    /* nothing left but the footing and a spill of blocks */
    ctx.fillStyle = rgba("#5c2c12", 0.22); ctx.fillRect(-4, -8, L + 8, 26);
    for (let xx = 0; xx < L; xx += 10) outlined(ctx, xx % 20 ? DESERT.stoneLit : DESERT.stoneDark, () => ctx.ellipse(xx + 5, (xx % 31) / 4 - 3, 6.5, 4, 0.3, 0, TAU), 1);
    ctx.restore(); return;
  }
  ctx.fillStyle = rgba("#5c2c12", 0.26); ctx.fillRect(0, -6, L + 6, 30);
  outlined(ctx, shade(face, -0.14), () => ctx.rect(0, -10, L, 24), 1.4);
  ctx.fillStyle = rgba("#6a3410", 0.16); ctx.fillRect(0, 7, L, 7);          // the footing sits in its own shade
  outlined(ctx, face, () => ctx.rect(0, -18, L, vertical ? 5 : 10), 1.2);
  if (vertical) { ctx.fillStyle = rgba("#ffffff", 0.14); ctx.fillRect(0, -10, Math.min(L, 16), 24); }
  else { ctx.fillStyle = rgba("#ffffff", 0.13); ctx.fillRect(0, -18, L, 3); }
  ctx.strokeStyle = rgba("#6a3410", 0.2); ctx.lineWidth = 1;     // courses: two beds, staggered joints
  for (const yy of [-2, 6]) { ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(L, yy); ctx.stroke(); }
  for (let xx = 10; xx < L; xx += 16) { const off = ((xx / 16) | 0) % 2 ? 0 : 8; ctx.beginPath(); ctx.moveTo(xx + off, -10); ctx.lineTo(xx + off, -2); ctx.moveTo(xx, -2); ctx.lineTo(xx, 6); ctx.stroke(); }
  /* stepped merlons, the Reach's silhouette; they are knocked off first */
  for (let xx = 3, i = 0; xx < L - 8; xx += 15, i += 1) {
    if (gone > 0.25 && (i * 2654435761 % 100) / 100 < (gone - 0.25) * 1.4) continue;
    outlined(ctx, DESERT.stoneLit, () => { ctx.moveTo(xx, -18); ctx.lineTo(xx + 2, -25); ctx.lineTo(xx + 7, -25); ctx.lineTo(xx + 9, -18); ctx.closePath(); }, 1);
  }
  if (hp < 0.7) {                                                            // cracks working down the face
    ctx.strokeStyle = rgba("#4a2410", 0.65); ctx.lineWidth = 1.3;
    for (let xx = 24; xx < L; xx += 64) { ctx.beginPath(); ctx.moveTo(xx, -10); ctx.lineTo(xx + 6, -1); ctx.lineTo(xx + 2, 6); ctx.lineTo(xx + 8, 13); ctx.stroke(); }
  }
  if (hp < 0.4) {                                                            // holes through it, blocks at its foot
    ctx.fillStyle = rgba("#3a1c0c", 0.42);
    for (let xx = 34; xx < L; xx += 86) { ctx.beginPath(); ctx.ellipse(xx, 0, 15, 9, 0, 0, TAU); ctx.fill(); }
    for (let xx = 16; xx < L; xx += 38) outlined(ctx, DESERT.stoneLit, () => ctx.ellipse(xx, 18, 5, 3.4, 0.2, 0, TAU), 0.9);
  }
  ctx.restore();
}

/* ------------------------------- live effects ------------------------------- *
 * Ground left burning by a fire pot. Live, so it flickers off `t`, but
 * deliberately kept low and transparent: soldiers stand and die in this
 * and the player has to be able to see them do it. */
export function drawEmberGround(ctx, x, y, r, t, alpha = 1) {
  const A = Math.max(0, Math.min(1, alpha));
  if (A <= 0) return;
  ctx.save();
  /* scorched sand underneath — the part that does not move */
  ctx.fillStyle = rgba("#3a1c0c", 0.34 * A); ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.56, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = rgba("#1c0f08", 0.22 * A); ctx.beginPath(); ctx.ellipse(x - r * 0.12, y + r * 0.06, r * 0.6, r * 0.34, 0.3, 0, TAU); ctx.fill();
  /* a low ring of flame around the rim: flames on the edge, not the
     middle, so whatever is standing in the patch stays visible */
  for (let i = 0; i < 11; i += 1) {
    const a = (i / 11) * TAU + Math.sin(t * 0.7 + i) * 0.08; const wob = 0.5 + Math.sin(t * 7 + i * 2.1) * 0.5;
    const fx = x + Math.cos(a) * r * 0.82; const fy = y + Math.sin(a) * r * 0.82 * 0.56; const hgt = (7 + wob * 9) * (r / 54);
    ctx.fillStyle = rgba(DESERT.ember, (0.4 + wob * 0.3) * A); ctx.beginPath(); ctx.moveTo(fx - 3.4, fy); ctx.quadraticCurveTo(fx - 1.4, fy - hgt * 0.7, fx, fy - hgt); ctx.quadraticCurveTo(fx + 1.6, fy - hgt * 0.6, fx + 3.4, fy); ctx.closePath(); ctx.fill();
    ctx.fillStyle = rgba(DESERT.emberLight, (0.3 + wob * 0.35) * A); ctx.beginPath(); ctx.moveTo(fx - 1.5, fy); ctx.quadraticCurveTo(fx, fy - hgt * 0.5, fx + 0.4, fy - hgt * 0.62); ctx.quadraticCurveTo(fx + 1.4, fy - hgt * 0.3, fx + 1.5, fy); ctx.closePath(); ctx.fill();
  }
  /* coals inside, breathing out of phase with each other */
  for (let i = 0; i < 9; i += 1) {
    const a = i * 2.39; const d = r * (0.12 + (i % 4) * 0.17); const k = 0.4 + Math.sin(t * 4 + i * 1.7) * 0.4;
    ctx.fillStyle = rgba(i % 3 ? DESERT.ember : DESERT.emberLight, (0.25 + k * 0.4) * A); ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.56, 2.4 + k * 1.4, 1.6 + k, 0, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

/* The travelling mound of a burrowing wyrm. While this is on screen the
   creature cannot be hit, so it is a moving ridge of sand and a spray of
   grains rather than anything with a body: no part of it should look
   like something you could shoot. `face` is +1 or -1, the way it runs. */
export function drawWyrmMound(ctx, x, y, t, face = 1) {
  const f = face < 0 ? -1 : 1;
  const push = Math.sin(t * 9) * 2;                 // the ridge working forward
  ctx.save();
  ctx.fillStyle = rgba("#8a4a1e", 0.26); ctx.beginPath(); ctx.ellipse(x + 4, y + 3, 34, 11, 0, 0, TAU); ctx.fill();
  /* the ridge: blunt at the back, ploughed to a point at the front */
  ctx.beginPath(); ctx.moveTo(x - f * 34, y);
  ctx.quadraticCurveTo(x - f * 16, y - 17 - push, x + f * 4, y - 15 - push); ctx.quadraticCurveTo(x + f * 22, y - 13, x + f * 34, y); ctx.closePath();
  ctx.fillStyle = DESERT.sand; ctx.fill(); ctx.strokeStyle = rgba("#7a3c16", 0.45); ctx.lineWidth = 1.3; ctx.stroke();
  /* lit crest along the top, shade under the trailing side */
  ctx.strokeStyle = rgba(DESERT.sandLight, 0.9); ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(x - f * 22, y - 9 - push); ctx.quadraticCurveTo(x - f * 6, y - 19 - push, x + f * 12, y - 13 - push); ctx.stroke();
  ctx.fillStyle = rgba(DESERT.sandDark, 0.45); ctx.beginPath(); ctx.moveTo(x + f * 6, y - 14); ctx.quadraticCurveTo(x + f * 24, y - 11, x + f * 34, y); ctx.lineTo(x + f * 6, y); ctx.closePath(); ctx.fill();
  /* grains thrown up and falling behind it */
  for (let i = 0; i < 9; i += 1) {
    const k = (t * 1.6 + i * 0.37) % 1; const gx = x - f * (10 + k * 34);
    ctx.fillStyle = rgba(DESERT.sandLight, 0.75 * (1 - k)); ctx.beginPath(); ctx.ellipse(gx, y - 14 - Math.sin(k * Math.PI) * 16, 2.4 - k, 1.7 - k * 0.8, 0, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

/* ------------------------------ the sun host ------------------------------ */

/* The surfaced sand wyrm, in colour. Centred on (0,0) with its base at
   y = 0, facing +x, so the caller translates and flips it. The body is
   one arc out of the sand and each anim only changes how high that arc
   stands, how far the head reaches and how much wave runs along it —
   walk is a segmented undulation, attack rears back and strikes. */
export function drawWyrm(ctx, anim, frame, opts = {}) {
  const hide = opts.color || HIDE;
  let lift = 58; let reach = 30; let wave = 6; let gape = 0.12; let p = phase(frame, 24);
  if (anim === "idle") { lift = 54 + Math.sin(p * TAU) * 3; reach = 24; wave = 2.5; gape = 0.15; }
  else if (anim === "attack") {
    /* rear back through the first half, snap forward through the second */
    const k = p < 0.4 ? p / 0.4 : 1; const strike = p < 0.4 ? 0 : (p - 0.4) / 0.6;
    lift = 62 + k * 20 - strike * 28; reach = 8 + strike * 48; wave = 2; gape = 0.35 + strike * 0.65;
  } else if (anim === "dead") { lift = 15; reach = 42; wave = 0; gape = 0; p = 0; }

  const N = 9;
  const pts = [];
  for (let i = 0; i <= N; i += 1) { const u = i / N; const sway = Math.sin(u * 5.5 - p * TAU) * wave * u; pts.push([-46 + u * (reach + 46) + sway * 0.4, -lift * Math.sin(u * Math.PI * 0.82) + sway]); }
  const rad = (u) => 15 - u * 7;
  ctx.save();
  groundShadow(ctx, -6, 0, 40, 11, anim === "dead" ? 0.7 : 1);
  /* the crater it came up through, drawn first so the body sits in it */
  ctx.fillStyle = rgba(DESERT.sandLight, 0.85); ctx.beginPath(); ctx.ellipse(-40, 0, 26, 9, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = rgba("#7a3c16", 0.4); ctx.lineWidth = 1.2; ctx.stroke();

  /* body: overlapping segments from tail to head, each with its own
     outline, which is what makes it read as segmented rather than as a
     tube with a highlight painted down it */
  for (let i = 0; i <= N; i += 1) { const u = i / N; const [px, py] = pts[i]; outlined(ctx, i % 2 ? hide : shade(hide, -0.07), () => ctx.ellipse(px, py, rad(u) * 1.05, rad(u), 0, 0, TAU), 1.3); }
  ctx.fillStyle = rgba(BELLY, 0.6);                   // the underside is its own colour, not a highlight
  for (let i = 1; i <= N; i += 1) { const u = i / N; const [px, py] = pts[i]; ctx.beginPath(); ctx.ellipse(px + 2, py + rad(u) * 0.42, rad(u) * 0.62, rad(u) * 0.36, 0, 0, TAU); ctx.fill(); }
  ctx.strokeStyle = rgba(HIDE_LIT, 0.85); ctx.lineWidth = 3; ctx.beginPath();
  for (let i = 0; i <= N; i += 1) { const u = i / N; const [px, py] = pts[i]; if (i) ctx.lineTo(px - 2, py - rad(u) * 0.6); else ctx.moveTo(px - 2, py - rad(u) * 0.6); }
  ctx.stroke();
  /* chitin plates along the back */
  for (let i = 2; i < N; i += 2) {
    const u = i / N; const [px, py] = pts[i]; const [qx, qy] = pts[i + 1]; const a = Math.atan2(qy - py, qx - px) - Math.PI / 2;
    outlined(ctx, PLATE, () => {
      ctx.moveTo(px + Math.cos(a) * rad(u) * 0.8, py + Math.sin(a) * rad(u) * 0.8);
      ctx.lineTo(px + Math.cos(a - 0.35) * rad(u) * 1.85, py + Math.sin(a - 0.35) * rad(u) * 1.85);
      ctx.lineTo(px + Math.cos(a + 0.4) * rad(u) * 1.5, py + Math.sin(a + 0.4) * rad(u) * 1.5); ctx.closePath();
    }, 1.1);
  }
  /* head: a wedge skull with a ring of jaws that opens with `gape` */
  const [hx, hy] = pts[N]; const [bx, by] = pts[N - 1]; const g = gape * 0.7;
  ctx.save(); ctx.translate(hx, hy); ctx.rotate(Math.atan2(hy - by, hx - bx));
  outlined(ctx, "#3a1410", () => ctx.ellipse(8, 0, 11, 8, 0, 0, TAU), 1.2);        // the throat behind the jaws
  for (const side of [-1, 1]) {
    ctx.save(); ctx.rotate(side * g);
    outlined(ctx, shade(hide, 0.05), () => { ctx.moveTo(-6, side * 2); ctx.lineTo(18, side * 3); ctx.lineTo(22, side * 9); ctx.lineTo(-4, side * 11); ctx.closePath(); }, 1.3);
    ctx.fillStyle = "#f4e6c4";
    for (let i = 0; i < 4; i += 1) { ctx.beginPath(); ctx.moveTo(2 + i * 5, side * 3.5); ctx.lineTo(5 + i * 5, side * 3.5); ctx.lineTo(3.5 + i * 5, -side * 2); ctx.closePath(); ctx.fill(); }
    ctx.restore();
  }
  outlined(ctx, hide, () => { ctx.moveTo(-12, -9); ctx.lineTo(6, -7); ctx.lineTo(10, 0); ctx.lineTo(6, 7); ctx.lineTo(-12, 9); ctx.closePath(); }, 1.3);
  ctx.fillStyle = rgba(HIDE_LIT, 0.7); ctx.beginPath(); ctx.moveTo(-12, -9); ctx.lineTo(6, -7); ctx.lineTo(4, -3); ctx.lineTo(-11, -4); ctx.closePath(); ctx.fill();
  if (anim !== "dead") {
    for (const side of [-1, 1]) { ctx.fillStyle = "#f2c23a"; ctx.beginPath(); ctx.ellipse(-3, side * 5, 2.2, 1.7, 0, 0, TAU); ctx.fill(); ctx.fillStyle = "#2a1008"; ctx.beginPath(); ctx.ellipse(-2.5, side * 5, 1, 1.4, 0, 0, TAU); ctx.fill(); }
  } else { ctx.strokeStyle = "#2a1008"; ctx.lineWidth = 1.4; for (const side of [-1, 1]) { ctx.beginPath(); ctx.moveTo(-5, side * 3); ctx.lineTo(-1, side * 7); ctx.moveTo(-1, side * 3); ctx.lineTo(-5, side * 7); ctx.stroke(); } }
  ctx.restore(); ctx.restore();
}

/* A scythed war chariot: two horses, a light car, blades on the hubs
   and a driver with a spear. Same convention as the wyrm — base at
   y = 0, facing +x, about 80 tall. "charge" is its own gait: the team
   flattens out, the car pitches back and the blades come round fast. */
export function drawChariot(ctx, anim, frame, opts = {}) {
  const dead = anim === "dead" || !!opts.dead; const fast = anim === "charge";
  const p = phase(frame, fast ? 10 : 16);
  const gait = dead ? 0 : Math.sin(p * TAU); const gait2 = dead ? 0 : Math.sin(p * TAU + Math.PI * 0.55);
  const bob = dead ? 0 : -Math.abs(gait) * (fast ? 4 : 2); const lean = fast ? -0.09 : 0;
  ctx.save();
  groundShadow(ctx, 6, 0, 56, 12, dead ? 0.7 : 1);
  if (dead) {
    /* burnt car on its side, one wheel off, team cut loose */
    ctx.save(); ctx.translate(-6, -8); ctx.rotate(0.42);
    outlined(ctx, CEDAR_DARK, () => ctx.rect(-26, -20, 46, 20), 1.3);
    ctx.fillStyle = rgba("#1a1008", 0.5); ctx.fillRect(-24, -18, 42, 16);
    ctx.restore();
    outlined(ctx, CEDAR_DARK, () => ctx.arc(26, -9, 15, 0, TAU), 1.4);
    ctx.strokeStyle = rgba("#1a1008", 0.6); ctx.lineWidth = 2;
    for (let i = 0; i < 4; i += 1) { const a = i * Math.PI / 4; ctx.beginPath(); ctx.moveTo(26 - Math.cos(a) * 13, -9 - Math.sin(a) * 13); ctx.lineTo(26 + Math.cos(a) * 13, -9 + Math.sin(a) * 13); ctx.stroke(); }
    ctx.restore(); return;
  }
  /* far horse first, darker and a half-stride out of phase */
  const horse = (ox, oy, sc, tone, swing) => {
    ctx.save(); ctx.translate(ox, oy + bob); ctx.scale(sc, sc);
    ctx.strokeStyle = shade(tone, -0.25); ctx.lineWidth = 6; ctx.lineCap = "round"; const legs = fast ? 16 : 10;
    ctx.beginPath(); ctx.moveTo(-14, -34); ctx.lineTo(-18 + swing * legs, -18); ctx.lineTo(-13 + swing * legs * 1.5, -bob / sc); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(16, -34); ctx.lineTo(21 - swing * legs, -18); ctx.lineTo(17 - swing * legs * 1.5, -bob / sc); ctx.stroke();
    outlined(ctx, tone, () => ctx.ellipse(0, -42, 26, 14, -0.05, 0, TAU), 1.4);
    ctx.fillStyle = rgba("#f0d2a8", 0.35); ctx.beginPath(); ctx.ellipse(-2, -34, 20, 6, 0, 0, TAU); ctx.fill();
    outlined(ctx, tone, () => { ctx.moveTo(18, -52); ctx.lineTo(34, -64); ctx.lineTo(40, -56); ctx.lineTo(24, -40); ctx.closePath(); }, 1.3);   // neck
    outlined(ctx, tone, () => { ctx.moveTo(32, -68); ctx.lineTo(48, -66); ctx.lineTo(50, -58); ctx.lineTo(34, -56); ctx.closePath(); }, 1.2);   // head
    ctx.fillStyle = "#1a1008"; ctx.beginPath(); ctx.ellipse(40, -64, 1.8, 1.5, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = shade(tone, -0.3); ctx.lineWidth = 4;                                  // mane and tail
    ctx.beginPath(); ctx.moveTo(20, -54); ctx.quadraticCurveTo(30, -68, 36, -70); ctx.moveTo(-24, -44); ctx.quadraticCurveTo(-38, -38, -40, -20); ctx.stroke();
    /* the Reach barding: a bronze plate on the chest */
    outlined(ctx, BRONZE, () => { ctx.moveTo(22, -46); ctx.lineTo(34, -52); ctx.lineTo(36, -42); ctx.lineTo(24, -36); ctx.closePath(); }, 1.1);
    ctx.restore();
  };
  horse(20, -6, 0.86, HORSE_DARK, gait2);
  horse(28, 0, 0.94, HORSE, gait);

  ctx.save(); ctx.translate(0, bob); ctx.rotate(lean);
  /* pole and traces from the car up to the yoke */
  ctx.strokeStyle = CEDAR_DARK; ctx.lineWidth = 3.4;
  ctx.beginPath(); ctx.moveTo(-6, -22); ctx.lineTo(44, -40); ctx.stroke();
  /* the scythed wheel: hub blades, spokes that turn with the gait */
  const wheelSpin = p * TAU * (fast ? 2 : 1);
  const wheelAt = (wx, far) => {
    const rim = far ? shade(CEDAR_DARK, -0.15) : CEDAR_DARK;
    outlined(ctx, rim, () => ctx.arc(wx, -15, 15, 0, TAU), 1.5);
    ctx.strokeStyle = far ? shade(CEDAR, -0.2) : CEDAR; ctx.lineWidth = 2.6;
    for (let i = 0; i < 6; i += 1) { const a = wheelSpin + i * Math.PI / 3; ctx.beginPath(); ctx.moveTo(wx, -15); ctx.lineTo(wx + Math.cos(a) * 12, -15 + Math.sin(a) * 12); ctx.stroke(); }
    ctx.strokeStyle = BRONZE_DARK; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(wx, -15, 14, 0, TAU); ctx.stroke();
    /* two scythes off the hub, long enough to read as the threat */
    for (const k of [0, 1]) {
      const a = wheelSpin + k * Math.PI;
      outlined(ctx, far ? BRONZE : BRONZE_LIT, () => {
        ctx.moveTo(wx + Math.cos(a) * 6, -15 + Math.sin(a) * 6);
        ctx.quadraticCurveTo(wx + Math.cos(a) * 26, -15 + Math.sin(a) * 26 - 6, wx + Math.cos(a) * 30, -15 + Math.sin(a) * 30);
        ctx.quadraticCurveTo(wx + Math.cos(a) * 22, -15 + Math.sin(a) * 22 + 3, wx + Math.cos(a) * 6, -15 + Math.sin(a) * 6 + 3); ctx.closePath();
      }, 1.1);
    }
    ctx.fillStyle = BRONZE; ctx.beginPath(); ctx.arc(wx, -15, 3.4, 0, TAU); ctx.fill();
  };
  wheelAt(-2, true);                                 // far wheel, behind the car
  /* a light wicker box open at the back, with a bronze rail on top */
  outlined(ctx, CEDAR, () => { ctx.moveTo(-26, -20); ctx.lineTo(10, -20); ctx.lineTo(8, -48); ctx.lineTo(-24, -44); ctx.closePath(); }, 1.4);
  ctx.strokeStyle = rgba("#000000", 0.2); ctx.lineWidth = 1;
  for (let i = -22; i < 8; i += 6) { ctx.beginPath(); ctx.moveTo(i, -20); ctx.lineTo(i + 1, -45); ctx.stroke(); }
  ctx.fillStyle = rgba("#000000", 0.18); ctx.fillRect(-4, -46, 13, 26);
  outlined(ctx, BRONZE, () => { ctx.moveTo(-26, -48); ctx.lineTo(9, -51); ctx.lineTo(9, -46); ctx.lineTo(-26, -43); ctx.closePath(); }, 1.1);
  wheelAt(-10, false);                               // near wheel in front, so the blades read
  /* driver: reins forward, spear back, and a thrust on attack */
  const thrust = anim === "attack" ? Math.max(0, Math.sin(p * Math.PI)) : 0;
  ctx.save(); ctx.translate(-10, -46);
  outlined(ctx, "#c8a24e", () => ctx.rect(-6, -26, 13, 26), 1.3);                             // linen over bronze scale
  outlined(ctx, BRONZE, () => { ctx.moveTo(-6, -26); ctx.lineTo(7, -26); ctx.lineTo(6, -16); ctx.lineTo(-5, -16); ctx.closePath(); }, 1.1);
  outlined(ctx, "#c9895c", () => ctx.ellipse(1, -32, 6, 6.5, 0, 0, TAU), 1.2);                // head
  outlined(ctx, BRONZE_LIT, () => { ctx.moveTo(-6, -33); ctx.lineTo(8, -33); ctx.lineTo(6, -40); ctx.lineTo(-4, -40); ctx.closePath(); }, 1.1);  // helm
  ctx.strokeStyle = "#c9895c"; ctx.lineWidth = 3.4; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(2, -22); ctx.lineTo(16 + thrust * 10, -20 - thrust * 4); ctx.stroke();
  ctx.strokeStyle = CEDAR; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(-14, -6 + thrust * 6); ctx.lineTo(30 + thrust * 18, -30 - thrust * 6); ctx.stroke();
  outlined(ctx, BRONZE_LIT, () => { const ex = 30 + thrust * 18; const ey = -30 - thrust * 6; ctx.moveTo(ex, ey); ctx.lineTo(ex + 10, ey - 5); ctx.lineTo(ex + 2, ey - 8); ctx.closePath(); }, 1);
  ctx.restore(); ctx.restore();
  /* dust kicked up behind it while it is moving */
  if (anim !== "idle") {
    ctx.fillStyle = rgba(DESERT.sandLight, fast ? 0.5 : 0.3);
    for (let i = 0; i < 4; i += 1) { const k = (p + i * 0.25) % 1; ctx.beginPath(); ctx.ellipse(-16 - k * 30, -4 - k * 12, 5 + k * 8, 3 + k * 5, 0, 0, TAU); ctx.fill(); }
  }
  ctx.restore();
}

/* A bolt-throwing scorpion on a cart with a pitch head. `roll` turns the
   wheels, `arm` 0→1 is the draw of the string (0 loose, 1 fully cocked),
   `dead` is the burnt wreck. Facing +x, ground at y = 0. */
export function drawScorpion(ctx, roll, arm, dead) {
  const a = Math.max(0, Math.min(1, arm || 0));
  ctx.save(); groundShadow(ctx, 0, 0, 46, 11, dead ? 0.7 : 1);
  const wheel = (wx) => {
    outlined(ctx, dead ? "#3a2a1c" : CEDAR_DARK, () => ctx.arc(wx, -11, 12, 0, TAU), 1.5);
    ctx.strokeStyle = dead ? "#2a1c12" : CEDAR; ctx.lineWidth = 2.4;
    for (let i = 0; i < 6; i += 1) { const ang = (roll || 0) + i * Math.PI / 3; ctx.beginPath(); ctx.moveTo(wx, -11); ctx.lineTo(wx + Math.cos(ang) * 9.5, -11 + Math.sin(ang) * 9.5); ctx.stroke(); }
    ctx.strokeStyle = BRONZE_DARK; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(wx, -11, 11, 0, TAU); ctx.stroke();
  };
  wheel(-26); wheel(24);
  outlined(ctx, dead ? "#4a3626" : CEDAR, () => ctx.rect(-38, -26, 76, 12), 1.4);          // the bed
  ctx.fillStyle = rgba("#000000", 0.16); ctx.fillRect(-38, -18, 76, 4);
  if (dead) {
    /* burnt out: the frame is charcoal and the bow limbs are snapped */
    ctx.fillStyle = rgba("#1a1008", 0.55); ctx.fillRect(-36, -30, 72, 14);
    outlined(ctx, "#2e2018", () => { ctx.moveTo(-10, -26); ctx.lineTo(6, -26); ctx.lineTo(2, -52); ctx.lineTo(-6, -50); ctx.closePath(); }, 1.2);
    ctx.strokeStyle = "#241812"; ctx.lineWidth = 4; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(-2, -50); ctx.lineTo(-18, -40); ctx.moveTo(0, -50); ctx.lineTo(14, -62); ctx.stroke();
    ctx.fillStyle = rgba("#3a2a20", 0.5);
    for (let i = 0; i < 4; i += 1) { ctx.beginPath(); ctx.ellipse(-20 + i * 14, -32 - i * 3, 7, 4, 0, 0, TAU); ctx.fill(); }
    ctx.restore(); return;
  }
  /* turntable and the stock the bolt rides in */
  outlined(ctx, BRONZE_DARK, () => ctx.ellipse(-2, -28, 16, 5, 0, 0, TAU), 1.2);
  ctx.save(); ctx.translate(-2, -30); ctx.rotate(-0.34);
  outlined(ctx, CEDAR, () => ctx.rect(-30, -5, 66, 9), 1.3);
  ctx.fillStyle = rgba("#000000", 0.18); ctx.fillRect(-30, -1, 66, 4);
  /* torsion springs either side, and the two bow limbs */
  for (const side of [-1, 1]) {
    outlined(ctx, "#d8cba4", () => ctx.ellipse(26, side * 9, 6, 7, 0, 0, TAU), 1.2);
    outlined(ctx, CEDAR_DARK, () => { ctx.moveTo(26, side * 9); ctx.lineTo(46, side * 26); ctx.lineTo(49, side * 23); ctx.lineTo(30, side * 6); ctx.closePath(); }, 1.2);
  }
  /* the string: straight across when loose, pulled to a V when cocked */
  const pull = 36 - a * 34;
  ctx.strokeStyle = "#e8dcbc"; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(46, -26); ctx.lineTo(pull, 0); ctx.lineTo(46, 26); ctx.stroke();
  ctx.strokeStyle = BRONZE_DARK; ctx.lineWidth = 3.4; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(pull, 0); ctx.lineTo(pull + 42, 0); ctx.stroke();
  outlined(ctx, "#2a1a10", () => ctx.ellipse(pull + 44, 0, 7, 5, 0, 0, TAU), 1.1);
  ctx.fillStyle = rgba(DESERT.ember, 0.75); ctx.beginPath(); ctx.ellipse(pull + 46, -2, 5, 6, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = rgba(DESERT.emberLight, 0.8); ctx.beginPath(); ctx.ellipse(pull + 46, -4, 2.2, 3.4, 0, 0, TAU); ctx.fill();
  /* windlass at the back, its rope taut in proportion to the draw */
  outlined(ctx, CEDAR_DARK, () => ctx.arc(-26, 2, 6.5, 0, TAU), 1.2);
  ctx.strokeStyle = rgba("#e8dcbc", 0.5 + a * 0.5); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(-26, 2); ctx.lineTo(pull, 0); ctx.stroke();
  ctx.restore();
  /* a pitch barrel lashed to the bed: what it reloads from */
  outlined(ctx, CEDAR_DARK, () => ctx.rect(-36, -40, 13, 15), 1.2);
  ctx.fillStyle = BRONZE; ctx.fillRect(-36, -36, 13, 1.8); ctx.fillRect(-36, -30, 13, 1.8);
  ctx.restore();
}

/* The Sun-Tyrant's standard: a bronze disc on a pole driven into the
   sand, with a brazier burning at its foot. It is a thing the player has
   to kill, so it is built like a target — big disc, clear stake, no
   crowd around it — and at low hp it lists, sheds rays and gutters. */
export function drawSunStandard(ctx, t, dead, hpFrac = 1) {
  const hp = Math.max(0, Math.min(1, hpFrac));
  const tilt = dead ? 0.5 : (1 - hp) * 0.16; const flame = dead ? 0 : 0.35 + hp * 0.65;
  ctx.save(); groundShadow(ctx, 0, 0, 30, 9, dead ? 0.7 : 1);
  /* the heaped sand it was driven into */
  ctx.fillStyle = rgba(DESERT.sandDark, 0.5); ctx.beginPath(); ctx.ellipse(0, -2, 24, 7, 0, 0, TAU); ctx.fill();
  ctx.save(); ctx.translate(0, -4); ctx.rotate(tilt);
  const H = 76;                                       // pole height; the disc sits 12 above it
  outlined(ctx, dead ? "#3a2a1c" : CEDAR, () => ctx.rect(-3.4, -H, 6.8, H), 1.3);
  ctx.fillStyle = rgba("#000000", 0.2); ctx.fillRect(0.6, -H, 2.8, H);
  /* the disc, rays first so they read as a rim */
  const rays = Math.round(12 * (dead ? 0.4 : 0.45 + hp * 0.55));
  for (let i = 0; i < rays; i += 1) {                  // rays are struck off it as it is beaten down
    const a = (i / 12) * TAU + (dead ? 0 : Math.sin(t * 0.6) * 0.02);
    outlined(ctx, dead ? "#4a3a28" : BRONZE_LIT, () => {
      ctx.moveTo(Math.cos(a - 0.12) * 15, -H - 12 + Math.sin(a - 0.12) * 15);
      ctx.lineTo(Math.cos(a) * 27, -H - 12 + Math.sin(a) * 27);
      ctx.lineTo(Math.cos(a + 0.12) * 15, -H - 12 + Math.sin(a + 0.12) * 15); ctx.closePath();
    }, 1);
  }
  outlined(ctx, dead ? "#5a4a34" : BRONZE, () => ctx.arc(0, -H - 12, 16, 0, TAU), 1.5);
  ctx.fillStyle = rgba("#000000", 0.22); ctx.beginPath(); ctx.arc(0, -H - 12, 16, -0.4, Math.PI * 0.9); ctx.fill();
  ctx.fillStyle = rgba("#ffeec0", dead ? 0.15 : 0.45); ctx.beginPath(); ctx.arc(-5, -H - 17, 6, 0, TAU); ctx.fill();
  outlined(ctx, dead ? "#3a2c1c" : BRONZE_DARK, () => ctx.arc(0, -H - 12, 6, 0, TAU), 1.2);
  /* the banner hanging off the pole */
  outlined(ctx, dead ? "#4a3030" : DESERT.banner, () => { ctx.moveTo(3, -H + 10); ctx.lineTo(22, -H + 14); ctx.lineTo(17, -H + 22); ctx.lineTo(23, -H + 30); ctx.lineTo(3, -H + 26); ctx.closePath(); }, 1.2);
  if (!dead) { ctx.fillStyle = DESERT.bannerTrim; ctx.beginPath(); ctx.arc(12, -H + 20, 2.6, 0, TAU); ctx.fill(); }
  ctx.restore();
  /* brazier at the foot: the part that guts when the standard is dying */
  outlined(ctx, dead ? "#3a2a1c" : BRONZE_DARK, () => { ctx.moveTo(-13, -4); ctx.lineTo(13, -4); ctx.lineTo(9, -18); ctx.lineTo(-9, -18); ctx.closePath(); }, 1.3);
  outlined(ctx, dead ? "#4a3626" : BRONZE, () => ctx.ellipse(0, -18, 11, 4, 0, 0, TAU), 1.2);
  if (flame > 0) {
    /* the flame stutters as hp falls: amplitude up, height down */
    const j = 1 + (1 - hp) * 1.8;
    for (let i = 0; i < 3; i += 1) {
      const k = 0.5 + Math.sin(t * (5 + i * 2.3) + i) * 0.5; const hgt = (14 + k * 14) * flame;
      const fx = (i - 1) * 4 + Math.sin(t * 6 * j + i) * 2 * j;
      ctx.fillStyle = rgba(i === 1 ? DESERT.emberLight : DESERT.ember, 0.55 + k * 0.3);
      ctx.beginPath(); ctx.moveTo(fx - 5, -19); ctx.quadraticCurveTo(fx - 2, -19 - hgt * 0.7, fx, -19 - hgt); ctx.quadraticCurveTo(fx + 3, -19 - hgt * 0.6, fx + 5, -19); ctx.closePath(); ctx.fill();
    }
  }
  if (dead) { ctx.fillStyle = rgba("#1a1008", 0.4); ctx.beginPath(); ctx.ellipse(0, -10, 22, 10, 0, 0, TAU); ctx.fill(); }
  ctx.restore();
}

/* The telegraph the boss paints on the ground before fire lands there.
   Same language as the north's nova ring — a squashed ellipse, a wash
   that pulses, a dashed ring closing on the centre — restated in the
   Reach's colour so the two kingdoms never share a warning. */
export function drawSunScorch(ctx, x, y, r, t) {
  const pulse = 0.6 + Math.sin(t * 14) * 0.3;
  const k = (t * 0.8) % 1;                        // the ring falling inward, once a beat
  ctx.save();
  const g = ctx.createRadialGradient(x, y, 6, x, y, r);
  g.addColorStop(0, rgba(DESERT.emberLight, 0.16 * pulse)); g.addColorStop(0.68, rgba(DESERT.ember, 0.26 * pulse)); g.addColorStop(1, rgba(DESERT.ember, 0));
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.55, 0, 0, TAU); ctx.fill();
  /* the boundary: solid, so "outside this is safe" is unambiguous */
  ctx.strokeStyle = rgba("#ff5a1e", 0.85 * pulse); ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.55, 0, 0, TAU); ctx.stroke();
  ctx.strokeStyle = rgba(DESERT.emberLight, 0.7 * pulse); ctx.lineWidth = 4; ctx.setLineDash([13, 9]); ctx.lineDashOffset = -t * 55;
  ctx.beginPath(); ctx.ellipse(x, y, r * (1 - k * 0.7), r * 0.55 * (1 - k * 0.7), 0, 0, TAU); ctx.stroke();
  ctx.setLineDash([]); ctx.lineDashOffset = 0;
  /* a sun mark in the middle: whose attack this is, at a glance */
  ctx.strokeStyle = rgba(DESERT.emberLight, 0.8 * pulse); ctx.lineWidth = 2.4; ctx.beginPath(); ctx.ellipse(x, y, r * 0.16, r * 0.16 * 0.55, 0, 0, TAU); ctx.stroke();
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * TAU + t * 0.5; ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * r * 0.24, y + Math.sin(a) * r * 0.24 * 0.55);
    ctx.lineTo(x + Math.cos(a) * r * 0.36, y + Math.sin(a) * r * 0.36 * 0.55); ctx.stroke();
  }
  ctx.restore();
}
