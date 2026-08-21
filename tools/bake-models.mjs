/* ------------------------------------------------------------------ *
 * Kianimation Endless Rush — model bake step.
 *
 *   node tools/bake-models.mjs <models-dir> <out-dir>
 *
 * Turns the GLB files in public/models into the small vertex-coloured
 * meshes the game actually draws (see src/components/endlessRush/models.js
 * for why the game does not load glTF directly).
 *
 * For every model it:
 *   1. decodes the GLB, including meshopt compression and WebP textures
 *   2. simplifies the triangle soup down to a game-sized budget
 *   3. samples the base colour texture at each surviving vertex, so the
 *      colour survives even though the texture does not
 *   4. writes a compact JSON of base64 typed arrays
 *
 * For the human characters it does one thing more. The Meshy exports are
 * photogrammetry-style scans: a single closed mesh with no skeleton and
 * no animation, which is a statue, not a runner. So the bake step
 * *invents* a skeleton. It reads the standing pose, works out where the
 * hips, knees, shoulders, elbows and neck must be from the height
 * profile, and paints smooth skinning weights onto the vertices for ten
 * limb groups. The result is a scan that can be posed — legs that swing,
 * arms that pump, a torso that leans into a lane change.
 *
 * The weights are deliberately soft rather than a hard vertex-by-vertex
 * assignment. A hard split leaves a visible tear at every joint; a blend
 * over a few centimetres bends instead, which is all linear blend
 * skinning ever really does.
 * ------------------------------------------------------------------ */

import fs from "node:fs";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder, MeshoptSimplifier } from "meshoptimizer";
import { dequantize } from "@gltf-transform/functions";
import sharp from "sharp";

/* --------------------------- limb groups --------------------------- */

export const GROUPS = [
  "pelvis",   // 0  the root everything hangs from
  "torso",    // 1
  "head",     // 2
  "armUL",    // 3  upper arm, left
  "armLL",    // 4  forearm + hand, left
  "armUR",    // 5
  "armLR",    // 6
  "legUL",    // 7  thigh, left
  "legLL",    // 8  shin + foot, left
  "legUR",    // 9
  "legLR",    // 10
];

/* Where each joint sits, as a fraction of the figure's height measured
   from the soles. Read off the height profile of the scans: the shoulder
   line is the widest band, the head is where the silhouette pinches in,
   and the hips sit just under the halfway mark. */
const J = {
  hip: 0.485,
  knee: 0.265,
  neck: 0.805,
  shoulder: 0.790,
  elbow: 0.620,
  hipSpread: 0.28,       // × half-width
  shoulderSpread: 0.62,
};

