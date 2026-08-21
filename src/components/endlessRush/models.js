/* ------------------------------------------------------------------ *
 * Kianimation Endless Rush — baked model geometry.
 *
 * The characters and vehicles are the real models from `public/models/`,
 * but the game does not load glTF at run time. A build step
 * (`tools/bake-models.mjs`) reads each GLB, bakes its texture down to
 * per-vertex colour, welds and decimates it to a few hundred triangles,
 * and writes a small JSON file. That file is what ships.
 *
 * Three reasons it is done this way:
 *
 *   - **No WebGL and no three.js.** A 176 kB engine and a second
 *     graphics context would each outweigh the entire rest of the game,
 *     and neither is needed once the geometry is plain triangles.
 *   - **Correct sorting.** These triangles go through the same painter's
 *     algorithm as the road and the barriers, so a car genuinely sits
 *     behind the hoarding in front of it rather than being composited
 *     over the whole scene as one flat sprite.
 *   - **Size.** The source scans are 13–21 MB each. Baked, all six
 *     models together come to 60 kB.
 *
 * The humans are also *skinned*. The Meshy exports have no skeleton — a
 * scan is a statue — so the bake step invents one: it reads the standing
 * pose, works out where the hips, knees, shoulders, elbows and neck must
 * be, and paints smooth weights for eleven limb groups onto the
 * vertices. This file applies whatever pose `runner.js` asks for.
 * ------------------------------------------------------------------ */

import { L_VOLUME } from "./render.js";

const base = () => (typeof import.meta.env !== "undefined" ? import.meta.env.BASE_URL : "/");

const meshes = new Map();
const pending = new Set();

/* Limb groups, in the order the bake step writes them. */
export const G_PELVIS = 0;
export const G_TORSO = 1;
export const G_HEAD = 2;
export const G_ARM_UL = 3;
export const G_ARM_LL = 4;
export const G_ARM_UR = 5;
export const G_ARM_LR = 6;
export const G_LEG_UL = 7;
export const G_LEG_LL = 8;
export const G_LEG_UR = 9;
export const G_LEG_LR = 10;
export const GROUP_COUNT = 11;

/* Key light, matching the one the rest of the scene is lit by. */
const LX = -0.34, LY = 0.86, LZ = -0.38;

/* -------------------------------- load -------------------------------- */

