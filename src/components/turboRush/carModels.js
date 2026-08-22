/* ------------------------------------------------------------------ *
 * Original procedural vehicles. Every silhouette is built here from
 * primitives — no real-world car designs, no external models.
 * Returns rigged parts so the renderer can steer wheels, spin them,
 * roll the body and light the boost flame.
 * ------------------------------------------------------------------ */
import * as THREE from "three";

const M = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.35, ...opts });
const box = (w, h, d, mat) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
const cyl = (r1, r2, h, seg, mat) => new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), mat);

function wheel(radius, width, rimColor) {
  const g = new THREE.Group();
  const tyre = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 14), M("#1d1f22", { roughness: 0.9, metalness: 0 }));
  tyre.rotation.z = Math.PI / 2;
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, width + 0.02, 8), M(rimColor, { metalness: 0.8, roughness: 0.25 }));
  rim.rotation.z = Math.PI / 2;
  g.add(tyre, rim);
  return g;
}

function driverFigure(look) {
  const g = new THREE.Group();
  const torso = box(0.5, 0.35, 0.35, M(look.suit));
  torso.position.y = 0.18;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.21, 10, 8), M(look.helmet, { roughness: 0.25 }));
  helmet.position.y = 0.52;
  const visor = box(0.3, 0.1, 0.06, M(look.visor, { roughness: 0.1, metalness: 0.6, emissive: new THREE.Color(look.visor), emissiveIntensity: 0.25 }));
  visor.position.set(0, 0.52, 0.17);
  g.add(torso, helmet, visor);
  return g;
}

/* Body builders per vehicle type. Each returns { body, wheelSpec } where
   wheelSpec = { r, w, positions: [[x,y,z]x4], hover? } */
