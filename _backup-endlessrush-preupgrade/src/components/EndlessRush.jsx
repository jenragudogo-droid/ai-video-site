import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRenderer } from "./endlessRush/render.js";
import {
  makeGame, resetGame, startRun, stepGame, drainEvents, summarise,
  moveLane, jump, slide,
} from "./endlessRush/engine.js";
import {
  placeCamera, resetCamera, drawSky, drawWorld, currentAtmosphere,
} from "./endlessRush/scene.js";
import { createRunner } from "./endlessRush/runner.js";
import { createCharacter } from "./endlessRush/character.js";
import { drawHud } from "./endlessRush/hud.js";
import { createRushAudio } from "./endlessRush/audio.js";
import { readSave, recordRun, saveSettings } from "./endlessRush/save.js";
import { START_SPEED, TOP_SPEED } from "./endlessRush/track.js";
import "./EndlessRush.css";

/* ------------------------------------------------------------------ *
 * Kianimation Endless Rush — the React shell.
 *
 * React owns the menus, the pause card and the results card. It does not
 * own the game: the simulation and every pixel of the running frame live
 * on a canvas driven by one requestAnimationFrame loop, because a score
 * that changes sixty times a second has no business in component state.
 * The two only meet at the four screen transitions.
 * ------------------------------------------------------------------ */

const MAX_SUB = 1 / 90;      // simulation never steps further than this
const MAX_SUBSTEPS = 8;

const KEYS = [
  ["← / A", "Move left"],
  ["→ / D", "Move right"],
  ["↑ / W / Space", "Jump"],
  ["↓ / S", "Slide  ·  dive in mid-air"],
  ["P / Esc", "Pause"],
  ["M", "Mute"],
];

const TOUCH = [
  ["Swipe ←", "Move left"],
  ["Swipe →", "Move right"],
  ["Swipe ↑ or tap", "Jump"],
  ["Swipe ↓", "Slide"],
];

const POWER_BLURB = [
  ["🧲", "Coin magnet", "Drags every nearby coin into your lane."],
  ["🛡", "Shield", "Soaks up one serious hit, then breaks."],
  ["×2", "Double score", "Distance and coins both count twice."],
  ["⚡", "Speed surge", "You run faster and smash straight through."],
];

const DEATH_LINE = {
  barrier: "A road barrier caught you. Jump those.",
  crate: "You ran into a crate. Change lanes early.",
  sign: "That sign was too low — slide under it.",
  gap: "The road gave way. Jump the broken sections.",
  vehicle: "A parked vehicle. Nothing to do but go around.",
  zone: "Straight into the roadworks.",
};

