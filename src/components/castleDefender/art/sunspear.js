/* ------------------------------------------------------------------ *
 * Castle Defender — the Sunspear Reach teaser art.
 *
 * The counterweight to the Frozen North: red dunes, sandstone and a
 * hard white sun, painted in the same flat-fill-and-outline idiom as
 * the rest of the world. Nothing here is playable; it exists so the
 * locked card at the end of the north has something worth wanting.
 * ------------------------------------------------------------------ */

import { rgba, shade } from "./palette.js";

const OUT = "rgba(52, 26, 14, 0.6)";

export const SUN = {
  sky: "#e8a24a", skyHigh: "#c96f34", skyLow: "#f6d79a",
  sun: "#fff3d0",
  farDune: "#c2743c", dune: "#e0a05a", duneLit: "#f2c98a", duneShade: "#a85a2c",
  stone: "#d9b47a", stoneDark: "#a8814c", stoneLit: "#f0d9a8",
  palm: "#5c7a3a", palmDark: "#3e5626",
  banner: "#8c2f2a", bannerTrim: "#e8c25a",
  shadow: "rgba(96, 48, 22, 0.9)",
};

function outlined(ctx, fill, path, lw = 1.4) {
  ctx.beginPath(); path(); ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = OUT; ctx.lineWidth = lw; ctx.stroke();
}

/* a date palm: bare trunk, a crown of fronds */
function palm(ctx, x, y, s) {
  ctx.fillStyle = rgba("#6a3a1c", 0.25);
  ctx.beginPath(); ctx.ellipse(x + 6 * s, y + 2, 16 * s, 5 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = OUT; ctx.lineWidth = 5 * s;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 5 * s, y - 24 * s, x + 3 * s, y - 44 * s); ctx.stroke();
  ctx.strokeStyle = "#7a5230"; ctx.lineWidth = 3.2 * s;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 5 * s, y - 24 * s, x + 3 * s, y - 44 * s); ctx.stroke();
  for (let i = 0; i < 6; i += 1) {
    const a = -Math.PI / 2 + (i - 2.5) * 0.44;
    const ex = x + 3 * s + Math.cos(a) * 20 * s; const ey = y - 44 * s + Math.sin(a) * 14 * s;
    outlined(ctx, i % 2 ? SUN.palm : SUN.palmDark, () => {
      ctx.moveTo(x + 3 * s, y - 44 * s);
      ctx.quadraticCurveTo((x + 3 * s + ex) / 2, ey - 7 * s, ex, ey);
      ctx.quadraticCurveTo((x + 3 * s + ex) / 2, ey + 2 * s, x + 3 * s, y - 42 * s);
      ctx.closePath();
    }, 1);
  }
}

/* a sandstone bastion with a stepped tower and an open arch */
function bastion(ctx, x, y, s) {
  const w = 84 * s; const h = 52 * s;
  ctx.fillStyle = rgba("#6a3a1c", 0.3);
  ctx.beginPath(); ctx.ellipse(x + 6 * s, y + 3 * s, w * 0.72, 9 * s, 0, 0, Math.PI * 2); ctx.fill();
  outlined(ctx, SUN.stone, () => ctx.rect(x - w / 2, y - h * 0.6, w, h * 0.6), 1.4);
  ctx.fillStyle = rgba("#000000", 0.2); ctx.fillRect(x + w * 0.14, y - h * 0.6, w * 0.36, h * 0.6);
  ctx.fillStyle = rgba("#ffffff", 0.16); ctx.fillRect(x - w / 2 + 1, y - h * 0.6, w * 0.14, h * 0.6);
  /* stepped battlements */
  for (let bx = x - w / 2 + 3 * s; bx < x + w / 2 - 5 * s; bx += 12 * s) {
    outlined(ctx, SUN.stoneLit, () => { ctx.moveTo(bx, y - h * 0.6); ctx.lineTo(bx + 4 * s, y - h * 0.6 - 7 * s); ctx.lineTo(bx + 8 * s, y - h * 0.6); ctx.closePath(); }, 1);
  }
  /* the tower */
  outlined(ctx, shade(SUN.stone, 0.05), () => ctx.rect(x - w * 0.18, y - h, w * 0.36, h * 0.44), 1.4);
  ctx.fillStyle = rgba("#000000", 0.2); ctx.fillRect(x + w * 0.04, y - h, w * 0.14, h * 0.44);
  outlined(ctx, SUN.stoneLit, () => ctx.rect(x - w * 0.2, y - h - 4 * s, w * 0.4, 4.5 * s), 1.1);
  ctx.fillStyle = "#4a2a14";
  ctx.fillRect(x - w * 0.1, y - h * 0.9, 4 * s, 8 * s); ctx.fillRect(x + w * 0.04, y - h * 0.9, 4 * s, 8 * s);
  /* keyhole arch */
  outlined(ctx, "#3a1f0e", () => { ctx.moveTo(x - 8 * s, y); ctx.lineTo(x - 8 * s, y - h * 0.3); ctx.arc(x, y - h * 0.3, 8 * s, Math.PI, 0); ctx.lineTo(x + 8 * s, y); ctx.closePath(); }, 1.4);
  /* banner */
  ctx.strokeStyle = "#4a2a14"; ctx.lineWidth = 1.8 * s;
  ctx.beginPath(); ctx.moveTo(x - w * 0.18, y - h); ctx.lineTo(x - w * 0.18, y - h - 16 * s); ctx.stroke();
  outlined(ctx, SUN.banner, () => { ctx.moveTo(x - w * 0.18, y - h - 16 * s); ctx.lineTo(x - w * 0.18 + 16 * s, y - h - 13 * s); ctx.lineTo(x - w * 0.18 + 11 * s, y - h - 8 * s); ctx.lineTo(x - w * 0.18 + 16 * s, y - h - 3 * s); ctx.lineTo(x - w * 0.18, y - h - 4 * s); ctx.closePath(); }, 1.1);
  ctx.fillStyle = SUN.bannerTrim; ctx.beginPath(); ctx.arc(x - w * 0.18 + 8 * s, y - h - 9 * s, 2.2 * s, 0, Math.PI * 2); ctx.fill();
}

