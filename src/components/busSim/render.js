/* ------------------------------------------------------------------ *
 * City Bus Simulator — software 3D renderer on a 2D canvas.
 *
 * No WebGL and no libraries: convex polygons are transformed into
 * camera space, clipped against the near plane, projected, then drawn
 * back-to-front with the painter's algorithm.
 *
 * Two things keep it fast enough for a full city at 60fps:
 *  - Flat ground decals (tarmac, markings) are painted as a layer
 *    before any volume, so they never enter the sort.
 *  - Everything is distance- and frustum-culled before transforming,
 *    and building windows are one gradient fill per face instead of
 *    hundreds of little quads.
 * ------------------------------------------------------------------ */

import {
  BLOCK, GRID, ROAD_HALF, PAVE_W, KERB, LANE, clamp, lerp,
} from "./city.js";

const NEAR = 0.32;
const DRAW_DIST = 210;
const FOG_START = 90;
const FOG_STEPS = 14;

/* Paint order for everything that lies flat on the ground, followed by
   every standing volume. Lower numbers are painted first. */
export const LAYER_GROUND = 0;   // block interiors
export const LAYER_PAVE = 1;     // pavements and kerbs
export const LAYER_TARMAC = 2;
export const LAYER_MARK = 3;     // lane lines, crossings
export const LAYER_BAY = 4;      // bus stop bays
export const LAYER_GUIDE = 5;    // route chevrons
export const LAYER_SHADOW = 6;
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
   *
   * `layer` keeps coplanar ground work in a fixed paint order — tarmac,
   * then markings, then shadows — and guarantees every flat decal is
   * laid down before any standing volume, so a near stretch of road can
   * never paint over the base of a building behind it.
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
    it.depth = sum / cn + (bias || 0);
    it.layer = layer === undefined ? LAYER_VOLUME : layer;
    const step = Math.round(clamp((it.depth - FOG_START) / (DRAW_DIST - FOG_START), 0, 1) * FOG_STEPS);
    it.color = foggy(color, step);
    it.stripe = stripe || null;
    it.alpha = alpha === undefined ? 1 : alpha;
    it.minY = minY; it.maxY = maxY;
    list.push(it);
    return it;
  }

  const IDX4 = [0, 1, 2, 3];

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

  /** Flat ground quad, axis aligned, centred on (x,z). */
  function groundRect(x, z, w, d, color, alpha, layer) {
    const hw = w / 2, hd = d / 2;
    toCam(0, x - hw, 0, z - hd);
    toCam(1, x + hw, 0, z - hd);
    toCam(2, x + hw, 0, z + hd);
    toCam(3, x - hw, 0, z + hd);
    return emit(IDX4, 4, color, null, alpha, layer === undefined ? LAYER_TARMAC : layer, 0);
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
        opts && opts.alpha, LAYER_VOLUME, opts && opts.bias,
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
    if (d2 > (DRAW_DIST + r) * (DRAW_DIST + r)) return false;
    const ex = dx * cosY - dz * sinY;
    const lim = Math.abs(ez) * tanHalf * (W / H) + r + 6;
    return Math.abs(ex) <= lim;
  }

  function depthOf(x, z) {
    const dx = x - cam.x, dz = z - cam.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  /* ------------------------------ painting ------------------------------ */

  function paint(ctx) {
    list.sort((a, b) => (a.layer - b.layer) || (b.depth - a.depth));
    let lastColor = "";
    let lastAlpha = 1;
    for (let i = 0; i < list.length; i += 1) {
      const it = list[i];
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
  }

  return {
    cam,
    setSize, setFog, beginFrame, paint,
    quad, groundRect, box, billboard, visible, depthOf,
    get width() { return W; },
    get height() { return H; },
    get focal() { return focal; },
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
 * Scene drawing — city geometry pushed into the renderer each frame.
 * ------------------------------------------------------------------ */

const SKY_TOP = "#3b74b8";
const SKY_MID = "#8fbbe2";
const HORIZON = "#c6d8e6";
const GROUND = "#6f7a63";
const TARMAC = "#43474d";
const TARMAC_2 = "#3d4147";
const PAVEMENT = "#9a9a92";
const KERB_COL = "#7e7e76";
const MARK = "#d9d4c2";

export function drawSky(ctx, r, W, H, dusk) {
  const hy = r.horizonY();
  const g = ctx.createLinearGradient(0, Math.min(0, hy - H), 0, hy);
  if (dusk) {
    // pitched bright because a multiply pass darkens the whole frame later
    g.addColorStop(0, "#33478a");
    g.addColorStop(0.55, "#8d7fc4");
    g.addColorStop(1, "#ffc38c");
  } else {
    g.addColorStop(0, SKY_TOP);
    g.addColorStop(0.6, SKY_MID);
    g.addColorStop(1, HORIZON);
  }
  ctx.fillStyle = g;
  ctx.fillRect(-W, Math.min(-H, hy - H * 2), W * 3, Math.max(0, hy) + H * 2);

  if (hy < H) {
    // the near edge of the ground meets the same haze the far tarmac
    // fogs into, so the end of the drawn road is not a hard line
    const gg = ctx.createLinearGradient(0, hy, 0, hy + H * 0.6);
    gg.addColorStop(0, dusk ? "#3a3a4d" : HORIZON);
    gg.addColorStop(0.22, dusk ? "#43434f" : "#939c88");
    gg.addColorStop(1, dusk ? "#23232b" : GROUND);
    ctx.fillStyle = gg;
    ctx.fillRect(-W, hy, W * 3, H * 2);
  }
}

export function drawClouds(ctx, r, W, t, dusk) {
  const hy = r.horizonY();
  if (hy < -80) return;
  ctx.save();
  ctx.globalAlpha = dusk ? 0.28 : 0.5;
  ctx.fillStyle = dusk ? "#8e7fa8" : "#ffffff";
  const yaw = r.cam.yaw;
  for (let i = 0; i < 9; i += 1) {
    const base = i * 0.7 + t * 0.004;
    const ang = ((base % (Math.PI * 2)) - yaw + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    if (Math.abs(ang) > 1.2) continue;
    const x = W / 2 + Math.tan(ang) * r.focal;
    const y = hy - 60 - (i % 3) * 46 - 30;
    const w = 150 + (i % 4) * 70;
    ctx.beginPath();
    ctx.ellipse(x, y, w, 20 + (i % 3) * 7, 0, 0, Math.PI * 2);
    ctx.ellipse(x + w * 0.4, y + 8, w * 0.55, 15, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* -------------------------- static road painting -------------------------- */

/**
 * Roads are emitted per block-segment so the painter sort behaves, and
 * only within a radius of the camera.
 */
const ROAD_DIST = 165;   // road surfacing fades out sooner than buildings
const MARK_DIST = 95;    // lane lines and crossings, sooner still

export function drawRoads(r) {
  const camI = Math.round(r.cam.x / BLOCK);
  const camJ = Math.round(r.cam.z / BLOCK);
  const span = Math.ceil(ROAD_DIST / BLOCK) + 1;
  const segLen = BLOCK - ROAD_HALF * 2;

  for (let i = camI - span; i <= camI + span; i += 1) {
    if (i < 0 || i > GRID) continue;
    for (let j = camJ - span; j <= camJ + span; j += 1) {
      if (j < 0 || j > GRID) continue;
      const ix = i * BLOCK;
      const jz = j * BLOCK;

      // intersection square
      if (r.visible(ix, jz, 18) && r.depthOf(ix, jz) < ROAD_DIST) {
        r.groundRect(ix, jz, ROAD_HALF * 2, ROAD_HALF * 2, TARMAC_2, 1, LAYER_TARMAC);
        if (r.depthOf(ix, jz) < MARK_DIST) drawCrossings(r, ix, jz);
      }

      // segment heading north from this intersection
      if (j < GRID) {
        const cz = jz + BLOCK / 2;
        const d = r.depthOf(ix, cz);
        if (d < ROAD_DIST + BLOCK && r.visible(ix, cz, BLOCK * 0.6)) {
          r.groundRect(ix, cz, ROAD_HALF * 2, segLen, TARMAC, 1, LAYER_TARMAC);
          r.groundRect(ix - KERB + PAVE_W / 2, cz, PAVE_W, segLen, PAVEMENT, 1, LAYER_PAVE);
          r.groundRect(ix + KERB - PAVE_W / 2, cz, PAVE_W, segLen, PAVEMENT, 1, LAYER_PAVE);
          if (d < MARK_DIST + BLOCK) {
            r.groundRect(ix - ROAD_HALF - 0.28, cz, 0.56, segLen, KERB_COL, 1, LAYER_PAVE);
            r.groundRect(ix + ROAD_HALF + 0.28, cz, 0.56, segLen, KERB_COL, 1, LAYER_PAVE);
            const dashes = 7;
            const step = segLen / dashes;
            for (let k = 0; k < dashes; k += 1) {
              const z = jz + ROAD_HALF + step * (k + 0.5);
              if (r.depthOf(ix, z) > MARK_DIST || !r.visible(ix, z, 4)) continue;
              r.groundRect(ix, z, 0.32, step * 0.45, MARK, 0.85, LAYER_MARK);
            }
          }
        }
      }

      // segment heading east
      if (i < GRID) {
        const cxx = ix + BLOCK / 2;
        const d = r.depthOf(cxx, jz);
        if (d < ROAD_DIST + BLOCK && r.visible(cxx, jz, BLOCK * 0.6)) {
          r.groundRect(cxx, jz, segLen, ROAD_HALF * 2, TARMAC, 1, LAYER_TARMAC);
          r.groundRect(cxx, jz - KERB + PAVE_W / 2, segLen, PAVE_W, PAVEMENT, 1, LAYER_PAVE);
          r.groundRect(cxx, jz + KERB - PAVE_W / 2, segLen, PAVE_W, PAVEMENT, 1, LAYER_PAVE);
          if (d < MARK_DIST + BLOCK) {
            r.groundRect(cxx, jz - ROAD_HALF - 0.28, segLen, 0.56, KERB_COL, 1, LAYER_PAVE);
            r.groundRect(cxx, jz + ROAD_HALF + 0.28, segLen, 0.56, KERB_COL, 1, LAYER_PAVE);
            const dashes = 7;
            const step = segLen / dashes;
            for (let k = 0; k < dashes; k += 1) {
              const x = ix + ROAD_HALF + step * (k + 0.5);
              if (r.depthOf(x, jz) > MARK_DIST || !r.visible(x, jz, 4)) continue;
              r.groundRect(x, jz, step * 0.45, 0.32, MARK, 0.85, LAYER_MARK);
            }
          }
        }
      }

      // block interior ground (courtyard between the buildings)
      if (i < GRID && j < GRID) {
        const bx = ix + BLOCK / 2;
        const bz = jz + BLOCK / 2;
        if (r.visible(bx, bz, BLOCK)) {
          r.groundRect(bx, bz, BLOCK - KERB * 2, BLOCK - KERB * 2, "#7d7d72", 1, LAYER_GROUND);
        }
      }
    }
  }
}

function drawCrossings(r, x, z) {
  const stripes = 5;
  const wid = ROAD_HALF * 2 * 0.82;
  const step = wid / stripes;
  for (let s = 0; s < stripes; s += 1) {
    const off = -wid / 2 + step * (s + 0.5);
    r.groundRect(x + off, z - ROAD_HALF - 1.5, step * 0.55, 2.4, MARK, 0.8, LAYER_MARK);
    r.groundRect(x + off, z + ROAD_HALF + 1.5, step * 0.55, 2.4, MARK, 0.8, LAYER_MARK);
    r.groundRect(x - ROAD_HALF - 1.5, z + off, 2.4, step * 0.55, MARK, 0.8, LAYER_MARK);
    r.groundRect(x + ROAD_HALF + 1.5, z + off, 2.4, step * 0.55, MARK, 0.8, LAYER_MARK);
  }
}

/* ------------------------------ buildings ------------------------------ */

export function drawBuildings(r, buildings) {
  for (let i = 0; i < buildings.length; i += 1) {
    const b = buildings[i];
    const rad = Math.max(b.w, b.d) * 0.75 + b.h * 0.2;
    if (!r.visible(b.x, b.z, rad)) continue;

    if (b.park) {
      r.groundRect(b.x, b.z, b.w, b.d, b.wall, 1);
      continue;
    }
    if (b.tree) {
      r.box(b.x, 0, b.z, 0.7, b.h * 0.45, 0.7, 0, ["#5b4433", "#6b5140", "#5b4433", "#4d3a2c", "#563f30"]);
      const cw = b.w;
      r.box(b.x, b.h * 0.4, b.z, cw, b.h * 0.6, cw, 0.6,
        [shade(b.wall, 0.22), b.wall, shade(b.wall, 0.1), shade(b.wall, -0.16), shade(b.wall, -0.06)]);
      continue;
    }

    // window bands read as noise from directly overhead, so skip them there
    const d = r.depthOf(b.x, b.z);
    const stripe = d < 155 && r.cam.y < 25
      ? { rows: Math.min(14, b.floors), color: `rgba(16,28,42,${d < 90 ? 0.62 : 0.42})` }
      : null;
    r.box(
      b.x, 0, b.z, b.w, b.h, b.d, 0,
      [b.roof, shade(b.wall, -0.14), shade(b.wall, 0.06), b.wall, shade(b.wall, -0.06)],
      { stripe },
    );
    // ground-floor band so the base does not read as a bare slab
    if (d < 120) {
      r.box(b.x, 0, b.z, b.w + 0.25, 3.2, b.d + 0.25, 0,
        [null, shade(b.trim, -0.2), shade(b.trim, 0.02), b.trim, shade(b.trim, -0.1)]);
    }
    if (b.h > 22 && d < 160) {
      r.box(b.x, b.h, b.z, b.w * 0.34, 2.6, b.d * 0.34, 0,
        [shade(b.roof, 0.12), shade(b.roof, -0.1), b.roof, shade(b.roof, 0.05), shade(b.roof, -0.05)]);
    }
  }
}

export function drawProps(r, props, dusk) {
  for (let i = 0; i < props.length; i += 1) {
    const p = props[i];
    if (!r.visible(p.x, p.z, 6)) continue;
    if (p.type === "lamp") {
      r.box(p.x, 0, p.z, 0.34, 7.4, 0.34, 0, ["#9aa0a8", "#7c828a", "#8b9199", "#9aa0a8", "#767c84"]);
      r.box(p.x, 7.2, p.z, 1.5, 0.4, 0.5, 0, ["#9aa0a8", "#7c828a", "#8b9199", "#9aa0a8", "#767c84"]);
      if (dusk) r.billboard(p.x, 6.6, p.z, 2.2, 2.2, "#ffe9b0", 0.35);
    } else {
      r.box(p.x, 0, p.z, 0.6, 2.4, 0.6, 0, ["#5b4433", "#6b5140", "#5b4433", "#4d3a2c", "#563f30"]);
      r.box(p.x, 2.1, p.z, 4.2, 4.6, 4.2, 0.7,
        ["#4f9a5c", "#2f7a41", "#3d8c4d", "#469556", "#357f45"]);
    }
  }
}

/* ------------------------------ bus stops ------------------------------ */

export function drawStops(r, stops, activeId, t) {
  for (let i = 0; i < stops.length; i += 1) {
    const s = stops[i];
    if (!r.visible(s.shelterX, s.shelterZ, 12)) continue;
    const active = s.id === activeId;

    // bay markings on the tarmac
    r.groundRect(s.x, s.z, s.vertical ? 1.2 : 9, s.vertical ? 9 : 1.2,
      active ? "#f2c53d" : "#c9c2ae", active ? 0.95 : 0.5, LAYER_BAY);
    r.groundRect(s.x, s.z, s.vertical ? 4.4 : 13, s.vertical ? 13 : 4.4,
      active ? "#f0b429" : "#8c8a80", active ? 0.24 : 0.16, LAYER_BAY);

    // shelter — fades out at very close range so it cannot swallow the
    // camera when the bus pulls right up to the kerb
    const glass = active ? "#2c6f8f" : "#3a5566";
    const near = r.depthOf(s.shelterX, s.shelterZ);
    const glassAlpha = near > 9 ? 0.72 : Math.max(0.04, 0.72 * ((near - 3) / 6));
    r.box(s.shelterX, 0, s.shelterZ, s.vertical ? 1.4 : 7.4, 2.9, s.vertical ? 7.4 : 1.4, 0,
      [null, glass, shade(glass, 0.1), glass, shade(glass, -0.1)], { alpha: glassAlpha });
    r.box(s.shelterX, 2.9, s.shelterZ, s.vertical ? 2.6 : 8.2, 0.32, s.vertical ? 8.2 : 2.6, 0,
      ["#d64545", "#9e3232", "#c03b3b", "#d64545", "#a83636"]);
    // pole + sign, set a little along the kerb from the shelter
    const px = s.shelterX + (s.vertical ? 0 : 4.6);
    const pz = s.shelterZ + (s.vertical ? 4.6 : 0);
    r.box(px, 0, pz, 0.22, 3.6, 0.22, 0, ["#c9ccd2", "#9aa0a8", "#b0b6bd", "#c9ccd2", "#949aa2"]);
    const pulse = active ? 0.6 + 0.4 * Math.sin(t * 4) : 1;
    r.box(px, 3.4, pz, 1.7, 1.1, 0.16, 0,
      [null, active ? "#f5c518" : "#e8e2d2", "#cfc9ba", active ? "#f5c518" : "#e8e2d2", "#cfc9ba"],
      { alpha: pulse });
    if (active) r.billboard(px, 4.6, pz, 3.2, 3.2, "#ffd84d", 0.22 + 0.12 * Math.sin(t * 3));
  }
}

/* --------------------------- vehicles & people --------------------------- */

export function drawCar(r, c) {
  if (!r.visible(c.x, c.z, 5)) return;
  const yaw = c.yaw;
  r.box(c.x, 0.28, c.z, c.w, c.h * 0.55, c.l, yaw,
    [shade(c.color, 0.1), shade(c.color, -0.18), shade(c.color, 0.05), c.color, shade(c.color, -0.08)]);
  const cabW = c.w * 0.9;
  r.box(c.x - Math.sin(yaw) * c.l * 0.04, 0.28 + c.h * 0.55, c.z - Math.cos(yaw) * c.l * 0.04,
    cabW, c.h * 0.42, c.l * (c.van ? 0.62 : 0.46), yaw,
    [shade(c.color, -0.05), "#1f2c3a", "#28384a", "#22303f", "#28384a"]);
  // wheels
  const s = Math.sin(yaw), co = Math.cos(yaw);
  for (let i = -1; i <= 1; i += 2) {
    for (let k = -1; k <= 1; k += 2) {
      const ox = i * c.w * 0.44, oz = k * c.l * 0.32;
      r.box(c.x + ox * co + oz * s, 0, c.z - ox * s + oz * co, 0.34, 0.62, 0.68, yaw,
        ["#22252a", "#16181c", "#1c1f24", "#22252a", "#16181c"]);
    }
  }
  if (c.brakeGlow) {
    const bz = -c.l * 0.5;
    r.billboard(c.x + bz * s, 0.7, c.z + bz * co, 1.6, 0.5, "#ff4436", 0.85);
  }
}

export function drawPed(r, p) {
  if (!r.visible(p.x, p.z, 3)) return;
  const sway = Math.sin(p.phase) * 0.12;
  r.box(p.x, 0, p.z, 0.42, 0.86, 0.34, p.yaw + sway,
    [null, shade(p.trouser, -0.1), p.trouser, shade(p.trouser, 0.05), shade(p.trouser, -0.05)]);
  r.box(p.x, 0.84, p.z, 0.52, 0.68, 0.36, p.yaw,
    [shade(p.shirt, 0.1), shade(p.shirt, -0.12), p.shirt, shade(p.shirt, 0.04), shade(p.shirt, -0.06)]);
  r.box(p.x, 1.5, p.z, 0.3, 0.3, 0.3, p.yaw,
    [shade(p.skin, 0.1), shade(p.skin, -0.12), p.skin, shade(p.skin, 0.02), shade(p.skin, -0.06)]);
}

export function drawTrafficLight(r, l, t) {
  const off = ROAD_HALF + 1.6;
  const heads = [
    { x: l.x - off, z: l.z - off, vertical: true },
    { x: l.x + off, z: l.z + off, vertical: true },
    { x: l.x + off, z: l.z - off, vertical: false },
    { x: l.x - off, z: l.z + off, vertical: false },
  ];
  for (const h of heads) {
    if (!r.visible(h.x, h.z, 7)) continue;
    r.box(h.x, 0, h.z, 0.26, 5.2, 0.26, 0, ["#4a4f57", "#33373d", "#3e434a", "#4a4f57", "#2e3238"]);
    r.box(h.x, 4.2, h.z, 0.8, 2.1, 0.8, 0, ["#2b2f35", "#1f2329", "#25292f", "#2b2f35", "#1f2329"]);
    const p = l.phase;
    const green = h.vertical ? p === 0 : p === 2;
    const amber = h.vertical ? p === 1 : p === 3;
    const red = !green && !amber;
    const flash = 0.6 + 0.4 * Math.sin(t * 12);
    r.billboard(h.x, 5.55, h.z, 0.44, 0.44, red ? "#ff3b30" : "#37424a", 1);
    r.billboard(h.x, 5.05, h.z, 0.44, 0.44, amber ? "#ffb020" : "#3d3a30", amber ? flash : 1);
    r.billboard(h.x, 4.55, h.z, 0.44, 0.44, green ? "#31d158" : "#2c3d31", 1);
  }
}

/* --------------------------------- bus --------------------------------- */

export const BUS = { len: 12.2, wid: 2.62, hgt: 3.15, wheelbase: 6.2 };

export function drawBus(r, bus, t) {
  const yaw = bus.yaw;
  const s = Math.sin(yaw), c = Math.cos(yaw);
  const body = bus.livery || "#f0b429";
  const dark = shade(body, -0.22);

  // chassis skirt
  r.box(bus.x, 0.32, bus.z, BUS.wid, 1.35, BUS.len, yaw,
    [null, shade(dark, -0.1), dark, shade(dark, 0.04), shade(dark, -0.06)]);
  // main body
  r.box(bus.x, 1.5, bus.z, BUS.wid, 1.35, BUS.len, yaw,
    [null, "#20313f", "#26394a", "#20313f", "#26394a"]);
  // roof band
  r.box(bus.x, 2.7, bus.z, BUS.wid, 0.5, BUS.len, yaw,
    [shade(body, 0.14), shade(body, -0.1), body, shade(body, 0.04), shade(body, -0.04)]);
  // front cap
  const fx = bus.x + s * (BUS.len / 2 - 0.6);
  const fz = bus.z + c * (BUS.len / 2 - 0.6);
  r.box(fx, 0.32, fz, BUS.wid + 0.04, 2.55, 1.2, yaw,
    [shade(body, 0.1), body, shade(body, 0.05), shade(body, -0.12), shade(body, -0.04)]);
  // rear cap
  const rx = bus.x - s * (BUS.len / 2 - 0.6);
  const rz = bus.z - c * (BUS.len / 2 - 0.6);
  r.box(rx, 0.32, rz, BUS.wid + 0.04, 2.7, 1.2, yaw,
    [shade(body, 0.08), shade(body, -0.12), shade(body, 0.02), body, shade(body, -0.05)]);
  // roof
  r.box(bus.x, 3.2, bus.z, BUS.wid - 0.12, 0.16, BUS.len - 0.5, yaw,
    [shade(body, 0.3), shade(body, 0.1), shade(body, 0.18), shade(body, 0.1), shade(body, 0.18)]);
  // stripe
  r.box(bus.x, 1.34, bus.z, BUS.wid + 0.06, 0.22, BUS.len - 0.2, yaw,
    [null, "#c0392b", "#c0392b", "#c0392b", "#c0392b"]);

  // wheels
  for (const [ox, oz] of [[-1, 4.0], [1, 4.0], [-1, -3.4], [1, -3.4], [-1, -4.9], [1, -4.9]]) {
    const wx = bus.x + ox * (BUS.wid / 2 + 0.02) * c + oz * s;
    const wz = bus.z - ox * (BUS.wid / 2 + 0.02) * s + oz * c;
    const wYaw = oz > 0 ? yaw + bus.steerAngle * 0.9 : yaw;
    r.box(wx, 0, wz, 0.42, 1.06, 1.14, wYaw, ["#2b2f35", "#15171b", "#1b1e22", "#2b2f35", "#15171b"]);
  }

  // headlights / tail lights
  const lit = bus.headlights;
  for (const side of [-1, 1]) {
    const hx = fx + side * 0.95 * c + 0.55 * s;
    const hz = fz - side * 0.95 * s + 0.55 * c;
    r.billboard(hx, 0.85, hz, 0.72, 0.42, lit ? "#fff4c9" : "#cfd6dd", 1);
    const tx = rx + side * 0.95 * c - 0.6 * s;
    const tz = rz - side * 0.95 * s - 0.6 * c;
    r.billboard(tx, 0.9, tz, 0.66, 0.4, bus.brake > 0.05 ? "#ff3b30" : "#8e2d28", 1);
  }
  // indicators
  if (bus.indicator) {
    const on = Math.sin(t * 8) > 0;
    const side = bus.indicator === "left" ? -1 : 1;
    if (on) {
      const ix = fx + side * 1.1 * c + 0.4 * s;
      const iz = fz - side * 1.1 * s + 0.4 * c;
      r.billboard(ix, 1.25, iz, 0.6, 0.36, "#ff9a1f", 1);
      const jx = rx + side * 1.1 * c - 0.5 * s;
      const jz = rz - side * 1.1 * s - 0.5 * c;
      r.billboard(jx, 1.3, jz, 0.6, 0.36, "#ff9a1f", 1);
    }
  }
  // doors (front + middle), swing open visually
  const doorOpen = bus.doorT;
  for (const oz of [3.1, -1.0]) {
    const dw = 1.1;
    const dx = bus.x + (BUS.wid / 2 + 0.04) * c + oz * s;
    const dz = bus.z - (BUS.wid / 2 + 0.04) * s + oz * c;
    r.box(dx, 0.5, dz, 0.12, 2.3, dw, yaw + doorOpen * 1.25,
      [null, "#1b2836", "#233243", "#1b2836", "#233243"]);
  }
}

/** Soft contact shadow under a box-ish object. */
export function drawShadow(r, x, z, w, l, yaw, alpha) {
  const hw = w / 2, hl = l / 2;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const pt = (lx, lz) => [x + lx * c + lz * s, 0.02, z - lx * s + lz * c];
  r.quad(pt(-hw, -hl), pt(hw, -hl), pt(hw, hl), pt(-hw, hl), "#1a1e18",
    { alpha: alpha || 0.28, layer: LAYER_SHADOW });
}

export { DRAW_DIST, LANE, BLOCK, GRID, ROAD_HALF, KERB, clamp, lerp };
