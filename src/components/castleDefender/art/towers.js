/* ------------------------------------------------------------------ *
 * Castle Defender — tower art.
 *
 * Each tower type has four visibly different builds. The static body
 * is baked once per (type, level); the moving parts — archers on the
 * platform, the ballista's rotating top, the catapult arm, banners —
 * are drawn live by the renderer at the anchors exported here.
 * All drawing is in world units with (0, 0) at the plot centre.
 * ------------------------------------------------------------------ */

import { PAL, shade, rgba } from "./palette.js";

const OUT = "rgba(28, 20, 12, 0.6)";

function outlined(ctx, fill, path, lw = 1.4) {
  ctx.beginPath(); path();
  ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = OUT; ctx.lineWidth = lw; ctx.stroke();
}

/* stone block texture inside the current path box */
function courses(ctx, x, y, w, h, step = 8, alpha = 0.16) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.strokeStyle = rgba("#000000", alpha); ctx.lineWidth = 1;
  for (let yy = y + step; yy < y + h; yy += step) {
    ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); ctx.stroke();
    const off = ((yy - y) / step) % 2 ? step * 0.7 : 0;
    for (let xx = x + off; xx < x + w; xx += step * 1.4) { ctx.beginPath(); ctx.moveTo(xx, yy - step); ctx.lineTo(xx, yy); ctx.stroke(); }
  }
  ctx.restore();
}

function planks(ctx, x, y, w, h, step = 6, vertical = false) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.strokeStyle = rgba("#000000", 0.2); ctx.lineWidth = 1;
  if (vertical) for (let xx = x + step; xx < x + w; xx += step) { ctx.beginPath(); ctx.moveTo(xx, y); ctx.lineTo(xx, y + h); ctx.stroke(); }
  else for (let yy = y + step; yy < y + h; yy += step) { ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); ctx.stroke(); }
  ctx.restore();
}

function shadeRight(ctx, x, y, w, h, a = 0.16) {
  ctx.fillStyle = rgba("#000000", a);
  ctx.fillRect(x + w / 2, y, w / 2, h);
}

function merlons(ctx, x, y, w, color, size = 6, gap = 5) {
  for (let xx = x; xx < x + w - 1; xx += size + gap) {
    outlined(ctx, color, () => ctx.rect(xx, y - size, Math.min(size, x + w - xx), size), 1.1);
  }
}

function roundTower(ctx, cx, top, r, h, color, opts = {}) {
  /* cylinder: body from top to top+h, elliptical cap */
  const dark = shade(color, -0.28);
  outlined(ctx, color, () => ctx.rect(cx - r, top, r * 2, h), 1.4);
  ctx.fillStyle = rgba("#000000", 0.18); ctx.fillRect(cx + r * 0.2, top, r * 0.8, h);
  ctx.fillStyle = rgba("#ffffff", 0.14); ctx.fillRect(cx - r + 1, top, r * 0.35, h);
  courses(ctx, cx - r, top, r * 2, h, 7);
  outlined(ctx, shade(color, 0.12), () => ctx.ellipse(cx, top, r, r * 0.42, 0, 0, Math.PI * 2), 1.2);
  if (opts.merlons) {
    for (let i = 0; i < 5; i += 1) {
      const a = Math.PI + (i / 4) * Math.PI;
      const mx = cx + Math.cos(a) * r * 0.85;
      const my = top + Math.sin(a) * r * 0.36;
      outlined(ctx, color, () => ctx.rect(mx - 2.5, my - 6, 5, 6), 1);
    }
  }
  if (opts.roof) {
    outlined(ctx, opts.roof, () => { ctx.moveTo(cx - r - 3, top + 1); ctx.lineTo(cx, top - r * 1.9); ctx.lineTo(cx + r + 3, top + 1); ctx.closePath(); }, 1.3);
    ctx.fillStyle = rgba("#000000", 0.2); ctx.beginPath(); ctx.moveTo(cx, top + 1); ctx.lineTo(cx, top - r * 1.9); ctx.lineTo(cx + r + 3, top + 1); ctx.closePath(); ctx.fill();
  }
  return dark;
}

