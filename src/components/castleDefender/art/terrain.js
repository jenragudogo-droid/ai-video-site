/* ------------------------------------------------------------------ *
 * Castle Defender — the battlefield painter.
 *
 * Bakes the whole ground plane once per scale: meadow, road, river,
 * bridge, forests, rocks, fields, build plots and a warm vignette.
 * Decor is placed by a seeded generator that keeps clear of roads,
 * plots, the river and the castle, so nothing sits where units walk.
 * ------------------------------------------------------------------ */

import { PAL, shade, rgba } from "./palette.js";
import { drawSiegeCamp, drawTrench, drawScorch, drawWreckage } from "./siege.js";
import { FROST, frostPine } from "./frost.js";

/* Ground colours by season. A stage picks one with `season: "winter"`;
   everything else keeps Ashford's summer palette exactly as it was. */
const SEASONS = {
  summer: {
    grass: PAL.grass, grassLight: PAL.grassLight, grassDark: PAL.grassDark,
    road: PAL.road, roadDark: PAL.roadDark, roadEdge: PAL.roadEdge, pebble: PAL.pebble,
    river: PAL.river, riverDeep: PAL.riverDeep, riverFoam: PAL.riverFoam, riverBank: PAL.riverBank,
    field: PAL.field, fieldDark: PAL.fieldDark, fieldEdge: "#b39a52",
    apron: "#a89c86", patchLight: "#a8d060", patchDark: "#3e6a2c",
    flower: ["#f2f0e8", "#e9c8e0"], light: PAL.sun,
  },
  winter: {
    /* packed snow over frozen ground; roads are trodden slush, rivers are ice */
    grass: "#dfe8f2", grassLight: "#f1f6fb", grassDark: "#bccbdd",
    /* The road is the single most important line on the board. Trodden
       slush on snow was too close in value to the ground beside it, so
       the north's roads run darker and browner than the drifts. */
    road: "#b9c4d4", roadDark: "#8d9bb0", roadEdge: "#6d7d95", pebble: "#eef3fa",
    river: FROST.ice, riverDeep: FROST.iceDark, riverFoam: FROST.iceLight, riverBank: "#c3d2e4",
    field: "#d8dfe8", fieldDark: "#b9c5d4", fieldEdge: "#9aa8bb",
    apron: "#b8c2d0", patchLight: "#ffffff", patchDark: "#8ea6bd",
    flower: ["#ffffff", "#dce9f5"], light: "rgba(210, 228, 245, 0.2)",
  },
};
import { drawPlot } from "./towers.js";

const OUT = "rgba(28, 20, 12, 0.55)";

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function outlined(ctx, fill, path, lw = 1.2) {
  ctx.beginPath(); path();
  ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = OUT; ctx.lineWidth = lw; ctx.stroke();
}

function strokePath(ctx, pts, width, color, dash) {
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.strokeStyle = color; ctx.lineWidth = width;
  if (dash) ctx.setLineDash(dash); else ctx.setLineDash([]);
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.stroke();
  ctx.setLineDash([]);
}

/* ------------------------------- trees ------------------------------- */

export function drawOak(ctx, x, y, s, rng) {
  const k = rng();
  ctx.fillStyle = rgba("#1c2a12", 0.3);
  ctx.beginPath(); ctx.ellipse(x + 8 * s, y + 3, 24 * s, 9 * s, 0, 0, Math.PI * 2); ctx.fill();
  outlined(ctx, PAL.trunk, () => { ctx.moveTo(x - 4 * s, y); ctx.lineTo(x + 4 * s, y); ctx.lineTo(x + 3 * s, y - 20 * s); ctx.lineTo(x - 3 * s, y - 20 * s); ctx.closePath(); }, 1.2);
  ctx.fillStyle = PAL.trunkDark; ctx.fillRect(x + 0.5 * s, y - 20 * s, 2.5 * s, 20 * s);
  const cy = y - 30 * s;
  const blobs = [[0, 0, 22], [-14, 8, 15], [15, 7, 15], [-8, -12, 14], [10, -11, 13]];
  for (const [bx, by, br] of blobs) {
    outlined(ctx, k > 0.5 ? PAL.leaf : shade(PAL.leaf, -0.08), () => ctx.arc(x + bx * s, cy + by * s, br * s, 0, Math.PI * 2), 1.4);
  }
  /* shaded lower-right and lit upper-left */
  ctx.fillStyle = rgba("#1c3a18", 0.3);
  ctx.beginPath(); ctx.arc(x + 6 * s, cy + 10 * s, 20 * s, -0.4, Math.PI * 0.9); ctx.fill();
  ctx.fillStyle = rgba("#dfffa0", 0.32);
  ctx.beginPath(); ctx.arc(x - 8 * s, cy - 10 * s, 10 * s, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + 4 * s, cy - 14 * s, 6 * s, 0, Math.PI * 2); ctx.fill();
}

