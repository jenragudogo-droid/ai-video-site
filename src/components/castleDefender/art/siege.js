/* ------------------------------------------------------------------ *
 * Castle Defender — Stage III siege engines.
 *
 * Big wooden machines drawn in world units, facing +x with the ground
 * at y = 0, like the ram in figures.js. They are meant to read as
 * large and important next to a 60-unit soldier: a catapult is about
 * 110 wide, a siege tower 130 tall.
 * ------------------------------------------------------------------ */

import { PAL, rgba, shade } from "./palette.js";
import { FIGURES, figurePose, drawFigure } from "./figures.js";

const OUT = "rgba(28, 20, 12, 0.62)";

function outlined(ctx, fill, path, lw = 1.4) {
  ctx.beginPath(); path(); ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = OUT; ctx.lineWidth = lw; ctx.stroke();
}

function wheel(ctx, x, y, r, t) {
  outlined(ctx, PAL.woodDark, () => ctx.arc(x, y, r, 0, Math.PI * 2), 1.5);
  ctx.strokeStyle = PAL.wood; ctx.lineWidth = 2.4;
  for (let i = 0; i < 6; i += 1) { const a = t * Math.PI * 2 + i * Math.PI / 3; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * (r - 2), y + Math.sin(a) * (r - 2)); ctx.stroke(); }
  ctx.strokeStyle = PAL.iron; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r - 1, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = PAL.ironLight; ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill();
}

function planks(ctx, x, y, w, h, step = 7, vertical = false) {
  ctx.strokeStyle = rgba("#000000", 0.18); ctx.lineWidth = 1;
  if (vertical) for (let xx = x + step; xx < x + w; xx += step) { ctx.beginPath(); ctx.moveTo(xx, y); ctx.lineTo(xx, y + h); ctx.stroke(); }
  else for (let yy = y + step; yy < y + h; yy += step) { ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); ctx.stroke(); }
}

/* `arm` 0..1: 0 = cocked and loaded, 1 = fully released. `t` rolls the wheels. */
export function drawSiegeCatapult(ctx, t, arm = 0, opts = {}) {
  const crew = opts.crew !== false;
  wheel(ctx, -34, -9, 11, t); wheel(ctx, 30, -9, 11, t);
  /* bed */
  outlined(ctx, PAL.wood, () => ctx.rect(-52, -22, 104, 12), 1.4);
  planks(ctx, -52, -22, 104, 12, 9, true);
  ctx.fillStyle = rgba("#000000", 0.16); ctx.fillRect(-52, -14, 104, 4);
  /* uprights and cross beam (the padded stop) */
  for (const px of [-8, 12]) outlined(ctx, PAL.woodDark, () => { ctx.moveTo(px - 4, -22); ctx.lineTo(px + 4, -22); ctx.lineTo(px + 2, -70); ctx.lineTo(px - 2, -70); ctx.closePath(); }, 1.2);
  outlined(ctx, PAL.leather, () => ctx.rect(-14, -74, 32, 8), 1.2);
  ctx.strokeStyle = PAL.bone; ctx.lineWidth = 1; for (let xx = -12; xx < 18; xx += 5) { ctx.beginPath(); ctx.moveTo(xx, -74); ctx.lineTo(xx, -66); ctx.stroke(); }
  /* torsion skein */
  outlined(ctx, PAL.bone, () => ctx.rect(-22, -30, 44, 7), 1);
  ctx.strokeStyle = rgba("#000000", 0.25); ctx.lineWidth = 1; for (let xx = -20; xx < 22; xx += 4) { ctx.beginPath(); ctx.moveTo(xx, -30); ctx.lineTo(xx + 2, -23); ctx.stroke(); }
  /* throwing arm: pivots at (0,-26); cocked lies back along -x, released stands up against the stop */
  const a0 = Math.PI * 0.86; const a1 = Math.PI * 0.42;
  const ang = a0 + (a1 - a0) * arm;
  const L = 62;
  const ex = Math.cos(ang) * L; const ey = -26 - Math.sin(ang) * L;
  ctx.strokeStyle = OUT; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(0, -26); ctx.lineTo(ex, ey); ctx.stroke();
  ctx.strokeStyle = PAL.woodLight; ctx.lineWidth = 6.5; ctx.beginPath(); ctx.moveTo(0, -26); ctx.lineTo(ex, ey); ctx.stroke();
  ctx.strokeStyle = PAL.iron; ctx.lineWidth = 1.2; for (let k = 0.25; k < 1; k += 0.25) { ctx.beginPath(); ctx.arc(ex * k, -26 + (ey + 26) * k, 4, 0, Math.PI * 2); ctx.stroke(); }
  /* cup and the stone while loaded */
  outlined(ctx, PAL.iron, () => ctx.arc(ex, ey, 7, Math.PI * 0.1, Math.PI * 0.9, true), 1.2);
  if (arm < 0.15) outlined(ctx, PAL.rock, () => ctx.arc(ex + 1, ey - 5, 6.5, 0, Math.PI * 2), 1.2);
  /* windlass at the back */
  outlined(ctx, PAL.woodDark, () => ctx.arc(-44, -34, 7, 0, Math.PI * 2), 1.2);
  ctx.strokeStyle = PAL.bone; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-44, -34); ctx.lineTo(ex * 0.6, -26 + (ey + 26) * 0.6); ctx.stroke();
  /* crew: one on the windlass, one pushing */
  if (crew) {
    const pose = figurePose(arm > 0 ? "attack" : "push", t);
    ctx.save(); ctx.translate(-62, 2); ctx.scale(0.86, 0.86); drawFigure(ctx, FIGURES.crew, pose, 1); ctx.restore();
    ctx.save(); ctx.translate(46, 3); ctx.scale(0.84, 0.84); drawFigure(ctx, FIGURES.crew, figurePose("idle", t * 2), 0); ctx.restore();
  }
  /* black banner on the frame */
  ctx.strokeStyle = PAL.woodDark; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-30, -22); ctx.lineTo(-30, -60); ctx.stroke();
  outlined(ctx, PAL.blackDark, () => { ctx.moveTo(-30, -60); ctx.lineTo(-46, -56); ctx.lineTo(-42, -50); ctx.lineTo(-48, -46); ctx.lineTo(-30, -46); ctx.closePath(); }, 1.1);
  ctx.fillStyle = PAL.red; ctx.beginPath(); ctx.arc(-38, -53, 2.2, 0, Math.PI * 2); ctx.fill();
}

