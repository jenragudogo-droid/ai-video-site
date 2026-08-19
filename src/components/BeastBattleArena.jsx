import { memo, useCallback, useEffect, useRef, useState } from "react";
import AnimalArt from "./beastArena/AnimalArt.jsx";
import { createBattleAudio } from "./beastArena/audio.js";
import {
  ARENAS,
  MAX_HP,
  MAX_METER,
  ROSTER,
  ROUNDS_TO_WIN,
  WORLD_W,
  byId,
  drainEvents,
  makeWorld,
  snapshot,
  stepWorld,
} from "./beastArena/engine.js";
import "./BeastBattleArena.css";

/* the artwork never changes for a given fighter, so keep it out of the
   per-frame render entirely */
const Art = memo(AnimalArt);

const NO_INPUT = { left: false, right: false, attack: false, special: false, block: false };
const arenaName = (id) => ARENAS.find((a) => a.id === id)?.name || "Arena";

function roundLabel(round) {
  if (round >= 3) return "Final Round";
  return `Round ${round}`;
}

/* ---------------------------------- HUD ---------------------------------- */

function FighterHud({ char, f, align, tag, wins }) {
  const hp = Math.max(0, (f.hp / MAX_HP) * 100);
  const meter = (f.meter / MAX_METER) * 100;
  const ready = f.meter >= MAX_METER;
  return (
    <div className={`bbaHud bbaHud--${align}`}>
      <div className="bbaHudTop">
        <strong>{char.name}</strong>
        <span className="bbaHudTag">{tag}</span>
        <span className="bbaPips" aria-label={`${wins} rounds won`}>
          {Array.from({ length: ROUNDS_TO_WIN }, (_, i) => (
            <i key={i} className={i < wins ? "is-won" : ""} />
          ))}
        </span>
      </div>
      <div
        className="bbaHp"
        role="img"
        aria-label={`${char.name} health ${Math.round(f.hp)} of ${MAX_HP}`}
      >
        <span className="bbaHpChip" style={{ width: `${hp}%` }} />
        <span className="bbaHpFill" style={{ width: `${hp}%` }} />
        <em>{Math.round(f.hp)}</em>
      </div>
      <div className={`bbaMeter ${ready ? "is-ready" : ""}`}>
        <span className="bbaMeterFill" style={{ width: `${meter}%` }} />
        <em>{ready ? `${char.special.name} ready` : "Special power"}</em>
      </div>
    </div>
  );
}

/* --------------------------------- arena --------------------------------- */

const ArenaBackdrop = memo(function ArenaBackdrop({ theme }) {
  return (
    <div className={`bbaScene bbaScene--${theme}`} aria-hidden="true">
      <span className="bbaSky" />
      <span className="bbaSun" />
      <span className="bbaFar bbaFar--1" />
      <span className="bbaFar bbaFar--2" />
      <span className="bbaFar bbaFar--3" />
      <span className="bbaMid bbaMid--l" />
      <span className="bbaMid bbaMid--r" />
      <span className="bbaHaze" />
      <span className="bbaFloor" />
      <span className="bbaVignette" />
    </div>
  );
});

function Beast({ f, char, isPlayer }) {
  const cls = [
    "bbaBeast",
    `bbaBeast--${char.id}`,
    `is-${f.state}`,
    f.combo > 1 ? `is-combo${Math.min(f.combo, 3)}` : "",
    isPlayer ? "is-player" : "is-cpu",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      className={cls}
      style={{
        left: `${(f.x / WORLD_W) * 100}%`,
        bottom: `calc(9% + ${f.y * 0.055}%)`,
        "--dir": f.facing,
        "--accent": char.accent,
      }}
    >
      <span className="bbaBeastShadow" style={{ "--lift": f.y }} />
      <span className="bbaBeastGlow" />
      <Art id={char.id} />
    </div>
  );
}

