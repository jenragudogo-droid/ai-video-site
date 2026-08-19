/* ------------------------------------------------------------------ *
 * Beast Battle Arena — simulation.
 * Pure logic: no React, no DOM. The component renders snapshots of it
 * and this module can be driven headlessly by tests.
 * ------------------------------------------------------------------ */

import { ROSTER, byId, ARENAS, MAX_HP, MAX_METER } from "./roster.js";

export const WORLD_W = 1000;
export const EDGE = 80;
export const ROUNDS_TO_WIN = 2;

const HURT_TIME = 240;
const BLOCK_KEEP = 0.28; // blocking lets 28% of the damage through
const INTRO_TIME = 1750;
const SHOUT_TIME = 850;
const ROUND_END_TIME = 2500;
export const ROUND_TIME = 60000; // a round cannot outlast the clock
const METER_ON_DEAL = 2.2;
const METER_ON_TAKE = 1.3;

const clampX = (x) => Math.min(WORLD_W - EDGE, Math.max(EDGE, x));
export const gap = (a, b) => Math.abs(a.x - b.x);
const facingOk = (f, o) => (o.x - f.x) * f.facing > 0;

/* --------------------------------- setup --------------------------------- */

function makeFighter(char, side) {
  return {
    side,
    charId: char.id,
    x: side === "p1" ? 300 : 700,
    y: 0,
    hp: MAX_HP,
    meter: 0,
    facing: side === "p1" ? 1 : -1,
    state: "idle",
    stateT: 0,
    combo: 0,
    chained: false,
    hitDone: false,
    specialHits: 0,
    dashT: 0,
    armored: false,
    passThrough: false,
  };
}

export function makeWorld(playerId, enemyId, pickArena = Math.random) {
  const p = byId(playerId);
  const e = byId(enemyId);
  return {
    p1: makeFighter(p, "p1"),
    p2: makeFighter(e, "p2"),
    charP1: p,
    charP2: e,
    fx: [],
    fxId: 0,
    events: [],
    round: 1,
    wins: { p1: 0, p2: 0 },
    roundLog: [],
    roundWinner: null,
    matchWinner: null,
    arena: ARENAS[Math.floor(pickArena() * ARENAS.length)].id,
    phase: "intro",
    phaseT: INTRO_TIME,
    roundClock: ROUND_TIME,
    endReason: null,
    shake: 0,
    pickArena,
  };
}

function resetForNextRound(w) {
  const keepP1 = Math.min(w.p1.meter, MAX_METER * 0.4);
  const keepP2 = Math.min(w.p2.meter, MAX_METER * 0.4);
  w.p1 = makeFighter(w.charP1, "p1");
  w.p2 = makeFighter(w.charP2, "p2");
  w.p1.meter = keepP1;
  w.p2.meter = keepP2;
  w.fx = [];
  w.roundWinner = null;
  w.arena = ARENAS[Math.floor(w.pickArena() * ARENAS.length)].id;
  w.phase = "intro";
  w.phaseT = INTRO_TIME;
  w.roundClock = ROUND_TIME;
  w.endReason = null;
}

/* ---------------------------------- fx ----------------------------------- */

function spawnFx(w, fx) {
  w.fxId += 1;
  w.fx.push({ id: w.fxId, t: 0, ...fx });
}

function say(w, name) {
  w.events.push(name);
}

/* -------------------------------- damage --------------------------------- */

function addMeter(f, amount) {
  f.meter = Math.min(MAX_METER, f.meter + amount);
}