function window_(ctx, x, y, w = 4, h = 7) {
  outlined(ctx, "#1d1a16", () => { ctx.moveTo(x - w / 2, y + h); ctx.lineTo(x - w / 2, y); ctx.arc(x, y, w / 2, Math.PI, 0); ctx.lineTo(x + w / 2, y + h); ctx.closePath(); }, 1);
}

/* ------------------------------ plot marker ------------------------------ */

export function drawPlot(ctx) {
  ctx.fillStyle = rgba("#000000", 0.1);
  ctx.beginPath(); ctx.ellipse(0, 4, 34, 15, 0, 0, Math.PI * 2); ctx.fill();
  outlined(ctx, "#a88e5c", () => ctx.ellipse(0, 0, 32, 14, 0, 0, Math.PI * 2), 1.2);
  ctx.fillStyle = "#b99d68"; ctx.beginPath(); ctx.ellipse(-2, -1, 24, 9.5, 0, 0, Math.PI * 2); ctx.fill();
  /* ring of flat stones */
  for (let i = 0; i < 14; i += 1) {
    const a = (i / 14) * Math.PI * 2;
    const x = Math.cos(a) * 29; const y = Math.sin(a) * 12.5;
    outlined(ctx, i % 3 ? PAL.rockLight : PAL.rock, () => ctx.ellipse(x, y, 4, 2.4, a, 0, Math.PI * 2), 0.9);
  }
  /* small sign post */
  outlined(ctx, PAL.wood, () => ctx.rect(20, -20, 2.6, 20), 1);
  outlined(ctx, PAL.woodLight, () => ctx.rect(14, -24, 15, 7), 1);
  ctx.fillStyle = PAL.woodDark; ctx.fillRect(16.5, -21.5, 10, 1.2);
}

/* ------------------------------ archer tower ------------------------------ */

