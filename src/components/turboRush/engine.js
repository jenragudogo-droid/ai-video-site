/* ------------------------------------------------------------------ *
 * Race engine: builds a race (player + 5 rotating AI, or a 1-v-1 boss
 * duel), steps the whole simulation, scores every event type, and
 * reports results. Pure logic — no three.js, no DOM — so it can be
 * tested headless.
 * ------------------------------------------------------------------ */
import { DRIVERS, CARS, driverById, carById, bossById, CHAMP_POINTS } from "./data.js";
import { trackById } from "./tracks.js";
import { compileTrack } from "./trackBuild.js";
import { derivedStats, makeBody, stepBody, collideCars, maybeEnterShortcut } from "./physics.js";
import { personalityFor, aiInput, rubberBand } from "./ai.js";
import { freshFx, randomPowerup, updatePowerups, activateSlot, tryCombo, progressGap } from "./powerups.js";
import { mulberry } from "./spline.js";

export { activateSlot, tryCombo, progressGap };

const WEATHER_GRIP = { clear: 1, rain: 0.86, storm: 0.8, snow: 0.75, fog: 0.95, sandstorm: 0.88, ash: 0.92 };

/* Rotate 5 AI drivers into a race: prefer drivers whose style suits the
   track, then fill with the rest — so line-ups differ per track/seed. */
export function pickRoster(trackDef, playerDriverId, seed) {
  const rng = mulberry((seed || 1) * 977 + trackDef.seed);
  const pool = DRIVERS.filter((d) => d.id !== playerDriverId);
  const affinity = (d) => {
    let a = rng() * 0.5;
    const t = trackDef.theme;
    if (d.style === "offroad" && ["jungle", "canyon", "hills", "mountain", "mars"].includes(t)) a += 0.8;
    if (d.style === "drift" && ["mountain", "coastal", "neon"].includes(t)) a += 0.7;
    if (d.style === "technical" && ["neon", "station", "asteroid", "coastal"].includes(t)) a += 0.6;
    if (d.id === "orbit" && trackDef.world === "space") a += 1.2;
    if (d.style === "shortcut") a += 0.4;
    if (d.style === "aggressive") a += 0.3;
    return a;
  };
  return pool.map((d) => [d, affinity(d)]).sort((x, y) => y[1] - x[1]).slice(0, 5).map(([d]) => d);
}

function aiCarFor(driver, rng) {
  const candidates = CARS.filter((c) => !c.unlock && c.type === driver.prefers);
  const anyBase = CARS.filter((c) => !c.unlock);
  const pick = candidates.length ? candidates : anyBase;
  return pick[Math.floor(rng() * pick.length)];
}

function makeRacer(id, driver, car, cosmetics, upgrades, isPlayer, difficulty, rng) {
  const st = derivedStats(car, upgrades, driver);
  const r = {
    id, driver, car, cosmetics, isPlayer,
    st, body: makeBody(0, 0, 0, 0), fx: freshFx(),
    slots: [null, null, null], place: 1, lap: 0,
    finished: false, finishTime: 0, eliminated: false,
    coins: 0, driftScore: 0, stuntScore: 0, damage: 0, spinT: 0,
    timesHit: 0, combosDone: 0, superCombosDone: 0, usedShortcut: null,
    ai: isPlayer ? null : personalityFor(driver, difficulty, rng),
    events: null, padCd: 0, lapTimes: [], lapStart: 0,
  };
  if (driver.ability?.id === "coldShoulder") r.fx.shield = 1;
  return r;
}

