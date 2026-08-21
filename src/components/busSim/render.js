/* ------------------------------------------------------------------ *
 * City Bus Simulator — software 3D renderer on a 2D canvas.
 *
 * No WebGL and no libraries: convex polygons are transformed into
 * camera space, clipped against the near plane, projected, then drawn
 * back-to-front with the painter's algorithm.
 *
 * Three things keep it fast enough for a whole region at 60fps:
 *  - Flat ground decals (terrain, tarmac, markings) are painted as
 *    layers before any volume, so they never enter the depth sort.
 *  - Road surfacing is chunked adaptively: a segment 20m away is split
 *    into a dozen pieces so it follows the hill, one 300m away is a
 *    single quad.
 *  - Scenery is bucketed by world cell, so a frame only ever walks the
 *    cells near the camera.
 * ------------------------------------------------------------------ */

import {
  GRID, LX, LZ, WATER_Y, REGION, MOUNTAIN, COAST,
  vClass, hClass, segV, segH, cellsAround, regionAt,
  roadHeightAt, groundHeightAt, terrainAt, bandIndexX, bandIndexZ,
  clamp, lerp,
} from "./city.js";

const NEAR = 0.32;
const DRAW_DIST = 300;
const FOG_START = 110;
const FOG_STEPS = 14;

/* Paint order for everything that lies flat on the ground, followed by
   every standing volume. Lower numbers are painted first. */
export const LAYER_TERRAIN = 0;  // open ground, fields, water
export const LAYER_GROUND = 1;   // block interiors, aprons
export const LAYER_PAVE = 2;     // pavements and kerbs
export const LAYER_TARMAC = 3;
export const LAYER_MARK = 4;     // lane lines, crossings
export const LAYER_BAY = 5;      // bus stop bays
export const LAYER_GUIDE = 6;    // route chevrons
export const LAYER_SHADOW = 7;
export const LAYER_VOLUME = 10;

/* ------------------------------ colour ------------------------------ */

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function shade(hex, amount) {
  const [r, g, b] = hexToRgb(hex);
  const t = amount < 0 ? 0 : 255;
  const p = Math.abs(amount);
  return `rgb(${Math.round(lerp(r, t, p))},${Math.round(lerp(g, t, p))},${Math.round(lerp(b, t, p))})`;
}

/* Fog is quantised so we can cache the blended colour strings. */
function makeFogCache(fogHex) {
  const fog = hexToRgb(fogHex);
  const cache = new Map();
  return function foggy(color, step) {
    if (step <= 0) return color;
    const key = color + step;
    const hit = cache.get(key);
    if (hit) return hit;
    let rgb;
    if (color.charCodeAt(0) === 35) rgb = hexToRgb(color);
    else {
      const m = color.match(/-?\d+/g);
      rgb = m ? [+m[0], +m[1], +m[2]] : [128, 128, 128];
    }
    const t = step / FOG_STEPS;
    const out = `rgb(${Math.round(lerp(rgb[0], fog[0], t))},${Math.round(lerp(rgb[1], fog[1], t))},${Math.round(lerp(rgb[2], fog[2], t))})`;
    if (cache.size < 4000) cache.set(key, out);
    return out;
  };
}

/* ---------------------------- the renderer ---------------------------- */