function archerTower(ctx, level) {
  const shadow = () => { ctx.fillStyle = rgba("#000000", 0.16); ctx.beginPath(); ctx.ellipse(4, 6, 36, 14, 0, 0, Math.PI * 2); ctx.fill(); };
  shadow();
  if (level === 1) {
    /* wooden platform on four posts with a ladder */
    ctx.fillStyle = "#8a7a55"; ctx.beginPath(); ctx.ellipse(0, 2, 26, 10, 0, 0, Math.PI * 2); ctx.fill();
    for (const px of [-18, 18]) outlined(ctx, PAL.wood, () => ctx.rect(px - 2.5, -52, 5, 54), 1.2);
    for (const px of [-10, 10]) outlined(ctx, shade(PAL.wood, -0.15), () => ctx.rect(px - 2, -50, 4, 52), 1.2);
    ctx.strokeStyle = PAL.woodDark; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-18, -10); ctx.lineTo(18, -34); ctx.moveTo(18, -10); ctx.lineTo(-18, -34); ctx.stroke();
    outlined(ctx, PAL.woodLight, () => ctx.rect(-26, -58, 52, 8), 1.3);
    planks(ctx, -26, -58, 52, 8, 6, true);
    /* railing */
    for (const px of [-24, -12, 0, 12, 24]) outlined(ctx, PAL.wood, () => ctx.rect(px - 1.2, -70, 2.4, 12), 1);
    outlined(ctx, PAL.wood, () => ctx.rect(-25, -68, 50, 2.4), 1);
    /* ladder */
    ctx.strokeStyle = PAL.woodDark; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(24, 4); ctx.lineTo(30, -50); ctx.moveTo(30, 4); ctx.lineTo(36, -50); ctx.stroke();
    for (let i = 0; i < 7; i += 1) { const y = -2 - i * 7.5; ctx.beginPath(); ctx.moveTo(24.6 + i * 0.8, y); ctx.lineTo(30.6 + i * 0.8, y); ctx.stroke(); }
  } else if (level === 2) {
    /* taller timber tower with a boarded lower storey and a wide fighting deck */
    ctx.fillStyle = "#8a7a55"; ctx.beginPath(); ctx.ellipse(0, 2, 28, 11, 0, 0, Math.PI * 2); ctx.fill();
    outlined(ctx, PAL.wood, () => { ctx.moveTo(-22, 0); ctx.lineTo(22, 0); ctx.lineTo(18, -60); ctx.lineTo(-18, -60); ctx.closePath(); }, 1.4);
    planks(ctx, -22, -60, 44, 60, 7, true);
    shadeRight(ctx, -22, -60, 44, 60, 0.14);
    ctx.strokeStyle = PAL.woodDark; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-20, -8); ctx.lineTo(19, -50); ctx.moveTo(20, -8); ctx.lineTo(-19, -50); ctx.stroke();
    window_(ctx, 0, -32, 6, 9);
    outlined(ctx, PAL.woodLight, () => ctx.rect(-30, -70, 60, 10), 1.3);
    planks(ctx, -30, -70, 60, 10, 6, true);
    for (const px of [-28, -14, 0, 14, 28]) outlined(ctx, PAL.wood, () => ctx.rect(px - 1.3, -84, 2.6, 14), 1);
    outlined(ctx, PAL.wood, () => ctx.rect(-29, -82, 58, 2.6), 1);
    /* support brackets */
    ctx.strokeStyle = PAL.woodDark; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-18, -60); ctx.lineTo(-28, -68); ctx.moveTo(18, -60); ctx.lineTo(28, -68); ctx.stroke();
  } else {
    /* stone tower; level 4 adds height, a tiled cap ring and a banner */
    const h = level === 4 ? 92 : 78;
    const r = 22;
    ctx.fillStyle = "#8a7a55"; ctx.beginPath(); ctx.ellipse(0, 2, 30, 12, 0, 0, Math.PI * 2); ctx.fill();
    outlined(ctx, PAL.stoneDark, () => ctx.rect(-r - 4, -12, (r + 4) * 2, 14), 1.2);
    courses(ctx, -r - 4, -12, (r + 4) * 2, 14, 7);
    roundTower(ctx, 0, -h, r, h - 10, PAL.stone, { merlons: true });
    window_(ctx, -6, -h + 30, 4, 8); window_(ctx, 8, -h + 52, 4, 8);
    /* door */
    outlined(ctx, PAL.gateWood, () => { ctx.moveTo(-6, 2); ctx.lineTo(-6, -10); ctx.arc(0, -10, 6, Math.PI, 0); ctx.lineTo(6, 2); ctx.closePath(); }, 1.1);
    /* wooden hoarding deck on top */
    outlined(ctx, PAL.woodLight, () => ctx.ellipse(0, -h - 2, r + 6, (r + 6) * 0.42, 0, 0, Math.PI * 2), 1.2);
    ctx.fillStyle = rgba("#000000", 0.12); ctx.beginPath(); ctx.ellipse(0, -h - 2, r + 6, (r + 6) * 0.42, 0, 0, Math.PI); ctx.fill();
    if (level === 4) {
      /* gold band and heraldic shields on the wall */
      ctx.fillStyle = PAL.gold; ctx.fillRect(-r, -h + 8, r * 2, 2.5);
      outlined(ctx, PAL.red, () => { ctx.moveTo(-5, -h + 40); ctx.lineTo(5, -h + 40); ctx.lineTo(5, -h + 48); ctx.quadraticCurveTo(5, -h + 54, 0, -h + 56); ctx.quadraticCurveTo(-5, -h + 54, -5, -h + 48); ctx.closePath(); }, 1);
      ctx.fillStyle = PAL.gold; ctx.fillRect(-0.8, -h + 42, 1.6, 10); ctx.fillRect(-3.5, -h + 45, 7, 1.6);
    }
  }
}

/* archers stand here (world offsets from the plot centre) */
export function archerPositions(level) {
  if (level === 1) return [{ x: 2, y: -60 }];
  if (level === 2) return [{ x: -12, y: -72 }, { x: 14, y: -72 }];
  const h = level === 4 ? 92 : 78;
  return [{ x: -12, y: -h - 2 }, { x: 14, y: -h - 2 }];
}

