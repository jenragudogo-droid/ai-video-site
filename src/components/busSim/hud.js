/* ------------------------------------------------------------------ *
 * City Bus Simulator — heads-up display.
 *
 * Drawn straight onto the game canvas rather than in the DOM: the HUD
 * updates every frame, and 60 React renders a second would be a waste.
 * React only owns the menus and the touch buttons.
 * ------------------------------------------------------------------ */

import { roundRect, drawMinimap } from "./scene.js";
import { CAPACITY } from "./engine.js";
import { clamp } from "./city.js";

const GOLD = "#f5c518";
const INK = "rgba(9,13,18,0.78)";
const LINE = "rgba(255,255,255,0.14)";

function panel(ctx, x, y, w, h, r = 12) {
  ctx.fillStyle = INK;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function bar(ctx, x, y, w, h, v, color, track = "rgba(255,255,255,0.13)") {
  ctx.fillStyle = track;
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  const fill = Math.max(0, Math.min(1, v)) * w;
  if (fill > 1.5) {
    ctx.fillStyle = color;
    roundRect(ctx, x, y, fill, h, h / 2);
    ctx.fill();
  }
}

function fmtTime(s) {
  if (!isFinite(s)) return "--:--";
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${ss < 10 ? "0" : ""}${ss}`;
}

/* ------------------------------ speedometer ------------------------------ */

function speedo(ctx, state, cx, cy, R) {
  const bus = state.bus;
  const kmh = Math.abs(bus.speed) * 3.6;
  const start = Math.PI * 0.78;
  const sweep = Math.PI * 1.44;
  const maxK = 100;

  ctx.save();
  // dial face
  const g = ctx.createRadialGradient(cx, cy - R * 0.3, R * 0.1, cx, cy, R);
  g.addColorStop(0, "rgba(30,38,48,0.95)");
  g.addColorStop(1, "rgba(10,14,19,0.95)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // rpm arc
  ctx.strokeStyle = bus.rpm > 0.85 ? "#ff5a4d" : "rgba(245,197,24,0.85)";
  ctx.lineWidth = R * 0.075;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.88, start, start + sweep * clamp(bus.rpm, 0, 1));
  ctx.stroke();

  // ticks
  ctx.lineCap = "butt";
  for (let k = 0; k <= maxK; k += 10) {
    const a = start + sweep * (k / maxK);
    const major = k % 20 === 0;
    ctx.strokeStyle = major ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.32)";
    ctx.lineWidth = major ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * R * 0.72, cy + Math.sin(a) * R * 0.72);
    ctx.lineTo(cx + Math.cos(a) * R * (major ? 0.58 : 0.64), cy + Math.sin(a) * R * (major ? 0.58 : 0.64));
    ctx.stroke();
    if (major) {
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.font = `600 ${Math.round(R * 0.13)}px system-ui, sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(k), cx + Math.cos(a) * R * 0.46, cy + Math.sin(a) * R * 0.46);
    }
  }

  // needle
  const a = start + sweep * clamp(kmh / maxK, 0, 1.02);
  ctx.strokeStyle = "#ff6b52";
  ctx.lineWidth = R * 0.05;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx - Math.cos(a) * R * 0.12, cy - Math.sin(a) * R * 0.12);
  ctx.lineTo(cx + Math.cos(a) * R * 0.7, cy + Math.sin(a) * R * 0.7);
  ctx.stroke();
  ctx.fillStyle = "#1b2028";
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.1, 0, Math.PI * 2); ctx.fill();

  // digital readout
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#eaf0f6";
  ctx.font = `700 ${Math.round(R * 0.34)}px system-ui, sans-serif`;
  ctx.fillText(String(Math.round(kmh)), cx, cy + R * 0.34);
  ctx.fillStyle = "rgba(255,255,255,0.42)";
  ctx.font = `600 ${Math.round(R * 0.12)}px system-ui, sans-serif`;
  ctx.fillText("km/h", cx, cy + R * 0.55);

  // gear
  const gearColor = bus.gear === "R" ? "#ff8a5c" : bus.gear === "N" ? "#9aa5b1" : "#5ad07a";
  ctx.fillStyle = gearColor;
  ctx.font = `800 ${Math.round(R * 0.26)}px system-ui, sans-serif`;
  ctx.fillText(bus.gear, cx, cy - R * 0.4);
  ctx.restore();
}

/* ------------------------------- warnings ------------------------------- */