/* `ramp` 0..1 lowers the drawbridge at the top. `t` rolls the wheels. */
export function drawSiegeTower(ctx, t, ramp = 0, opts = {}) {
  const dead = !!opts.dead;
  wheel(ctx, -30, -9, 10, t); wheel(ctx, 30, -9, 10, t);
  /* base carriage */
  outlined(ctx, PAL.wood, () => ctx.rect(-42, -22, 84, 12), 1.4);
  planks(ctx, -42, -22, 84, 12, 8, true);
  /* tower body: three tiers, hides on the front face, narrowing upward */
  const tiers = [[-36, -22, 72, 36], [-32, -58, 64, 36], [-28, -94, 56, 36]];
  tiers.forEach(([x, y, w, h], i) => {
    outlined(ctx, i % 2 ? PAL.woodDark : PAL.wood, () => ctx.rect(x, y, w, h), 1.4);
    planks(ctx, x, y, w, h, 7);
    /* hide-covered front (facing +x) */
    outlined(ctx, PAL.leather, () => ctx.rect(x + w - 14, y + 2, 12, h - 4), 1.1);
    ctx.fillStyle = rgba("#000000", 0.12); ctx.fillRect(x + w - 8, y + 2, 6, h - 4);
    /* arrow slit */
    ctx.fillStyle = "#1d1a16"; ctx.fillRect(x + w / 2 - 1, y + 10, 2, 12);
    /* corner posts */
    ctx.strokeStyle = PAL.woodDark; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x + 1, y); ctx.lineTo(x + 1, y + h); ctx.moveTo(x + w - 1, y); ctx.lineTo(x + w - 1, y + h); ctx.stroke();
    if (dead && i === 2) { ctx.fillStyle = rgba("#1a1410", 0.45); ctx.fillRect(x + 8, y + 4, w - 16, h - 8); }
  });
  /* ladder on the back */
  ctx.strokeStyle = PAL.woodLight; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(-40, -22); ctx.lineTo(-32, -100); ctx.moveTo(-34, -22); ctx.lineTo(-26, -100); ctx.stroke();
  for (let k = 0; k < 8; k += 1) { const yy = -30 - k * 9; ctx.beginPath(); ctx.moveTo(-40 + k * 1, yy); ctx.lineTo(-34 + k * 1, yy); ctx.stroke(); }
  /* top platform with crenels and two soldiers */
  outlined(ctx, PAL.woodDark, () => ctx.rect(-32, -100, 64, 8), 1.3);
  for (let xx = -30; xx < 32; xx += 10) outlined(ctx, PAL.wood, () => ctx.rect(xx, -106, 6, 6), 1);
  if (!dead) {
    const pose = figurePose("idle", t * 2);
    ctx.save(); ctx.translate(-10, -100); ctx.scale(0.62, 0.62); drawFigure(ctx, FIGURES.manAtArmsE, pose, 0); ctx.restore();
    ctx.save(); ctx.translate(12, -100); ctx.scale(0.62, 0.62); drawFigure(ctx, FIGURES.archer, figurePose("shoot", (t * 2) % 1, { bow: true }), 1); ctx.restore();
  }
  /* drawbridge: hinged at the top front, swings down toward +x */
  const ang = ramp * Math.PI * 0.55;
  ctx.save(); ctx.translate(28, -96); ctx.rotate(ang);
  outlined(ctx, PAL.wood, () => ctx.rect(0, -6, 8, 46), 1.2);
  ctx.strokeStyle = PAL.iron; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(1, 0); ctx.lineTo(7, 0); ctx.moveTo(1, 36); ctx.lineTo(7, 36); ctx.stroke();
  ctx.restore();
  /* banner */
  ctx.strokeStyle = PAL.woodDark; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -106); ctx.lineTo(0, -128); ctx.stroke();
  outlined(ctx, PAL.blackDark, () => { ctx.moveTo(0, -128); ctx.lineTo(-18, -124); ctx.lineTo(-13, -118); ctx.lineTo(-20, -113); ctx.lineTo(0, -113); ctx.closePath(); }, 1.1);
  ctx.fillStyle = PAL.red; ctx.beginPath(); ctx.arc(-9, -120, 2.4, 0, Math.PI * 2); ctx.fill();
  /* crew pushing */
  if (!dead) {
    const pose = figurePose("push", t);
    ctx.save(); ctx.translate(-52, 2); ctx.scale(0.86, 0.86); drawFigure(ctx, FIGURES.crew, pose, 1); ctx.restore();
  }
}