/* ------------------------------ barracks ------------------------------ */

function barracks(ctx, level) {
  ctx.fillStyle = rgba("#000000", 0.16); ctx.beginPath(); ctx.ellipse(4, 6, 40, 15, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#8a7a55"; ctx.beginPath(); ctx.ellipse(0, 3, 34, 12, 0, 0, Math.PI * 2); ctx.fill();
  if (level === 1) {
    /* palisade yard with a thatched hut and a training dummy */
    for (let i = -30; i <= 30; i += 6) outlined(ctx, PAL.wood, () => { ctx.moveTo(i - 2.5, 0); ctx.lineTo(i - 2.5, -16); ctx.lineTo(i, -20); ctx.lineTo(i + 2.5, -16); ctx.lineTo(i + 2.5, 0); ctx.closePath(); }, 1);
    outlined(ctx, PAL.wood, () => ctx.rect(-22, -34, 34, 22), 1.3);
    planks(ctx, -22, -34, 34, 22, 6, true);
    outlined(ctx, "#b89a4a", () => { ctx.moveTo(-27, -34); ctx.lineTo(-5, -54); ctx.lineTo(17, -34); ctx.closePath(); }, 1.3);
    ctx.strokeStyle = rgba("#000000", 0.2); ctx.lineWidth = 1; for (let i = 1; i < 5; i += 1) { ctx.beginPath(); ctx.moveTo(-27 + i * 4.4, -34 - i * 4); ctx.lineTo(17 - i * 4.4, -34 - i * 4); ctx.stroke(); }
    outlined(ctx, PAL.gateWood, () => ctx.rect(-9, -26, 8, 14), 1);
    /* dummy */
    outlined(ctx, PAL.wood, () => ctx.rect(22, -30, 3, 30), 1);
    outlined(ctx, PAL.leather, () => ctx.rect(17, -24, 13, 10), 1);
    outlined(ctx, PAL.bone, () => ctx.arc(23.5, -29, 4, 0, Math.PI * 2), 1);
  } else if (level === 2) {
    /* timber-framed hall on a stone base */
    outlined(ctx, PAL.stoneDark, () => ctx.rect(-30, -14, 60, 16), 1.2);
    courses(ctx, -30, -14, 60, 16, 6);
    outlined(ctx, "#d9c9a3", () => ctx.rect(-28, -48, 56, 34), 1.3);
    ctx.strokeStyle = PAL.woodDark; ctx.lineWidth = 2.4;
    ctx.beginPath(); for (const px of [-28, -10, 10, 28]) { ctx.moveTo(px, -48); ctx.lineTo(px, -14); } ctx.moveTo(-28, -30); ctx.lineTo(28, -30); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-28, -14); ctx.lineTo(-10, -30); ctx.moveTo(10, -30); ctx.lineTo(28, -14); ctx.stroke();
    shadeRight(ctx, -28, -48, 56, 34, 0.1);
    outlined(ctx, PAL.roof, () => { ctx.moveTo(-34, -48); ctx.lineTo(0, -74); ctx.lineTo(34, -48); ctx.closePath(); }, 1.3);
    ctx.fillStyle = rgba("#000000", 0.2); ctx.beginPath(); ctx.moveTo(0, -48); ctx.lineTo(0, -74); ctx.lineTo(34, -48); ctx.closePath(); ctx.fill();
    outlined(ctx, PAL.gateWood, () => { ctx.moveTo(-7, -14); ctx.lineTo(-7, -34); ctx.arc(0, -34, 7, Math.PI, 0); ctx.lineTo(7, -14); ctx.closePath(); }, 1.1);
    window_(ctx, 19, -40, 5, 7); window_(ctx, -19, -40, 5, 7);
    /* weapon rack */
    outlined(ctx, PAL.wood, () => ctx.rect(32, -22, 2.4, 22), 1); outlined(ctx, PAL.wood, () => ctx.rect(24, -22, 12, 2.4), 1);
    ctx.strokeStyle = PAL.plate; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(27, -20); ctx.lineTo(27, -4); ctx.moveTo(31, -20); ctx.lineTo(31, -4); ctx.stroke();
  } else {
    /* stone hall with a squared tower; level 4 gets a second banner, gold trim and a lion crest */
    const tall = level === 4;
    outlined(ctx, PAL.stone, () => ctx.rect(-34, -40, 68, 42), 1.4);
    courses(ctx, -34, -40, 68, 42, 7);
    shadeRight(ctx, -34, -40, 68, 42, 0.14);
    merlons(ctx, -34, -40, 68, PAL.stone);
    outlined(ctx, PAL.stoneLight, () => ctx.rect(-34, -40, 68, 3), 1);
    /* tower */
    outlined(ctx, PAL.stone, () => ctx.rect(12, tall ? -84 : -72, 26, tall ? 86 : 74), 1.4);
    courses(ctx, 12, tall ? -84 : -72, 26, tall ? 86 : 74, 7);
    ctx.fillStyle = rgba("#000000", 0.16); ctx.fillRect(28, tall ? -84 : -72, 10, tall ? 86 : 74);
    merlons(ctx, 12, tall ? -84 : -72, 26, PAL.stone, 5, 4);
    window_(ctx, 25, tall ? -66 : -56, 4, 7);
    /* great door */
    outlined(ctx, PAL.gateWood, () => { ctx.moveTo(-14, 2); ctx.lineTo(-14, -20); ctx.arc(-5, -20, 9, Math.PI, 0); ctx.lineTo(4, 2); ctx.closePath(); }, 1.2);
    ctx.strokeStyle = PAL.iron; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-12, -12); ctx.lineTo(2, -12); ctx.moveTo(-12, -4); ctx.lineTo(2, -4); ctx.stroke();
    window_(ctx, -24, -28, 5, 8);
    if (tall) {
      ctx.fillStyle = PAL.gold; ctx.fillRect(-34, -36, 46, 2.2); ctx.fillRect(12, -80, 26, 2.2);
      outlined(ctx, PAL.red, () => { ctx.moveTo(-30, -30); ctx.lineTo(-18, -30); ctx.lineTo(-18, -20); ctx.quadraticCurveTo(-18, -12, -24, -10); ctx.quadraticCurveTo(-30, -12, -30, -20); ctx.closePath(); }, 1);
      ctx.fillStyle = PAL.gold; ctx.fillRect(-25, -28, 2, 12); ctx.fillRect(-28, -25, 8, 2);
    }
  }
}