const BODIES = {
  buggy(paint, trim) {
    const g = new THREE.Group();
    const tub = box(1.5, 0.5, 2.6, paint); tub.position.y = 0.55; g.add(tub);
    const nose = box(1.2, 0.35, 0.8, paint); nose.position.set(0, 0.5, 1.6); g.add(nose);
    const bar = M("#3a3f45", { metalness: 0.7 });
    for (const [x, z] of [[-0.65, -0.7], [0.65, -0.7], [-0.55, 0.7], [0.55, 0.7]]) {
      const post = cyl(0.06, 0.06, 0.9, 6, bar); post.position.set(x, 1.2, z); g.add(post);
    }
    const roof = box(1.4, 0.1, 1.7, bar); roof.position.y = 1.65; g.add(roof);
    const engine = box(0.9, 0.5, 0.6, trim); engine.position.set(0, 0.9, -1.35); g.add(engine);
    return { body: g, wheelSpec: { r: 0.48, w: 0.4, positions: [[-0.85, 0.48, 1.15], [0.85, 0.48, 1.15], [-0.9, 0.52, -1.1], [0.9, 0.52, -1.1]] }, seat: [0, 0.85, -0.1] };
  },
  rally(paint, trim) {
    const g = new THREE.Group();
    const hull = box(1.7, 0.55, 3.4, paint); hull.position.y = 0.62; g.add(hull);
    const cab = box(1.5, 0.5, 1.6, paint); cab.position.set(0, 1.1, -0.2); g.add(cab);
    const glass = M("#9ecbe8", { roughness: 0.1, metalness: 0.4 });
    const ws = box(1.4, 0.42, 0.06, glass); ws.rotation.x = -0.5; ws.position.set(0, 1.1, 0.68); g.add(ws);
    const spoiler = box(1.6, 0.08, 0.4, trim); spoiler.position.set(0, 1.25, -1.7); g.add(spoiler);
    for (const s of [-1, 1]) { const post = box(0.08, 0.3, 0.08, trim); post.position.set(s * 0.6, 1.05, -1.68); g.add(post); }
    const lamp = box(0.9, 0.15, 0.1, M("#fff2cc", { emissive: 0xfff2cc, emissiveIntensity: 0.6 })); lamp.position.set(0, 0.85, 1.72); g.add(lamp);
    return { body: g, wheelSpec: { r: 0.42, w: 0.34, positions: [[-0.88, 0.42, 1.1], [0.88, 0.42, 1.1], [-0.88, 0.42, -1.15], [0.88, 0.42, -1.15]] }, seat: [0, 1.15, -0.2] };
  },
  supercar(paint, trim) {
    const g = new THREE.Group();
    const hull = box(1.9, 0.4, 3.9, paint); hull.position.y = 0.5; g.add(hull);
    const nose = box(1.6, 0.24, 1.0, paint); nose.position.set(0, 0.42, 2.2); g.add(nose);
    const cab = box(1.3, 0.4, 1.5, M("#20242c", { roughness: 0.15, metalness: 0.6 })); cab.position.set(0, 0.9, -0.3); g.add(cab);
    const deck = box(1.7, 0.2, 1.2, paint); deck.position.set(0, 0.68, -1.5); g.add(deck);
    const wing = box(1.8, 0.06, 0.4, trim); wing.position.set(0, 1.0, -1.95); g.add(wing);
    const intake = box(0.5, 0.12, 0.7, trim); intake.position.set(0, 0.72, 0.9); g.add(intake);
    return { body: g, wheelSpec: { r: 0.4, w: 0.4, positions: [[-0.95, 0.4, 1.35], [0.95, 0.4, 1.35], [-0.98, 0.4, -1.3], [0.98, 0.4, -1.3]] }, seat: [0, 0.95, -0.3], low: true };
  },
  truck(paint, trim) {
    const g = new THREE.Group();
    const hull = box(2.0, 0.8, 3.6, paint); hull.position.y = 1.1; g.add(hull);
    const cab = box(1.8, 0.7, 1.4, paint); cab.position.set(0, 1.8, 0.4); g.add(cab);
    const glass = box(1.6, 0.5, 0.08, M("#9ecbe8", { roughness: 0.12 })); glass.rotation.x = -0.35; glass.position.set(0, 1.85, 1.12); g.add(glass);
    const bull = box(1.9, 0.35, 0.2, M("#3a3f45", { metalness: 0.8 })); bull.position.set(0, 0.95, 1.9); g.add(bull);
    const bed = box(1.9, 0.3, 1.2, trim); bed.position.set(0, 1.6, -1.2); g.add(bed);
    const exhaust = cyl(0.08, 0.08, 0.8, 6, M("#565b63", { metalness: 0.8 })); exhaust.position.set(0.85, 2.1, -0.3); g.add(exhaust);
    return { body: g, wheelSpec: { r: 0.62, w: 0.5, positions: [[-1.0, 0.62, 1.25], [1.0, 0.62, 1.25], [-1.0, 0.62, -1.25], [1.0, 0.62, -1.25]] }, seat: [0, 2.0, 0.4] };
  },
  lightweight(paint, trim) {
    const g = new THREE.Group();
    const tub = box(0.85, 0.4, 3.4, paint); tub.position.y = 0.5; g.add(tub);
    const nosecone = cyl(0.12, 0.42, 1.0, 8, paint); nosecone.rotation.x = Math.PI / 2; nosecone.position.set(0, 0.5, 2.1); g.add(nosecone);
    const fw = box(1.8, 0.06, 0.45, trim); fw.position.set(0, 0.32, 2.2); g.add(fw);
    const rw = box(1.6, 0.07, 0.45, trim); rw.position.set(0, 0.95, -1.75); g.add(rw);
    for (const s of [-1, 1]) { const pod = box(0.35, 0.3, 1.2, trim); pod.position.set(s * 0.68, 0.45, -0.5); g.add(pod); }
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.05, 6, 12), M("#2b2f36", { metalness: 0.8 })); halo.rotation.x = Math.PI / 2; halo.position.set(0, 0.95, -0.1); g.add(halo);
    return { body: g, wheelSpec: { r: 0.4, w: 0.36, open: true, positions: [[-0.85, 0.4, 1.4], [0.85, 0.4, 1.4], [-0.8, 0.4, -1.3], [0.8, 0.4, -1.3]] }, seat: [0, 0.75, -0.1], low: true };
  },
  electric(paint, trim) {
    const g = new THREE.Group();
    const hull = box(1.8, 0.45, 3.8, paint); hull.position.y = 0.55; g.add(hull);
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.8, 10, 8), M("#1c2c3c", { roughness: 0.12, metalness: 0.5 }));
    canopy.scale.set(0.85, 0.55, 1.4); canopy.position.set(0, 0.85, -0.1); g.add(canopy);
    const strip = box(1.85, 0.05, 3.7, M(trim.color, { emissive: trim.color, emissiveIntensity: 1.4 })); strip.position.y = 0.34; g.add(strip);
    const tail = box(1.7, 0.1, 0.15, M("#66f0ff", { emissive: 0x66f0ff, emissiveIntensity: 1.2 })); tail.position.set(0, 0.75, -1.9); g.add(tail);
    return { body: g, wheelSpec: { r: 0.42, w: 0.36, positions: [[-0.9, 0.42, 1.3], [0.9, 0.42, 1.3], [-0.9, 0.42, -1.3], [0.9, 0.42, -1.3]] }, seat: [0, 0.9, -0.1], low: true };
  },
  hover(paint, trim) {
    const g = new THREE.Group();
    const hull = box(1.9, 0.5, 3.6, paint); hull.position.y = 0.75; g.add(hull);
    const fin = box(0.1, 0.7, 1.2, trim); fin.position.set(0, 1.3, -1.3); g.add(fin);
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), M("#a8e8ff", { roughness: 0.08, metalness: 0.3, transparent: true, opacity: 0.85 }));
    canopy.scale.set(0.8, 0.6, 1.1); canopy.position.set(0, 1.05, 0.3); g.add(canopy);
    const skirtMat = M("#2b3038", { metalness: 0.7 });
    for (const [x, z] of [[-0.95, 1.1], [0.95, 1.1], [-0.95, -1.1], [0.95, -1.1]]) {
      const disc = cyl(0.42, 0.5, 0.2, 10, skirtMat); disc.position.set(x, 0.45, z); g.add(disc);
      const glowD = cyl(0.36, 0.36, 0.06, 10, M("#57f2c8", { emissive: 0x57f2c8, emissiveIntensity: 2 })); glowD.position.set(x, 0.33, z); g.add(glowD);
    }
    return { body: g, wheelSpec: { r: 0.4, w: 0.3, hover: true, positions: [[-0.95, 0.4, 1.1], [0.95, 0.4, 1.1], [-0.95, 0.4, -1.1], [0.95, 0.4, -1.1]] }, seat: [0, 1.1, 0.3] };
  },
  space(paint, trim) {
    const g = new THREE.Group();
    const hull = box(1.7, 0.55, 4.0, paint); hull.position.y = 0.7; g.add(hull);
    const nose = cyl(0.15, 0.6, 1.2, 8, paint); nose.rotation.x = Math.PI / 2; nose.position.set(0, 0.7, 2.4); g.add(nose);
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.62, 10, 8), M("#66d9ff", { roughness: 0.05, metalness: 0.4, transparent: true, opacity: 0.8 }));
    canopy.scale.set(0.8, 0.6, 1.2); canopy.position.set(0, 1.05, 0.4); g.add(canopy);
    for (const s of [-1, 1]) {
      const pylon = box(0.5, 0.15, 1.4, trim); pylon.position.set(s * 1.05, 0.8, -1.0); g.add(pylon);
      const thr = cyl(0.22, 0.3, 0.9, 8, M("#2b3038", { metalness: 0.8 })); thr.rotation.x = Math.PI / 2; thr.position.set(s * 1.05, 0.8, -1.9); g.add(thr);
      const glowT = cyl(0.18, 0.18, 0.1, 8, M("#66d9ff", { emissive: 0x66d9ff, emissiveIntensity: 2.2 })); glowT.rotation.x = Math.PI / 2; glowT.position.set(s * 1.05, 0.8, -2.35); g.add(glowT);
    }
    const finV = box(0.08, 0.8, 1.0, trim); finV.position.set(0, 1.35, -1.6); g.add(finV);
    return { body: g, wheelSpec: { r: 0.4, w: 0.34, hover: true, positions: [[-0.85, 0.4, 1.3], [0.85, 0.4, 1.3], [-0.85, 0.4, -1.3], [0.85, 0.4, -1.3]] }, seat: [0, 1.05, 0.4] };
  },
  armored(paint, trim) {
    const g = new THREE.Group();
    const hull = box(2.1, 0.9, 3.7, paint); hull.position.y = 1.0; g.add(hull);
    const slope = box(2.0, 0.5, 1.0, paint); slope.rotation.x = -0.4; slope.position.set(0, 1.35, 1.55); g.add(slope);
    const turret = box(1.2, 0.4, 1.2, trim); turret.position.set(0, 1.65, -0.5); g.add(turret);
    const slit = box(1.4, 0.12, 0.08, M("#7cffd0", { emissive: 0x7cffd0, emissiveIntensity: 1.5 })); slit.position.set(0, 1.5, 1.86); g.add(slit);
    const plow = box(2.2, 0.5, 0.3, M("#3a3f45", { metalness: 0.85 })); plow.rotation.x = 0.5; plow.position.set(0, 0.6, 2.05); g.add(plow);
    for (const s of [-1, 1]) { const plate = box(0.15, 0.7, 3.2, trim); plate.position.set(s * 1.12, 0.85, 0); g.add(plate); }
    return { body: g, wheelSpec: { r: 0.55, w: 0.5, positions: [[-1.0, 0.55, 1.25], [1.0, 0.55, 1.25], [-1.0, 0.55, -1.25], [1.0, 0.55, -1.25]] }, seat: [0, 1.8, -0.5] };
  },
};

