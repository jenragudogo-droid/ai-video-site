/* ------------------------------------------------------------------ *
 * City Bus Simulator — frame composition.
 *
 * Ties the renderer to the simulation: places the camera, pushes the
 * world geometry, then paints the cockpit, the route markers and the
 * mini-map over the top in plain 2D.
 * ------------------------------------------------------------------ */

import {
  drawSky, drawClouds, drawRoads, drawBuildings, drawProps, drawStops,
  drawCar, drawPed, drawTrafficLight, drawBus, drawShadow, BUS, LAYER_GUIDE,
} from "./render.js";
import { BLOCK, GRID, ROAD_HALF, CITY_SPAN, clamp, lerp } from "./city.js";

export const VIEWS = ["cockpit", "chase", "top"];

/* ------------------------------- camera ------------------------------- */

const camState = { x: 0, z: 0, yaw: 0, init: false };

export function resetCamera() { camState.init = false; }

export function placeCamera(r, state, view, dt, shakeSeed) {
  const bus = state.bus;
  const s = Math.sin(bus.yaw), c = Math.cos(bus.yaw);
  const shake = bus.shake;
  const jitter = shake > 0.01 ? shake * 0.35 : 0;

  if (view === "cockpit") {
    // driver sits front-left (Ghana drives on the right)
    const fwd = BUS.len / 2 - 2.4;
    const side = -0.78;
    r.cam.x = bus.x + s * fwd + c * side;
    r.cam.z = bus.z + c * fwd - s * side;
    r.cam.y = 2.28 + Math.sin(shakeSeed * 37) * jitter * 0.4;
    r.cam.yaw = bus.yaw + Math.sin(shakeSeed * 23) * jitter * 0.03;
    r.cam.pitch = -0.055 + Math.sin(shakeSeed * 41) * jitter * 0.02;
    r.cam.fov = 1.18;
    r.cam.roll = -bus.lateralG * 0.035 * Math.sign(bus.steerAngle || 1);
  } else if (view === "chase") {
    const back = 15.5, up = 6.6;
    const tx = bus.x - s * back;
    const tz = bus.z - c * back;
    const k = 1 - Math.pow(0.0009, dt);
    if (!camState.init) {
      camState.init = true;
      camState.x = tx; camState.z = tz; camState.yaw = bus.yaw;
    } else {
      camState.x = lerp(camState.x, tx, k);
      camState.z = lerp(camState.z, tz, k);
      let dy = bus.yaw - camState.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      camState.yaw += dy * k;
    }
    r.cam.x = camState.x;
    r.cam.z = camState.z;
    r.cam.y = up + jitter * 0.3;
    r.cam.yaw = camState.yaw;
    r.cam.pitch = -0.19;
    r.cam.fov = 1.12;
    r.cam.roll = 0;
  } else {
    // high enough to clear the tallest roofs, otherwise walls splay out
    // over the streets and the map becomes unreadable
    r.cam.x = bus.x - s * 6;
    r.cam.z = bus.z - c * 6;
    r.cam.y = 74;
    r.cam.yaw = bus.yaw;
    r.cam.pitch = -1.02;
    r.cam.fov = 1.14;
    r.cam.roll = 0;
  }
}

/* ---------------------------- route chevrons ---------------------------- */

function drawGuide(r, state, t) {
  const g = state.guide;
  if (!g || g.length < 2) return;
  for (let i = 0; i < g.length - 1; i += 1) {
    const [x, z] = g[i];
    if (!r.visible(x, z, 4)) continue;
    const d = r.depthOf(x, z);
    if (d > 130) continue;
    const [nx, nz] = g[i + 1];
    const dx = nx - x, dz = nz - z;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len, uz = dz / len;
    const px = uz, pz = -ux;                     // perpendicular
    const wave = (Math.sin(t * 3 - i * 0.55) + 1) / 2;
    const alpha = (0.2 + wave * 0.5) * clamp(1 - d / 130, 0, 1);
    const half = 1.5, back = 1.9, tip = 1.9;
    r.quad(
      [x + ux * tip, 0.035, z + uz * tip],
      [x + px * half - ux * back * 0.1, 0.035, z + pz * half - uz * back * 0.1],
      [x - ux * back * 0.55, 0.035, z - uz * back * 0.55],
      [x - px * half - ux * back * 0.1, 0.035, z - pz * half - uz * back * 0.1],
      "#ffd24d", { alpha, layer: LAYER_GUIDE },
    );
  }
}

