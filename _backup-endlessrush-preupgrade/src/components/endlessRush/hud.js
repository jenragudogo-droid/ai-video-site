/* ------------------------------------------------------------------ *
 * Kianimation Endless Rush — the in-game HUD.
 *
 * Painted straight onto the canvas rather than laid out in the DOM, for
 * two reasons: it costs nothing to keep in sync with the frame it
 * describes, and a score that updates sixty times a second in React
 * would re-render the whole component tree sixty times a second.
 *
 * Everything is sized from one unit derived from the smaller screen
 * dimension, so the same code reads correctly on a phone held upright
 * and on a desktop window three times as wide.
 * ------------------------------------------------------------------ */

import { clamp, rgba } from "./render.js";
import { POWER_ICON, POWER_LABEL, POWER_TIME } from "./engine.js";
import { START_SPEED, TOP_SPEED } from "./track.js";

const POWER_COLOUR = {
  magnet: "#9e62ff",
  shield: "#5ad1ff",
  double: "#f4b965",
  boost: "#ff8a3d",
};

const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function panel(ctx, x, y, w, h, r, alpha) {
  ctx.fillStyle = `rgba(8,10,15,${alpha ?? 0.42})`;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function shadowText(ctx, text, x, y, font, fill, align) {
  ctx.font = font;
  ctx.textAlign = align || "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillText(text, x, y + 1.5);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

const group = (n) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

export function drawHud(ctx, s, W, H, opts) {
  const u = clamp(Math.min(W, H) / 430, 0.68, 1.45);
  const pad = 14 * u;
  const best = opts.best || 0;
  const score = Math.floor(s.score);

  ctx.save();

  /* ------------------------- screen-wide effects ------------------------- */

  if (s.powers.boost > 0) {
    // radial streaks; cheap, and it sells the surge better than any HUD text
    const cxp = W * 0.5, cyp = H * 0.52;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = rgba("#ffc46a", 0.16);
    ctx.lineWidth = Math.max(1, 1.6 * u);
    for (let i = 0; i < 16; i += 1) {
      const a = (i / 16) * Math.PI * 2 + s.t * 1.4;
      const r0 = Math.min(W, H) * (0.34 + ((s.t * 1.6 + i * 0.13) % 1) * 0.3);
      const r1 = r0 + Math.min(W, H) * 0.16;
      ctx.beginPath();
      ctx.moveTo(cxp + Math.cos(a) * r0, cyp + Math.sin(a) * r0);
      ctx.lineTo(cxp + Math.cos(a) * r1, cyp + Math.sin(a) * r1);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (s.stumble > 0) {
    // only a real knock flashes red; invulnerability on its own is good news
    const k = (s.stumble / 0.62) * 0.5;
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.28,
      W / 2, H / 2, Math.max(W, H) * 0.62);
    g.addColorStop(0, "rgba(255,90,60,0)");
    g.addColorStop(1, `rgba(255,70,45,${clamp(k, 0, 0.5)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  /* vignette — keeps the HUD readable over a bright sky */
  const vg = ctx.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.34,
    W / 2, H * 0.5, Math.max(W, H) * 0.78);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.36)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  /* ------------------------------ score ------------------------------ */

  const scoreW = Math.max(126 * u, ctx.measureText(group(score)).width + 60 * u);
  panel(ctx, pad, pad, scoreW, 52 * u, 10 * u, 0.44);
  shadowText(ctx, "SCORE", pad + 12 * u, pad + 17 * u,
    `600 ${9.5 * u}px ${FONT}`, "rgba(255,255,255,0.58)");
  shadowText(ctx, group(score), pad + 12 * u, pad + 42 * u,
    `700 ${25 * u}px ${FONT}`, "#f6f2e9");

  /* -------------------------- coins + distance -------------------------- */

  const rowY = pad + 60 * u;
  const chipH = 26 * u;

  // coins
  const coinTxt = group(s.coins);
  ctx.font = `700 ${13 * u}px ${FONT}`;
  const coinW = ctx.measureText(coinTxt).width + 40 * u;
  panel(ctx, pad, rowY, coinW, chipH, 8 * u, 0.42);
  ctx.beginPath();
  ctx.fillStyle = "#f7c948";
  ctx.ellipse(pad + 16 * u, rowY + chipH / 2, 6.5 * u, 8 * u, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath();
  ctx.ellipse(pad + 16 * u, rowY + chipH / 2, 2.6 * u, 4.4 * u, 0, 0, Math.PI * 2);
  ctx.fill();
  shadowText(ctx, coinTxt, pad + 29 * u, rowY + chipH * 0.68,
    `700 ${13 * u}px ${FONT}`, "#f6f2e9");

  // distance
  const distTxt = `${group(Math.floor(s.dist))} m`;
  ctx.font = `600 ${12.5 * u}px ${FONT}`;
  const distW = ctx.measureText(distTxt).width + 22 * u;
  panel(ctx, pad + coinW + 7 * u, rowY, distW, chipH, 8 * u, 0.42);
  shadowText(ctx, distTxt, pad + coinW + 18 * u, rowY + chipH * 0.68,
    `600 ${12.5 * u}px ${FONT}`, "rgba(246,242,233,0.86)");

  /* ------------------------------ power-ups ------------------------------ */

  let py = rowY + chipH + 8 * u;
  for (const key of ["boost", "shield", "double", "magnet"]) {
    const left = s.powers[key];
    if (left <= 0) continue;
    const colour = POWER_COLOUR[key];
    const label = `${POWER_ICON[key]}  ${POWER_LABEL[key]}`;
    ctx.font = `700 ${11 * u}px ${FONT}`;
    const w = Math.max(118 * u, ctx.measureText(label).width + 22 * u);
    const h = 24 * u;

    // flash when nearly out, so it is never a surprise when it ends
    const dying = left < 2 ? 0.45 + 0.55 * Math.abs(Math.sin(s.t * 9)) : 1;
    ctx.globalAlpha = dying;
    panel(ctx, pad, py, w, h, 7 * u, 0.5);
    ctx.fillStyle = rgba(colour, 0.2);
    roundRect(ctx, pad, py, w, h, 7 * u);
    ctx.fill();

    // remaining-time bar along the bottom edge
    const frac = clamp(left / (POWER_TIME[key] || 1), 0, 1);
    ctx.fillStyle = colour;
    roundRect(ctx, pad + 2 * u, py + h - 4 * u, (w - 4 * u) * frac, 2.4 * u, 1.4 * u);
    ctx.fill();

    shadowText(ctx, label, pad + 10 * u, py + h * 0.62,
      `700 ${11 * u}px ${FONT}`, "#f6f2e9");
    ctx.globalAlpha = 1;
    py += h + 5 * u;
  }

  /* ------------------------- right column: best ------------------------- */

  const rightTop = pad + (opts.quickBarHeight || 40 * u);
  const bestTxt = group(best);
  ctx.font = `700 ${15 * u}px ${FONT}`;
  const bestW = Math.max(96 * u, ctx.measureText(bestTxt).width + 54 * u);
  panel(ctx, W - pad - bestW, rightTop, bestW, 40 * u, 9 * u, 0.4);
  shadowText(ctx, "BEST", W - pad - 12 * u, rightTop + 15 * u,
    `600 ${9 * u}px ${FONT}`, "rgba(255,255,255,0.55)", "right");
  shadowText(ctx, bestTxt, W - pad - 12 * u, rightTop + 33 * u,
    `700 ${15 * u}px ${FONT}`, score > best ? "#7ee08a" : "#f6f2e9", "right");

  /* --------------------------- speed indicator --------------------------- */

  const sp = clamp((s.speed - START_SPEED) / (TOP_SPEED - START_SPEED), 0, 1);
  const barW = Math.min(W * 0.3, 150 * u);
  const barX = W - pad - barW;
  const barY = rightTop + 48 * u;
  ctx.fillStyle = "rgba(8,10,15,0.42)";
  roundRect(ctx, barX, barY, barW, 6 * u, 3 * u);
  ctx.fill();
  const spg = ctx.createLinearGradient(barX, 0, barX + barW, 0);
  spg.addColorStop(0, "#6fd08a");
  spg.addColorStop(0.6, "#f4b965");
  spg.addColorStop(1, "#ff6a4d");
  ctx.fillStyle = spg;
  roundRect(ctx, barX, barY, Math.max(4 * u, barW * sp), 6 * u, 3 * u);
  ctx.fill();
  shadowText(ctx, `${Math.round(s.speed * 3.6)} km/h`, W - pad, barY + 20 * u,
    `600 ${9.5 * u}px ${FONT}`, "rgba(246,242,233,0.66)", "right");

  /* ----------------------------- zone toast ----------------------------- */

  if (opts.toast && opts.toastAge < 3.4) {
    const k = opts.toastAge < 0.45
      ? opts.toastAge / 0.45
      : opts.toastAge > 2.7 ? 1 - (opts.toastAge - 2.7) / 0.7 : 1;
    /* On a narrow screen the right-hand column reaches most of the way to
       the middle, so the banner is pushed below the speed read-out rather
       than being allowed to run straight through it. */
    const toastY = Math.max(H * 0.17, barY + 34 * u);
    ctx.globalAlpha = clamp(k, 0, 1);
    shadowText(ctx, "NOW ENTERING", W / 2, toastY,
      `600 ${9.5 * u}px ${FONT}`, "rgba(255,255,255,0.6)", "center");
    shadowText(ctx, opts.toast.toUpperCase(), W / 2, toastY + 24 * u,
      `700 ${19 * u}px ${FONT}`, "#f4b965", "center");
    ctx.globalAlpha = 1;
  }

  /* --------------------------- controls prompt --------------------------- */

  if (opts.hint) {
    ctx.globalAlpha = clamp(opts.hintAlpha ?? 1, 0, 1);
    shadowText(ctx, opts.hint, W / 2, H - 22 * u,
      `600 ${11.5 * u}px ${FONT}`, "rgba(246,242,233,0.72)", "center");
    ctx.globalAlpha = 1;
  }

  if (opts.fps) {
    shadowText(ctx, `${opts.fps} fps`, pad, H - 10 * u,
      `500 ${9 * u}px ${FONT}`, "rgba(255,255,255,0.3)");
  }

  ctx.restore();
}
