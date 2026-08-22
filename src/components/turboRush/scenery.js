/* ------------------------------------------------------------------ *
 * Theme scenery: everything that stands beside the road. Placed once,
 * in world coordinates, never parented to the camera. Uses instancing
 * for repeated shapes so 12 rich environments stay cheap to draw.
 * ------------------------------------------------------------------ */
import * as THREE from "three";
import { mulberry } from "./spline.js";
import { FLAG } from "./trackBuild.js";

const perp = (ang) => ({ x: Math.cos(ang), z: -Math.sin(ang) });
const dummy = new THREE.Object3D();

/* Scatter transform slots along the track at side offsets. */
function slots(samples, rng, { every = 8, offMin = 12, offMax = 55, density = 1, skipTunnels = true }) {
  const out = [];
  for (let i = 0; i < samples.length; i += every) {
    const s = samples[i];
    if (skipTunnels && (s.flags & FLAG.TUNNEL)) continue;
    if (rng() > density) continue;
    const side = rng() > 0.5 ? 1 : -1;
    const off = (s.w / 2 + offMin + rng() * (offMax - offMin)) * side;
    const p = perp(s.ang);
    out.push({ x: s.x + p.x * off, z: s.z + p.z * off, y: s.y, side, sample: s, r: rng });
  }
  return out;
}

function inst(geo, mat, places, fit) {
  const m = new THREE.InstancedMesh(geo, mat, places.length);
  places.forEach((pl, i) => {
    dummy.position.set(pl.x, pl.y ?? 0, pl.z);
    dummy.rotation.set(0, pl.ry ?? 0, 0);
    dummy.scale.setScalar(pl.s ?? 1);
    if (fit) fit(dummy, pl, i);
    dummy.updateMatrix();
    m.setMatrixAt(i, dummy.matrix);
  });
  m.instanceMatrix.needsUpdate = true;
  return m;
}

const lam = (c, e, ei = 0) => new THREE.MeshLambertMaterial({ color: c, emissive: e ?? 0x000000, emissiveIntensity: ei });

/* Canvas texture with lit windows for city / station structures. */
function windowTex(base, lit) {
  const c = document.createElement("canvas"); c.width = 64; c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = base; g.fillRect(0, 0, 64, 128);
  for (let y = 4; y < 124; y += 8) for (let x = 4; x < 60; x += 8) {
    if (Math.random() < 0.55) { g.fillStyle = lit; g.fillRect(x, y, 5, 5); }
  }
  const t = new THREE.CanvasTexture(c);
  return t;
}

function earthSphere(radius) {
  const c = document.createElement("canvas"); c.width = 256; c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, "#1a4a8a"); grad.addColorStop(1, "#123a72");
  g.fillStyle = grad; g.fillRect(0, 0, 256, 128);
  g.fillStyle = "#2e8a4a";
  const blob = (x, y, r) => { g.beginPath(); g.ellipse(x, y, r, r * 0.65, Math.random(), 0, 7); g.fill(); };
  blob(50, 45, 26); blob(90, 80, 20); blob(150, 40, 30); blob(200, 90, 22); blob(230, 30, 14);
  g.fillStyle = "rgba(255,255,255,0.55)";
  for (let i = 0; i < 26; i++) { g.beginPath(); g.ellipse(Math.random() * 256, Math.random() * 128, 14 + Math.random() * 22, 4 + Math.random() * 6, 0, 0, 7); g.fill(); }
  g.fillStyle = "rgba(230,240,255,0.9)"; g.fillRect(0, 0, 256, 7); g.fillRect(0, 121, 256, 7);
  const tex = new THREE.CanvasTexture(c);
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 24),
    new THREE.MeshBasicMaterial({ map: tex }));
}

function starField(rng, count, radius) {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const th = rng() * Math.PI * 2, ph = Math.acos(2 * rng() - 1);
    pos[i * 3] = radius * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = Math.abs(radius * Math.cos(ph)) * 0.9 - radius * 0.25;
    pos[i * 3 + 2] = radius * Math.sin(ph) * Math.sin(th);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false }));
}