/* ------------------------------ the world ------------------------------ */

export function drawWorld(ctx, r, state, view, t) {
  const { city, bus } = state;
  const W = r.width, H = r.height;

  r.setFog(state.dusk ? "#3a3a4d" : "#b9cbdd");
  drawSky(ctx, r, W, H, state.dusk);
  drawClouds(ctx, r, W, t, state.dusk);

  r.beginFrame();
  drawRoads(r);
  drawGuide(r, state, t);
  drawStops(r, city.stops, state.activeStopId, t);
  drawBuildings(r, city.buildings);
  drawProps(r, city.props, state.dusk);

  for (let i = 0; i < city.lights.length; i += 1) {
    const l = city.lights[i];
    if (r.visible(l.x, l.z, 16)) drawTrafficLight(r, l, t);
  }

  for (let i = 0; i < state.cars.length; i += 1) {
    const c = state.cars[i];
    if (!r.visible(c.x, c.z, 5)) continue;
    drawShadow(r, c.x, c.z, c.w * 1.15, c.l * 1.1, c.yaw, 0.24);
    drawCar(r, c);
  }
  for (let i = 0; i < state.peds.length; i += 1) drawPed(r, state.peds[i]);

  // waiting passengers at the active stop
  const stop = state.activeStopId >= 0 ? city.stops[state.activeStopId] : null;
  if (stop && r.visible(stop.shelterX, stop.shelterZ, 12)) {
    const n = Math.min(6, stop.waiting.length);
    for (let i = 0; i < n; i += 1) {
      const off = (i - (n - 1) / 2) * 1.05;
      const px = stop.shelterX + (stop.vertical ? 0.6 : off);
      const pz = stop.shelterZ + (stop.vertical ? off : 0.6);
      drawPed(r, {
        x: px, z: pz, yaw: stop.heading + Math.PI, phase: t * 2 + i,
        shirt: ["#e05b4a", "#3f7fd0", "#f2c14e", "#5cae72", "#b06cc4", "#2f9fb5"][i % 6],
        trouser: "#2f3640", skin: ["#8d5524", "#c68642", "#5c3a21"][i % 3],
      });
    }
  }

  if (view !== "cockpit") {
    drawShadow(r, bus.x, bus.z, BUS.wid * 1.25, BUS.len * 1.05, bus.yaw, 0.34);
    drawBus(r, bus, t);
  }

  ctx.save();
  if (r.cam.roll) {
    ctx.translate(W / 2, H / 2);
    ctx.rotate(r.cam.roll);
    ctx.translate(-W / 2, -H / 2);
  }
  r.paint(ctx);
  ctx.restore();

  if (state.dusk) {
    // One multiply pass dims the whole scene at once — fog alone only
    // touches distant geometry, which leaves nearby walls looking
    // brightly lit at sunset.
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = "#8288b4";
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    // headlights wash the road back in
    const hy = r.horizonY();
    const g = ctx.createRadialGradient(W / 2, H * 0.78, 8, W / 2, H * 0.78, H * 0.8);
    g.addColorStop(0, "rgba(255,244,208,0.30)");
    g.addColorStop(0.45, "rgba(255,240,200,0.11)");
    g.addColorStop(1, "rgba(255,240,200,0)");
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = g;
    ctx.fillRect(0, Math.max(0, hy - 20), W, H);
    ctx.restore();
  }
}

/* ------------------------------- cockpit ------------------------------- */

