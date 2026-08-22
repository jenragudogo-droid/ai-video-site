/* ------------------------------------------------------------------ *
 * HUD — drawn on a transparent 2D canvas above the WebGL view.
 * Position, lap, time, speed, nitro, coins, minimap, three power-up
 * slots, combo flashes and event toasts.
 * ------------------------------------------------------------------ */
import { POWERUPS } from "./data.js";

const fmtTime = (t) => {
  if (t == null) return "--:--.-";
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
};

export function makeHudState() {
  return { toasts: [], comboFlash: null, countdown: null, slotPress: [0, 0, 0] };
}

export function hudEvent(hud, e, race) {
  const push = (text, color = "#ffffff", big = false, t = 2.2) =>
    hud.toasts.push({ text, color, big, t, t0: t });
  switch (e.t) {
    case "count": hud.countdown = { n: e.n, t: 0.9 }; break;
    case "go": hud.countdown = { n: "GO!", t: 0.9 }; break;
    case "combo": hud.comboFlash = { name: e.name, t: 2.2, super: e.super }; break;
    case "comboFail": push("No combo — try another mix", "#c8ccd2", false, 1.4); break;
    case "lap": push(`LAP ${e.n}/${race.laps}`, "#ffd34d", true); break;
    case "trick": push(`TRICK ×${e.spins}!  +${e.spins * 5} coins`, "#57f2c8"); break;
    case "bigAir": push("BIG AIR!", "#8ee85a"); break;
    case "emblem": push("K-EMBLEM FOUND  +15", "#57f2c8", true); break;
    case "eliminated": push(e.who === "player" ? "ELIMINATED" : `${e.name} eliminated`, "#ff6b6b", e.who === "player"); break;
    case "checkpoint": push(`CHECKPOINT  +22s`, "#8ee85a", true, 1.6); break;
    case "outOfTime": push("OUT OF TIME", "#ff6b6b", true); break;
    case "shieldBreak": if (e.who === "player") push("Shield down!", "#4db8ff", false, 1.2); break;
    case "frozenHit": if (e.who === "player") push("FROZEN!", "#a8e8ff", true, 1.4); break;
    case "hit": if (e.who === "player") push("HIT!", "#ff6b6b", false, 1); break;
    case "nitro": push("NITRO!", "#ff8c2e", false, 0.8); break;
    case "rescue": push("Back on track", "#8ee85a", false, 1.4); break;
    case "taunt": push(`${e.name}: “${e.line}”`, "#c8b8e8", false, 2.6); break;
    default: break;
  }
}

