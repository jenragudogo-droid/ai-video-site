/* ------------------------------------------------------------------ *
 * Castle Defender — the Frozen North teaser art.
 *
 * A painted winter panel and the shadow shapes behind the locked
 * cards. Same idiom as the rest of the art: flat fills with a thin
 * dark outline, one lit side and one shaded side, no gradients doing
 * the drawing and nothing that glows. Cold blues and bone white
 * against Ashford's greens, so it reads as the same world in winter.
 * ------------------------------------------------------------------ */

import { rgba, shade } from "./palette.js";

const OUT = "rgba(24, 30, 44, 0.6)";

/* the north's palette: everything here is a desaturated blue or bone */
export const FROST = {
  sky: "#31405c", skyLow: "#5a6d8c", haze: "#8ea6bd",
  farRock: "#4a5a76", rock: "#3a475f", rockLit: "#54637f", rockDark: "#2a3448",
  snow: "#eef3fa", snowShade: "#c3d2e4", snowDeep: "#a9bcd2",
  ice: "#9fc4d8", iceDark: "#6d99b4", iceLight: "#d7ecf4",
  pine: "#25402f", pineLit: "#33553d", pineDark: "#1a2e22",
  stone: "#7d879b", stoneDark: "#5a6376", stoneLit: "#9aa4b6",
  banner: "#7a2436", bannerTrim: "#c9b070",
  shadow: "rgba(46, 62, 88, 0.96)",
};

function outlined(ctx, fill, path, lw = 1.4) {
  ctx.beginPath(); path(); ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = OUT; ctx.lineWidth = lw; ctx.stroke();
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas"); c.width = w; c.height = h; return c;
}

/* a snow-laden pine, the northern cousin of terrain.js's drawPine */
function frostPine(ctx, x, y, s) {
  ctx.fillStyle = rgba("#1a2436", 0.28);
  ctx.beginPath(); ctx.ellipse(x + 5 * s, y + 2, 15 * s, 6 * s, 0, 0, Math.PI * 2); ctx.fill();
  outlined(ctx, "#3a2c22", () => ctx.rect(x - 2.2 * s, y - 13 * s, 4.4 * s, 13 * s), 1);
  const tiers = [[0, 16], [-15, 13.5], [-28, 11], [-39, 8]];
  for (const [ty, tw] of tiers) {
    outlined(ctx, FROST.pine, () => { ctx.moveTo(x - tw * s, y - 11 * s + ty * s); ctx.lineTo(x, y - 26 * s + ty * s); ctx.lineTo(x + tw * s, y - 11 * s + ty * s); ctx.closePath(); }, 1.2);
    ctx.fillStyle = rgba("#000000", 0.2);
    ctx.beginPath(); ctx.moveTo(x, y - 11 * s + ty * s); ctx.lineTo(x, y - 26 * s + ty * s); ctx.lineTo(x + tw * s, y - 11 * s + ty * s); ctx.closePath(); ctx.fill();
    /* snow sitting on each tier */
    ctx.fillStyle = FROST.snow;
    ctx.beginPath();
    ctx.moveTo(x - tw * 0.5 * s, y - 15.5 * s + ty * s);
    ctx.quadraticCurveTo(x - tw * 0.16 * s, y - 22 * s + ty * s, x, y - 24.5 * s + ty * s);
    ctx.quadraticCurveTo(x + tw * 0.16 * s, y - 21 * s + ty * s, x + tw * 0.3 * s, y - 17 * s + ty * s);
    ctx.quadraticCurveTo(x + tw * 0.02 * s, y - 18.5 * s + ty * s, x - tw * 0.5 * s, y - 15.5 * s + ty * s);
    ctx.fill();
  }
}