/* Camp furniture for the terrain baker: a big tent, a small tent, a
   palisade of stakes, a cart and a cold fire ring. */
export function drawSiegeCamp(ctx, x, y, rng) {
  ctx.fillStyle = rgba("#000000", 0.2); ctx.beginPath(); ctx.ellipse(x + 4, y + 6, 70, 26, 0, 0, Math.PI * 2); ctx.fill();
  /* trampled ground */
  ctx.fillStyle = rgba("#6b5a3a", 0.55); ctx.beginPath(); ctx.ellipse(x, y, 74, 30, 0, 0, Math.PI * 2); ctx.fill();
  /* palisade */
  for (let i = -5; i <= 5; i += 1) {
    const sx = x + i * 13 + (rng() - 0.5) * 3; const sy = y + 26 + Math.abs(i) * 1.5;
    outlined(ctx, PAL.woodDark, () => { ctx.moveTo(sx - 2.5, sy); ctx.lineTo(sx + 2.5, sy); ctx.lineTo(sx + 1.5, sy - 16); ctx.lineTo(sx, sy - 20); ctx.lineTo(sx - 1.5, sy - 16); ctx.closePath(); }, 1);
  }
  /* big tent */
  outlined(ctx, shade(PAL.blackLight, -0.1), () => { ctx.moveTo(x - 46, y + 6); ctx.lineTo(x - 18, y - 34); ctx.lineTo(x + 12, y + 6); ctx.closePath(); }, 1.3);
  ctx.fillStyle = rgba("#000000", 0.22); ctx.beginPath(); ctx.moveTo(x - 18, y - 34); ctx.lineTo(x + 12, y + 6); ctx.lineTo(x - 18, y + 6); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#1a1612"; ctx.beginPath(); ctx.moveTo(x - 24, y + 6); ctx.lineTo(x - 18, y - 10); ctx.lineTo(x - 12, y + 6); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = PAL.bone; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - 46, y + 6); ctx.lineTo(x - 54, y + 12); ctx.moveTo(x + 12, y + 6); ctx.lineTo(x + 20, y + 12); ctx.stroke();
  /* small tent */
  outlined(ctx, PAL.warGrey, () => { ctx.moveTo(x + 20, y + 4); ctx.lineTo(x + 36, y - 18); ctx.lineTo(x + 54, y + 4); ctx.closePath(); }, 1.2);
  ctx.fillStyle = rgba("#000000", 0.2); ctx.beginPath(); ctx.moveTo(x + 36, y - 18); ctx.lineTo(x + 54, y + 4); ctx.lineTo(x + 36, y + 4); ctx.closePath(); ctx.fill();
  /* fire ring */
  for (let i = 0; i < 7; i += 1) { const a = i / 7 * Math.PI * 2; outlined(ctx, PAL.rockLight, () => ctx.arc(x + 4 + Math.cos(a) * 9, y - 8 + Math.sin(a) * 4.5, 2.4, 0, Math.PI * 2), 0.8); }
  ctx.fillStyle = "#2a2018"; ctx.beginPath(); ctx.ellipse(x + 4, y - 8, 6, 3, 0, 0, Math.PI * 2); ctx.fill();
  /* cart with stones */
  outlined(ctx, PAL.wood, () => ctx.rect(x + 40, y + 10, 26, 10), 1.1);
  outlined(ctx, PAL.woodDark, () => ctx.arc(x + 46, y + 22, 4.5, 0, Math.PI * 2), 1); outlined(ctx, PAL.woodDark, () => ctx.arc(x + 61, y + 22, 4.5, 0, Math.PI * 2), 1);
  for (const [rx, ry] of [[x + 46, y + 8], [x + 53, y + 6], [x + 60, y + 8]]) outlined(ctx, PAL.rock, () => ctx.arc(rx, ry, 4, 0, Math.PI * 2), 0.9);
  /* barrels */
  outlined(ctx, PAL.wood, () => ctx.rect(x - 60, y + 14, 9, 12), 1); ctx.fillStyle = PAL.iron; ctx.fillRect(x - 60, y + 17, 9, 1.4); ctx.fillRect(x - 60, y + 22, 9, 1.4);
}