function applyDamage(w, attacker, target, amount, opts = {}) {
  if (target.state === "ko" || w.phase !== "fight") return 0;
  const blocked = target.state === "block" && facingOk(target, attacker);
  const armor = target.armored ? 0.5 : 1; // rhino shrugs off hits mid-charge
  const dealt = Math.round((blocked ? amount * BLOCK_KEEP : amount) * armor);
  target.hp = Math.max(0, target.hp - dealt);

  // specials are paid for with the meter, so they do not refill it
  if (!opts.noMeter) addMeter(attacker, dealt * METER_ON_DEAL);
  addMeter(target, dealt * METER_ON_TAKE);

  const dir = target.x >= attacker.x ? 1 : -1;
  const push = blocked ? 10 : (opts.knockback ?? 26); // 0 is a valid knockback
  target.x = clampX(target.x + dir * push);

  if (!blocked) {
    target.state = "hurt";
    target.stateT = HURT_TIME;
    target.combo = 0;
  }

  w.shake = Math.min(22, (w.shake || 0) + (blocked ? 4 : amount > 15 ? 16 : 9));
  spawnFx(w, {
    type: blocked ? "guard" : amount > 15 ? "bigImpact" : "impact",
    x: target.x - dir * 34,
    y: 250,
    life: blocked ? 280 : 380,
  });
  if (!blocked && amount > 10) {
    spawnFx(w, { type: "dust", x: target.x, y: 0, life: 520 });
  }
  say(w, blocked ? "block" : amount > 15 ? "heavyHit" : "hit");
  return dealt;
}

/* ------------------------------- specials -------------------------------- */

const SPECIAL_TIME = {
  roar: 900,
  frenzy: 780,
  smash: 880,
  rush: 620,
  dive: 900,
  fire: 880,
  blur: 720,
  stomp: 840,
  bite: 640,
  gore: 780,
};

function startSpecial(w, f, char) {
  f.state = "special";
  f.stateT = SPECIAL_TIME[char.special.type] || 700;
  f.hitDone = false;
  f.specialHits = 0;
  f.meter = 0;
  f.combo = 0;
  f.armored = char.special.type === "gore";
  f.passThrough = char.special.type === "blur";
  say(w, "special");
  say(w, char.voice);
  spawnFx(w, { type: "charge", x: f.x, y: 120, life: 420, dir: f.facing });
}

