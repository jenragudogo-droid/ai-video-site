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
import {
  POWER_ICON, POWER_LABEL, POWER_TIME, POWER_COLOUR,
  ATTACK_TIME, ATTACK_CD, chunksIn,
} from "./engine.js";
import { START_SPEED, TOP_SPEED } from "./track.js";

/* The pills are drawn in this order rather than in whatever order they
   were picked up, so a power-up never moves once it is on screen. The
   two that change how you move sit at the top. */
const POWER_ORDER = ["jetpack", "superJump", "boost", "shield", "double", "magnet"];

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

/* Is there anything worth swinging at? Used only to decide whether to
   show the attack chip, so it looks a good way ahead — the point is to
   tell the player the button exists *before* the enemy is on top of
   them, not to confirm it once they are. */
function enemyAhead(s) {
  for (const c of chunksIn(s, s.z - 2, s.z + 30)) {
    for (const e of c.enemies) {
      if (e.state === "down") continue;
      if (e.z < s.z - 1 || e.z > s.z + 30) continue;
      return true;
    }
  }
  return false;
}

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
  for (const key of POWER_ORDER) {
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

  /* ------------------------- attack readiness ------------------------- */

  /* Only shown when it matters: an enemy is close enough to hit, or the
     last swing has not recovered yet. A permanent "you can punch" chip
     would be noise for the ninety per cent of a run with nothing to
     punch. It sits under the power pills, in the same column, so it
     never collides with anything however many pills are up. */
  const enemyNear = enemyAhead(s);
  if (enemyNear || s.attackCd > 0) {
    const h = 24 * u;
    const w = 118 * u;
    const cooling = s.attackCd > 0;
    /* Cooldown runs from ATTACK_TIME + ATTACK_CD down to zero; the bar
       fills as it recovers rather than draining, because it is showing
       readiness, not time left. */
    const ready = cooling ? 1 - s.attackCd / (ATTACK_TIME + ATTACK_CD) : 1;
    const colour = cooling ? "#8b93a0" : "#ff6a4d";

    panel(ctx, pad, py, w, h, 7 * u, 0.5);
    ctx.fillStyle = rgba(colour, cooling ? 0.12 : 0.22);
    roundRect(ctx, pad, py, w, h, 7 * u);
    ctx.fill();
    ctx.fillStyle = colour;
    roundRect(ctx, pad + 2 * u, py + h - 4 * u, (w - 4 * u) * clamp(ready, 0, 1), 2.4 * u, 1.4 * u);
    ctx.fill();
    shadowText(ctx, opts.coarse ? "👊  TAP FIGHT" : "👊  PRESS A", pad + 10 * u, py + h * 0.62,
      `700 ${11 * u}px ${FONT}`, cooling ? "rgba(246,242,233,0.55)" : "#f6f2e9");
  }

  /* --------------------------- jetpack fuel --------------------------- */

  /* Given its own meter, low and central, rather than a pill in the
     corner: while flying it is the only number that decides anything,
     and the player's eyes are on the middle of the screen. */
  if (s.powers.jetpack > 0) {
    const frac = clamp(s.powers.jetpack / POWER_TIME.jetpack, 0, 1);
    const w = Math.min(W * 0.46, 250 * u);
    const h = 9 * u;
    const x = (W - w) / 2;
    const y = H - 54 * u;
    const low = frac < 0.28;

    ctx.fillStyle = "rgba(8,10,15,0.5)";
    roundRect(ctx, x - 2 * u, y - 2 * u, w + 4 * u, h + 4 * u, (h + 4 * u) / 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // flashes below a quarter, which is roughly one rooftop of flying left
    ctx.globalAlpha = low ? 0.5 + 0.5 * Math.abs(Math.sin(s.t * 8)) : 1;
    const fg = ctx.createLinearGradient(x, 0, x + w, 0);
    fg.addColorStop(0, low ? "#ff4d4d" : "#ff5d7a");
    fg.addColorStop(1, low ? "#ff8a3d" : "#ffb0c4");
    ctx.fillStyle = fg;
    roundRect(ctx, x, y, Math.max(3 * u, w * frac), h, h / 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    /* The one thing a first-time flier needs told: the pack will happily
       carry you straight over the roof you were aiming for, and down is
       how you get onto it. */
    const cue = low ? " — LANDING SOON"
      : s.surfaceY > 1 ? (opts.coarse ? " — SWIPE DOWN TO LAND" : " — ↓ TO LAND")
        : "";
    shadowText(ctx, `🚀 FUEL${cue}`, W / 2, y - 7 * u,
      `700 ${9.5 * u}px ${FONT}`, low ? "#ffb3a0" : "rgba(246,242,233,0.8)", "center");
  }

  /* ------------------------------ combo ------------------------------ */

  /* Sits above the runner, where the fight is. The ring is the combo
     window closing — when it shuts the chain resets to a punch. */
  if (s.combo > 0 && s.comboT > 0) {
    const cx = W / 2;
    const cy = H * 0.3;
    const r = 26 * u;
    const frac = clamp(s.comboT / 0.85, 0, 1);
    /* A finished chain (three hits) pops rather than fading, so landing
       the finisher feels different from merely landing a hit. */
    const pop = s.combo >= 3 ? 1 + (1 - frac) * 0.12 : 1;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(pop, pop);
    ctx.globalAlpha = clamp(frac * 2.2, 0, 1);

    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(8,10,15,0.5)";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
    ctx.strokeStyle = s.combo >= 3 ? "#ffd45c" : "#ff6a4d";
    ctx.lineWidth = 3 * u;
    ctx.lineCap = "round";
    ctx.stroke();

    shadowText(ctx, `×${s.combo}`, 0, 6 * u,
      `700 ${21 * u}px ${FONT}`, s.combo >= 3 ? "#ffd45c" : "#f6f2e9", "center");
    shadowText(ctx, s.combo >= 3 ? "FINISHER" : "COMBO", 0, r + 13 * u,
      `700 ${8.5 * u}px ${FONT}`, "rgba(246,242,233,0.7)", "center");
    ctx.restore();
    ctx.globalAlpha = 1;
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