export function createRace(cfg) {
  const def = trackById(cfg.trackId);
  const track = compileTrack(def);
  const rng = mulberry((cfg.seed || 7) * 131 + def.seed);
  const boss = cfg.bossId ? bossById(cfg.bossId) : null;
  const mode = cfg.type || "race";
  const weather = cfg.weather && def.weather.includes(cfg.weather) ? cfg.weather : def.defaultWeather;

  const race = {
    def, track, mode, boss,
    laps: mode === "timeTrial" || mode === "checkpoint" ? (cfg.laps || 2) : (cfg.laps || def.laps),
    weather, gravity: def.gravity, magnetic: !!def.magnetic,
    gripMul: WEATHER_GRIP[weather] ?? 1,
    time: 0, countdown: 3.2, state: "countdown",
    racers: [], player: null, projectiles: [], traps: [], events: [],
    aiDifficulty: 0.94 + (cfg.difficulty || 0) * 0.045,
    bossDifficulty: boss ? boss.difficulty : 1,
    itemBoxes: track.itemBoxes.map((b) => ({ ...b })),
    coins: track.coins.map((c) => ({ ...c, taken: false })),
    emblems: track.emblems.map((c) => ({ ...c, taken: false })),
    elimTimer: 20, results: null, battleHits: 0,
    checkpoints: mode === "checkpoint" ? [0.25, 0.5, 0.75, 1].map((f) => f) : null,
    nextCp: 0, cpTime: mode === "checkpoint" ? 26 : 0,
    boostGatesHit: 0, photoMargin: null, rng,
  };
  if (mode === "powerBattle") {
    /* double boxes: mirror row shifted half a lap */
    const extra = track.itemBoxes.map((b) => ({ ...b, x: b.x + 2, z: b.z + 2 }));
    race.itemBoxes.push(...extra);
  }

  /* --- build the field --- */
  const playerDriver = driverById(cfg.player.driverId);
  const playerCar = carById(cfg.player.carId);
  const player = makeRacer("player", playerDriver, playerCar, cfg.player.cosmetics || {}, cfg.player.upgrades || {}, true, 0, rng);
  race.player = player;
  race.racers.push(player);

  if (boss) {
    const bcar = carById(boss.car);
    const b = makeRacer("boss", { id: boss.id, name: boss.name, look: boss.look, style: "aggressive", taunts: boss.taunts, ability: { id: "none" } },
      bcar, { paint: "#22262c", flame: "#ff5a2e" }, { engine: 2, accel: 2, handling: 2 }, false, 1, rng);
    b.bossTraits = boss.traits;
    b.isBoss = true;
    if (boss.traits.topSpeedBonus) b.st.maxSpeed *= 1 + boss.traits.topSpeedBonus;
    if (boss.hpBonus) b.fx.shield += boss.hpBonus;
    if (boss.traits.itemRate) b.ai.itemRate = Math.min(1, b.ai.itemRate * boss.traits.itemRate);
    if (boss.traits.comboMaster) b.ai.comboRate = 0.75;
    if (boss.traits.allShortcuts) b.ai.shortcutAffinity = 2;
    b.ai.skill = Math.min(0.99, 0.9 * boss.difficulty);
    race.racers.push(b);
  } else if (mode !== "timeTrial") {
    const roster = cfg.roster || pickRoster(def, playerDriver.id, cfg.seed);
    roster.forEach((d, i) => {
      const car = aiCarFor(d, rng);
      const lvl = Math.max(0, Math.round((cfg.difficulty || 0) * 0.8));
      const ups = { engine: lvl, accel: lvl, handling: lvl };
      race.racers.push(makeRacer(`ai${i}`, d, car, { paint: null }, ups, false, cfg.difficulty || 0, rng));
    });
  }

  /* --- grid placement --- */
  race.racers.forEach((r, i) => {
    const slot = track.grid[i] || track.grid[track.grid.length - 1];
    r.body.x = slot.x; r.body.y = slot.y; r.body.z = slot.z;
    r.body.heading = slot.heading; r.body.velAng = slot.heading;
    r.body.seg = slot.seg;
    r.body.sProg = track.samples[slot.seg].s;
    /* grid rows start "before" the line: pretend they're at end of lap -1 */
    r.body.lap = -1;
    r.gridWait = true;
  });

  return race;
}

