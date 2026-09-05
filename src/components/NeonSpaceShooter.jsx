import { useCallback, useEffect, useRef, useState } from "react";
import {
  makeGame, resetGame, startRun, stepGame, drainEvents, summarise,
  setViewport, dragShip, releaseDrag, dash, fireSpecial,
  SPECIAL_MAX, DASH_CD,
} from "./neonSpaceShooter/engine.js";
import { createRenderer } from "./neonSpaceShooter/render.js";
import { createShooterAudio } from "./neonSpaceShooter/audio.js";
import { readSave, recordRun, saveSettings } from "./neonSpaceShooter/save.js";
import "./NeonSpaceShooter.css";
import { fullscreenElement, onFullscreenChange, toggleGameFullscreen, unlockPageScroll } from "./fullscreen.js";

/* ------------------------------------------------------------------ *
 * Neon Space Shooter — the React shell.
 *
 * Same split as Endless Rush: React owns the menus and the results
 * card, the game itself lives on a canvas driven by one
 * requestAnimationFrame loop. The simulation (engine.js) never touches
 * the DOM, the renderer never mutates the simulation, and this file is
 * the only place the two meet.
 * ------------------------------------------------------------------ */

const MAX_SUB = 1 / 60;
const MAX_SUBSTEPS = 6;

const KEYS = [
  ["← → / A D", "Move"],
  ["Auto", "Fire — just fly"],
  ["Space", "Dash"],
  ["X", "Special attack"],
  ["P / Esc", "Pause"],
  ["M", "Mute"],
];

const TOUCH = [
  ["Drag", "Move your ship"],
  ["Auto", "Fire — just fly"],
  ["DASH", "Quick burst + brief protection"],
  ["SPECIAL", "Full meter unleashes a blast"],
];