const smooth = (a, b, x) => {
  if (a === b) return x < a ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Skinning weights for one vertex of a standing human.
 * `u` is height above the soles as a fraction of total height, `ax` is
 * distance from the centre line as a fraction of half-width, `sx` the
 * side (-1 left, +1 right).
 */
function humanWeights(u, ax, sx) {
  const w = new Float64Array(GROUPS.length);

  const head = smooth(J.neck - 0.05, J.neck + 0.05, u);
  // arms live above the elbow band and out at the edges of the silhouette
  const armBand = smooth(0.36, 0.46, u) * (1 - head);
  const armOut = smooth(0.58, 0.82, ax);
  const arm = armBand * armOut;
  const leg = smooth(J.hip + 0.05, J.hip - 0.08, u) * (1 - arm);
  const upper = 1 - head - arm - leg;

  const right = smooth(-0.04, 0.04, sx);
  const left = 1 - right;

  w[2] = head;
  if (arm > 0) {
    const up = smooth(J.elbow - 0.05, J.elbow + 0.05, u);
    w[3] = arm * left * up;
    w[4] = arm * left * (1 - up);
    w[5] = arm * right * up;
    w[6] = arm * right * (1 - up);
  }
  if (leg > 0) {
    const thigh = smooth(J.knee - 0.05, J.knee + 0.06, u);
    w[7] = leg * left * thigh;
    w[8] = leg * left * (1 - thigh);
    w[9] = leg * right * thigh;
    w[10] = leg * right * (1 - thigh);
  }
  if (upper > 0) {
    // the trunk bends: more of it belongs to the chest the higher it goes
    const chest = smooth(J.hip, J.shoulder, u);
    w[1] = upper * chest;
    w[0] = upper * (1 - chest);
  }
  return w;
}

/** Keeps the three strongest influences and renormalises. */
function topThree(w) {
  const idx = [...w.keys()].sort((a, b) => w[b] - w[a]).slice(0, 3);
  let sum = 0;
  for (const i of idx) sum += w[i];
  if (sum <= 0) return { j: [0, 0, 0], v: [255, 0, 0] };
  const v = idx.map((i) => Math.round((w[i] / sum) * 255));
  // fix rounding so the weights always add to exactly 255
  v[0] += 255 - (v[0] + v[1] + v[2]);
  return { j: idx, v };
}

/* ------------------------------- io ------------------------------- */

const b64 = (typed) => Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString("base64");

/**
 * Reads a GLB and simplifies it to roughly `targetTris`.
 *
 * Simplification runs as a glTF transform rather than straight on the
 * position buffer, because it has to be attribute-aware: these car
 * models carry their paint in COLOR_0 and the humans carry theirs in a
 * texture, and a position-only decimator happily welds a red panel to
 * the black trim beside it and loses both.
 */
async function loadPrimitive(file, targetTris) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  const doc = await io.read(file);
  const root = doc.getRoot();

  /* Bake the texture into COLOR_0 and then throw the UVs away, *before*
     simplifying. This matters more than it sounds: a texture atlas cuts
     the mesh into islands, every island edge is a UV discontinuity, and
     a decimator treats each one as a seam it must not cross. That is why
     these scans refuse to go below about a third of their triangles
     while they still carry UVs. Vertex colour has no seams, so the same
     mesh simplifies freely once the atlas is gone. */
  let tex = null;
  let fromTexture = false;
  const firstMat = root.listMeshes()[0]?.listPrimitives()[0]?.getMaterial();
  const baseTex = firstMat?.getBaseColorTexture();
  if (baseTex) {
    const raw = await sharp(Buffer.from(baseTex.getImage())).ensureAlpha().raw()
      .toBuffer({ resolveWithObject: true });
    tex = { data: raw.data, w: raw.info.width, h: raw.info.height };
  }

  let total = 0;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      total += (prim.getIndices()?.getCount() || prim.getAttribute("POSITION").getCount()) / 3;
      const uv = prim.getAttribute("TEXCOORD_0");
      if (tex && uv) {
        const count = uv.getCount();
        const rgb = new Float32Array(count * 3);
        const e = [0, 0];
        const factor = prim.getMaterial()?.getBaseColorFactor() || [1, 1, 1, 1];
        for (let i = 0; i < count; i += 1) {
          uv.getElement(i, e);
          const c = sampleTexture(tex, e[0], e[1]);
          rgb[i * 3] = (c[0] / 255) * factor[0];
          rgb[i * 3 + 1] = (c[1] / 255) * factor[1];
          rgb[i * 3 + 2] = (c[2] / 255) * factor[2];
        }
        const acc = doc.createAccessor().setType("VEC3").setArray(rgb);
        prim.setAttribute("COLOR_0", acc);
        prim.setAttribute("TEXCOORD_0", null);
        fromTexture = true;
      }
    }
  }
  if (tex) for (const m of root.listMaterials()) m.setBaseColorTexture(null);

  /* Dequantize before welding. These exports store positions as 16-bit
     integers with a node-level scale (KHR_mesh_quantization), so a
     welding tolerance expressed in metres matches nothing at all and the
     mesh reaches the simplifier as loose triangles it cannot collapse
     across. Welding is what makes decimation possible at all. */
  await MeshoptSimplifier.ready;
  await doc.transform(dequantize());

  // world scale of the node holding the mesh, so a scaled export measures right
  let scale = [1, 1, 1];
  for (const node of root.listNodes()) {
    if (node.getMesh()) { scale = node.getScale(); break; }
  }

  const prims = [];
  for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) prims.push(p);
  if (!prims.length) throw new Error(`${file}: no primitives`);

  const verts = [];
  const cols = [];
  const tris = [];
  for (const prim of prims) {
    const pos = prim.getAttribute("POSITION");
    const col = prim.getAttribute("COLOR_0");
    const idx = prim.getIndices();
    const off = verts.length / 3;
    const v = [0, 0, 0, 0];
    for (let i = 0; i < pos.getCount(); i += 1) {
      pos.getElement(i, v);
      verts.push(v[0] * scale[0], v[1] * scale[1], v[2] * scale[2]);
      if (col) { col.getElement(i, v); cols.push(v[0], v[1], v[2]); } else cols.push(-1, -1, -1);
    }
    const n = idx ? idx.getCount() : pos.getCount();
    for (let i = 0; i < n; i += 3) {
      const a = (idx ? idx.getScalar(i) : i) + off;
      const b = (idx ? idx.getScalar(i + 1) : i + 1) + off;
      const c = (idx ? idx.getScalar(i + 2) : i + 2) + off;
      // decimation leaves collapsed triangles behind; they cost fills and
      // draw nothing
      if (a === b || b === c || a === c) continue;
      tris.push(a, b, c);
    }
  }

  /* ---- weld on position, by hand ----
     glTF welding is exact across *every* attribute, and these scans
     carry a separate normal for each triangle corner, so no two corners
     ever compare equal and nothing merges. The mesh then reaches the
     decimator as loose triangles with no shared edges to collapse, which
     is why it refuses to shrink past about a third however hard the
     ratio is pushed. Welding on position alone — and averaging the
     colours of whatever merges — restores the topology decimation needs.
     Normals are recomputed at draw time from the posed geometry anyway,
     so nothing of value is lost. */
  let V, T;
  {
    let mnX = 1e9, mxX = -1e9, mnY = 1e9, mxY = -1e9, mnZ = 1e9, mxZ = -1e9;
    for (let i = 0; i < verts.length; i += 3) {
      if (verts[i] < mnX) mnX = verts[i]; if (verts[i] > mxX) mxX = verts[i];
      if (verts[i + 1] < mnY) mnY = verts[i + 1]; if (verts[i + 1] > mxY) mxY = verts[i + 1];
      if (verts[i + 2] < mnZ) mnZ = verts[i + 2]; if (verts[i + 2] > mxZ) mxZ = verts[i + 2];
    }
    const extent = Math.max(mxX - mnX, mxY - mnY, mxZ - mnZ) || 1;
    const q = extent * 2e-4;
    const key = new Map();
    const remap = new Int32Array(verts.length / 3);
    const wv = [];
    const wc = [];
    const hits = [];
    for (let i = 0; i < verts.length / 3; i += 1) {
      const k = `${Math.round(verts[i * 3] / q)},${Math.round(verts[i * 3 + 1] / q)},${Math.round(verts[i * 3 + 2] / q)}`;
      let dst = key.get(k);
      if (dst === undefined) {
        dst = wv.length / 3;
        key.set(k, dst);
        wv.push(verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]);
        wc.push(cols[i * 3], cols[i * 3 + 1], cols[i * 3 + 2]);
        hits.push(1);
      } else {
        wc[dst * 3] += cols[i * 3];
        wc[dst * 3 + 1] += cols[i * 3 + 1];
        wc[dst * 3 + 2] += cols[i * 3 + 2];
        hits[dst] += 1;
      }
      remap[i] = dst;
    }
    for (let i = 0; i < hits.length; i += 1) {
      wc[i * 3] /= hits[i]; wc[i * 3 + 1] /= hits[i]; wc[i * 3 + 2] /= hits[i];
    }
    V = new Float32Array(wv);
    cols.length = 0;
    for (const c of wc) cols.push(c);
    const wt = [];
    for (let i = 0; i < tris.length; i += 3) {
      const a = remap[tris[i]], b = remap[tris[i + 1]], c = remap[tris[i + 2]];
      if (a !== b && b !== c && a !== c) wt.push(a, b, c);
    }
    T = new Uint32Array(wt);
  }

  /* Decimate here rather than through the glTF transform. The transform
     stops the moment collapsing further would exceed its error budget,
     which on a closed scan means it quits at roughly a third of the
     triangles however hard the ratio is pushed. Driving meshopt directly
     with a generous error bound lets it run all the way to the budget,
     which is what a character 140 pixels tall actually needs. */
  if (T.length / 3 > targetTris) {
    const [idx] = MeshoptSimplifier.simplify(T, V, 3, targetTris * 3, 0.5, ["LockBorder"]);
    if (idx && idx.length >= 12) T = new Uint32Array(idx);
  }

  /* Collapsed triangles cost fills and draw nothing. */
  {
    const clean = [];
    for (let i = 0; i < T.length; i += 3) {
      const a = T[i], b = T[i + 1], c = T[i + 2];
      if (a !== b && b !== c && a !== c) clean.push(a, b, c);
    }
    T = new Uint32Array(clean);
  }

  /* Drop vertices nothing references any more. */
  const map = new Int32Array(V.length / 3).fill(-1);
  const keep = [];
  for (let i = 0; i < T.length; i += 1) {
    if (map[T[i]] < 0) { map[T[i]] = keep.length; keep.push(T[i]); }
    T[i] = map[T[i]];
  }
  const V2 = new Float32Array(keep.length * 3);
  const C2 = new Float32Array(keep.length * 3);
  for (let i = 0; i < keep.length; i += 1) {
    const o = keep[i];
    V2[i * 3] = V[o * 3]; V2[i * 3 + 1] = V[o * 3 + 1]; V2[i * 3 + 2] = V[o * 3 + 2];
    C2[i * 3] = cols[o * 3]; C2[i * 3 + 1] = cols[o * 3 + 1]; C2[i * 3 + 2] = cols[o * 3 + 2];
  }

  return { verts: V2, cols: C2, tris: T, sourceTris: total, fromTexture };
}