function runSpecial(w, f, opp, char, dt, elapsed) {
  const type = char.special.type;

  if (type === "roar") {
    if (elapsed >= 260 && !f.hitDone) {
      f.hitDone = true;
      spawnFx(w, {
        type: "roar",
        x: f.x + f.facing * 46,
        y: 250,
        dir: f.facing,
        life: 760,
        owner: f.side,
        damage: char.special.damage,
        radius: 520,
      });
      w.shake = 14;
    }
    return;
  }

  if (type === "smash") {
    // leap up, then hammer the ground
    const p = elapsed / SPECIAL_TIME.smash;
    if (p < 0.45) f.y = Math.sin((p / 0.45) * Math.PI) * 150;
    else f.y = 0;
    if (elapsed >= 420 && !f.hitDone) {
      f.hitDone = true;
      spawnFx(w, { type: "quake", x: f.x, y: 0, life: 620 });
      spawnFx(w, { type: "dust", x: f.x - 70, y: 0, life: 560 });
      spawnFx(w, { type: "dust", x: f.x + 70, y: 0, life: 560 });
      say(w, "quake");
      w.shake = 22;
      if (gap(f, opp) < 330) {
        applyDamage(w, f, opp, char.special.damage, { knockback: 46, noMeter: true });
      }
    }
    return;
  }

  if (type === "frenzy") {
    // dash in, then rake three times
    if (elapsed < 260) {
      f.x = clampX(f.x + f.facing * 0.72 * dt);
      spawnFx(w, { type: "dashTrail", x: f.x - f.facing * 40, y: 150, life: 220, dir: f.facing });
    }
    const windows = [300, 440, 580];
    windows.forEach((at, i) => {
      if (elapsed >= at && f.specialHits === i) {
        f.specialHits = i + 1;
        spawnFx(w, {
          type: "clawSlash",
          x: f.x + f.facing * 90,
          y: 250,
          dir: f.facing,
          life: 300,
          variant: i,
        });
        say(w, "swipe");
        if (gap(f, opp) < char.range + 60 && facingOk(f, opp)) {
          applyDamage(w, f, opp, char.special.damage, { knockback: i === 2 ? 40 : 0, noMeter: true });
        }
      }
    });
    return;
  }

  if (type === "rush") {
    if (elapsed < 420) {
      f.x = clampX(f.x + f.facing * 1.05 * dt);
      spawnFx(w, { type: "dashTrail", x: f.x - f.facing * 40, y: 130, life: 240, dir: f.facing });
    }
    if (!f.hitDone && gap(f, opp) < 190 && elapsed > 60) {
      f.hitDone = true;
      spawnFx(w, { type: "clawSlash", x: f.x + f.facing * 70, y: 240, dir: f.facing, life: 300 });
      applyDamage(w, f, opp, char.special.damage, { knockback: 44, noMeter: true });
    }
    return;
  }

  if (type === "fire") {
    // dragon: a rolling stream of flame that crosses the arena
    if (elapsed >= 280 && !f.hitDone) {
      f.hitDone = true;
      spawnFx(w, {
        type: "fire",
        x: f.x + f.facing * 120,
        y: 250,
        dir: f.facing,
        speed: 0.58,
        life: 1500,
        owner: f.side,
        damage: char.special.damage,
      });
      w.shake = 10;
    }
    return;
  }

  if (type === "blur") {
    // cheetah: sprints clean through, striking on the way in and the way past
    if (elapsed < 460) {
      f.x = clampX(f.x + f.facing * 1.25 * dt);
      spawnFx(w, { type: "dashTrail", x: f.x - f.facing * 46, y: 140, life: 220, dir: f.facing });
    }
    if (f.specialHits === 0 && gap(f, opp) < 150) {
      f.specialHits = 1;
      spawnFx(w, { type: "clawSlash", x: f.x + f.facing * 70, y: 250, dir: f.facing, life: 280 });
      say(w, "swipe");
      applyDamage(w, f, opp, char.special.damage, { knockback: 0, noMeter: true });
    } else if (f.specialHits === 1 && elapsed > 420 && gap(f, opp) < 210) {
      f.specialHits = 2;
      spawnFx(w, { type: "clawSlash", x: f.x - f.facing * 60, y: 240, dir: -f.facing, life: 280, variant: 2 });
      say(w, "swipe");
      applyDamage(w, f, opp, char.special.damage, { knockback: 34, noMeter: true });
    }
    return;
  }

  if (type === "stomp") {
    // elephant: a ground wave that travels out along the floor
    if (elapsed >= 320 && !f.hitDone) {
      f.hitDone = true;
      spawnFx(w, { type: "quake", x: f.x + f.facing * 60, y: 0, life: 560 });
      spawnFx(w, { type: "dust", x: f.x + f.facing * 40, y: 0, life: 560 });
      spawnFx(w, {
        type: "groundWave",
        x: f.x + f.facing * 90,
        y: 0,
        dir: f.facing,
        speed: 0.46,
        life: 1500,
        owner: f.side,
        damage: char.special.damage,
      });
      say(w, "quake");
      w.shake = 20;
    }
    return;
  }

  if (type === "bite") {
    // crocodile: a short lunge into the hardest single hit in the game
    if (elapsed < 300) {
      f.x = clampX(f.x + f.facing * 0.34 * dt);
    }
    if (elapsed >= 240 && elapsed <= 460 && !f.hitDone) {
      if (facingOk(f, opp) && gap(f, opp) < char.range + 70) {
        f.hitDone = true;
        spawnFx(w, { type: "bite", x: f.x + f.facing * 90, y: 250, dir: f.facing, life: 340 });
        applyDamage(w, f, opp, char.special.damage, { knockback: 40, noMeter: true });
      }
    }
    return;
  }

  if (type === "gore") {
    // rhino: an armoured charge — f.armored halves incoming damage
    if (elapsed < 520) {
      f.x = clampX(f.x + f.facing * 1.0 * dt);
      spawnFx(w, { type: "dashTrail", x: f.x - f.facing * 44, y: 120, life: 240, dir: f.facing });
      if (elapsed % 110 < dt) spawnFx(w, { type: "dust", x: f.x - f.facing * 40, y: 0, life: 420 });
    }
    if (!f.hitDone && gap(f, opp) < 200) {
      f.hitDone = true;
      spawnFx(w, { type: "bigImpact", x: f.x + f.facing * 80, y: 240, life: 380 });
      applyDamage(w, f, opp, char.special.damage, { knockback: 52, noMeter: true });
    }
    return;
  }

  // dive (eagle): climb, cross the arena, drop talons-first
  const p = elapsed / SPECIAL_TIME.dive;
  f.y = Math.sin(Math.min(1, p) * Math.PI) * 240;
  if (p > 0.2) f.x = clampX(f.x + f.facing * 0.66 * dt);
  if (elapsed % 90 < dt) {
    spawnFx(w, { type: "feather", x: f.x - f.facing * 20, y: f.y + 160, life: 420 });
  }
  if (!f.hitDone && p > 0.5 && gap(f, opp) < 190) {
    f.hitDone = true;
    spawnFx(w, { type: "clawSlash", x: f.x + f.facing * 60, y: 230, dir: f.facing, life: 300 });
    applyDamage(w, f, opp, char.special.damage, { knockback: 38, noMeter: true });
  }
}

