/* ------------------------------------------------------------------ *
 * City Bus Simulator — frame composition.
 *
 * Ties the renderer to the simulation: places the camera, pushes the
 * world geometry, then paints the cockpit, the route markers and the
 * mini-map over the top in plain 2D.
 * ------------------------------------------------------------------ */

import {
  drawSky, drawClouds, drawTerrain, drawRoads, drawScenery, drawStreetProps,
  drawStops, drawCar, drawPed, drawTrafficLight, drawBus, drawShadow,
  skyFor, BUS, LAYER_GUIDE,
} from "./render.js";
import {
  GRID, LX, LZ, REGION, CELL_REGION,
  roadHeightAt, groundHeightAt, vClass, hClass, clamp, lerp,
} from "./city.js";
import { stopCrowd, pedLook } from "./people.js";

export const VIEWS = ["cockpit", "chase", "top"];

/* ------------------------------- camera ------------------------------- */

const OPENNESS = {
  city: 0.6, town: 0.72, suburb: 0.78, airport: 0.9,
  country: 1, forest: 0.8, mountain: 1, coast: 1,
};

const camState = { x: 0, z: 0, y: 0, yaw: 0, init: false };

/* Reused every frame: the people the model layer is offered, and the
   scratch the stop queue is laid out into. */
const folk = [];
const crowd = [];
/* Only reached if a passenger model failed to load and the boxes stand in. */
const SKIN_FALLBACK = ["#8d5524", "#c68642", "#5c3a21"];

export function resetCamera() { camState.init = false; }

export function placeCamera(r, state, view, dt, shakeSeed) {
  const bus = state.bus;
  const s = Math.sin(bus.yaw), c = Math.cos(bus.yaw);
  const shake = bus.shake;
  const jitter = shake > 0.01 ? shake * 0.35 : 0;
  const pitchLean = bus.pitch || 0;

  if (view === "cockpit") {
    // driver sits front-left (Ghana drives on the right)
    const fwd = BUS.len / 2 - 2.4;
    const side = -0.78;
    r.cam.x = bus.x + s * fwd + c * side;
    r.cam.z = bus.z + c * fwd - s * side;
    r.cam.y = bus.y + 2.28 + fwd * Math.sin(pitchLean) + Math.sin(shakeSeed * 37) * jitter * 0.4;
    r.cam.yaw = bus.yaw + Math.sin(shakeSeed * 23) * jitter * 0.03;
    r.cam.pitch = -0.055 + pitchLean * 0.85 + Math.sin(shakeSeed * 41) * jitter * 0.02;
    r.cam.fov = 1.18;
    // the driver leans with the body, so the horizon tips with it
    r.cam.roll = (bus.roll || 0) * 0.8;
  } else if (view === "chase") {
    const back = 15.5, up = 6.6;
    const tx = bus.x - s * back;
    const tz = bus.z - c * back;
    // never let a hill behind the bus swallow the camera
    const ty = Math.max(bus.y + up, groundHeightAt(tx, tz) + 3.4);
    /* Three separate lags. The old camera used one very short constant for
       everything, which bolted it to the bus: it snapped round with every
       steering input instead of swinging, and that stiffness was reading
       as the *bus* moving unnaturally rather than the camera. */
    const kPos = 1 - Math.pow(0.02, dt);      // ~0.26s, follows the body
    const kUp = 1 - Math.pow(0.05, dt);       // ~0.33s, soaks up crests
    const kYaw = 1 - Math.pow(0.11, dt);      // ~0.45s, swings round corners
    if (!camState.init) {
      camState.init = true;
      camState.x = tx; camState.z = tz; camState.y = ty; camState.yaw = bus.yaw;
    } else {
      camState.x = lerp(camState.x, tx, kPos);
      camState.z = lerp(camState.z, tz, kPos);
      camState.y = lerp(camState.y, ty, kUp);
      /* Aim at a point in front of the bus instead of copying its heading.
         A real chase shot pivots to keep the vehicle framed, so the camera
         leads into a corner and trails out of it by itself. */
      const want = Math.atan2(
        bus.x + s * 9 - camState.x,
        bus.z + c * 9 - camState.z,
      );
      let dy = want - camState.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      camState.yaw += dy * kYaw;
    }
    r.cam.x = camState.x;
    r.cam.z = camState.z;
    r.cam.y = camState.y + jitter * 0.3;
    r.cam.yaw = camState.yaw;
    // look slightly down the hill the bus is on rather than at the sky
    r.cam.pitch = clamp(-0.19 + pitchLean * 0.5, -0.5, 0.06);
    r.cam.fov = 1.12;
    r.cam.roll = (bus.roll || 0) * 0.35;
  } else {
    // high enough to clear the tallest roofs and ridges, otherwise walls
    // splay out over the streets and the map becomes unreadable
    r.cam.x = bus.x - s * 6;
    r.cam.z = bus.z - c * 6;
    r.cam.y = bus.y + 86;
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
    if (d > 150) continue;
    const [nx, nz] = g[i + 1];
    const dx = nx - x, dz = nz - z;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len, uz = dz / len;
    const px = uz, pz = -ux;                     // perpendicular
    const y = roadHeightAt(x, z) + 0.07;
    const wave = (Math.sin(t * 3 - i * 0.55) + 1) / 2;
    const alpha = (0.2 + wave * 0.5) * clamp(1 - d / 150, 0, 1);
    const half = 1.5, back = 1.9, tip = 1.9;
    r.quad(
      [x + ux * tip, y, z + uz * tip],
      [x + px * half - ux * back * 0.1, y, z + pz * half - uz * back * 0.1],
      [x - ux * back * 0.55, y, z - uz * back * 0.55],
      [x - px * half - ux * back * 0.1, y, z - pz * half - uz * back * 0.1],
      "#ffd24d", { alpha, layer: LAYER_GUIDE },
    );
  }
}