function bytes(b64) {
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function decode(json) {
  return {
    name: json.name,
    size: json.size,
    human: !!json.human,
    pivots: json.pivots,
    lods: json.lods.map((l) => ({
      verts: new Float32Array(bytes(l.verts).buffer),
      joints: l.joints ? bytes(l.joints) : null,
      weights: bytes(l.weights),
      tri: new Uint16Array(bytes(l.tri).buffer),
      col: new Uint32Array(bytes(l.col).buffer),
      n: l.verts_n,
      tris: l.tris,
    })),
  };
}

/**
 * Starts loading a baked mesh. Safe to call as often as you like; the
 * game never waits on it and draws its fallback geometry until it lands.
 */
export function loadMesh(name) {
  if (meshes.has(name) || pending.has(name)) return;
  pending.add(name);
  fetch(`${base()}models/baked/${name}.json`)
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
    .then((json) => { meshes.set(name, decode(json)); })
    .catch(() => { /* the fallback shapes stay in charge */ })
    .finally(() => { pending.delete(name); });
}

export function loadMeshes(names) { for (const n of names) loadMesh(n); }
export function getMesh(name) { return meshes.get(name) || null; }
export function meshReady(name) { return meshes.has(name); }

/* ------------------------------ transforms ------------------------------ */

/** A 3×4 row-major matrix: [m00 m01 m02 tx, m10 … ]. */
export const mat = () => new Float32Array(12);

export function matIdentity(m) {
  m[0] = 1; m[1] = 0; m[2] = 0; m[3] = 0;
  m[4] = 0; m[5] = 1; m[6] = 0; m[7] = 0;
  m[8] = 0; m[9] = 0; m[10] = 1; m[11] = 0;
  return m;
}

/** out = a · b (both 3×4, implicit bottom row 0 0 0 1). */
export function matMul(out, a, b) {
  for (let r = 0; r < 3; r += 1) {
    const a0 = a[r * 4], a1 = a[r * 4 + 1], a2 = a[r * 4 + 2], a3 = a[r * 4 + 3];
    out[r * 4] = a0 * b[0] + a1 * b[4] + a2 * b[8];
    out[r * 4 + 1] = a0 * b[1] + a1 * b[5] + a2 * b[9];
    out[r * 4 + 2] = a0 * b[2] + a1 * b[6] + a2 * b[10];
    out[r * 4 + 3] = a0 * b[3] + a1 * b[7] + a2 * b[11] + a3;
  }
  return out;
}

/** Rotation about a pivot: translate(p) · Rx(ax) · Rz(az) · Ry(ay) · translate(-p). */
export function matJoint(out, px, py, pz, ax, ay, az) {
  const cx = Math.cos(ax), sx = Math.sin(ax);
  const cy = Math.cos(ay), sy = Math.sin(ay);
  const cz = Math.cos(az), sz = Math.sin(az);
  // R = Rx · Rz · Ry
  const r00 = cz * cy;
  const r01 = -sz;
  const r02 = cz * sy;
  const r10 = cx * sz * cy + sx * sy;
  const r11 = cx * cz;
  const r12 = cx * sz * sy - sx * cy;
  const r20 = sx * sz * cy - cx * sy;
  const r21 = sx * cz;
  const r22 = sx * sz * sy + cx * cy;
  out[0] = r00; out[1] = r01; out[2] = r02;
  out[4] = r10; out[5] = r11; out[6] = r12;
  out[8] = r20; out[9] = r21; out[10] = r22;
  out[3] = px - (r00 * px + r01 * py + r02 * pz);
  out[7] = py - (r10 * px + r11 * py + r12 * pz);
  out[11] = pz - (r20 * px + r21 * py + r22 * pz);
  return out;
}

/** Scale then rotate about Y then translate — the model→world transform. */
export function matPlace(out, x, y, z, sx, sy, sz, yaw, roll) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const cr = Math.cos(roll || 0), sr = Math.sin(roll || 0);
  // Rz(roll) applied in model space first, then Ry(yaw), then scale/translate
  const a00 = cr * sx, a01 = -sr * sy, a02 = 0;
  const a10 = sr * sx, a11 = cr * sy, a12 = 0;
  const a20 = 0, a21 = 0, a22 = sz;
  out[0] = c * a00 + s * a20; out[1] = c * a01 + s * a21; out[2] = c * a02 + s * a22; out[3] = x;
  out[4] = a10; out[5] = a11; out[6] = a12; out[7] = y;
  out[8] = -s * a00 + c * a20; out[9] = -s * a01 + c * a21; out[10] = -s * a02 + c * a22; out[11] = z;
  return out;
}

/* ------------------------------- drawing ------------------------------- */

const MAX_VERTS = 3072;
const world = new Float32Array(MAX_VERTS * 3);
const triBuf = new Float64Array(9);

function pickLod(m, dist) {
  if (m.lods.length < 2) return 0;
  return dist > 40 ? 1 : 0;
}

/**
 * Fills the shared world-space buffer by skinning `lod` through `mats`,
 * then draws it. `mats` is one 3×4 model→world matrix per limb group.
 */