/* a dug trench with stakes, from a to b */
export function drawTrench(ctx, a, b) {
  const dx = b.x - a.x; const dy = b.y - a.y; const L = Math.hypot(dx, dy);
  ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(Math.atan2(dy, dx));
  outlined(ctx, "#5a4a32", () => ctx.rect(0, -10, L, 20), 1.2);
  ctx.fillStyle = "#2e2416"; ctx.fillRect(0, -6, L, 9);
  ctx.fillStyle = rgba("#8a7a58", 0.7); ctx.fillRect(0, -13, L, 4);
  for (let xx = 8; xx < L; xx += 14) {
    outlined(ctx, PAL.woodDark, () => { ctx.moveTo(xx - 2, -12); ctx.lineTo(xx + 2, -12); ctx.lineTo(xx + 5, -26); ctx.lineTo(xx + 2, -28); ctx.closePath(); }, 0.9);
  }
  ctx.restore();
}

/* a burnt patch of ground */
export function drawScorch(ctx, x, y, rng) {
  const r = 34 + rng() * 22;
  const g = ctx.createRadialGradient(x, y, 2, x, y, r);
  g.addColorStop(0, rgba("#1a1410", 0.62)); g.addColorStop(0.7, rgba("#2a2016", 0.36)); g.addColorStop(1, rgba("#000000", 0));
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.55, rng() * 0.6, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 5; i += 1) { const a = rng() * Math.PI * 2; const d = rng() * r * 0.6; ctx.fillStyle = rgba("#000000", 0.35); ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.5, 3 + rng() * 3, 1.5 + rng() * 1.5, 0, 0, Math.PI * 2); ctx.fill(); }
}

/* a broken cart and a fallen wheel */
export function drawWreckage(ctx, x, y) {
  ctx.fillStyle = rgba("#000000", 0.18); ctx.beginPath(); ctx.ellipse(x + 3, y + 3, 26, 9, 0, 0, Math.PI * 2); ctx.fill();
  ctx.save(); ctx.translate(x, y); ctx.rotate(-0.2);
  outlined(ctx, PAL.woodDark, () => ctx.rect(-22, -12, 30, 10), 1.1);
  ctx.strokeStyle = rgba("#000000", 0.2); ctx.lineWidth = 1; for (let xx = -18; xx < 8; xx += 6) { ctx.beginPath(); ctx.moveTo(xx, -12); ctx.lineTo(xx, -2); ctx.stroke(); }
  ctx.strokeStyle = PAL.woodDark; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(8, -12); ctx.lineTo(20, -22); ctx.stroke();
  ctx.restore();
  outlined(ctx, PAL.woodDark, () => ctx.arc(x + 18, y + 2, 7, 0, Math.PI * 2), 1.2);
  ctx.strokeStyle = PAL.wood; ctx.lineWidth = 1.6; for (let i = 0; i < 4; i += 1) { const a = i * Math.PI / 4; ctx.beginPath(); ctx.moveTo(x + 18 - Math.cos(a) * 6, y + 2 - Math.sin(a) * 6); ctx.lineTo(x + 18 + Math.cos(a) * 6, y + 2 + Math.sin(a) * 6); ctx.stroke(); }
  outlined(ctx, PAL.rock, () => ctx.arc(x - 26, y + 4, 4, 0, Math.PI * 2), 0.9);
}