export function drawHud(ctx, W, H, race, hud, dt, opts = {}) {
  ctx.clearRect(0, 0, W, H);
  const p = race.player;
  const small = W < 720;
  const pad = small ? 10 : 18;
  ctx.textBaseline = "middle";

  /* ---------- countdown ---------- */
  if (hud.countdown) {
    hud.countdown.t -= dt;
    if (hud.countdown.t <= 0) hud.countdown = null;
    else {
      const k = hud.countdown.t / 0.9;
      ctx.save();
      ctx.globalAlpha = Math.min(1, k * 2);
      ctx.fillStyle = hud.countdown.n === "GO!" ? "#57f2c8" : "#ffd34d";
      ctx.font = `900 ${Math.floor(H * 0.2 * (1.3 - k * 0.3))}px system-ui`;
      ctx.textAlign = "center";
      ctx.fillText(hud.countdown.n, W / 2, H * 0.4);
      ctx.restore();
    }
  }

  /* ---------- top-left: position + lap ---------- */
  ctx.textAlign = "left";
  const posSize = small ? 30 : 44;
  ctx.font = `900 ${posSize}px system-ui`;
  ctx.fillStyle = p.place === 1 ? "#ffd34d" : "#ffffff";
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.lineWidth = 4;
  const ordinal = ["1st", "2nd", "3rd", "4th", "5th", "6th"][p.place - 1] || `${p.place}th`;
  ctx.strokeText(ordinal, pad, pad + posSize / 2);
  ctx.fillText(ordinal, pad, pad + posSize / 2);
  ctx.font = `700 ${small ? 13 : 16}px system-ui`;
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillText(`of ${race.racers.length}`, pad + (small ? 58 : 92), pad + posSize / 2);
  const lapN = Math.max(1, Math.min(race.laps, p.body.lap + 1));
  ctx.fillText(race.mode === "timeTrial" ? `Lap ${lapN}/${race.laps} · Time Trial` : `Lap ${lapN}/${race.laps}`, pad, pad + posSize + 14);
  ctx.fillText(fmtTime(race.state === "finished" ? (p.finishTime || race.time) : race.time), pad, pad + posSize + 34);
  if (race.mode === "checkpoint") {
    ctx.fillStyle = race.cpTime < 6 ? "#ff6b6b" : "#8ee85a";
    ctx.fillText(`⏱ ${Math.max(0, race.cpTime).toFixed(1)}s to checkpoint`, pad, pad + posSize + 54);
  }
  if (race.mode === "elimination") {
    ctx.fillStyle = race.elimTimer < 6 ? "#ff6b6b" : "rgba(255,255,255,0.85)";
    ctx.fillText(`☠ elimination in ${Math.ceil(race.elimTimer)}s`, pad, pad + posSize + 54);
  }
  if (race.mode === "driftChallenge") {
    ctx.fillStyle = "#c86bff";
    ctx.fillText(`DRIFT ${Math.round(p.driftScore)}`, pad, pad + posSize + 54);
  }
  if (race.boss) {
    const boss = race.racers.find((r) => r.isBoss);
    if (boss) {
      ctx.fillStyle = "#ff6b6b";
      ctx.fillText(`${race.boss.name}  ${"◆".repeat(Math.max(0, boss.fx.shield))}${boss.finished ? " — FINISHED" : ""}`, pad, pad + posSize + 54);
    }
  }

  /* ---------- top-right: minimap ---------- */
  const mmSize = small ? 92 : 140;
  const mmX = W - mmSize - pad, mmY = pad;
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = "rgba(10,14,22,0.55)";
  ctx.beginPath();
  ctx.roundRect(mmX - 6, mmY - 6, mmSize + 12, mmSize + 12, 10);
  ctx.fill();
  const mm = race.track.minimap;
  const px2 = (pt) => [mmX + pt.x * mmSize, mmY + (1 - pt.y) * mmSize];
  ctx.strokeStyle = "rgba(255,255,255,0.75)";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  mm.main.forEach((pt, i) => { const [x, y] = px2(pt); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.closePath();
  ctx.stroke();
  const showShortcuts = race.player.driver.ability?.id === "pathfinder";
  ctx.strokeStyle = showShortcuts ? "rgba(87,242,200,0.95)" : "rgba(255,255,255,0.25)";
  ctx.lineWidth = 1.5;
  for (const line of mm.shortcuts) {
    ctx.beginPath();
    line.forEach((pt, i) => { const [x, y] = px2(pt); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
  }
  for (const r of race.racers) {
    const pt = mm.norm({ x: r.body.x, z: r.body.z });
    const [x, y] = px2(pt);
    ctx.fillStyle = r.isPlayer ? "#ffd34d" : r.isBoss ? "#ff4d6b" : "#7ab8ff";
    ctx.beginPath();
    ctx.arc(x, y, r.isPlayer ? 4 : 3, 0, 7);
    ctx.fill();
  }
  ctx.restore();

  /* ---------- bottom-right: speed + nitro ---------- */
  const kmh = Math.round(Math.abs(p.body.speed) * 3.6);
  ctx.textAlign = "right";
  ctx.font = `900 ${small ? 26 : 38}px system-ui`;
  ctx.fillStyle = p.fx.boostTime > 0 ? "#ff8c2e" : "#ffffff";
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  const speedY = H - pad - (small ? 64 : 30);
  ctx.strokeText(`${kmh}`, W - pad - (small ? 34 : 52), speedY);
  ctx.fillText(`${kmh}`, W - pad - (small ? 34 : 52), speedY);
  ctx.font = `700 ${small ? 11 : 13}px system-ui`;
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.fillText("km/h", W - pad, speedY);
  /* nitro bar */
  const nbW = small ? 90 : 140, nbH = 8;
  const nbX = W - pad - nbW, nbY = speedY + (small ? 20 : 26);
  ctx.fillStyle = "rgba(255,255,255,0.2)";
  ctx.beginPath(); ctx.roundRect(nbX, nbY, nbW, nbH, 4); ctx.fill();
  ctx.fillStyle = p.body.nitro > 0.85 ? "#ff8c2e" : "#e0a92e";
  ctx.beginPath(); ctx.roundRect(nbX, nbY, nbW * p.body.nitro, nbH, 4); ctx.fill();
  ctx.font = `600 10px system-ui`;
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.fillText(small ? "NITRO (drift)" : "NITRO — drift to charge, SHIFT to fire", W - pad, nbY + 18);

  /* ---------- bottom-left: coins ---------- */
  ctx.textAlign = "left";
  ctx.font = `800 ${small ? 16 : 20}px system-ui`;
  ctx.fillStyle = "#ffd34d";
  ctx.fillText(`● ${p.coins}`, pad, H - pad - (small ? 64 : 12));

  /* ---------- power-up slots (center-bottom) ---------- */
  const slotW = small ? 52 : 66;
  const gap = small ? 10 : 14;
  const totW = slotW * 3 + gap * 2;
  const sx = W / 2 - totW / 2, sy = H - pad - slotW - (small ? 56 : 0);
  for (let i = 0; i < 3; i++) {
    const x = sx + i * (slotW + gap);
    const item = p.slots[i];
    const press = hud.slotPress[i] > 0;
    hud.slotPress[i] = Math.max(0, hud.slotPress[i] - dt);
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = press ? "rgba(87,242,200,0.4)" : "rgba(10,14,22,0.6)";
    ctx.strokeStyle = item ? (POWERUPS[item]?.c || "#fff") : "rgba(255,255,255,0.25)";
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.roundRect(x, sy, slotW, slotW, 12); ctx.fill(); ctx.stroke();
    if (item) {
      ctx.font = `${slotW * 0.44}px system-ui`;
      ctx.textAlign = "center";
      ctx.fillText(POWERUPS[item].icon, x + slotW / 2, sy + slotW * 0.42);
      ctx.font = `600 ${small ? 8 : 10}px system-ui`;
      ctx.fillStyle = "#e8ecf2";
      ctx.fillText(POWERUPS[item].name, x + slotW / 2, sy + slotW * 0.82);
    }
    if (!small) {
      ctx.font = "700 11px system-ui";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillText(`${i + 1}`, x + slotW / 2, sy - 10);
    }
    ctx.restore();
  }
  if (!small) {
    ctx.font = "600 11px system-ui";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fillText("press two keys together to COMBINE", W / 2, sy + slotW + 14);
  }

  /* ---------- combo flash ---------- */
  if (hud.comboFlash) {
    hud.comboFlash.t -= dt;
    if (hud.comboFlash.t <= 0) hud.comboFlash = null;
    else {
      const c = hud.comboFlash;
      const k = Math.min(1, (2.2 - c.t) * 4);
      ctx.save();
      ctx.globalAlpha = Math.min(1, c.t);
      ctx.textAlign = "center";
      ctx.font = `900 ${Math.floor((small ? 26 : 40) * (1 + (1 - k) * 0.6))}px system-ui`;
      ctx.fillStyle = c.super ? "#ff5ad0" : "#57f2c8";
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.lineWidth = 5;
      const y = H * 0.28;
      ctx.strokeText(c.name, W / 2, y);
      ctx.fillText(c.name, W / 2, y);
      if (c.super) {
        ctx.font = `800 ${small ? 13 : 17}px system-ui`;
        ctx.fillStyle = "#ffd34d";
        ctx.fillText("★ SUPER COMBO ★", W / 2, y + (small ? 22 : 32));
      }
      ctx.restore();
    }
  }

  /* ---------- toasts ---------- */
  let ty = H * 0.36;
  for (let i = hud.toasts.length - 1; i >= 0; i--) {
    const t = hud.toasts[i];
    t.t -= dt;
    if (t.t <= 0) { hud.toasts.splice(i, 1); continue; }
  }
  for (const t of hud.toasts.slice(-4)) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, t.t * 2);
    ctx.textAlign = "center";
    ctx.font = `${t.big ? 900 : 700} ${t.big ? (small ? 22 : 30) : (small ? 14 : 17)}px system-ui`;
    ctx.strokeStyle = "rgba(0,0,0,0.65)";
    ctx.lineWidth = 4;
    ctx.fillStyle = t.color;
    ctx.strokeText(t.text, W / 2, ty);
    ctx.fillText(t.text, W / 2, ty);
    ctx.restore();
    ty += t.big ? (small ? 26 : 36) : (small ? 20 : 24);
  }

  /* ---------- effect vignettes ---------- */
  if (p.smokeT > 0) {
    ctx.fillStyle = `rgba(120,126,134,${Math.min(0.75, p.smokeT * 0.6)})`;
    ctx.fillRect(0, 0, W, H);
  }
  if (p.fx.frozen > 0) {
    ctx.fillStyle = `rgba(160,220,255,${Math.min(0.3, p.fx.frozen * 0.2)})`;
    ctx.fillRect(0, 0, W, H);
  }
  if (opts.wrongWay) {
    ctx.textAlign = "center";
    ctx.font = `900 ${small ? 22 : 32}px system-ui`;
    ctx.fillStyle = "#ff6b6b";
    ctx.fillText("WRONG WAY", W / 2, H * 0.2);
  }
}