/* -------------------------------------------------------------- */
export function stepRace(race, playerInput, dt) {
  if (race.state === "finished") return;
  race.time += dt;

  if (race.state === "countdown") {
    race.countdown -= dt;
    if (race.countdown <= 0.9 && !race.saidGo) { race.saidGo = true; race.events.push({ t: "go" }); }
    if (race.countdown <= 0) race.state = "racing";
    else if (race.countdown > 0.9) {
      const c = Math.ceil(race.countdown - 0.9);
      if (race.lastCount !== c) { race.lastCount = c; race.events.push({ t: "count", n: c }); }
      return; // hold the field
    }
  }

  const env = { gravity: race.gravity, gripMul: race.gripMul, track: race.track, magnetic: race.magnetic };

  for (const r of race.racers) {
    if (r.eliminated) continue;
    let input;
    if (r.isPlayer) {
      input = r.finished ? { steer: 0, throttle: 0.25, brake: 0, drift: false } : playerInput;
      /* player shortcut entry is implicit: steer into it and you're in */
      if (!r.finished) maybeEnterShortcut(r, race.track, () => true);
      /* player nitro release */
      if (playerInput.nitro && r.body.nitro > 0.25 && !r.finished) {
        r.fx.boostTime = Math.max(r.fx.boostTime, 0.7 + r.body.nitro * 1.3);
        r.body.nitro = 0;
        race.events.push({ t: "nitro" });
      }
    } else {
      input = r.finished ? { steer: 0, throttle: 0.3, brake: 0, drift: false } : aiInput(race, r, dt);
    }

    const bandSave = r.st.maxSpeed;
    r.st.maxSpeed *= rubberBand(race, r);
    stepBody(r, r.st, input, env, r.fx, dt);
    r.st.maxSpeed = bandSave;

    /* marshal recovery: a car wedged for many seconds (walls, boulders,
       another car) is set back on its own spot on the road — same
       progress, no positions gained, never a cheat-teleport forward. */
    if (race.state === "racing" && !r.finished && !r.eliminated) {
      if (Math.abs(r.body.speed) < 2.5 && r.spinT <= 0 && r.fx.frozen <= 0) {
        r.deepStuck = (r.deepStuck || 0) + dt;
        if (r.deepStuck > 6) {
          const b = r.body;
          const onSc = b.route >= 0;
          const chain = onSc ? race.track.shortcuts[b.route].samples : race.track.samples;
          const s = chain[onSc ? b.routeSeg : b.seg];
          b.x = s.x; b.y = s.y; b.z = s.z;
          b.heading = s.ang; b.velAng = s.ang; b.speed = 6; b.vy = 0; b.airborne = false;
          r.deepStuck = 0;
          if (r.isPlayer) race.events.push({ t: "rescue" });
        }
      } else r.deepStuck = 0;
    }

    /* drift scoring */
    if (r.body.drift && !r.finished) {
      const pts = r.body.speed * dt * 1.6;
      r.driftScore += pts;
    }
    if (r.trickLanded) {
      r.stuntScore += 100 * r.trickLanded.spins;
      r.coins += 5 * r.trickLanded.spins;
      if (r.isPlayer) race.events.push({ t: "trick", spins: r.trickLanded.spins });
      r.trickLanded = null;
    }
    if (r.bigAir) {
      if (r.isPlayer) race.events.push({ t: "bigAir", secs: r.bigAir });
      r.bigAirDone = true;
      r.bigAir = null;
    }

    /* lap crossing */
    if (r.body.lapCross && !r.finished) {
      r.body.lapCross = false;
      r.body.lap += 1;
      if (r.body.lap > 0) {
        r.lapTimes.push(race.time - r.lapStart);
        r.lapStart = race.time;
        if (r.isPlayer && r.body.lap < race.laps) race.events.push({ t: "lap", n: r.body.lap + 1 });
      }
      if (r.body.lap >= race.laps) {
        r.finished = true;
        r.finishTime = race.time;
        race.events.push({ t: "finish", who: r.id, place: currentPlaces(race).indexOf(r) + 1 });
      }
    }
  }

  /* car-vs-car contact */
  for (let i = 0; i < race.racers.length; i++) {
    for (let j = i + 1; j < race.racers.length; j++) {
      const a = race.racers[i], c = race.racers[j];
      if (a.eliminated || c.eliminated) continue;
      const bump = collideCars(a, c);
      if (bump) race.events.push({ t: "bump" });
    }
  }

  /* hazard rocks (shortcuts) */
  for (const h of race.track.hazards) {
    for (const r of race.racers) {
      if (r.finished || r.eliminated || r.fx.ghost > 0 || r.fx.invinc > 0) continue;
      const d = Math.hypot(r.body.x - h.x, r.body.z - h.z);
      if (d < h.r + 1.4 && Math.abs(r.body.y - h.y) < 2.5) {
        const push = h.r + 1.4 - d;
        const nx = (r.body.x - h.x) / (d || 1), nz = (r.body.z - h.z) / (d || 1);
        r.body.x += nx * push; r.body.z += nz * push;
        if (r.body.speed > 20) { r.body.speed *= 0.55; if (r.isPlayer) race.events.push({ t: "rockHit" }); }
        else r.body.speed *= 0.9;
      }
    }
  }

  /* item boxes */
  for (const b of race.itemBoxes) {
    if (b.t > 0) { b.t -= dt; continue; }
    for (const r of race.racers) {
      if (r.finished || r.eliminated) continue;
      const d = Math.hypot(r.body.x - b.x, r.body.z - b.z);
      if (d < 2.4 && Math.abs(r.body.y + 1 - b.y) < 2.6) {
        const empty = r.slots.findIndex((s) => !s);
        if (empty >= 0) {
          const isSpace = race.def.world === "space";
          r.slots[empty] = randomPowerup(race.rng, isSpace, r.place >= 4);
          if (r.driver.ability?.id === "doubleTap" && race.rng() < 0.35) {
            const empty2 = r.slots.findIndex((s) => !s);
            if (empty2 >= 0) r.slots[empty2] = randomPowerup(race.rng, isSpace, false);
          }
          b.t = 3.5;
          race.events.push({ t: "box", who: r.id, item: r.slots[empty] });
        }
        break;
      }
    }
  }

  /* coins + magnets */
  for (const c of race.coins) {
    if (c.taken) continue;
    for (const r of race.racers) {
      if (r.finished || r.eliminated) continue;
      let radius = 2.2;
      const golden = r.driver.ability?.id === "goldenEye";
      if (golden) radius = 4;
      if (r.fx.magnet > 0) radius = 10 * (r.fx.magnetMul || 1);
      const d = Math.hypot(r.body.x - c.x, r.body.z - c.z);
      if (d < radius && Math.abs(r.body.y + 0.8 - c.y) < 3.5) {
        if (d < 2.2) {
          c.taken = true;
          r.coins += golden ? 3 : 2;
          if (r.isPlayer) race.events.push({ t: "coin" });
        } else {
          /* magnet pull */
          c.x += (r.body.x - c.x) * Math.min(1, 8 * dt);
          c.z += (r.body.z - c.z) * Math.min(1, 8 * dt);
          c.y += (r.body.y + 0.8 - c.y) * Math.min(1, 8 * dt);
        }
      }
    }
  }

  /* hidden emblems (player only — they're collectibles) */
  for (const e of race.emblems) {
    if (e.taken) continue;
    const r = race.player;
    if (!r || r.finished) continue;
    if (Math.hypot(r.body.x - e.x, r.body.z - e.z) < 2.6 && Math.abs(r.body.y - e.y) < 3) {
      e.taken = true;
      r.coins += 15;
      race.events.push({ t: "emblem" });
    }
  }

  updatePowerups(race, dt);

  /* places */
  const order = currentPlaces(race);
  order.forEach((r, i) => { r.place = i + 1; });

  /* --------- event-mode logic --------- */
  if (race.mode === "elimination" && race.state === "racing") {
    const alive = race.racers.filter((r) => !r.eliminated && !r.finished);
    if (alive.length > 1) {
      race.elimTimer -= dt;
      if (race.elimTimer <= 0) {
        race.elimTimer = 20;
        const last = order.filter((r) => !r.eliminated && !r.finished).pop();
        if (last && !last.isPlayer) { last.eliminated = true; race.events.push({ t: "eliminated", who: last.id, name: last.driver.name }); }
        else if (last && last.isPlayer) { last.eliminated = true; race.events.push({ t: "eliminated", who: "player", name: last.driver.name }); }
      }
    }
  }
  if (race.mode === "checkpoint" && race.state === "racing" && !race.player.finished) {
    race.cpTime -= dt;
    const L = race.track.length;
    const prog = (race.player.body.lap * L + race.player.body.sProg) / (race.laps * L);
    const target = race.checkpoints[race.nextCp];
    if (prog >= target * ((race.nextCp === race.checkpoints.length - 1) ? 0.999 : 1) - 0.001 && race.player.body.lap >= 0) {
      if (prog >= target - 0.001) {
        race.nextCp = Math.min(race.checkpoints.length - 1, race.nextCp + 1);
        race.cpTime += 22;
        race.events.push({ t: "checkpoint", left: race.cpTime });
      }
    }
    if (race.cpTime <= 0) {
      race.player.eliminated = true;
      race.events.push({ t: "outOfTime" });
    }
  }
  if (race.mode === "boostChallenge") {
    /* count boost pad touches via events */
  }

  /* --------- finish detection --------- */
  const playerDone = race.player.finished || race.player.eliminated;
  const allDone = race.racers.every((r) => r.finished || r.eliminated);
  if (playerDone && (race.graceT === undefined)) race.graceT = race.mode === "timeTrial" ? 0 : 2.4;
  if (race.graceT !== undefined) {
    race.graceT -= dt;
    /* photo finish check */
    if (race.photoMargin === null && race.player.finished) {
      const near = race.racers.filter((r) => r !== race.player && r.finished)
        .map((r) => Math.abs(r.finishTime - race.player.finishTime));
      race.photoMargin = near.length ? Math.min(...near) : Infinity;
    }
  }
  if ((race.graceT !== undefined && race.graceT <= 0) || allDone) {
    finishRace(race, order);
  }
}