/* Cosmetic decal layers, applied on top of the paint. */
function addDecal(bodyGroup, decal, trimMat, low) {
  if (decal === "stripe") {
    const s = box(0.35, 0.06, 3.6, trimMat); s.position.y = low ? 0.74 : 1.05; bodyGroup.add(s);
  } else if (decal === "flame") {
    for (const side of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const f = box(0.06, 0.16 - k * 0.04, 0.7 - k * 0.18, trimMat);
        f.position.set(side * 0.93, (low ? 0.55 : 0.9) + k * 0.1, 1.1 - k * 0.5);
        bodyGroup.add(f);
      }
    }
  } else if (decal === "number") {
    const disc = cyl(0.28, 0.28, 0.05, 12, new THREE.MeshStandardMaterial({ color: "#f5f2e8", roughness: 0.6 }));
    disc.rotation.x = Math.PI / 2; disc.rotation.z = Math.PI / 2;
    disc.position.set(0.94, low ? 0.55 : 0.95, 0.3); bodyGroup.add(disc);
    const disc2 = disc.clone(); disc2.position.x = -0.94; bodyGroup.add(disc2);
  }
}

/* Main factory. cosmetics: {paint, decal, wheels(rim colour), flame(colour), glow(colour|null)} */
export function createCarMesh(carDef, cosmetics, driverLook) {
  const paintMat = M(cosmetics.paint, { metalness: 0.55, roughness: 0.3 });
  const trimMat = M("#22262c", { metalness: 0.6, roughness: 0.4 });
  const builder = BODIES[carDef.type] || BODIES.rally;
  const { body, wheelSpec, seat, low } = builder(paintMat, carDef.type === "electric" ? { color: cosmetics.flame || "#33e0ff" } : trimMat);

  addDecal(body, cosmetics.decal, M("#e8e2d2", { roughness: 0.5 }), low);

  if (driverLook && seat) {
    const fig = driverFigure(driverLook);
    fig.position.set(...seat);
    fig.scale.setScalar(carDef.type === "truck" || carDef.type === "armored" ? 1.05 : 0.9);
    body.add(fig);
  }

  const bodyGroup = new THREE.Group(); // roll/pitch applied here
  bodyGroup.add(body);

  const root = new THREE.Group(); // world position + heading applied here
  root.add(bodyGroup);

  const wheels = wheelSpec.positions.map(([x, y, z], i) => {
    const steer = new THREE.Group();
    steer.position.set(x, y, z);
    const spin = wheel(wheelSpec.r, wheelSpec.w, cosmetics.rim || "#9aa2ab");
    if (wheelSpec.hover) spin.visible = false;
    steer.add(spin);
    root.add(steer);
    return { steer, spin, front: i < 2, r: wheelSpec.r };
  });

  /* Brake / reverse lights on the tail */
  const brakeMat = new THREE.MeshStandardMaterial({ color: 0x7a1010, emissive: 0xff2222, emissiveIntensity: 0.15 });
  const brakeLight = box(1.1, 0.14, 0.08, brakeMat);
  const tallBody = carDef.type === "truck" || carDef.type === "armored";
  brakeLight.position.set(0, tallBody ? 1.45 : 0.72, -(tallBody ? 1.95 : 2.0));
  root.add(brakeLight);
  const reverseMat = new THREE.MeshStandardMaterial({ color: 0xd8d8d0, emissive: 0xffffff, emissiveIntensity: 0 });
  const reverseLight = box(0.5, 0.1, 0.07, reverseMat);
  reverseLight.position.set(0, brakeLight.position.y - 0.16, brakeLight.position.z);
  root.add(reverseLight);

  /* Boost flame */
  const flameMat = new THREE.MeshBasicMaterial({ color: cosmetics.flame || "#ff8c2e", transparent: true, opacity: 0.9 });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.6, 8), flameMat);
  flame.rotation.x = -Math.PI / 2;
  flame.position.set(0, 0.6, -2.4);
  flame.visible = false;
  root.add(flame);

  /* Underglow */
  let glow = null;
  if (cosmetics.glow) {
    glow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 4.2),
      new THREE.MeshBasicMaterial({ color: cosmetics.glow, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.12;
    root.add(glow);
  }

  /* Shield bubble + frost shell, toggled by the renderer. */
  const shield = new THREE.Mesh(new THREE.SphereGeometry(2.6, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0x4db8ff, transparent: true, opacity: 0.18, depthWrite: false }));
  shield.position.y = 1; shield.visible = false; root.add(shield);
  const frost = new THREE.Mesh(new THREE.SphereGeometry(2.3, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xa8e8ff, transparent: true, opacity: 0.4, depthWrite: false }));
  frost.position.y = 1; frost.visible = false; root.add(frost);

  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });

  return { root, bodyGroup, wheels, flame, glow, shield, frost, brakeMat, reverseMat, hover: !!wheelSpec.hover, paintMat };
}