/* a broken watchtower: two-thirds of a round tower with a torn top */
function ruinedTower(ctx, x, y, s) {
  const w = 15 * s; const h = 46 * s;
  ctx.fillStyle = rgba("#1a2436", 0.3);
  ctx.beginPath(); ctx.ellipse(x + 4 * s, y + 2, w * 1.1, 5 * s, 0, 0, Math.PI * 2); ctx.fill();
  outlined(ctx, FROST.stone, () => {
    ctx.moveTo(x - w / 2, y);
    ctx.lineTo(x - w / 2, y - h * 0.86);
    ctx.lineTo(x - w * 0.18, y - h);          // torn crown
    ctx.lineTo(x + w * 0.1, y - h * 0.8);
    ctx.lineTo(x + w / 2, y - h * 0.94);
    ctx.lineTo(x + w / 2, y);
    ctx.closePath();
  }, 1.3);
  ctx.fillStyle = rgba("#000000", 0.22); ctx.fillRect(x + w * 0.1, y - h * 0.86, w * 0.4, h * 0.86);
  ctx.fillStyle = rgba("#ffffff", 0.14); ctx.fillRect(x - w / 2 + 1, y - h * 0.8, w * 0.22, h * 0.8);
  /* courses and a dark window */
  ctx.strokeStyle = rgba("#000000", 0.16); ctx.lineWidth = 1;
  for (let yy = y - 8 * s; yy > y - h * 0.82; yy -= 7 * s) { ctx.beginPath(); ctx.moveTo(x - w / 2, yy); ctx.lineTo(x + w / 2, yy); ctx.stroke(); }
  ctx.fillStyle = "#1b2130"; ctx.fillRect(x - 2.2 * s, y - h * 0.55, 4.4 * s, 7 * s);
  /* snow on the broken crown, rubble at the foot */
  ctx.fillStyle = FROST.snow;
  ctx.beginPath(); ctx.moveTo(x - w / 2, y - h * 0.86); ctx.lineTo(x - w * 0.18, y - h); ctx.lineTo(x + w * 0.05, y - h * 0.84); ctx.lineTo(x - w * 0.2, y - h * 0.8); ctx.closePath(); ctx.fill();
  for (const [rx, ry, rr] of [[-w * 0.8, 1, 3], [w * 0.75, 2, 2.4], [-w * 0.4, 3, 2]]) {
    outlined(ctx, FROST.stoneLit, () => ctx.arc(x + rx * s * 0.9, y + ry * s, rr * s, 0, Math.PI * 2), 0.9);
  }
}

/* the frozen fortress: a squat keep with two towers, iced battlements */
function frozenKeep(ctx, x, y, s) {
  const kw = 78 * s; const kh = 52 * s;
  ctx.fillStyle = rgba("#1a2436", 0.32);
  ctx.beginPath(); ctx.ellipse(x + 6 * s, y + 3 * s, kw * 0.72, 9 * s, 0, 0, Math.PI * 2); ctx.fill();
  /* curtain wall */
  outlined(ctx, FROST.stone, () => ctx.rect(x - kw / 2, y - kh * 0.62, kw, kh * 0.62), 1.4);
  ctx.fillStyle = rgba("#000000", 0.2); ctx.fillRect(x + kw * 0.12, y - kh * 0.62, kw * 0.38, kh * 0.62);
  ctx.fillStyle = rgba("#ffffff", 0.12); ctx.fillRect(x - kw / 2 + 1, y - kh * 0.62, kw * 0.14, kh * 0.62);
  /* battlements with snow */
  for (let bx = x - kw / 2 + 2 * s; bx < x + kw / 2 - 4 * s; bx += 11 * s) {
    outlined(ctx, FROST.stoneLit, () => ctx.rect(bx, y - kh * 0.62 - 6 * s, 7 * s, 6 * s), 1);
    ctx.fillStyle = FROST.snow; ctx.fillRect(bx - 0.5 * s, y - kh * 0.62 - 8 * s, 8 * s, 2.4 * s);
  }
  /* keep */
  outlined(ctx, shade(FROST.stone, 0.06), () => ctx.rect(x - kw * 0.2, y - kh, kw * 0.4, kh * 0.44), 1.4);
  ctx.fillStyle = rgba("#000000", 0.2); ctx.fillRect(x + kw * 0.04, y - kh, kw * 0.16, kh * 0.44);
  ctx.fillStyle = FROST.snow; ctx.fillRect(x - kw * 0.22, y - kh - 2.6 * s, kw * 0.44, 3.2 * s);
  ctx.fillStyle = "#1b2130";
  ctx.fillRect(x - kw * 0.11, y - kh * 0.9, 4 * s, 7 * s); ctx.fillRect(x + kw * 0.05, y - kh * 0.9, 4 * s, 7 * s);
  /* flanking round towers with conical caps of snow */
  for (const side of [-1, 1]) {
    const tx = x + side * kw * 0.46;
    outlined(ctx, FROST.stoneDark, () => ctx.rect(tx - 8 * s, y - kh * 0.86, 16 * s, kh * 0.86), 1.3);
    ctx.fillStyle = rgba("#ffffff", 0.1); ctx.fillRect(tx - 8 * s + 1, y - kh * 0.8, 4 * s, kh * 0.8);
    outlined(ctx, FROST.snow, () => { ctx.moveTo(tx - 11 * s, y - kh * 0.86); ctx.lineTo(tx, y - kh * 1.12); ctx.lineTo(tx + 11 * s, y - kh * 0.86); ctx.closePath(); }, 1.2);
    ctx.fillStyle = rgba("#7f97b4", 0.4); ctx.beginPath(); ctx.moveTo(tx, y - kh * 0.86); ctx.lineTo(tx, y - kh * 1.12); ctx.lineTo(tx + 11 * s, y - kh * 0.86); ctx.closePath(); ctx.fill();
  }
  /* gate, barred with ice */
  outlined(ctx, "#171d2a", () => { ctx.moveTo(x - 8 * s, y); ctx.lineTo(x - 8 * s, y - kh * 0.3); ctx.arc(x, y - kh * 0.3, 8 * s, Math.PI, 0); ctx.lineTo(x + 8 * s, y); ctx.closePath(); }, 1.4);
  ctx.fillStyle = rgba(FROST.ice, 0.55);
  for (let i = -1; i <= 1; i += 1) { ctx.beginPath(); ctx.moveTo(x + i * 5 * s - 1.4 * s, y - kh * 0.36); ctx.lineTo(x + i * 5 * s + 1.4 * s, y - kh * 0.36); ctx.lineTo(x + i * 5 * s, y - kh * 0.06); ctx.closePath(); ctx.fill(); }
  /* a torn banner still hanging */
  ctx.strokeStyle = "#2c2419"; ctx.lineWidth = 1.6 * s;
  ctx.beginPath(); ctx.moveTo(x - kw * 0.2, y - kh); ctx.lineTo(x - kw * 0.2, y - kh - 14 * s); ctx.stroke();
  outlined(ctx, FROST.banner, () => { ctx.moveTo(x - kw * 0.2, y - kh - 14 * s); ctx.lineTo(x - kw * 0.2 + 15 * s, y - kh - 11 * s); ctx.lineTo(x - kw * 0.2 + 11 * s, y - kh - 6 * s); ctx.lineTo(x - kw * 0.2 + 16 * s, y - kh - 2 * s); ctx.lineTo(x - kw * 0.2, y - kh - 3 * s); ctx.closePath(); }, 1.1);
}