function skin(lod, mats) {
  const v = lod.verts;
  const j = lod.joints;
  const w = lod.weights;
  const n = Math.min(lod.n, MAX_VERTS);
  for (let i = 0; i < n; i += 1) {
    const x = v[i * 3], y = v[i * 3 + 1], z = v[i * 3 + 2];
    let ox = 0, oy = 0, oz = 0;
    for (let k = 0; k < 3; k += 1) {
      const wt = w[i * 3 + k];
      if (!wt) continue;
      const m = mats[j ? j[i * 3 + k] : 0];
      const f = wt / 255;
      ox += f * (m[0] * x + m[1] * y + m[2] * z + m[3]);
      oy += f * (m[4] * x + m[5] * y + m[6] * z + m[7]);
      oz += f * (m[8] * x + m[9] * y + m[10] * z + m[11]);
    }
    world[i * 3] = ox; world[i * 3 + 1] = oy; world[i * 3 + 2] = oz;
  }
}

/**
 * Emits the triangles in the world buffer.
 *
 * Normals come from the posed geometry rather than from anything baked,
 * which is what lets a skinned limb light correctly as it swings. The
 * same cross product back-face culls, so a closed body costs half what
 * it looks like it should.
 */
function emit(r, lod, tint, bias) {
  const tri = lod.tri;
  const col = lod.col;
  const count = tri.length / 3;
  const camX = r.cam.x, camY = r.cam.y, camZ = r.cam.z;

  for (let t = 0; t < count; t += 1) {
    const a = tri[t * 3] * 3, b = tri[t * 3 + 1] * 3, c = tri[t * 3 + 2] * 3;
    const ax = world[a], ay = world[a + 1], az = world[a + 2];
    const e1x = world[b] - ax, e1y = world[b + 1] - ay, e1z = world[b + 2] - az;
    const e2x = world[c] - ax, e2y = world[c + 1] - ay, e2z = world[c + 2] - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    if (nx * (camX - ax) + ny * (camY - ay) + nz * (camZ - az) <= 0) continue;

    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    const lamb = Math.max(0, (nx * LX + ny * LY + nz * LZ) / len);
    const light = (0.46 + 0.62 * lamb) * tint;

    const packed = col[t];
    triBuf[0] = ax; triBuf[1] = ay; triBuf[2] = az;
    triBuf[3] = world[b]; triBuf[4] = world[b + 1]; triBuf[5] = world[b + 2];
    triBuf[6] = world[c]; triBuf[7] = world[c + 1]; triBuf[8] = world[c + 2];
    r.poly(triBuf, HEX[packed] || hexOf(packed), light, L_VOLUME, bias);
  }
}

/* Colour keys repeat constantly across a mesh, so the hex strings are
   memoised rather than rebuilt for every triangle of every frame. */
const HEX = Object.create(null);
function hexOf(packed) {
  const s = `#${packed.toString(16).padStart(6, "0")}`;
  HEX[packed] = s;
  return s;
}

/** A rigid model placed in a box. Returns false when it has not loaded. */
export function drawMesh(r, name, x, y, z, rot, w, h, d, tint) {
  const m = meshes.get(name);
  if (!m) { loadMesh(name); return false; }
  const dist = z - r.cam.z;
  if (dist < -14 || dist > 170) return true;
  const lod = m.lods[pickLod(m, dist)];
  if (lod.n > MAX_VERTS) return false;

  const M = matPlace(SCRATCH_PLACE, x, y, z,
    w / m.size[0], h / m.size[1], d / m.size[2], rot, 0);
  RIGID[0] = M;
  skin(lod, RIGID);
  emit(r, lod, tint, 0);
  return true;
}

const SCRATCH_PLACE = mat();
const RIGID = [SCRATCH_PLACE];

/**
 * A skinned character. `mats` must hold GROUP_COUNT model→world matrices;
 * build them with `matPlace` and `matJoint` (see runner.js).
 */
export function drawSkinned(r, m, mats, dist, tint, bias) {
  if (!m) return false;
  const lod = m.lods[pickLod(m, dist)];
  if (lod.n > MAX_VERTS) return false;
  skin(lod, mats);
  emit(r, lod, tint, bias);
  return true;
}

export function disposeMeshes() {
  meshes.clear();
  pending.clear();
}