export default function EndlessRush() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const gameRef = useRef(null);
  const runnerRef = useRef(null);
  const audioRef = useRef(null);
  const screenRef = useRef("intro");
  const bestRef = useRef(0);
  const qualityRef = useRef(1);
  const lastRef = useRef(0);
  const tickRef = useRef({ fpsAcc: 0, fpsN: 0, fps: 0, zone: "", zoneAge: 9 });
  const swipeRef = useRef(null);
  const profileHintRef = useRef(true);

  const [screen, setScreen] = useState("intro");   // intro | playing | paused | over
  const [profile, setProfile] = useState(() => readSave());
  const [results, setResults] = useState(null);
  const [showHelp, setShowHelp] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [coarse, setCoarse] = useState(
    () => typeof window !== "undefined"
      && !!window.matchMedia
      && window.matchMedia("(pointer: coarse)").matches,
  );

  const muted = profile.settings.muted;
  const music = profile.settings.music;

  useEffect(() => { screenRef.current = screen; }, [screen]);
  useEffect(() => { bestRef.current = profile.highScore; }, [profile.highScore]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia("(pointer: coarse)");
    const onChange = (e) => setCoarse(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  /* ------------------------------ canvas ------------------------------ */

  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const r = rendererRef.current;
    if (!canvas || !wrap || !r) return;
    const rect = wrap.getBoundingClientRect();
    const raw = window.devicePixelRatio || 1;
    /* Phones lie about how much fill rate they have. Capping the buffer
       is worth more than any other single optimisation here. */
    const cap = coarse ? 1.5 : 2;
    const dpr = Math.min(raw, cap);
    const w = Math.max(300, Math.floor(rect.width));
    const h = Math.max(220, Math.floor(rect.height));
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    r.setSize(w, h);
    runnerRef.current?.driver?.setSize?.(w, h, dpr);
  }, [coarse]);

  useEffect(() => {
    rendererRef.current = createRenderer();
    gameRef.current = makeGame({ seed: (Math.random() * 0x7fffffff) | 0 });
    runnerRef.current = createRunner();
    resetCamera();
    resize();

    /* A handle for the dev server only, so the game can be driven and
       inspected from the console while tuning. Stripped from builds. */
    if (import.meta.env?.DEV && typeof window !== "undefined") {
      window.__rush = { game: gameRef, renderer: rendererRef, quality: qualityRef, tick: tickRef };
    }

    const ro = new ResizeObserver(resize);
    if (wrapRef.current) ro.observe(wrapRef.current);
    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", resize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("orientationchange", resize);
      runnerRef.current?.dispose();
      runnerRef.current = null;
    };
  }, [resize]);

  /* Optional glTF character. Silently does nothing when there is no
     public/models/runner.glb, which is the shipped state. */
  useEffect(() => {
    const runner = runnerRef.current;
    if (!runner) return undefined;
    const ch = createCharacter({
      onReady: () => resize(),
      onError: () => { /* the procedural runner is the intended default */ },
    });
    runner.setDriver(ch);
    return () => { runner.setDriver(null); ch.dispose(); };
  }, [resize]);

  useEffect(() => {
    audioRef.current = createRushAudio();
    return () => { audioRef.current?.dispose(); audioRef.current = null; };
  }, []);

  useEffect(() => {
    audioRef.current?.setMuted(muted);
    if (!muted && music && screenRef.current === "playing") audioRef.current?.startMusic();
  }, [muted, music]);

  useEffect(() => { audioRef.current?.setMusic(music); }, [music]);

  /* ------------------------------- events ------------------------------- */

  const finishRun = useCallback(() => {
    const s = gameRef.current;
    if (!s) return;
    const run = summarise(s);
    const { profile: next, isRecord } = recordRun(readSave(), run);
    setProfile(next);
    setResults({ ...run, isRecord, previousBest: bestRef.current });
    setScreen("over");
    audioRef.current?.stopMusic();
    if (isRecord) setTimeout(() => audioRef.current?.play("record"), 900);
  }, []);

  const handleEvents = useCallback(() => {
    const s = gameRef.current;
    const a = audioRef.current;
    const events = drainEvents(s);
    for (const e of events) {
      switch (e.type) {
        case "jump": a?.play("jump"); break;
        case "land": a?.play("land"); break;
        case "slide": a?.play("slide"); break;
        case "dive": a?.play("dive"); break;
        case "coin": a?.play("coin"); break;
        case "lane": a?.play("lane"); break;
        case "power": a?.play("power"); break;
        case "powerEnd": a?.play("powerEnd"); break;
        case "shieldBreak": a?.play("shieldBreak"); break;
        case "smash": a?.play("smash"); break;
        case "bump": a?.play("bump"); break;
        case "crash": a?.play("crash"); break;
        case "gameover":
          a?.play("gameover");
          finishRun();
          break;
        default: break;
      }
    }
  }, [finishRun]);

  /* -------------------------------- loop -------------------------------- */

  const frame = useCallback((now) => {
    const s = gameRef.current;
    const r = rendererRef.current;
    const canvas = canvasRef.current;
    const runner = runnerRef.current;
    if (!s || !r || !canvas || !runner) return;

    const last = lastRef.current || now;
    let dt = (now - last) / 1000;
    lastRef.current = now;
    if (dt > 0.25) dt = 0.25;
    if (dt <= 0) dt = 1 / 60;

    const scr = screenRef.current;
    const live = scr === "playing";

    if (live) {
      /* Sub-stepping is not cosmetic. At 27 m/s a runner covers most of a
         thin barrier inside a single 30fps frame, so the simulation is
         capped to short steps and the collision test is swept on top. */
      const n = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(dt / MAX_SUB)));
      const h = dt / n;
      for (let i = 0; i < n && s.phase === "running"; i += 1) stepGame(s, null, h);
      handleEvents();
      audioRef.current?.setIntensity((s.speed - START_SPEED) / (TOP_SPEED - START_SPEED));
    } else if (scr === "intro" || scr === "over") {
      // attract mode: the runner keeps his legs moving behind the card
      s.runPhase += dt * 9;
      s.t += dt;
    }

    const ctx = canvas.getContext("2d");
    const W = r.width, H = r.height;

    placeCamera(r, s, dt, W / H);

    const tk = tickRef.current;
    const atmos = currentAtmosphere(s.z + 30);
    drawSky(ctx, W, H, atmos, r.cam.z, qualityRef.current, r.horizonY());
    drawWorld(r, s, qualityRef.current, dt, s.t);
    runner.draw(r, s, atmos.light, dt, s.t);
    r.flush(ctx);

    /* zone toast, driven off the blended biome name */
    if (atmos.name !== tk.zone) {
      tk.zone = atmos.name;
      tk.zoneAge = 0;
    } else {
      tk.zoneAge += dt;
    }

    if (live || scr === "paused") {
      tk.fpsAcc += dt;
      tk.fpsN += 1;
      if (tk.fpsAcc > 0.5) {
        tk.fps = Math.round(tk.fpsN / tk.fpsAcc);
        tk.fpsAcc = 0;
        tk.fpsN = 0;
        /* Adaptive horizon. A struggling phone pulls the fog in rather
           than dropping frames; a fast machine gets the long view back
           within a couple of seconds. */
        const q = qualityRef.current;
        if (tk.fps < 30) qualityRef.current = Math.max(0.58, q - 0.07);
        else if (tk.fps > 52) qualityRef.current = Math.min(1, q + 0.04);
      }
      drawHud(ctx, s, W, H, {
        best: bestRef.current,
        toast: tk.zone,
        toastAge: tk.zoneAge,
        quickBarHeight: 42,
        hint: s.dist < 55 && profileHintRef.current
          ? (coarse ? "Swipe to move · swipe up to jump · swipe down to slide"
            : "Arrows or W A S D  ·  Space to jump")
          : null,
        hintAlpha: 1 - Math.max(0, (s.dist - 34) / 21),
      });
    }

    if (scr === "paused") {
      ctx.save();
      ctx.fillStyle = "rgba(5,7,12,0.55)";
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }, [handleEvents, coarse]);

  useEffect(() => { profileHintRef.current = profile.settings.hints; }, [profile.settings.hints]);

  useEffect(() => {
    let raf = 0;
    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      frame(now);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [frame]);

  /* ------------------------------ controls ------------------------------ */

  const begin = useCallback(() => {
    const s = gameRef.current;
    if (!s) return;
    resetGame(s);
    resetCamera();
    lastRef.current = 0;
    tickRef.current.zone = "";
    tickRef.current.zoneAge = 9;
    setResults(null);
    startRun(s);
    setScreen("playing");
    const a = audioRef.current;
    a?.unlock();
    a?.play("start");
    if (!muted && music) a?.startMusic();
  }, [muted, music]);

  const togglePause = useCallback(() => {
    setScreen((cur) => {
      if (cur === "playing") { audioRef.current?.stopMusic(); return "paused"; }
      if (cur === "paused") {
        lastRef.current = 0;
        const a = audioRef.current;
        a?.unlock();
        if (!muted && music) a?.startMusic();
        return "playing";
      }
      return cur;
    });
  }, [muted, music]);

  const setMuted = useCallback((v) => {
    setProfile((p) => saveSettings(p, { muted: v }));
  }, []);

  const setMusic = useCallback((v) => {
    setProfile((p) => saveSettings(p, { music: v }));
  }, []);

  const setHints = useCallback((v) => {
    setProfile((p) => saveSettings(p, { hints: v }));
  }, []);

  const quitToMenu = useCallback(() => {
    audioRef.current?.stopMusic();
    const s = gameRef.current;
    if (s) { resetGame(s); resetCamera(); }
    setScreen("intro");
  }, []);

  /* keyboard */
  useEffect(() => {
    const down = (e) => {
      const scr = screenRef.current;
      const s = gameRef.current;
      const k = e.key.toLowerCase();

      if (k === "m") { setMuted(!muted); return; }
      if (k === "p" || k === "escape") {
        if (scr === "playing" || scr === "paused") { e.preventDefault(); togglePause(); }
        return;
      }
      if (scr !== "playing" || !s) {
        if ((k === " " || k === "enter") && (scr === "intro" || scr === "over")) {
          e.preventDefault();
          begin();
        }
        return;
      }

      let used = true;
      switch (k) {
        case "arrowleft": case "a": moveLane(s, -1); break;
        case "arrowright": case "d": moveLane(s, 1); break;
        case "arrowup": case "w": case " ": jump(s); break;
        case "arrowdown": case "s": slide(s); break;
        default: used = false;
      }
      if (used) e.preventDefault();
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [begin, togglePause, setMuted, muted]);

  /* swipes — one gesture layer over the canvas while a run is live */
  const SWIPE_MIN = 24;
  const TAP_MAX = 16;
  const TAP_MS = 260;

  const onPointerDown = useCallback((e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    swipeRef.current = { x: e.clientX, y: e.clientY, t: performance.now(), fired: false };
    audioRef.current?.unlock();
  }, []);

  const onPointerMove = useCallback((e) => {
    const g = swipeRef.current;
    const s = gameRef.current;
    if (!g || g.fired || !s) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (Math.abs(dx) < SWIPE_MIN && Math.abs(dy) < SWIPE_MIN) return;
    g.fired = true;
    if (Math.abs(dx) > Math.abs(dy)) moveLane(s, dx > 0 ? 1 : -1);
    else if (dy < 0) jump(s);
    else slide(s);
  }, []);

  const onPointerUp = useCallback((e) => {
    const g = swipeRef.current;
    const s = gameRef.current;
    swipeRef.current = null;
    if (!g || g.fired || !s) return;
    const dx = Math.abs(e.clientX - g.x);
    const dy = Math.abs(e.clientY - g.y);
    // a plain tap is a jump: the most-wanted action, always one touch away
    if (dx < TAP_MAX && dy < TAP_MAX && performance.now() - g.t < TAP_MS) jump(s);
  }, []);

  /* auto-pause whenever the game leaves the screen */
  useEffect(() => {
    const away = () => {
      if (screenRef.current === "playing") {
        audioRef.current?.stopMusic();
        setScreen("paused");
      }
    };
    const vis = () => { if (document.visibilityState === "hidden") away(); };
    window.addEventListener("blur", away);
    window.addEventListener("pagehide", away);
    document.addEventListener("visibilitychange", vis);
    return () => {
      window.removeEventListener("blur", away);
      window.removeEventListener("pagehide", away);
      document.removeEventListener("visibilitychange", vis);
    };
  }, []);

  /* fullscreen — a real win on a phone, where the address bar eats the sky */
  const toggleFullscreen = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else el.requestFullscreen?.().catch(() => {});
  }, []);

  useEffect(() => {
    const onFs = () => { setFullscreen(!!document.fullscreenElement); setTimeout(resize, 60); };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, [resize]);

  /* -------------------------------- view -------------------------------- */

  const controlList = useMemo(() => (coarse ? TOUCH : KEYS), [coarse]);
  const live = screen === "playing";

  return (
    <div
      className={`krush ${live ? "is-live" : ""} ${fullscreen ? "is-full" : ""}`}
      ref={wrapRef}
    >
      <canvas ref={canvasRef} className="krushCanvas" />

      {live && (
        <div
          className="krushGestures"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onContextMenu={(e) => e.preventDefault()}
        />
      )}

      {(live || screen === "paused") && (
        <div className="krushQuick">
          <button
            type="button"
            onClick={() => setMuted(!muted)}
            aria-label={muted ? "Unmute" : "Mute"}
            title="Sound (M)"
          >
            {muted ? "🔇" : "🔊"}
          </button>
          <button type="button" onClick={toggleFullscreen} aria-label="Fullscreen" title="Fullscreen">
            {fullscreen ? "⤡" : "⤢"}
          </button>
          <button type="button" onClick={togglePause} aria-label="Pause" title="Pause (P)">
            {live ? "❚❚" : "▶"}
          </button>
        </div>
      )}

      {screen === "intro" && (
        <div className="krushOverlay">
          <div className="krushCard">
            <p className="krushEyebrow">Game 04 · Endless runner</p>
            <h3>Kianimation<br />Endless Rush</h3>
            <p className="krushLead">
              Sprint through downtown, the market district, the greenbelt, a
              mountain pass and the night city — one unbroken run that never
              stops getting faster. Dodge, jump, slide, grab everything gold.
            </p>

            <div className="krushStats">
              <div><strong>{profile.highScore.toLocaleString()}</strong><span>High score</span></div>
              <div><strong>{profile.bestDistance.toLocaleString()} m</strong><span>Best distance</span></div>
              <div><strong>{profile.totalCoins.toLocaleString()}</strong><span>Coins collected</span></div>
            </div>

            <div className="krushActions">
              <button type="button" className="krushPrimary" onClick={begin}>Start running</button>
              <button type="button" className="krushGhost" onClick={() => setShowHelp((v) => !v)}>
                {showHelp ? "Hide controls" : "Controls"}
              </button>
            </div>

            {showHelp && (
              <>
                <ul className="krushKeys">
                  {controlList.map(([k, label]) => (
                    <li key={k}><kbd>{k}</kbd><span>{label}</span></li>
                  ))}
                </ul>
                <ul className="krushPowers">
                  {POWER_BLURB.map(([icon, name, blurb]) => (
                    <li key={name}>
                      <b aria-hidden="true">{icon}</b>
                      <div><strong>{name}</strong><span>{blurb}</span></div>
                    </li>
                  ))}
                </ul>
                <div className="krushToggles">
                  <label>
                    <input type="checkbox" checked={!muted} onChange={(e) => setMuted(!e.target.checked)} />
                    <span>Sound effects</span>
                  </label>
                  <label>
                    <input type="checkbox" checked={music} onChange={(e) => setMusic(e.target.checked)} />
                    <span>Music</span>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={profile.settings.hints}
                      onChange={(e) => setHints(e.target.checked)}
                    />
                    <span>On-screen control hint</span>
                  </label>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {screen === "paused" && (
        <div className="krushOverlay">
          <div className="krushCard krushCard--slim">
            <p className="krushEyebrow">Paused</p>
            <h3>Catch your breath</h3>
            <div className="krushActions">
              <button type="button" className="krushPrimary" onClick={togglePause}>Resume</button>
              <button type="button" className="krushGhost" onClick={begin}>Restart</button>
              <button type="button" className="krushGhost" onClick={quitToMenu}>Quit run</button>
            </div>
            <ul className="krushKeys krushKeys--compact">
              {controlList.map(([k, label]) => (
                <li key={k}><kbd>{k}</kbd><span>{label}</span></li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {screen === "over" && results && (
        <div className="krushOverlay">
          <div className="krushCard">
            <p className="krushEyebrow">
              {results.isRecord ? "New personal best" : "Run over"}
            </p>
            <h3>{results.isRecord ? "That is your best yet" : "Nice run"}</h3>
            {results.cause && DEATH_LINE[results.cause] && (
              <p className="krushCause">{DEATH_LINE[results.cause]}</p>
            )}

            <div className="krushScore">
              <span>Final score</span>
              <strong>{results.score.toLocaleString()}</strong>
            </div>

            <ul className="krushTally">
              <li><span>Distance</span><b>{results.distance.toLocaleString()} m</b></li>
              <li><span>Coins collected</span><b>{results.coins.toLocaleString()}</b></li>
              <li><span>Top speed</span><b>{results.topSpeed} km/h</b></li>
              <li><span>High score</span><b>{profile.highScore.toLocaleString()}</b></li>
              <li><span>Power-ups used</span><b>{results.stats.powerups}</b></li>
              <li><span>Time on your feet</span><b>{Math.floor(results.time / 60)}m {Math.round(results.time % 60)}s</b></li>
            </ul>

            <div className="krushActions">
              <button type="button" className="krushPrimary" onClick={begin}>Play again</button>
              <button type="button" className="krushGhost" onClick={quitToMenu}>Back to menu</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