export function barracksFlag(level) {
  if (level === 1) return { x: -24, y: -50, h: 30, size: 0.7 };
  if (level === 2) return { x: 0, y: -74, h: 28, size: 0.75 };
  if (level === 3) return { x: 25, y: -72, h: 30, size: 0.85 };
  return { x: 25, y: -84, h: 34, size: 1 };
}

/* ------------------------------ ballista ------------------------------ */

function ballistaBase(ctx, level) {
  ctx.fillStyle = rgba("#000000", 0.16); ctx.beginPath(); ctx.ellipse(4, 6, 36, 14, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#8a7a55"; ctx.beginPath(); ctx.ellipse(0, 2, 28, 11, 0, 0, Math.PI * 2); ctx.fill();
  if (level <= 2) {
    const h = level === 1 ? 10 : 22;
    outlined(ctx, PAL.wood, () => ctx.rect(-26, -h, 52, h + 2), 1.3);
    planks(ctx, -26, -h, 52, h + 2, 6, true);
    shadeRight(ctx, -26, -h, 52, h + 2, 0.12);
    outlined(ctx, PAL.woodLight, () => ctx.ellipse(0, -h, 26, 10, 0, 0, Math.PI * 2), 1.2);
    planks(ctx, -26, -h - 10, 52, 20, 5);
    if (level === 2) { ctx.strokeStyle = PAL.woodDark; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-24, -4); ctx.lineTo(24, -20); ctx.moveTo(24, -4); ctx.lineTo(-24, -20); ctx.stroke(); }
    /* bolt rack */
    ctx.strokeStyle = PAL.arrow; ctx.lineWidth = 1.6; for (let i = 0; i < 3; i += 1) { ctx.beginPath(); ctx.moveTo(-30 + i * 3, 0); ctx.lineTo(-27 + i * 3, -18); ctx.stroke(); }
  } else {
    const h = level === 3 ? 26 : 34;
    outlined(ctx, PAL.stone, () => ctx.rect(-28, -h, 56, h + 2), 1.4);
    courses(ctx, -28, -h, 56, h + 2, 7);
    shadeRight(ctx, -28, -h, 56, h + 2, 0.14);
    outlined(ctx, PAL.stoneLight, () => ctx.ellipse(0, -h, 28, 11, 0, 0, Math.PI * 2), 1.2);
    for (let i = 0; i < 7; i += 1) { const a = Math.PI + (i / 6) * Math.PI; outlined(ctx, PAL.stone, () => ctx.rect(Math.cos(a) * 26 - 2.5, -h + Math.sin(a) * 9 - 5, 5, 5), 1); }
    if (level === 4) { ctx.fillStyle = PAL.gold; ctx.fillRect(-28, -h + 6, 56, 2.2); outlined(ctx, PAL.iron, () => ctx.rect(-30, -8, 4, 10), 1); outlined(ctx, PAL.iron, () => ctx.rect(26, -8, 4, 10), 1); }
    ctx.strokeStyle = PAL.arrow; ctx.lineWidth = 1.8; for (let i = 0; i < 4; i += 1) { ctx.beginPath(); ctx.moveTo(-34 + i * 3, 2); ctx.lineTo(-30 + i * 3, -20); ctx.stroke(); }
  }
}