export function createRenderer() {
  // camera
  const cam = { x: 0, y: 3, z: 0, yaw: 0, pitch: 0, roll: 0, fov: 1.12 };

  let W = 0, H = 0, cx = 0, cy = 0, focal = 1;
  let sinY = 0, cosY = 1, sinP = 0, cosP = 1;
  let tanHalf = 1;
  let drawDist = DRAW_DIST;

  // pooled draw list — avoids allocating thousands of objects per frame
  const pool = [];
  let poolLen = 0;
  const list = [];

  // scratch vertex buffers
  const vx = new Float32Array(16);
  const vy = new Float32Array(16);
  const vz = new Float32Array(16);
  const clipX = new Float32Array(12);
  const clipY = new Float32Array(12);
  const clipZ = new Float32Array(12);

  let foggy = makeFogCache("#b9cbdd");
  let fogHex = "#b9cbdd";

  function setSize(w, h) {
    W = w; H = h;
    cx = w / 2; cy = h / 2;
    tanHalf = Math.tan(cam.fov / 2);
    focal = (h / 2) / tanHalf;
  }

  function setFog(hex) {
    if (hex !== fogHex) { fogHex = hex; foggy = makeFogCache(hex); }
  }

  function setDrawDist(d) { drawDist = d; }

  function beginFrame() {
    poolLen = 0;
    list.length = 0;
    sinY = Math.sin(cam.yaw); cosY = Math.cos(cam.yaw);
    sinP = Math.sin(cam.pitch); cosP = Math.cos(cam.pitch);
    tanHalf = Math.tan(cam.fov / 2);
    focal = (H / 2) / tanHalf;
  }

  /* world -> camera space, written into the scratch buffers at index i */
  function toCam(i, x, y, z) {
    const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z;
    const ex = dx * cosY - dz * sinY;
    const ez = dx * sinY + dz * cosY;
    vx[i] = ex;
    vy[i] = dy * cosP - ez * sinP;
    vz[i] = dy * sinP + ez * cosP;
  }

  function take() {
    let it = pool[poolLen];
    if (!it) {
      it = {
        sx: new Float32Array(12), sy: new Float32Array(12),
        n: 0, depth: 0, layer: LAYER_VOLUME, color: "", stripe: null,
        alpha: 1, minY: 0, maxY: 0,
      };
      pool[poolLen] = it;
    }
    poolLen += 1;
    return it;
  }

  /**
   * Clip an n-gon (already in camera space, in the scratch buffers,
   * indices given by idx) against the near plane, project it, and add
   * it to the draw list.
   */
  function emit(idx, n, color, stripe, alpha, layer, bias) {
    let cn = 0;
    let inside = 0;
    for (let i = 0; i < n; i += 1) if (vz[idx[i]] >= NEAR) inside += 1;
    if (inside === 0) return null;

    if (inside === n) {
      for (let i = 0; i < n; i += 1) {
        const k = idx[i];
        clipX[cn] = vx[k]; clipY[cn] = vy[k]; clipZ[cn] = vz[k]; cn += 1;
      }
    } else {
      for (let i = 0; i < n; i += 1) {
        const a = idx[i];
        const b = idx[(i + 1) % n];
        const az = vz[a], bz = vz[b];
        const aIn = az >= NEAR, bIn = bz >= NEAR;
        if (aIn) { clipX[cn] = vx[a]; clipY[cn] = vy[a]; clipZ[cn] = az; cn += 1; }
        if (aIn !== bIn) {
          const t = (NEAR - az) / (bz - az);
          clipX[cn] = vx[a] + (vx[b] - vx[a]) * t;
          clipY[cn] = vy[a] + (vy[b] - vy[a]) * t;
          clipZ[cn] = NEAR;
          cn += 1;
        }
        if (cn >= 11) break;
      }
    }
    if (cn < 3) return null;

    const it = take();
    let sum = 0;
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (let i = 0; i < cn; i += 1) {
      const z = clipZ[i];
      const inv = focal / z;
      const sx = cx + clipX[i] * inv;
      const sy = cy - clipY[i] * inv;
      it.sx[i] = sx; it.sy[i] = sy;
      sum += z;
      if (sx < minX) minX = sx;
      if (sx > maxX) maxX = sx;
      if (sy < minY) minY = sy;
      if (sy > maxY) maxY = sy;
    }
    if (maxX < -4 || minX > W + 4 || maxY < -4 || minY > H + 4) { poolLen -= 1; return null; }

    it.n = cn;
    const meanZ = sum / cn;
    it.depth = meanZ + (bias || 0);
    it.layer = layer === undefined ? LAYER_VOLUME : layer;
    const step = Math.round(clamp((meanZ - FOG_START) / (drawDist - FOG_START), 0, 1) * FOG_STEPS);
    it.color = foggy(color, step);
    it.stripe = stripe || null;
    it.alpha = alpha === undefined ? 1 : alpha;
    it.minY = minY; it.maxY = maxY;
    list.push(it);
    return it;
  }

  const IDX4 = [0, 1, 2, 3];
  const IDX3 = [0, 1, 2];

  /** A quad given by four world-space points. */
  function quad(p0, p1, p2, p3, color, opts) {
    toCam(0, p0[0], p0[1], p0[2]);
    toCam(1, p1[0], p1[1], p1[2]);
    toCam(2, p2[0], p2[1], p2[2]);
    toCam(3, p3[0], p3[1], p3[2]);
    return emit(
      IDX4, 4, color,
      opts && opts.stripe, opts && opts.alpha,
      opts && opts.layer, opts && opts.bias,
    );
  }

  function tri(p0, p1, p2, color, opts) {
    toCam(0, p0[0], p0[1], p0[2]);
    toCam(1, p1[0], p1[1], p1[2]);
    toCam(2, p2[0], p2[1], p2[2]);
    return emit(IDX3, 3, color, null, opts && opts.alpha, opts && opts.layer, opts && opts.bias);
  }

  /** Flat ground quad, axis aligned, centred on (x,z), at a fixed height. */
  function groundRect(x, z, w, d, color, alpha, layer, y) {
    const hw = w / 2, hd = d / 2;
    const yy = y || 0;
    toCam(0, x - hw, yy, z - hd);
    toCam(1, x + hw, yy, z - hd);
    toCam(2, x + hw, yy, z + hd);
    toCam(3, x - hw, yy, z + hd);
    return emit(IDX4, 4, color, null, alpha, layer === undefined ? LAYER_TARMAC : layer, 0);
  }

  /** Ground quad whose corners follow the road surface. */
  function roadRect(x, z, w, d, color, alpha, layer, lift) {
    const hw = w / 2, hd = d / 2;
    const l = lift || 0.02;
    const x0 = x - hw, x1 = x + hw, z0 = z - hd, z1 = z + hd;
    toCam(0, x0, roadHeightAt(x0, z0) + l, z0);
    toCam(1, x1, roadHeightAt(x1, z0) + l, z0);
    toCam(2, x1, roadHeightAt(x1, z1) + l, z1);
    toCam(3, x0, roadHeightAt(x0, z1) + l, z1);
    return emit(IDX4, 4, color, null, alpha, layer === undefined ? LAYER_TARMAC : layer, 0);
  }

  /** Ground quad whose corners follow the visible terrain. */
  function terrainRect(x, z, w, d, color, alpha, layer, lift) {
    const hw = w / 2, hd = d / 2;
    const l = lift || 0.02;
    const x0 = x - hw, x1 = x + hw, z0 = z - hd, z1 = z + hd;
    toCam(0, x0, groundHeightAt(x0, z0) + l, z0);
    toCam(1, x1, groundHeightAt(x1, z0) + l, z0);
    toCam(2, x1, groundHeightAt(x1, z1) + l, z1);
    toCam(3, x0, groundHeightAt(x0, z1) + l, z1);
    return emit(IDX4, 4, color, null, alpha, layer === undefined ? LAYER_GROUND : layer, 0);
  }

  /**
   * Axis-aligned or yaw-rotated box. `faces` supplies the colours.
   * Side faces are back-face culled against the camera position.
   */
  const BOX_FACES = [
    [4, 5, 6, 7],   // top
    [0, 1, 5, 4],   // -z
    [1, 2, 6, 5],   // +x
    [2, 3, 7, 6],   // +z
    [3, 0, 4, 7],   // -x
  ];
  const NORMALS = [
    [0, 1, 0], [0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0],
  ];
  const bxs = new Float64Array(8);
  const bys = new Float64Array(8);
  const bzs = new Float64Array(8);

  function box(x, y0, z, w, h, d, yaw, colors, opts) {
    const hw = w / 2, hd = d / 2;
    const c = yaw ? Math.cos(yaw) : 1;
    const s = yaw ? Math.sin(yaw) : 0;
    const cx4 = [-hw, hw, hw, -hw];
    const cz4 = [-hd, -hd, hd, hd];
    for (let i = 0; i < 4; i += 1) {
      const lx = cx4[i], lz = cz4[i];
      const wx = x + lx * c + lz * s;
      const wz = z - lx * s + lz * c;
      bxs[i] = wx; bys[i] = y0; bzs[i] = wz;
      bxs[i + 4] = wx; bys[i + 4] = y0 + h; bzs[i + 4] = wz;
    }
    for (let i = 0; i < 8; i += 1) toCam(i, bxs[i], bys[i], bzs[i]);

    const stripe = opts && opts.stripe;
    for (let f = 0; f < 5; f += 1) {
      const col = colors[f];
      if (!col) continue;
      if (f > 0) {
        // rotate the face normal and cull if it faces away
        const n = NORMALS[f];
        const nx = n[0] * c + n[2] * s;
        const nz = -n[0] * s + n[2] * c;
        const idx0 = BOX_FACES[f][0];
        if (nx * (cam.x - bxs[idx0]) + nz * (cam.z - bzs[idx0]) <= 0) continue;
      } else if (cam.y < y0 + h) {
        continue; // camera below the roof, top face invisible
      }
      emit(
        BOX_FACES[f], 4, col, f > 0 ? stripe : null,
        opts && opts.alpha, (opts && opts.layer) || LAYER_VOLUME, opts && opts.bias,
      );
    }
  }

  /** A camera-facing sprite quad (used for lights, glows, people heads). */
  function billboard(x, y, z, w, h, color, alpha) {
    const rx = cosY * (w / 2);
    const rz = -sinY * (w / 2);
    toCam(0, x - rx, y, z - rz);
    toCam(1, x + rx, y, z + rz);
    toCam(2, x + rx, y + h, z + rz);
    toCam(3, x - rx, y + h, z - rz);
    return emit(IDX4, 4, color, null, alpha, LAYER_VOLUME, -0.3);
  }

  /* --------------------------- frustum culling --------------------------- */

  /** Cheap test: is a sphere at (x,z) with radius r worth transforming? */
  function visible(x, z, r) {
    const dx = x - cam.x, dz = z - cam.z;
    const ez = dx * sinY + dz * cosY;
    if (ez < -r - 2) return false;
    const d2 = dx * dx + dz * dz;
    if (d2 > (drawDist + r) * (drawDist + r)) return false;
    const ex = dx * cosY - dz * sinY;
    const lim = Math.abs(ez) * tanHalf * (W / H) + r + 6;
    return Math.abs(ex) <= lim;
  }

  function depthOf(x, z) {
    const dx = x - cam.x, dz = z - cam.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  /* ------------------------------ painting ------------------------------ */

  /**
   * `sprites` lets externally rendered objects (the glTF bus and traffic)
   * join the painter's order. Each entry carries its own depth and is
   * blitted once every volume further away than it has been laid down, so
   * anything nearer still paints over the top.
   *
   * It has to be a list, not one sprite. The whole vehicle layer used to
   * be composited at a single depth — whichever vehicle happened to be
   * nearest — so a car two blocks away painted over every building beyond
   * that near car and showed straight through the tower in front of it.
   * Worse, the depth moved with the bus, so cars flicked in and out of
   * solidity as you drove and read as sliding around the world. Slicing
   * the vehicles by depth and giving each slice its own slot here is what
   * puts them back behind the scenery they are actually behind.
   */
  function paint(ctx, sprites) {
    list.sort((a, b) => (a.layer - b.layer) || (b.depth - a.depth));
    /* Far to near: the same order the volumes below are walked in. */
    const sp = sprites
      ? (Array.isArray(sprites) ? sprites.slice() : [sprites]).sort((a, b) => b.depth - a.depth)
      : [];
    let spriteAt = 0;
    let lastColor = "";
    let lastAlpha = 1;
    for (let i = 0; i < list.length; i += 1) {
      const it = list[i];
      if (spriteAt < sp.length && it.layer >= LAYER_VOLUME && it.depth < sp[spriteAt].depth) {
        if (lastAlpha !== 1) { ctx.globalAlpha = 1; lastAlpha = 1; }
        /* Several slices can fall between two volumes; flush them all. */
        while (spriteAt < sp.length && it.depth < sp[spriteAt].depth) {
          sp[spriteAt].draw(ctx);
          spriteAt += 1;
        }
        lastColor = "";
      }
      ctx.beginPath();
      ctx.moveTo(it.sx[0], it.sy[0]);
      for (let k = 1; k < it.n; k += 1) ctx.lineTo(it.sx[k], it.sy[k]);
      ctx.closePath();
      if (it.alpha !== lastAlpha) { ctx.globalAlpha = it.alpha; lastAlpha = it.alpha; }
      if (it.color !== lastColor) { ctx.fillStyle = it.color; lastColor = it.color; }
      ctx.fill();
      if (it.stripe) {
        /* A face crossing the near plane projects to enormous screen
           coordinates; clamping keeps the window bands at a sensible
           size instead of stretching one band across the whole wall. */
        const gy0 = Math.max(it.minY, -H);
        const gy1 = Math.min(it.maxY, H * 2);
        if (gy1 - gy0 < 2) continue;
        const g = ctx.createLinearGradient(0, gy0, 0, gy1);
        const rows = it.stripe.rows;
        const col = it.stripe.color;
        const span = 1 / rows;
        for (let r = 0; r < rows; r += 1) {
          const a = r * span;
          g.addColorStop(a, "rgba(0,0,0,0)");
          g.addColorStop(a + span * 0.24, col);
          g.addColorStop(a + span * 0.66, col);
          g.addColorStop(Math.min(1, a + span * 0.9), "rgba(0,0,0,0)");
        }
        ctx.fillStyle = g;
        ctx.fill();
        lastColor = "";
      }
    }
    if (lastAlpha !== 1) ctx.globalAlpha = 1;
    // nothing left in the scene was nearer than these
    while (spriteAt < sp.length) { sp[spriteAt].draw(ctx); spriteAt += 1; }
  }

  return {
    cam,
    setSize, setFog, setDrawDist, beginFrame, paint,
    quad, tri, groundRect, roadRect, terrainRect, box, billboard, visible, depthOf,
    get width() { return W; },
    get height() { return H; },
    get focal() { return focal; },
    get drawDist() { return drawDist; },
    horizonY() { return cy + focal * Math.tan(cam.pitch); },
    project(x, y, z) {
      toCam(0, x, y, z);
      if (vz[0] < NEAR) return null;
      const inv = focal / vz[0];
      return { x: cx + vx[0] * inv, y: cy - vy[0] * inv, d: vz[0] };
    },
    count() { return list.length; },
  };
}

/* ------------------------------------------------------------------ *
 * Scene drawing — world geometry pushed into the renderer each frame.
 * ------------------------------------------------------------------ */

const TARMAC = "#43474d";
const TARMAC_2 = "#3d4147";
const RURAL_TARMAC = "#4a4842";
const PAVEMENT = "#9a9a92";
const KERB_COL = "#7e7e76";
const MARK = "#d9d4c2";
const MARK_EDGE = "#e6e2d4";
const WATER = "#2f6d8c";
const WATER_DEEP = "#20536e";
const SAND = "#c9b98e";
const ROCK = "#7c766a";
const ROCK_HI = "#8d8779";

/* ---------------------------- sky and water ---------------------------- */

const SKY = {
  day: { top: "#3b74b8", mid: "#8fbbe2", horizon: "#c6d8e6", fog: "#b9cbdd" },
  dusk: { top: "#33478a", mid: "#8d7fc4", horizon: "#ffc38c", fog: "#3a3a4d" },
};

export function skyFor(dusk) { return dusk ? SKY.dusk : SKY.day; }

export function drawSky(ctx, r, W, H, dusk, tint) {
  const hy = r.horizonY();
  const s = skyFor(dusk);
  const g = ctx.createLinearGradient(0, Math.min(0, hy - H), 0, hy);
  g.addColorStop(0, s.top);
  g.addColorStop(dusk ? 0.55 : 0.6, s.mid);
  g.addColorStop(1, s.horizon);
  ctx.fillStyle = g;
  ctx.fillRect(-W, Math.min(-H, hy - H * 2), W * 3, Math.max(0, hy) + H * 2);

  if (hy < H) {
    // the near edge of the ground meets the same haze the far terrain
    // fogs into, so the end of the drawn world is not a hard line
    const gg = ctx.createLinearGradient(0, hy, 0, hy + H * 0.6);
    gg.addColorStop(0, s.fog);
    gg.addColorStop(0.25, dusk ? "#43434f" : shade(tint || "#8a9470", 0.14));
    gg.addColorStop(1, dusk ? "#23232b" : tint || "#6f7a63");
    ctx.fillStyle = gg;
    ctx.fillRect(-W, hy, W * 3, H * 2);
  }
}

export function drawClouds(ctx, r, W, t, dusk) {
  const hy = r.horizonY();
  if (hy < -140) return;
  ctx.save();
  ctx.globalAlpha = dusk ? 0.28 : 0.46;
  const yaw = r.cam.yaw;
  for (let i = 0; i < 14; i += 1) {
    const base = i * 0.45 + t * 0.0035;
    const ang = ((base % (Math.PI * 2)) - yaw + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    if (Math.abs(ang) > 1.25) continue;
    const x = W / 2 + Math.tan(ang) * r.focal;
    const band = i % 4;
    const y = hy - 54 - band * 52 - 26;
    const w = 120 + band * 76 + (i % 3) * 40;
    const h = 16 + band * 6;
    ctx.fillStyle = dusk
      ? (band > 1 ? "#9a86b4" : "#7d6f9c")
      : (band > 1 ? "#ffffff" : "#eef4fb");
    ctx.beginPath();
    ctx.ellipse(x, y, w, h, 0, 0, Math.PI * 2);
    ctx.ellipse(x + w * 0.42, y + h * 0.42, w * 0.55, h * 0.8, 0, 0, Math.PI * 2);
    ctx.ellipse(x - w * 0.46, y + h * 0.3, w * 0.44, h * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* ------------------------------- terrain ------------------------------- */

/* Three concentric lattices: fine near the camera, very coarse out at the
   horizon. Vertices are snapped to world multiples of the step so the
   mesh does not swim as the bus drives. */
const RINGS = [
  { step: 24, n: 13 },
  { step: 48, n: 17 },
  { step: 124, n: 15 },
];
const RINGS_LOW = [
  { step: 32, n: 11 },
  { step: 72, n: 13 },
  { step: 180, n: 11 },
];

const hbuf = new Float64Array(17 * 17);

function terrainColour(x, z, y, slope) {
  if (y < WATER_Y + 1.4) return SAND;
  const reg = REGION[regionAt(x, z)];
  if (slope > 0.62) return y > 60 ? ROCK_HI : ROCK;
  if (slope > 0.38) return shade(reg.ground, -0.14);
  return reg.ground;
}

function emitPatch(r, x0, z0, step, y00, y10, y11, y01, skip, camX, camZ) {
  const x1 = x0 + step, z1 = z0 + step;
  const mx = x0 + step / 2, mz = z0 + step / 2;
  if (skip > 0 && Math.abs(mx - camX) < skip && Math.abs(mz - camZ) < skip) return;
  if (!r.visible(mx, mz, step * 0.8)) return;
  const lo = Math.min(y00, y10, y11, y01);
  const hi = Math.max(y00, y10, y11, y01);
  const slope = (hi - lo) / step;
  const my = (y00 + y10 + y11 + y01) / 4;

  if (hi < WATER_Y - 0.15) {
    // fully submerged: the seabed is never seen, just draw the surface
    r.groundRect(mx, mz, step, step, my < WATER_Y - 12 ? WATER_DEEP : WATER,
      1, LAYER_TERRAIN, WATER_Y);
    return;
  }
  /* A hillside well above the local roads has to paint *after* the flat
     road decals, or a road on the far side of a ridge shows straight
     through it. Flat ground stays a decal so roads paint over it. */
  const standing = my > roadHeightAt(mx, mz) + 6.5 && slope > 0.12;
  r.quad(
    [x0, y00, z0], [x1, y10, z0], [x1, y11, z1], [x0, y01, z1],
    terrainColour(mx, mz, my, slope),
    { layer: standing ? LAYER_VOLUME : LAYER_TERRAIN },
  );
  if (lo < WATER_Y - 0.15) {
    r.groundRect(mx, mz, step, step, WATER, 0.82, LAYER_GROUND, WATER_Y);
  }
}

export function drawTerrain(r, lowQuality) {
  const rings = lowQuality ? RINGS_LOW : RINGS;
  const camX = r.cam.x, camZ = r.cam.z;
  let innerHalf = 0;
  for (let ri = 0; ri < rings.length; ri += 1) {
    const { step, n } = rings[ri];
    const half = (n - 1) / 2;
    const ox = Math.round(camX / step) * step - half * step;
    const oz = Math.round(camZ / step) * step - half * step;
    const skip = innerHalf;
    // vertex heights first, so each point is evaluated once
    for (let a = 0; a < n; a += 1) {
      const x = ox + a * step;
      for (let b = 0; b < n; b += 1) {
        hbuf[a * 17 + b] = groundHeightAt(x, oz + b * step);
      }
    }
    /* Flat 2x2 patches are emitted as one quad. Over a city or an airport
       apron that collapses three quarters of the lattice, which is most of
       the terrain cost in exactly the places that are busiest already. */
    const merged = new Uint8Array(17 * 17);
    for (let a = 0; a + 2 < n; a += 2) {
      for (let b = 0; b + 2 < n; b += 2) {
        let lo = Infinity, hi = -Infinity;
        for (let p = 0; p <= 2; p += 1) {
          for (let q = 0; q <= 2; q += 1) {
            const h = hbuf[(a + p) * 17 + b + q];
            if (h < lo) lo = h;
            if (h > hi) hi = h;
          }
        }
        if (hi - lo > 0.12) continue;
        const mx = ox + (a + 1) * step, mz = oz + (b + 1) * step;
        if (regionAt(ox + a * step, oz + b * step) !== regionAt(mx + step, mz + step)) continue;
        for (let p = 0; p < 2; p += 1) for (let q = 0; q < 2; q += 1) merged[(a + p) * 17 + b + q] = 1;
        emitPatch(r, ox + a * step, oz + b * step, step * 2, lo, lo, lo, lo, skip, camX, camZ);
      }
    }
    for (let a = 0; a < n - 1; a += 1) {
      const x0 = ox + a * step;
      for (let b = 0; b < n - 1; b += 1) {
        if (merged[a * 17 + b]) continue;
        emitPatch(
          r, x0, oz + b * step, step,
          hbuf[a * 17 + b], hbuf[(a + 1) * 17 + b],
          hbuf[(a + 1) * 17 + b + 1], hbuf[a * 17 + b + 1],
          skip, camX, camZ,
        );
      }
    }
    innerHalf = half * step * 0.86;
  }
}

/* -------------------------- static road painting -------------------------- */

const ROAD_DIST = 340;
const MARK_DIST = 105;
const DETAIL_DIST = 118;
/* Surfacing follows whatever draw distance the region asked for: downtown
   almost nothing past 200m is visible anyway, and paying for it there is
   what makes the busiest place also the slowest. */
let roadDist = ROAD_DIST;

function chunkCount(d, len) {
  if (d < 55) return Math.max(1, Math.min(12, Math.round(len / 14)));
  if (d < 130) return Math.max(1, Math.min(6, Math.round(len / 32)));
  if (d < 210) return Math.max(1, Math.round(len / 70));
  return 1;
}

function tarmacFor(cls, region) {
  if (cls.name === "highway") return "#3f434a";
  if (region === MOUNTAIN || region === COAST) return RURAL_TARMAC;
  return cls.kerb ? TARMAC : RURAL_TARMAC;
}

export function drawRoads(r) {
  const cam = r.cam;
  /* The carriageway is drawn as far as anything else is. It used to stop
     at 86% of the draw distance, which left a band tens of metres deep
     where trees, buildings and poles were still being drawn but the road
     under them had already ended — the road looked like it ran out. Far
     segments are a single quad each, so this costs almost nothing. */
  roadDist = Math.min(ROAD_DIST, r.drawDist);
  const i0 = Math.max(0, bandIndexX(cam.x - roadDist) - 1);
  const i1 = Math.min(GRID, bandIndexX(cam.x + roadDist) + 1);
  const j0 = Math.max(0, bandIndexZ(cam.z - roadDist) - 1);
  const j1 = Math.min(GRID, bandIndexZ(cam.z + roadDist) + 1);

  // junction squares
  for (let i = i0; i <= i1; i += 1) {
    const cv = vClass(i);
    for (let j = j0; j <= j1; j += 1) {
      const ch = hClass(j);
      const x = LX[i], z = LZ[j];
      const d = r.depthOf(x, z);
      if (d > roadDist || !r.visible(x, z, Math.max(cv.half, ch.half) * 1.5)) continue;
      r.roadRect(x, z, cv.half * 2, ch.half * 2, TARMAC_2, 1, LAYER_TARMAC);
      if (d < DETAIL_DIST) drawFillets(r, x, z, cv, ch);
      if (d < MARK_DIST && (cv.kerb || ch.kerb)) drawCrossings(r, x, z, cv, ch);
    }
  }

  // north-south segments
  for (let i = i0; i <= i1; i += 1) {
    const cv = vClass(i);
    for (let j = Math.max(0, j0 - 1); j <= Math.min(GRID - 1, j1); j += 1) {
      const seg = segV(i, j);
      const a = seg.a + hClass(j).half;
      const b = seg.b - hClass(j + 1).half;
      const len = b - a;
      if (len <= 0) continue;
      const mid = (a + b) / 2;
      const d = r.depthOf(LX[i], mid);
      if (d > roadDist + len * 0.5 || !r.visible(LX[i], mid, len * 0.6 + 20)) continue;
      drawSegment(r, seg, true, LX[i], a, len, cv, d);
    }
  }

  // east-west segments
  for (let j = j0; j <= j1; j += 1) {
    const ch = hClass(j);
    for (let i = Math.max(0, i0 - 1); i <= Math.min(GRID - 1, i1); i += 1) {
      const seg = segH(j, i);
      const a = seg.a + vClass(i).half;
      const b = seg.b - vClass(i + 1).half;
      const len = b - a;
      if (len <= 0) continue;
      const mid = (a + b) / 2;
      const d = r.depthOf(mid, LZ[j]);
      if (d > roadDist + len * 0.5 || !r.visible(mid, LZ[j], len * 0.6 + 20)) continue;
      drawSegment(r, seg, false, LZ[j], a, len, ch, d);
    }
  }
}

function drawSegment(r, seg, vertical, fixed, a, len, cls, dist) {
  const region = seg.region;
  const tar = tarmacFor(cls, region);
  /* A viaduct drawn as one chunk gets one parapet the length of the whole
     span, which reads as a bright bar ruled across the landscape. Bridges
     always get real segments. */
  const n = seg.bridge
    ? Math.max(chunkCount(dist, len), Math.min(9, Math.round(len / 26)))
    : chunkCount(dist, len);
  const step = len / n;
  const wide = cls.half * 2;
  const paveOff = cls.half + cls.pave / 2;

  for (let k = 0; k < n; k += 1) {
    const c = a + step * (k + 0.5);
    const x = vertical ? fixed : c;
    const z = vertical ? c : fixed;
    const d = r.depthOf(x, z);
    if (d > roadDist || !r.visible(x, z, step * 0.7 + cls.half)) continue;
    const u = ((vertical ? z : x) - seg.a) / seg.len;
    const onBridge = seg.bridge && u > seg.bridge.u0 && u < seg.bridge.u1;

    if (vertical) r.roadRect(x, z, wide, step + 0.4, tar, 1, LAYER_TARMAC);
    else r.roadRect(x, z, step + 0.4, wide, tar, 1, LAYER_TARMAC);

    if (d < DETAIL_DIST && !onBridge) {
      const pv = cls.kerb ? PAVEMENT : REGION[region].verge;
      if (vertical) {
        r.roadRect(x - paveOff, z, cls.pave, step + 0.4, pv, 1, LAYER_PAVE, -0.03);
        r.roadRect(x + paveOff, z, cls.pave, step + 0.4, pv, 1, LAYER_PAVE, -0.03);
        if (cls.kerb) {
          r.roadRect(x - cls.half - 0.28, z, 0.56, step + 0.4, KERB_COL, 1, LAYER_PAVE, 0.04);
          r.roadRect(x + cls.half + 0.28, z, 0.56, step + 0.4, KERB_COL, 1, LAYER_PAVE, 0.04);
        }
      } else {
        r.roadRect(x, z - paveOff, step + 0.4, cls.pave, pv, 1, LAYER_PAVE, -0.03);
        r.roadRect(x, z + paveOff, step + 0.4, cls.pave, pv, 1, LAYER_PAVE, -0.03);
        if (cls.kerb) {
          r.roadRect(x, z - cls.half - 0.28, step + 0.4, 0.56, KERB_COL, 1, LAYER_PAVE, 0.04);
          r.roadRect(x, z + cls.half + 0.28, step + 0.4, 0.56, KERB_COL, 1, LAYER_PAVE, 0.04);
        }
      }
    }

    if (d < MARK_DIST) drawMarkings(r, vertical, x, z, step, cls);
    if (onBridge) {
      drawBridgeChunk(r, vertical, x, z, step, cls, seg, d,
        Math.abs(r.cam.y - roadHeightAt(x, z)) < 6);
    }
  }

  if (seg.tunnel) drawTunnel(r, seg, vertical, fixed, cls);
}

function drawMarkings(r, vertical, x, z, step, cls) {
  const dash = step * 0.45;
  if (cls.lanes.length > 1) {
    // dual carriageway: solid edge lines plus a lane divider each side
    for (const s of [-1, 1]) {
      const edge = cls.half - 0.5;
      const div = (cls.lanes[0] + cls.lanes[1]) / 2;
      if (vertical) {
        r.roadRect(x + s * edge, z, 0.26, step + 0.3, MARK_EDGE, 0.8, LAYER_MARK, 0.05);
        r.roadRect(x + s * div, z, 0.24, dash, MARK, 0.8, LAYER_MARK, 0.05);
      } else {
        r.roadRect(x, z + s * edge, step + 0.3, 0.26, MARK_EDGE, 0.8, LAYER_MARK, 0.05);
        r.roadRect(x, z + s * div, dash, 0.24, MARK, 0.8, LAYER_MARK, 0.05);
      }
    }
    // central reservation
    if (vertical) r.roadRect(x, z, 1.1, step + 0.3, "#6f7466", 1, LAYER_MARK, 0.06);
    else r.roadRect(x, z, step + 0.3, 1.1, "#6f7466", 1, LAYER_MARK, 0.06);
    return;
  }
  if (vertical) r.roadRect(x, z, 0.32, dash, MARK, 0.85, LAYER_MARK, 0.05);
  else r.roadRect(x, z, dash, 0.32, MARK, 0.85, LAYER_MARK, 0.05);
  if (!cls.kerb) {
    for (const s of [-1, 1]) {
      if (vertical) r.roadRect(x + s * (cls.half - 0.45), z, 0.2, step + 0.3, MARK_EDGE, 0.55, LAYER_MARK, 0.05);
      else r.roadRect(x, z + s * (cls.half - 0.45), step + 0.3, 0.2, MARK_EDGE, 0.55, LAYER_MARK, 0.05);
    }
  }
}

/* The collision model rounds every junction corner so a twelve-metre bus
   can turn through it; the tarmac has to be rounded to match, or the bus
   drives over what looks like the pavement. */
function drawFillets(r, x, z, cv, ch) {
  const R = Math.min(cv.pave, ch.pave);
  if (R < 0.6) return;
  const N = 3;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const px = x + sx * cv.half;
      const pz = z + sz * ch.half;
      const ccx = x + sx * (cv.half + R);
      const ccz = z + sz * (ch.half + R);
      let ax = px;
      let az = z + sz * (ch.half + R);
      for (let k = 1; k <= N; k += 1) {
        const t = (k / N) * (Math.PI / 2);
        const bx = ccx - sx * R * Math.cos(t);
        const bz = ccz - sz * R * Math.sin(t);
        r.tri(
          [px, roadHeightAt(px, pz) + 0.02, pz],
          [ax, roadHeightAt(ax, az) + 0.02, az],
          [bx, roadHeightAt(bx, bz) + 0.02, bz],
          TARMAC_2, { layer: LAYER_TARMAC },
        );
        ax = bx; az = bz;
      }
    }
  }
}

function drawCrossings(r, x, z, cv, ch) {
  const stripes = 5;
  const widX = cv.half * 2 * 0.82;
  const widZ = ch.half * 2 * 0.82;
  const stepX = widX / stripes;
  const stepZ = widZ / stripes;
  for (let s = 0; s < stripes; s += 1) {
    const ox = -widX / 2 + stepX * (s + 0.5);
    const oz = -widZ / 2 + stepZ * (s + 0.5);
    r.roadRect(x + ox, z - ch.half - 1.5, stepX * 0.55, 2.4, MARK, 0.8, LAYER_MARK, 0.05);
    r.roadRect(x + ox, z + ch.half + 1.5, stepX * 0.55, 2.4, MARK, 0.8, LAYER_MARK, 0.05);
    r.roadRect(x - cv.half - 1.5, z + oz, 2.4, stepZ * 0.55, MARK, 0.8, LAYER_MARK, 0.05);
    r.roadRect(x + cv.half + 1.5, z + oz, 2.4, stepZ * 0.55, MARK, 0.8, LAYER_MARK, 0.05);
  }
}

/* -------------------------------- bridges -------------------------------- */

function bridgeParapet(r, vertical, x, z, step, cls) {
  const y = roadHeightAt(x, z);
  const off = cls.half + 0.45;
  for (const s of [-1, 1]) {
    const px = vertical ? x + s * off : x;
    const pz = vertical ? z : z + s * off;
    r.box(px, y + 0.1, pz, vertical ? 0.4 : step, 1.15, vertical ? step : 0.4, 0,
      ["#b9bcc0", "#8f949a", "#a2a7ad", "#b9bcc0", "#8f949a"]);
  }
}

function drawBridgeChunk(r, vertical, x, z, step, cls, seg, dist, onDeck) {
  if (dist > 200) return;
  const y = roadHeightAt(x, z);
  const w = cls.half * 2 + 1.6;
  /* A thin fascia, not a deep slab. The carriageway is a flat decal and
     every volume paints after it, so a tall box under the deck ends up
     drawn across the road it is supposed to be holding up. */
  if (!onDeck || dist > 26) {
    /* Only the long faces. The end caps of a fascia run the full width of
       the deck, and since the carriageway is a flat decal painted before
       every volume, each cap ends up ruled across the road like a girder. */
    const cols = vertical
      ? [null, null, "#8a8f95", null, "#767c83"]
      : [null, "#8a8f95", null, "#767c83", null];
    r.box(x, y - 0.62, z, vertical ? w : step + 0.4, 0.6, vertical ? step + 0.4 : w, 0, cols);
  }
  bridgeParapet(r, vertical, x, z, step + 0.4, cls);
  // piers, roughly every 34m
  const along = vertical ? z : x;
  if (Math.abs(along % 34) < step * 0.5) {
    const ground = terrainAt(x, z);
    const drop = y - 0.8 - Math.max(ground, WATER_Y - 3);
    if (drop > 3) {
      for (const s of [-1, 1]) {
        const px = vertical ? x + s * (cls.half * 0.55) : x;
        const pz = vertical ? z : z + s * (cls.half * 0.55);
        r.box(px, y - 0.8 - drop, pz, 2.2, drop, 2.2, 0,
          ["#9aa0a6", "#6e747a", "#7f858b", "#9aa0a6", "#6e747a"]);
      }
    }
  }
}

/* -------------------------------- tunnels -------------------------------- */

const TUNNEL_H = 6.4;

function drawTunnel(r, seg, vertical, fixed, cls) {
  const t = seg.tunnel;
  const a = seg.a + seg.len * t.u0;
  const b = seg.a + seg.len * t.u1;
  const midV = (a + b) / 2;
  const cxp = vertical ? fixed : midV;
  const czp = vertical ? midV : fixed;
  const d = r.depthOf(cxp, czp);
  if (d > 210 + (b - a) * 0.5) return;

  const halfW = cls.half + 1.2;
  /* The hillside above is a standing volume, so the bore has to be
     biased forward to punch through it — that bias is what reads as an
     opening in the rock. It is bounded so foreground objects still win. */
  const bias = -58;
  const n = Math.max(3, Math.min(16, Math.round((b - a) / 14)));
  const step = (b - a) / n;

  for (let k = 0; k < n; k += 1) {
    const c0 = a + step * k;
    const c1 = c0 + step;
    const x0 = vertical ? fixed : c0, z0 = vertical ? c0 : fixed;
    const x1 = vertical ? fixed : c1, z1 = vertical ? c1 : fixed;
    if (!r.visible((x0 + x1) / 2, (z0 + z1) / 2, step)) continue;
    const y0 = roadHeightAt(x0, z0);
    const y1 = roadHeightAt(x1, z1);
    const px = vertical ? halfW : 0;
    const pz = vertical ? 0 : halfW;
    // ceiling
    r.quad(
      [x0 - px, y0 + TUNNEL_H, z0 - pz], [x0 + px, y0 + TUNNEL_H, z0 + pz],
      [x1 + px, y1 + TUNNEL_H, z1 + pz], [x1 - px, y1 + TUNNEL_H, z1 - pz],
      "#22242a", { bias },
    );
    // walls
    for (const s of [-1, 1]) {
      const ax = x0 + (vertical ? s * halfW : 0);
      const az = z0 + (vertical ? 0 : s * halfW);
      const bx = x1 + (vertical ? s * halfW : 0);
      const bz = z1 + (vertical ? 0 : s * halfW);
      r.quad(
        [ax, y0, az], [bx, y1, bz],
        [bx, y1 + TUNNEL_H, bz], [ax, y0 + TUNNEL_H, az],
        s < 0 ? "#3a3d43" : "#33363c", { bias },
      );
    }
    // road surface inside, painted dark
    r.quad(
      [x0 - px, y0 + 0.03, z0 - pz], [x0 + px, y0 + 0.03, z0 + pz],
      [x1 + px, y1 + 0.03, z1 + pz], [x1 - px, y1 + 0.03, z1 - pz],
      "#2c2f34", { bias },
    );
    // sodium strip lights
    if (k % 2 === 0) {
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      r.billboard(mx, (y0 + y1) / 2 + TUNNEL_H - 0.7, mz, 2.6, 0.34, "#ffd9a0", 0.85);
    }
  }

  // portal facades — but not when we are inside looking out, where the far
  // end should be daylight rather than a black slab
  const camAlong = vertical ? r.cam.z : r.cam.x;
  const camAcross = Math.abs((vertical ? r.cam.x : r.cam.z) - fixed);
  const inside = camAcross < halfW + 2 && camAlong > a - 4 && camAlong < b + 4;
  for (const end of inside ? [] : [a, b]) {
    const x = vertical ? fixed : end;
    const z = vertical ? end : fixed;
    if (!r.visible(x, z, 26)) continue;
    const y = roadHeightAt(x, z);
    const px = vertical ? halfW + 3.4 : 0.8;
    const pz = vertical ? 0.8 : halfW + 3.4;
    r.quad(
      [x - px, y, z - pz], [x + px, y, z + pz],
      [x + px, y + TUNNEL_H + 3.6, z + pz], [x - px, y + TUNNEL_H + 3.6, z - pz],
      "#6b6459", { bias: bias + 4 },
    );
    // the dark mouth
    const mx = vertical ? halfW : 0.6;
    const mz = vertical ? 0.6 : halfW;
    r.quad(
      [x - mx, y, z - mz], [x + mx, y, z + mz],
      [x + mx, y + TUNNEL_H, z + mz], [x - mx, y + TUNNEL_H, z - mz],
      "#15171b", { bias: bias + 2 },
    );
  }
}

/* ------------------------------ scenery ------------------------------ */

const cellBuf = [];

export function drawScenery(r, city, dusk) {
  const cells = cellsAround(r.cam.x, r.cam.z, r.drawDist, cellBuf);
  for (let c = 0; c < cells.length; c += 1) {
    const list = city.scenery[cells[c]];
    if (!list) continue;
    for (let k = 0; k < list.length; k += 1) drawProp(r, list[k], dusk);
  }
}

export function drawStreetProps(r, city, dusk) {
  const cells = cellsAround(r.cam.x, r.cam.z, Math.min(r.drawDist, 230), cellBuf);
  for (let c = 0; c < cells.length; c += 1) {
    const list = city.props[cells[c]];
    if (!list) continue;
    for (let k = 0; k < list.length; k += 1) drawFurniture(r, list[k], dusk);
  }
}

const LIT_KINDS = { house: 1, shop: 1, tower: 1, terminal: 1, farm: 1 };

function drawProp(r, p, dusk) {
  if (!r.visible(p.x, p.z, p.r || 10)) return;
  const d = r.depthOf(p.x, p.z);
  if (dusk && d < 130 && LIT_KINDS[p.kind]) {
    // warm windows after dark, one soft sprite rather than a grid of quads
    r.billboard(p.x, p.y + (p.h || 4) * 0.42, p.z,
      Math.min(9, (p.w || 6) * 0.8), Math.min(7, (p.h || 4) * 0.4), "#ffd9a2", 0.32);
  }
  switch (p.kind) {
    case "tower": {
      /* The window bands cost a gradient build and a second fill per face,
         so they stop well before the building does. */
      const stripe = d < 112 && r.cam.y < p.y + 26
        ? { rows: Math.min(12, p.floors), color: `rgba(16,28,42,${d < 80 ? 0.62 : 0.42})` }
        : null;
      r.box(p.x, p.y, p.z, p.w, p.h, p.d, 0,
        [p.roof, shade(p.wall, -0.14), shade(p.wall, 0.06), p.wall, shade(p.wall, -0.06)],
        { stripe });
      if (d < 84 && r.cam.y < p.y + 30) {
        r.box(p.x, p.y, p.z, p.w + 0.25, 3.2, p.d + 0.25, 0,
          [null, shade(p.trim, -0.2), shade(p.trim, 0.02), p.trim, shade(p.trim, -0.1)]);
      }
      if (p.h > 24 && d < 118 && r.cam.y < p.y + p.h + 40) {
        r.box(p.x, p.y + p.h, p.z, p.w * 0.34, 2.6, p.d * 0.34, 0,
          [shade(p.roof, 0.12), shade(p.roof, -0.1), p.roof, shade(p.roof, 0.05), shade(p.roof, -0.05)]);
      }
      break;
    }
    case "house": {
      r.box(p.x, p.y, p.z, p.w, p.h, p.d, p.yaw || 0,
        [null, shade(p.wall, -0.13), shade(p.wall, 0.05), p.wall, shade(p.wall, -0.05)]);
      // pitched roof: a squat box plus a ridge, cheap but reads right
      r.box(p.x, p.y + p.h, p.z, p.w + 0.7, 0.35, p.d + 0.7, p.yaw || 0,
        [shade(p.roof, 0.1), shade(p.roof, -0.14), p.roof, shade(p.roof, 0.04), shade(p.roof, -0.06)]);
      r.box(p.x, p.y + p.h + 0.3, p.z, p.w * 0.72, 1.5, p.d * 0.72, p.yaw || 0,
        [shade(p.roof, 0.16), shade(p.roof, -0.1), shade(p.roof, 0.02), shade(p.roof, 0.08), shade(p.roof, -0.04)]);
      if (d < 90) {
        const s = Math.sin(p.yaw || 0), c = Math.cos(p.yaw || 0);
        r.box(p.x + s * (p.d / 2 + 0.06), p.y, p.z + c * (p.d / 2 + 0.06),
          1.0, 2.1, 0.12, p.yaw || 0, [null, "#5b4433", "#5b4433", "#5b4433", "#5b4433"]);
      }
      break;
    }
    case "shop": {
      r.box(p.x, p.y, p.z, p.w, p.h, p.d, p.yaw || 0,
        [shade(p.wall, 0.08), shade(p.wall, -0.13), shade(p.wall, 0.05), p.wall, shade(p.wall, -0.05)]);
      const s = Math.sin(p.yaw || 0), c = Math.cos(p.yaw || 0);
      r.box(p.x + s * (p.d / 2 + 0.5), p.y + p.h * 0.6, p.z + c * (p.d / 2 + 0.5),
        p.w * 0.9, 0.5, 1.2, p.yaw || 0,
        [shade(p.awning, 0.1), p.awning, shade(p.awning, 0.05), shade(p.awning, -0.12), shade(p.awning, -0.05)]);
      if (d < 95) {
        r.box(p.x + s * (p.d / 2 + 0.05), p.y + 0.2, p.z + c * (p.d / 2 + 0.05),
          p.w * 0.72, p.h * 0.5, 0.12, p.yaw || 0,
          [null, "#2a3d4c", "#2a3d4c", "#2a3d4c", "#2a3d4c"]);
      }
      break;
    }
    case "tree": {
      r.box(p.x, p.y, p.z, 0.62, p.h * 0.42, 0.62, 0,
        ["#5b4433", "#6b5140", "#5b4433", "#4d3a2c", "#563f30"]);
      r.box(p.x, p.y + p.h * 0.36, p.z, p.w, p.h * 0.68, p.w, 0.62,
        [shade(p.leaf, 0.22), p.leaf, shade(p.leaf, 0.1), shade(p.leaf, -0.16), shade(p.leaf, -0.06)]);
      break;
    }
    case "pine": {
      r.box(p.x, p.y, p.z, 0.55, p.h * 0.3, 0.55, 0,
        ["#4a3729", "#5a4535", "#4a3729", "#3f2f24", "#453427"]);
      r.box(p.x, p.y + p.h * 0.22, p.z, p.w, p.h * 0.45, p.w, 0.4,
        [null, p.leaf, shade(p.leaf, 0.08), shade(p.leaf, -0.14), shade(p.leaf, -0.05)]);
      r.box(p.x, p.y + p.h * 0.58, p.z, p.w * 0.66, p.h * 0.44, p.w * 0.66, 0.8,
        [shade(p.leaf, 0.18), shade(p.leaf, 0.04), shade(p.leaf, 0.12), shade(p.leaf, -0.12), shade(p.leaf, -0.03)]);
      break;
    }
    case "park":
      r.terrainRect(p.x, p.z, p.w, p.d, p.wall, 1, LAYER_GROUND);
      break;
    case "field":
      r.terrainRect(p.x, p.z, p.w, p.d, p.wall, 1, LAYER_GROUND);
      if (d < 120) {
        r.terrainRect(p.x, p.z, p.w, p.d * 0.06, shade(p.wall, -0.2), 0.5, LAYER_GROUND, 0.05);
      }
      break;
    case "apron":
      r.terrainRect(p.x, p.z, p.w, p.d, p.wall, 1, LAYER_GROUND);
      r.terrainRect(p.x, p.z, p.w * 0.9, 1.2, "#d8d2b0", 0.7, LAYER_GROUND, 0.06);
      break;
    case "farm": {
      r.box(p.x, p.y, p.z, p.w, p.h, p.d, p.yaw,
        [null, shade(p.wall, -0.12), shade(p.wall, 0.05), p.wall, shade(p.wall, -0.05)]);
      r.box(p.x, p.y + p.h, p.z, p.w + 0.6, 1.6, p.d + 0.6, p.yaw,
        [shade(p.roof, 0.1), shade(p.roof, -0.12), p.roof, shade(p.roof, 0.04), shade(p.roof, -0.05)]);
      r.box(p.x + p.w * 0.62, p.y, p.z, 3.4, p.h + 5, 3.4, 0,
        ["#c9ccd2", "#9aa0a8", "#b0b6bd", "#c9ccd2", "#949aa2"]);
      break;
    }
    case "rock": {
      r.box(p.x, p.y - p.h * 0.15, p.z, p.w, p.h, p.d, p.yaw,
        [shade(p.wall, 0.14), shade(p.wall, -0.16), shade(p.wall, 0.04), p.wall, shade(p.wall, -0.08)]);
      if (p.h > 7) {
        r.box(p.x + p.w * 0.12, p.y + p.h * 0.7, p.z - p.d * 0.1, p.w * 0.6, p.h * 0.5, p.d * 0.6,
          p.yaw + 0.6,
          [shade(p.wall, 0.2), shade(p.wall, -0.12), shade(p.wall, 0.08), shade(p.wall, 0.02), shade(p.wall, -0.05)]);
      }
      break;
    }
    case "terminal": {
      r.box(p.x, p.y, p.z, p.w, p.h, p.d, 0,
        [p.roof, shade(p.wall, -0.12), shade(p.wall, 0.05), p.wall, shade(p.wall, -0.05)],
        { stripe: d < 220 ? { rows: 3, color: "rgba(24,46,66,0.55)" } : null });
      r.box(p.x, p.y + p.h, p.z, p.w * 0.2, 9, p.d * 0.5, 0,
        ["#dfe4e8", "#9aa2aa", "#b3bac1", "#c9d0d6", "#9aa2aa"]);
      break;
    }
    case "hangar": {
      r.box(p.x, p.y, p.z, p.w, p.h, p.d, p.yaw,
        [p.roof, shade(p.wall, -0.12), shade(p.wall, 0.05), p.wall, shade(p.wall, -0.05)]);
      r.box(p.x, p.y + p.h, p.z, p.w * 0.98, 2.2, p.d * 0.7, p.yaw,
        [shade(p.roof, 0.12), shade(p.roof, -0.1), p.roof, shade(p.roof, 0.04), shade(p.roof, -0.05)]);
      break;
    }
    case "plane": {
      const s = Math.sin(p.yaw), c = Math.cos(p.yaw);
      r.box(p.x, p.y + 2.6, p.z, 3.4, 3.4, p.w, p.yaw,
        ["#eef1f4", "#c8ced4", "#dde2e7", "#eef1f4", "#c8ced4"]);
      r.box(p.x, p.y + 3.0, p.z, p.w * 0.92, 0.7, 3.6, p.yaw + Math.PI / 2,
        ["#e2e7ec", "#bcc3ca", "#d2d8de", "#e2e7ec", "#bcc3ca"]);
      r.box(p.x - s * p.w * 0.42, p.y + 5.6, p.z - c * p.w * 0.42, 0.6, 4.4, 4.2, p.yaw,
        [null, "#2c6fb5", "#3a7cc0", "#2c6fb5", "#3a7cc0"]);
      break;
    }
    default: break;
  }
}

function drawFurniture(r, p, dusk) {
  if (p.kind === "rail") {
    drawRail(r, p);
    return;
  }
  if (!r.visible(p.x, p.z, p.r || 8)) return;
  switch (p.kind) {
    case "lamp":
      r.box(p.x, p.y, p.z, 0.34, 7.4, 0.34, 0, ["#9aa0a8", "#7c828a", "#8b9199", "#9aa0a8", "#767c84"]);
      r.box(p.x, p.y + 7.2, p.z, 1.5, 0.4, 0.5, 0, ["#9aa0a8", "#7c828a", "#8b9199", "#9aa0a8", "#767c84"]);
      if (dusk) r.billboard(p.x, p.y + 6.6, p.z, 2.2, 2.2, "#ffe9b0", 0.35);
      break;
    case "post":
      r.box(p.x, p.y, p.z, 0.16, 1.1, 0.16, 0, ["#e4e6e8", "#b6babe", "#cdd1d5", "#e4e6e8", "#b6babe"]);
      r.billboard(p.x, p.y + 0.75, p.z, 0.3, 0.3, "#e03a2f", 0.9);
      break;
    case "tree":
      r.box(p.x, p.y, p.z, 0.6, 2.4, 0.6, 0, ["#5b4433", "#6b5140", "#5b4433", "#4d3a2c", "#563f30"]);
      r.box(p.x, p.y + 2.1, p.z, 4.2, 4.6, 4.2, 0.7,
        ["#4f9a5c", "#2f7a41", "#3d8c4d", "#469556", "#357f45"]);
      break;
    case "sign": {
      const w = p.big ? 4.6 : 2.4;
      const h = p.big ? 2.4 : 1.2;
      r.box(p.x, p.y, p.z, 0.24, 4.2, 0.24, 0, ["#8a9096", "#6c7278", "#7b8187", "#8a9096", "#666c72"]);
      r.box(p.x, p.y + 4.0, p.z, p.yaw ? 0.2 : w, h, p.yaw ? w : 0.2, 0,
        [null, "#1f6f4a", "#248055", "#1f6f4a", "#248055"]);
      break;
    }
    default: break;
  }
}

function drawRail(r, p) {
  const len = p.b - p.a;
  const n = Math.max(2, Math.min(12, Math.round(len / 18)));
  const step = len / n;
  for (let k = 0; k < n; k += 1) {
    const c = p.a + step * (k + 0.5);
    const x = p.vertical ? p.x : c;
    const z = p.vertical ? c : p.z;
    const d = r.depthOf(x, z);
    if (!r.visible(x, z, step) || d > 150) continue;
    const y = roadHeightAt(x, z);
    for (const s of [-1, 1]) {
      const rx = p.vertical ? x + s * p.off : x;
      const rz = p.vertical ? z : z + s * p.off;
      /* Only the long faces of the beam. Its end caps run across the road
         and, because the carriageway is a flat decal painted before every
         volume, each cap gets ruled over the tarmac like a barrier. */
      const cols = p.vertical
        ? [null, null, "#b7bbc0", null, "#93989d"]
        : ["#b7bbc0", null, "#93989d", null, null];
      r.box(rx, y + 0.52, rz, p.vertical ? 0.16 : step, 0.4, p.vertical ? step : 0.16, 0,
        p.vertical ? cols : [null, "#b7bbc0", null, "#93989d", null]);
      // posts, so the beam is held up rather than floating
      if (d < 95) {
        const px = p.vertical ? rx : c - step * 0.5 + 0.1;
        const pz = p.vertical ? c - step * 0.5 + 0.1 : rz;
        r.box(px, y, pz, 0.18, 0.62, 0.18, 0,
          [null, "#8b9095", "#7a7f84", "#8b9095", "#7a7f84"]);
      }
    }
  }
}

/* ------------------------------ bus stops ------------------------------ */

export function drawStops(r, stops, activeId, t) {
  for (let i = 0; i < stops.length; i += 1) {
    const s = stops[i];
    if (!r.visible(s.shelterX, s.shelterZ, 14)) continue;
    const active = s.id === activeId;
    const y = s.shelterY;

    // bay markings on the tarmac
    r.roadRect(s.x, s.z, s.vertical ? 1.2 : 9, s.vertical ? 9 : 1.2,
      active ? "#f2c53d" : "#c9c2ae", active ? 0.95 : 0.5, LAYER_BAY, 0.06);
    r.roadRect(s.x, s.z, s.vertical ? 4.4 : 13, s.vertical ? 13 : 4.4,
      active ? "#f0b429" : "#8c8a80", active ? 0.24 : 0.16, LAYER_BAY, 0.05);

    // shelter — fades out at very close range so it cannot swallow the
    // camera when the bus pulls right up to the kerb
    const glass = active ? "#2c6f8f" : "#3a5566";
    const near = r.depthOf(s.shelterX, s.shelterZ);
    const glassAlpha = near > 9 ? 0.72 : Math.max(0.04, 0.72 * ((near - 3) / 6));
    r.box(s.shelterX, y, s.shelterZ, s.vertical ? 1.4 : 7.4, 2.9, s.vertical ? 7.4 : 1.4, 0,
      [null, glass, shade(glass, 0.1), glass, shade(glass, -0.1)], { alpha: glassAlpha });
    r.box(s.shelterX, y + 2.9, s.shelterZ, s.vertical ? 2.6 : 8.2, 0.32, s.vertical ? 8.2 : 2.6, 0,
      ["#d64545", "#9e3232", "#c03b3b", "#d64545", "#a83636"]);
    // pole + sign, set a little along the kerb from the shelter
    const px = s.shelterX + (s.vertical ? 0 : 4.6);
    const pz = s.shelterZ + (s.vertical ? 4.6 : 0);
    const py = roadHeightAt(px, pz);
    r.box(px, py, pz, 0.22, 3.6, 0.22, 0, ["#c9ccd2", "#9aa0a8", "#b0b6bd", "#c9ccd2", "#949aa2"]);
    const pulse = active ? 0.6 + 0.4 * Math.sin(t * 4) : 1;
    r.box(px, py + 3.4, pz, 1.7, 1.1, 0.16, 0,
      [null, active ? "#f5c518" : "#e8e2d2", "#cfc9ba", active ? "#f5c518" : "#e8e2d2", "#cfc9ba"],
      { alpha: pulse });
    if (active) r.billboard(px, py + 4.6, pz, 3.2, 3.2, "#ffd84d", 0.22 + 0.12 * Math.sin(t * 3));
  }
}

/* --------------------------- vehicles & people --------------------------- */

export function drawCar(r, c) {
  if (!r.visible(c.x, c.z, 5)) return;
  const yaw = c.yaw;
  const y = c.y || 0;
  r.box(c.x, y + 0.28, c.z, c.w, c.h * 0.55, c.l, yaw,
    [shade(c.color, 0.1), shade(c.color, -0.18), shade(c.color, 0.05), c.color, shade(c.color, -0.08)]);
  const cabW = c.w * 0.9;
  r.box(c.x - Math.sin(yaw) * c.l * 0.04, y + 0.28 + c.h * 0.55, c.z - Math.cos(yaw) * c.l * 0.04,
    cabW, c.h * 0.42, c.l * (c.van ? 0.62 : 0.46), yaw,
    [shade(c.color, -0.05), "#1f2c3a", "#28384a", "#22303f", "#28384a"]);
  // wheels
  const s = Math.sin(yaw), co = Math.cos(yaw);
  for (let i = -1; i <= 1; i += 2) {
    for (let k = -1; k <= 1; k += 2) {
      const ox = i * c.w * 0.44, oz = k * c.l * 0.32;
      r.box(c.x + ox * co + oz * s, y, c.z - ox * s + oz * co, 0.34, 0.62, 0.68, yaw,
        ["#22252a", "#16181c", "#1c1f24", "#22252a", "#16181c"]);
    }
  }
  if (c.brakeGlow) {
    const bz = -c.l * 0.5;
    r.billboard(c.x + bz * s, y + 0.7, c.z + bz * co, 1.6, 0.5, "#ff4436", 0.85);
  }
}

export function drawPed(r, p) {
  if (!r.visible(p.x, p.z, 3)) return;
  const y = p.y || 0;
  const sway = Math.sin(p.phase) * 0.12;
  r.box(p.x, y, p.z, 0.42, 0.86, 0.34, p.yaw + sway,
    [null, shade(p.trouser, -0.1), p.trouser, shade(p.trouser, 0.05), shade(p.trouser, -0.05)]);
  r.box(p.x, y + 0.84, p.z, 0.52, 0.68, 0.36, p.yaw,
    [shade(p.shirt, 0.1), shade(p.shirt, -0.12), p.shirt, shade(p.shirt, 0.04), shade(p.shirt, -0.06)]);
  r.box(p.x, y + 1.5, p.z, 0.3, 0.3, 0.3, p.yaw,
    [shade(p.skin, 0.1), shade(p.skin, -0.12), p.skin, shade(p.skin, 0.02), shade(p.skin, -0.06)]);
}

export function drawTrafficLight(r, l, t) {
  const cv = vClass(l.i), ch = hClass(l.j);
  const offX = cv.half + 1.6;
  const offZ = ch.half + 1.6;
  const heads = [
    { x: l.x - offX, z: l.z - offZ, vertical: true },
    { x: l.x + offX, z: l.z + offZ, vertical: true },
    { x: l.x + offX, z: l.z - offZ, vertical: false },
    { x: l.x - offX, z: l.z + offZ, vertical: false },
  ];
  for (const h of heads) {
    if (!r.visible(h.x, h.z, 7)) continue;
    const y = l.y;
    r.box(h.x, y, h.z, 0.26, 5.2, 0.26, 0, ["#4a4f57", "#33373d", "#3e434a", "#4a4f57", "#2e3238"]);
    r.box(h.x, y + 4.2, h.z, 0.8, 2.1, 0.8, 0, ["#2b2f35", "#1f2329", "#25292f", "#2b2f35", "#1f2329"]);
    const p = l.phase;
    const green = h.vertical ? p === 0 : p === 2;
    const amber = h.vertical ? p === 1 : p === 3;
    const red = !green && !amber;
    const flash = 0.6 + 0.4 * Math.sin(t * 12);
    r.billboard(h.x, y + 5.55, h.z, 0.44, 0.44, red ? "#ff3b30" : "#37424a", 1);
    r.billboard(h.x, y + 5.05, h.z, 0.44, 0.44, amber ? "#ffb020" : "#3d3a30", amber ? flash : 1);
    r.billboard(h.x, y + 4.55, h.z, 0.44, 0.44, green ? "#31d158" : "#2c3d31", 1);
  }
}

/* --------------------------------- bus --------------------------------- */

export const BUS = { len: 12.2, wid: 2.62, hgt: 3.15, wheelbase: 7.6 };

export function drawBus(r, bus, t) {
  const yaw = bus.yaw;
  const s = Math.sin(yaw), c = Math.cos(yaw);
  const y = bus.y || 0;
  const body = bus.livery || "#f0b429";
  const dark = shade(body, -0.22);

  r.box(bus.x, y + 0.32, bus.z, BUS.wid, 1.35, BUS.len, yaw,
    [null, shade(dark, -0.1), dark, shade(dark, 0.04), shade(dark, -0.06)]);
  r.box(bus.x, y + 1.5, bus.z, BUS.wid, 1.35, BUS.len, yaw,
    [null, "#20313f", "#26394a", "#20313f", "#26394a"]);
  r.box(bus.x, y + 2.7, bus.z, BUS.wid, 0.5, BUS.len, yaw,
    [shade(body, 0.14), shade(body, -0.1), body, shade(body, 0.04), shade(body, -0.04)]);
  const fx = bus.x + s * (BUS.len / 2 - 0.6);
  const fz = bus.z + c * (BUS.len / 2 - 0.6);
  r.box(fx, y + 0.32, fz, BUS.wid + 0.04, 2.55, 1.2, yaw,
    [shade(body, 0.1), body, shade(body, 0.05), shade(body, -0.12), shade(body, -0.04)]);
  const rx = bus.x - s * (BUS.len / 2 - 0.6);
  const rz = bus.z - c * (BUS.len / 2 - 0.6);
  r.box(rx, y + 0.32, rz, BUS.wid + 0.04, 2.7, 1.2, yaw,
    [shade(body, 0.08), shade(body, -0.12), shade(body, 0.02), body, shade(body, -0.05)]);
  r.box(bus.x, y + 3.2, bus.z, BUS.wid - 0.12, 0.16, BUS.len - 0.5, yaw,
    [shade(body, 0.3), shade(body, 0.1), shade(body, 0.18), shade(body, 0.1), shade(body, 0.18)]);
  r.box(bus.x, y + 1.34, bus.z, BUS.wid + 0.06, 0.22, BUS.len - 0.2, yaw,
    [null, "#c0392b", "#c0392b", "#c0392b", "#c0392b"]);

  for (const [ox, oz] of [[-1, 4.0], [1, 4.0], [-1, -3.4], [1, -3.4], [-1, -4.9], [1, -4.9]]) {
    const wx = bus.x + ox * (BUS.wid / 2 + 0.02) * c + oz * s;
    const wz = bus.z - ox * (BUS.wid / 2 + 0.02) * s + oz * c;
    const wYaw = oz > 0 ? yaw + bus.steerAngle * 0.9 : yaw;
    r.box(wx, y, wz, 0.42, 1.06, 1.14, wYaw, ["#2b2f35", "#15171b", "#1b1e22", "#2b2f35", "#15171b"]);
  }

  const lit = bus.headlights;
  for (const side of [-1, 1]) {
    const hx = fx + side * 0.95 * c + 0.55 * s;
    const hz = fz - side * 0.95 * s + 0.55 * c;
    r.billboard(hx, y + 0.85, hz, 0.72, 0.42, lit ? "#fff4c9" : "#cfd6dd", 1);
    const tx = rx + side * 0.95 * c - 0.6 * s;
    const tz = rz - side * 0.95 * s - 0.6 * c;
    r.billboard(tx, y + 0.9, tz, 0.66, 0.4, bus.brake > 0.05 ? "#ff3b30" : "#8e2d28", 1);
  }
  if (bus.indicator) {
    const on = Math.sin(t * 8) > 0;
    const side = bus.indicator === "left" ? -1 : 1;
    if (on) {
      const ix = fx + side * 1.1 * c + 0.4 * s;
      const iz = fz - side * 1.1 * s + 0.4 * c;
      r.billboard(ix, y + 1.25, iz, 0.6, 0.36, "#ff9a1f", 1);
      const jx = rx + side * 1.1 * c - 0.5 * s;
      const jz = rz - side * 1.1 * s - 0.5 * c;
      r.billboard(jx, y + 1.3, jz, 0.6, 0.36, "#ff9a1f", 1);
    }
  }
  const doorOpen = bus.doorT;
  for (const oz of [3.1, -1.0]) {
    const dw = 1.1;
    const dx = bus.x + (BUS.wid / 2 + 0.04) * c + oz * s;
    const dz = bus.z - (BUS.wid / 2 + 0.04) * s + oz * c;
    r.box(dx, y + 0.5, dz, 0.12, 2.3, dw, yaw + doorOpen * 1.25,
      [null, "#1b2836", "#233243", "#1b2836", "#233243"]);
  }
}

/** Soft contact shadow under a box-ish object. */
export function drawShadow(r, x, z, w, l, yaw, alpha, y) {
  const hw = w / 2, hl = l / 2;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const yy = (y || 0) + 0.03;
  const pt = (lx, lz) => [x + lx * c + lz * s, yy, z - lx * s + lz * c];
  r.quad(pt(-hw, -hl), pt(hw, -hl), pt(hw, hl), pt(-hw, hl), "#1a1e18",
    { alpha: alpha || 0.28, layer: LAYER_SHADOW });
}

export { DRAW_DIST };