/* ------------------------------ the world ------------------------------ */

export function drawWorld(ctx, r, state, view, t, vehicles, quality = 1) {
  const { city, bus } = state;
  const W = r.width, H = r.height;
  const reg = REGION[state.region];
  const tunnel = state.tunnel || 0;
  const q = clamp(quality, 0.6, 1);
  const low = !!(vehicles && vehicles.lowQuality) || q < 0.86;

  /* Downtown you cannot see 300m in any direction anyway — the buildings
     are in the way — so the city buys its frame rate back by not drawing
     what the skyline already hides. Open country keeps the long view. */
  r.setDrawDist((low ? 250 : 320) * (OPENNESS[reg.key] || 1) * q);
  const sky = skyFor(state.dusk);
  r.setFog(state.dusk ? sky.fog : blendFog(sky.fog, reg.key));
  drawSky(ctx, r, W, H, state.dusk, reg.ground);
  if (tunnel < 0.9) drawClouds(ctx, r, W, t, state.dusk);

  r.beginFrame();
  drawTerrain(r, low);
  drawRoads(r);
  drawGuide(r, state, t);
  drawStops(r, city.stops, state.activeStopId, t);
  drawScenery(r, city, state.dusk);
  drawStreetProps(r, city, state.dusk);

  for (let i = 0; i < city.lights.length; i += 1) {
    const l = city.lights[i];
    if (r.visible(l.x, l.z, 16)) drawTrafficLight(r, l, t);
  }

  /* Everybody the glTF layer might draw, gathered in one list: the queue
     at the stop ahead first, since that is what the player pulls up to and
     looks straight at, then whoever is walking nearby. */
  folk.length = 0;
  const stop = state.activeStopId >= 0 ? city.stops[state.activeStopId] : null;
  if (stop && r.visible(stop.shelterX, stop.shelterZ, 16)) {
    stopCrowd(stop, stop.waiting.length, crowd);
    for (let i = 0; i < crowd.length; i += 1) folk.push(crowd[i]);
  }
  /* Any other stop close enough to read also gets its queue. An empty
     shelter passed at 40m says nobody in this city catches the bus. */
  for (let i = 0; i < city.stops.length; i += 1) {
    const s = city.stops[i];
    if (s === stop || s.served) continue;
    if (r.depthOf(s.shelterX, s.shelterZ) > 90) continue;
    if (!r.visible(s.shelterX, s.shelterZ, 16)) continue;
    stopCrowd(s, Math.min(4, s.waiting.length), crowd);
    for (let k = 0; k < crowd.length; k += 1) folk.push(crowd[k]);
  }
  const crowdCount = folk.length;
  for (let i = 0; i < state.peds.length; i += 1) {
    const p = state.peds[i];
    if (!r.visible(p.x, p.z, 3)) continue;
    const look = pedLook(p);
    folk.push({
      x: p.x, y: p.y || 0, z: p.z, yaw: p.yaw,
      kind: look.kind, shirt: look.shirt, trous: look.trous,
      scale: look.scale, lean: look.lean, ped: p,
    });
  }

  /* One three.js pass covers the bus, the nearby traffic and the nearby
     people. Whatever it could not fit falls back to the procedural shapes,
     so distant vehicles still appear and nothing vanishes if a model fails
     to load. */
  const shot = vehicles && vehicles.ready
    ? vehicles.render({
        bus, cars: state.cars, folk, cam: r.cam, aspect: W / H,
        dusk: state.dusk || tunnel > 0.35, drawBus: view !== "cockpit", W, H,
      })
    : null;
  const modelled = shot ? shot.drawn : null;
  const modelledFolk = shot ? shot.folk : null;

  for (let i = 0; i < state.cars.length; i += 1) {
    const c = state.cars[i];
    if (!r.visible(c.x, c.z, 5)) continue;
    drawShadow(r, c.x, c.z, c.w * 1.15, c.l * 1.1, c.yaw, 0.24, c.y);
    if (!modelled || !modelled.has(i)) drawCar(r, c);
  }
  for (let i = 0; i < folk.length; i += 1) {
    if (modelledFolk && modelledFolk.has(i)) {
      // a contact shadow, or a modelled figure looks pasted onto the pavement
      const f = folk[i];
      drawShadow(r, f.x, f.z, 0.58, 0.44, f.yaw, 0.2, f.y);
      continue;
    }
    const f = folk[i];
    if (f.ped) drawPed(r, f.ped);
    else if (i < crowdCount) {
      drawPed(r, {
        x: f.x, y: f.y, z: f.z, yaw: f.yaw, phase: t * 2 + i,
        shirt: f.shirt, trouser: f.trous, skin: SKIN_FALLBACK[i % SKIN_FALLBACK.length],
      });
    }
  }

  const busModelled = !!(shot && vehicles.busReady);
  if (view !== "cockpit") {
    /* A hard slab of a shadow read fine under the old box bus; beside the
       glTF model it needs to be a tighter, lighter contact patch, layered
       to fake a soft edge. */
    if (busModelled) {
      drawShadow(r, bus.x, bus.z, BUS.wid * 1.18, BUS.len * 0.99, bus.yaw, 0.17, bus.y);
      drawShadow(r, bus.x, bus.z, BUS.wid * 0.86, BUS.len * 0.93, bus.yaw, 0.16, bus.y);
    } else {
      drawShadow(r, bus.x, bus.z, BUS.wid * 1.25, BUS.len * 1.05, bus.yaw, 0.34, bus.y);
      drawBus(r, bus, t);
    }
  }

  /* The vehicle layer arrives as a few depth-banded slices. Each one takes
     its own slot in the painter's order, so a car behind a building is
     painted before that building and stays hidden, while a car in front of
     it paints after. Compositing them all at one depth is what used to make
     traffic show through walls and appear to slide about as the bus moved. */
  const sprites = [];
  if (shot) {
    /* Source rect must be each slice canvas's own pixel size, not the CSS
       size: above 1x device pixel ratio the backing store is larger, and
       using the CSS size would blit only its top-left corner. */
    for (let i = 0; i < shot.slices.length; i += 1) {
      const s = shot.slices[i];
      sprites.push({
        depth: isFinite(s.depth) ? s.depth : r.depthOf(bus.x, bus.z),
        draw: (c) => c.drawImage(
          s.canvas, 0, 0, s.srcW, s.srcH, s.rx, s.ry, s.bufW, s.bufH,
        ),
      });
    }
  }

  ctx.save();
  if (r.cam.roll) {
    ctx.translate(W / 2, H / 2);
    ctx.rotate(r.cam.roll);
    ctx.translate(-W / 2, -H / 2);
  }
  r.paint(ctx, sprites);
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
    headlightWash(ctx, r, W, H);
  }

  if (tunnel > 0.01) {
    // inside the bore: dim everything, then wash the road back in
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    const k = 1 - tunnel * 0.62;
    ctx.fillStyle = `rgb(${Math.round(255 * k)},${Math.round(250 * k)},${Math.round(238 * k)})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    if (!state.dusk) headlightWash(ctx, r, W, H, tunnel);
  }
}

function headlightWash(ctx, r, W, H, strength = 1) {
  const hy = r.horizonY();
  const g = ctx.createRadialGradient(W / 2, H * 0.78, 8, W / 2, H * 0.78, H * 0.8);
  g.addColorStop(0, `rgba(255,244,208,${0.30 * strength})`);
  g.addColorStop(0.45, `rgba(255,240,200,${0.11 * strength})`);
  g.addColorStop(1, "rgba(255,240,200,0)");
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = g;
  ctx.fillRect(0, Math.max(0, hy - 20), W, H);
  ctx.restore();
}

/* Each region hazes a little differently — sea air on the coast, a cooler
   haze up in the hills. */
const FOG_TINT = {
  coast: "#cfdce4",
  mountain: "#c3cdd6",
  forest: "#b8c8c2",
  country: "#c4d0cd",
  airport: "#c2cedb",
};
function blendFog(base, key) {
  return FOG_TINT[key] || base;
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
  const p = r.project(s.shelterX, s.shelterY + 6.4, s.shelterZ);
  const dist = Math.hypot(state.bus.x - s.x, state.bus.z - s.z);
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  if (p && p.x > -60 && p.x < W + 60) {
    const scale = clamp(1 - p.d / 300, 0.42, 1);
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

/* The whole world at once: at roughly a kilometre and a half across it
   still reads at 150px, and it is the only place the player can see the
   shape of the route across the regions. */
const MAP_COL = {
  city: "#5c6270", suburb: "#4f6349", town: "#5e6247", country: "#5d6a3c",
  forest: "#33512f", mountain: "#5a564c", coast: "#6b6650", airport: "#54595c",
};

export function drawMinimap(ctx, state, x, y, size) {
  const { city, bus } = state;
  const pad = 5;
  const inner = size - pad * 2;
  const span = Math.max(LX[GRID], LZ[GRID]);
  const scale = inner / span;
  const ox = x + pad + (inner - LX[GRID] * scale) / 2;
  const oy = y + pad + (inner - LZ[GRID] * scale) / 2;
  const px = (wx) => ox + wx * scale;
  const py = (wz) => oy + (LZ[GRID] - wz) * scale;

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

  // region blocks
  for (let i = 0; i < GRID; i += 1) {
    for (let j = 0; j < GRID; j += 1) {
      ctx.fillStyle = MAP_COL[REGION[CELL_REGION[i * GRID + j]].key];
      ctx.globalAlpha = 0.55;
      ctx.fillRect(
        px(LX[i]), py(LZ[j + 1]),
        (LX[i + 1] - LX[i]) * scale + 0.6, (LZ[j + 1] - LZ[j]) * scale + 0.6,
      );
    }
  }
  ctx.globalAlpha = 1;

  // sea to the west
  ctx.fillStyle = "rgba(38,95,124,0.85)";
  ctx.fillRect(x, y, px(LX[0]) - x, size);

  // roads
  ctx.strokeStyle = "rgba(186,198,210,0.4)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= GRID; i += 1) {
    ctx.moveTo(px(LX[i]), py(LZ[0])); ctx.lineTo(px(LX[i]), py(LZ[GRID]));
  }
  for (let j = 0; j <= GRID; j += 1) {
    ctx.moveTo(px(LX[0]), py(LZ[j])); ctx.lineTo(px(LX[GRID]), py(LZ[j]));
  }
  ctx.stroke();

  // highways stand out
  ctx.strokeStyle = "rgba(240,214,120,0.7)";
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  for (let i = 0; i <= GRID; i += 1) {
    if (vClass(i).name !== "highway") continue;
    ctx.moveTo(px(LX[i]), py(LZ[0])); ctx.lineTo(px(LX[i]), py(LZ[GRID]));
  }
  for (let j = 0; j <= GRID; j += 1) {
    if (hClass(j).name !== "highway") continue;
    ctx.moveTo(px(LX[0]), py(LZ[j])); ctx.lineTo(px(LX[GRID]), py(LZ[j]));
  }
  ctx.stroke();

  // route line
  if (state.guide && state.guide.length > 1) {
    ctx.strokeStyle = "rgba(245,197,24,0.9)";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(px(bus.x), py(bus.z));
    for (const [gx, gz] of state.guide) ctx.lineTo(px(gx), py(gz));
    ctx.stroke();
  }

  // remaining stops, joined in route order
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  city.stops.forEach((s, i) => {
    if (i === 0) ctx.moveTo(px(s.x), py(s.z)); else ctx.lineTo(px(s.x), py(s.z));
  });
  ctx.stroke();

  for (const s of city.stops) {
    const active = s.id === state.activeStopId;
    const done = s.served;
    ctx.beginPath();
    ctx.arc(px(s.x), py(s.z), active ? 4.2 : 2.6, 0, Math.PI * 2);
    ctx.fillStyle = active ? "#ffd84d" : done ? "rgba(80,200,120,0.85)" : "rgba(255,255,255,0.5)";
    ctx.fill();
    if (active) {
      ctx.strokeStyle = "rgba(255,216,77,0.5)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(px(s.x), py(s.z), 7 + Math.sin(state.t * 4) * 2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // the bus
  ctx.save();
  ctx.translate(px(bus.x), py(bus.z));
  ctx.rotate(-bus.yaw);
  ctx.fillStyle = "#4ea3ff";
  ctx.beginPath();
  ctx.moveTo(0, -6.5); ctx.lineTo(4.5, 5.5); ctx.lineTo(0, 3); ctx.lineTo(-4.5, 5.5);
  ctx.closePath(); ctx.fill();
  ctx.restore();

  ctx.restore();
  ctx.restore();
}
