/* ------------------------------------------------------------------ *
 * Arcade car physics. One step() per racer per frame. Works entirely
 * in world space against the compiled track (main route or a shortcut
 * route). Elevation, jumps, drift, boost, low gravity, off-road grip
 * and wall limits all live here.
 * ------------------------------------------------------------------ */
import { FLAG, nearestSample, lateralOffset, surfaceY } from "./trackBuild.js";

const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
export { wrap };

export function derivedStats(car, upgrades = {}, driver = null) {
  const s = { ...car.stats };
  // upgrade bonuses
  const UP = { engine: ["top", 0.035], accel: ["accel", 0.04], handling: ["handling", 0.035], boost: ["boost", 0.04], tires: ["drift", 0.04], suspension: ["offroad", 0.04], armor: ["dura", 0.05] };
  for (const [k, lvl] of Object.entries(upgrades)) {
    const u = UP[k];
    if (u) s[u[0]] = Math.min(1.15, s[u[0]] + u[1] * (lvl || 0));
  }
  if (driver?.ability?.id === "apexLine") s.handling = Math.min(1.2, s.handling * 1.15);
  return {
    maxSpeed: 36 + s.top * 32,
    accel: 13 + s.accel * 17,
    yaw: 1.5 + s.handling * 1.5,
    driftYaw: 1.1 + s.drift * 1.2,
    driftGripLoss: 0.55 - s.drift * 0.25,
    boostPower: 1.24 + s.boost * 0.18,
    weight: s.weight,
    dura: s.dura,
    offroad: s.offroad,
    raw: s,
  };
}

export function makeBody(x, y, z, heading) {
  return {
    x, y, z, heading, velAng: heading,
    speed: 0, vy: 0, airborne: false, airTime: 0, airSpin: 0,
    drift: 0, driftDir: 0, driftT: 0, nitro: 0,
    seg: 0, route: -1, routeSeg: 0, sProg: 0, prevS: 0, lap: 0, offroad: false, inTunnel: false,
    steerVis: 0, wheelSpin: 0, bodyRoll: 0, bodyPitch: 0, bounce: 0,
  };
}

/* input: {steer, throttle, brake, drift, boost}
   env: {gravity, gripMul, track, magnetic}
   fx: effect multipliers from powerups {speedMul, boostTime, frozen, slow, glue} */