/* One painted panel: sky, three ridges, the frozen keep, a ruin, pines
   and an iced river. Drawn to fill (0,0,w,h); the caller scales it. */
export function drawFrostScene(ctx, w, h) {
  ctx.save();
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  /* The panel is composed in bands so the caption never covers anything:
     sky 0-.42, ridges to .62, the keep and the forest .40-.72, and a
     plain snow field below .74 for the text to sit on. */
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.7);
  sky.addColorStop(0, FROST.sky); sky.addColorStop(0.55, FROST.skyLow); sky.addColorStop(1, FROST.haze);
  ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
  /* a pale winter sun low behind the peaks */
  const sunG = ctx.createRadialGradient(w * 0.76, h * 0.3, 2, w * 0.76, h * 0.3, h * 0.55);
  sunG.addColorStop(0, rgba("#f6ecd6", 0.45)); sunG.addColorStop(1, rgba("#f6ecd6", 0));
  ctx.fillStyle = sunG; ctx.fillRect(0, 0, w, h * 0.7);

  const ridge = (baseY, pts, fill, snowFill) => {
    ctx.beginPath();
    ctx.moveTo(-4, h + 4); ctx.lineTo(-4, baseY);
    for (const [px, py] of pts) ctx.lineTo(px * w, py * h);
    ctx.lineTo(w + 4, baseY); ctx.lineTo(w + 4, h + 4); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = OUT; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = snowFill;
    for (let i = 1; i < pts.length - 1; i += 1) {
      const [px, py] = pts[i]; const [ax, ay] = pts[i - 1]; const [bx, by] = pts[i + 1];
      if (py > ay || py > by) continue;                       // only true peaks wear snow
      ctx.beginPath();
      ctx.moveTo(px * w, py * h);
      ctx.lineTo(px * w + (bx - px) * w * 0.42, py * h + (by - py) * h * 0.42);
      ctx.lineTo(px * w + (bx - px) * w * 0.2, py * h + (by - py) * h * 0.54);
      ctx.lineTo(px * w + (ax - px) * w * 0.22, py * h + (ay - py) * h * 0.52);
      ctx.lineTo(px * w + (ax - px) * w * 0.44, py * h + (ay - py) * h * 0.44);
      ctx.closePath(); ctx.fill();
    }
  };
  /* two ranges, each darker than the sky behind it so the skyline reads */
  ridge(h * 0.5, [[0.02, 0.4], [0.14, 0.12], [0.27, 0.36], [0.41, 0.06], [0.54, 0.34], [0.68, 0.13], [0.82, 0.35], [0.94, 0.19], [1, 0.38]], "#3c4a68", rgba(FROST.snow, 0.82));
  ridge(h * 0.62, [[0.02, 0.56], [0.13, 0.3], [0.31, 0.5], [0.47, 0.24], [0.63, 0.48], [0.79, 0.28], [0.93, 0.5], [1, 0.42]], "#2a3448", FROST.snowShade);

  /* the snow field the fortress stands on */
  ctx.beginPath();
  ctx.moveTo(-4, h + 4); ctx.lineTo(-4, h * 0.66);
  ctx.quadraticCurveTo(w * 0.3, h * 0.6, w * 0.56, h * 0.665);
  ctx.quadraticCurveTo(w * 0.8, h * 0.71, w + 4, h * 0.63);
  ctx.lineTo(w + 4, h + 4); ctx.closePath();
  ctx.fillStyle = FROST.snow; ctx.fill();
  ctx.strokeStyle = OUT; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.fillStyle = rgba(FROST.snowShade, 0.7);
  ctx.beginPath(); ctx.ellipse(w * 0.2, h * 0.79, w * 0.22, h * 0.045, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(w * 0.8, h * 0.83, w * 0.24, h * 0.05, 0, 0, Math.PI * 2); ctx.fill();

  /* a frozen river across the empty foreground */
  ctx.beginPath();
  ctx.moveTo(-4, h * 0.9);
  ctx.quadraticCurveTo(w * 0.3, h * 0.78, w * 0.56, h * 0.82);
  ctx.quadraticCurveTo(w * 0.78, h * 0.85, w + 4, h * 0.77);
  ctx.lineTo(w + 4, h * 0.86);
  ctx.quadraticCurveTo(w * 0.76, h * 0.94, w * 0.54, h * 0.9);
  ctx.quadraticCurveTo(w * 0.28, h * 0.87, -4, h * 0.99);
  ctx.closePath();
  ctx.fillStyle = FROST.ice; ctx.fill();
  ctx.strokeStyle = rgba(FROST.iceDark, 0.85); ctx.lineWidth = 1.2; ctx.stroke();
  ctx.strokeStyle = rgba(FROST.iceLight, 0.8); ctx.lineWidth = 1;
  for (const [ax, ay, bx, by] of [[0.08, 0.9, 0.2, 0.86], [0.36, 0.845, 0.5, 0.865], [0.64, 0.865, 0.78, 0.835]]) {
    ctx.beginPath(); ctx.moveTo(w * ax, h * ay); ctx.lineTo(w * bx, h * by); ctx.stroke();
  }

  const s = h / 150;                                     // authored against a 150-tall box
  frozenKeep(ctx, w * 0.5, h * 0.7, s * 0.98);
  ruinedTower(ctx, w * 0.17, h * 0.72, s * 1.0);
  ruinedTower(ctx, w * 0.86, h * 0.68, s * 0.78);
  for (const [px, py, ps] of [[0.06, 0.76, 1], [0.27, 0.72, 0.82], [0.35, 0.79, 1.1], [0.67, 0.73, 0.88], [0.76, 0.8, 1.05], [0.96, 0.75, 0.85]]) {
    frostPine(ctx, w * px, h * py, s * ps);
  }
  /* cold haze so the range sits back like a painting, kept off the foreground */
  const haze = ctx.createLinearGradient(0, h * 0.2, 0, h * 0.66);
  haze.addColorStop(0, rgba("#cfe0f0", 0.2)); haze.addColorStop(1, rgba("#cfe0f0", 0));
  ctx.fillStyle = haze; ctx.fillRect(0, h * 0.2, w, h * 0.46);
  ctx.restore();
}