export function ballistaPivot(level) {
  return { x: 0, y: level === 1 ? -14 : level === 2 ? -26 : level === 3 ? -30 : -38 };
}

/* The rotating top: drawn pointing +x, pivot at (0, 0). `loaded` 1 = bolt in place. */
export function drawBallistaTop(ctx, level, loaded) {
  const big = level >= 3;
  const L = big ? 46 : 38;          // stock length
  const armL = big ? 30 : 24;
  const ax = L * 0.3;               // where the bow arms cross the stock
  /* stock */
  outlined(ctx, PAL.wood, () => ctx.rect(-L * 0.45, -4.5, L * 1.2, 9), 1.4);
  ctx.fillStyle = rgba("#000000", 0.16); ctx.fillRect(-L * 0.45, 0, L * 1.2, 4.5);
  ctx.strokeStyle = PAL.woodDark; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-L * 0.4, 0); ctx.lineTo(L * 0.72, 0); ctx.stroke();
  for (const px of [-L * 0.2, ax + 6, L * 0.5]) { ctx.fillStyle = PAL.iron; ctx.fillRect(px, -5, 2.2, 10); }
  /* bow arms */
  const arms = () => { ctx.beginPath(); ctx.moveTo(ax, -armL); ctx.quadraticCurveTo(ax + L * 0.34, 0, ax, armL); ctx.stroke(); };
  ctx.lineCap = "round";
  ctx.strokeStyle = OUT; ctx.lineWidth = big ? 8.5 : 7; arms();
  ctx.strokeStyle = big ? PAL.iron : PAL.woodDark; ctx.lineWidth = big ? 6 : 4.8; arms();
  ctx.strokeStyle = rgba("#ffffff", 0.25); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(ax - 1, -armL + 2); ctx.quadraticCurveTo(ax + L * 0.3, 0, ax - 1, armL - 2); ctx.stroke();
  for (const ty of [-armL, armL]) outlined(ctx, PAL.ironLight, () => ctx.arc(ax, ty, 3, 0, Math.PI * 2), 1);
  /* string */
  const pull = loaded ? -L * 0.28 : L * 0.62;
  ctx.strokeStyle = PAL.bone; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(ax, -armL); ctx.lineTo(pull, 0); ctx.lineTo(ax, armL); ctx.stroke();
  /* winch wheel at the back */
  outlined(ctx, PAL.iron, () => ctx.arc(-L * 0.38, 0, 6, 0, Math.PI * 2), 1.2);
  ctx.strokeStyle = PAL.ironLight; ctx.lineWidth = 1.2;
  for (let i = 0; i < 3; i += 1) { const a = i * Math.PI / 3; ctx.beginPath(); ctx.moveTo(-L * 0.38 - Math.cos(a) * 5, -Math.sin(a) * 5); ctx.lineTo(-L * 0.38 + Math.cos(a) * 5, Math.sin(a) * 5); ctx.stroke(); }
  /* the bolt */
  if (loaded) {
    ctx.strokeStyle = OUT; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(pull, 0); ctx.lineTo(L * 0.85, 0); ctx.stroke();
    ctx.strokeStyle = PAL.arrow; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(pull, 0); ctx.lineTo(L * 0.85, 0); ctx.stroke();
    outlined(ctx, PAL.arrowHead, () => { ctx.moveTo(L * 0.85, -3.2); ctx.lineTo(L * 0.85 + 9, 0); ctx.lineTo(L * 0.85, 3.2); ctx.closePath(); }, 1);
    ctx.fillStyle = PAL.red; ctx.beginPath(); ctx.moveTo(pull + 2, 0); ctx.lineTo(pull + 8, -3); ctx.lineTo(pull + 8, 3); ctx.closePath(); ctx.fill();
  }
  if (big) { ctx.fillStyle = PAL.gold; ctx.fillRect(-L * 0.45, -1.2, 5, 2.4); ctx.fillRect(L * 0.6, -1.2, 5, 2.4); }
}