/* One painted panel of the Reach: sun, dunes, a bastion and palms. */
export function drawSunScene(ctx, w, h) {
  ctx.save();
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.72);
  sky.addColorStop(0, SUN.skyHigh); sky.addColorStop(0.55, SUN.sky); sky.addColorStop(1, SUN.skyLow);
  ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
  /* a hard white sun low over the dunes */
  const cx = w * 0.26; const cy = h * 0.34;
  const halo = ctx.createRadialGradient(cx, cy, 2, cx, cy, h * 0.62);
  halo.addColorStop(0, rgba(SUN.sun, 0.85)); halo.addColorStop(0.25, rgba(SUN.sun, 0.3)); halo.addColorStop(1, rgba(SUN.sun, 0));
  ctx.fillStyle = halo; ctx.fillRect(0, 0, w, h * 0.75);
  ctx.fillStyle = rgba(SUN.sun, 0.95); ctx.beginPath(); ctx.arc(cx, cy, h * 0.085, 0, Math.PI * 2); ctx.fill();
  /* heat shimmer bands */
  ctx.fillStyle = rgba("#ffffff", 0.07);
  for (let i = 0; i < 4; i += 1) ctx.fillRect(0, h * (0.42 + i * 0.05), w, h * 0.014);

  const dune = (baseY, pts, fill, litFill) => {
    ctx.beginPath();
    ctx.moveTo(-4, h + 4); ctx.lineTo(-4, baseY);
    for (let i = 0; i < pts.length; i += 1) {
      const [px, py] = pts[i];
      const [qx, qy] = pts[Math.min(pts.length - 1, i + 1)];
      ctx.quadraticCurveTo(px * w, py * h, ((px + qx) / 2) * w, ((py + qy) / 2) * h);
    }
    ctx.lineTo(w + 4, baseY); ctx.lineTo(w + 4, h + 4); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = OUT; ctx.lineWidth = 1.2; ctx.stroke();
    /* the sunlit crest */
    ctx.strokeStyle = litFill; ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 1) {
      const [px, py] = pts[i];
      const [qx, qy] = pts[Math.min(pts.length - 1, i + 1)];
      if (i === 0) ctx.moveTo(px * w, py * h - 1);
      ctx.quadraticCurveTo(px * w, py * h - 1, ((px + qx) / 2) * w, ((py + qy) / 2) * h - 1);
    }
    ctx.stroke();
  };
  dune(h * 0.56, [[0.05, 0.5], [0.24, 0.4], [0.45, 0.52], [0.66, 0.4], [0.86, 0.52], [1, 0.44]], SUN.farDune, rgba(SUN.duneLit, 0.5));
  dune(h * 0.7, [[0.04, 0.66], [0.22, 0.54], [0.44, 0.68], [0.68, 0.54], [0.9, 0.66], [1, 0.6]], SUN.dune, rgba(SUN.duneLit, 0.8));

  /* the near sand the bastion stands on */
  ctx.beginPath();
  ctx.moveTo(-4, h + 4); ctx.lineTo(-4, h * 0.74);
  ctx.quadraticCurveTo(w * 0.32, h * 0.69, w * 0.58, h * 0.75);
  ctx.quadraticCurveTo(w * 0.82, h * 0.8, w + 4, h * 0.72);
  ctx.lineTo(w + 4, h + 4); ctx.closePath();
  ctx.fillStyle = SUN.duneLit; ctx.fill();
  ctx.strokeStyle = OUT; ctx.lineWidth = 1.2; ctx.stroke();
  /* wind ripples */
  ctx.strokeStyle = rgba(SUN.duneShade, 0.45); ctx.lineWidth = 1.4;
  for (let i = 0; i < 5; i += 1) {
    const yy = h * (0.82 + i * 0.035);
    ctx.beginPath(); ctx.moveTo(w * 0.02, yy); ctx.quadraticCurveTo(w * 0.5, yy - h * 0.02, w * 0.98, yy); ctx.stroke();
  }

  const s = h / 150;
  bastion(ctx, w * 0.52, h * 0.76, s * 1.0);
  palm(ctx, w * 0.12, h * 0.82, s * 1.15);
  palm(ctx, w * 0.2, h * 0.87, s * 0.9);
  palm(ctx, w * 0.86, h * 0.8, s * 1.05);
  palm(ctx, w * 0.93, h * 0.86, s * 0.85);
  /* a caravan of two on the near crest */
  ctx.fillStyle = rgba("#4a2a14", 0.75);
  for (const [px, py, ps] of [[0.7, 0.79, 1], [0.75, 0.8, 0.85]]) {
    ctx.save(); ctx.translate(w * px, h * py); ctx.scale(ps * s * 0.5, ps * s * 0.5);
    ctx.beginPath(); ctx.ellipse(0, -14, 14, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(-9, -8, 3, 9); ctx.fillRect(6, -8, 3, 9);
    ctx.beginPath(); ctx.moveTo(10, -18); ctx.lineTo(18, -26); ctx.lineTo(21, -20); ctx.lineTo(13, -14); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  const haze = ctx.createLinearGradient(0, h * 0.3, 0, h * 0.75);
  haze.addColorStop(0, rgba("#ffe0a8", 0.22)); haze.addColorStop(1, rgba("#ffe0a8", 0));
  ctx.fillStyle = haze; ctx.fillRect(0, h * 0.3, w, h * 0.45);
  ctx.restore();
}

/* A sand wyrm breaching: only ever drawn as a silhouette. */
export function drawSandWyrm(ctx) {
  const dark = "#3a2416";
  ctx.save();
  /* the coil above the sand */
  outlined(ctx, dark, () => {
    ctx.moveTo(-46, 0);
    ctx.quadraticCurveTo(-40, -46, -8, -60);
    ctx.quadraticCurveTo(24, -74, 30, -46);
    ctx.quadraticCurveTo(34, -24, 16, -20);
    ctx.quadraticCurveTo(30, -34, 22, -48);
    ctx.quadraticCurveTo(12, -60, -6, -48);
    ctx.quadraticCurveTo(-24, -36, -26, 0);
    ctx.closePath();
  }, 1.5);
  /* the head, jaws open */
  outlined(ctx, dark, () => { ctx.moveTo(14, -58); ctx.lineTo(44, -74); ctx.lineTo(52, -62); ctx.lineTo(30, -52); ctx.closePath(); }, 1.4);
  outlined(ctx, dark, () => { ctx.moveTo(18, -50); ctx.lineTo(48, -50); ctx.lineTo(40, -40); ctx.lineTo(20, -44); ctx.closePath(); }, 1.3);
  /* plates along the back */
  for (let i = 0; i < 4; i += 1) {
    const t = i / 4;
    const px = -34 + t * 44; const py = -20 - Math.sin(t * Math.PI) * 40;
    outlined(ctx, dark, () => { ctx.moveTo(px, py); ctx.lineTo(px - 5, py - 12); ctx.lineTo(px + 5, py - 8); ctx.closePath(); }, 1.1);
  }
  /* the sand it threw up */
  ctx.fillStyle = dark;
  for (const [ex, ey, er] of [[-52, -6, 7], [40, -10, 6], [-16, -4, 5], [16, -6, 4]]) {
    ctx.beginPath(); ctx.ellipse(ex, ey, er, er * 0.55, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
