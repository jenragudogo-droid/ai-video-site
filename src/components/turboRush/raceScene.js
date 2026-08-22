/* ------------------------------------------------------------------ *
 * The three.js view of a race. Owns the WebGL renderer, builds the
 * world for the current track, mirrors engine state onto meshes every
 * frame, and drives the chase camera, weather, skid marks and dust.
 * Everything sits at fixed world coordinates; only the camera moves.
 * ------------------------------------------------------------------ */
import * as THREE from "three";
import { buildWorld } from "./worldBuild.js";
import { buildScenery } from "./scenery.js";
import { createCarMesh } from "./carModels.js";
import { PAINTS } from "./data.js";
import { FLAG } from "./trackBuild.js";

const AI_PAINTS = ["#1e78c8", "#2e9e4f", "#e0a92e", "#8e3fd0", "#e85d1f", "#4a5058"];

function skyDome(def) {
  const geo = new THREE.SphereGeometry(1600, 20, 12);
  const top = new THREE.Color(def.sky.top), bot = new THREE.Color(def.sky.bot);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 1600;
    const t = Math.max(0, Math.min(1, y * 0.9 + 0.35));
    const c = bot.clone().lerp(top, t);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
}

/* Weather particle sheet: recycled points scattered around the camera. */
function makeWeather(kind, quality) {
  if (!kind || kind === "clear") return null;
  const N = Math.floor((kind === "rain" || kind === "storm" ? 900 : 600) * quality);
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 120;
    pos[i * 3 + 1] = Math.random() * 60;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 120;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const conf = {
    rain: { color: 0xa8c8e8, size: 0.14, fall: 55, drift: 2 },
    storm: { color: 0x88a8c8, size: 0.16, fall: 70, drift: 14 },
    snow: { color: 0xffffff, size: 0.3, fall: 6, drift: 4 },
    fog: { color: 0xd8dde2, size: 2.2, fall: 0.6, drift: 3, opacity: 0.16 },
    sandstorm: { color: 0xd8a860, size: 1.4, fall: 2, drift: 26, opacity: 0.3 },
    ash: { color: 0x8a8078, size: 0.5, fall: 2.5, drift: 5, opacity: 0.5 },
  }[kind] || { color: 0xffffff, size: 0.2, fall: 10, drift: 2 };
  const mat = new THREE.PointsMaterial({
    color: conf.color, size: conf.size, transparent: true,
    opacity: conf.opacity ?? 0.7, depthWrite: false, sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return { points, conf, N };
}

export function createRaceScene(canvas, quality) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality > 0.7, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality > 0.7 ? 2 : 1.5));
  renderer.shadowMap.enabled = quality > 0.7;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const view = {
    renderer, scene: null, camera: null, cars: new Map(),
    quality, projMeshes: new Map(), trapMeshes: new Map(),
    skids: [], skidIdx: 0, dust: null, weather: null, dyn: null, sceneryDyn: null,
    camPos: new THREE.Vector3(), camLook: new THREE.Vector3(), shake: 0,
    camHead: 0, camY: 0,
    time: 0, introT: 0, sun: null, race: null,
  };

  if (typeof window !== "undefined") window.__ktrView = view; // debug/tests

  view.resize = (w, h) => {
    renderer.setSize(w, h, false);
    if (view.camera) { view.camera.aspect = w / h; view.camera.updateProjectionMatrix(); }
  };

  view.dispose = () => {
    renderer.dispose();
    view.scene?.traverse((o) => {
      o.geometry?.dispose?.();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.map?.dispose?.(); m.dispose?.(); });
    });
  };

  /* ---------------- build a race scene ---------------- */
  view.setRace = (race) => {
    view.race = race;
    const def = race.def;
    const scene = new THREE.Scene();
    view.scene = scene;
    scene.fog = new THREE.Fog(def.fog.color, def.fog.near, def.fog.far);
    view.fogBase = { near: def.fog.near, far: def.fog.far };

    view.camera = new THREE.PerspectiveCamera(72, canvas.width / canvas.height || 16 / 9, 0.3, 2400);

    scene.add(skyDome(def));
    const hemi = new THREE.HemisphereLight(def.hemi[0], def.hemi[1], def.hemi[2] * 1.6);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(def.sun.color, def.sun.i * 1.6);
    const sr = 500;
    sun.position.set(Math.cos(def.sun.az) * sr, Math.sin(def.sun.el) * sr, Math.sin(def.sun.az) * sr);
    if (quality > 0.7) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024);
      const S = 90;
      Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 20, far: 1100 });
      sun.shadow.bias = -0.0015;
    }
    scene.add(sun, sun.target);
    view.sun = sun;

    const { world, dyn } = buildWorld(race.track, quality);
    scene.add(world);
    view.dyn = dyn;
    const sc = buildScenery(race.track, quality);
    scene.add(sc.group);
    view.sceneryDyn = sc.dyn;

    /* cars */
    view.cars.forEach((c) => c.root.removeFromParent());
    view.cars.clear();
    race.racers.forEach((r, i) => {
      const cos = {
        paint: r.cosmetics?.paint || (r.isBoss ? "#22262c" : AI_PAINTS[i % AI_PAINTS.length]) || PAINTS[0].c,
        decal: r.cosmetics?.decal || (r.isPlayer ? "none" : ["stripe", "none", "number"][i % 3]),
        rim: r.cosmetics?.rim,
        flame: r.cosmetics?.flame || "#ff8c2e",
        glow: r.cosmetics?.glow || (def.time === "night" && !r.isPlayer ? null : r.cosmetics?.glow),
      };
      const car = createCarMesh(r.car, cos, r.driver.look);
      car.root.position.set(r.body.x, r.body.y, r.body.z);
      scene.add(car.root);
      view.cars.set(r.id, car);
      /* headlights for night tracks on the player car */
      if (r.isPlayer && def.time === "night") {
        const head = new THREE.SpotLight(0xfff2cc, 55, 90, 0.5, 0.5);
        head.position.set(0, 1.2, 1.5);
        head.target.position.set(0, 0, 30);
        car.root.add(head, head.target);
      }
    });

    /* projectile + trap pools rebuilt lazily */
    view.projMeshes.forEach((m) => m.removeFromParent()); view.projMeshes.clear();
    view.trapMeshes.forEach((m) => m.removeFromParent()); view.trapMeshes.clear();

    /* skid mark pool */
    view.skids.forEach((s) => s.removeFromParent());
    view.skids = [];
    const skidMat = new THREE.MeshBasicMaterial({ color: 0x14161a, transparent: true, opacity: 0.55, depthWrite: false });
    const skidGeo = new THREE.PlaneGeometry(0.32, 1.4);
    for (let i = 0; i < 220; i++) {
      const m = new THREE.Mesh(skidGeo, skidMat.clone());
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      scene.add(m);
      view.skids.push(m);
    }
    view.skidIdx = 0;

    /* dust / smoke particles */
    const DN = Math.floor(160 * quality);
    const dgeo = new THREE.BufferGeometry();
    dgeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(DN * 3), 3));
    const dmat = new THREE.PointsMaterial({ color: 0xc8b89a, size: 0.7, transparent: true, opacity: 0.5, depthWrite: false });
    view.dust = { points: new THREE.Points(dgeo, dmat), N: DN, idx: 0, life: new Float32Array(DN), vel: new Float32Array(DN * 3) };
    view.dust.points.frustumCulled = false;
    for (let i = 0; i < DN; i++) dgeo.attributes.position.setY(i, -999);
    scene.add(view.dust.points);

    view.weather = makeWeather(race.weather, quality);
    if (view.weather) scene.add(view.weather.points);

    view.introT = 3.0;
    view.camHead = race.player.body.heading;
    view.camY = race.player.body.y + 4;
    view.camPos.set(race.player.body.x + 20, race.player.body.y + 14, race.player.body.z + 20);
  };

  const projGeo = new THREE.ConeGeometry(0.3, 1.2, 8);
  const trapGeos = {
    oil: new THREE.CylinderGeometry(2.6, 2.6, 0.06, 12),
    ice: new THREE.CylinderGeometry(3.6, 3.6, 0.08, 12),
    mine: new THREE.SphereGeometry(0.55, 8, 6),
    smoke: new THREE.SphereGeometry(2.6, 8, 6),
  };
  const trapMats = {
    oil: new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.2, metalness: 0.6 }),
    ice: new THREE.MeshStandardMaterial({ color: 0xa8e8ff, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.8 }),
    mine: new THREE.MeshStandardMaterial({ color: 0xd34d4d, emissive: 0x661111, emissiveIntensity: 1 }),
    smoke: new THREE.MeshBasicMaterial({ color: 0x9aa2ab, transparent: true, opacity: 0.5, depthWrite: false }),
  };

  /* ---------------- per-frame ---------------- */
  const tmpV = new THREE.Vector3();
  view.frame = (dt, race, playerInput) => {
    if (!view.scene) return;
    view.time += dt;
    const player = race.player;

    /* --- cars --- */
    for (const r of race.racers) {
      const car = view.cars.get(r.id);
      if (!car) continue;
      const b = r.body;
      const hoverBob = car.hover ? Math.sin(view.time * 4 + b.x) * 0.12 + 0.25 : 0;
      car.root.position.set(b.x, b.y + hoverBob + (b.bounce > 0 ? -b.bounce * 0.3 : 0), b.z);
      car.root.rotation.y = b.heading + b.airSpin;
      car.bodyGroup.rotation.z = b.bodyRoll;
      car.bodyGroup.rotation.x = b.bodyPitch + (b.airborne ? -0.08 : 0);
      for (const w of car.wheels) {
        w.spin.rotation.x = b.wheelSpin % (Math.PI * 2);
        if (w.front) w.steer.rotation.y = b.steerVis;
      }
      car.flame.visible = r.fx.boostTime > 0;
      if (car.flame.visible) car.flame.scale.setScalar(0.8 + Math.random() * 0.5);
      car.shield.visible = r.fx.shield > 0 || r.fx.invinc > 0;
      car.shield.material.color.setHex(r.fx.invinc > 0 ? 0xffd34d : r.fx.empShieldT > 0 ? 0xffe14d : 0x4db8ff);
      car.frost.visible = r.fx.frozen > 0;
      const ghost = r.fx.ghost > 0;
      if (ghost !== car._ghost) {
        car._ghost = ghost;
        car.root.traverse((o) => {
          if (o.isMesh && o !== car.shield && o !== car.frost) {
            o.material.transparent = ghost || o.material._wasT;
            if (o.material._baseOp === undefined) { o.material._baseOp = o.material.opacity; o.material._wasT = o.material.transparent; }
            o.material.opacity = ghost ? 0.35 : o.material._baseOp;
          }
        });
      }
      /* skid marks while drifting or grinding */
      if ((b.drift || r.wallGrind > 0) && !b.airborne && view.skids.length) {
        for (const side of [-0.8, 0.8]) {
          const m = view.skids[view.skidIdx++ % view.skids.length];
          m.visible = true;
          m.material.opacity = 0.5;
          m.position.set(
            b.x - Math.sin(b.heading) * 1.2 + Math.cos(b.heading) * side,
            b.y + 0.03,
            b.z - Math.cos(b.heading) * 1.2 - Math.sin(b.heading) * side,
          );
          m.rotation.z = -b.heading;
        }
      }
      /* dust when off-road / drifting, spray on rain */
      if ((b.offroad || b.drift) && !b.airborne && b.speed > 8) {
        const d = view.dust;
        for (let k = 0; k < 2; k++) {
          const i = d.idx++ % d.N;
          d.points.geometry.attributes.position.setXYZ(i,
            b.x - Math.sin(b.heading) * 1.8 + (Math.random() - 0.5),
            b.y + 0.3,
            b.z - Math.cos(b.heading) * 1.8 + (Math.random() - 0.5));
          d.life[i] = 0.8;
          d.vel[i * 3] = (Math.random() - 0.5) * 2;
          d.vel[i * 3 + 1] = 1.5 + Math.random();
          d.vel[i * 3 + 2] = (Math.random() - 0.5) * 2;
        }
      }
    }

    /* skid fade */
    for (const m of view.skids) {
      if (m.visible) {
        m.material.opacity -= dt * 0.12;
        if (m.material.opacity <= 0.02) m.visible = false;
      }
    }

    /* dust update */
    {
      const d = view.dust;
      const attr = d.points.geometry.attributes.position;
      for (let i = 0; i < d.N; i++) {
        if (d.life[i] > 0) {
          d.life[i] -= dt;
          attr.setXYZ(i,
            attr.getX(i) + d.vel[i * 3] * dt,
            attr.getY(i) + d.vel[i * 3 + 1] * dt,
            attr.getZ(i) + d.vel[i * 3 + 2] * dt);
          if (d.life[i] <= 0) attr.setY(i, -999);
        }
      }
      attr.needsUpdate = true;
    }

    /* --- projectiles --- */
    const seen = new Set();
    for (const p of race.projectiles) {
      if (p.delay > 0) continue;
      const key = p;
      seen.add(key);
      let m = view.projMeshes.get(key);
      if (!m) {
        m = new THREE.Mesh(projGeo, new THREE.MeshStandardMaterial({
          color: p.kind === "ice" ? 0xa8e8ff : 0xff4d4d,
          emissive: p.kind === "ice" ? 0x4488aa : 0xaa2222, emissiveIntensity: 1.2,
        }));
        m.rotation.order = "YXZ";
        view.scene.add(m);
        view.projMeshes.set(key, m);
      }
      m.position.set(p.x, p.y, p.z);
      m.rotation.y = p.ang;
      m.rotation.x = Math.PI / 2;
    }
    for (const [key, m] of view.projMeshes) {
      if (!seen.has(key)) { m.removeFromParent(); view.projMeshes.delete(key); }
    }

    /* --- traps --- */
    const seenT = new Set();
    for (const tr of race.traps) {
      seenT.add(tr);
      let m = view.trapMeshes.get(tr);
      if (!m) {
        m = new THREE.Mesh(trapGeos[tr.kind], trapMats[tr.kind]);
        view.scene.add(m);
        view.trapMeshes.set(tr, m);
      }
      m.position.set(tr.x, tr.y + (tr.kind === "mine" ? 0.4 : tr.kind === "smoke" ? 1.6 : 0.06), tr.z);
      if (tr.kind === "smoke") m.scale.setScalar(1 + Math.sin(view.time * 2) * 0.15);
      if (tr.kind === "mine") m.material.emissiveIntensity = 1 + Math.sin(view.time * 8) * 0.8;
    }
    for (const [key, m] of view.trapMeshes) {
      if (!seenT.has(key)) { m.removeFromParent(); view.trapMeshes.delete(key); }
    }

    /* --- pickups --- */
    race.itemBoxes.forEach((b, i) => {
      const m = view.dyn.itemMeshes[i];
      if (!m) return;
      m.visible = b.t <= 0;
      m.rotation.y = view.time * 1.8 + i;
      m.position.y = b.y + Math.sin(view.time * 2 + i) * 0.2;
    });
    race.coins.forEach((c, i) => {
      const m = view.dyn.coinMeshes[i];
      if (!m) return;
      m.visible = !c.taken;
      if (!c.taken) { m.position.set(c.x, c.y, c.z); m.rotation.y = view.time * 3 + i * 0.4; }
    });
    race.emblems.forEach((e, i) => {
      const m = view.dyn.emblemMeshes[i];
      if (!m) return;
      m.visible = !e.taken;
      m.rotation.y = view.time * 1.2;
    });
    view.dyn.boostPads?.forEach((p, i) => {
      p.material.opacity = 0.5 + Math.sin(view.time * 5 + i) * 0.3;
    });
    if (view.dyn.water) view.dyn.water.position.y = race.def.waterLevel + Math.sin(view.time * 0.8) * 0.15;
    if (view.dyn.lava) view.dyn.lava.material.map.offset.x = view.time * 0.008;
    if (view.sceneryDyn?.crater) view.sceneryDyn.crater.material.color.setHSL(0.05, 1, 0.5 + Math.sin(view.time * 3) * 0.1);
    if (view.sceneryDyn?.lighthouse) view.sceneryDyn.lighthouse.material.color.setHSL(0.12, 1, 0.6 + Math.sin(view.time * 4) * 0.35);

    /* --- weather follows the camera (world-anchored fall) --- */
    if (view.weather) {
      const w = view.weather;
      const attr = w.points.geometry.attributes.position;
      const cx = view.camPos.x, cy = view.camPos.y, cz = view.camPos.z;
      for (let i = 0; i < w.N; i++) {
        let y = attr.getY(i) - w.conf.fall * dt;
        let x = attr.getX(i) + w.conf.drift * dt * 0.4;
        let z = attr.getZ(i);
        if (cy + y - 30 < player.body.y - 6 || y < -30) { y = 40 + Math.random() * 15; x = (Math.random() - 0.5) * 120; z = (Math.random() - 0.5) * 120; }
        if (x > 70) x = -70;
        attr.setXYZ(i, x, y, z);
      }
      attr.needsUpdate = true;
      w.points.position.set(cx, player.body.y - 10, cz);
    }

    /* --- tunnel feel: pull fog close while the player is underground --- */
    const pb = player.body;
    const track = race.track;
    const onSc = pb.route >= 0;
    const curSample = onSc ? track.shortcuts[pb.route].samples[pb.routeSeg] : track.samples[pb.seg];
    const inTunnel = !!(curSample.flags & FLAG.TUNNEL) && !(curSample.flags & FLAG.GLASS);
    pb.inTunnel = inTunnel;
    const wantNear = inTunnel ? 20 : view.fogBase.near;
    const wantFar = inTunnel ? 150 : view.fogBase.far;
    view.scene.fog.near += (wantNear - view.scene.fog.near) * Math.min(1, 3 * dt);
    view.scene.fog.far += (wantFar - view.scene.fog.far) * Math.min(1, 3 * dt);

    /* --- camera --- */
    const cam = view.camera;
    if (race.state === "countdown" && view.introT > 0) {
      /* cinematic intro: swing around the grid */
      view.introT -= dt;
      const a = view.introT * 0.9 + 1.2;
      const R = 16 - (3 - view.introT) * 2.5;
      tmpV.set(pb.x + Math.sin(pb.heading + a) * R, pb.y + 6 - view.introT, pb.z + Math.cos(pb.heading + a) * R);
      view.camPos.lerp(tmpV, Math.min(1, 4 * dt));
      view.camLook.lerp(new THREE.Vector3(pb.x, pb.y + 1.2, pb.z), Math.min(1, 6 * dt));
    } else {
      /* rigid follow with a smoothed heading: the car stays framed at any
         speed, the swing comes from easing the camera's yaw, not its
         distance. */
      const back = 7.6, up = 3.1;
      const speedK = Math.min(1, pb.speed / 60);
      let dh = (pb.heading + (pb.drift ? pb.driftDir * -0.14 : 0)) - view.camHead;
      while (dh > Math.PI) dh -= 2 * Math.PI;
      while (dh < -Math.PI) dh += 2 * Math.PI;
      view.camHead += dh * Math.min(1, 5.5 * dt);
      const wantY = pb.y + up + (pb.airborne ? 0.8 : 0);
      view.camY += (wantY - view.camY) * Math.min(1, 6 * dt);
      view.camPos.set(
        pb.x - Math.sin(view.camHead) * (back + speedK * 1.8),
        Math.max(view.camY, pb.y + 1.6),
        pb.z - Math.cos(view.camHead) * (back + speedK * 1.8),
      );
      tmpV.set(pb.x + Math.sin(pb.heading) * 11, pb.y + 1.4, pb.z + Math.cos(pb.heading) * 11);
      view.camLook.lerp(tmpV, Math.min(1, 10 * dt));
      cam.fov += ((72 + speedK * 14 + (player.fx.boostTime > 0 ? 6 : 0)) - cam.fov) * Math.min(1, 5 * dt);
      cam.updateProjectionMatrix();
    }
    if (player.timesHit > (view._lastHits || 0)) { view.shake = 0.5; view._lastHits = player.timesHit; }
    view.shake = Math.max(0, view.shake - dt);
    cam.position.copy(view.camPos);
    if (view.shake > 0) {
      cam.position.x += (Math.random() - 0.5) * view.shake * 0.8;
      cam.position.y += (Math.random() - 0.5) * view.shake * 0.5;
    }
    cam.lookAt(view.camLook);

    /* shadow camera follows the player */
    if (view.sun && view.sun.castShadow) {
      view.sun.target.position.set(pb.x, pb.y, pb.z);
      const def = race.def;
      view.sun.position.set(pb.x + Math.cos(def.sun.az) * 160, pb.y + Math.sin(def.sun.el) * 300 + 80, pb.z + Math.sin(def.sun.az) * 160);
    }

    void playerInput;
    renderer.render(view.scene, cam);
  };

  return view;
}
