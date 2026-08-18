import { useCallback, useEffect, useRef, useState } from "react";
import "./BeastBattleArena.css";

/* ------------------------------------------------------------------ *
 * Beast Battle Arena — a small original 2D fighting game.
 * No external libraries: plain React state + a requestAnimationFrame loop.
 * The mutable world lives in a ref; each frame publishes a snapshot to
 * React so the arena can be drawn with regular DOM elements and CSS.
 * ------------------------------------------------------------------ */

const WORLD_W = 1000;          // virtual arena width
const EDGE = 70;               // wall padding
const MAX_HP = 100;
const ATTACK_TIME = 360;       // ms, full normal attack
const ATTACK_HIT = [90, 220];  // ms window where the normal attack connects
const HURT_TIME = 250;
const BLOCK_REDUCTION = 0.25;  // blocking keeps 25% of the damage
const INTRO_TIME = 1500;
const KO_TIME = 1100;

const ROSTER = [
  {
    id: "lion",
    name: "Lion",
    title: "Pride Sovereign",
    attackName: "Claw Swipe",
    specialName: "Roar Shockwave",
    specialType: "shockwave",
    speed: 0.3,
    attack: 8,
    range: 118,
    specialDamage: 20,
    cooldown: 6000,
    fur: "#d9a03c",
    fur2: "#9d6a1c",
    glow: "#ffcf72",
    blurb: "Balanced brawler with a roar that rips across the arena.",
  },
  {
    id: "dragon",
    name: "Dragon",
    title: "Ashfall Wyrm",
    attackName: "Claw Strike",
    specialName: "Fire Breath",
    specialType: "projectile",
    speed: 0.26,
    attack: 8,
    range: 124,
    specialDamage: 22,
    cooldown: 7000,
    fur: "#7d51d8",
    fur2: "#3f2679",
    glow: "#ff8a3d",
    blurb: "Slow on foot, but breathes a stream of fire across any distance.",
  },
  {
    id: "gorilla",
    name: "Gorilla",
    title: "Stone Silverback",
    attackName: "Heavy Punch",
    specialName: "Ground Smash",
    specialType: "slam",
    speed: 0.24,
    attack: 11,
    range: 108,
    specialDamage: 20,
    cooldown: 6500,
    fur: "#4c4c58",
    fur2: "#26262e",
    glow: "#9fb0c6",
    blurb: "Heaviest normal attack and a quake that punishes close range.",
  },
  {
    id: "cheetah",
    name: "Cheetah",
    title: "Dust Runner",
    attackName: "Quick Swipe",
    specialName: "Speed Dash",
    specialType: "charge",
    dashSpeed: 1.15,
    dashTime: 520,
    speed: 0.44,
    attack: 6,
    range: 96,
    specialDamage: 15,
    cooldown: 4200,
    fur: "#e0b451",
    fur2: "#a4761f",
    glow: "#ffe9a8",
    blurb: "Fastest fighter alive — dashes in, strikes, and slips away.",
  },
  {
    id: "elephant",
    name: "Elephant",
    title: "Grey Mountain",
    attackName: "Trunk Strike",
    specialName: "Powerful Charge",
    specialType: "charge",
    dashSpeed: 0.85,
    dashTime: 700,
    speed: 0.19,
    attack: 10,
    range: 128,
    specialDamage: 24,
    cooldown: 7500,
    fur: "#8d93a6",
    fur2: "#565c6d",
    glow: "#d7ddec",
    blurb: "Slowest mover, hardest charge. One clean hit changes the round.",
  },
  {
    id: "crocodile",
    name: "Crocodile",
    title: "River Tyrant",
    attackName: "Tail Swipe",
    specialName: "Crushing Bite",
    specialType: "bite",
    speed: 0.28,
    attack: 9,
    range: 104,
    specialDamage: 21,
    cooldown: 6200,
    fur: "#4f8a4a",
    fur2: "#27512c",
    glow: "#a8e06a",
    blurb: "Waits in range, then locks on with a bite that does not let go.",
  },
  {
    id: "eagle",
    name: "Eagle",
    title: "Storm Talon",
    attackName: "Wing Strike",
    specialName: "Dive Attack",
    specialType: "dive",
    dashSpeed: 0.8,
    dashTime: 760,
    speed: 0.4,
    attack: 6,
    range: 102,
    specialDamage: 17,
    cooldown: 5000,
    fur: "#7a5330",
    fur2: "#4a3120",
    glow: "#ffd97a",
    blurb: "Light and quick, drops out of the sky with talons first.",
  },
  {
    id: "rhino",
    name: "Rhino",
    title: "Iron Horn",
    attackName: "Heavy Headbutt",
    specialName: "Horn Rush",
    specialType: "charge",
    dashSpeed: 0.98,
    dashTime: 620,
    speed: 0.27,
    attack: 10,
    range: 112,
    specialDamage: 23,
    cooldown: 7000,
    fur: "#7d8794",
    fur2: "#474e59",
    glow: "#dbe4ee",
    blurb: "Armoured front line — rushes forward and does not stop early.",
  },
];