export function stepBody(r, st, input, env, fx, dt) {
  const b = r.body;
  const track = env.track;
  /* NaN / blow-up rescue: put the car back on its last known sample. */
  if (!isFinite(b.x + b.y + b.z + b.speed)) {
    const hs = track.samples[Math.min(b.seg, track.samples.length - 1)] || track.samples[0];
    b.x = hs.x; b.y = hs.y; b.z = hs.z;
    b.heading = hs.ang; b.velAng = hs.ang;
    b.speed = 0; b.vy = 0; b.airborne = false; b.route = -1;
  }
  const onShortcut = b.route >= 0;
  const sc = onShortcut ? track.shortcuts[b.route] : null;
  const samples = onShortcut ? sc.samples : track.samples;
  const loop = !onShortcut;

  /* locate on route — search wider when fast or airborne (long jumps) */
  const span = Math.min(60, 16 + Math.round(Math.abs(b.speed) * 0.4) + (b.airborne ? 24 : 0));
  const idx = nearestSample(samples, loop, b.x, b.z, onShortcut ? b.routeSeg : b.seg, span);
  if (onShortcut) b.routeSeg = idx; else b.seg = idx;
  const s = samples[idx];
  const lat = lateralOffset(s, b.x, b.z);
  const halfW = s.w / 2;

  /* surface + speed budget */
  const driverOff = r.driver?.ability?.id === "trailblazer" ? 0.5 : 1;
  b.offroad = Math.abs(lat) > halfW + 0.4 && !(s.flags & FLAG.DIRT);
  const dirtRoad = !!(s.flags & FLAG.DIRT);
  let gripMul = env.gripMul * (fx.iceGround ? 0.35 : 1);
  let speedCap = st.maxSpeed * (fx.speedMul || 1);
  if (b.offroad) {
    const pen = (1 - st.offroad * 0.85) * driverOff;
    speedCap *= (1 - 0.55 * pen);
    gripMul *= (1 - 0.4 * pen);
  } else if (dirtRoad) {
    speedCap *= 0.9 + st.offroad * 0.12;
  }
  if (onShortcut && r.driver?.ability?.id === "pathfinder") speedCap *= 1.1;
  if (fx.frozen > 0) speedCap *= 0.3;
  if (fx.slow > 0) speedCap *= 0.55;
  if (r.spinT > 0) speedCap *= 0.3;

  /* boost */
  let boosting = false;
  if (fx.boostTime > 0) { speedCap *= st.boostPower * (fx.boostMul || 1); boosting = true; }

  /* throttle / brake */
  const wantSpeed = input.throttle * speedCap;
  const accel = st.accel * (b.offroad ? 0.6 : 1) * (boosting ? 1.5 : 1);
  if (r.spinT > 0) {
    b.speed *= Math.pow(0.5, dt);
    b.heading += dt * 9 * (r.spinDir || 1);
  } else if (b.speed < wantSpeed) {
    b.speed = Math.min(wantSpeed, b.speed + accel * dt);
  } else {
    b.speed = Math.max(wantSpeed, b.speed - (input.brake > 0 ? 42 : 12) * dt);
  }
  if (input.brake > 0 && b.speed > 4) b.speed = Math.max(4, b.speed - 30 * input.brake * dt);

  /* steering + drift */
  const spdF = Math.min(1, b.speed / 22);
  let yawRate = st.yaw * input.steer * spdF;
  const wantDrift = input.drift && Math.abs(input.steer) > 0.25 && b.speed > st.maxSpeed * 0.35 && !b.airborne;
  if (wantDrift && !b.drift) { b.drift = 1; b.driftDir = Math.sign(input.steer); }
  if (b.drift && (!input.drift || b.speed < 10)) { b.drift = 0; b.driftT = 0; }
  if (b.drift) {
    yawRate = (st.yaw * 0.55 + st.driftYaw) * b.driftDir * spdF
      + st.yaw * 0.5 * input.steer * spdF; // counter-steer refines the arc
    b.driftT += dt;
    const nitroRate = r.driver?.ability?.id === "smokeLine" ? 0.34 : 0.24;
    b.nitro = Math.min(1, b.nitro + nitroRate * dt);
  }
  if (!b.airborne || (r.driver?.ability?.id === "vectorThrust")) {
    b.heading = wrap(b.heading + yawRate * dt);
  } else {
    b.airSpin += yawRate * dt * 0.8; // air tricks
  }

  /* velocity direction chases heading; drifting loosens the chase */
  const gripBase = (b.drift ? st.driftGripLoss : 1) * gripMul * (b.airborne ? 0.15 : 1);
  const chase = (5 + st.raw.handling * 6) * gripBase;
  b.velAng = wrap(b.velAng + wrap(b.heading - b.velAng) * Math.min(1, chase * dt));

  /* integrate XZ */
  b.x += Math.sin(b.velAng) * b.speed * dt;
  b.z += Math.cos(b.velAng) * b.speed * dt;

  /* walls / route edges */
  const margin = (s.flags & FLAG.TUNNEL) || env.magnetic ? 1.2 : 6.5;
  const s2 = samples[idx]; // recheck against same sample post-move (cheap)
  const lat2 = lateralOffset(s2, b.x, b.z);
  if (Math.abs(lat2) > halfW + margin) {
    const push = Math.min(3, Math.abs(lat2) - (halfW + margin));
    const px = Math.cos(s2.ang), pz = -Math.sin(s2.ang);
    b.x -= px * push * Math.sign(lat2);
    b.z -= pz * push * Math.sign(lat2);
    b.speed *= (s.flags & FLAG.TUNNEL) || env.magnetic ? 0.985 : 0.97;
    r.wallGrind = 0.2;
    /* hopeless: fell/strayed far off a shortcut — rejoin the main road */
    if (onShortcut && Math.abs(lat2) > halfW + margin + 9) {
      b.route = -1;
      b.seg = nearestSample(track.samples, true, b.x, b.z, sc.entryIdx, 60);
    }
  }

  /* vertical: follow the road, fly off ramps */
  const gy = surfaceY(samples, loop, onShortcut ? b.routeSeg : b.seg, b.x, b.z);
  const g = 24 * env.gravity;
  if (b.airborne) {
    b.vy -= g * dt;
    b.y += b.vy * dt;
    b.airTime += dt;
    if (b.y <= gy + 0.02 && b.vy <= 0) {
      /* landing */
      b.airborne = false; b.y = gy; b.vy = 0;
      b.bounce = Math.min(0.4, b.airTime * 0.25);
      const spins = Math.abs(b.airSpin) / (Math.PI * 1.6);
      if (b.airTime > 0.55 && spins >= 0.75) {
        r.trickLanded = { spins: Math.round(spins), air: b.airTime };
        b.nitro = Math.min(1, b.nitro + 0.35);
      } else if (b.airTime > 1.1) {
        r.bigAir = b.airTime;
      }
      b.heading = wrap(b.heading + b.airSpin); // commit the visual spin
      b.velAng = b.heading;
      b.airSpin = 0; b.airTime = 0;
    }
  } else {
    if ((s.flags & FLAG.JUMP) && b.speed > 16 && r.jumpCd <= 0) {
      b.airborne = true;
      r.jumpCd = 1.5;
      b.vy = 5 + b.speed * 0.11 * (fx.jumpMul || 1);
      b.airTime = 0; b.airSpin = 0;
    } else if (b.y > gy + 0.55 && !env.magnetic) {
      b.airborne = true; b.vy = Math.max(0, b.vy);
    } else {
      b.y = b.y + (gy - b.y) * Math.min(1, 14 * dt); // suspension settle
      b.vy = 0;
    }
  }

  /* boost pad */
  if (!b.airborne && (s.flags & FLAG.BOOST) && r.padCd <= 0) {
    r.fx.boostTime = Math.max(r.fx.boostTime, 1.1);
    r.fx.boostMul = Math.max(r.fx.boostMul || 1, 1);
    r.padCd = 1.4;
    r.events?.push("pad");
  }
  r.padCd = Math.max(0, (r.padCd || 0) - dt);
  r.jumpCd = Math.max(0, (r.jumpCd || 0) - dt);
  r.wallGrind = Math.max(0, (r.wallGrind || 0) - dt);

  /* progress along the lap */
  b.prevS = b.sProg;
  if (onShortcut) {
    const f = b.routeSeg / Math.max(1, sc.samples.length - 1);
    b.sProg = (sc.sStart + f * (sc.sEnd - sc.sStart)) % track.length;
    /* leave the shortcut at its end */
    if (b.routeSeg >= sc.samples.length - 3) {
      b.route = -1;
      b.seg = sc.exitIdx;
    }
  } else {
    const a = track.samples[b.seg];
    b.sProg = a.s;
    /* lap line: crossing from the end of the lap back to the start */
    if (b.prevS > track.length * 0.9 && b.sProg < track.length * 0.1) b.lapCross = true;
    else b.lapCross = false;
  }

  /* cosmetic dynamics */
  b.wheelSpin += (b.speed / 0.45) * dt;
  b.steerVis += (input.steer * 0.45 - b.steerVis) * Math.min(1, 10 * dt);
  const latAcc = yawRate * b.speed * 0.02;
  b.bodyRoll += (-latAcc * (0.5 + st.weight * 0.3) - b.bodyRoll) * Math.min(1, 6 * dt);
  const slope = b.airborne ? -b.vy * 0.02 : 0;
  b.bodyPitch += ((boosting ? -0.05 : 0) + slope - b.bodyPitch) * Math.min(1, 5 * dt);
  b.bounce = Math.max(0, b.bounce - dt);
}