function sampleTexture(tex, u, v) {
  const x = Math.min(tex.w - 1, Math.max(0, Math.round((u - Math.floor(u)) * (tex.w - 1))));
  // glTF UV origin is top-left
  const y = Math.min(tex.h - 1, Math.max(0, Math.round((v - Math.floor(v)) * (tex.h - 1))));
  const i = (y * tex.w + x) * 4;
  return [tex.data[i], tex.data[i + 1], tex.data[i + 2]];
}

/* ------------------------------- bake ------------------------------- */

/** Bakes one level of detail: geometry, colour and (for humans) weights. */
async function bakeLod(file, target, human) {
  const src = await loadPrimitive(file, target);
  const n = src.verts.length / 3;
  if (!n) throw new Error("empty mesh");

  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, minZ = 1e9, maxZ = -1e9;
  for (let i = 0; i < n; i += 1) {
    const x = src.verts[i * 3], y = src.verts[i * 3 + 1], z = src.verts[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const H = Math.max(1e-6, maxY - minY);
  const hw = Math.max(1e-6, (maxX - minX) * 0.5) / H;
  const cX = (minX + maxX) * 0.5;
  const cZ = (minZ + maxZ) * 0.5;

  /* Normalised: centred on X and Z, soles on y = 0, exactly one unit
     tall. The game scales that into whatever box it needs. */
  const verts = new Float32Array(n * 3);
  const joints = new Uint8Array(n * 3);
  const weights = new Uint8Array(n * 3);
  const vcol = new Uint8Array(n * 3);

  /* ---------------------------- auto-exposure ----------------------------
     The scans were not lit to a common standard. The humans come out
     around 90/255 average with highlights near 200; the cars come out at
     40 with nothing above 108, because their paint really is dark and the
     photogrammetry was done in shade. Left alone they render as faceted
     black lumps on a grey road — you can see one is *there* and nothing
     else about it.

     Rather than a per-model fudge factor, the brightest few per cent of
     each model is measured and scaled to a common target. A model already
     at or above that target is left exactly as it was, so this touches the
     cars and does nothing at all to the people. */
  /* Exposure is judged on the *average* level, not on the brightest few
     vertices. After decimation a car is only about eighty vertices, and
     one of them being a headlight or a window highlight is enough to make
     a top-percentile reading say "this model is bright" about a mesh that
     is black everywhere a player will look. The mean has no such
     sensitivity. A separate ceiling then stops the lift blowing out
     whatever highlights the model does have. */
  /* Judged on the median, not the mean. A car scan is mostly dark paint,
     tyre, glass and shadowed underbody, with a handful of bright vertices
     on the lights and the windscreen — enough to drag a mean upward while
     every panel a player actually sees stays black. The median is the
     level of the typical surface, which is the thing that has to read. */
  const TARGET_MEDIAN = 0.33;
  const MAX_LIFT = 2.8;
  let exposure = 1;
  if (src.cols[0] >= 0) {
    const toSrgb = (c) => (src.fromTexture ? c
      : c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
    const lum = new Float64Array(n);
    let sum = 0;
    for (let i = 0; i < n; i += 1) {
      const l = 0.2126 * toSrgb(src.cols[i * 3])
        + 0.7152 * toSrgb(src.cols[i * 3 + 1])
        + 0.0722 * toSrgb(src.cols[i * 3 + 2]);
      lum[i] = l;
      sum += l;
    }
    void sum;
    const sorted = Float64Array.from(lum).sort();
    const mid = sorted[Math.floor(n * 0.5)] || 0;
    /* No separate highlight ceiling: the soft knee below already rolls
       everything above 0.82 off gently, so lifting a dark model cannot
       flatten its highlights into a single white patch — and a ceiling
       computed from a near-top percentile just let a few specular dots on
       a windscreen veto the lift the rest of the car needed. */
    if (mid > 0.005 && mid < TARGET_MEDIAN) {
      exposure = Math.min(MAX_LIFT, TARGET_MEDIAN / mid);
    }
  }
  if (exposure > 1.001) {
    console.log(`    auto-exposure x${exposure.toFixed(2)}`);
  }

  for (let i = 0; i < n; i += 1) {
    const nx = (src.verts[i * 3] - cX) / H;
    const ny = (src.verts[i * 3 + 1] - minY) / H;
    const nz = (src.verts[i * 3 + 2] - cZ) / H;
    verts[i * 3] = nx; verts[i * 3 + 1] = ny; verts[i * 3 + 2] = nz;

    /* Colours that came out of a texture are already sRGB bytes. Colours
       that came in as COLOR_0 are linear, as glTF requires — and a linear
       0.06 is a mid grey on screen, not the near-black it looks like if
       you write it straight out. These car models average 0.06, which is
       exactly why they bake to black without this. */
    const hasCol = src.cols[i * 3] >= 0;
    for (let k = 0; k < 3; k += 1) {
      let c = hasCol ? src.cols[i * 3 + k] : 0.7;
      if (!src.fromTexture) c = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
      /* Soft-clipped rather than hard-clipped, so lifting a dark model
         does not flatten whatever highlights it did have into one white
         patch. Below the knee it is a straight multiply. */
      c *= exposure;
      if (c > 0.82) c = 0.82 + (1 - Math.exp(-(c - 0.82) * 3.2)) * 0.18;
      vcol[i * 3 + k] = Math.max(0, Math.min(255, Math.round(c * 255)));
    }

    if (human) {
      const { j, v } = topThree(humanWeights(ny, Math.abs(nx) / hw, nx));
      joints[i * 3] = j[0]; joints[i * 3 + 1] = j[1]; joints[i * 3 + 2] = j[2];
      weights[i * 3] = v[0]; weights[i * 3 + 1] = v[1]; weights[i * 3 + 2] = v[2];
    } else {
      weights[i * 3] = 255;
    }
  }

  const count = src.tris.length / 3;
  const tri = new Uint16Array(src.tris.length);
  const col = new Uint32Array(count);
  for (let t = 0; t < count; t += 1) {
    const a = src.tris[t * 3], b = src.tris[t * 3 + 1], c = src.tris[t * 3 + 2];
    tri[t * 3] = a; tri[t * 3 + 1] = b; tri[t * 3 + 2] = c;
    col[t] = (Math.round((vcol[a * 3] + vcol[b * 3] + vcol[c * 3]) / 3) << 16)
      | (Math.round((vcol[a * 3 + 1] + vcol[b * 3 + 1] + vcol[c * 3 + 1]) / 3) << 8)
      | Math.round((vcol[a * 3 + 2] + vcol[b * 3 + 2] + vcol[c * 3 + 2]) / 3);
  }
  if (n > 65535) throw new Error(`${n} vertices exceeds the 16-bit index budget`);

  return {
    lod: {
      verts: b64(verts),
      joints: human ? b64(joints) : null,
      weights: b64(weights),
      tri: b64(tri),
      col: b64(col),
      tris: count,
      verts_n: n,
    },
    size: [(maxX - minX) / H, 1, (maxZ - minZ) / H],
    hw,
    sourceTris: src.sourceTris,
  };
}

async function bake(file, outDir, opts) {
  const lods = [];
  let size = [1, 1, 1];
  let hw = 0.3;
  let sourceTris = 0;
  for (const target of opts.lods) {
    const r = await bakeLod(file, target, opts.human);
    lods.push(r.lod);
    size = r.size;
    hw = r.hw;
    sourceTris = r.sourceTris;
  }

  const pivots = [
    [0, J.hip, 0],
    [0, J.hip, 0],
    [0, J.neck, 0],
    [-hw * J.shoulderSpread, J.shoulder, 0],
    [-hw * J.shoulderSpread, J.elbow, 0],
    [hw * J.shoulderSpread, J.shoulder, 0],
    [hw * J.shoulderSpread, J.elbow, 0],
    [-hw * J.hipSpread, J.hip, 0],
    [-hw * J.hipSpread, J.knee, 0],
    [hw * J.hipSpread, J.hip, 0],
    [hw * J.hipSpread, J.knee, 0],
  ];

  const out = {
    name: opts.name,
    size,
    human: !!opts.human,
    groups: GROUPS.length,
    pivots: opts.human ? pivots : null,
    lods,
  };
  const dest = path.join(outDir, `${opts.name}.json`);
  fs.writeFileSync(dest, JSON.stringify(out));
  const kb = (fs.statSync(dest).size / 1024).toFixed(1);
  console.log(`  ${opts.name.padEnd(14)} ${String(sourceTris).padStart(6)} tris in  ->  `
    + `[${lods.map((l) => `${l.tris}t/${l.verts_n}v`).join(", ")}]  ${kb} kB`
    + `${opts.human ? "  skinned" : ""}`);
}

/* ------------------------------- main ------------------------------- */

const [srcDir, outDir] = process.argv.slice(2);
if (!srcDir || !outDir) {
  console.error("usage: node tools/bake-models.mjs <models-dir> <out-dir>");
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

const JOBS = [
  { file: "passenger-adult-male.glb", name: "human-male", human: true, lods: [460, 150] },
  { file: "passenger-adult-female.glb", name: "human-female", human: true, lods: [460, 150] },
  { file: "passenger-young-female.glb", name: "human-young", human: true, lods: [460, 150] },
  { file: "passenger-child.glb", name: "human-child", human: true, lods: [460, 150] },
  /* Cars get a bigger budget than they first had. At 190 triangles the
     executive car still read as a car but the SUV — a boxier shape whose
     whole silhouette is wheel arches and glasshouse — collapsed into a
     faceted lump. There are only ever a few on screen and they are rigid,
     so 460 costs nothing measurable and buys back the shape. */
  { file: "suv.glb", name: "suv", human: false, lods: [700, 140] },
  { file: "executive-car.glb", name: "car", human: false, lods: [700, 140] },
];

console.log("baking models");
for (const job of JOBS) {
  const file = path.join(srcDir, job.file);
  if (!fs.existsSync(file)) { console.log(`  ${job.name.padEnd(16)} (source missing, skipped)`); continue; }
  try {
    await bake(file, outDir, job);
  } catch (e) {
    console.log(`  ${job.name.padEnd(16)} FAILED: ${e.message}`);
  }
}
console.log("done");