function currentPlaces(race) {
  const L = race.track.length;
  return [...race.racers].sort((a, b) => {
    if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1;
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    return (b.body.lap * L + b.body.sProg) - (a.body.lap * L + a.body.sProg);
  });
}

function finishRace(race, order) {
  race.state = "finished";
  const p = race.player;
  const place = p.eliminated ? race.racers.length : order.indexOf(p) + 1;
  const won = place === 1 && !p.eliminated;
  const total = race.racers.length;

  let coins = p.coins;
  const placeCoins = [220, 150, 110, 80, 55, 40][place - 1] || 30;
  coins += p.eliminated ? 15 : placeCoins;
  if (race.mode === "powerBattle") coins += race.battleHits * 12;
  if (race.mode === "driftChallenge") coins += Math.floor(p.driftScore / 40);
  if (race.boss && won) coins += 0; // boss rewards paid by career layer
  const stars = p.eliminated ? 0 : place === 1 ? 3 : place === 2 ? 2 : place <= 4 ? 1 : 0;

  race.results = {
    place, total, won, time: p.finishTime || race.time,
    bestLap: p.lapTimes.length ? Math.min(...p.lapTimes) : null,
    coins, stars,
    driftScore: Math.round(p.driftScore), stuntScore: p.stuntScore,
    combos: p.combosDone, superCombos: p.superCombosDone,
    timesHit: p.timesHit, usedShortcut: p.usedShortcut,
    photoFinish: race.photoMargin !== null && race.photoMargin < 0.5,
    boss: race.boss ? race.boss.id : null,
    bossBeaten: race.boss ? won : false,
    emblemsFound: race.emblems.filter((e) => e.taken).length,
    order: order.map((r) => ({
      name: r.isPlayer ? "You" : r.driver.name, isPlayer: r.isPlayer, isBoss: !!r.isBoss,
      time: r.finished ? r.finishTime : null, eliminated: r.eliminated,
      driftScore: Math.round(r.driftScore),
    })),
    mode: race.mode, trackId: race.def.id, weather: race.weather,
  };
  race.events.push({ t: "raceOver", won });
}

export function drainEvents(race) {
  const e = race.events;
  race.events = [];
  return e;
}

export const champPointsFor = (place) => CHAMP_POINTS[place - 1] || 0;