/* Try to hop onto a shortcut whose entry we are passing. */
export function maybeEnterShortcut(r, track, want) {
  const b = r.body;
  if (b.route >= 0) return;
  for (let i = 0; i < track.shortcuts.length; i++) {
    const sc = track.shortcuts[i];
    const d = Math.abs(b.seg - sc.entryIdx);
    const n = track.samples.length;
    const near = Math.min(d, n - d) < 4;
    if (!near) continue;
    const e = sc.samples[0];
    const dist = Math.hypot(b.x - e.x, b.z - e.z);
    if (dist < sc.samples[0].w + 10 && want(sc, i)) {
      b.route = i;
      b.routeSeg = 0;
      r.usedShortcut = sc.name;
      return sc;
    }
  }
  return null;
}

/* Simple sphere push between two racers; heavier cars shove lighter. */
export function collideCars(a, c) {
  const dx = c.body.x - a.body.x, dz = c.body.z - a.body.z;
  const dy = Math.abs(c.body.y - a.body.y);
  const d2 = dx * dx + dz * dz;
  const R = 2.6;
  if (d2 > R * R || d2 === 0 || dy > 2) return false;
  if (a.fx.ghost > 0 || c.fx.ghost > 0) return false;
  const d = Math.sqrt(d2);
  const nx = dx / d, nz = dz / d;
  const overlap = R - d;
  const wa = a.st.weight + 0.5, wc = c.st.weight + 0.5;
  const tot = wa + wc;
  a.body.x -= nx * overlap * (wc / tot); a.body.z -= nz * overlap * (wc / tot);
  c.body.x += nx * overlap * (wa / tot); c.body.z += nz * overlap * (wa / tot);
  const dv = Math.abs(a.body.speed - c.body.speed);
  a.body.speed *= 0.985; c.body.speed *= 0.985;
  return dv > 8;
}
