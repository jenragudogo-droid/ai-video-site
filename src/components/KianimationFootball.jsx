import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MAX_SUBS,
  drainEvents,
  hudSnapshot,
  makeInput,
  makeMatch,
  requestSub,
  squadView,
  startNextPeriod,
  statLines,
  stepMatch,
} from "./kfl/engine.js";
import { FORMATIONS, FORMATION_IDS, positionFit, ratingInSlot } from "./kfl/formations.js";
import { CLUBS, DEFAULT_AWAY, DEFAULT_HOME, clubById, autoLineup, teamRating } from "./kfl/teams.js";
import { createRenderer } from "./kfl/render.js";
import { createFootballAudio } from "./kfl/audio.js";
import { createCommentator } from "./kfl/commentary.js";
import { MODES, quickMatchConfig } from "./kfl/modes.js";
import "./KianimationFootball.css";

const HALF_LENGTHS = [
  { id: 120, label: "Short", note: "2 min halves" },
  { id: 180, label: "Normal", note: "3 min halves" },
  { id: 300, label: "Long", note: "5 min halves" },
];

const DIFFICULTIES = [
  { id: "easy", label: "Amateur" },
  { id: "normal", label: "Pro" },
  { id: "hard", label: "Legend" },
];

const KEY_MAP = {
  KeyW: "up", ArrowUp: "up",
  KeyS: "down", ArrowDown: "down",
  KeyA: "left", ArrowLeft: "left",
  KeyD: "right", ArrowRight: "right",
  ShiftLeft: "sprint", ShiftRight: "sprint",
  Space: "pass",
  KeyE: "through",
  KeyF: "shoot",
  KeyC: "cross",
  KeyQ: "tackle",
  KeyV: "switch",
};

/* media queries and the vendor prefixed fullscreen API, guarded so the
   module still imports in a non browser environment */
const matches = (query) =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(query).matches
    : false;

const listen = (mq, fn) => (mq.addEventListener ? mq.addEventListener("change", fn) : mq.addListener(fn));
const unlisten = (mq, fn) => (mq.removeEventListener ? mq.removeEventListener("change", fn) : mq.removeListener(fn));

const fullscreenElement = () =>
  (typeof document === "undefined" ? null : document.fullscreenElement || document.webkitFullscreenElement);

const fullscreenSupported = () =>
  typeof document !== "undefined"
  && !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);

const shortName = (name) => {
  const parts = name.split(" ");
  return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(" ")}` : name;
};

/* ---------------------------- player details ---------------------------- */

const StatBar = ({ label, value }) => (
  <div className="kflStatBar">
    <span>{label}</span>
    <i><b style={{ width: `${value}%` }} /></i>
    <em>{value}</em>
  </div>
);

function PlayerCard({ player, slotRole, onClose }) {
  if (!player) return null;
  const isGK = player.position === "GK";
  const fit = slotRole ? positionFit(player.position, slotRole) : 1;
  return (
    <div className="kflModal" role="dialog" aria-label={`${player.name} details`}>
      <div className="kflModalBox kflPlayerCard">
        <button type="button" className="kflClose" onClick={onClose} aria-label="Close">×</button>
        <div className="kflPlayerHead">
          <span className="kflPlayerNum">{player.number}</span>
          <div>
            <h4>{player.name}</h4>
            <p>
              {player.position} · {player.nationality} · {player.age} yrs · {player.look.height}cm · {player.foot} foot
            </p>
          </div>
          <span className="kflRatingBig">{player.overall}</span>
        </div>
        {slotRole && fit < 1 && (
          <p className="kflWarn">
            Playing at {slotRole} — out of position, effective rating {ratingInSlot(player, slotRole)}.
          </p>
        )}
        <div className="kflStatGrid">
          {isGK ? (
            <>
              <StatBar label="Diving" value={player.diving} />
              <StatBar label="Handling" value={player.handling} />
              <StatBar label="Kicking" value={player.kicking} />
              <StatBar label="Reflexes" value={player.reflexes} />
              <StatBar label="Positioning" value={player.positioning} />
              <StatBar label="Physical" value={player.physical} />
            </>
          ) : (
            <>
              <StatBar label="Pace" value={player.pace} />
              <StatBar label="Shooting" value={player.shooting} />
              <StatBar label="Passing" value={player.passing} />
              <StatBar label="Dribbling" value={player.dribbling} />
              <StatBar label="Defending" value={player.defending} />
              <StatBar label="Physical" value={player.physical} />
            </>
          )}
          <StatBar label="Stamina" value={player.stamina} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ setup screen ---------------------------- */

function ClubButton({ club, active, onClick, disabled }) {
  return (
    <button
      type="button"
      className={`kflClubBtn ${active ? "is-active" : ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="kflClubCrest" style={{ background: club.kit.shirt, borderColor: club.kit.trim }}>
        {club.abbr}
      </span>
      <span className="kflClubMeta">
        <strong>{club.name}</strong>
        <em>{club.nickname}</em>
      </span>
    </button>
  );
}

/* ----------------------------- squad screen ----------------------------- */