/* ------------------------------- fighters -------------------------------- */

function startAttack(w, f, char, chained) {
  f.state = "attack";
  f.stateT = char.attackTime;
  f.hitDone = false;
  f.chained = false;
  f.combo = chained ? f.combo + 1 : 1;
  say(w, "swipe");
  spawnFx(w, {
    type: "clawSlash",
    x: f.x + f.facing * 82,
    y: 250,
    dir: f.facing,
    life: 280,
    variant: (f.combo - 1) % 3,
  });
}

function stepFighter(w, f, opp, char, input, dt) {
  if (f.state === "ko") return;

  if (f.state === "special") {
    const total = SPECIAL_TIME[char.special.type] || 700;
    runSpecial(w, f, opp, char, dt, total - f.stateT);
    f.stateT -= dt;
    if (f.stateT <= 0) {
      f.state = "idle";
      f.y = 0;
      f.armored = false;
      f.passThrough = false;
    }
    return;
  }

  if (f.state === "attack") {
    const elapsed = char.attackTime - f.stateT;
    const [from, to] = char.attackHit;
    if (!f.hitDone && elapsed >= from && elapsed <= to) {
      if (facingOk(f, opp) && gap(f, opp) < char.range) {
        f.hitDone = true;
        const finisher = char.comboMax > 1 && f.combo >= char.comboMax;
        // mid-combo hits hold the target in place; only the finisher launches
        applyDamage(w, f, opp, char.attack * (finisher ? 1.5 : 1), {
          knockback: finisher ? 34 : 0,
        });
      }
    }
    // buffer a combo input during the second half of the swing
    if (input.attack && elapsed > from && f.combo < char.comboMax) f.chained = true;
    f.stateT -= dt;
    if (f.stateT <= 0) {
      if (f.chained && f.combo < char.comboMax) startAttack(w, f, char, true);
      else {
        f.state = "idle";
        f.combo = 0;
      }
    }
    return;
  }

  if (f.state === "hurt") {
    f.stateT -= dt;
    if (f.stateT <= 0) f.state = "idle";
    return;
  }

  f.facing = opp.x >= f.x ? 1 : -1;

  if (input.special && f.meter >= MAX_METER) {
    startSpecial(w, f, char);
    return;
  }
  if (input.attack) {
    startAttack(w, f, char, false);
    return;
  }
  if (input.block) {
    f.state = "block";
    return;
  }

  let move = 0;
  if (input.left) move -= 1;
  if (input.right) move += 1;
  if (move !== 0) {
    f.x = clampX(f.x + move * char.speed * dt);
    f.state = "walk";
    if (Math.random() < 0.04) {
      spawnFx(w, { type: "step", x: f.x - move * 30, y: 0, life: 300 });
    }
  } else {
    f.state = "idle";
  }
}

/* ---------------------------------- fx ----------------------------------- */

function stepFx(w, dt) {
  for (const e of w.fx) {
    e.t += dt;
    if ((e.type === "fire" || e.type === "groundWave") && !e.spent) {
      e.x += e.dir * e.speed * dt;
      const target = e.owner === "p1" ? w.p2 : w.p1;
      const attacker = e.owner === "p1" ? w.p1 : w.p2;
      if (Math.abs(target.x - e.x) < (e.type === "fire" ? 100 : 110)) {
        e.spent = true;
        e.t = e.life - 220; // let it flare out rather than vanish
        applyDamage(w, attacker, target, e.damage, { knockback: 34, noMeter: true });
      }
      if (e.x < EDGE - 40 || e.x > WORLD_W - EDGE + 40) e.t = e.life;
    }
    if (e.type === "roar" && !e.spent) {
      const target = e.owner === "p1" ? w.p2 : w.p1;
      const reach = (e.t / e.life) * e.radius;
      if ((target.x - e.x) * e.dir > 0 && Math.abs(target.x - e.x) < reach) {
        e.spent = true;
        const attacker = e.owner === "p1" ? w.p1 : w.p2;
        applyDamage(w, attacker, target, e.damage, { knockback: 58, noMeter: true });
      }
    }
  }
  w.fx = w.fx.filter((e) => e.t < e.life);
  if (w.fx.length > 44) w.fx = w.fx.slice(-44);
}