function tell(ctx, x, y, w, h, label, on, color) {
  ctx.fillStyle = on ? color : "rgba(255,255,255,0.07)";
  roundRect(ctx, x, y, w, h, 5);
  ctx.fill();
  ctx.fillStyle = on ? "#0d1218" : "rgba(255,255,255,0.32)";
  ctx.font = `700 ${Math.round(h * 0.52)}px system-ui, sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(label, x + w / 2, y + h / 2 + 0.5);
}

/* --------------------------------- draw --------------------------------- */

export function drawHud(ctx, state, W, H, view, t, fps) {
  const bus = state.bus;
  const small = W < 720;
  const pad = small ? 10 : 16;
  ctx.save();
  ctx.textBaseline = "alphabetic";

  /* ---- top-left: route ---- */
  const boxW = small ? Math.min(250, W * 0.5) : 290;
  const boxH = small ? 60 : 70;
  panel(ctx, pad, pad, boxW, boxH);
  const stop = state.activeStopId >= 0 ? state.city.stops[state.activeStopId] : null;
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = `600 ${small ? 9 : 10}px system-ui, sans-serif`;
  ctx.textAlign = "left";
  ctx.fillText(
    state.mode === "free"
      ? `FREE DRIVE · STOP ${state.routeIdx + 1}`
      : `NEXT STOP · ${state.routeIdx + 1} OF ${state.city.stops.length}`,
    pad + 12, pad + (small ? 18 : 21),
  );
  ctx.fillStyle = "#f2f5f9";
  ctx.font = `700 ${small ? 14 : 17}px system-ui, sans-serif`;
  ctx.fillText(
    stop ? stop.name : state.phase === "finished" ? "Route complete" : "Drive freely",
    pad + 12, pad + (small ? 36 : 43),
  );
  if (stop) {
    const d = Math.hypot(bus.x - stop.x, bus.z - stop.z);
    ctx.fillStyle = GOLD;
    ctx.font = `600 ${small ? 11 : 12}px system-ui, sans-serif`;
    ctx.fillText(`${Math.round(d)} m ahead`, pad + 12, pad + (small ? 52 : 60));
  }
  // route pips
  {
    const pipW = 5, gap = 3;
    const total = state.city.stops.length;
    const startX = pad + boxW - 12 - (total * (pipW + gap) - gap);
    for (let i = 0; i < total; i += 1) {
      ctx.fillStyle = i < state.routeIdx ? "#5ad07a" : i === state.routeIdx ? GOLD : "rgba(255,255,255,0.2)";
      roundRect(ctx, startX + i * (pipW + gap), pad + boxH - 16, pipW, 6, 3);
      ctx.fill();
    }
  }

  /* ---- top-centre: time + money ---- */
  if (!small) {
    const tw = 200;
    const tx = W / 2 - tw / 2;
    panel(ctx, tx, pad, tw, 44);
    ctx.textAlign = "center";
    ctx.fillStyle = state.timeLeft < 30 && state.mode === "route" ? "#ff6b52" : "#f2f5f9";
    ctx.font = "700 20px system-ui, sans-serif";
    ctx.fillText(fmtTime(state.timeLeft), tx + tw * 0.28, pad + 29);
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = "600 9px system-ui, sans-serif";
    ctx.fillText("TIME", tx + tw * 0.28, pad + 14);
    ctx.fillStyle = "#5ad07a";
    ctx.font = "700 18px system-ui, sans-serif";
    ctx.fillText(`₵${Math.round(state.money - state.penalties)}`, tx + tw * 0.72, pad + 29);
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = "600 9px system-ui, sans-serif";
    ctx.fillText("EARNINGS", tx + tw * 0.72, pad + 14);
  }

  /* ---- top-right: minimap ---- */
  const mapSize = small ? 96 : 148;
  drawMinimap(ctx, state, W - pad - mapSize, pad, mapSize);

  /* ---- right column: passengers, comfort, fuel ---- */
  const colW = small ? 118 : 168;
  const colX = W - pad - colW;
  const colY = pad + mapSize + 10;
  const colH = small ? 92 : 108;
  panel(ctx, colX, colY, colW, colH);
  ctx.textAlign = "left";
  ctx.font = `600 ${small ? 9 : 10}px system-ui, sans-serif`;

  const rows = [
    { label: "PASSENGERS", v: bus.onboard.length / CAPACITY, text: `${bus.onboard.length}/${CAPACITY}`, c: "#4ea3ff" },
    { label: "COMFORT", v: state.comfort / 100, text: `${Math.round(state.comfort)}%`, c: state.comfort > 60 ? "#5ad07a" : state.comfort > 30 ? GOLD : "#ff6b52" },
    { label: "FUEL", v: bus.fuel, text: `${Math.round(bus.fuel * 100)}%`, c: bus.fuel > 0.25 ? "#7ac6e8" : "#ff6b52" },
    { label: "DAMAGE", v: bus.damage / 100, text: `${Math.round(bus.damage)}%`, c: bus.damage < 40 ? "#8b96a3" : "#ff6b52" },
  ];
  rows.forEach((row, i) => {
    const y = colY + 16 + i * (small ? 20 : 24);
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.font = `600 ${small ? 8 : 9}px system-ui, sans-serif`;
    ctx.fillText(row.label, colX + 12, y);
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillText(row.text, colX + colW - 12, y);
    ctx.textAlign = "left";
    bar(ctx, colX + 12, y + 4, colW - 24, small ? 4 : 5, row.v, row.c);
  });

  /* ---- bottom-left: instruments ---- */
  const R = small ? Math.min(W, H) * 0.115 : Math.min(W, H) * 0.105;
  const sx = view === "cockpit" ? W * 0.68 : pad + R + 6;
  const sy = view === "cockpit" ? H - R - (small ? 20 : 34) : H - R - pad - 6;
  speedo(ctx, state, sx, sy, R);

  /* ---- tell-tales ---- */
  const tw2 = small ? 30 : 38;
  const th = small ? 17 : 20;
  const blink = Math.sin(t * 8) > 0;
  /* In the cockpit the tell-tales live on the dash beside the cluster —
     above it they would either float on the glass or clip the dial. */
  let tx0;
  let ty;
  if (view === "cockpit") {
    ty = sy - th / 2;
    tx0 = Math.max(pad, sx - R - 18 - (tw2 * 4 + 18));
  } else {
    ty = sy - R - th - 8;
    tx0 = sx - (tw2 * 2 + 6) / 2 - tw2 - 6;
  }
  tell(ctx, tx0, ty, tw2, th, "◄", bus.indicator === "left" && blink, "#4ade5a");
  tell(ctx, tx0 + (tw2 + 6), ty, tw2, th, "DOOR", bus.doorT > 0.02, "#ff9a1f");
  tell(ctx, tx0 + (tw2 + 6) * 2, ty, tw2, th, "P", bus.handbrake, "#ff5a4d");
  tell(ctx, tx0 + (tw2 + 6) * 3, ty, tw2, th, "►", bus.indicator === "right" && blink, "#4ade5a");

  /* ---- boarding progress ---- */
  if (state.phase === "boarding" && stop) {
    const bw = small ? 200 : 280;
    const bx = W / 2 - bw / 2;
    const by = H * 0.62;
    panel(ctx, bx, by, bw, 52);
    ctx.textAlign = "center";
    ctx.fillStyle = GOLD;
    ctx.font = `700 ${small ? 12 : 14}px system-ui, sans-serif`;
    ctx.fillText(stop.served ? "All aboard" : "Boarding…", bx + bw / 2, by + 21);
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = `600 ${small ? 10 : 11}px system-ui, sans-serif`;
    ctx.fillText(
      stop.served ? "Close the doors to move on" : `${stop.waiting.length} waiting`,
      bx + bw / 2, by + 39,
    );
  }

  /* ---- message toast ---- */
  if (state.message) {
    const m = state.message;
    const col = m.tone === "bad" ? "#ff6b52" : m.tone === "warn" ? GOLD : m.tone === "good" ? "#5ad07a" : "#dfe7ef";
    ctx.textAlign = "center";
    ctx.font = `700 ${small ? 13 : 16}px system-ui, sans-serif`;
    const w = ctx.measureText(m.text).width + 34;
    const y = H * (view === "cockpit" ? 0.52 : 0.78);
    ctx.globalAlpha = clamp(state.messageT * 1.6, 0, 1);
    panel(ctx, W / 2 - w / 2, y - 18, w, 36, 18);
    ctx.fillStyle = col;
    ctx.fillText(m.text, W / 2, y + 6);
    ctx.globalAlpha = 1;
  }

  /* ---- speed-limit nudge ---- */
  if (Math.abs(bus.speed) * 3.6 > 62) {
    ctx.textAlign = "center";
    ctx.fillStyle = "#ff6b52";
    ctx.font = `700 ${small ? 11 : 13}px system-ui, sans-serif`;
    ctx.fillText("SLOW DOWN", sx, sy - R - 10);
  }

  if (fps) {
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    ctx.font = "600 10px system-ui, sans-serif";
    ctx.fillText(`${fps} fps`, pad + 4, H - 8);
  }

  ctx.restore();
}