/* A bare northern oak: black limbs with snow along the upper side. */
function winterOak(ctx, x, y, s, rng) {
  ctx.fillStyle = rgba("#1a2436", 0.26);
  ctx.beginPath(); ctx.ellipse(x + 6 * s, y + 3, 20 * s, 8 * s, 0, 0, Math.PI * 2); ctx.fill();
  outlined(ctx, "#3a2c22", () => { ctx.moveTo(x - 4 * s, y); ctx.lineTo(x + 4 * s, y); ctx.lineTo(x + 2.6 * s, y - 22 * s); ctx.lineTo(x - 2.6 * s, y - 22 * s); ctx.closePath(); }, 1.2);
  const limb = (ang, len, wdt) => {
    const ex = x + Math.sin(ang) * len * s; const ey = y - 22 * s - Math.cos(ang) * len * s;
    ctx.strokeStyle = "#2e241c"; ctx.lineWidth = wdt * s; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(x, y - 20 * s); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.strokeStyle = rgba(FROST.snow, 0.85); ctx.lineWidth = wdt * 0.45 * s;
    ctx.beginPath(); ctx.moveTo(x - 1, y - 21 * s); ctx.lineTo(ex - 1, ey - 1.5 * s); ctx.stroke();
    /* one fork per limb */
    const fx = ex + Math.sin(ang + 0.5) * len * 0.45 * s; const fy = ey - Math.cos(ang + 0.5) * len * 0.45 * s;
    ctx.strokeStyle = "#2e241c"; ctx.lineWidth = wdt * 0.5 * s;
    ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(fx, fy); ctx.stroke();
  };
  const k = rng();
  limb(-0.9 - k * 0.1, 20, 4); limb(-0.35, 24, 4.4); limb(0.3 + k * 0.1, 22, 4); limb(0.85, 18, 3.4);
  ctx.lineCap = "butt";
}