export default function NeonSpaceShooter() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const gameRef = useRef(null);
  const audioRef = useRef(null);
  const screenRef = useRef("intro");
  const bestRef = useRef(0);
  const lastRef = useRef(0);
  const dragRef = useRef(null);
  const bankedRef = useRef(true);
  const viewRef = useRef({ w: 480, h: 800 });
  const dashBtnRef = useRef(null);
  const specialBtnRef = useRef(null);

  const [screen, setScreen] = useState("intro");
  const [profile, setProfile] = useState(() => readSave());
  const [results, setResults] = useState(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [pseudoFull, setPseudoFull] = useState(false);
  const [coarse, setCoarse] = useState(
    () => typeof window !== "undefined"
      && !!window.matchMedia
      && window.matchMedia("(pointer: coarse)").matches,
  );

  const muted = profile.settings.muted;

  useEffect(() => { screenRef.current = screen; }, [screen]);
  useEffect(() => { bestRef.current = profile.best; }, [profile.best]);

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
    if (!canvas || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    const raw = window.devicePixelRatio || 1;
    const dpr = Math.min(raw, coarse ? 1.75 : 2);
    const w = Math.max(300, Math.floor(rect.width));
    const h = Math.max(220, Math.floor(rect.height));
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
    viewRef.current = { w, h };
    const s = gameRef.current;
    if (s) setViewport(s, w, h);
  }, [coarse]);

  useEffect(() => {
    rendererRef.current = createRenderer();
    gameRef.current = makeGame({ seed: (Math.random() * 0x7fffffff) | 0 });
    resize();
    const s = gameRef.current;
    s.ship.x = s.W / 2;

    if (import.meta.env?.DEV && typeof window !== "undefined") {
      window.__shooter = { game: gameRef, renderer: rendererRef, view: viewRef };
    }

    const ro = new ResizeObserver(resize);
    if (wrapRef.current) ro.observe(wrapRef.current);
    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", resize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("orientationchange", resize);
    };
  }, [resize]);

  useEffect(() => {
    audioRef.current = createShooterAudio();
    return () => { audioRef.current?.dispose(); audioRef.current = null; };
  }, []);

  useEffect(() => { audioRef.current?.setMuted(muted); }, [muted]);

  /* ------------------------------- events ------------------------------- */

  const bankRun = useCallback(() => {
    const s = gameRef.current;
    if (!s || bankedRef.current) return null;
    bankedRef.current = true;
    const run = summarise(s);
    const { save: next, isRecord } = recordRun(readSave(), run);
    setProfile(next);
    return { run, isRecord };
  }, []);

  const finishRun = useCallback(() => {
    const s = gameRef.current;
    if (!s) return;
    const banked = bankRun();
    const run = banked ? banked.run : summarise(s);
    const isRecord = banked ? banked.isRecord : false;
    setResults({ ...run, isRecord, previousBest: bestRef.current });
    setScreen("over");
    if (isRecord) setTimeout(() => audioRef.current?.play("record"), 900);
  }, [bankRun]);

  const handleEvents = useCallback(() => {
    const s = gameRef.current;
    const a = audioRef.current;
    const r = rendererRef.current;
    for (const e of drainEvents(s)) {
      r?.onEvent(e);
      switch (e.type) {
        case "shoot": a?.play("shoot"); break;
        case "missile": a?.play("missile"); break;
        case "spark": a?.play("spark"); break;
        case "explode": a?.play(e.a.big ? "bigBoom" : "boom"); break;
        case "crystal": a?.play("crystal"); break;
        case "hit": a?.play("hit"); break;
        case "shieldHit": a?.play("shieldHit"); break;
        case "shieldBreak": a?.play("shieldBreak"); break;
        case "dash": a?.play("dash"); break;
        case "special": a?.play("special"); break;
        case "specialReady": a?.play("specialReady"); break;
        case "nearMiss": a?.play("nearMiss"); break;
        case "comboReward": a?.play("comboReward"); break;
        case "bossPhase": a?.play("bossPhase"); break;
        case "coreOpen": a?.play("coreOpen"); break;
        case "podDown": a?.play("podDown"); break;
        case "power":
          a?.play(e.a === "repair" ? "repair" : e.a === "invuln" ? "invuln" : e.a === "slow" ? "slow" : "power");
          break;
        case "upgrade": a?.play("upgrade"); break;
        case "wave": if (e.a > 1) a?.play("wave"); break;
        case "bossWarn": a?.play("bossWarn"); break;
        case "beamWarn": a?.play("beamWarn"); break;
        case "beamFire": a?.play("beamFire"); break;
        case "bossDown": a?.play("bossDown"); break;
        case "gameover": a?.play("gameover"); finishRun(); break;
        default: break;
      }
    }
  }, [finishRun]);

  /* -------------------------------- loop -------------------------------- */

  const frame = useCallback((now) => {
    const s = gameRef.current;
    const r = rendererRef.current;
    const canvas = canvasRef.current;
    if (!s || !r || !canvas) return;

    const last = lastRef.current || now;
    let dt = (now - last) / 1000;
    lastRef.current = now;
    if (dt > 0.25) dt = 0.25;
    if (dt <= 0) dt = 1 / 60;

    const scr = screenRef.current;
    const paused = scr === "paused";
    const fdt = paused ? 0 : dt;

    if (scr === "playing") {
      const n = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(dt / MAX_SUB)));
      const h = dt / n;
      for (let i = 0; i < n && s.phase === "playing"; i += 1) stepGame(s, h);
      handleEvents();
    }

    const ctx = canvas.getContext("2d");
    const { w, h } = viewRef.current;
    r.draw(ctx, s, w, h, fdt, {
      best: bestRef.current,
      showHud: scr === "playing" || scr === "paused" || scr === "over",
      coarse,
    });

    /* The touch buttons live in the DOM, so their cooldown ring and the
       ready pulse are poked directly — no React re-render at 60fps. */
    const db = dashBtnRef.current;
    if (db) db.style.setProperty("--cd", String(Math.min(1, 1 - Math.max(0, s.dashCd) / DASH_CD)));
    const sb = specialBtnRef.current;
    if (sb) sb.classList.toggle("is-ready", s.special >= SPECIAL_MAX && s.specialT <= 0);

    if (paused) {
      ctx.save();
      ctx.fillStyle = "rgba(4,6,12,0.55)";
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }, [handleEvents, coarse]);

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
    const { w, h } = viewRef.current;
    setViewport(s, w, h);
    s.ship.x = s.W / 2;
    rendererRef.current?.reset();
    lastRef.current = 0;
    setResults(null);
    startRun(s);
    handleEvents();          // the WAVE 1 banner should show immediately
    bankedRef.current = false;
    setScreen("playing");
    const a = audioRef.current;
    a?.unlock();
    a?.play("power");
  }, [handleEvents]);

  const pauseGame = useCallback(() => {
    setScreen((cur) => (cur === "playing" ? "paused" : cur));
  }, []);

  const resumeGame = useCallback(() => {
    setScreen((cur) => {
      if (cur !== "paused") return cur;
      lastRef.current = 0;
      audioRef.current?.unlock();
      return "playing";
    });
  }, []);

  const togglePause = useCallback(() => {
    if (screenRef.current === "playing") pauseGame();
    else if (screenRef.current === "paused") resumeGame();
  }, [pauseGame, resumeGame]);

  const setMuted = useCallback((v) => setProfile((p) => saveSettings(p, { muted: v })), []);

  const quitToMenu = useCallback(() => {
    bankRun();
    const s = gameRef.current;
    if (s) resetGame(s);
    rendererRef.current?.reset();
    setScreen("intro");
  }, [bankRun]);

  /* keyboard */
  useEffect(() => {
    const setKey = (key, downOrUp) => {
      const s = gameRef.current;
      if (!s) return false;
      if (key === "arrowleft" || key === "a") { s.input.left = downOrUp; return true; }
      if (key === "arrowright" || key === "d") { s.input.right = downOrUp; return true; }
      return false;
    };
    const down = (e) => {
      const scr = screenRef.current;
      const k = e.key.toLowerCase();
      if (k === "m") { setMuted(!readSave().settings.muted); return; }
      if (k === "p" || k === "escape") {
        if (scr === "playing" || scr === "paused") { e.preventDefault(); togglePause(); }
        return;
      }
      if (scr !== "playing") {
        if ((k === " " || k === "enter") && (scr === "intro" || scr === "over")) {
          e.preventDefault();
          begin();
        }
        return;
      }
      /* Fire is automatic, which frees Space for the dash; X (or E)
         triggers the special once the meter is full. */
      const s = gameRef.current;
      if (k === " ") { e.preventDefault(); if (s) dash(s); return; }
      if (k === "x" || k === "e") { e.preventDefault(); if (s) fireSpecial(s); return; }
      if (setKey(k, true)) e.preventDefault();
    };
    const up = (e) => { setKey(e.key.toLowerCase(), false); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [begin, togglePause, setMuted]);

  /* touch / pointer drag: relative, so the finger never has to sit on
     the ship — thumb at the bottom corner works fine */
  const onPointerDown = useCallback((e) => {
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* fine */ }
    dragRef.current = { id: e.pointerId, x: e.clientX };
    audioRef.current?.unlock();
  }, []);

  const onPointerMove = useCallback((e) => {
    const g = dragRef.current;
    const s = gameRef.current;
    if (!g || g.id !== e.pointerId || !s) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    /* CSS pixels → logical field pixels, then a light 1.15 boost so a
       full-width thumb sweep always crosses the whole field */
    const scale = rect && rect.height > 0 ? 800 / rect.height : 1.6;
    dragShip(s, (e.clientX - g.x) * scale * 1.15);
    g.x = e.clientX;
  }, []);

  const onPointerUp = useCallback((e) => {
    if (dragRef.current?.id === e.pointerId) {
      dragRef.current = null;
      const s = gameRef.current;
      if (s) releaseDrag(s);
    }
  }, []);

  /* The corner buttons must not read as drags: stop the event before
     the gesture layer sees it. */
  const onDashTouch = useCallback((e) => {
    e.stopPropagation();
    e.preventDefault();
    const s = gameRef.current;
    if (s) dash(s);
    audioRef.current?.unlock();
  }, []);

  const onSpecialTouch = useCallback((e) => {
    e.stopPropagation();
    e.preventDefault();
    const s = gameRef.current;
    if (s) fireSpecial(s);
    audioRef.current?.unlock();
  }, []);

  useEffect(() => () => { bankRun(); }, [bankRun]);

  /* auto-pause whenever the game leaves the screen */
  useEffect(() => {
    const away = () => pauseGame();
    const vis = () => { if (document.visibilityState === "hidden") away(); };
    window.addEventListener("blur", away);
    window.addEventListener("pagehide", away);
    document.addEventListener("visibilitychange", vis);
    return () => {
      window.removeEventListener("blur", away);
      window.removeEventListener("pagehide", away);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [pauseGame]);

  /* Real fullscreen where the browser has it (standard or WebKit-prefixed);
     otherwise a pinned pseudo-fullscreen with page scrolling locked. */
  const toggleFullscreen = useCallback(() => {
    toggleGameFullscreen(wrapRef.current, { real: !!fullscreenElement(), pseudo: pseudoFull }, (st) => {
      setPseudoFull(st.pseudo);
      setTimeout(resize, 60); setTimeout(resize, 400);
    });
  }, [pseudoFull, resize]);

  useEffect(() => {
    const onFs = () => { setFullscreen(!!fullscreenElement()); setTimeout(resize, 60); setTimeout(resize, 400); };
    return onFullscreenChange(onFs);
  }, [resize]);
  useEffect(() => () => { if (pseudoFull) unlockPageScroll(); }, [pseudoFull]);

  /* -------------------------------- view -------------------------------- */

  const live = screen === "playing";
  const controlList = coarse ? TOUCH : KEYS;

  return (
    <div
      className={`nshoot ${live ? "is-live" : ""} ${fullscreen || pseudoFull ? "is-full" : ""} ${pseudoFull ? "is-pseudo" : ""}`}
      ref={wrapRef}
    >
      <canvas ref={canvasRef} className="nshootCanvas" />

      {live && (
        <div
          className="nshootGestures"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onContextMenu={(e) => e.preventDefault()}
        />
      )}

      {live && coarse && (
        <>
          <button
            type="button"
            ref={specialBtnRef}
            className="nshootActionBtn nshootActionBtn--special"
            onPointerDown={onSpecialTouch}
            onContextMenu={(e) => e.preventDefault()}
            aria-label="Special attack"
          >
            SPECIAL
          </button>
          <button
            type="button"
            ref={dashBtnRef}
            className="nshootActionBtn nshootActionBtn--dash"
            onPointerDown={onDashTouch}
            onContextMenu={(e) => e.preventDefault()}
            aria-label="Dash"
          >
            DASH
          </button>
        </>
      )}

      <div className="nshootQuick">
        {(live || screen === "paused") && (
          <>
          <button type="button" onClick={() => setMuted(!muted)} aria-label={muted ? "Unmute" : "Mute"} title="Sound (M)">
            {muted ? "🔇" : "🔊"}
          </button>
          </>
        )}
        <button type="button" onClick={toggleFullscreen} aria-label={fullscreen || pseudoFull ? "Exit fullscreen" : "Fullscreen"} title={fullscreen || pseudoFull ? "Exit fullscreen" : "Fullscreen"}>
          {fullscreen || pseudoFull ? "⤡" : "⤢"}
        </button>
        {(live || screen === "paused") && (
          <button type="button" onClick={togglePause} aria-label="Pause" title="Pause (P)">
            {live ? "❚❚" : "▶"}
          </button>
        )}
      </div>

      {screen === "intro" && (
        <div className="nshootOverlay">
          <div className="nshootCard">
            <p className="nshootEyebrow">Kianimation Arcade</p>
            <h3 className="nshootTitle">
              NEON SPACE <em>SHOOTER</em>
            </h3>
            <p className="nshootLead">
              Blast through waves of neon enemies, upgrade your weapons,
              collect energy crystals and take down the boss dreadnoughts.
            </p>
            <div className="nshootHow">
              {controlList.map(([k, what]) => (
                <div key={k}><span>{k}</span>{what}</div>
              ))}
            </div>
            <div className="nshootStats">
              <div><strong>{profile.best.toLocaleString()}</strong><span>Best score</span></div>
              <div><strong>{profile.crystals.toLocaleString()}</strong><span>Crystals banked</span></div>
            </div>
            <button type="button" className="nshootMain" onClick={begin}>
              START GAME
            </button>
            <p className="nshootHint">{coarse ? "DRAG TO MOVE · AUTO FIRE · DASH + SPECIAL BUTTONS" : "ARROWS TO MOVE · AUTO FIRE · SPACE DASH · X SPECIAL"}</p>
          </div>
        </div>
      )}

      {screen === "paused" && (
        <div className="nshootOverlay nshootOverlay--thin">
          <div className="nshootCard nshootCard--slim">
            <h3>Paused</h3>
            <div className="nshootRow">
              <button type="button" className="nshootMain" onClick={resumeGame}>RESUME</button>
              <button type="button" className="nshootGhost" onClick={quitToMenu}>QUIT</button>
            </div>
          </div>
        </div>
      )}

      {screen === "over" && results && (
        <div className="nshootOverlay">
          <div className="nshootCard nshootCard--slim">
            <p className="nshootEyebrow">{results.isRecord ? "NEW BEST SCORE!" : "Game over"}</p>
            <h3>GAME OVER</h3>
            <div className="nshootScore">{results.score.toLocaleString()}</div>
            <div className="nshootStats nshootStats--over">
              <div><strong>{Math.max(results.score, profile.best).toLocaleString()}</strong><span>Best</span></div>
              <div><strong>{results.crystals}</strong><span>Crystals</span></div>
              <div><strong>{results.wave}</strong><span>Wave</span></div>
              <div><strong>x{results.bestCombo}</strong><span>Top combo</span></div>
            </div>
            <div className="nshootRow">
              <button type="button" className="nshootMain" onClick={begin}>RETRY</button>
              <button type="button" className="nshootGhost" onClick={quitToMenu}>MENU</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