const byId = (id) => ROSTER.find((c) => c.id === id) || ROSTER[0];

/* ---------------------------------- world ---------------------------------- */

function makeFighter(char, side) {
  return {
    side,
    charId: char.id,
    x: side === "p1" ? 290 : 710,
    y: 0,
    hp: MAX_HP,
    facing: side === "p1" ? 1 : -1,
    state: "idle",
    stateT: 0,
    cd: 0,
    hitDone: false,
    lastHitAt: 0,
  };
}

function makeWorld(playerChar, enemyChar) {
  return {
    p1: makeFighter(playerChar, "p1"),
    p2: makeFighter(enemyChar, "p2"),
    fx: [],
    fxId: 0,
    phase: "intro",
    phaseT: INTRO_TIME,
    winner: null,
    ai: { t: 600, act: "wait", fired: false },
    shake: 0,
  };
}

const dist = (a, b) => Math.abs(a.x - b.x);

function spawnFx(w, fx) {
  w.fxId += 1;
  w.fx.push({ id: w.fxId, t: 0, ...fx });
}

function applyDamage(w, target, amount, fromX) {
  if (target.state === "ko") return;
  const blocked = target.state === "block";
  const dealt = Math.round(blocked ? amount * BLOCK_REDUCTION : amount);
  target.hp = Math.max(0, target.hp - dealt);
  const dir = target.x >= fromX ? 1 : -1;
  target.x = Math.min(WORLD_W - EDGE, Math.max(EDGE, target.x + dir * (blocked ? 8 : 26)));
  if (!blocked) {
    target.state = "hurt";
    target.stateT = HURT_TIME;
  }
  w.shake = blocked ? 4 : 10;
  spawnFx(w, {
    type: blocked ? "guard" : "impact",
    x: target.x - dir * 30,
    y: 210,
    life: blocked ? 260 : 320,
  });
}

function startSpecial(w, f, char) {
  f.state = "special";
  f.hitDone = false;
  f.cd = char.cooldown;
  switch (char.specialType) {
    case "projectile":
      f.stateT = 760;
      break;
    case "shockwave":
      f.stateT = 820;
      break;
    case "slam":
      f.stateT = 720;
      break;
    case "bite":
      f.stateT = 580;
      break;
    default:
      f.stateT = char.dashTime || 620;
  }
}