/* A dire wolf, feet at y = 0, facing +x, about a soldier's height at
   the shoulder. Only ever drawn as a silhouette for now. */
export function drawDireWolf(ctx) {
  const dark = "#2a2f3a";
  ctx.save();
  /* far legs */
  ctx.strokeStyle = dark; ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(-20, -34); ctx.lineTo(-24, -18); ctx.lineTo(-18, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(20, -34); ctx.lineTo(26, -19); ctx.lineTo(22, 0); ctx.stroke();
  /* tail, low and heavy */
  ctx.strokeStyle = dark; ctx.lineWidth = 9;
  ctx.beginPath(); ctx.moveTo(-26, -40); ctx.quadraticCurveTo(-44, -36, -50, -14); ctx.stroke();
  /* body */
  outlined(ctx, dark, () => ctx.ellipse(0, -42, 30, 15, -0.06, 0, Math.PI * 2), 1.4);
  /* shoulders and haunch */
  outlined(ctx, dark, () => ctx.ellipse(18, -44, 14, 13, 0, 0, Math.PI * 2), 1.2);
  outlined(ctx, dark, () => ctx.ellipse(-20, -44, 14, 13, 0, 0, Math.PI * 2), 1.2);
  /* ruff and neck */
  outlined(ctx, dark, () => { ctx.moveTo(20, -54); ctx.lineTo(38, -62); ctx.lineTo(42, -48); ctx.lineTo(24, -36); ctx.closePath(); }, 1.2);
  /* head: long muzzle, ears back */
  outlined(ctx, dark, () => { ctx.moveTo(34, -66); ctx.lineTo(52, -62); ctx.lineTo(60, -54); ctx.lineTo(50, -50); ctx.lineTo(36, -52); ctx.closePath(); }, 1.3);
  outlined(ctx, dark, () => { ctx.moveTo(36, -66); ctx.lineTo(34, -78); ctx.lineTo(44, -68); ctx.closePath(); }, 1.1);
  outlined(ctx, dark, () => { ctx.moveTo(28, -64); ctx.lineTo(24, -76); ctx.lineTo(35, -67); ctx.closePath(); }, 1.1);
  /* near legs */
  ctx.strokeStyle = dark; ctx.lineWidth = 8;
  ctx.beginPath(); ctx.moveTo(-14, -34); ctx.lineTo(-19, -17); ctx.lineTo(-12, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(15, -34); ctx.lineTo(20, -18); ctx.lineTo(16, 0); ctx.stroke();
  ctx.restore();
}

/* Render `draw` as a flat shadow: the shape only, in one cold colour,
   with a pale rim so it stays readable on a dark card. */
export function drawAsSilhouette(ctx, w, h, draw, opts = {}) {
  const dpr = opts.dpr || 1;
  const off = makeCanvas(Math.max(1, Math.ceil(w * dpr)), Math.max(1, Math.ceil(h * dpr)));
  const oc = off.getContext("2d");
  oc.setTransform(dpr, 0, 0, dpr, 0, 0);
  oc.lineJoin = "round"; oc.lineCap = "round";
  draw(oc);
  oc.setTransform(1, 0, 0, 1, 0, 0);
  oc.globalCompositeOperation = "source-in";
  oc.fillStyle = opts.color || FROST.shadow;
  oc.fillRect(0, 0, off.width, off.height);
  ctx.save();
  /* a soft frost rim: the same shape offset a hair behind the solid one */
  ctx.globalAlpha = 0.3;
  ctx.drawImage(off, -2, -2, w, h);
  ctx.drawImage(off, 2, 2, w, h);
  ctx.globalAlpha = 1;
  ctx.drawImage(off, 0, 0, w, h);
  /* a cold highlight along the top so the shape lifts off the card */
  ctx.globalCompositeOperation = "source-atop";
  const lift = ctx.createLinearGradient(0, 0, 0, h);
  lift.addColorStop(0, rgba(FROST.iceLight, 0.3)); lift.addColorStop(0.55, rgba(FROST.iceLight, 0));
  ctx.fillStyle = lift; ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/* the pale "?" that sits over a locked shadow card */
export function drawFrostRune(ctx, x, y, r) {
  ctx.save();
  ctx.strokeStyle = rgba(FROST.iceLight, 0.5); ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = rgba(FROST.iceLight, 0.6);
  ctx.font = `600 ${Math.round(r * 1.2)}px Cinzel, Georgia, serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("?", x, y + 1);
  ctx.restore();
}