/* ---------------------------------- AI ----------------------------------- */

const AI_STYLE = {
  lion: { aggression: 0.6, guard: 0.22, pace: [300, 420] },
  tiger: { aggression: 0.72, guard: 0.16, pace: [210, 300] },
  gorilla: { aggression: 0.56, guard: 0.28, pace: [340, 460] },
  wolf: { aggression: 0.7, guard: 0.18, pace: [200, 290] },
  eagle: { aggression: 0.66, guard: 0.15, pace: [180, 270] },
  dragon: { aggression: 0.5, guard: 0.24, pace: [320, 440], standoff: true },
  cheetah: { aggression: 0.74, guard: 0.14, pace: [180, 260] },
  elephant: { aggression: 0.5, guard: 0.3, pace: [380, 520] },
  crocodile: { aggression: 0.52, guard: 0.36, pace: [330, 450] },
  rhino: { aggression: 0.64, guard: 0.24, pace: [300, 420] },
};

export function aiInput(w, f, opp, char, dt, rng = Math.random) {
  const ai = w.ai || (w.ai = { t: 500, act: "wait", fired: false });
  const style = AI_STYLE[char.id] || AI_STYLE.lion;
  const d = gap(f, opp);
  ai.t -= dt;

  if (ai.t <= 0) {
    const r = rng();
    ai.fired = false;
    const hurtBadly = f.hp < 35;
    const [lo, hi] = style.pace;
    ai.t = lo + rng() * (hi - lo);

    const specialReach = style.standoff ? 900 : 520;
    if (f.meter >= MAX_METER && d < specialReach && r < 0.7) {
      ai.act = "special";
    } else if (d > 320) {
      ai.act = r < (style.standoff ? 0.55 : 0.85) ? "approach" : "wait";
    } else if (d > char.range + 30) {
      ai.act = r < 0.5 + style.aggression * 0.2 ? "approach" : r < 0.78 ? "retreat" : "block";
    } else {
      const guard = style.guard + (hurtBadly ? 0.16 : 0);
      if (r < style.aggression) ai.act = "attack";
      else if (r < style.aggression + guard) ai.act = "block";
      else if (r < style.aggression + guard + 0.16) ai.act = "retreat";
      else ai.act = "wait";
    }
    if (ai.act === "special" && f.meter < MAX_METER) ai.act = "approach";
  }

  const toward = opp.x >= f.x ? 1 : -1;
  const input = { left: false, right: false, attack: false, special: false, block: false };

  // reactions sit on top of the current plan: guard a swing that is coming
  // in, and punish an opponent who is still recovering from one
  if (opp.state === "attack" && d < char.range + 60 && ai.react !== "punish") {
    if (ai.react === undefined) ai.react = rng() < style.guard * 2.4 ? "guard" : "none";
    if (ai.react === "guard") {
      input.block = true;
      return input;
    }
  } else if (opp.state === "hurt" && d < char.range + 10) {
    ai.react = "punish";
    input.attack = true;
    return input;
  } else {
    ai.react = undefined;
  }

  switch (ai.act) {
    case "approach":
      if (d > char.range - 20) {
        input.left = toward < 0;
        input.right = toward > 0;
      }
      break;
    case "retreat":
      input.left = toward > 0;
      input.right = toward < 0;
      break;
    case "block":
      input.block = true;
      break;
    case "attack":
      if (d < char.range + 16) {
        input.attack = true; // held: lets the AI chain combos like a player
      } else {
        input.left = toward < 0;
        input.right = toward > 0;
      }
      break;
    case "special":
      if (!ai.fired) {
        input.special = true;
        ai.fired = true;
      }
      break;
    default:
      break;
  }
  return input;
}