/* The outer siege wall: a run of stone segments with a gap for the
   road. `hp` 0..1 shows cracks and rubble; below zero-ish the breach
   segment is a heap of stone. Drawn along the segments given. */
export function drawOuterWall(ctx, ow, hpRatio) {
  const stone = hpRatio > 0.5 ? PAL.stone : shade(PAL.stone, -0.1);
  for (const [a, b] of ow.segments) {
    const dx = b.x - a.x; const dy = b.y - a.y; const L = Math.hypot(dx, dy);
    const nearBreach = Math.min(Math.hypot(a.x - ow.breach.x, a.y - ow.breach.y), Math.hypot(b.x - ow.breach.x, b.y - ow.breach.y)) < 60;
    ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(Math.atan2(dy, dx));
    if (hpRatio <= 0 && nearBreach) {
      /* rubble where the wall stood */
      ctx.fillStyle = rgba("#000000", 0.2); ctx.fillRect(-4, -8, L + 8, 26);
      for (let xx = 0; xx < L; xx += 9) { outlined(ctx, xx % 18 ? PAL.rockLight : PAL.rock, () => ctx.ellipse(xx + 4, (xx % 27) / 3 - 2, 6, 4, 0.3, 0, Math.PI * 2), 1); }
      ctx.restore();
      continue;
    }
    ctx.fillStyle = rgba("#000000", 0.24); ctx.fillRect(0, -6, L + 6, 30);
    outlined(ctx, shade(stone, -0.15), () => ctx.rect(0, -10, L, 24), 1.4);        // face
    ctx.fillStyle = rgba("#000000", 0.14); ctx.fillRect(0, 6, L, 8);
    outlined(ctx, stone, () => ctx.rect(0, -18, L, 10), 1.2);                     // walk
    ctx.strokeStyle = rgba("#000000", 0.16); ctx.lineWidth = 1;
    for (let xx = 9; xx < L; xx += 12) { ctx.beginPath(); ctx.moveTo(xx, -10); ctx.lineTo(xx + 1, 14); ctx.stroke(); }
    for (let xx = 3; xx < L - 4; xx += 12) outlined(ctx, shade(stone, 0.12), () => ctx.rect(xx, -24, 6, 6), 0.9);
    if (hpRatio < 0.75) { ctx.strokeStyle = rgba("#2a2018", 0.7); ctx.lineWidth = 1.2; for (let xx = 20; xx < L; xx += 70) { ctx.beginPath(); ctx.moveTo(xx, -8); ctx.lineTo(xx + 5, 0); ctx.lineTo(xx + 2, 8); ctx.lineTo(xx + 7, 13); ctx.stroke(); } }
    if (hpRatio < 0.4) { ctx.fillStyle = rgba("#1a1410", 0.4); for (let xx = 30; xx < L; xx += 90) { ctx.beginPath(); ctx.ellipse(xx, 2, 14, 9, 0, 0, Math.PI * 2); ctx.fill(); } for (let xx = 14; xx < L; xx += 40) outlined(ctx, PAL.rockLight, () => ctx.arc(xx, 18, 3.5, 0, Math.PI * 2), 0.9); }
    ctx.restore();
  }
  /* gate posts either side of the gap */
  for (const seg of ow.segments) {
    for (const p of seg) {
      if (Math.hypot(p.x - ow.gap.x, p.y - ow.gap.y) < 60) {
        ctx.fillStyle = rgba("#000000", 0.2); ctx.beginPath(); ctx.ellipse(p.x + 3, p.y + 4, 12, 6, 0, 0, Math.PI * 2); ctx.fill();
        outlined(ctx, PAL.stoneDark, () => ctx.rect(p.x - 9, p.y - 34, 18, 40), 1.3);
        outlined(ctx, PAL.stone, () => ctx.rect(p.x - 10, p.y - 40, 20, 8), 1.1);
      }
    }
  }
}