/* ---- individual props (single geometry each, instanced) ---- */
const palmTrunk = () => new THREE.CylinderGeometry(0.22, 0.4, 6, 6);
const palmCrown = () => new THREE.ConeGeometry(2.6, 1.6, 6);
const pine = () => new THREE.ConeGeometry(2.2, 7, 7);
const bushy = () => new THREE.SphereGeometry(2.4, 8, 6);
const boulder = () => new THREE.DodecahedronGeometry(2.2);
const columnG = () => new THREE.CylinderGeometry(0.9, 1.05, 7, 8);

export function buildScenery(compiled, quality = 1) {
  const { samples, def, shortcuts } = compiled;
  const rng = mulberry(def.seed * 101 + 3);
  const g = new THREE.Group();
  const q = quality; // 0.5 mobile .. 1 desktop
  const dyn = {};

  const add = (mesh) => { g.add(mesh); return mesh; };

  switch (def.theme) {
    case "beach": {
      const palms = slots(samples, rng, { every: 6, offMin: 6, offMax: 40, density: 0.8 * q });
      add(inst(palmTrunk(), lam("#8a6b42"), palms.map((p) => ({ ...p, y: p.y + 3, s: 0.8 + p.r() * 0.5 }))));
      add(inst(palmCrown(), lam("#2e8a4a"), palms.map((p) => ({ ...p, y: p.y + 6.2, s: 0.8 + p.r() * 0.5, ry: p.r() * 3 }))));
      const rocks = slots(samples, rng, { every: 14, offMin: 20, offMax: 70, density: 0.6 * q });
      add(inst(boulder(), lam("#8a8272"), rocks.map((p) => ({ ...p, y: p.y + 0.6, s: 0.5 + p.r() * 1.2, ry: p.r() * 3 }))));
      // fishing village near the sand-run shortcut
      const sc = shortcuts.find((s) => s.surface === "beach");
      if (sc) {
        const hut = new THREE.BoxGeometry(4, 3, 4);
        const roof = new THREE.ConeGeometry(3.4, 2, 4);
        const spots = sc.samples.filter((_, i) => i % 8 === 3).slice(0, 6).map((s) => {
          const p = perp(s.ang);
          return { x: s.x + p.x * 10, z: s.z + p.z * 10, y: s.y, ry: rng() * 3 };
        });
        add(inst(hut, lam("#c8a878"), spots.map((p) => ({ ...p, y: p.y + 1.5 }))));
        add(inst(roof, lam("#8a5a32"), spots.map((p) => ({ ...p, y: p.y + 4, ry: 0.78 }))));
      }
      break;
    }
    case "mountain": {
      const pines = slots(samples, rng, { every: 5, offMin: 8, offMax: 60, density: 0.9 * q });
      add(inst(pine(), lam("#2a5a34"), pines.map((p) => ({ ...p, y: p.y + (p.sample.y > (def.snowLine || 99) ? 2.5 : 3.2), s: 0.7 + p.r() * 0.7 }))));
      const rocks = slots(samples, rng, { every: 10, offMin: 14, offMax: 50, density: 0.7 * q });
      add(inst(boulder(), lam("#6d7278"), rocks.map((p) => ({ ...p, y: p.y + 0.8, s: 0.6 + p.r() * 1.6, ry: p.r() * 3 }))));
      // far peaks
      const peakGeo = new THREE.ConeGeometry(60, 130, 5);
      const peaks = [];
      for (let i = 0; i < 8; i++) {
        const th = (i / 8) * Math.PI * 2;
        peaks.push({ x: Math.cos(th) * 560, z: Math.sin(th) * 560, y: -10, s: 0.7 + rng() * 0.8, ry: rng() * 3 });
      }
      add(inst(peakGeo, lam("#7d8898"), peaks));
      const capGeo = new THREE.ConeGeometry(24, 44, 5);
      add(inst(capGeo, lam("#eef2f5"), peaks.map((p) => ({ ...p, y: p.y + 86 * p.s, s: p.s }))));
      // waterfall sheet
      const hi = samples.reduce((a, b) => (b.y > a.y ? b : a));
      const fall = new THREE.Mesh(new THREE.PlaneGeometry(6, hi.y + 8),
        new THREE.MeshBasicMaterial({ color: 0x9ad4ff, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
      const pp = perp(hi.ang);
      fall.position.set(hi.x + pp.x * 30, (hi.y + 8) / 2 - 4, hi.z + pp.z * 30);
      add(fall); dyn.waterfall = fall;
      break;
    }
    case "hills": {
      const trees = slots(samples, rng, { every: 6, offMin: 10, offMax: 60, density: 0.8 * q });
      add(inst(new THREE.CylinderGeometry(0.3, 0.42, 3, 6), lam("#6d4c2b"), trees.map((p) => ({ ...p, y: p.y + 1.5 }))));
      add(inst(bushy(), lam("#3f8a3a"), trees.map((p) => ({ ...p, y: p.y + 4.4, s: 0.7 + p.r() * 0.6 }))));
      const bales = slots(samples, rng, { every: 12, offMin: 9, offMax: 30, density: 0.6 * q });
      add(inst(new THREE.CylinderGeometry(1.1, 1.1, 1.6, 10), lam("#d8b85a"), bales.map((p) => ({ ...p, y: p.y + 1.1, ry: p.r() * 3 }))));
      // barns
      const barns = slots(samples, rng, { every: 34, offMin: 24, offMax: 55, density: 0.9 });
      add(inst(new THREE.BoxGeometry(8, 5, 6), lam("#a33a2e"), barns.map((p) => ({ ...p, y: p.y + 2.5, ry: p.r() * 3 }))));
      add(inst(new THREE.ConeGeometry(5.4, 3, 4), lam("#6d3a28"), barns.map((p) => ({ ...p, y: p.y + 6.4, ry: 0.78 }))));
      // fences by the road
      const posts = slots(samples, rng, { every: 4, offMin: 2, offMax: 3, density: 0.9 * q });
      add(inst(new THREE.BoxGeometry(0.18, 1, 0.18), lam("#8a7a5a"), posts.map((p) => ({ ...p, y: p.y + 0.5 }))));
      break;
    }
    case "jungle": {
      const canopy = slots(samples, rng, { every: 4, offMin: 7, offMax: 50, density: 0.95 * q });
      add(inst(new THREE.CylinderGeometry(0.5, 0.7, 8, 6), lam("#4a3520"), canopy.map((p) => ({ ...p, y: p.y + 4, s: 0.8 + p.r() * 0.7 }))));
      add(inst(new THREE.SphereGeometry(3.6, 8, 6), lam("#1f6b2a"), canopy.map((p) => ({ ...p, y: p.y + 9.5, s: 0.8 + p.r() * 0.8 }))));
      // ruins: columns + broken walls
      const ruins = slots(samples, rng, { every: 16, offMin: 8, offMax: 26, density: 0.7 });
      add(inst(columnG(), lam("#9a9484"), ruins.map((p) => ({ ...p, y: p.y + 3.5, s: 0.7 + p.r() * 0.6 }))));
      const walls = slots(samples, rng, { every: 26, offMin: 10, offMax: 30, density: 0.6 });
      add(inst(new THREE.BoxGeometry(6, 3.5, 1.2), lam("#8a8474"), walls.map((p) => ({ ...p, y: p.y + 1.6, ry: p.r() * 3 }))));
      break;
    }
    case "canyon": {
      const mesaGeo = new THREE.CylinderGeometry(16, 22, 40, 7);
      const mesas = slots(samples, rng, { every: 18, offMin: 45, offMax: 120, density: 0.85 });
      add(inst(mesaGeo, lam("#b8703a"), mesas.map((p) => ({ ...p, y: p.y + 12, s: 0.5 + p.r() * 1.1, ry: p.r() * 3 }))));
      const cactus = slots(samples, rng, { every: 9, offMin: 8, offMax: 40, density: 0.6 * q });
      add(inst(new THREE.CylinderGeometry(0.4, 0.5, 3.4, 6), lam("#4a7a3a"), cactus.map((p) => ({ ...p, y: p.y + 1.7 }))));
      const rocks = slots(samples, rng, { every: 8, offMin: 10, offMax: 55, density: 0.7 * q });
      add(inst(boulder(), lam("#a8683c"), rocks.map((p) => ({ ...p, y: p.y + 0.7, s: 0.5 + p.r() * 1.4, ry: p.r() * 3 }))));
      // rock arches spanning the road
      for (const f of [0.28, 0.58]) {
        const s = samples[Math.floor(f * samples.length)];
        const arch = new THREE.Mesh(new THREE.TorusGeometry(s.w * 0.8, 2.2, 7, 14, Math.PI), lam("#a8683c"));
        arch.position.set(s.x, s.y + 0.5, s.z);
        arch.rotation.y = s.ang;
        add(arch);
      }
      break;
    }
    case "neon": {
      const towerGeo = new THREE.BoxGeometry(12, 60, 12);
      /* self-lit at night — a city that actually glows */
      const mats = [
        new THREE.MeshBasicMaterial({ map: windowTex("#171c2c", "#ffd980") }),
        new THREE.MeshBasicMaterial({ map: windowTex("#131826", "#5ae0ff") }),
        new THREE.MeshBasicMaterial({ map: windowTex("#1a1428", "#ff5ad0") }),
      ];
      for (let mi = 0; mi < mats.length; mi++) {
        const spots = slots(samples, rng, { every: 7, offMin: 16, offMax: 90, density: 0.85 * q })
          .filter((_, i) => i % mats.length === mi);
        add(inst(towerGeo, mats[mi], spots.map((p) => ({ ...p, y: p.y + 28 * (0.5 + p.r()), s: 0.5 + p.r() * 1.0, ry: Math.round(p.r() * 4) * (Math.PI / 2) }))));
      }
      // holo billboards
      const holoGeo = new THREE.PlaneGeometry(8, 4.5);
      const holos = slots(samples, rng, { every: 20, offMin: 10, offMax: 16, density: 0.8 });
      const holoMat = new THREE.MeshBasicMaterial({ color: 0x35d0ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
      add(inst(holoGeo, holoMat, holos.map((p) => ({ ...p, y: p.y + 9, ry: p.r() * 3 }))));
      // street lights along the road
      const lamps = slots(samples, rng, { every: 8, offMin: 1.5, offMax: 2.2, density: 0.9 * q });
      add(inst(new THREE.CylinderGeometry(0.12, 0.12, 6, 5), lam("#3a4152"), lamps.map((p) => ({ ...p, y: p.y + 3 }))));
      add(inst(new THREE.SphereGeometry(0.4, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffe8b0 }), lamps.map((p) => ({ ...p, y: p.y + 6.1 }))));
      dyn.neon = true;
      break;
    }
    case "coastal": {
      const villas = slots(samples, rng, { every: 14, offMin: 14, offMax: 45, density: 0.7 * q });
      add(inst(new THREE.BoxGeometry(6, 4, 6), lam("#e8e2d2"), villas.map((p) => ({ ...p, y: p.y + 2, ry: p.r() * 3 }))));
      add(inst(new THREE.ConeGeometry(4.6, 2.2, 4), lam("#b8543a"), villas.map((p) => ({ ...p, y: p.y + 5.1, ry: 0.78 }))));
      const cypress = slots(samples, rng, { every: 7, offMin: 6, offMax: 30, density: 0.8 * q });
      add(inst(new THREE.ConeGeometry(1.2, 6, 6), lam("#2a5a34"), cypress.map((p) => ({ ...p, y: p.y + 3, s: 0.7 + p.r() * 0.6 }))));
      // lighthouse on the highest headland
      const hi = samples.reduce((a, b) => (b.y > a.y ? b : a));
      const ppl = perp(hi.ang);
      const lh = new THREE.Group();
      const towerL = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.2, 14, 10), lam("#eee8dc"));
      towerL.position.y = 7; lh.add(towerL);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 2, 10), lam("#b8352e")); cap.position.y = 15; lh.add(cap);
      const lampL = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff2b0 })); lampL.position.y = 16.4; lh.add(lampL);
      lh.position.set(hi.x + ppl.x * 26, hi.y, hi.z + ppl.z * 26);
      add(lh); dyn.lighthouse = lampL;
      break;
    }
    case "volcano": {
      // the mountain itself
      const cone = new THREE.Mesh(new THREE.ConeGeometry(180, 220, 24), lam("#4a3630"));
      cone.position.set(0, -20, 0);
      add(cone);
      const glowRing = new THREE.Mesh(new THREE.CylinderGeometry(26, 34, 8, 16),
        new THREE.MeshBasicMaterial({ color: 0xff6a2a }));
      glowRing.position.set(0, 196, 0);
      add(glowRing); dyn.crater = glowRing;
      const spikes = slots(samples, rng, { every: 8, offMin: 10, offMax: 55, density: 0.8 * q });
      add(inst(new THREE.ConeGeometry(1.6, 5, 5), lam("#3a2c28"), spikes.map((p) => ({ ...p, y: p.y + 2.4, s: 0.6 + p.r() * 1.2, ry: p.r() * 3 }))));
      const pools = slots(samples, rng, { every: 16, offMin: 18, offMax: 60, density: 0.7 });
      add(inst(new THREE.CylinderGeometry(4, 4, 0.3, 10),
        new THREE.MeshBasicMaterial({ color: 0xff7a2a }), pools.map((p) => ({ ...p, y: p.y - 1.2, s: 0.5 + p.r() * 1.3 }))));
      break;
    }
    case "station": {
      add(earthSphere(600)).position.set(0, -830, 0);
      add(starField(rng, Math.floor(700 * q), 1500));
      // station superstructure: big ring + trusses + solar wings
      const ring = new THREE.Mesh(new THREE.TorusGeometry(compiled.def.R * 1.35, 6, 8, 60),
        new THREE.MeshStandardMaterial({ color: 0x3a4458, metalness: 0.7, roughness: 0.4 }));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -18;
      add(ring);
      const panelGeo = new THREE.BoxGeometry(16, 0.4, 7);
      const panelMat = new THREE.MeshStandardMaterial({ color: 0x1a3a7a, metalness: 0.8, roughness: 0.3, emissive: 0x0a1a3a, emissiveIntensity: 0.6 });
      const panels = slots(samples, rng, { every: 14, offMin: 24, offMax: 70, density: 0.8 });
      add(inst(panelGeo, panelMat, panels.map((p) => ({ ...p, y: p.y - 6 + p.r() * 14, ry: p.r() * 3 }))));
      const podGeo = new THREE.CylinderGeometry(4, 4, 10, 10);
      const pods = slots(samples, rng, { every: 22, offMin: 16, offMax: 45, density: 0.8 });
      add(inst(podGeo, new THREE.MeshLambertMaterial({ map: windowTex("#222c3e", "#9ad4ff") }), pods.map((p) => ({ ...p, y: p.y + p.r() * 8 - 2, ry: p.r() * 3 }))));
      break;
    }
    case "moon": {
      add(starField(rng, Math.floor(700 * q), 1500));
      const earth = earthSphere(60);
      earth.position.set(400, 300, -500);
      add(earth);
      // craters: flattened torus rims
      const craterGeo = new THREE.TorusGeometry(8, 2, 6, 14);
      const craters = slots(samples, rng, { every: 10, offMin: 18, offMax: 90, density: 0.8 * q });
      add(inst(craterGeo, lam("#7d7f86"), craters.map((p) => ({ ...p, y: p.y - 1.2, s: 0.4 + p.r() * 1.4, ryx: 0 })), (d) => { d.rotation.x = Math.PI / 2; }));
      const rocks = slots(samples, rng, { every: 9, offMin: 10, offMax: 60, density: 0.7 * q });
      add(inst(boulder(), lam("#8d8f96"), rocks.map((p) => ({ ...p, y: p.y + 0.5, s: 0.3 + p.r() * 0.9, ry: p.r() * 3 }))));
      // research domes
      const domes = slots(samples, rng, { every: 30, offMin: 20, offMax: 50, density: 0.9 });
      add(inst(new THREE.SphereGeometry(7, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0xbcc8d8, transparent: true, opacity: 0.55, roughness: 0.2, metalness: 0.4 }),
        domes.map((p) => ({ ...p, y: p.y, s: 0.6 + p.r() * 0.8 }))));
      add(inst(new THREE.CylinderGeometry(0.6, 0.6, 5, 6), lam("#9aa2ab"), domes.map((p) => ({ ...p, y: p.y + 2.5, x: p.x + 8, z: p.z + 2 }))));
      break;
    }
    case "mars": {
      add(starField(rng, Math.floor(300 * q), 1500));
      const ridges = slots(samples, rng, { every: 14, offMin: 40, offMax: 110, density: 0.85 });
      add(inst(new THREE.ConeGeometry(24, 45, 6), lam("#8a4526"), ridges.map((p) => ({ ...p, y: p.y + 10, s: 0.5 + p.r() * 1.2, ry: p.r() * 3 }))));
      const rocks = slots(samples, rng, { every: 7, offMin: 9, offMax: 55, density: 0.8 * q });
      add(inst(boulder(), lam("#9a5232"), rocks.map((p) => ({ ...p, y: p.y + 0.5, s: 0.3 + p.r() * 1.0, ry: p.r() * 3 }))));
      // colony domes + habitat tubes
      const domes = slots(samples, rng, { every: 26, offMin: 18, offMax: 45, density: 0.9 });
      add(inst(new THREE.SphereGeometry(8, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0xd8c8b8, transparent: true, opacity: 0.5, roughness: 0.2 }),
        domes.map((p) => ({ ...p, s: 0.6 + p.r() * 0.9 }))));
      add(inst(new THREE.CylinderGeometry(2.2, 2.2, 12, 8),
        new THREE.MeshLambertMaterial({ map: windowTex("#4a3a30", "#ffd9a0") }),
        domes.map((p) => ({ ...p, y: p.y + 2.2, x: p.x + 12, ryx: 1 })), (d) => { d.rotation.z = Math.PI / 2; }));
      // Phobos & Deimos
      for (const [x, y, z, r] of [[-400, 260, 300, 14], [350, 320, -260, 9]]) {
        const moon = new THREE.Mesh(new THREE.DodecahedronGeometry(r), lam("#7d6a5c"));
        moon.position.set(x, y, z); add(moon);
      }
      break;
    }
    case "asteroid": {
      add(starField(rng, Math.floor(900 * q), 1600));
      // floating asteroids all around (some huge, far)
      const astGeo = new THREE.DodecahedronGeometry(6, 0);
      const asts = [];
      for (let i = 0; i < 90 * q; i++) {
        const s = samples[Math.floor(rng() * samples.length)];
        const p = perp(s.ang);
        const off = (30 + rng() * 220) * (rng() > 0.5 ? 1 : -1);
        asts.push({ x: s.x + p.x * off, y: s.y - 60 + rng() * 130, z: s.z + p.z * off, s: 0.4 + rng() * 4, ry: rng() * 3 });
      }
      const astMesh = inst(astGeo, lam("#6a6274"), asts);
      add(astMesh); dyn.asteroids = astMesh; dyn.asteroidSeeds = asts;
      // ringed planet + far gas giant
      const planet = new THREE.Mesh(new THREE.SphereGeometry(70, 24, 18), lam("#b88a5a"));
      planet.position.set(-500, 200, -600); add(planet);
      const ringP = new THREE.Mesh(new THREE.RingGeometry(90, 130, 40),
        new THREE.MeshBasicMaterial({ color: 0xd8c8a8, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
      ringP.position.copy(planet.position); ringP.rotation.x = 1.2; add(ringP);
      const giant = new THREE.Mesh(new THREE.SphereGeometry(50, 20, 16), lam("#5a7ab8"));
      giant.position.set(600, 260, 500); add(giant);
      // portal rings on the tube shortcut
      const sc = shortcuts.find((s) => s.surface === "tube");
      if (sc) {
        for (const end of [sc.samples[0], sc.samples[sc.samples.length - 1]]) {
          const portal = new THREE.Mesh(new THREE.TorusGeometry(5, 0.6, 8, 24),
            new THREE.MeshBasicMaterial({ color: 0x7cffd0 }));
          portal.position.set(end.x, end.y + 2, end.z);
          portal.rotation.y = end.ang;
          add(portal);
        }
      }
      break;
    }
  }

  /* Space tracks share drifting debris + a distant sun glow. */
  if (def.world === "space") {
    const sun = new THREE.Mesh(new THREE.SphereGeometry(30, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff4d8 }));
    sun.position.set(Math.cos(def.sun.az) * 900, 400, Math.sin(def.sun.az) * 900);
    g.add(sun);
  }

  return { group: g, dyn };
}
