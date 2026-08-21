/* ------------------------------------------------------------------ *
 * City Bus Simulator — glTF vehicle layer.
 *
 * The world is drawn by the software renderer in render.js. Every
 * vehicle — the player's bus and the AI traffic — is drawn instead by
 * three.js into one offscreen WebGL canvas, which is composited into
 * the 2D canvas as a single sprite in the painter's order.
 *
 * Traffic uses one InstancedMesh per model, so a street full of cars
 * costs two draw calls rather than one per car. The simulation is not
 * touched: this module only reads positions and headings that engine.js
 * has already computed.
 *
 * Everything here is optional. If WebGL is missing, or a model fails to
 * load, the caller falls back to the procedural shapes in render.js.
 * ------------------------------------------------------------------ */

/* three.js is pulled in dynamically so it lands in its own chunk: the
   home page must not pay for a 3D engine nobody has asked to run yet. */
import { BUS } from "./render.js";
import { PEOPLE_KINDS, PERSON_HEIGHT } from "./people.js";

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

let THREE = null;

const base = () => (typeof import.meta.env !== "undefined" ? import.meta.env.BASE_URL : "/");

export const MODELS = {
  bus: { url: () => `${base()}models/bus.glb`, forwardYaw: Math.PI / 2, fit: BUS.len },
  suv: { url: () => `${base()}models/suv.glb`, forwardYaw: Math.PI / 2, fit: null },
  car: { url: () => `${base()}models/executive-car.glb`, forwardYaw: Math.PI / 2, fit: null },
};

/* The passenger models face +Z as exported, which is the heading the
   simulation calls yaw 0, so they need no turning. Each is scaled to a
   real height rather than to whatever Meshy normalised them to. */
export const PEOPLE_MODELS = PEOPLE_KINDS.map((k) => ({
  key: `p:${k}`,
  kind: k,
  url: () => `${base()}models/passenger-${k}.glb`,
  height: PERSON_HEIGHT[k],
}));

/* The software renderer draws the world out to 210m, so anything nearer
   than that is on screen and must be a real model. The old 115m cut meant
   most of the visible traffic fell back to the blocky procedural car. */
/* Far enough that every car big enough to tell apart from a box is a real
   model; past this a car is barely a dozen pixels and the procedural shape
   is indistinguishable. */
const MAX_TRAFFIC = 22;        // instances per model, nearest first
const TRAFFIC_DIST = 165;
/* People are small; past this they are a few pixels and the procedural
   figure in render.js is indistinguishable from the model. */
const PEOPLE_DIST = 78;
/* A gap this big between two vehicles is room for a building to stand in,
   so it earns its own place in the painter's order. */
const SLICE_GAP = 16;

/**
 * Picks how much the vehicles are allowed to cost. Phones and high-DPR
 * screens get the cheap path; a roomy desktop window gets more.
 */
function pickQuality() {
  if (typeof window === "undefined") return { antialias: false, maxDpr: 1, maxTraffic: 8 };
  const dpr = window.devicePixelRatio || 1;
  const coarse = !!window.matchMedia?.("(pointer: coarse)").matches;
  const cores = navigator.hardwareConcurrency || 4;
  const weak = coarse || cores <= 4 || dpr > 2;
  return {
    antialias: !weak && dpr < 1.5,
    maxDpr: weak ? 1 : Math.min(dpr, 1.5),
    maxTraffic: weak ? 14 : MAX_TRAFFIC,
    maxPeople: weak ? 10 : 18,
  };
}

