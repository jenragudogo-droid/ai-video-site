/* ------------------------------------------------------------------ *
 * Castle Defender — the castle.
 *
 * Drawn in a three-quarter view: we see the tops of the walls and
 * their south faces. The footprint is (0,0)-(w,h) in world units with
 * the gate in the middle of the south wall. Four damage states go
 * from pristine to cracked, smoking and burning.
 * ------------------------------------------------------------------ */

import { PAL, shade, rgba } from "./palette.js";

const OUT = "rgba(28, 20, 12, 0.6)";

function outlined(ctx, fill, path, lw = 1.4) {
  ctx.beginPath(); path();
  ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = OUT; ctx.lineWidth = lw; ctx.stroke();
}

function courses(ctx, x, y, w, h, step = 9, alpha = 0.15) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.strokeStyle = rgba("#000000", alpha); ctx.lineWidth = 1;
  for (let yy = y + step; yy < y + h; yy += step) {
    ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); ctx.stroke();
    const off = ((yy - y) / step) % 2 ? step * 0.8 : 0;
    for (let xx = x + off; xx < x + w; xx += step * 1.6) { ctx.beginPath(); ctx.moveTo(xx, yy - step); ctx.lineTo(xx, yy); ctx.stroke(); }
  }
  ctx.restore();
}

function merlons(ctx, x, y, w, color, size = 8, gap = 7, skip = []) {
  let i = 0;
  for (let xx = x; xx < x + w - 2; xx += size + gap) {
    if (!skip.includes(i)) outlined(ctx, color, () => ctx.rect(xx, y - size, Math.min(size, x + w - xx), size), 1.1);
    i += 1;
  }
}

function crack(ctx, x, y, len, seed) {
  ctx.strokeStyle = "rgba(25,18,12,0.7)"; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(x, y);
  let cx = x; let cy = y;
  for (let i = 0; i < 5; i += 1) {
    const s = Math.sin(seed * 13.7 + i * 5.1);
    cx += s * 6; cy += len / 5;
    ctx.lineTo(cx, cy);
  }
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(x + 1, y); let dx = x + 1; let dy = y;
  for (let i = 0; i < 5; i += 1) { const s = Math.sin(seed * 13.7 + i * 5.1); dx += s * 6; dy += len / 5; ctx.lineTo(dx, dy); }
  ctx.stroke();
}

function window_(ctx, x, y, w = 5, h = 9) {
  outlined(ctx, "#1d1a16", () => { ctx.moveTo(x - w / 2, y + h); ctx.lineTo(x - w / 2, y); ctx.arc(x, y, w / 2, Math.PI, 0); ctx.lineTo(x + w / 2, y + h); ctx.closePath(); }, 1);
}

function roundTower(ctx, cx, top, r, h, color, damage, seed) {
  outlined(ctx, color, () => ctx.rect(cx - r, top, r * 2, h), 1.5);
  ctx.fillStyle = rgba("#000000", 0.2); ctx.fillRect(cx + r * 0.15, top, r * 0.85, h);
  ctx.fillStyle = rgba("#ffffff", 0.16); ctx.fillRect(cx - r + 1, top, r * 0.3, h);
  courses(ctx, cx - r, top, r * 2, h, 9);
  outlined(ctx, shade(color, 0.14), () => ctx.ellipse(cx, top, r, r * 0.42, 0, 0, Math.PI * 2), 1.2);
  for (let i = 0; i < 6; i += 1) {
    if (damage >= 2 && (i + seed) % 3 === 0) continue;
    const a = Math.PI + (i / 5) * Math.PI;
    const mx = cx + Math.cos(a) * r * 0.86;
    const my = top + Math.sin(a) * r * 0.38;
    outlined(ctx, color, () => ctx.rect(mx - 3, my - 8, 6, 8), 1);
  }
  window_(ctx, cx - 2, top + h * 0.35, 5, 9);
  if (damage >= 1) crack(ctx, cx + r * 0.3, top + 6, h * 0.5, seed);
}