export function drawCockpit(ctx, state, W, H) {
  const bus = state.bus;
  const dashTop = H * 0.70;
  const bodyDark = "#1b1f26";

  ctx.save();

  // A-pillars and roof lining
  ctx.fillStyle = bodyDark;
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(W, 0); ctx.lineTo(W, H * 0.075);
  ctx.quadraticCurveTo(W / 2, H * 0.135, 0, H * 0.075);
  ctx.closePath(); ctx.fill();

  ctx.beginPath();                                   // left pillar
  ctx.moveTo(0, 0); ctx.lineTo(W * 0.085, 0);
  ctx.lineTo(W * 0.045, dashTop); ctx.lineTo(0, dashTop);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();                                   // right pillar
  ctx.moveTo(W, 0); ctx.lineTo(W * 0.915, 0);
  ctx.lineTo(W * 0.955, dashTop); ctx.lineTo(W, dashTop);
  ctx.closePath(); ctx.fill();

  // dashboard
  const g = ctx.createLinearGradient(0, dashTop - 20, 0, H);
  g.addColorStop(0, "#2b313a");
  g.addColorStop(0.18, "#20252c");
  g.addColorStop(1, "#12151a");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, dashTop + H * 0.045);
  ctx.quadraticCurveTo(W * 0.5, dashTop - H * 0.055, W, dashTop + H * 0.045);
  ctx.lineTo(W, H); ctx.lineTo(0, H);
  ctx.closePath(); ctx.fill();

  // windscreen lower trim highlight
  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, dashTop + H * 0.045);
  ctx.quadraticCurveTo(W * 0.5, dashTop - H * 0.055, W, dashTop + H * 0.045);
  ctx.stroke();

  // steering wheel (driver front-left)
  const wx = W * 0.28;
  const wy = H * 0.965;
  const wr = Math.min(W, H) * 0.19;
  ctx.save();
  ctx.translate(wx, wy);
  ctx.rotate(bus.steer * 2.4);
  ctx.strokeStyle = "#0d1015";
  ctx.lineWidth = wr * 0.19;
  ctx.beginPath(); ctx.arc(0, 0, wr, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = "#2c333d";
  ctx.lineWidth = wr * 0.13;
  ctx.beginPath(); ctx.arc(0, 0, wr, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = wr * 0.14;
  ctx.strokeStyle = "#232931";
  for (const a of [Math.PI * 0.18, Math.PI * 0.82, Math.PI * 1.5]) {
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * wr * 0.92, Math.sin(a) * wr * 0.92);
    ctx.stroke();
  }
  ctx.fillStyle = "#171c22";
  ctx.beginPath(); ctx.arc(0, 0, wr * 0.28, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = bus.livery;
  ctx.font = `700 ${Math.round(wr * 0.22)}px system-ui, sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("MTL", 0, 0);
  ctx.restore();

  // mirrors
  drawMirror(ctx, W * 0.035, H * 0.30, W * 0.075, H * 0.16, state, -1);
  drawMirror(ctx, W * 0.89, H * 0.30, W * 0.075, H * 0.16, state, 1);

  // grab rail across the windscreen base
  ctx.strokeStyle = "rgba(230,190,90,0.25)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(W * 0.05, dashTop + H * 0.032);
  ctx.quadraticCurveTo(W * 0.5, dashTop - H * 0.05, W * 0.95, dashTop + H * 0.032);
  ctx.stroke();

  ctx.restore();
}

function drawMirror(ctx, x, y, w, h, state, side) {
  ctx.save();
  ctx.fillStyle = "#14181e";
  roundRect(ctx, x - 3, y - 3, w + 6, h + 6, 6);
  ctx.fill();
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, state.dusk ? "#26303f" : "#6d8093");
  g.addColorStop(0.55, state.dusk ? "#1b2230" : "#8fa2b3");
  g.addColorStop(0.56, state.dusk ? "#2b2b30" : "#5d6156");
  g.addColorStop(1, state.dusk ? "#1a1a1f" : "#4a4d45");
  ctx.fillStyle = g;
  roundRect(ctx, x, y, w, h, 4);
  ctx.fill();
  // a hint of the bus flank in the mirror
  ctx.fillStyle = state.bus.livery;
  ctx.globalAlpha = 0.85;
  if (side < 0) ctx.fillRect(x + w * 0.62, y + h * 0.3, w * 0.38, h * 0.42);
  else ctx.fillRect(x, y + h * 0.3, w * 0.38, h * 0.42);
  ctx.globalAlpha = 1;
  ctx.restore();
}

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/* ------------------------------ world markers ------------------------------ */

export function drawStopMarker(ctx, r, state, W, H) {
  if (state.activeStopId < 0) return;
  const s = state.city.stops[state.activeStopId];
  const p = r.project(s.shelterX, 6.4, s.shelterZ);
  const dist = Math.hypot(state.bus.x - s.x, state.bus.z - s.z);
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  if (p && p.x > -60 && p.x < W + 60) {
    const scale = clamp(1 - p.d / 260, 0.42, 1);
    const y = clamp(p.y, 60, H - 160);
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = "rgba(12,16,22,0.72)";
    const label = `${s.name}  ·  ${Math.round(dist)}m`;
    ctx.font = `600 ${Math.round(13 * scale + 3)}px system-ui, sans-serif`;
    const tw = ctx.measureText(label).width + 26;
    roundRect(ctx, p.x - tw / 2, y - 15, tw, 30, 15);
    ctx.fill();
    ctx.strokeStyle = "rgba(245,197,24,0.65)";
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.fillStyle = "#ffd84d";
    ctx.fillText(label, p.x, y + 1);
    // little pin below
    ctx.beginPath();
    ctx.moveTo(p.x, y + 15); ctx.lineTo(p.x - 6, y + 26); ctx.lineTo(p.x + 6, y + 26);
    ctx.closePath(); ctx.fillStyle = "rgba(12,16,22,0.72)"; ctx.fill();
  } else {
    // off-screen: point to it from the edge
    const dx = s.x - r.cam.x, dz = s.z - r.cam.z;
    const rel = Math.atan2(dx, dz) - r.cam.yaw;
    const side = Math.sin(rel) > 0 ? 1 : -1;
    const x = side > 0 ? W - 54 : 54;
    const y = H * 0.42;
    ctx.translate(x, y);
    ctx.rotate(side > 0 ? 0 : Math.PI);
    ctx.fillStyle = "rgba(245,197,24,0.9)";
    ctx.beginPath();
    ctx.moveTo(18, 0); ctx.lineTo(-10, -14); ctx.lineTo(-10, 14);
    ctx.closePath(); ctx.fill();
    ctx.rotate(side > 0 ? 0 : -Math.PI);
    ctx.fillStyle = "#ffd84d";
    ctx.font = "600 12px system-ui, sans-serif";
    ctx.fillText(`${Math.round(dist)}m`, 0, 26);
  }
  ctx.restore();
}

/* -------------------------------- minimap -------------------------------- */

export function drawMinimap(ctx, state, x, y, size) {
  const { city, bus } = state;
  const pad = 6;
  const inner = size - pad * 2;
  const scale = inner / (CITY_SPAN + BLOCK * 0.5);
  const ox = x + pad + BLOCK * 0.25 * scale;
  const oy = y + pad + BLOCK * 0.25 * scale;
  const px = (wx) => ox + wx * scale;
  const py = (wz) => oy + (CITY_SPAN - wz) * scale;

  ctx.save();
  ctx.fillStyle = "rgba(9,13,18,0.82)";
  roundRect(ctx, x, y, size, size, 12);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.save();
  roundRect(ctx, x, y, size, size, 12);
  ctx.clip();

  ctx.strokeStyle = "rgba(150,168,186,0.36)";
  ctx.lineWidth = Math.max(1.6, ROAD_HALF * 2 * scale);
  ctx.beginPath();
  for (let i = 0; i <= GRID; i += 1) {
    ctx.moveTo(px(i * BLOCK), py(0)); ctx.lineTo(px(i * BLOCK), py(CITY_SPAN));
    ctx.moveTo(px(0), py(i * BLOCK)); ctx.lineTo(px(CITY_SPAN), py(i * BLOCK));
  }
  ctx.stroke();

  // route line
  if (state.guide && state.guide.length > 1) {
    ctx.strokeStyle = "rgba(245,197,24,0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px(bus.x), py(bus.z));
    for (const [gx, gz] of state.guide) ctx.lineTo(px(gx), py(gz));
    ctx.stroke();
  }

  // traffic
  ctx.fillStyle = "rgba(220,228,238,0.55)";
  for (const c of state.cars) ctx.fillRect(px(c.x) - 1, py(c.z) - 1, 2.4, 2.4);

  // stops
  for (const s of city.stops) {
    const active = s.id === state.activeStopId;
    const done = s.served;
    ctx.beginPath();
    ctx.arc(px(s.x), py(s.z), active ? 4.6 : 3, 0, Math.PI * 2);
    ctx.fillStyle = active ? "#ffd84d" : done ? "rgba(80,200,120,0.8)" : "rgba(255,255,255,0.42)";
    ctx.fill();
    if (active) {
      ctx.strokeStyle = "rgba(255,216,77,0.5)";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(px(s.x), py(s.z), 8 + Math.sin(state.t * 4) * 2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // the bus
  ctx.save();
  ctx.translate(px(bus.x), py(bus.z));
  ctx.rotate(-bus.yaw);
  ctx.fillStyle = "#4ea3ff";
  ctx.beginPath();
  ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3.4); ctx.lineTo(-5, 6);
  ctx.closePath(); ctx.fill();
  ctx.restore();

  ctx.restore();
  ctx.restore();
}