export function createVehicleLayer({ onReady, onError } = {}) {
  const quality = pickQuality();
  let renderer = null;
  let scene = null;
  let camera = null;
  let busPivot = null;
  let sun = null;
  let sky = null;
  let disposed = false;
  let failed = false;
  let W = 0, H = 0;
  let bufW = 0, bufH = 0;
  let pendingSize = null;
  let Loader = null;
  let Decoder = null;
  let ndc = null;
  let mat4 = null;
  let quat = null;
  let euler = null;
  let posV = null;
  let sclV = null;

  const loaded = { bus: false, suv: false, car: false };
  const inst = { suv: null, car: null };     // InstancedMesh per traffic model
  const modelLen = { suv: 1, car: 1 };       // source length, for per-car scaling
  const people = {};                         // key -> { im, shirt, trous }
  let peopleReady = 0;

  const canvas = typeof document !== "undefined" ? document.createElement("canvas") : null;

  /* ------------------------------ loading ------------------------------ */

  /**
   * Rewrites an attribute as plain float32.
   *
   * These models use KHR_mesh_quantization, so positions and normals
   * arrive as normalized integers. Transforming such a geometry makes
   * three.js write float results straight back into the integer array,
   * which silently destroys the normals and leaves the model unshaded.
   * Dequantizing first is what keeps the lighting intact.
   */
  function toFloatAttribute(geo, name) {
    const a = geo.getAttribute(name);
    if (!a || (a.array instanceof Float32Array && !a.normalized)) return;
    const n = a.itemSize;
    const out = new Float32Array(a.count * n);
    for (let i = 0; i < a.count; i += 1) {
      out[i * n] = a.getX(i);
      if (n > 1) out[i * n + 1] = a.getY(i);
      if (n > 2) out[i * n + 2] = a.getZ(i);
      if (n > 3) out[i * n + 3] = a.getW(i);
    }
    geo.setAttribute(name, new THREE.BufferAttribute(out, n));
  }

  /**
   * Bakes the model's own orientation and ground offset straight into the
   * geometry, so per-frame instance matrices are only translate + yaw +
   * scale. Returns the merged geometry and its source length.
   */
  function prepareGeometry(root, forwardYaw) {
    root.updateMatrixWorld(true);
    const geos = [];
    let sourceMat = null;
    root.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry.clone();
      for (const k of ["position", "normal", "color", "uv"]) toFloatAttribute(g, k);
      g.applyMatrix4(o.matrixWorld);
      geos.push(g);
      if (!sourceMat) sourceMat = Array.isArray(o.material) ? o.material[0] : o.material;
    });
    if (!geos.length) return null;
    let geo = geos[0];
    for (let i = 1; i < geos.length; i += 1) geo = mergeInto(geo, geos[i]);
    // model nose points -X; the sim drives along +Z
    geo.rotateY(forwardYaw);
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    // centre on the axles and drop the tyres onto y = 0
    geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    const size = geo.boundingBox.getSize(new THREE.Vector3());
    return { geo, length: Math.max(size.x, size.z), sourceMat };
  }

  /* Minimal concat: these Meshy exports are a single primitive, so this is
     only a safety net for multi-mesh scenes. */
  function mergeInto(a, b) {
    const attrs = ["position", "normal", "color"];
    if (!attrs.every((k) => a.getAttribute(k) && b.getAttribute(k))) return a;
    const out = new THREE.BufferGeometry();
    for (const k of attrs) {
      const av = a.getAttribute(k), bv = b.getAttribute(k);
      const arr = new Float32Array(av.array.length + bv.array.length);
      arr.set(av.array, 0); arr.set(bv.array, av.array.length);
      out.setAttribute(k, new THREE.BufferAttribute(arr, av.itemSize));
    }
    const ai = a.getIndex(), bi = b.getIndex();
    const offset = a.getAttribute("position").count;
    const idx = new Uint32Array(ai.count + bi.count);
    idx.set(ai.array, 0);
    for (let i = 0; i < bi.count; i += 1) idx[ai.count + i] = bi.array[i] + offset;
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    return out;
  }

  /**
   * Vertex-coloured models (the baked traffic) get a cheap unlit-ish
   * Lambert with no texture at all. Anything still carrying a texture —
   * the bus — keeps its own material, minus the normal and metal/rough
   * maps, which cost far more per fragment than they are worth at the
   * size these vehicles occupy on screen.
   */
  function makeMaterial(geo, sourceMat) {
    if (geo.getAttribute("color")) {
      return new THREE.MeshLambertMaterial({ vertexColors: true, color: 0xffffff });
    }
    if (sourceMat) {
      const m = sourceMat;
      for (const k of ["normalMap", "metalnessMap", "roughnessMap", "aoMap"]) {
        if (m[k]) { m[k].dispose?.(); m[k] = null; }
      }
      if ("metalness" in m) m.metalness = 0.15;
      if ("roughness" in m) m.roughness = 0.62;
      m.needsUpdate = true;
      return m;
    }
    return new THREE.MeshLambertMaterial({ color: 0x9aa3ad });
  }

  async function loadModel(loader, key) {
    const spec = MODELS[key];
    const gltf = await loader.loadAsync(spec.url());
    if (disposed) return;
    const prepared = prepareGeometry(gltf.scene, spec.forwardYaw);
    if (!prepared) throw new Error(`${key}: no mesh`);
    const { geo, length, sourceMat } = prepared;
    const material = makeMaterial(geo, sourceMat);

    if (key === "bus") {
      const s = spec.fit / length;
      geo.scale(s, s, s);
      const mesh = new THREE.Mesh(geo, material);
      mesh.frustumCulled = false;
      busPivot.add(mesh);
    } else {
      modelLen[key] = length;
      const im = new THREE.InstancedMesh(geo, material, quality.maxTraffic);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      im.count = 0;
      inst[key] = im;
      scene.add(im);
    }
    loaded[key] = true;
  }

  /**
   * The clothing tint.
   *
   * Meshy exports one mesh with one material: skin, hair, eyes, shoes and
   * clothes are all in a single atlas, so there is no clothing material to
   * recolour and no safe way to tint the whole texture. The build step in
   * tools/cloth-mask.py works out which part of the atlas is cloth and
   * writes that into the atlas's alpha channel — free, since the material
   * is opaque and nothing else reads it.
   *
   * Here that mask picks which texels take the per-instance colours. A
   * texel's own brightness is carried through, so folds, creases and
   * shading survive the recolour instead of flattening into a paint patch,
   * and every texel the mask does not claim — every face — is untouched.
   */
  function dressMaterial(m) {
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", `#include <common>
          attribute vec3 aShirt;
          attribute vec3 aTrous;
          varying vec3 vShirtCol;
          varying vec3 vTrousCol;`)
        .replace("#include <begin_vertex>", `#include <begin_vertex>
          vShirtCol = aShirt;
          vTrousCol = aTrous;`);
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", `#include <common>
          varying vec3 vShirtCol;
          varying vec3 vTrousCol;`)
        .replace("#include <map_fragment>", `
          vec4 texel = texture2D( map, vMapUv );
          float cloth = texel.a;
          float wShirt = smoothstep(0.70, 0.92, cloth);
          float wTrous = smoothstep(0.24, 0.44, cloth) * (1.0 - smoothstep(0.56, 0.76, cloth));
          float lum = dot(texel.rgb, vec3(0.2126, 0.7152, 0.0722));
          vec3 rgb = mix(texel.rgb, vShirtCol * (0.30 + lum * 1.25), wShirt);
          rgb = mix(rgb, vTrousCol * (0.30 + lum * 1.25), wTrous);
          diffuseColor *= vec4( rgb, 1.0 );`);
    };
    if ("metalness" in m) m.metalness = 0;
    if ("roughness" in m) m.roughness = 0.92;
    m.transparent = false;
    m.needsUpdate = true;
    return m;
  }

  async function loadPerson(loader, spec) {
    const gltf = await loader.loadAsync(spec.url());
    if (disposed) return;
    const prepared = prepareGeometry(gltf.scene, 0);
    if (!prepared) throw new Error(`${spec.kind}: no mesh`);
    const { geo, sourceMat } = prepared;
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    // scale to a real height; prepareGeometry has already put the feet at 0
    const s = spec.height / Math.max(0.01, bb.max.y - bb.min.y);
    geo.scale(s, s, s);
    geo.computeBoundingSphere();

    const cap = quality.maxPeople;
    const shirt = new Float32Array(cap * 3);
    const trous = new Float32Array(cap * 3);
    geo.setAttribute("aShirt", new THREE.InstancedBufferAttribute(shirt, 3));
    geo.setAttribute("aTrous", new THREE.InstancedBufferAttribute(trous, 3));
    const im = new THREE.InstancedMesh(geo, dressMaterial(sourceMat), cap);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.frustumCulled = false;
    im.count = 0;
    scene.add(im);
    people[spec.kind] = { im, shirt, trous, height: spec.height };
    peopleReady += 1;
  }

  async function boot() {
    if (!canvas) { failed = true; return; }
    try {
      const [three, gltf, meshopt] = await Promise.all([
        import("three"),
        import("three/examples/jsm/loaders/GLTFLoader.js"),
        import("three/examples/jsm/libs/meshopt_decoder.module.js"),
      ]);
      if (disposed) return;
      THREE = three;
      Loader = gltf.GLTFLoader;
      Decoder = meshopt.MeshoptDecoder;
    } catch {
      failed = true;
      onError?.("three-load-failed");
      return;
    }
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        // MSAA is one of the priciest things a weak GPU can be asked for.
        antialias: quality.antialias,
        powerPreference: "high-performance",
      });
    } catch {
      failed = true;
      onError?.("webgl-unavailable");
      return;
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(64, 1, 0.3, 400);
    ndc = new THREE.Vector3();
    mat4 = new THREE.Matrix4();
    quat = new THREE.Quaternion();
    euler = new THREE.Euler(0, 0, 0, "YXZ");
    posV = new THREE.Vector3();
    sclV = new THREE.Vector3();

    sky = new THREE.HemisphereLight(0xdfeaf5, 0x50564a, 2.1);
    scene.add(sky);
    sun = new THREE.DirectionalLight(0xfff4e2, 2.3);
    sun.position.set(24, 40, 16);
    scene.add(sun);
    busPivot = new THREE.Group();
    scene.add(busPivot);

    if (pendingSize) { setSize(...pendingSize); pendingSize = null; }

    const loader = new Loader();
    loader.setMeshoptDecoder(Decoder);
    // each model is independent: one missing model must not sink the rest
    await Promise.all(Object.keys(MODELS).map((k) =>
      loadModel(loader, k).catch((e) => {
        onError?.(`${k}: ${e?.message || "load failed"}`);
      })));
    if (disposed) return;
    if (loaded.bus || loaded.suv || loaded.car) onReady?.();
    else { failed = true; onError?.("no-models"); }

    /* People come second, on purpose. They are the least important thing
       on screen and there are four of them to fetch; making the bus wait
       on a bus queue would delay the only model the player is looking at. */
    await Promise.all(PEOPLE_MODELS.map((spec) =>
      loadPerson(loader, spec).catch((e) => {
        onError?.(`${spec.kind}: ${e?.message || "load failed"}`);
      })));
  }

  boot();

  /* ------------------------------ sizing ------------------------------ */

  function setSize(w, h, dpr) {
    if (disposed) return;
    W = w; H = h;
    if (!renderer) { pendingSize = [w, h, dpr]; return; }
    renderer.setPixelRatio(Math.min(dpr, quality.maxDpr));
    bufW = 0; bufH = 0;                       // force a refit at the new scale
  }

  /** Match the software renderer's camera exactly. */
  function syncCamera(cam, aspect) {
    camera.fov = (cam.fov * 180) / Math.PI;   // both are vertical FOV
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    const sinY = Math.sin(cam.yaw), cosY = Math.cos(cam.yaw);
    const sinP = Math.sin(cam.pitch), cosP = Math.cos(cam.pitch);
    camFx = sinY * cosP; camFy = sinP; camFz = cosY * cosP;
    camera.position.set(cam.x, cam.y, cam.z);
    camera.up.set(-sinY * sinP, cosP, -cosY * sinP);
    camera.lookAt(cam.x + camFx, cam.y + camFy, cam.z + camFz);
  }

  function setMood(dusk) {
    if (!sun || !sky) return;
    if (dusk) {
      sky.color.setHex(0x9fb0d8); sky.groundColor.setHex(0x33343f); sky.intensity = 1.15;
      sun.color.setHex(0xffd0a0); sun.intensity = 1.1;
      sun.position.set(-30, 14, 20);
    } else {
      sky.color.setHex(0xdfeaf5); sky.groundColor.setHex(0x50564a); sky.intensity = 2.1;
      sun.color.setHex(0xfff4e2); sun.intensity = 2.3;
      sun.position.set(24, 40, 16);
    }
  }

  /* --------------------------- screen bounds --------------------------- */

  let minX = 0, minY = 0, maxX = 0, maxY = 0, anyOnScreen = false, nearDepth = 0;
  let camFx = 0, camFy = 0, camFz = 0;

  function resetBounds() {
    minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
    anyOnScreen = false; nearDepth = Infinity;
  }

  /** Camera-space forward depth, the same quantity render.js sorts on. */
  function depthOf(x, z, baseY, cam) {
    return (x - cam.x) * camFx + ((baseY || 0) + BUS.hgt * 0.5 - cam.y) * camFy
      + (z - cam.z) * camFz;
  }

  function addBounds(x, z, halfLen, halfWid, height, yaw, cam, baseY) {
    const y0 = baseY || 0;
    const d = depthOf(x, z, y0, cam);
    if (d > 0 && d < nearDepth) nearDepth = d;
    const s = Math.sin(yaw), c = Math.cos(yaw);
    for (let i = 0; i < 8; i += 1) {
      const lx = (i & 1) ? halfWid : -halfWid;
      const lz = (i & 2) ? halfLen : -halfLen;
      const ly = y0 + ((i & 4) ? height : -0.6);
      ndc.set(x + lx * c + lz * s, ly, z - lx * s + lz * c).project(camera);
      if (ndc.z > 1) continue;
      anyOnScreen = true;
      const px = (ndc.x * 0.5 + 0.5) * W;
      const py = (-ndc.y * 0.5 + 0.5) * H;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
  }

  /* Resizing a WebGL canvas is not free, so the target only grows in 64px
     steps and shrinks once it is more than double what is needed. */
  function fitBuffer(w, h) {
    const q = (v) => Math.min(4096, Math.max(64, Math.ceil(v / 64) * 64));
    const nw = q(w), nh = q(h);
    if (nw > bufW || nw < bufW / 2 || nh > bufH || nh < bufH / 2) {
      bufW = nw; bufH = nh;
      renderer.setSize(bufW, bufH, false);
    }
  }

  /* -------------------------------- draw -------------------------------- */

  const picked = [];

  /**
   * Renders every visible vehicle for this frame.
   *
   * `drawBus` is false in cockpit view — the camera sits inside the bus,
   * so only traffic is drawn. Returns null when nothing is renderable,
   * which tells the caller to fall back to the procedural shapes, and
   * reports which cars it drew so the caller can skip those.
   */
  /* Scratch 2D canvases, one per depth slice. The WebGL canvas is reused
     for every slice, so each slice's pixels have to be taken off it before
     the next render overwrites them. */
  const sliceBufs = [];
  function sliceBuf(k, w, h) {
    let b = sliceBufs[k];
    if (!b) {
      const cv = document.createElement("canvas");
      b = { canvas: cv, ctx: cv.getContext("2d"), w: 0, h: 0 };
      sliceBufs[k] = b;
    }
    const q = (v) => Math.min(4096, Math.max(32, Math.ceil(v / 64) * 64));
    const nw = q(w), nh = q(h);
    if (b.w !== nw || b.h !== nh) {
      b.canvas.width = nw; b.canvas.height = nh;
      b.w = nw; b.h = nh;
    }
    return b;
  }

  const queue = [];
  const gaps = [];
  const rects = [];

  /* Hex to linear float, cached: the renderer works in linear space, and
     the same dozen shirt colours come round every frame. */
  const tintCache = new Map();
  function setTint(target, slot, hex) {
    let c = tintCache.get(hex);
    if (!c) {
      const n = parseInt((hex || "#888888").slice(1), 16);
      const to = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
      c = [to(((n >> 16) & 255) / 255), to(((n >> 8) & 255) / 255), to((n & 255) / 255)];
      tintCache.set(hex, c);
    }
    target[slot * 3] = c[0];
    target[slot * 3 + 1] = c[1];
    target[slot * 3 + 2] = c[2];
  }

  /**
   * Renders every visible vehicle for this frame, in depth slices.
   *
   * All the vehicles used to go into one sprite composited at a single
   * depth — the depth of whichever was nearest. Everything in that sprite
   * therefore painted over every building further away than that one
   * vehicle, so a car two blocks off appeared straight through the tower
   * in front of it, and popped in and out of solidity as the nearest car
   * changed. Splitting the vehicles into a few depth bands and giving each
   * band its own place in the painter's order is what puts them back
   * behind the scenery they are actually behind.
   *
   * `drawBus` is false in cockpit view — the camera sits inside the bus,
   * so only traffic is drawn. Returns null when nothing is renderable,
   * which tells the caller to fall back to the procedural shapes, and
   * reports which cars and which people it drew so the caller can skip
   * those.
   */
  function render({ bus, cars, folk, cam, aspect, dusk, drawBus, W: w, H: h }) {
    if (failed || disposed || !renderer) return null;
    const haveTraffic = loaded.suv || loaded.car;
    if (!loaded.bus && !haveTraffic && !peopleReady) return null;
    W = w; H = h;

    setMood(dusk);
    syncCamera(cam, aspect);

    queue.length = 0;
    const drawn = new Set();
    const drawnFolk = new Set();

    const showBus = drawBus && loaded.bus;
    if (showBus) {
      queue.push({
        bus: true, d: depthOf(bus.x, bus.z, bus.y || 0, cam),
        x: bus.x, z: bus.z, y: bus.y || 0, yaw: bus.yaw,
        hl: BUS.len * 0.55, hw: BUS.wid * 0.95, ht: BUS.hgt * 1.12,
      });
    }

    if (haveTraffic) {
      picked.length = 0;
      for (let i = 0; i < cars.length; i += 1) {
        const c = cars[i];
        const dx = c.x - cam.x, dz = c.z - cam.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > TRAFFIC_DIST * TRAFFIC_DIST) continue;
        /* Proper frustum test. A forward-only check keeps cars that are
           70m off to one side — invisible, but still costing an instance
           slot and stretching the composite rectangle across the screen. */
        ndc.set(c.x, (c.y || 0) + c.h * 0.5, c.z).project(camera);
        if (ndc.z > 1) continue;                       // behind the camera
        const margin = 0.22 + 8 / Math.max(8, Math.sqrt(d2));
        if (ndc.x < -1 - margin || ndc.x > 1 + margin) continue;
        if (ndc.y < -1 - margin || ndc.y > 1 + margin) continue;
        picked.push({ c, d2, i });
      }
      picked.sort((a, b) => a.d2 - b.d2);
      const seen = { suv: 0, car: 0 };
      for (let n = 0; n < picked.length && n < quality.maxTraffic; n += 1) {
        const { c, i } = picked[n];
        const key = c.van ? "suv" : "car";
        if (!inst[key] || seen[key] >= quality.maxTraffic) continue;
        seen[key] += 1;
        drawn.add(i);
        queue.push({
          key, car: c, idx: i, d: depthOf(c.x, c.z, c.y || 0, cam),
          x: c.x, z: c.z, y: c.y || 0, yaw: c.yaw,
          hl: c.l * 0.55, hw: c.w * 0.95, ht: c.h * 1.4,
        });
      }
    }

    if (peopleReady && folk && folk.length) {
      picked.length = 0;
      for (let i = 0; i < folk.length; i += 1) {
        const p = folk[i];
        if (!people[p.kind]) continue;
        const dx = p.x - cam.x, dz = p.z - cam.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > PEOPLE_DIST * PEOPLE_DIST) continue;
        ndc.set(p.x, (p.y || 0) + 0.9, p.z).project(camera);
        if (ndc.z > 1) continue;
        const margin = 0.2 + 4 / Math.max(4, Math.sqrt(d2));
        if (ndc.x < -1 - margin || ndc.x > 1 + margin) continue;
        if (ndc.y < -1 - margin || ndc.y > 1 + margin) continue;
        picked.push({ p, d2, i });
      }
      picked.sort((a, b) => a.d2 - b.d2);
      const seen = {};
      for (let n = 0; n < picked.length && n < quality.maxPeople; n += 1) {
        const { p, i } = picked[n];
        const slot = people[p.kind];
        seen[p.kind] = (seen[p.kind] || 0) + 1;
        if (seen[p.kind] > quality.maxPeople) continue;
        drawnFolk.add(i);
        const ht = slot.height * (p.scale || 1);
        queue.push({
          person: p, kind: p.kind, idx: i,
          d: depthOf(p.x, p.z, p.y || 0, cam),
          x: p.x, z: p.z, y: p.y || 0, yaw: p.yaw || 0,
          hl: 0.42, hw: 0.42, ht: ht * 1.06,
        });
      }
    }

    if (!queue.length) return null;

    // near to far
    queue.sort((a, b) => a.d - b.d);

    /* Break the run wherever there is a real gap between one vehicle and
       the next — that gap is exactly where a building can sit. Only a few
       breaks are affordable, so take the widest gaps: those are the ones
       most likely to have something solid standing in them. */
    const maxSlices = quality.maxDpr <= 1 ? 2 : 3;
    gaps.length = 0;
    for (let k = 1; k < queue.length; k += 1) {
      const g = queue[k].d - queue[k - 1].d;
      if (g > SLICE_GAP) gaps.push({ k, g });
    }
    gaps.sort((a, b) => b.g - a.g);
    const bounds = [0];
    for (let n = 0; n < gaps.length && bounds.length < maxSlices; n += 1) {
      bounds.push(gaps[n].k);
    }
    bounds.sort((a, b) => a - b);
    bounds.push(queue.length);

    /* Measure every slice before rendering any of them. All slices share
       one WebGL buffer, and resizing it is expensive, so it gets sized once
       to the largest slice rather than re-sized between slices. */
    rects.length = 0;
    let needW = 2, needH = 2;
    for (let sIdx = 0; sIdx < bounds.length - 1; sIdx += 1) {
      const from = bounds[sIdx], to = bounds[sIdx + 1];
      resetBounds();
      for (let k = from; k < to; k += 1) {
        const e = queue[k];
        addBounds(e.x, e.z, e.hl, e.hw, e.ht, e.yaw, cam, e.y);
      }
      if (!anyOnScreen) { rects.push(null); continue; }
      const pad = 6;
      const rx = Math.max(0, Math.floor(minX - pad));
      const ry = Math.max(0, Math.floor(minY - pad));
      const rw = Math.min(W, Math.ceil(maxX + pad)) - rx;
      const rh = Math.min(H, Math.ceil(maxY + pad)) - ry;
      if (rw < 2 || rh < 2) { rects.push(null); continue; }
      if (rw > needW) needW = rw;
      if (rh > needH) needH = rh;
      /* The slice sits in the painter's order at its nearest vehicle: the
         scenery it must hide behind is everything beyond that. */
      rects.push({ rx, ry, rw, rh, depth: isFinite(nearDepth) ? nearDepth : queue[from].d });
    }
    fitBuffer(needW, needH);

    const slices = [];
    for (let sIdx = 0; sIdx < bounds.length - 1; sIdx += 1) {
      const rect = rects[sIdx];
      if (!rect) continue;
      const from = bounds[sIdx], to = bounds[sIdx + 1];
      const counts = { suv: 0, car: 0 };
      const folkCounts = {};
      let hasBus = false;
      for (let k = from; k < to; k += 1) {
        const e = queue[k];
        if (e.person) {
          const slot = people[e.kind];
          const n = folkCounts[e.kind] || 0;
          if (n >= quality.maxPeople) continue;
          const sc = e.person.scale || 1;
          /* A pavement of identical uprights is what gives a crowd away,
             so each figure carries its own small lean and turn from
             people.js. Nothing animates: a walk cycle on twenty skinned
             figures is not affordable here, and standing still with
             different postures reads better than all leaning alike. */
          euler.set(e.person.lean || 0, e.yaw, 0);
          quat.setFromEuler(euler);
          mat4.compose(posV.set(e.x, e.y, e.z), quat, sclV.set(sc, sc, sc));
          slot.im.setMatrixAt(n, mat4);
          setTint(slot.shirt, n, e.person.shirt);
          setTint(slot.trous, n, e.person.trous);
          folkCounts[e.kind] = n + 1;
        } else if (e.bus) {
          hasBus = true;
          busPivot.position.set(e.x, e.y, e.z);
          busPivot.rotation.order = "YXZ";
          busPivot.rotation.y = e.yaw;
          // nose up on a climb: +X rotation tips the model's forward axis down
          busPivot.rotation.x = -(bus.pitch || 0);
          busPivot.rotation.z = bus.roll || 0;
        } else {
          const c = e.car;
          const im = inst[e.key];
          // scale the model so its length matches the body the AI drives
          const sc = c.l / (modelLen[e.key] || 1);
          /* Single-mesh models, so the wheels cannot turn. Leaning the body
             on the brakes and through corners — straight out of the
             simulation's own accel and yaw rate — is what makes them look
             driven rather than slid. */
          const lean = clamp(-(c.accel || 0) * 0.018, -0.06, 0.06);
          const pitch = lean - (c.pitch || 0);
          const roll = clamp(-(c.yawRate || 0) * c.speed * 0.014, -0.09, 0.09);
          euler.set(pitch, c.yaw, roll);
          quat.setFromEuler(euler);
          mat4.compose(posV.set(e.x, e.y, e.z), quat, sclV.set(sc, sc, sc));
          im.setMatrixAt(counts[e.key], mat4);
          counts[e.key] += 1;
        }
      }
      busPivot.visible = hasBus;
      for (const key of ["suv", "car"]) {
        const im = inst[key];
        if (!im) continue;
        im.count = counts[key];
        im.instanceMatrix.needsUpdate = true;
      }
      for (const key in people) {
        const slot = people[key];
        slot.im.count = folkCounts[key] || 0;
        if (!slot.im.count) continue;
        slot.im.instanceMatrix.needsUpdate = true;
        slot.im.geometry.getAttribute("aShirt").needsUpdate = true;
        slot.im.geometry.getAttribute("aTrous").needsUpdate = true;
      }

      camera.setViewOffset(W, H, rect.rx, rect.ry, bufW, bufH);
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      camera.clearViewOffset();

      /* The WebGL canvas is reused for every slice, so this slice's pixels
         have to come off it before the next render overwrites them. The
         buffer is sized for the largest slice, but only this slice's own
         corner of it holds anything, so only that is copied. */
      const px = canvas.width / bufW;
      const buf = sliceBuf(slices.length, rect.rw, rect.rh);
      buf.ctx.clearRect(0, 0, buf.w, buf.h);
      buf.ctx.drawImage(
        canvas, 0, 0, rect.rw * px, rect.rh * px, 0, 0, rect.rw, rect.rh,
      );
      slices.push({
        canvas: buf.canvas, srcW: rect.rw, srcH: rect.rh,
        rx: rect.rx, ry: rect.ry, bufW: rect.rw, bufH: rect.rh, depth: rect.depth,
      });
    }

    if (!slices.length) return null;
    return { slices, drawn, folk: drawnFolk, nearDepth: slices[0].depth };
  }

  function dispose() {
    disposed = true;
    scene?.traverse((o) => {
      if (!o.isMesh && !o.isInstancedMesh) return;
      o.geometry?.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) m?.dispose();
    });
    renderer?.dispose();
    renderer = null; scene = null; busPivot = null;
    inst.suv = null; inst.car = null;
  }

  return {
    setSize, render, dispose,
    get ready() { return loaded.bus || loaded.suv || loaded.car; },
    get lowQuality() { return quality.maxDpr <= 1; },
    get busReady() { return loaded.bus; },
    get trafficReady() { return loaded.suv || loaded.car; },
    get failed() { return failed; },
  };
}