/** Ends the current round and settles the match if it is decided. */
function endRound(w, winner, reason) {
  w.endReason = reason;
  w.roundWinner = winner;
  if (winner) {
    w.wins[winner] += 1;
    w.roundLog.push(winner);
    if (reason === "ko") {
      const loser = winner === "p1" ? w.p2 : w.p1;
      loser.state = "ko";
      loser.stateT = 0;
    }
  } else {
    w.roundLog.push("draw");
  }
  w.phase = "roundEnd";
  w.phaseT = ROUND_END_TIME;
  w.shake = reason === "ko" ? 20 : 8;
  say(w, reason === "ko" ? "ko" : "bell");

  const decided = winner && w.wins[winner] >= ROUNDS_TO_WIN;
  const lastRound = w.round >= 2 * ROUNDS_TO_WIN - 1; // best of three
  if (decided || lastRound) {
    let champ = winner;
    if (!decided) {
      // nobody reached two wins, so settle on rounds then on health
      if (w.wins.p1 !== w.wins.p2) champ = w.wins.p1 > w.wins.p2 ? "p1" : "p2";
      else champ = w.p1.hp >= w.p2.hp ? "p1" : "p2";
    }
    w.matchWinner = champ;
    say(w, champ === "p1" ? "matchWin" : "matchLose");
  } else {
    say(w, "roundWin");
  }
}

/* -------------------------------- the loop -------------------------------- */

export function stepWorld(w, playerInput, dt, rng = Math.random) {
  if (w.phase === "intro") {
    w.phaseT -= dt;
    if (w.phaseT <= 0) {
      w.phase = "fight";
      w.phaseT = SHOUT_TIME;
      say(w, "bell");
    }
  } else if (w.phase === "fight") {
    if (w.phaseT > 0) w.phaseT -= dt;

    const p2Input = aiInput(w, w.p2, w.p1, w.charP2, dt, rng);
    stepFighter(w, w.p1, w.p2, w.charP1, playerInput, dt);
    stepFighter(w, w.p2, w.p1, w.charP2, p2Input, dt);

    const passing = w.p1.passThrough || w.p2.passThrough;
    const overlap = passing ? 0 : 168 - gap(w.p1, w.p2); // fighters stand a body apart
    if (overlap > 0) {
      const dir = w.p1.x <= w.p2.x ? 1 : -1;
      w.p1.x = clampX(w.p1.x - dir * overlap * 0.5);
      w.p2.x = clampX(w.p2.x + dir * overlap * 0.5);
    }

    w.roundClock = Math.max(0, w.roundClock - dt);

    if (w.p1.hp <= 0 || w.p2.hp <= 0) {
      endRound(w, w.p1.hp <= 0 ? "p2" : "p1", "ko");
    } else if (w.roundClock <= 0) {
      // time up: the healthier fighter takes the round
      const winner = w.p1.hp === w.p2.hp ? null : w.p1.hp > w.p2.hp ? "p1" : "p2";
      endRound(w, winner, "time");
    }
  } else if (w.phase === "roundEnd") {
    w.phaseT -= dt;
    if (w.phaseT <= 0) {
      if (w.matchWinner) w.phase = "matchEnd";
      else {
        w.round += 1;
        resetForNextRound(w);
      }
    }
  }

  stepFx(w, dt);
  if (w.shake > 0) w.shake = Math.max(0, w.shake - dt * 0.055);
  return w;
}

export function snapshot(w) {
  return {
    p1: { ...w.p1 },
    p2: { ...w.p2 },
    fx: w.fx.map((e) => ({ ...e })),
    phase: w.phase,
    phaseT: w.phaseT,
    round: w.round,
    wins: { ...w.wins },
    roundWinner: w.roundWinner,
    matchWinner: w.matchWinner,
    roundClock: w.roundClock,
    endReason: w.endReason,
    arena: w.arena,
    shake: w.shake,
  };
}

export function drainEvents(w) {
  if (!w.events.length) return [];
  const out = w.events;
  w.events = [];
  return out;
}

export { ROSTER, byId, ARENAS, MAX_HP, MAX_METER };