/* Draws the whole castle; (0,0) is the footprint's top-left corner. */
export function drawCastle(ctx, castle, damage = 0) {
  const { w, h } = castle;
  const stone = damage >= 3 ? shade(PAL.stone, -0.12) : PAL.stone;
  const wallH = 34;               // visible south face height of the curtain wall
  const topBand = 14;

  /* ground shadow */
  ctx.fillStyle = rgba("#000000", 0.18);
  ctx.beginPath(); ctx.ellipse(w / 2 + 12, h - 6, w * 0.62, 34, 0, 0, Math.PI * 2); ctx.fill();

  /* courtyard: packed earth with a cobbled path, a well, stores and a garden */
  outlined(ctx, "#9a8c72", () => ctx.rect(14, 10, w - 28, h - 40), 1);
  ctx.save(); ctx.beginPath(); ctx.rect(14, 10, w - 28, h - 40); ctx.clip();
  ctx.fillStyle = rgba("#000000", 0.08);
  for (let i = 0; i < 60; i += 1) { const cx = 14 + ((i * 53) % (w - 28)); const cy = 10 + ((i * 37) % (h - 40)); ctx.beginPath(); ctx.ellipse(cx, cy, 6, 3, 0, 0, Math.PI * 2); ctx.fill(); }
  /* cobbled path from the gate to the keep */
  ctx.fillStyle = "#b0a48c"; ctx.fillRect(w / 2 - 16, 40, 32, h - 70);
  ctx.strokeStyle = rgba("#000000", 0.12); ctx.lineWidth = 1;
  for (let yy = 44; yy < h - 30; yy += 7) { ctx.beginPath(); ctx.moveTo(w / 2 - 16, yy); ctx.lineTo(w / 2 + 16, yy); ctx.stroke(); }
  for (let yy = 44; yy < h - 30; yy += 14) { ctx.beginPath(); ctx.moveTo(w / 2, yy); ctx.lineTo(w / 2, yy + 7); ctx.stroke(); ctx.beginPath(); ctx.moveTo(w / 2 - 8, yy + 7); ctx.lineTo(w / 2 - 8, yy + 14); ctx.stroke(); ctx.beginPath(); ctx.moveTo(w / 2 + 8, yy + 7); ctx.lineTo(w / 2 + 8, yy + 14); ctx.stroke(); }
  /* kitchen garden */
  outlined(ctx, "#6e8a3e", () => ctx.rect(22, h - 120, 46, 60), 1);
  ctx.strokeStyle = "#4d6a2a"; ctx.lineWidth = 2; for (let yy = h - 114; yy < h - 64; yy += 8) { ctx.beginPath(); ctx.moveTo(25, yy); ctx.lineTo(65, yy); ctx.stroke(); }
  /* the well */
  const wx = w * 0.72; const wy = h * 0.62;
  ctx.fillStyle = rgba("#000000", 0.18); ctx.beginPath(); ctx.ellipse(wx + 3, wy + 3, 13, 6, 0, 0, Math.PI * 2); ctx.fill();
  outlined(ctx, PAL.stoneDark, () => ctx.ellipse(wx, wy, 12, 6, 0, 0, Math.PI * 2), 1.2);
  ctx.fillStyle = "#1a1612"; ctx.beginPath(); ctx.ellipse(wx, wy - 1, 8, 3.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = PAL.woodDark; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(wx - 10, wy - 2); ctx.lineTo(wx - 10, wy - 22); ctx.moveTo(wx + 10, wy - 2); ctx.lineTo(wx + 10, wy - 22); ctx.stroke();
  outlined(ctx, PAL.roof, () => { ctx.moveTo(wx - 15, wy - 22); ctx.lineTo(wx, wy - 32); ctx.lineTo(wx + 15, wy - 22); ctx.closePath(); }, 1);
  /* barrels and crates along the east wall */
  for (let i = 0; i < 3; i += 1) {
    const bx = w - 32; const by = 60 + i * 18;
    outlined(ctx, PAL.wood, () => ctx.rect(bx - 6, by - 10, 12, 14), 1);
    ctx.fillStyle = PAL.iron; ctx.fillRect(bx - 6, by - 7, 12, 1.5); ctx.fillRect(bx - 6, by, 12, 1.5);
  }
  outlined(ctx, PAL.woodLight, () => ctx.rect(w - 52, 118, 14, 12), 1);
  outlined(ctx, PAL.woodLight, () => ctx.rect(w - 50, 106, 10, 10), 1);
  /* hay pile */
  outlined(ctx, "#d9b95a", () => ctx.ellipse(40, 60, 16, 9, 0, 0, Math.PI * 2), 1);
  ctx.strokeStyle = "#a8863a"; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(40, 60, 10, 5, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();

  /* north wall: top band and its (inner) south face */
  outlined(ctx, shade(stone, 0.12), () => ctx.rect(0, -4, w, topBand), 1.3);
  outlined(ctx, stone, () => ctx.rect(0, topBand - 4, w, 26), 1.3);
  courses(ctx, 0, topBand - 4, w, 26, 8);
  merlons(ctx, 4, -4, w - 8, shade(stone, 0.12), 8, 8);

  /* east and west wall tops (thin bands) */
  outlined(ctx, shade(stone, 0.1), () => ctx.rect(0, 0, 16, h - wallH), 1.2);
  outlined(ctx, shade(stone, 0.02), () => ctx.rect(w - 16, 0, 16, h - wallH), 1.2);
  ctx.fillStyle = rgba("#000000", 0.14); ctx.fillRect(w - 8, 0, 8, h - wallH);
  for (let yy = 12; yy < h - wallH - 8; yy += 15) {
    outlined(ctx, shade(stone, 0.12), () => ctx.rect(2, yy, 5, 8), 0.9);
    outlined(ctx, shade(stone, 0.12), () => ctx.rect(w - 7, yy, 5, 8), 0.9);
  }

  /* the keep: a square tower in the back half with a raised turret */
  const kx = w / 2 - 44; const ky = 18; const kw = 88; const kh = 96;
  outlined(ctx, stone, () => ctx.rect(kx, ky - 50, kw, kh), 1.5);
  courses(ctx, kx, ky - 50, kw, kh, 9);
  ctx.fillStyle = rgba("#000000", 0.18); ctx.fillRect(kx + kw * 0.55, ky - 50, kw * 0.45, kh);
  ctx.fillStyle = rgba("#ffffff", 0.12); ctx.fillRect(kx + 1, ky - 50, 10, kh);
  outlined(ctx, shade(stone, 0.14), () => ctx.rect(kx, ky - 52, kw, 6), 1.1);
  merlons(ctx, kx + 3, ky - 52, kw - 6, shade(stone, 0.12), 8, 7, damage >= 2 ? [2, 6] : []);
  window_(ctx, kx + 22, ky - 20, 6, 11); window_(ctx, kx + 44, ky - 28, 6, 11); window_(ctx, kx + 66, ky - 20, 6, 11);
  window_(ctx, kx + 44, ky + 6, 6, 11);
  /* turret with a red conical roof on the keep's corner */
  outlined(ctx, stone, () => ctx.rect(kx + kw - 24, ky - 84, 22, 40), 1.3);
  courses(ctx, kx + kw - 24, ky - 84, 22, 40, 8);
  outlined(ctx, shade(stone, 0.14), () => ctx.ellipse(kx + kw - 13, ky - 84, 11, 4.5, 0, 0, Math.PI * 2), 1);
  outlined(ctx, PAL.roof, () => { ctx.moveTo(kx + kw - 27, ky - 84); ctx.lineTo(kx + kw - 13, ky - 112); ctx.lineTo(kx + kw + 1, ky - 84); ctx.closePath(); }, 1.3);
  ctx.fillStyle = rgba("#000000", 0.22); ctx.beginPath(); ctx.moveTo(kx + kw - 13, ky - 84); ctx.lineTo(kx + kw - 13, ky - 112); ctx.lineTo(kx + kw + 1, ky - 84); ctx.closePath(); ctx.fill();
  if (damage >= 1) crack(ctx, kx + 30, ky - 40, 50, 3);
  if (damage >= 2) crack(ctx, kx + 70, ky - 10, 40, 5);

  /* corner towers (back pair first, then the front pair over the south wall) */
  roundTower(ctx, 6, -30, 20, 60, stone, damage, 1);
  roundTower(ctx, w - 6, -30, 20, 60, stone, damage, 2);

  /* south curtain wall */
  const sy = h - wallH;
  outlined(ctx, shade(stone, 0.12), () => ctx.rect(0, sy - topBand, w, topBand), 1.3);
  ctx.fillStyle = rgba("#000000", 0.06); ctx.fillRect(0, sy - 4, w, 4);
  merlons(ctx, 4, sy - topBand, w - 8, shade(stone, 0.12), 8, 8, damage >= 2 ? [3, 9, 15] : []);
  outlined(ctx, stone, () => ctx.rect(0, sy, w, wallH), 1.4);
  courses(ctx, 0, sy, w, wallH, 8);
  const wg = ctx.createLinearGradient(0, sy, 0, sy + wallH);
  wg.addColorStop(0, rgba("#000000", 0)); wg.addColorStop(1, rgba("#000000", 0.16));
  ctx.fillStyle = wg; ctx.fillRect(0, sy, w, wallH);
  /* arrow slits */
  for (let xx = 30; xx < w - 30; xx += 34) {
    if (Math.abs(xx - w / 2) < 50) continue;
    ctx.fillStyle = "#1d1a16"; ctx.fillRect(xx - 1.2, sy + 8, 2.4, 12);
  }
  if (damage >= 1) { crack(ctx, w * 0.22, sy + 2, 30, 7); crack(ctx, w * 0.78, sy + 4, 28, 11); }
  if (damage >= 2) { crack(ctx, w * 0.35, sy + 1, 32, 13); ctx.fillStyle = rgba("#000000", 0.18); ctx.fillRect(w * 0.6, sy + 10, 26, 24); }
  if (damage >= 3) { ctx.fillStyle = rgba("#1a1410", 0.45); ctx.beginPath(); ctx.ellipse(w * 0.3, sy + 14, 26, 18, 0, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.ellipse(w * 0.72, sy + 10, 22, 16, 0, 0, Math.PI * 2); ctx.fill(); }

  /* gatehouse: two square towers flanking the arch */
  const gx = w / 2;
  const gtW = 30; const gtH = 76;
  for (const side of [-1, 1]) {
    const tx = gx + side * 34 - gtW / 2;
    outlined(ctx, stone, () => ctx.rect(tx, h - gtH, gtW, gtH), 1.5);
    courses(ctx, tx, h - gtH, gtW, gtH, 8);
    ctx.fillStyle = rgba("#000000", 0.18); ctx.fillRect(tx + gtW * 0.6, h - gtH, gtW * 0.4, gtH);
    ctx.fillStyle = rgba("#ffffff", 0.12); ctx.fillRect(tx + 1, h - gtH, 5, gtH);
    outlined(ctx, shade(stone, 0.14), () => ctx.rect(tx, h - gtH - 5, gtW, 6), 1.1);
    merlons(ctx, tx + 2, h - gtH - 5, gtW - 4, shade(stone, 0.12), 6, 5, damage >= 2 && side > 0 ? [1] : []);
    window_(ctx, tx + gtW / 2, h - gtH + 22, 5, 9);
    ctx.fillStyle = "#1d1a16"; ctx.fillRect(tx + gtW / 2 - 1.2, h - 32, 2.4, 12);
    if (damage >= 1) crack(ctx, tx + 8, h - gtH + 10, 36, 17 + side);
  }
  /* wall between the gate towers, above the arch */
  outlined(ctx, stone, () => ctx.rect(gx - 19, h - 60, 38, 60), 1.3);
  courses(ctx, gx - 19, h - 60, 38, 60, 8);
  outlined(ctx, shade(stone, 0.14), () => ctx.rect(gx - 19, h - 64, 38, 5), 1);
  merlons(ctx, gx - 17, h - 64, 34, shade(stone, 0.12), 6, 5);
  /* the arch */
  const aw = 30; const ah = 40;
  outlined(ctx, "#14110e", () => { ctx.moveTo(gx - aw / 2, h); ctx.lineTo(gx - aw / 2, h - ah + aw / 2); ctx.arc(gx, h - ah + aw / 2, aw / 2, Math.PI, 0); ctx.lineTo(gx + aw / 2, h); ctx.closePath(); }, 1.6);
  /* portcullis */
  ctx.strokeStyle = PAL.iron; ctx.lineWidth = 1.8;
  for (let i = -2; i <= 2; i += 1) { ctx.beginPath(); ctx.moveTo(gx + i * 6, h - ah + 6 + Math.abs(i) * 2); ctx.lineTo(gx + i * 6, h - 4); ctx.stroke(); }
  for (let yy = h - ah + 12; yy < h - 4; yy += 9) { ctx.beginPath(); ctx.moveTo(gx - aw / 2 + 3, yy); ctx.lineTo(gx + aw / 2 - 3, yy); ctx.stroke(); }
  /* voussoirs around the arch */
  ctx.strokeStyle = shade(stone, -0.2); ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(gx, h - ah + aw / 2, aw / 2 + 2, Math.PI, 0); ctx.stroke();
  ctx.strokeStyle = shade(stone, 0.18); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(gx, h - ah + aw / 2, aw / 2 + 4, Math.PI, 0); ctx.stroke();
  /* wooden bridge over the ditch in front of the gate */
  outlined(ctx, PAL.wood, () => ctx.rect(gx - 19, h - 2, 38, 26), 1.3);
  ctx.strokeStyle = rgba("#000000", 0.22); ctx.lineWidth = 1;
  for (let xx = gx - 14; xx < gx + 19; xx += 6) { ctx.beginPath(); ctx.moveTo(xx, h - 2); ctx.lineTo(xx, h + 24); ctx.stroke(); }
  ctx.strokeStyle = PAL.iron; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(gx - 17, h + 3); ctx.lineTo(gx - 17, h - 40); ctx.moveTo(gx + 17, h + 3); ctx.lineTo(gx + 17, h - 40); ctx.stroke();

  /* front corner towers over the south wall */
  roundTower(ctx, 8, h - 78, 21, 76, stone, damage, 4);
  roundTower(ctx, w - 8, h - 78, 21, 76, stone, damage, 6);

  /* rubble at the base when damaged */
  if (damage >= 2) {
    for (const [rx, ry, r] of [[w * 0.2, h + 4, 5], [w * 0.24, h + 8, 3.5], [w * 0.8, h + 5, 4.5], [w * 0.74, h + 9, 3]]) {
      outlined(ctx, PAL.rockLight, () => ctx.arc(rx, ry, r, 0, Math.PI * 2), 1);
    }
  }
}

/* Banner poles, in castle-local coordinates. size scales the cloth. */
export function castleFlags(castle) {
  const { w, h } = castle;
  return [
    { x: w / 2 - 2, y: 18 - 52, h: 40, size: 1.15, color: PAL.red, trim: PAL.gold },   // keep
    { x: w / 2 - 34, y: h - 81, h: 30, size: 0.85, color: PAL.red, trim: PAL.gold },   // gate tower west
    { x: w / 2 + 34, y: h - 81, h: 30, size: 0.85, color: PAL.gold, trim: PAL.red },   // gate tower east
    { x: 6, y: -30, h: 26, size: 0.7, color: PAL.red, trim: PAL.gold },                // back corners
    { x: w - 6, y: -30, h: 26, size: 0.7, color: PAL.red, trim: PAL.gold },
  ];
}

/* where smoke and fire rise from as the castle takes damage */
export function castleDamagePoints(castle, damage) {
  const { w, h } = castle;
  const pts = [];
  if (damage >= 1) pts.push({ x: w * 0.22, y: h - 20, fire: false });
  if (damage >= 2) pts.push({ x: w * 0.62, y: h - 18, fire: false }, { x: w / 2 + 20, y: 18 - 30, fire: false });
  if (damage >= 3) pts.push({ x: w * 0.3, y: h - 12, fire: true }, { x: w * 0.72, y: h - 14, fire: true }, { x: w / 2 - 30, y: 18 - 40, fire: true });
  return pts;
}

export function castleDamageState(hp, max) {
  const r = hp / max;
  if (r > 0.75) return 0;
  if (r > 0.5) return 1;
  if (r > 0.25) return 2;
  return 3;
}