/** Per-frame special behaviour: movement, fx spawning and contact damage. */
function runSpecial(w, f, opp, char, dt, elapsed) {
  const type = char.specialType;

  if (type === "projectile") {
    if (elapsed >= 200 && !f.hitDone) {
      f.hitDone = true;
      spawnFx(w, {
        type: "fire",
        x: f.x + f.facing * 70,
        y: 262,
        dir: f.facing,
        speed: 0.62,
        life: 1400,
        owner: f.side,
        damage: char.specialDamage,
      });
    }
    return;
  }

  if (type === "shockwave") {
    if (elapsed >= 240 && !f.hitDone) {
      f.hitDone = true;
      spawnFx(w, {
        type: "roar",
        x: f.x + f.facing * 40,
        y: 250,
        dir: f.facing,
        life: 720,
        owner: f.side,
        damage: char.specialDamage,
        radius: 430,
      });
    }
    return;
  }

  if (type === "slam") {
    if (elapsed >= 260 && !f.hitDone) {
      f.hitDone = true;
      spawnFx(w, { type: "smash", x: f.x, y: 0, life: 560 });
      if (dist(f, opp) < 235) applyDamage(w, opp, char.specialDamage, f.x);
      w.shake = 14;
    }
    return;
  }

  if (type === "bite") {
    // short lunge so the jaws can actually reach a backing-off opponent
    if (elapsed < 300) {
      f.x = Math.min(WORLD_W - EDGE, Math.max(EDGE, f.x + f.facing * 0.22 * dt));
    }
    if (elapsed >= 180 && elapsed <= 420 && !f.hitDone) {
      const facingOk = (opp.x - f.x) * f.facing > 0;
      if (facingOk && dist(f, opp) < char.range + 60) {
        f.hitDone = true;
        applyDamage(w, opp, char.specialDamage, f.x);
        spawnFx(w, { type: "bite", x: f.x + f.facing * 60, y: 250, life: 320 });
      }
    }
    return;
  }

  if (type === "dive") {
    const p = elapsed / (char.dashTime || 760);
    f.y = Math.sin(Math.min(p, 1) * Math.PI) * 130 * (1 - p * 0.45);
    f.x = Math.min(
      WORLD_W - EDGE,
      Math.max(EDGE, f.x + f.facing * (char.dashSpeed || 0.8) * dt)
    );
    if (elapsed > 20) {
      spawnFx(w, { type: "feather", x: f.x, y: f.y + 200, life: 260 });
    }
    if (!f.hitDone && dist(f, opp) < 110) {
      f.hitDone = true;
      applyDamage(w, opp, char.specialDamage, f.x);
    }
    return;
  }

  // charge (cheetah / elephant / rhino)
  f.x = Math.min(
    WORLD_W - EDGE,
    Math.max(EDGE, f.x + f.facing * (char.dashSpeed || 0.9) * dt)
  );
  spawnFx(w, { type: "streak", x: f.x - f.facing * 40, y: 90, life: 240 });
  if (!f.hitDone && dist(f, opp) < 120) {
    f.hitDone = true;
    applyDamage(w, opp, char.specialDamage, f.x);
  }
}

function stepFighter(w, f, opp, char, input, dt) {
  if (f.state === "ko") return;

  if (f.cd > 0) f.cd = Math.max(0, f.cd - dt);

  if (f.state === "special") {
    const total =
      char.specialType === "projectile"
        ? 760
        : char.specialType === "shockwave"
          ? 820
          : char.specialType === "slam"
            ? 720
            : char.specialType === "bite"
              ? 580
              : char.dashTime || 620;
    const elapsed = total - f.stateT;
    runSpecial(w, f, opp, char, dt, elapsed);
    f.stateT -= dt;
    if (f.stateT <= 0) {
      f.state = "idle";
      f.y = 0;
    }
    return;
  }

  if (f.state === "attack") {
    const elapsed = ATTACK_TIME - f.stateT;
    if (!f.hitDone && elapsed >= ATTACK_HIT[0] && elapsed <= ATTACK_HIT[1]) {
      const facingOk = (opp.x - f.x) * f.facing > 0;
      if (facingOk && dist(f, opp) < char.range) {
        f.hitDone = true;
        applyDamage(w, opp, char.attack, f.x);
      }
    }
    f.stateT -= dt;
    if (f.stateT <= 0) f.state = "idle";
    return;
  }

  if (f.state === "hurt") {
    f.stateT -= dt;
    if (f.stateT <= 0) f.state = "idle";
    return;
  }

  // free to act
  f.facing = opp.x >= f.x ? 1 : -1;

  if (input.special && f.cd <= 0) {
    startSpecial(w, f, char);
    return;
  }
  if (input.attack) {
    f.state = "attack";
    f.stateT = ATTACK_TIME;
    f.hitDone = false;
    spawnFx(w, { type: "slash", x: f.x + f.facing * 70, y: 235, dir: f.facing, life: 240 });
    return;
  }
  if (input.block) {
    f.state = "block";
    return;
  }

  let moved = 0;
  if (input.left) moved -= 1;
  if (input.right) moved += 1;
  if (moved !== 0) {
    f.x = Math.min(WORLD_W - EDGE, Math.max(EDGE, f.x + moved * char.speed * dt));
    f.state = "walk";
  } else {
    f.state = "idle";
  }
}