/* ------------------------------ catapult ------------------------------ */

function catapultBase(ctx, level) {
  ctx.fillStyle = rgba("#000000", 0.16); ctx.beginPath(); ctx.ellipse(4, 6, 38, 14, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#8a7a55"; ctx.beginPath(); ctx.ellipse(0, 2, 30, 11, 0, 0, Math.PI * 2); ctx.fill();
  if (level >= 3) {
    outlined(ctx, PAL.stone, () => ctx.rect(-32, -12, 64, 14), 1.3);
    courses(ctx, -32, -12, 64, 14, 6);
    outlined(ctx, PAL.stoneLight, () => ctx.ellipse(0, -12, 32, 11, 0, 0, Math.PI * 2), 1.2);
  } else {
    outlined(ctx, PAL.wood, () => ctx.rect(-30, -6, 60, 8), 1.3);
    planks(ctx, -30, -6, 60, 8, 6, true);
    outlined(ctx, PAL.woodLight, () => ctx.ellipse(0, -6, 30, 10, 0, 0, Math.PI * 2), 1.2);
    planks(ctx, -30, -16, 60, 20, 5);
  }
  const base = level >= 3 ? -12 : -6;
  /* wheels */
  for (const wx of [-20, 20]) {
    outlined(ctx, PAL.woodDark, () => ctx.arc(wx, base - 2, 7, 0, Math.PI * 2), 1.2);
    ctx.strokeStyle = PAL.wood; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(wx - 5, base - 2); ctx.lineTo(wx + 5, base - 2); ctx.moveTo(wx, base - 7); ctx.lineTo(wx, base + 3); ctx.stroke();
  }
  /* frame */
  outlined(ctx, PAL.wood, () => ctx.rect(-24, base - 10, 48, 6), 1.2);
  outlined(ctx, PAL.wood, () => { ctx.moveTo(-14, base - 8); ctx.lineTo(-4, base - 40); ctx.lineTo(2, base - 40); ctx.lineTo(-8, base - 8); ctx.closePath(); }, 1.2);
  outlined(ctx, PAL.wood, () => { ctx.moveTo(16, base - 8); ctx.lineTo(6, base - 40); ctx.lineTo(0, base - 40); ctx.lineTo(10, base - 8); ctx.closePath(); }, 1.2);
  /* crossbar / stop */
  outlined(ctx, PAL.woodDark, () => ctx.rect(-6, base - 42, 12, 4), 1.1);
  if (level >= 2) {
    /* counterweight box */
    outlined(ctx, PAL.woodDark, () => ctx.rect(-32, base - 24, 12, 14), 1.2);
    planks(ctx, -32, base - 24, 12, 14, 4);
    ctx.fillStyle = PAL.iron; ctx.fillRect(-32, base - 18, 12, 1.5);
  }
  /* stone pile */
  for (const [sx, sy, r] of [[26, base - 3, 4], [31, base - 1, 3.5], [28, base - 8, 3]]) outlined(ctx, PAL.rockLight, () => ctx.arc(sx, sy, r, 0, Math.PI * 2), 1);
  if (level === 4) {
    /* fire brazier for the fire pots */
    outlined(ctx, PAL.iron, () => ctx.rect(-36, base - 6, 10, 6), 1);
    outlined(ctx, PAL.iron, () => ctx.rect(-32, base, 2, 4), 1);
    ctx.fillStyle = PAL.gold; ctx.fillRect(-24, base - 9, 48, 1.8);
  }
}

export function catapultPivot(level) {
  const base = level >= 3 ? -12 : -6;
  return { x: -1, y: base - 38 };
}

export function catapultBrazier(level) {
  const base = level >= 3 ? -12 : -6;
  return level === 4 ? { x: -31, y: base - 8 } : null;
}

/* The throwing arm around its pivot. phase 0 = cocked (loaded), 1 = released (upright/forward). */
export function drawCatapultArm(ctx, level, phase, loaded) {
  const a = (-0.55 + phase * -1.55);         // radians from +x axis, negative = up
  ctx.save();
  ctx.rotate(a);
  const L = level >= 3 ? 40 : 34;
  outlined(ctx, PAL.woodLight, () => ctx.rect(-8, -3, L + 8, 6), 1.3);
  ctx.fillStyle = rgba("#000000", 0.14); ctx.fillRect(-8, 0, L + 8, 3);
  ctx.strokeStyle = PAL.iron; ctx.lineWidth = 1.2; for (const px of [4, 14, 24]) { ctx.beginPath(); ctx.moveTo(px, -3); ctx.lineTo(px, 3); ctx.stroke(); }
  /* cup */
  outlined(ctx, PAL.woodDark, () => { ctx.moveTo(L - 2, -3); ctx.lineTo(L + 6, -8); ctx.lineTo(L + 6, 8); ctx.lineTo(L - 2, 3); ctx.closePath(); }, 1.2);
  if (loaded) {
    outlined(ctx, level === 4 ? "#3a2418" : PAL.rock, () => ctx.arc(L + 2, 0, 5, 0, Math.PI * 2), 1.1);
    if (level === 4) { ctx.fillStyle = PAL.fire; ctx.beginPath(); ctx.arc(L + 2, -2, 2.4, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.restore();
}

/* ------------------------------ dispatch ------------------------------ */

export function drawTowerBody(ctx, type, level) {
  switch (type) {
    case "archer": archerTower(ctx, level); break;
    case "barracks": barracks(ctx, level); break;
    case "ballista": ballistaBase(ctx, level); break;
    case "catapult": catapultBase(ctx, level); break;
    default: break;
  }
}

/* banner anchors drawn live (waving) by the renderer */
export function towerFlag(type, level) {
  if (type === "barracks") return barracksFlag(level);
  if (type === "archer" && level === 4) return { x: -20, y: -100, h: 30, size: 0.8 };
  if (type === "ballista" && level === 4) return { x: -26, y: -46, h: 24, size: 0.6 };
  return null;
}

/* sprite box for tower bodies (world units around the plot centre) */
export const TOWER_BOX = { w: 130, h: 150, ax: 65, ay: 120 };

/* a tiny icon of each tower for menus, drawn in a 48x48 box */
export function drawTowerIcon(ctx, type) {
  ctx.save();
  ctx.translate(24, 44);
  ctx.scale(0.42, 0.42);
  drawTowerBody(ctx, type, type === "archer" ? 3 : 2);
  ctx.restore();
}