function SquadEditor({ club, setup, onChange, onInspect, side }) {
  const formation = FORMATIONS[setup.formation];
  const [selected, setSelected] = useState(null);
  const squad = club.squad;
  const byId = useMemo(() => new Map(squad.map((p) => [p.id, p])), [squad]);

  const swap = (a, b) => {
    const xi = [...setup.xi];
    const bench = [...setup.bench];
    const inXiA = xi.indexOf(a);
    const inXiB = xi.indexOf(b);
    const inBenchA = bench.indexOf(a);
    const inBenchB = bench.indexOf(b);

    if (inXiA >= 0 && inXiB >= 0) {
      xi[inXiA] = b;
      xi[inXiB] = a;
    } else if (inXiA >= 0 && inBenchB >= 0) {
      xi[inXiA] = b;
      bench[inBenchB] = a;
    } else if (inXiB >= 0 && inBenchA >= 0) {
      xi[inXiB] = a;
      bench[inBenchA] = b;
    } else if (inBenchA >= 0 && inBenchB >= 0) {
      bench[inBenchA] = b;
      bench[inBenchB] = a;
    }
    onChange({ ...setup, xi, bench });
  };

  const tap = (id) => {
    if (!selected) {
      setSelected(id);
      return;
    }
    if (selected === id) {
      setSelected(null);
      return;
    }
    swap(selected, id);
    setSelected(null);
  };

  const rating = teamRating(squad, setup.xi);

  return (
    <div className="kflSquad">
      <div className="kflSquadBar">
        <label>
          Formation
          <select
            value={setup.formation}
            onChange={(e) => {
              const f = FORMATIONS[e.target.value];
              onChange({ formation: f.id, ...autoLineup(squad, f) });
              setSelected(null);
            }}
          >
            {FORMATION_IDS.map((id) => (
              <option key={id} value={id}>{id} · {FORMATIONS[id].style}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="kflGhost kflGhost--sm"
          onClick={() => {
            onChange({ formation: setup.formation, ...autoLineup(squad, formation) });
            setSelected(null);
          }}
        >
          Auto pick
        </button>
        <span className="kflTeamRating">Squad rating <strong>{rating}</strong></span>
      </div>

      <div className="kflPitchPlan" aria-label="Starting eleven positions">
        <span className="kflPlanLine kflPlanHalf" />
        <span className="kflPlanLine kflPlanCircle" />
        <span className="kflPlanBox kflPlanBox--top" />
        <span className="kflPlanBox kflPlanBox--bottom" />
        {formation.slots.map((slot, i) => {
          const p = byId.get(setup.xi[i]);
          if (!p) return null;
          const fit = positionFit(p.position, slot.role);
          return (
            <button
              type="button"
              key={`${slot.role}-${i}`}
              className={`kflPlanSlot ${selected === p.id ? "is-selected" : ""} ${fit < 0.9 ? "is-outOfPos" : ""}`}
              style={{ left: `${slot.ny * 100}%`, bottom: `${8 + slot.nx * 84}%` }}
              onClick={() => tap(p.id)}
              onDoubleClick={() => onInspect(p, slot.role)}
            >
              <span className="kflPlanRole">{slot.role}</span>
              <span className="kflPlanShirt" style={{ background: club.kit.shirt, color: club.kit.number }}>
                {p.number}
              </span>
              <span className="kflPlanName">{shortName(p.name)}</span>
              <span className="kflPlanRating">{ratingInSlot(p, slot.role)}</span>
            </button>
          );
        })}
      </div>

      <p className="kflHint">
        Tap a player, then tap another player or a bench slot to swap them. Double tap a card for full ratings.
      </p>

      <div className="kflBenchWrap">
        <h4>Substitutes <span>{setup.bench.length}</span></h4>
        <div className="kflBenchList">
          {setup.bench.map((id) => {
            const p = byId.get(id);
            if (!p) return null;
            return (
              <button
                type="button"
                key={id}
                className={`kflBenchRow ${selected === id ? "is-selected" : ""}`}
                onClick={() => tap(id)}
                onDoubleClick={() => onInspect(p, null)}
              >
                <span className="kflBenchNum">{p.number}</span>
                <span className="kflBenchName">{p.name}</span>
                <span className="kflBenchPos">{p.position}</span>
                <span className="kflBenchRating">{p.overall}</span>
              </button>
            );
          })}
        </div>
      </div>
      <p className="kflHint kflHint--muted">{side}</p>
    </div>
  );
}

/* ------------------------------- match HUD ------------------------------ */

const MatchHud = memo(function MatchHud({ hud, home, away, onPause, onSubs, onFullscreen, fullscreen, canFullscreen }) {
  const c = hud.controlled;
  const stamina = c ? c.stamina : 100;
  return (
    <div className="kflHud">
      <div className="kflHudTop">
        <div className="kflScoreBox">
          <span className="kflTeamTag" style={{ background: home.kit.shirt, color: home.kit.number }}>
            {home.abbr}
          </span>
          <strong>{hud.score[0]} – {hud.score[1]}</strong>
          <span className="kflTeamTag" style={{ background: away.kit.shirt, color: away.kit.number }}>
            {away.abbr}
          </span>
        </div>
        <div className="kflClock">
          <span>{String(hud.minute).padStart(2, "0")}'</span>
          <em>{hud.half === 1 ? "1st half" : hud.half === 2 ? "2nd half" : hud.half === 3 ? "ET 1" : "ET 2"}</em>
        </div>
        <div className="kflHudButtons">
          {canFullscreen && (
            <button
              type="button"
              className="kflIconBtn"
              onClick={onFullscreen}
              aria-label={fullscreen ? "Exit full screen" : "Full screen"}
            >
              {fullscreen ? "⤡" : "⤢"}
            </button>
          )}
          <button type="button" className="kflIconBtn" onClick={onSubs} aria-label="Substitutions">⇄</button>
          <button type="button" className="kflIconBtn" onClick={onPause} aria-label="Pause">II</button>
        </div>
      </div>

      <div className="kflHudPlayer">
        {c && (
          <>
            <span className="kflHudNum">{c.number}</span>
            <span className="kflHudName">{c.name}</span>
            <span className="kflHudRole">{c.role}</span>
            <span className={`kflStamina ${stamina < 35 ? "is-low" : ""}`}>
              <i style={{ width: `${stamina}%` }} />
            </span>
            {c.yellow > 0 && <span className="kflCardChip kflCardChip--y" title="Booked" />}
          </>
        )}
      </div>

      {hud.banner && (
        <div className={`kflBanner kflBanner--${hud.banner.kind}`}>
          {hud.banner.kind === "card" && (
            <>
              <span className={`kflCardBig ${hud.banner.colour === "red" ? "is-red" : "is-yellow"}`} />
              {hud.banner.colour === "red" ? "Red card" : "Yellow card"} · {hud.banner.player.name}
            </>
          )}
          {hud.banner.kind === "sub" && (
            <>
              <span className="kflSubArrows">⇄</span>
              <span className="kflSubOff">▼ {hud.banner.off.name}</span>
              <span className="kflSubOn">▲ {hud.banner.on.name}</span>
            </>
          )}
          {hud.banner.kind === "ref" && (
            <>{hud.banner.text} · {hud.banner.sub}</>
          )}
          {hud.banner.kind === "restart" && (
            <>
              {({
                throw: "Throw in", corner: "Corner", goalkick: "Goal kick",
                freekick: "Free kick", penalty: "Penalty",
              })[hud.banner.type] || "Restart"}
              {hud.banner.ready ? " — press PASS or SHOOT to take it" : ""}
            </>
          )}
        </div>
      )}
    </div>
  );
});

/* ------------------------------ touch pad ------------------------------- */

function TouchControls({ inputRef, onShootStart, onShootEnd, hasBall }) {
  const stickRef = useRef(null);
  const knobRef = useRef(null);
  const pointer = useRef(null);

  const start = (e) => {
    const el = stickRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width < 8) return; // hidden pad: never divide by a zero radius
    el.setPointerCapture?.(e.pointerId);
    pointer.current = { id: e.pointerId, cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2, r: rect.width / 2 };
    move(e);
  };

  const move = (e) => {
    const p = pointer.current;
    if (!p || e.pointerId !== p.id) return;
    const dx = (e.clientX - p.cx) / p.r;
    const dy = (e.clientY - p.cy) / p.r;
    const mag = Math.hypot(dx, dy);
    if (!Number.isFinite(mag)) return;
    const k = mag > 1 ? 1 / mag : 1;
    inputRef.current.mx = dx * k;
    inputRef.current.my = dy * k;
    if (knobRef.current) {
      knobRef.current.style.transform = `translate(${dx * k * 34}px, ${dy * k * 34}px)`;
    }
  };

  const end = (e) => {
    const p = pointer.current;
    if (!p || e.pointerId !== p.id) return;
    pointer.current = null;
    inputRef.current.mx = 0;
    inputRef.current.my = 0;
    if (knobRef.current) knobRef.current.style.transform = "translate(0px, 0px)";
  };

  const tap = (key) => ({
    onPointerDown: (e) => {
      e.preventDefault();
      if (key === "sprint") inputRef.current.sprint = true;
      else inputRef.current[key] = true;
    },
    onPointerUp: () => {
      if (key === "sprint") inputRef.current.sprint = false;
    },
    onPointerLeave: () => {
      if (key === "sprint") inputRef.current.sprint = false;
    },
  });

  return (
    <div className="kflTouch">
      <div
        className="kflStick"
        ref={stickRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <span className="kflStickKnob" ref={knobRef} />
      </div>

      <div className="kflPadRight">
        <button type="button" className="kflPad kflPad--through" {...tap("through")}>THRU</button>
        <button type="button" className="kflPad kflPad--pass" {...tap("pass")}>PASS</button>
        <button
          type="button"
          className="kflPad kflPad--shoot"
          onPointerDown={(e) => { e.preventDefault(); onShootStart(); }}
          onPointerUp={onShootEnd}
          onPointerCancel={onShootEnd}
        >
          SHOOT
        </button>
        <button type="button" className="kflPad kflPad--cross" {...tap("cross")}>CROSS</button>
        <button type="button" className="kflPad kflPad--sprint" {...tap("sprint")}>SPRINT</button>
        <button
          type="button"
          className="kflPad kflPad--tackle"
          onPointerDown={(e) => {
            e.preventDefault();
            if (hasBall) inputRef.current.switchPlayer = true;
            else inputRef.current.tackle = true;
          }}
        >
          {hasBall ? "SWITCH" : "TACKLE"}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------ stats panel ----------------------------- */

function StatsTable({ rows, home, away }) {
  return (
    <div className="kflStats">
      <div className="kflStatsHead">
        <span>{home.abbr}</span>
        <span />
        <span>{away.abbr}</span>
      </div>
      {rows.map((r) => (
        <div className="kflStatRow" key={r.label}>
          <span>{r.home}</span>
          <em>{r.label}</em>
          <span>{r.away}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------- sub menu ------------------------------- */

function SubMenu({ view, onSub, onClose, subsLeft }) {
  const [off, setOff] = useState(null);
  const [msg, setMsg] = useState("");

  return (
    <div className="kflModal">
      <div className="kflModalBox kflSubBox">
        <button type="button" className="kflClose" onClick={onClose} aria-label="Close">×</button>
        <h3>Substitutions</h3>
        <p className="kflHint">{subsLeft} of {MAX_SUBS} remaining · pick a player off, then a player on.</p>
        <div className="kflSubCols">
          <div>
            <h4>On the pitch</h4>
            <div className="kflSubList">
              {view.onPitch.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  className={`kflSubRow ${off === p.id ? "is-selected" : ""}`}
                  onClick={() => setOff(p.id)}
                >
                  <span className="kflSubPos">{p.role}</span>
                  <span className="kflSubName">{shortName(p.name)}</span>
                  <span className={`kflSubStam ${p.stamina < 35 ? "is-low" : ""}`}>
                    <i style={{ width: `${p.stamina}%` }} />
                  </span>
                  <span className="kflSubRate">{p.rating}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <h4>Bench</h4>
            <div className="kflSubList">
              {view.bench.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  className="kflSubRow"
                  disabled={!off || subsLeft <= 0}
                  onClick={() => {
                    const res = onSub(off, p.id);
                    setMsg(res.ok ? `${p.name} is coming on.` : res.reason);
                    setOff(null);
                  }}
                >
                  <span className="kflSubPos">{p.role}</span>
                  <span className="kflSubName">{shortName(p.name)}</span>
                  <span className="kflSubStam"><i style={{ width: `${p.stamina}%` }} /></span>
                  <span className="kflSubRate">{p.rating}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        {msg && <p className="kflSubMsg">{msg}</p>}
      </div>
    </div>
  );
}

/* ------------------------------ help screen ----------------------------- */

const CONTROL_ROWS = [
  ["Move", "W A S D or arrow keys", "Left stick"],
  ["Sprint", "Shift (hold)", "SPRINT (hold)"],
  ["Short pass", "Space", "PASS"],
  ["Through ball", "E", "THRU"],
  ["Cross / long ball", "C", "CROSS"],
  ["Shoot", "F (hold to power up)", "SHOOT (hold)"],
  ["Tackle / switch player", "Q", "TACKLE / SWITCH"],
  ["Switch player", "V", "SWITCH"],
  ["Substitutions", "M", "⇄ button"],
  ["Pause", "Esc or P", "II button"],
];

function HelpPanel({ onClose }) {
  return (
    <div className="kflModal">
      <div className="kflModalBox">
        <button type="button" className="kflClose" onClick={onClose} aria-label="Close">×</button>
        <h3>Controls</h3>
        <div className="kflControlTable">
          <div className="kflControlHead"><span>Action</span><span>Keyboard</span><span>Touch</span></div>
          {CONTROL_ROWS.map((r) => (
            <div className="kflControlRow" key={r[0]}>
              <span>{r[0]}</span><span>{r[1]}</span><span>{r[2]}</span>
            </div>
          ))}
        </div>
        <p className="kflHint">
          Headers happen automatically when you press PASS or SHOOT under a high ball. Set pieces are
          taken by pressing PASS, or SHOOT for a free kick at goal. Tired players slow down — use your
          five substitutions.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------ audio panel ----------------------------- */

function AudioPanel({ speechSupported, muted, onMute, volumes, onVolume, onClose, speechOn, onSpeech }) {
  return (
    <div className="kflModal">
      <div className="kflModalBox">
        <button type="button" className="kflClose" onClick={onClose} aria-label="Close">×</button>
        <h3>Sound</h3>
        <button type="button" className="kflGhost" onClick={onMute}>
          {muted ? "🔇 Unmute all" : "🔊 Mute all"}
        </button>
        <div className="kflSliders">
          {[
            ["master", "Master"],
            ["crowd", "Crowd"],
            ["sfx", "Effects"],
            ["music", "Music"],
            ["commentary", "Commentary"],
          ].map(([bus, label]) => (
            <label key={bus} className="kflSlider">
              <span>{label}</span>
              <input
                type="range"
                min="0"
                max="100"
                value={Math.round((volumes[bus] ?? 0) * 100)}
                onChange={(e) => onVolume(bus, Number(e.target.value) / 100)}
              />
              <em>{Math.round((volumes[bus] ?? 0) * 100)}</em>
            </label>
          ))}
        </div>
        <label className="kflCheck">
          <input type="checkbox" checked={speechOn} onChange={(e) => onSpeech(e.target.checked)} />
          Spoken commentary {speechSupported ? "" : "(not supported in this browser)"}
        </label>
      </div>
    </div>
  );
}

/* ================================= game ================================== */

export default function KianimationFootball() {
  const [screen, setScreen] = useState("setup");
  const [homeId, setHomeId] = useState(DEFAULT_HOME);
  const [awayId, setAwayId] = useState(DEFAULT_AWAY);
  const [difficulty, setDifficulty] = useState("normal");
  const [halfSeconds, setHalfSeconds] = useState(180);
  const [knockout, setKnockout] = useState(false);
  const [userSide, setUserSide] = useState(0);
  const [matchKey, setMatchKey] = useState(0);

  const home = clubById(homeId);
  const away = clubById(awayId);
  const [homeSetup, setHomeSetup] = useState(() => ({ formation: "4-3-3", ...autoLineup(clubById(DEFAULT_HOME).squad, FORMATIONS["4-3-3"]) }));
  const [awaySetup, setAwaySetup] = useState(() => ({ formation: "4-2-3-1", ...autoLineup(clubById(DEFAULT_AWAY).squad, FORMATIONS["4-2-3-1"]) }));

  const [hud, setHud] = useState(null);
  const [overlay, setOverlay] = useState("none");
  const [inspect, setInspect] = useState(null);
  const [muted, setMuted] = useState(false);
  const [volumes, setVolumes] = useState({ master: 0.9, sfx: 0.75, music: 0.35, crowd: 0.5, commentary: 1 });
  const [speechOn, setSpeechOn] = useState(true);
  const [tickerLine, setTickerLine] = useState("");
  const [portrait, setPortrait] = useState(() => matches("(orientation: portrait)"));
  const [touchDevice, setTouchDevice] = useState(() => matches("(hover: none) and (pointer: coarse)"));
  const [fullscreen, setFullscreen] = useState(false);
  const [rotateDismissed, setRotateDismissed] = useState(false);
  const [speechSupported] = useState(() => typeof window !== "undefined" && "speechSynthesis" in window);
  const [canFullscreen] = useState(fullscreenSupported);

  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const worldRef = useRef(null);
  const rendererRef = useRef(null);
  const audioRef = useRef(null);
  const commentaryRef = useRef(null);
  const inputRef = useRef(makeInput());
  const pausedRef = useRef(false);
  const chargeRef = useRef(null);
  const keysRef = useRef({});

  const paused = overlay !== "none"
    || (hud ? ["halftime", "fulltime", "etBreak"].includes(hud.phase) : false);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  /* A phone or tablet held sideways (or any fullscreen session) gets the
     immersive layout: the pitch fills the screen and the pads sit in the
     margins either side of it. */
  const inMatch = screen === "match";
  const immersive = inMatch && (fullscreen || (touchDevice && !portrait));
  const showRotateNotice = inMatch && touchDevice && portrait && !fullscreen;

  /* --------------------- orientation and fullscreen --------------------- */

  useEffect(() => {
    const orientationQuery = window.matchMedia("(orientation: portrait)");
    const touchQuery = window.matchMedia("(hover: none) and (pointer: coarse)");
    const syncTouch = () => setTouchDevice(touchQuery.matches);
    const syncOrientation = () => {
      setPortrait(orientationQuery.matches);
      /* re-read the pointer type too: some browsers only settle it once
         the device has finished rotating */
      syncTouch();
    };

    syncOrientation();
    syncTouch();
    listen(orientationQuery, syncOrientation);
    listen(touchQuery, syncTouch);
    /* Belt and braces: not every browser fires the media query change on a
       rotation, but they all fire resize, and some versions of iOS only
       report the new orientation a beat after the event. */
    const late = () => {
      syncOrientation();
      setTimeout(syncOrientation, 150);
    };
    window.addEventListener("orientationchange", late);
    window.addEventListener("resize", syncOrientation);
    window.visualViewport?.addEventListener("resize", syncOrientation);

    return () => {
      unlisten(orientationQuery, syncOrientation);
      unlisten(touchQuery, syncTouch);
      window.removeEventListener("orientationchange", late);
      window.removeEventListener("resize", syncOrientation);
      window.visualViewport?.removeEventListener("resize", syncOrientation);
    };
  }, []);

  useEffect(() => {
    const sync = () => setFullscreen(!!fullscreenElement());
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, []);

  /* Switching between the inline and immersive layouts resizes the canvas
     box without necessarily resizing the window, so re-measure it. */
  useEffect(() => {
    const id = requestAnimationFrame(() => rendererRef.current?.resize());
    return () => cancelAnimationFrame(id);
  }, [immersive, fullscreen]);

  /* stop the page behind the game from scrolling while it fills the screen */
  useEffect(() => {
    if (!immersive) return undefined;
    document.body.classList.add("kflLockScroll");
    return () => document.body.classList.remove("kflLockScroll");
  }, [immersive]);

  const toggleFullscreen = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    /* Safari on iPhone refuses element fullscreen outright — the landscape
       layout is the fallback there, so a refusal is not an error. */
    const request = fullscreenElement()
      ? (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)
      : (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
    if (request && typeof request.catch === "function") request.catch(() => {});
  }, []);

  /* ------------------------------ setup flow ---------------------------- */

  const pickClub = (side, id) => {
    if (side === "home") {
      setHomeId(id);
      setHomeSetup({ formation: homeSetup.formation, ...autoLineup(clubById(id).squad, FORMATIONS[homeSetup.formation]) });
      if (id === awayId) {
        const other = CLUBS.find((c) => c.id !== id);
        setAwayId(other.id);
        setAwaySetup({ formation: awaySetup.formation, ...autoLineup(other.squad, FORMATIONS[awaySetup.formation]) });
      }
    } else {
      setAwayId(id);
      setAwaySetup({ formation: awaySetup.formation, ...autoLineup(clubById(id).squad, FORMATIONS[awaySetup.formation]) });
      if (id === homeId) {
        const other = CLUBS.find((c) => c.id !== id);
        setHomeId(other.id);
        setHomeSetup({ formation: homeSetup.formation, ...autoLineup(other.squad, FORMATIONS[homeSetup.formation]) });
      }
    }
  };

  const kickOff = useCallback(() => {
    /* audio must be created inside the tap that starts the match */
    if (!audioRef.current) audioRef.current = createFootballAudio();
    const audio = audioRef.current;
    audio.unlock();
    Object.entries(volumes).forEach(([bus, v]) => audio.setVolume(bus, v));
    audio.setMuted(muted);
    audio.startCrowd();
    audio.play("whistleShort");

    const config = quickMatchConfig({
      home: homeId,
      away: awayId,
      homeSetup,
      awaySetup,
      userTeam: userSide,
      halfSeconds,
      difficulty,
      knockout,
      seed: Math.floor(Math.random() * 100000),
    });
    const world = makeMatch(config);
    worldRef.current = world;
    commentaryRef.current = createCommentator({
      audio: speechOn ? audio : { ...audio, speak: () => false },
      teamNames: [home.short, away.short],
      onLine: (text) => setTickerLine(text),
    });
    setHud({
      ...hudSnapshot(world),
      squad: squadView(world, world.userTeam),
      stats: statLines(world),
      ballWithUser: false,
      userTakesPenalty: false,
    });
    setOverlay("none");
    setRotateDismissed(false);
    setMatchKey((k) => k + 1);
    setScreen("match");
  }, [homeId, awayId, homeSetup, awaySetup, userSide, halfSeconds, difficulty, knockout, volumes, muted, speechOn, home.short, away.short]);

  /* ------------------------------ game loop ----------------------------- */

  useEffect(() => {
    if (screen !== "match") return undefined;
    const canvas = canvasRef.current;
    const world = worldRef.current;
    if (!canvas || !world) return undefined;

    const renderer = createRenderer(canvas);
    rendererRef.current = renderer;
    let raf = 0;
    let last = performance.now();
    let hudAcc = 0;
    let excitementAcc = 0;

    const onResize = () => renderer.resize();
    onResize();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    /* the stage also changes size when the page around it reflows, so
       watch the canvas itself rather than only the window */
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
    observer?.observe(canvas);

    const loop = (ts) => {
      raf = requestAnimationFrame(loop);
      const dtMs = Math.min(64, ts - last);
      last = ts;
      const dt = dtMs / 1000;

      if (!pausedRef.current) {
        stepMatch(world, dtMs, inputRef.current);
        const commentator = commentaryRef.current;
        commentator?.tick(dt);
        const events = drainEvents(world);
        for (let i = 0; i < events.length; i += 1) commentator?.handle(events[i], world);

        excitementAcc += dt;
        if (excitementAcc > 0.4) {
          excitementAcc = 0;
          const b = world.ball;
          const nearGoal = Math.min(b.x, 105 - b.x);
          const heat = Math.max(0, 1 - nearGoal / 34);
          audioRef.current?.setExcitement(0.2 + heat * 0.8);
        }
      }

      renderer.draw(world, dt);

      hudAcc += dtMs;
      if (hudAcc > 120) {
        hudAcc = 0;
        setHud({
          ...hudSnapshot(world),
          squad: squadView(world, world.userTeam),
          stats: statLines(world),
          ballWithUser: world.ball.owner ? world.ball.owner.team === world.userTeam : false,
          userTakesPenalty: world.shootout ? world.teams[world.shootout.turn].isUser : false,
        });
      }
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, [screen, matchKey]);

  const releaseShot = useCallback(() => {
    const startedAt = chargeRef.current;
    chargeRef.current = null;
    const held = startedAt ? performance.now() - startedAt : 0;
    inputRef.current.shootPower = Math.max(0.28, Math.min(1, held / 750));
    inputRef.current.shoot = true;
  }, []);

  /* ------------------------------- keyboard ----------------------------- */

  useEffect(() => {
    if (screen !== "match") return undefined;

    const setVector = () => {
      const k = keysRef.current;
      inputRef.current.mx = (k.right ? 1 : 0) - (k.left ? 1 : 0);
      inputRef.current.my = (k.down ? 1 : 0) - (k.up ? 1 : 0);
    };

    const down = (e) => {
      if (e.repeat) return;
      const action = KEY_MAP[e.code];
      if (e.code === "Escape" || e.code === "KeyP") {
        setOverlay((o) => (o === "none" ? "pause" : "none"));
        return;
      }
      if (e.code === "KeyM") {
        setOverlay((o) => (o === "subs" ? "none" : "subs"));
        return;
      }
      if (!action) return;
      e.preventDefault();
      if (["up", "down", "left", "right"].includes(action)) {
        keysRef.current[action] = true;
        setVector();
      } else if (action === "sprint") {
        inputRef.current.sprint = true;
      } else if (action === "shoot") {
        if (chargeRef.current == null) chargeRef.current = performance.now();
      } else if (action === "tackle") {
        const world = worldRef.current;
        const owner = world?.ball.owner;
        if (owner && owner.team === world.userTeam) inputRef.current.switchPlayer = true;
        else inputRef.current.tackle = true;
      } else if (action === "switch") {
        inputRef.current.switchPlayer = true;
      } else {
        inputRef.current[action] = true;
      }
    };

    const up = (e) => {
      const action = KEY_MAP[e.code];
      if (!action) return;
      if (["up", "down", "left", "right"].includes(action)) {
        keysRef.current[action] = false;
        setVector();
      } else if (action === "sprint") {
        inputRef.current.sprint = false;
      } else if (action === "shoot") {
        releaseShot();
      }
    };

    const blur = () => {
      keysRef.current = {};
      inputRef.current.mx = 0;
      inputRef.current.my = 0;
      inputRef.current.sprint = false;
    };

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [screen, releaseShot]);

  /* --------------------------- audio housekeeping ------------------------ */

  useEffect(() => () => {
    audioRef.current?.dispose();
    audioRef.current = null;
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    Object.entries(volumes).forEach(([bus, v]) => audio.setVolume(bus, v));
  }, [volumes]);

  useEffect(() => {
    audioRef.current?.setMuted(muted);
  }, [muted]);

  useEffect(() => {
    if (paused) audioRef.current?.cancelSpeech();
  }, [paused]);

  /* ------------------------------- actions ------------------------------ */

  const doSub = (offId, onId) => {
    const world = worldRef.current;
    if (!world) return { ok: false, reason: "No match" };
    const res = requestSub(world, world.userTeam, offId, onId);
    setHud((prev) => ({ ...prev, ...hudSnapshot(world), squad: squadView(world, world.userTeam) }));
    return res;
  };

  const continueMatch = () => {
    const world = worldRef.current;
    if (!world) return;
    startNextPeriod(world);
    audioRef.current?.play("whistleShort");
    setHud((prev) => ({ ...prev, ...hudSnapshot(world) }));
  };

  const quitToSetup = () => {
    audioRef.current?.stopCrowd();
    audioRef.current?.cancelSpeech();
    if (fullscreenElement()) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
    setOverlay("none");
    setScreen("setup");
  };

  /* -------------------------------- screens ----------------------------- */

  if (screen === "setup") {
    return (
      <div className="kfl kfl--menu">
        <header className="kflMenuHead">
          <div>
            <p className="kflEyebrow">Kianimation Football League</p>
            <h3>Quick Match</h3>
          </div>
          <span className="kflBadge">11 v 11</span>
        </header>

        {touchDevice && portrait && (
          <p className="kflRotateInline">
            <span aria-hidden="true">⟳</span>
            Rotate your phone for the best gameplay — sideways, the pitch fills the screen.
          </p>
        )}

        <div className="kflModes">
          {MODES.map((m) => (
            <div key={m.id} className={`kflModeCard ${m.available ? "is-live" : ""}`}>
              <strong>{m.name}</strong>
              <span>{m.blurb}</span>
              <em>{m.available ? "Play now" : "Coming soon"}</em>
            </div>
          ))}
        </div>

        <div className="kflPickRow">
          <div className="kflPickCol">
            <h4>Home</h4>
            <div className="kflClubList">
              {CLUBS.map((c) => (
                <ClubButton key={c.id} club={c} active={c.id === homeId} onClick={() => pickClub("home", c.id)} />
              ))}
            </div>
          </div>
          <div className="kflPickCol">
            <h4>Away</h4>
            <div className="kflClubList">
              {CLUBS.map((c) => (
                <ClubButton key={c.id} club={c} active={c.id === awayId} onClick={() => pickClub("away", c.id)} />
              ))}
            </div>
          </div>
        </div>

        <div className="kflOptions">
          <div className="kflOptGroup">
            <span>You play as</span>
            <div className="kflToggle">
              <button type="button" className={userSide === 0 ? "is-on" : ""} onClick={() => setUserSide(0)}>{home.abbr}</button>
              <button type="button" className={userSide === 1 ? "is-on" : ""} onClick={() => setUserSide(1)}>{away.abbr}</button>
            </div>
          </div>
          <div className="kflOptGroup">
            <span>Difficulty</span>
            <div className="kflToggle">
              {DIFFICULTIES.map((d) => (
                <button key={d.id} type="button" className={difficulty === d.id ? "is-on" : ""} onClick={() => setDifficulty(d.id)}>
                  {d.label}
                </button>
              ))}
            </div>
          </div>
          <div className="kflOptGroup">
            <span>Match length</span>
            <div className="kflToggle">
              {HALF_LENGTHS.map((h) => (
                <button key={h.id} type="button" className={halfSeconds === h.id ? "is-on" : ""} onClick={() => setHalfSeconds(h.id)}>
                  {h.label}
                </button>
              ))}
            </div>
          </div>
          <div className="kflOptGroup">
            <span>Knockout rules</span>
            <div className="kflToggle">
              <button type="button" className={!knockout ? "is-on" : ""} onClick={() => setKnockout(false)}>Draw allowed</button>
              <button type="button" className={knockout ? "is-on" : ""} onClick={() => setKnockout(true)}>ET + penalties</button>
            </div>
          </div>
        </div>

        <div className="kflMenuActions">
          <button type="button" className="kflPrimary" onClick={() => setScreen("squad")}>
            Team sheet <span aria-hidden="true">→</span>
          </button>
          <button type="button" className="kflGhost" onClick={() => setOverlay("help")}>Controls</button>
        </div>

        {overlay === "help" && <HelpPanel onClose={() => setOverlay("none")} />}
      </div>
    );
  }

  if (screen === "squad") {
    const club = userSide === 0 ? home : away;
    const setup = userSide === 0 ? homeSetup : awaySetup;
    const onChange = userSide === 0 ? setHomeSetup : setAwaySetup;
    return (
      <div className="kfl kfl--squad">
        <header className="kflMenuHead">
          <div>
            <p className="kflEyebrow">{home.name} v {away.name}</p>
            <h3>Your team sheet — {club.name}</h3>
          </div>
          <button type="button" className="kflGhost kflGhost--sm" onClick={() => setScreen("setup")}>← Back</button>
        </header>

        {touchDevice && portrait && (
          <p className="kflRotateInline">
            <span aria-hidden="true">⟳</span>
            Pick your team here, then rotate your phone for the best gameplay.
          </p>
        )}

        <SquadEditor
          club={club}
          setup={setup}
          onChange={onChange}
          onInspect={(p, role) => setInspect({ player: p, role })}
          side={`Opponent: ${(userSide === 0 ? away : home).name} — ${(userSide === 0 ? awaySetup : homeSetup).formation}`}
        />

        <div className="kflMenuActions">
          <button type="button" className="kflPrimary" onClick={kickOff}>Kick off</button>
          <button type="button" className="kflGhost" onClick={() => setOverlay("help")}>Controls</button>
        </div>

        {overlay === "help" && <HelpPanel onClose={() => setOverlay("none")} />}
        {inspect && <PlayerCard player={inspect.player} slotRole={inspect.role} onClose={() => setInspect(null)} />}
      </div>
    );
  }

  /* -------------------------------- match ------------------------------- */

  const view = hud?.squad ?? null;
  const rows = hud?.stats ?? [];
  const ballWithUser = hud?.ballWithUser ?? false;

  return (
    <div
      ref={rootRef}
      className={`kfl kfl--match${immersive ? " is-immersive" : ""}${portrait ? " is-portrait" : ""}`}
    >
      <div className="kflStage">
        <canvas ref={canvasRef} className="kflCanvas" />

        {hud && (
          <MatchHud
            hud={hud}
            home={home}
            away={away}
            onPause={() => setOverlay("pause")}
            onSubs={() => setOverlay("subs")}
            onFullscreen={toggleFullscreen}
            fullscreen={fullscreen}
            canFullscreen={canFullscreen}
          />
        )}

        {tickerLine && <div className="kflTicker" key={tickerLine}>{tickerLine}</div>}

        {hud?.shootout && hud.phase === "shootout" && (
          <div className="kflShootout">
            <strong>Penalty shootout</strong>
            <div className="kflShootRow">
              <span>{home.abbr}</span>
              {hud.shootout.kicks[0].map((k, i) => <i key={i} className={k ? "is-scored" : "is-missed"} />)}
              <b>{hud.shootout.scores[0]}</b>
            </div>
            <div className="kflShootRow">
              <span>{away.abbr}</span>
              {hud.shootout.kicks[1].map((k, i) => <i key={i} className={k ? "is-scored" : "is-missed"} />)}
              <b>{hud.shootout.scores[1]}</b>
            </div>
            {hud.shootout.state === "aim" && hud.userTakesPenalty && (
              <em>Aim with the stick, press SHOOT</em>
            )}
          </div>
        )}

        <TouchControls
          inputRef={inputRef}
          hasBall={!!ballWithUser}
          onShootStart={() => { chargeRef.current = performance.now(); }}
          onShootEnd={releaseShot}
        />

        {showRotateNotice && !rotateDismissed && (
          <div className="kflRotateCard" role="status">
            <span className="kflRotateIcon" aria-hidden="true">⟳</span>
            <strong>Rotate your phone for the best gameplay</strong>
            <p>Sideways, the pitch fills the screen with the controls under your thumbs.</p>
            <div className="kflRotateActions">
              <button type="button" className="kflGhost kflGhost--sm" onClick={() => setRotateDismissed(true)}>
                Play in portrait
              </button>
              {canFullscreen && (
                <button type="button" className="kflGhost kflGhost--sm" onClick={toggleFullscreen}>
                  Full screen
                </button>
              )}
            </div>
          </div>
        )}
        {showRotateNotice && rotateDismissed && (
          <button
            type="button"
            className="kflRotate"
            onClick={() => setRotateDismissed(false)}
          >
            <span aria-hidden="true">⟳</span> Rotate your phone for the best gameplay
          </button>
        )}
      </div>

      {overlay === "pause" && (
        <div className="kflModal">
          <div className="kflModalBox">
            <h3>Paused</h3>
            <div className="kflPauseGrid">
              <button type="button" className="kflPrimary" onClick={() => setOverlay("none")}>Resume</button>
              <button type="button" className="kflGhost" onClick={() => setOverlay("subs")}>Substitutions</button>
              <button type="button" className="kflGhost" onClick={() => setOverlay("stats")}>Match stats</button>
              <button type="button" className="kflGhost" onClick={() => setOverlay("audio")}>Sound</button>
              {canFullscreen && (
                <button type="button" className="kflGhost" onClick={toggleFullscreen}>
                  {fullscreen ? "Exit full screen" : "Full screen"}
                </button>
              )}
              <button type="button" className="kflGhost" onClick={() => setOverlay("help")}>Controls</button>
              <button type="button" className="kflGhost" onClick={quitToSetup}>Quit match</button>
            </div>
          </div>
        </div>
      )}

      {overlay === "subs" && view && (
        <SubMenu
          view={view}
          subsLeft={view.subsLeft}
          onSub={doSub}
          onClose={() => setOverlay("none")}
        />
      )}

      {overlay === "stats" && (
        <div className="kflModal">
          <div className="kflModalBox">
            <button type="button" className="kflClose" onClick={() => setOverlay("none")} aria-label="Close">×</button>
            <h3>Match statistics</h3>
            <StatsTable rows={rows} home={home} away={away} />
          </div>
        </div>
      )}

      {overlay === "audio" && (
        <AudioPanel
          speechSupported={speechSupported}
          muted={muted}
          onMute={() => setMuted((m) => !m)}
          volumes={volumes}
          onVolume={(bus, v) => setVolumes((prev) => ({ ...prev, [bus]: v }))}
          speechOn={speechOn}
          onSpeech={(on) => {
            setSpeechOn(on);
            if (!on) audioRef.current?.cancelSpeech();
            const audio = audioRef.current;
            if (audio) {
              commentaryRef.current = createCommentator({
                audio: on ? audio : { ...audio, speak: () => false },
                teamNames: [home.short, away.short],
                onLine: (text) => setTickerLine(text),
              });
            }
          }}
          onClose={() => setOverlay("none")}
        />
      )}

      {overlay === "help" && <HelpPanel onClose={() => setOverlay("none")} />}

      {hud && (hud.phase === "halftime" || hud.phase === "etBreak") && (
        <div className="kflModal kflModal--break">
          <div className="kflModalBox">
            <p className="kflEyebrow">{hud.phase === "halftime" ? "Half time" : "End of period"}</p>
            <h3>{home.abbr} {hud.score[0]} – {hud.score[1]} {away.abbr}</h3>
            <StatsTable rows={rows} home={home} away={away} />
            <div className="kflPauseGrid">
              <button type="button" className="kflPrimary" onClick={continueMatch}>
                {hud.phase === "halftime" ? "Start second half" : "Play extra time"}
              </button>
              <button type="button" className="kflGhost" onClick={() => setOverlay("subs")}>Substitutions</button>
            </div>
          </div>
        </div>
      )}

      {hud && hud.phase === "fulltime" && (
        <div className="kflModal kflModal--break">
          <div className="kflModalBox">
            <p className="kflEyebrow">Full time</p>
            <h3>{home.abbr} {hud.score[0]} – {hud.score[1]} {away.abbr}</h3>
            {hud.result?.onPenalties && (
              <p className="kflHint">
                {(hud.result.winner === 0 ? home : away).name} win {hud.result.shootout[0]}–{hud.result.shootout[1]} on penalties.
              </p>
            )}
            {!hud.result?.onPenalties && (
              <p className="kflHint">
                {hud.result?.winner === null
                  ? "Honours even."
                  : `${(hud.result?.winner === 0 ? home : away).name} take the win.`}
              </p>
            )}
            <StatsTable rows={rows} home={home} away={away} />
            <div className="kflPauseGrid">
              <button type="button" className="kflPrimary" onClick={kickOff}>Play again</button>
              <button type="button" className="kflGhost" onClick={quitToSetup}>Change teams</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