function stepFx(w, dt) {
  for (const e of w.fx) {
    e.t += dt;
    if (e.type === "fire") {
      e.x += e.dir * e.speed * dt;
      const target = e.owner === "p1" ? w.p2 : w.p1;
      if (!e.spent && Math.abs(target.x - e.x) < 78) {
        e.spent = true;
        applyDamage(w, target, e.damage, e.x);
      }
      if (e.x < 0 || e.x > WORLD_W) e.t = e.life;
    }
    if (e.type === "roar" && !e.spent) {
      const target = e.owner === "p1" ? w.p2 : w.p1;
      const reach = (e.t / e.life) * e.radius;
      const towardTarget = (target.x - e.x) * e.dir > 0;
      if (towardTarget && Math.abs(target.x - e.x) < reach) {
        e.spent = true;
        applyDamage(w, target, e.damage, e.x);
      }
    }
  }
  w.fx = w.fx.filter((e) => e.t < e.life);
  if (w.fx.length > 40) w.fx = w.fx.slice(-40);
}

/** Simple opponent AI: paces, pokes, blocks and saves its special. */
function aiInput(w, f, opp, char, dt) {
  const ai = w.ai;
  const gap = dist(f, opp);
  ai.t -= dt;

  if (ai.t <= 0) {
    const r = Math.random();
    ai.fired = false;
    if (gap > 300) {
      ai.act = r < 0.6 ? "approach" : r < 0.78 ? "special" : "wait";
      ai.t = 420 + Math.random() * 420;
    } else if (gap > 150) {
      ai.act =
        r < 0.4 ? "approach" : r < 0.56 ? "retreat" : r < 0.72 ? "special" : r < 0.88 ? "block" : "wait";
      ai.t = 340 + Math.random() * 420;
    } else {
      ai.act =
        r < 0.38 ? "attack" : r < 0.53 ? "special" : r < 0.74 ? "block" : r < 0.9 ? "retreat" : "approach";
      ai.t = 300 + Math.random() * 400;
    }
    if (ai.act === "special" && f.cd > 0) ai.act = gap > 200 ? "approach" : "attack";
  }

  const toward = opp.x >= f.x ? 1 : -1;
  const input = { left: false, right: false, attack: false, special: false, block: false };

  switch (ai.act) {
    case "approach":
      if (gap > 90) {
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
      if (!ai.fired && gap < char.range + 10) {
        input.attack = true;
        ai.fired = true;
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

function snapshot(w) {
  return {
    p1: { ...w.p1 },
    p2: { ...w.p2 },
    fx: w.fx.map((e) => ({ ...e })),
    phase: w.phase,
    phaseT: w.phaseT,
    winner: w.winner,
    shake: w.shake,
  };
}

/* --------------------------------- drawing --------------------------------- */

function Beast({ f, char }) {
  const style = {
    left: `${(f.x / WORLD_W) * 100}%`,
    bottom: `calc(11% + ${f.y * 0.1}%)`,
    "--dir": f.facing,
    "--fur": char.fur,
    "--fur2": char.fur2,
    "--glow": char.glow,
  };
  return (
    <div
      className={`bbaBeast bbaBeast--${char.id} is-${f.state}`}
      style={style}
      aria-hidden="true"
    >
      <span className="bbaShadow" />
      <span className="bbaTail" />
      <span className="bbaWing" />
      <span className="bbaLeg bbaLeg--back" />
      <span className="bbaLeg bbaLeg--front" />
      <span className="bbaTorso" />
      <span className="bbaMane" />
      <span className="bbaHead">
        <span className="bbaEar" />
        <span className="bbaEar bbaEar--two" />
        <span className="bbaHorn" />
        <span className="bbaSnout" />
        <span className="bbaEye" />
      </span>
      <span className="bbaArm" />
      <span className="bbaGuard" />
    </div>
  );
}

function Fx({ e }) {
  const p = Math.min(1, e.t / e.life);
  const style = {
    left: `${(e.x / WORLD_W) * 100}%`,
    bottom: `calc(11% + ${(e.y || 0) * 0.1}%)`,
    "--p": p,
    "--dir": e.dir || 1,
    opacity: e.type === "roar" ? 1 - p : undefined,
  };
  return <span className={`bbaFx bbaFx--${e.type}`} style={style} aria-hidden="true" />;
}

function HealthPanel({ char, f, align, label }) {
  const pct = (f.hp / MAX_HP) * 100;
  const cdPct = char.cooldown ? ((char.cooldown - f.cd) / char.cooldown) * 100 : 100;
  const ready = f.cd <= 0;
  return (
    <div className={`bbaHud bbaHud--${align}`}>
      <div className="bbaHudTop">
        <strong>{char.name}</strong>
        <span className="bbaHudTag">{label}</span>
      </div>
      <div className="bbaBar" role="img" aria-label={`${char.name} health ${Math.round(f.hp)} of 100`}>
        <span className="bbaBarFill" style={{ width: `${pct}%` }} />
        <em>{Math.round(f.hp)}</em>
      </div>
      <div className={`bbaCd ${ready ? "is-ready" : ""}`}>
        <span className="bbaCdFill" style={{ width: `${Math.min(100, cdPct)}%` }} />
        <em>{ready ? `${char.specialName} ready` : `${(f.cd / 1000).toFixed(1)}s`}</em>
      </div>
    </div>
  );
}

/* -------------------------------- component -------------------------------- */

export default function BeastBattleArena() {
  const [screen, setScreen] = useState("select");
  const [playerId, setPlayerId] = useState("lion");
  const [enemyId, setEnemyId] = useState("dragon");
  const [view, setView] = useState(null);

  const worldRef = useRef(null);
  const keysRef = useRef({ left: false, right: false, attack: false, special: false, block: false });
  const rafRef = useRef(0);
  const lastRef = useRef(0);

  const playerChar = byId(playerId);
  const enemyChar = byId(enemyId);

  const beginFight = useCallback((pid, eid) => {
    const player = byId(pid);
    const pool = ROSTER.filter((c) => c.id !== pid);
    const foe = eid ? byId(eid) : pool[Math.floor(Math.random() * pool.length)];
    setPlayerId(player.id);
    setEnemyId(foe.id);
    keysRef.current = { left: false, right: false, attack: false, special: false, block: false };
    worldRef.current = makeWorld(player, foe);
    setView(snapshot(worldRef.current));
    setScreen("fight");
  }, []);

  // main loop
  useEffect(() => {
    if (screen !== "fight") return undefined;
    const w = worldRef.current;
    if (!w) return undefined;
    lastRef.current = 0;

    const frame = (time) => {
      const prev = lastRef.current || time;
      const dt = Math.min(34, time - prev);
      lastRef.current = time;

      if (w.phase === "intro") {
        w.phaseT -= dt;
        if (w.phaseT <= 0) {
          w.phase = "fight";
          w.phaseT = 900; // "FIGHT!" banner hold
        }
      } else if (w.phase === "fight") {
        if (w.phaseT > 0) w.phaseT -= dt;

        const keys = keysRef.current;
        const p1Input = {
          left: keys.left,
          right: keys.right,
          attack: keys.attack,
          special: keys.special,
          block: keys.block,
        };
        if (keys.attack) keys.attack = false;
        if (keys.special) keys.special = false;

        const p2Input = aiInput(w, w.p2, w.p1, enemyChar, dt);

        stepFighter(w, w.p1, w.p2, playerChar, p1Input, dt);
        stepFighter(w, w.p2, w.p1, enemyChar, p2Input, dt);

        // keep the fighters from standing inside each other
        const overlap = 96 - dist(w.p1, w.p2);
        if (overlap > 0) {
          const push = overlap / 2;
          const dir = w.p1.x <= w.p2.x ? 1 : -1;
          w.p1.x = Math.min(WORLD_W - EDGE, Math.max(EDGE, w.p1.x - dir * push));
          w.p2.x = Math.min(WORLD_W - EDGE, Math.max(EDGE, w.p2.x + dir * push));
        }

        if (w.p1.hp <= 0 || w.p2.hp <= 0) {
          const loser = w.p1.hp <= 0 ? w.p1 : w.p2;
          const champ = w.p1.hp <= 0 ? w.p2 : w.p1;
          loser.state = "ko";
          champ.state = "idle";
          w.winner = champ.side;
          w.phase = "ko";
          w.phaseT = KO_TIME;
          w.shake = 16;
        }
      } else if (w.phase === "ko") {
        w.phaseT -= dt;
        if (w.phaseT <= 0) {
          setScreen("over");
        }
      }

      stepFx(w, dt);
      if (w.shake > 0) w.shake = Math.max(0, w.shake - dt * 0.05);
      setView(snapshot(w));
      rafRef.current = requestAnimationFrame(frame);
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [screen, playerChar, enemyChar]);

  // keyboard controls
  useEffect(() => {
    if (screen !== "fight") return undefined;
    const map = {
      ArrowLeft: "left",
      ArrowRight: "right",
      a: "attack",
      s: "special",
      d: "block",
    };
    const down = (ev) => {
      const key = map[ev.key] || map[ev.key.toLowerCase?.()];
      if (!key) return;
      ev.preventDefault();
      keysRef.current[key] = true;
    };
    const up = (ev) => {
      const key = map[ev.key] || map[ev.key.toLowerCase?.()];
      if (!key) return;
      ev.preventDefault();
      if (key === "left" || key === "right" || key === "block") keysRef.current[key] = false;
    };
    window.addEventListener("keydown", down, { passive: false });
    window.addEventListener("keyup", up, { passive: false });
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [screen]);

  const hold = (key, value) => () => {
    keysRef.current[key] = value;
  };
  const tap = (key) => () => {
    keysRef.current[key] = true;
  };

  const touchButton = (key, label, mode) => {
    const props =
      mode === "hold"
        ? {
            onPointerDown: hold(key, true),
            onPointerUp: hold(key, false),
            onPointerLeave: hold(key, false),
            onPointerCancel: hold(key, false),
          }
        : { onPointerDown: tap(key) };
    return (
      <button type="button" className={`bbaPad bbaPad--${key}`} key={key} {...props}>
        {label}
      </button>
    );
  };

  /* ------------------------------ select screen ------------------------------ */
  if (screen === "select") {
    return (
      <div className="bba">
        <div className="bbaSelect">
          <div className="bbaSelectHead">
            <p className="bbaEyebrow">Choose your beast</p>
            <h3>Eight fighters. One arena.</h3>
            <p className="bbaSelectSub">
              Every beast has its own speed, normal attack and special move with a cooldown.
            </p>
          </div>

          <div className="bbaRoster">
            {ROSTER.map((c) => (
              <button
                type="button"
                key={c.id}
                className={`bbaCard ${c.id === playerId ? "is-picked" : ""}`}
                style={{ "--fur": c.fur, "--fur2": c.fur2, "--glow": c.glow }}
                onClick={() => setPlayerId(c.id)}
                aria-pressed={c.id === playerId}
              >
                <span className="bbaCardArt">
                  <span className={`bbaBeast bbaBeast--${c.id} is-idle bbaBeast--mini`}>
                    <span className="bbaTail" />
                    <span className="bbaWing" />
                    <span className="bbaLeg bbaLeg--back" />
                    <span className="bbaLeg bbaLeg--front" />
                    <span className="bbaTorso" />
                    <span className="bbaMane" />
                    <span className="bbaHead">
                      <span className="bbaEar" />
                      <span className="bbaEar bbaEar--two" />
                      <span className="bbaHorn" />
                      <span className="bbaSnout" />
                      <span className="bbaEye" />
                    </span>
                    <span className="bbaArm" />
                  </span>
                </span>
                <span className="bbaCardName">{c.name}</span>
                <span className="bbaCardTitle">{c.title}</span>
                <span className="bbaCardStats">
                  <span>Speed<em>{Math.round(c.speed * 22)}</em></span>
                  <span>Attack<em>{c.attack}</em></span>
                  <span>Special<em>{c.specialDamage}</em></span>
                </span>
              </button>
            ))}
          </div>

          <div className="bbaSelectFoot">
            <div className="bbaPickInfo">
              <strong>{playerChar.name}</strong>
              <p>{playerChar.blurb}</p>
              <p className="bbaMoves">
                <span>Normal · {playerChar.attackName}</span>
                <span>Special · {playerChar.specialName}</span>
                <span>Cooldown · {(playerChar.cooldown / 1000).toFixed(1)}s</span>
              </p>
            </div>
            <button type="button" className="bbaPrimary" onClick={() => beginFight(playerId, null)}>
              Enter the arena
            </button>
          </div>
        </div>
      </div>
    );
  }

  const v = view;
  if (!v) return <div className="bba" />;

  const statusText =
    v.phase === "intro"
      ? "Ready…"
      : v.phase === "ko"
        ? "K.O.!"
        : v.phaseT > 0
          ? "Fight!"
          : "Round 1";

  /* ------------------------------ winner screen ------------------------------ */
  if (screen === "over") {
    const playerWon = v.winner === "p1";
    return (
      <div className="bba">
        <div className="bbaOverScreen">
          <p className="bbaEyebrow">{playerWon ? "Victory" : "Defeat"}</p>
          <h3>{playerWon ? `${playerChar.name} wins the round` : `${enemyChar.name} wins the round`}</h3>
          <p className="bbaOverSub">
            {playerChar.name} {Math.round(v.p1.hp)} HP · {enemyChar.name} {Math.round(v.p2.hp)} HP
          </p>
          <div className="bbaOverActions">
            <button type="button" className="bbaPrimary" onClick={() => beginFight(playerId, enemyId)}>
              Restart fight
            </button>
            <button type="button" className="bbaGhost" onClick={() => setScreen("select")}>
              Character select
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ------------------------------- fight screen ------------------------------ */
  return (
    <div className="bba">
      <div className="bbaTopBar">
        <HealthPanel char={playerChar} f={v.p1} align="left" label="You" />
        <div className="bbaRound">
          <span className={`bbaStatus ${v.phase === "ko" ? "is-ko" : ""}`}>{statusText}</span>
          <span className="bbaVs">VS</span>
        </div>
        <HealthPanel char={enemyChar} f={v.p2} align="right" label="CPU" />
      </div>

      <div
        className="bbaStage"
        style={{ "--shake": v.shake }}
      >
        <div className="bbaSky" aria-hidden="true">
          <span className="bbaMoon" />
          <span className="bbaPeak bbaPeak--1" />
          <span className="bbaPeak bbaPeak--2" />
          <span className="bbaPeak bbaPeak--3" />
          <span className="bbaPillar bbaPillar--l" />
          <span className="bbaPillar bbaPillar--r" />
          <span className="bbaEmber bbaEmber--1" />
          <span className="bbaEmber bbaEmber--2" />
          <span className="bbaEmber bbaEmber--3" />
          <span className="bbaEmber bbaEmber--4" />
        </div>
        <div className="bbaFloor" aria-hidden="true" />

        <Beast f={v.p1} char={playerChar} />
        <Beast f={v.p2} char={enemyChar} />
        {v.fx.map((e) => (
          <Fx e={e} key={e.id} />
        ))}

        {v.phase === "intro" && (
          <div className="bbaBanner">
            <span>{playerChar.name}</span>
            <em>vs</em>
            <span>{enemyChar.name}</span>
          </div>
        )}
        {v.phase === "fight" && v.phaseT > 0 && <div className="bbaShout">FIGHT!</div>}
        {v.phase === "ko" && <div className="bbaShout bbaShout--ko">K.O.</div>}
      </div>

      <div className="bbaControls">
        <div className="bbaPadGroup">
          {touchButton("left", "◀ LEFT", "hold")}
          {touchButton("right", "RIGHT ▶", "hold")}
        </div>
        <div className="bbaPadGroup bbaPadGroup--actions">
          {touchButton("attack", "ATTACK", "tap")}
          {touchButton("special", "SPECIAL", "tap")}
          {touchButton("block", "BLOCK", "hold")}
        </div>
      </div>

      <div className="bbaFootRow">
        <p className="bbaKeys">
          Keyboard: <kbd>←</kbd> <kbd>→</kbd> move · <kbd>A</kbd> attack · <kbd>S</kbd> special ·{" "}
          <kbd>D</kbd> block
        </p>
        <button type="button" className="bbaGhost bbaGhost--sm" onClick={() => setScreen("select")}>
          Character select
        </button>
      </div>
    </div>
  );
}