export function drawPine(ctx, x, y, s) {
  ctx.fillStyle = rgba("#1c2a12", 0.3);
  ctx.beginPath(); ctx.ellipse(x + 6 * s, y + 3, 16 * s, 7 * s, 0, 0, Math.PI * 2); ctx.fill();
  outlined(ctx, PAL.trunk, () => ctx.rect(x - 2.5 * s, y - 14 * s, 5 * s, 14 * s), 1.1);
  const tiers = [[0, 16], [-16, 14], [-30, 12], [-42, 9]];
  for (const [ty, tw] of tiers) {
    outlined(ctx, "#3f6f36", () => { ctx.moveTo(x - tw * s, y - 12 * s + ty * s); ctx.lineTo(x, y - 28 * s + ty * s); ctx.lineTo(x + tw * s, y - 12 * s + ty * s); ctx.closePath(); }, 1.3);
    ctx.fillStyle = rgba("#000000", 0.18); ctx.beginPath(); ctx.moveTo(x, y - 12 * s + ty * s); ctx.lineTo(x, y - 28 * s + ty * s); ctx.lineTo(x + tw * s, y - 12 * s + ty * s); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = rgba("#dfffa0", 0.25); ctx.beginPath(); ctx.moveTo(x - 6 * s, y - 40 * s); ctx.lineTo(x, y - 52 * s); ctx.lineTo(x - 2 * s, y - 42 * s); ctx.closePath(); ctx.fill();
}

function drawBush(ctx, x, y, s, winter) {
  ctx.fillStyle = rgba(winter ? "#8fa0b4" : "#1c2a12", 0.22);
  ctx.beginPath(); ctx.ellipse(x + 3, y + 2, 12 * s, 5 * s, 0, 0, Math.PI * 2); ctx.fill();
  /* a bush in the north keeps its leaves but loses its summer green */
  const leaf = winter ? "#3f5c46" : "#4f8a38";
  for (const [bx, by, br] of [[0, -6, 9], [-8, -3, 7], [8, -3, 7]]) outlined(ctx, leaf, () => ctx.arc(x + bx * s, y + by * s, br * s, 0, Math.PI * 2), 1.1);
  ctx.fillStyle = rgba(winter ? "#e8f2fa" : "#dfffa0", winter ? 0.35 : 0.25); ctx.beginPath(); ctx.arc(x - 4 * s, y - 10 * s, 4 * s, 0, Math.PI * 2); ctx.fill();
}

function drawRock(ctx, x, y, s, rng) {
  ctx.fillStyle = rgba("#000000", 0.2);
  ctx.beginPath(); ctx.ellipse(x + 4 * s, y + 3, 16 * s, 6 * s, 0, 0, Math.PI * 2); ctx.fill();
  const r = rng();
  outlined(ctx, PAL.rock, () => { ctx.moveTo(x - 14 * s, y); ctx.lineTo(x - 10 * s, y - 12 * s); ctx.lineTo(x - 2 * s, y - 16 * s - r * 4); ctx.lineTo(x + 9 * s, y - 12 * s); ctx.lineTo(x + 14 * s, y - 2 * s); ctx.lineTo(x + 10 * s, y + 2 * s); ctx.lineTo(x - 10 * s, y + 2 * s); ctx.closePath(); }, 1.3);
  ctx.fillStyle = rgba("#000000", 0.2); ctx.beginPath(); ctx.moveTo(x - 2 * s, y - 16 * s - r * 4); ctx.lineTo(x + 9 * s, y - 12 * s); ctx.lineTo(x + 14 * s, y - 2 * s); ctx.lineTo(x + 10 * s, y + 2 * s); ctx.lineTo(x - 2 * s, y + 2 * s); ctx.closePath(); ctx.fill();
  ctx.fillStyle = rgba("#ffffff", 0.22); ctx.beginPath(); ctx.moveTo(x - 10 * s, y - 12 * s); ctx.lineTo(x - 2 * s, y - 16 * s - r * 4); ctx.lineTo(x - 4 * s, y - 10 * s); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#6f9a45"; ctx.beginPath(); ctx.ellipse(x - 12 * s, y + 1, 5 * s, 2 * s, 0, 0, Math.PI * 2); ctx.fill();
}

function drawTuft(ctx, x, y, s, color) {
  ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.lineCap = "round";
  for (let i = -1; i <= 1; i += 1) {
    ctx.beginPath(); ctx.moveTo(x + i * 2.4 * s, y); ctx.quadraticCurveTo(x + i * 4 * s, y - 4 * s, x + i * 5 * s, y - 8 * s); ctx.stroke();
  }
}

function drawFlower(ctx, x, y, color) {
  ctx.fillStyle = color;
  for (let i = 0; i < 4; i += 1) { const a = i * Math.PI / 2; ctx.beginPath(); ctx.arc(x + Math.cos(a) * 1.6, y + Math.sin(a) * 1.6, 1.4, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = "#f8e28a"; ctx.beginPath(); ctx.arc(x, y, 0.9, 0, Math.PI * 2); ctx.fill();
}

/* ------------------------------ the bake ------------------------------ */

function nearPath(pts, x, y, r) {
  const r2 = r * r;
  for (let i = 0; i < pts.length; i += 2) {
    const dx = pts[i].x - x; const dy = pts[i].y - y;
    if (dx * dx + dy * dy < r2) return true;
  }
  return false;
}

export function bakeTerrain(layout, stage, scale, quality = 1) {
  const { w, h } = layout;
  const pw = Math.ceil(w * scale); const ph = Math.ceil(h * scale);
  const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(pw, ph) : Object.assign(document.createElement("canvas"), { width: pw, height: ph });
  const ctx = canvas.getContext("2d");
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  const rng = mulberry(stage.number * 977 + (layout.name === "portrait" ? 31 : 7) + (stage.kingdom === "frost" ? 5000 : 0));
  const winter = stage.season === "winter";
  const P = SEASONS[winter ? "winter" : "summer"];

  /* helper: is (x,y) free of roads/plots/river/castle for decoration */
  const riverPts = layout.river ? sampleLine(layout.river) : [];
  const c = layout.castle;
  const clear = (x, y, margin = 0) => {
    for (const route of layout.routes) if (nearPath(route.pts, x, y, 58 + margin)) return false;
    for (const p of layout.plots) if ((p.x - x) ** 2 + (p.y - y) ** 2 < (64 + margin) ** 2) return false;
    if (riverPts.length && nearPath(riverPts, x, y, 44 + margin)) return false;
    if (x > c.x - 40 - margin && x < c.x + c.w + 40 + margin && y > c.y - 120 - margin && y < c.y + c.h + 50 + margin) return false;
    const hs = layout.heroSpawn; if ((hs.x - x) ** 2 + (hs.y - y) ** 2 < 70 ** 2) return false;
    for (const f of layout.fields || []) if (x > f.x - 24 - margin && x < f.x + f.w + 24 + margin && y > f.y - 30 - margin && y < f.y + f.h + 20 + margin) return false;
    for (const hh of layout.houses || []) if ((hh.x - x) ** 2 + (hh.y - y) ** 2 < 70 ** 2) return false;
    for (const f of layout.flags) if ((f.x - x) ** 2 + (f.y - y) ** 2 < 60 ** 2) return false;
    for (const cp of layout.camps || []) if ((cp.x - x) ** 2 + (cp.y - y) ** 2 < 110 ** 2) return false;
    for (const [a, b] of layout.outerWall ? layout.outerWall.segments : []) if (nearPath([a, b], x, y, 40)) return false;
    return true;
  };

  /* meadow */
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, P.grassLight); g.addColorStop(0.5, P.grass); g.addColorStop(1, P.grassDark);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  /* soft patches */
  for (let i = 0; i < 90; i += 1) {
    const x = rng() * w; const y = rng() * h; const r = 40 + rng() * 120;
    const pg = ctx.createRadialGradient(x, y, 0, x, y, r);
    const light = rng() > 0.5;
    /* snow shows every mark, so the north wants a fainter hand here:
       at summer strength the patches read as grey smudges on white */
    const strength = winter ? 0.45 : 1;
    pg.addColorStop(0, rgba(light ? P.patchLight : P.patchDark, (light ? 0.22 : 0.2) * strength)); pg.addColorStop(1, rgba("#000000", 0));
    ctx.fillStyle = pg; ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.6, rng() * Math.PI, 0, Math.PI * 2); ctx.fill();
  }
  /* fields */
  for (const f of layout.fields || []) {
    /* ploughed strips with wheat, a hedge on the top edge and hay bales */
    outlined(ctx, P.fieldEdge, () => ctx.rect(f.x, f.y, f.w, f.h), 1.2);
    for (let yy = f.y + 4; yy < f.y + f.h - 2; yy += 8) {
      ctx.fillStyle = (yy / 8) % 2 ? P.field : P.fieldDark;
      ctx.fillRect(f.x + 2, yy, f.w - 4, 5);
      ctx.strokeStyle = rgba(winter ? "#8ea6bd" : "#7a5a1e", 0.5); ctx.lineWidth = 1;
      for (let xx = f.x + 4; xx < f.x + f.w - 2; xx += 5) { ctx.beginPath(); ctx.moveTo(xx, yy + 5); ctx.lineTo(xx + 1, yy); ctx.stroke(); }
    }
    for (let xx = f.x - 2; xx < f.x + f.w + 2; xx += 12) drawBush(ctx, xx, f.y - 2, 0.55, winter);
    for (const [bx, by] of [[f.x + f.w - 18, f.y + f.h - 8], [f.x + f.w - 34, f.y + f.h - 6]]) {
      outlined(ctx, winter ? "#c9c6bb" : "#d9b95a", () => ctx.ellipse(bx, by, 9, 6, 0, 0, Math.PI * 2), 1.1);
      ctx.strokeStyle = winter ? "#9aa2ac" : "#a8863a"; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(bx, by, 5, 3.2, 0, 0, Math.PI * 2); ctx.stroke();
    }
  }
  /* grass tufts and flowers */
  const tufts = Math.floor(260 * quality);
  for (let i = 0; i < tufts; i += 1) {
    const x = rng() * w; const y = rng() * h;
    if (!clear(x, y, -30)) continue;
    if (rng() < 0.18) drawFlower(ctx, x, y, rng() < 0.5 ? P.flower[0] : P.flower[1]);
    else drawTuft(ctx, x, y, 0.7 + rng() * 0.8, rng() < 0.5 ? (winter ? "#c8d6e6" : PAL.grassLight) : (winter ? "#a9bcd2" : PAL.grassDark));
  }

  /* river */
  if (layout.river) {
    const pts = riverPts;
    strokePath(ctx, pts, 72, P.riverBank);
    strokePath(ctx, pts, 60, shade(P.riverBank, -0.2));
    strokePath(ctx, pts, 50, P.riverDeep);
    strokePath(ctx, pts, 40, P.river);
    strokePath(ctx, pts, 18, rgba(winter ? "#d7ecf4" : "#7fb6c8", 0.35));
    ctx.globalAlpha = 0.5; strokePath(ctx, pts.map((p, i) => ({ x: p.x + Math.sin(i * 0.7) * 5, y: p.y })), 1.6, P.riverFoam, [14, 22]); ctx.globalAlpha = 1;
    if (winter) {
      /* cracks and pressure ridges across the ice instead of foam */
      ctx.strokeStyle = rgba(FROST.iceLight, 0.7); ctx.lineWidth = 1.2;
      for (let i = 4; i < pts.length - 4; i += 9) {
        const a = pts[i]; const b = pts[Math.min(pts.length - 1, i + 4)];
        let nx = b.y - a.y; let ny = -(b.x - a.x); const l = Math.hypot(nx, ny) || 1;
        ctx.beginPath(); ctx.moveTo(a.x - (nx / l) * 16, a.y - (ny / l) * 16); ctx.lineTo(a.x + (nx / l) * 16, a.y + (ny / l) * 16); ctx.stroke();
      }
    }
    /* bank stones */
    for (let i = 0; i < pts.length; i += 6) {
      const p = pts[i]; const side = i % 12 ? 1 : -1;
      const nx = pts[Math.min(pts.length - 1, i + 1)].y - p.y; const ny = -(pts[Math.min(pts.length - 1, i + 1)].x - p.x);
      const l = Math.hypot(nx, ny) || 1;
      const sx = p.x + (nx / l) * 34 * side; const sy = p.y + (ny / l) * 34 * side;
      outlined(ctx, rng() < 0.5 ? PAL.rockLight : PAL.rock, () => ctx.ellipse(sx, sy, 4 + rng() * 3, 2.5 + rng() * 1.5, rng(), 0, Math.PI * 2), 0.9);
    }
  }

  /* roads */
  for (const route of layout.routes) {
    const pts = route.pts;
    const wm = route.width || 1;
    strokePath(ctx, pts, 76 * wm, P.roadEdge);
    strokePath(ctx, pts, 64 * wm, P.roadDark);
    strokePath(ctx, pts, 52 * wm, P.road);
    ctx.globalAlpha = 0.35; strokePath(ctx, pts, 22 * wm, shade(P.road, 0.12)); ctx.globalAlpha = 1;
    /* wheel ruts */
    ctx.globalAlpha = 0.28;
    for (const off of [-11 * wm, 11 * wm]) {
      const rut = pts.map((p, i) => {
        const q = pts[Math.min(pts.length - 1, i + 1)];
        let nx = q.y - p.y; let ny = -(q.x - p.x); const l = Math.hypot(nx, ny) || 1;
        return { x: p.x + (nx / l) * off, y: p.y + (ny / l) * off };
      });
      strokePath(ctx, rut, 2.2, P.roadEdge);
    }
    ctx.globalAlpha = 1;
    /* pebbles */
    for (let i = 0; i < pts.length; i += 4) {
      const p = pts[i];
      const px = p.x + (rng() - 0.5) * 40; const py = p.y + (rng() - 0.5) * 40;
      ctx.fillStyle = rng() < 0.5 ? P.pebble : P.roadEdge;
      ctx.beginPath(); ctx.ellipse(px, py, 1.6 + rng() * 1.6, 1 + rng(), 0, 0, Math.PI * 2); ctx.fill();
    }
    /* grass creeping over the edge */
    for (let i = 0; i < pts.length; i += 5) {
      const p = pts[i]; const q = pts[Math.min(pts.length - 1, i + 1)];
      let nx = q.y - p.y; let ny = -(q.x - p.x); const l = Math.hypot(nx, ny) || 1;
      const side = rng() < 0.5 ? 1 : -1;
      drawTuft(ctx, p.x + (nx / l) * 36 * side, p.y + (ny / l) * 36 * side, 0.9, winter ? "#a9bcd2" : PAL.grassDark);
    }
  }

  /* bridges */
  for (const b of layout.bridges || []) {
    /* a stone bridge along the road: packed-earth deck between two low parapets */
    ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.angle);
    ctx.fillStyle = rgba("#000000", 0.22); ctx.fillRect(-46, -30, 92, 66);
    outlined(ctx, PAL.stoneDark, () => ctx.rect(-46, -31, 92, 62), 1.4);
    ctx.fillStyle = P.road; ctx.fillRect(-46, -24, 92, 48);
    ctx.fillStyle = rgba("#000000", 0.1); ctx.fillRect(-46, 14, 92, 10);
    for (let i = 0; i < 26; i += 1) { ctx.fillStyle = i % 2 ? P.pebble : P.roadEdge; ctx.beginPath(); ctx.ellipse(-40 + (i * 37) % 84, -18 + (i * 23) % 40, 1.6, 1, 0, 0, Math.PI * 2); ctx.fill(); }
    for (const py of [-31, 24]) {
      outlined(ctx, PAL.stone, () => ctx.rect(-46, py, 92, 7), 1.2);
      ctx.strokeStyle = rgba("#000000", 0.16); ctx.lineWidth = 1;
      for (let xx = -40; xx < 46; xx += 9) { ctx.beginPath(); ctx.moveTo(xx, py); ctx.lineTo(xx, py + 7); ctx.stroke(); }
      outlined(ctx, PAL.stoneLight, () => ctx.rect(-46, py - 2, 92, 2.5), 1);
    }
    /* end posts */
    for (const px of [-46, 40]) for (const py of [-34, 22]) outlined(ctx, PAL.stoneLight, () => ctx.rect(px, py, 6, 11), 1);
    ctx.restore();
  }

  /* field walls: low dry-stone walls that funnel the road */
  for (const seg of layout.walls || []) {
    const [a, b] = seg;
    const dx = b.x - a.x; const dy = b.y - a.y; const L = Math.hypot(dx, dy);
    ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(Math.atan2(dy, dx));
    ctx.fillStyle = rgba("#000000", 0.22); ctx.fillRect(0, -6, L + 4, 22);
    outlined(ctx, PAL.stoneDark, () => ctx.rect(0, -8, L, 16), 1.3);
    ctx.fillStyle = rgba("#000000", 0.14); ctx.fillRect(0, 2, L, 6);
    outlined(ctx, PAL.stone, () => ctx.rect(0, -12, L, 6), 1);
    ctx.strokeStyle = rgba("#000000", 0.16); ctx.lineWidth = 1;
    for (let xx = 8; xx < L; xx += 11) { ctx.beginPath(); ctx.moveTo(xx, -8); ctx.lineTo(xx + 2, 8); ctx.stroke(); }
    for (let xx = 4; xx < L; xx += 14) outlined(ctx, PAL.stoneLight, () => ctx.rect(xx, -16, 6, 5), 0.9);
    ctx.restore();
  }

  /* cottages */
  for (const hh of layout.houses || []) {
    const x = hh.x; const y = hh.y;
    ctx.fillStyle = rgba("#000000", 0.2); ctx.beginPath(); ctx.ellipse(x + 4, y + 4, 34, 12, 0, 0, Math.PI * 2); ctx.fill();
    outlined(ctx, PAL.stoneDark, () => ctx.rect(x - 24, y - 12, 48, 14), 1.2);
    outlined(ctx, "#d9c9a3", () => ctx.rect(x - 22, y - 40, 44, 28), 1.3);
    ctx.strokeStyle = PAL.woodDark; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-22 + x, y - 40); ctx.lineTo(-22 + x, y - 12); ctx.moveTo(x, y - 40); ctx.lineTo(x, y - 12); ctx.moveTo(x + 22, y - 40); ctx.lineTo(x + 22, y - 12); ctx.moveTo(x - 22, y - 26); ctx.lineTo(x + 22, y - 26); ctx.stroke();
    outlined(ctx, PAL.gateWood, () => ctx.rect(x - 5, y - 26, 10, 14), 1);
    outlined(ctx, "#b89a4a", () => { ctx.moveTo(x - 28, y - 40); ctx.lineTo(x, y - 62); ctx.lineTo(x + 28, y - 40); ctx.closePath(); }, 1.3);
    ctx.fillStyle = rgba("#000000", 0.18); ctx.beginPath(); ctx.moveTo(x, y - 40); ctx.lineTo(x, y - 62); ctx.lineTo(x + 28, y - 40); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = rgba("#000000", 0.2); ctx.lineWidth = 1; for (let i = 1; i < 5; i += 1) { ctx.beginPath(); ctx.moveTo(x - 28 + i * 5, y - 40 - i * 4); ctx.lineTo(x + 28 - i * 5, y - 40 - i * 4); ctx.stroke(); }
    outlined(ctx, PAL.stoneDark, () => ctx.rect(x + 10, y - 60, 6, 12), 1);
  }

  /* Stage III siege ground: burnt patches, trenches, wreckage and the enemy camps */
  for (const sc of layout.scorched || []) drawScorch(ctx, sc.x, sc.y, rng);
  for (const [a, b] of layout.trenches || []) drawTrench(ctx, a, b);
  for (const wk of layout.wreckage || []) drawWreckage(ctx, wk.x, wk.y);
  for (const cp of layout.camps || []) drawSiegeCamp(ctx, cp.x, cp.y, rng);
  if (layout.outerWall) {
    /* the ground the wall stands on: a packed strip so the live wall sits well */
    for (const [a, b] of layout.outerWall.segments) {
      const dx = b.x - a.x; const dy = b.y - a.y; const L = Math.hypot(dx, dy);
      ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(Math.atan2(dy, dx));
      /* trodden earth in the south, trodden snow in the north: the warm
         strip read as a tan slab lying on white ground */
      const strip = ctx.createLinearGradient(0, -30, 0, 30);
      const band = winter ? "#a8b4c2" : "#8a7a58";
      strip.addColorStop(0, rgba(band, 0)); strip.addColorStop(0.5, rgba(band, winter ? 0.4 : 0.5)); strip.addColorStop(1, rgba(band, 0));
      ctx.fillStyle = strip; ctx.fillRect(-6, -30, L + 12, 60);
      ctx.restore();
    }
  }

  /* snowdrifts: pale banks across the road that slow everything crossing.
     On white ground a soft white blob is invisible, so each bank gets a
     shadowed lee side, a lit crest and a scalloped edge to read against
     the snow it is lying on. */
  for (const dr of layout.drifts || []) {
    ctx.save();
    /* the shadow the bank casts on the road, which is what the eye catches */
    const sh = ctx.createRadialGradient(dr.x, dr.y + dr.r * 0.22, dr.r * 0.2, dr.x, dr.y + dr.r * 0.22, dr.r * 1.02);
    sh.addColorStop(0, rgba("#7f95ad", 0.34)); sh.addColorStop(0.75, rgba("#7f95ad", 0.14)); sh.addColorStop(1, rgba("#7f95ad", 0));
    ctx.fillStyle = sh;
    ctx.beginPath(); ctx.ellipse(dr.x, dr.y + dr.r * 0.2, dr.r * 1.02, dr.r * 0.64, 0, 0, Math.PI * 2); ctx.fill();
    /* the bank itself */
    const g2 = ctx.createRadialGradient(dr.x, dr.y - dr.r * 0.16, dr.r * 0.15, dr.x, dr.y, dr.r);
    g2.addColorStop(0, "#ffffff"); g2.addColorStop(0.62, rgba(FROST.snow, 0.95)); g2.addColorStop(1, rgba(FROST.snow, 0.1));
    ctx.fillStyle = g2; ctx.beginPath(); ctx.ellipse(dr.x, dr.y, dr.r, dr.r * 0.62, 0, 0, Math.PI * 2); ctx.fill();
    /* a scalloped windward edge: drifts have a shape, glare does not */
    ctx.strokeStyle = rgba("#8fa8c0", 0.55); ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let a = Math.PI * 0.06; a <= Math.PI * 0.94; a += Math.PI * 0.055) {
      const rr = dr.r * (0.93 + Math.sin(a * 7) * 0.06);
      const px = dr.x + Math.cos(a) * rr; const py = dr.y + Math.sin(a) * rr * 0.62;
      if (a < Math.PI * 0.1) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    /* wind ridges, and the lit crest along the top */
    ctx.strokeStyle = rgba(FROST.snowDeep, 0.45); ctx.lineWidth = 1.3;
    for (let k = 0; k < 3; k += 1) {
      ctx.beginPath();
      ctx.ellipse(dr.x + (k - 1) * dr.r * 0.2, dr.y + (k - 1) * dr.r * 0.14, dr.r * (0.66 - k * 0.16), dr.r * (0.4 - k * 0.1), 0.2, Math.PI * 0.05, Math.PI * 0.95);
      ctx.stroke();
    }
    ctx.strokeStyle = rgba("#ffffff", 0.95); ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.ellipse(dr.x, dr.y - dr.r * 0.17, dr.r * 0.82, dr.r * 0.44, 0, Math.PI * 1.06, Math.PI * 1.94); ctx.stroke();
    ctx.restore();
  }

  /* castle apron: paved ground under and in front of the castle */
  outlined(ctx, P.apron, () => ctx.rect(c.x - 6, c.y - 6, c.w + 12, c.h + 12), 1);
  const ag = ctx.createRadialGradient(c.gate.x, c.gate.y + 40, 10, c.gate.x, c.gate.y + 40, 120);
  ag.addColorStop(0, rgba(P.road, 0.9)); ag.addColorStop(1, rgba(P.road, 0));
  ctx.fillStyle = ag; ctx.beginPath(); ctx.ellipse(c.gate.x, c.gate.y + 40, 120, 60, 0, 0, Math.PI * 2); ctx.fill();

  /* forests */
  const decor = [];
  for (const f of layout.forests || []) {
    const n = Math.round(f.n * (0.6 + quality * 0.4));
    let tries = 0;
    let placed = 0;
    while (placed < n && tries < n * 12) {
      tries += 1;
      const x = f.x + rng() * f.w; const y = f.y + rng() * f.h;
      if (x < 20 || x > w - 20 || y < 40 || y > h - 10) continue;
      if (!clear(x, y)) continue;
      if (decor.some((d) => (d.x - x) ** 2 + (d.y - y) ** 2 < 28 ** 2)) continue;
      decor.push({ x, y, kind: rng() < 0.28 ? "pine" : "oak", s: 0.75 + rng() * 0.6 });
      placed += 1;
    }
  }
  /* bushes scattered near forests */
  for (let i = 0; i < Math.floor(26 * quality); i += 1) {
    const x = rng() * w; const y = rng() * h;
    if (!clear(x, y, -10)) continue;
    if (decor.some((d) => (d.x - x) ** 2 + (d.y - y) ** 2 < 24 ** 2)) continue;
    decor.push({ x, y, kind: "bush", s: 0.7 + rng() * 0.6 });
  }
  for (const r of layout.rocks || []) decor.push({ x: r.x, y: r.y, kind: "rock", s: 0.8 + rng() * 0.5 });
  decor.sort((a, b) => a.y - b.y);
  for (const d of decor) {
    if (winter) {
      /* a northern forest: snow-laden pines and bare, frosted oaks */
      if (d.kind === "pine") frostPine(ctx, d.x, d.y, d.s);
      else if (d.kind === "oak") winterOak(ctx, d.x, d.y, d.s, rng);
      else if (d.kind === "bush") { drawBush(ctx, d.x, d.y, d.s, true); ctx.fillStyle = rgba(FROST.snow, 0.75); ctx.beginPath(); ctx.ellipse(d.x - 2 * d.s, d.y - 9 * d.s, 8 * d.s, 4 * d.s, 0, 0, Math.PI * 2); ctx.fill(); }
      else { drawRock(ctx, d.x, d.y, d.s, rng); ctx.fillStyle = rgba(FROST.snow, 0.8); ctx.beginPath(); ctx.ellipse(d.x - 1 * d.s, d.y - 7 * d.s, 7 * d.s, 3 * d.s, 0, 0, Math.PI * 2); ctx.fill(); }
    }
    else if (d.kind === "oak") drawOak(ctx, d.x, d.y, d.s, rng);
    else if (d.kind === "pine") drawPine(ctx, d.x, d.y, d.s);
    else if (d.kind === "bush") drawBush(ctx, d.x, d.y, d.s);
    else drawRock(ctx, d.x, d.y, d.s, rng);
  }

  /* build plots */
  for (const p of layout.plots) {
    ctx.save(); ctx.translate(p.x, p.y); drawPlot(ctx); ctx.restore();
  }

  /* entrance posts where the wave banners hang */
  for (const f of layout.flags) {
    ctx.fillStyle = rgba("#000000", 0.2); ctx.beginPath(); ctx.ellipse(f.x + 3, f.y + 2, 9, 4, 0, 0, Math.PI * 2); ctx.fill();
    outlined(ctx, PAL.woodDark, () => ctx.rect(f.x - 2.5, f.y - 70, 5, 70), 1.2);
    outlined(ctx, PAL.woodDark, () => ctx.rect(f.x - 2.5, f.y - 70, 22, 3), 1);
  }

  /* light and vignette */
  const lg = ctx.createRadialGradient(w * 0.3, h * 0.25, 40, w * 0.3, h * 0.25, Math.max(w, h) * 0.8);
  lg.addColorStop(0, stage.time === "dusk" ? rgba("#ffb070", 0.16) : P.light); lg.addColorStop(1, rgba("#000000", 0));
  ctx.fillStyle = lg; ctx.fillRect(0, 0, w, h);
  const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.45, w / 2, h / 2, Math.max(w, h) * 0.78);
  vg.addColorStop(0, rgba("#000000", 0)); vg.addColorStop(1, rgba(winter ? "#1a2436" : "#1a1408", 0.4));
  ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);

  return { canvas, w, h, scale };
}

function sampleLine(points) {
  const out = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]; const b = points[i + 1];
    const p0 = points[Math.max(0, i - 1)]; const p3 = points[Math.min(points.length - 1, i + 2)];
    const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 8));
    for (let k = 0; k < n; k += 1) {
      const t = k / n; const t2 = t * t; const t3 = t2 * t;
      out.push({
        x: 0.5 * ((2 * a.x) + (-p0.x + b.x) * t + (2 * p0.x - 5 * a.x + 4 * b.x - p3.x) * t2 + (-p0.x + 3 * a.x - 3 * b.x + p3.x) * t3),
        y: 0.5 * ((2 * a.y) + (-p0.y + b.y) * t + (2 * p0.y - 5 * a.y + 4 * b.y - p3.y) * t2 + (-p0.y + 3 * a.y - 3 * b.y + p3.y) * t3),
      });
    }
  }
  out.push(points[points.length - 1]);
  return out;
}
