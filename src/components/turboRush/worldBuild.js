/* ------------------------------------------------------------------ *
 * Builds the drivable world for a compiled track: road ribbon, kerbs,
 * tunnels, terrain skirt, water/lava, boost pads, item prisms, coins,
 * emblems, hazards and the start gate. All static geometry, all in
 * world space. Scenery (theme dressing) lives in scenery.js.
 * ------------------------------------------------------------------ */
import * as THREE from "three";
import { FLAG } from "./trackBuild.js";
import { mulberry } from "./spline.js";

const perp = (ang) => ({ x: Math.cos(ang), z: -Math.sin(ang) });

/* ------------------------- textures ------------------------- */
export function roadTexture(road, dirt = false) {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = dirt ? shade(road.shoulder, -8) : road.asphalt;
  g.fillRect(0, 0, 128, 128);
  // speckle
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(${dirt ? "90,70,50" : "255,255,255"},${0.03 + Math.random() * 0.05})`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  if (!dirt) {
    g.fillStyle = road.line;
    g.fillRect(62, 8, 5, 48); // centre dash
    g.fillRect(2, 0, 3, 128); // edge lines
    g.fillRect(123, 0, 3, 128);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}
function shade(hex, amt) {
  const v = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (v >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((v >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (v & 255) + amt));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/* Build a road ribbon over a chain of samples. */
function ribbon(samples, loop, widthOf, yOff, mat, vScale = 0.12) {
  const n = samples.length;
  const count = loop ? n + 1 : n;
  const pos = new Float32Array(count * 2 * 3);
  const uv = new Float32Array(count * 2 * 2);
  const idx = [];
  for (let i = 0; i < count; i++) {
    const s = samples[i % n];
    const p = perp(s.ang);
    const w = widthOf(s) / 2;
    const o = i * 6;
    pos[o] = s.x - p.x * w; pos[o + 1] = s.y + yOff; pos[o + 2] = s.z - p.z * w;
    pos[o + 3] = s.x + p.x * w; pos[o + 4] = s.y + yOff; pos[o + 5] = s.z + p.z * w;
    const u = i * 4;
    uv[u] = 0; uv[u + 1] = s.s * vScale;
    uv[u + 2] = 1; uv[u + 3] = s.s * vScale;
    if (i < count - 1) {
      const a = i * 2;
      /* wound so the face normal points up (+y) */
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.material.side = THREE.DoubleSide; // banked/twisted stretches stay visible
  return mesh;
}

/* Vertical wall strip along one side of a chain. side=+1 right, -1 left. */
function wallStrip(samples, loop, side, height, off, mat) {
  const n = samples.length;
  const count = loop ? n + 1 : n;
  const pos = new Float32Array(count * 2 * 3);
  const idx = [];
  for (let i = 0; i < count; i++) {
    const s = samples[i % n];
    const p = perp(s.ang);
    const w = s.w / 2 + off;
    const x = s.x + p.x * w * side, z = s.z + p.z * w * side;
    const o = i * 6;
    pos[o] = x; pos[o + 1] = s.y; pos[o + 2] = z;
    pos[o + 3] = x; pos[o + 4] = s.y + height; pos[o + 5] = z;
    if (i < count - 1) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.material.side = THREE.DoubleSide;
  return m;
}

/* Tunnel: sweep a semicircular arch along a run of samples. */
function tunnelMesh(run, mat, radiusMul = 0.9) {
  const K = 7;
  const n = run.length;
  const pos = new Float32Array(n * (K + 1) * 3);
  const idx = [];
  for (let i = 0; i < n; i++) {
    const s = run[i];
    const p = perp(s.ang);
    const R = (s.w / 2 + 1.5) * radiusMul + 1.5;
    for (let k = 0; k <= K; k++) {
      const a = (k / K) * Math.PI;
      const lx = Math.cos(a) * R, ly = Math.sin(a) * (R * 0.72) + 0.2;
      const o = (i * (K + 1) + k) * 3;
      pos[o] = s.x + p.x * lx; pos[o + 1] = s.y + ly; pos[o + 2] = s.z + p.z * lx;
    }
    if (i < n - 1) {
      for (let k = 0; k < K; k++) {
        const a = i * (K + 1) + k;
        const b = (i + 1) * (K + 1) + k;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.material.side = THREE.DoubleSide;
  return mesh;
}

/* Runs of consecutive samples matching a flag. */
function runsWithFlag(samples, flag) {
  const runs = [];
  let cur = null;
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].flags & flag) {
      if (!cur) cur = [];
      cur.push(samples[i]);
    } else if (cur) { runs.push(cur); cur = null; }
  }
  if (cur) runs.push(cur);
  return runs;
}
export { runsWithFlag };

/* Terrain skirt hugging the road, with theme-shaped falloff. */
function terrainSkirt(compiled, rng) {
  const { samples, def } = compiled;
  if (def.ground === null) return null;
  const offs = [0, 6, 16, 34, 70, 130];
  const step = 3;
  const rows = [];
  for (let i = 0; i < samples.length; i += step) rows.push(samples[i]);
  const nR = rows.length;
  const nO = offs.length;
  const mkSide = (side) => {
    const pos = new Float32Array((nR + 1) * nO * 3);
    const col = new Float32Array((nR + 1) * nO * 3);
    const idx = [];
    const base = new THREE.Color(def.ground);
    const dark = base.clone().multiplyScalar(0.7);
    const snow = new THREE.Color("#e8eef2");
    for (let i = 0; i <= nR; i++) {
      const s = rows[i % nR];
      const p = perp(s.ang);
      for (let j = 0; j < nO; j++) {
        const off = s.w / 2 + offs[j];
        const wob = j === 0 ? 0 : (rng() - 0.5) * offs[j] * 0.25;
        let y = s.y - 0.15;
        if (j > 0) {
          const fall = def.theme === "mountain" || def.theme === "canyon" || def.theme === "volcano" || def.theme === "mars"
            ? (side > 0 ? -offs[j] * 0.5 : offs[j] * 0.55)  // cliff down one side, up the other
            : -offs[j] * 0.18;                                // gentle roll-off
          y = s.y + fall + (rng() - 0.5) * (2 + j * 1.5);
          /* keep a strip of dry sand beside the road on water tracks so the
             drivable margin is beach, never open sea */
          if (def.water) y = j <= 2 ? Math.max(y, def.waterLevel + 0.6) : Math.max(y, def.waterLevel - 6);
        }
        const o = (i * nO + j) * 3;
        pos[o] = s.x + p.x * (off + wob) * side; pos[o + 1] = y; pos[o + 2] = s.z + p.z * (off + wob) * side;
        let c = j % 2 ? base : dark;
        if (def.snowLine != null && y > def.snowLine) c = snow;
        col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b;
        if (i < nR && j < nO - 1) {
          const a = i * nO + j, b = (i + 1) * nO + j;
          idx.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  };
  const g = new THREE.Group();
  g.add(mkSide(1), mkSide(-1));
  return g;
}

/* ------------------------- main builder ------------------------- */
export function buildWorld(compiled, quality = 1) {
  void quality;
  const { samples, def, shortcuts } = compiled;
  const rng = mulberry(def.seed * 31 + 7);
  const world = new THREE.Group();
  const dyn = {}; // handles the renderer animates

  const roadTex = roadTexture(def.road);
  const nightRoad = def.time === "night" || def.world === "space";
  const roadMat = new THREE.MeshStandardMaterial({
    map: roadTex, roughness: 0.92, metalness: 0.05,
    /* night/space roads self-light a little so lane markings stay visible */
    emissive: nightRoad ? new THREE.Color(0x9aa2c8) : new THREE.Color(0x000000),
    emissiveMap: nightRoad ? roadTex : null,
    emissiveIntensity: nightRoad ? 0.5 : 0,
  });
  const road = ribbon(samples, true, (s) => s.w, 0.02, roadMat);
  road.receiveShadow = true;
  world.add(road);

  /* Kerb / shoulder strips. */
  const kerbMat = new THREE.MeshStandardMaterial({ color: def.road.kerb1, roughness: 0.8 });
  const kerbMat2 = new THREE.MeshStandardMaterial({ color: def.road.shoulder, roughness: 0.95 });
  for (const side of [-1, 1]) {
    const k = ribbon(samples, true, (s) => s.w + 1.6, 0.005, kerbMat2);
    world.add(k);
    const stripe = wallStrip(samples, true, side, 0.18, 0.1, kerbMat);
    world.add(stripe);
  }

  /* Shortcut roads. */
  const dirtMat = new THREE.MeshStandardMaterial({ map: roadTexture(def.road, true), roughness: 1, metalness: 0 });
  const scRoadMat = new THREE.MeshStandardMaterial({ map: roadTexture(def.road), roughness: 0.92 });
  for (const sc of shortcuts) {
    const mat = (sc.surface === "dirt" || sc.surface === "beach") ? dirtMat : scRoadMat;
    const r = ribbon(sc.samples, false, (s) => s.w, 0.03, mat);
    world.add(r);
    if (sc.surface === "tube") {
      const tube = tunnelMesh(sc.samples, new THREE.MeshStandardMaterial({
        color: 0x9ad4ff, transparent: true, opacity: 0.22, roughness: 0.1, metalness: 0.3, depthWrite: false,
      }));
      world.add(tube);
      // support rails
      for (const side of [-1, 1]) world.add(wallStrip(sc.samples, false, side, 0.5, 0.2,
        new THREE.MeshBasicMaterial({ color: 0x57f2c8 })));
    } else if (sc.surface === "cave") {
      const rock = new THREE.MeshStandardMaterial({ color: new THREE.Color(def.ground || "#555a60").multiplyScalar(0.55), roughness: 1 });
      world.add(tunnelMesh(sc.samples, rock, 1.05));
    } else if (sc.surface === "roof") {
      // elevated route: support pylons + edge rails
      for (const side of [-1, 1]) world.add(wallStrip(sc.samples, false, side, 0.9, 0.1,
        new THREE.MeshStandardMaterial({ color: 0x2b3448, emissive: 0x1a7a8a, emissiveIntensity: 0.5 })));
      const pyl = new THREE.MeshStandardMaterial({ color: 0x30363f });
      for (let i = 6; i < sc.samples.length - 6; i += 10) {
        const s = sc.samples[i];
        const post = new THREE.Mesh(new THREE.BoxGeometry(1.2, Math.max(2, s.y), 1.2), pyl);
        post.position.set(s.x, s.y / 2, s.z);
        world.add(post);
      }
    }
  }

  /* Main-track tunnels. */
  const tunnelRuns = runsWithFlag(samples, FLAG.TUNNEL);
  const glassy = def.glassTunnels && def.glassTunnels.length;
  for (const run of tunnelRuns) {
    const isGlass = glassy && run.some((s) => s.flags & FLAG.GLASS);
    if (isGlass) {
      world.add(tunnelMesh(run, new THREE.MeshStandardMaterial({
        color: 0xa8d8ff, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.4, depthWrite: false,
      })));
      // structural ribs
      const ribMat = new THREE.MeshStandardMaterial({ color: 0x3a4458, metalness: 0.7, roughness: 0.4 });
      for (let i = 0; i < run.length; i += 6) {
        const s = run[i];
        const ring = new THREE.Mesh(new THREE.TorusGeometry(s.w / 2 + 2.2, 0.25, 6, 14, Math.PI), ribMat);
        ring.position.set(s.x, s.y + 0.2, s.z);
        ring.rotation.y = s.ang;
        world.add(ring);
      }
    } else {
      const tunnelMat = new THREE.MeshStandardMaterial({
        color: def.neon ? 0x232a3e : new THREE.Color(def.ground || "#5c6066").multiplyScalar(0.5),
        roughness: 1,
      });
      world.add(tunnelMesh(run, tunnelMat));
    }
    /* interior guide lights */
    const lightMat = new THREE.MeshBasicMaterial({ color: def.neon ? 0x5ae0ff : 0xffd070 });
    for (let i = 2; i < run.length; i += 5) {
      const s = run[i];
      const p = perp(s.ang);
      for (const side of [-1, 1]) {
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.6), lightMat);
        lamp.position.set(s.x + p.x * (s.w / 2 + 0.8) * side, s.y + 2.6, s.z + p.z * (s.w / 2 + 0.8) * side);
        lamp.rotation.y = s.ang;
        world.add(lamp);
      }
    }
  }

  /* Safety rails on high/curvy outer edges (and full-length mag rails in space). */
  const railMat = new THREE.MeshStandardMaterial({
    color: def.world === "space" ? def.road.line : "#aab2ba",
    emissive: def.world === "space" ? new THREE.Color(def.road.line) : new THREE.Color(def.neon ? def.road.kerb1 : 0x000000),
    emissiveIntensity: def.world === "space" ? 1.2 : (def.neon ? 0.8 : 0),
    metalness: 0.6, roughness: 0.4,
  });
  if (def.magnetic || def.world === "space") {
    for (const side of [-1, 1]) world.add(wallStrip(samples, true, side, 0.7, 0.3, railMat));
  } else {
    // segmented barriers where the ground drops away
    for (const side of [-1, 1]) {
      let run = [];
      for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        const highish = s.y > (def.elevBase || 6) + 4 && !(s.flags & FLAG.TUNNEL);
        if (highish) run.push(s);
        else if (run.length > 3) { world.add(wallStrip(run, false, side, 0.7, 0.4, railMat)); run = []; }
        else run = [];
      }
      if (run.length > 3) world.add(wallStrip(run, false, side, 0.7, 0.4, railMat));
    }
  }

  /* Road underside + pylons for space/elevated tracks so the road never
     looks like a floating sheet. */
  if (def.ground === null) {
    const under = ribbon(samples, true, (s) => s.w + 1.2, -0.5,
      new THREE.MeshStandardMaterial({ color: 0x14181f, metalness: 0.6, roughness: 0.6 }));
    world.add(under);
  }

  /* Terrain + water/lava. */
  const terr = terrainSkirt(compiled, rng);
  if (terr) { terr.traverse((o) => { o.receiveShadow = true; }); world.add(terr); }
  if (def.water) {
    const water = new THREE.Mesh(new THREE.PlaneGeometry(3200, 3200),
      new THREE.MeshStandardMaterial({ color: 0x2e7ab8, transparent: true, opacity: 0.85, roughness: 0.15, metalness: 0.4 }));
    water.rotation.x = -Math.PI / 2;
    water.position.y = def.waterLevel;
    world.add(water);
    dyn.water = water;
  }
  if (def.lava) {
    const lavaTex = (() => {
      const c = document.createElement("canvas"); c.width = 64; c.height = 64;
      const g = c.getContext("2d");
      g.fillStyle = "#c83a10"; g.fillRect(0, 0, 64, 64);
      for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(255,${140 + Math.random() * 80 | 0},40,0.5)`; g.beginPath(); g.arc(Math.random() * 64, Math.random() * 64, 2 + Math.random() * 6, 0, 7); g.fill(); }
      const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(30, 30); return t;
    })();
    const lava = new THREE.Mesh(new THREE.PlaneGeometry(2800, 2800),
      new THREE.MeshBasicMaterial({ map: lavaTex }));
    lava.rotation.x = -Math.PI / 2;
    lava.position.y = -6;
    world.add(lava);
    dyn.lava = lava;
  }
  if (def.ground !== null && !def.water && !def.lava) {
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1800, 40),
      new THREE.MeshLambertMaterial({ color: new THREE.Color(def.ground).multiplyScalar(0.85) }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = def.world === "space" ? -2.5 : -1.5;
    floor.receiveShadow = true;
    world.add(floor);
  }

  /* Boost pads: emissive chevron quads on the road. */
  dyn.boostPads = [];
  for (const run of runsWithFlag(samples, FLAG.BOOST)) {
    const s = run[Math.floor(run.length / 2)];
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(s.w * 0.7, 7),
      new THREE.MeshBasicMaterial({ color: 0x35d0ff, transparent: true, opacity: 0.75, depthWrite: false }));
    pad.rotation.x = -Math.PI / 2;
    pad.rotation.z = -s.ang;
    pad.position.set(s.x, s.y + 0.06, s.z);
    world.add(pad);
    dyn.boostPads.push(pad);
  }

  /* Jump ramp wedges. */
  for (const run of runsWithFlag(samples, FLAG.JUMP)) {
    const s = run[0];
    const wedge = new THREE.Mesh(new THREE.BoxGeometry(s.w * 0.9, 0.4, 6),
      new THREE.MeshStandardMaterial({ color: def.road.kerb1, roughness: 0.6 }));
    wedge.position.set(s.x, s.y - 0.1, s.z);
    wedge.rotation.y = s.ang;
    wedge.rotation.x = -0.12;
    world.add(wedge);
  }

  /* Item prisms (mystery pickups) — original glowing tetra design. */
  dyn.itemMeshes = compiled.itemBoxes.map((b) => {
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.85),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x8a5aff, emissiveIntensity: 0.8, roughness: 0.2, metalness: 0.4, transparent: true, opacity: 0.9 }));
    m.position.set(b.x, b.y, b.z);
    world.add(m);
    return m;
  });

  /* Coins. */
  const coinGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.1, 12);
  const coinMat = new THREE.MeshStandardMaterial({ color: 0xffd34d, emissive: 0xa07818, emissiveIntensity: 0.5, metalness: 0.8, roughness: 0.25 });
  dyn.coinMeshes = compiled.coins.map((c) => {
    const m = new THREE.Mesh(coinGeo, coinMat);
    m.rotation.z = Math.PI / 2;
    m.position.set(c.x, c.y, c.z);
    world.add(m);
    return m;
  });

  /* Hidden K-emblems. */
  const embGeo = new THREE.TorusGeometry(0.7, 0.18, 8, 16);
  const embMat = new THREE.MeshStandardMaterial({ color: 0x57f2c8, emissive: 0x2a8a6a, emissiveIntensity: 1, metalness: 0.6, roughness: 0.2 });
  dyn.emblemMeshes = compiled.emblems.map((c) => {
    const m = new THREE.Mesh(embGeo, embMat);
    m.position.set(c.x, c.y, c.z);
    world.add(m);
    return m;
  });

  /* Shortcut hazards — boulders. */
  const hazMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(def.ground || "#5c6066").multiplyScalar(0.7), roughness: 1 });
  for (const h of compiled.hazards) {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(h.r), hazMat);
    rock.position.set(h.x, h.y + h.r * 0.5, h.z);
    rock.rotation.set(rng() * 3, rng() * 3, rng() * 3);
    world.add(rock);
  }

  /* Start gate. */
  const s0 = samples[0];
  const p0 = perp(s0.ang);
  const gateMat = new THREE.MeshStandardMaterial({ color: 0x2b3038, metalness: 0.6, roughness: 0.4 });
  for (const side of [-1, 1]) {
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.8, 7, 0.8), gateMat);
    pylon.position.set(s0.x + p0.x * (s0.w / 2 + 1.2) * side, s0.y + 3.5, s0.z + p0.z * (s0.w / 2 + 1.2) * side);
    world.add(pylon);
  }
  const banner = new THREE.Mesh(new THREE.BoxGeometry(s0.w + 4, 1.4, 0.5),
    new THREE.MeshStandardMaterial({ color: 0xd32f2f, emissive: 0x551010, emissiveIntensity: 0.4 }));
  banner.position.set(s0.x, s0.y + 6.6, s0.z);
  banner.rotation.y = s0.ang;
  world.add(banner);
  /* start line checkers */
  const line = new THREE.Mesh(new THREE.PlaneGeometry(s0.w, 3), new THREE.MeshBasicMaterial({
    map: (() => {
      const c = document.createElement("canvas"); c.width = 64; c.height = 16;
      const g = c.getContext("2d");
      for (let i = 0; i < 8; i++) for (let j = 0; j < 2; j++) {
        g.fillStyle = (i + j) % 2 ? "#111" : "#eee"; g.fillRect(i * 8, j * 8, 8, 8);
      }
      return new THREE.CanvasTexture(c);
    })(),
  }));
  line.rotation.x = -Math.PI / 2; line.rotation.z = -s0.ang;
  line.position.set(s0.x, s0.y + 0.05, s0.z);
  world.add(line);

  return { world, dyn };
}