function Effect({ e }) {
  const p = Math.min(1, e.t / e.life);
  return (
    <span
      className={`bbaFx bbaFx--${e.type} ${e.variant ? `bbaFx--v${e.variant}` : ""}`}
      style={{
        left: `${(e.x / WORLD_W) * 100}%`,
        bottom: `calc(9% + ${(e.y || 0) * 0.055}%)`,
        "--p": p,
        "--dir": e.dir || 1,
        opacity: e.type === "roar" ? 1 - p * 0.9 : undefined,
      }}
      aria-hidden="true"
    />
  );
}

function StatBar({ label, value }) {
  return (
    <span className="bbaStat">
      <i>{label}</i>
      <span className="bbaStatTrack">
        <span style={{ width: `${value * 10}%` }} />
      </span>
      <b>{value}</b>
    </span>
  );
}

/* -------------------------------- component ------------------------------- */

export default function BeastBattleArena() {
  const [screen, setScreen] = useState("select");
  const [playerId, setPlayerId] = useState("lion");
  const [enemyId, setEnemyId] = useState("tiger");
  const [view, setView] = useState(null);
  const [muted, setMuted] = useState(false);

  const worldRef = useRef(null);
  const keysRef = useRef({ ...NO_INPUT });
  const rafRef = useRef(0);
  const lastRef = useRef(0);
  const audioRef = useRef(null);

  const playerChar = byId(playerId);
  const enemyChar = byId(enemyId);

  // lazily built once; no AudioContext exists until unlock() runs in a gesture
  if (audioRef.current == null) audioRef.current = createBattleAudio();

  /* audio can only be created inside a real user gesture */
  const wake = useCallback(() => {
    audioRef.current?.unlock();
  }, []);

  const beginMatch = useCallback(
    (pid, eid) => {
      wake();
      const foePool = ROSTER.filter((c) => c.id !== pid);
      const foe = eid ? byId(eid) : foePool[Math.floor(Math.random() * foePool.length)];
      setPlayerId(pid);
      setEnemyId(foe.id);
      keysRef.current = { ...NO_INPUT };
      worldRef.current = makeWorld(pid, foe.id);
      setView(snapshot(worldRef.current));
      setScreen("fight");
      audioRef.current?.play("ui");
    },
    [wake]
  );

  /* ------------------------------- game loop ------------------------------- */
  useEffect(() => {
    if (screen !== "fight") return undefined;
    const w = worldRef.current;
    if (!w) return undefined;

    const audio = audioRef.current;
    audio?.startMusic();
    lastRef.current = 0;

    const frame = (time) => {
      const prev = lastRef.current || time;
      const dt = Math.min(34, time - prev);
      lastRef.current = time;

      const keys = keysRef.current;
      const input = { ...keys };
      // attack and special are edge triggered so a held key is one action
      if (keys.special) keys.special = false;

      stepWorld(w, input, dt);
      drainEvents(w).forEach((name) => audio?.play(name));

      if (w.phase === "matchEnd") {
        setView(snapshot(w));
        setScreen("over");
        return;
      }
      setView(snapshot(w));
      rafRef.current = requestAnimationFrame(frame);
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [screen]);

  /* music follows the screen; everything stops on unmount */
  useEffect(() => {
    const audio = audioRef.current;
    if (screen !== "fight") audio?.stopMusic();
    return undefined;
  }, [screen]);

  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      audio?.dispose();
    };
  }, []);

  /* keyboard */
  useEffect(() => {
    if (screen !== "fight") return undefined;
    const map = {
      ArrowLeft: "left",
      ArrowRight: "right",
      a: "attack",
      s: "special",
      d: "block",
    };
    const resolve = (ev) => map[ev.key] || map[ev.key?.toLowerCase?.()];
    const down = (ev) => {
      const key = resolve(ev);
      if (!key) return;
      ev.preventDefault();
      keysRef.current[key] = true;
    };
    const up = (ev) => {
      const key = resolve(ev);
      if (!key) return;
      ev.preventDefault();
      if (key !== "special") keysRef.current[key] = false;
    };
    window.addEventListener("keydown", down, { passive: false });
    window.addEventListener("keyup", up, { passive: false });
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [screen]);

  const toggleMute = () => {
    wake();
    setMuted((m) => {
      audioRef.current?.setMuted(!m);
      return !m;
    });
  };

  const hold = (key, value) => () => {
    keysRef.current[key] = value;
  };
  const tap = (key) => () => {
    keysRef.current[key] = true;
  };

  const pad = (key, label, mode, hint) => {
    const handlers =
      mode === "hold"
        ? {
            onPointerDown: hold(key, true),
            onPointerUp: hold(key, false),
            onPointerLeave: hold(key, false),
            onPointerCancel: hold(key, false),
          }
        : { onPointerDown: tap(key) };
    return (
      <button type="button" className={`bbaPad bbaPad--${key}`} key={key} {...handlers}>
        {label}
        {hint && <i>{hint}</i>}
      </button>
    );
  };

  const MuteButton = (
    <button type="button" className="bbaMute" onClick={toggleMute} aria-pressed={muted}>
      <span aria-hidden="true">{muted ? "🔇" : "🔊"}</span>
      {muted ? "Sound off" : "Sound on"}
    </button>
  );

  /* ------------------------------ select screen ----------------------------- */
  if (screen === "select") {
    return (
      <div className="bba">
        <div className="bbaSelect">
          <div className="bbaSelectHead">
            <div>
              <p className="bbaEyebrow">Choose your fighter</p>
              <h3>Ten beasts. Best of three.</h3>
            </div>
            {MuteButton}
          </div>

          <div className="bbaRoster">
            {ROSTER.map((c) => (
              <button
                type="button"
                key={c.id}
                className={`bbaPick ${c.id === playerId ? "is-picked" : ""}`}
                style={{ "--accent": c.accent, "--coat": c.coat }}
                onClick={() => {
                  wake();
                  setPlayerId(c.id);
                  audioRef.current?.play("ui");
                }}
                aria-pressed={c.id === playerId}
              >
                <span className="bbaPickArt">
                  <Art id={c.id} />
                </span>
                <span className="bbaPickName">{c.name}</span>
                <span className="bbaPickStyle">{c.style}</span>
              </button>
            ))}
          </div>

          <div className="bbaBrief">
            <div className="bbaBriefArt">
              <Art id={playerChar.id} />
            </div>
            <div className="bbaBriefText">
              <p className="bbaEyebrow">{playerChar.title}</p>
              <h4>{playerChar.name}</h4>
              <p className="bbaBriefBlurb">{playerChar.blurb}</p>
              <div className="bbaStats">
                <StatBar label="Power" value={playerChar.stats.power} />
                <StatBar label="Speed" value={playerChar.stats.speed} />
                <StatBar label="Reach" value={playerChar.stats.reach} />
              </div>
              <div className="bbaAbility">
                <strong>{playerChar.special.name}</strong>
                <span>{playerChar.special.desc}</span>
              </div>
              <button type="button" className="bbaPrimary" onClick={() => beginMatch(playerId, null)}>
                Enter the arena
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const v = view;
  if (!v) return <div className="bba" />;

  /* ------------------------------ winner screen ----------------------------- */
  if (screen === "over") {
    const playerWon = v.matchWinner === "p1";
    const champ = playerWon ? playerChar : enemyChar;
    return (
      <div className="bba">
        <div className={`bbaOver ${playerWon ? "is-win" : "is-loss"}`}>
          <div className="bbaOverArt">
            <span className="bbaOverBeam" aria-hidden="true" />
            <Art id={champ.id} />
          </div>
          <p className="bbaEyebrow">{playerWon ? "Victory" : "Defeat"}</p>
          <h3>
            {champ.name} wins the match
          </h3>
          <p className="bbaOverScore">
            Rounds {v.wins.p1} – {v.wins.p2} · {playerChar.name} vs {enemyChar.name}
          </p>
          <div className="bbaOverActions">
            <button type="button" className="bbaPrimary" onClick={() => beginMatch(playerId, enemyId)}>
              Play again
            </button>
            <button
              type="button"
              className="bbaGhost"
              onClick={() => {
                wake();
                audioRef.current?.play("ui");
                setScreen("select");
              }}
            >
              Change fighter
            </button>
            {MuteButton}
          </div>
        </div>
      </div>
    );
  }

  /* ------------------------------- fight screen ----------------------------- */
  const showShout = v.phase === "fight" && v.phaseT > 0;
  const roundWinnerChar = v.roundWinner === "p1" ? playerChar : enemyChar;

  return (
    <div className="bba">
      <div className="bbaTop">
        <FighterHud char={playerChar} f={v.p1} align="left" tag="You" wins={v.wins.p1} />
        <div className="bbaRoundBox">
          <span className={`bbaClock ${v.roundClock <= 10000 ? "is-low" : ""}`}>
            {Math.ceil(Math.max(0, v.roundClock) / 1000)}
          </span>
          <span className="bbaRoundName">{roundLabel(v.round)}</span>
          <span className="bbaArenaName">{arenaName(v.arena)}</span>
        </div>
        <FighterHud char={enemyChar} f={v.p2} align="right" tag="CPU" wins={v.wins.p2} />
      </div>

      <div className="bbaStage" style={{ "--shake": v.shake }}>
        <ArenaBackdrop theme={v.arena} />

        <Beast f={v.p1} char={playerChar} isPlayer />
        <Beast f={v.p2} char={enemyChar} />
        {v.fx.map((e) => (
          <Effect e={e} key={e.id} />
        ))}

        {v.phase === "intro" && (
          <div className="bbaBanner">
            <span className="bbaBannerRound">{roundLabel(v.round)}</span>
            <span className="bbaBannerVs">
              {playerChar.name} <em>vs</em> {enemyChar.name}
            </span>
          </div>
        )}
        {showShout && <div className="bbaShout">FIGHT!</div>}
        {v.phase === "roundEnd" && (
          <div className="bbaBanner bbaBanner--result">
            <span className="bbaShout bbaShout--ko">{v.endReason === "time" ? "TIME!" : "K.O."}</span>
            <span className="bbaBannerRound">
              {v.roundWinner
                ? `${roundWinnerChar.name} wins ${roundLabel(v.round).toLowerCase()}`
                : "Round drawn"}
            </span>
            <span className="bbaBannerVs">
              {v.wins.p1} – {v.wins.p2}
            </span>
          </div>
        )}

        <button type="button" className="bbaMute bbaMute--stage" onClick={toggleMute} aria-pressed={muted}>
          <span aria-hidden="true">{muted ? "🔇" : "🔊"}</span>
        </button>
      </div>

      <div className="bbaControls">
        <div className="bbaPadGroup">
          {pad("left", "◀", "hold", "LEFT")}
          {pad("right", "▶", "hold", "RIGHT")}
        </div>
        <div className="bbaPadGroup bbaPadGroup--actions">
          {pad("attack", "ATTACK", "tap", "A")}
          {pad("special", "SPECIAL", "tap", "S")}
          {pad("block", "BLOCK", "hold", "D")}
        </div>
      </div>

      <div className="bbaFootRow">
        <p className="bbaKeys">
          <kbd>←</kbd> <kbd>→</kbd> move · <kbd>A</kbd> attack · <kbd>S</kbd> special ·{" "}
          <kbd>D</kbd> block
        </p>
        <button
          type="button"
          className="bbaGhost bbaGhost--sm"
          onClick={() => {
            audioRef.current?.play("ui");
            setScreen("select");
          }}
        >
          Change fighter
        </button>
      </div>
    </div>
  );
}
