import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRenderer } from "./endlessRush/render.js";
import {
  makeGame, resetGame, startRun, stepGame, drainEvents, summarise,
  moveLane, jump, slide, attack,
  POWER_LABEL, POWER_ICON, POWER_COLOUR,
} from "./endlessRush/engine.js";
import {
  placeCamera, resetCamera, drawSky, drawWorld, currentAtmosphere, setDebugHitboxes,
} from "./endlessRush/scene.js";
import { createRunner, resetPoseBlend } from "./endlessRush/runner.js";
import { drawHud } from "./endlessRush/hud.js";
import { createRushAudio } from "./endlessRush/audio.js";
import {
  readSave, recordRun, saveSettings, buyCharacter, selectCharacter,
} from "./endlessRush/save.js";
import { START_SPEED, TOP_SPEED } from "./endlessRush/track.js";
import { CHARACTERS, characterById, CHARACTER_MODELS } from "./endlessRush/characters.js";
import { loadMeshes } from "./endlessRush/models.js";
import "./EndlessRush.css";

/* ------------------------------------------------------------------ *
 * Kianimation Endless Rush — the React shell.
 *
 * React owns the menus, the shop, the pause card and the results card.
 * It does not own the game: the simulation and every pixel of a running
 * frame live on a canvas driven by one requestAnimationFrame loop,
 * because a score that changes sixty times a second has no business in
 * component state. The two only meet at the screen transitions.
 * ------------------------------------------------------------------ */

const MAX_SUB = 1 / 90;
const MAX_SUBSTEPS = 8;

/* `A` is the attack key, so movement lives on the arrows rather than on
   WASD — half a WASD cluster is worse than none. Jump and slide keep
   their letters, because those do not collide with anything. */
const KEYS = [
  ["← / →", "Change lane"],
  ["↑ / W / Space", "Jump"],
  ["↓ / S", "Slide  ·  dive in mid-air"],
  ["A / F", "Attack"],
  ["P / Esc", "Pause"],
  ["M", "Mute"],
];

const TOUCH = [
  ["Swipe ← →", "Change lane"],
  ["Swipe ↑ or tap", "Jump"],
  ["Swipe ↓", "Slide"],
  ["FIGHT button", "Attack"],
];

const POWER_BLURB = [
  ["magnet", "Drags every nearby coin into your lane."],
  ["shield", "Soaks up one serious hit, then breaks."],
  ["double", "Distance and coins both count twice."],
  ["boost", "You run faster and smash straight through."],
  ["superJump", "A far bigger jump, for as long as it lasts."],
  ["jetpack", "Fly. Rooftops, sky coins, and a safe landing."],
];

const DEATH_LINE = {
  barrier: "A road barrier caught you. Jump those.",
  crate: "A stack of crates. Change lanes early.",
  sign: "That sign was too low — slide under it.",
  pipe: "A services duct across the road. Slide.",
  worksArch: "Straight into the roadworks gantry — that one is a slide.",
  gap: "The road gave way. Jump the broken sections.",
  vehicle: "A parked vehicle. Nothing to do but go around.",
  hoarding: "A site hoarding, solid to the ground. Go around it.",
  parkedSuv: "A parked SUV. Around, never over.",
  vent: "A rooftop vent. The decks have obstacles of their own.",
  tank: "A water tank on the roof.",
  aircon: "Rooftop plant. Watch the deck as well as the road.",
  enemy: "They got to you. Swing at them, or take another lane.",
};

export default function EndlessRush() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const previewRef = useRef(null);
  const rendererRef = useRef(null);
  const previewRendererRef = useRef(null);
  const gameRef = useRef(null);
  const runnerRef = useRef(null);
  const previewRunnerRef = useRef(null);
  const audioRef = useRef(null);
  const screenRef = useRef("intro");
  const bestRef = useRef(0);
  const qualityRef = useRef(1);
  const lastRef = useRef(0);
  const tickRef = useRef({ fpsAcc: 0, fpsN: 0, fps: 0, zone: "", zoneAge: 9 });
  const swipeRef = useRef(null);
  const profileHintRef = useRef(true);
  /* Has the run currently in `gameRef` already had its coins added to the
     profile? There are four ways out of a run — dying, quitting from the
     pause card, closing the game card, and starting a fresh one — and the
     coins have to be banked on every one of them, exactly once. Starts
     true because there is no run to bank before the first one begins. */
  const bankedRef = useRef(true);
  const previewCharRef = useRef(CHARACTERS[0].id);

  const [screen, setScreen] = useState("intro");
  const [profile, setProfile] = useState(() => readSave());
  const [results, setResults] = useState(null);
  const [showHelp, setShowHelp] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [shopFocus, setShopFocus] = useState(() => readSave().selected);
  const [shopMsg, setShopMsg] = useState("");
  const [coarse, setCoarse] = useState(
    () => typeof window !== "undefined"
      && !!window.matchMedia
      && window.matchMedia("(pointer: coarse)").matches,
  );

  const muted = profile.settings.muted;
  const music = profile.settings.music;
  const selected = profile.selected;

  useEffect(() => { screenRef.current = screen; }, [screen]);
  useEffect(() => { bestRef.current = profile.highScore; }, [profile.highScore]);
  useEffect(() => { previewCharRef.current = shopFocus; }, [shopFocus]);

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
  }, [coarse]);

  useEffect(() => {
    rendererRef.current = createRenderer();
    gameRef.current = makeGame({
      seed: (Math.random() * 0x7fffffff) | 0,
      character: readSave().selected,
    });
    runnerRef.current = createRunner();
    previewRunnerRef.current = createRunner();
    /* Characters and cars are a few kilobytes each, so they are all
       pulled up front: the shop preview and the first run then never
       show a placeholder. */
    loadMeshes([...new Set([...CHARACTER_MODELS, "suv", "car"])]);
    resetCamera();
    resize();

    if (import.meta.env?.DEV && typeof window !== "undefined") {
      window.__rush = {
        game: gameRef, renderer: rendererRef, quality: qualityRef, tick: tickRef,
        hitboxes: setDebugHitboxes,
      };
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

  useEffect(() => {
    audioRef.current = createRushAudio();
    return () => { audioRef.current?.dispose(); audioRef.current = null; };
  }, []);

  useEffect(() => {
    audioRef.current?.setMuted(muted);
    if (!muted && music && screenRef.current === "playing") audioRef.current?.startMusic();
  }, [muted, music]);

  useEffect(() => { audioRef.current?.setMusic(music); }, [music]);
  useEffect(() => { profileHintRef.current = profile.settings.hints; }, [profile.settings.hints]);

  /* ------------------------------- events ------------------------------- */

  /**
   * Folds the current run into the saved profile, once.
   *
   * `s.coins` is the current run's tally and nothing else; the permanent
   * balance lives in the profile, in localStorage. This is the only place
   * the one is added to the other, so every exit from a run can call it
   * without any of them needing to know what the others did. Reads the
   * profile back off disk rather than trusting React state, so two exits
   * racing in the same tick cannot write a stale total.
   *
   * Returns null when there was nothing to bank.
   */
  const bankRun = useCallback(() => {
    const s = gameRef.current;
    if (!s || bankedRef.current) return null;
    bankedRef.current = true;
    const run = summarise(s);
    const { profile: next, isRecord } = recordRun(readSave(), run);
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
    audioRef.current?.stopMusic();
    if (isRecord) setTimeout(() => audioRef.current?.play("record"), 900);
  }, [bankRun]);

  const handleEvents = useCallback(() => {
    const s = gameRef.current;
    const a = audioRef.current;
    for (const e of drainEvents(s)) {
      switch (e.type) {
        case "jump": a?.play("jump"); break;
        case "superJump": a?.play("superJump"); break;
        case "land": a?.play("land"); break;
        case "hardLand": a?.play("hardLand"); break;
        case "roofDrop": a?.play("dive"); break;
        case "slide": case "duck": a?.play("slide"); break;
        case "dive": a?.play("dive"); break;
        case "coin": a?.play("coin"); break;
        case "lane": a?.play("lane"); break;
        case "power": a?.play(e.a === "jetpack" ? "jetpack" : "power"); break;
        case "powerEnd": a?.play("powerEnd"); break;
        case "shieldBreak": a?.play("shieldBreak"); break;
        case "smash": a?.play("smash"); break;
        case "bump": a?.play("bump"); break;
        case "attack": a?.play("attack"); break;
        case "enemySpot": a?.play("enemySpot"); break;
        case "enemyDown": a?.play(e.a >= 3 ? "comboFinish" : "enemyDown"); break;
        case "crash": a?.play("crash"); break;
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
    const runner = runnerRef.current;
    if (!s || !r || !canvas || !runner) return;

    const last = lastRef.current || now;
    let dt = (now - last) / 1000;
    lastRef.current = now;
    if (dt > 0.25) dt = 0.25;
    if (dt <= 0) dt = 1 / 60;

    const scr = screenRef.current;
    const live = scr === "playing";
    const paused = scr === "paused";

    /* A paused frame advances nothing. Every smoothing term in the game
       is written as `x += (want - x) * dt * k`; feed those a real dt
       while the simulation is stopped and the world keeps drifting into
       place under a stationary runner, which is the crawl you see behind
       a pause card. Zero makes a paused frame reproduce the previous one
       exactly, with no special-casing anywhere downstream. */
    const fdt = paused ? 0 : dt;

    if (live) {
      /* Sub-stepping is not cosmetic. At 33 m/s a runner covers most of a
         thin barrier inside a single 30fps frame. */
      const n = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(dt / MAX_SUB)));
      const h = dt / n;
      for (let i = 0; i < n && s.phase === "running"; i += 1) stepGame(s, null, h);
      handleEvents();
      audioRef.current?.setIntensity((s.speed - START_SPEED) / (TOP_SPEED - START_SPEED));
    } else if (scr === "intro" || scr === "over" || scr === "shop") {
      s.runPhase += dt * 9;
      s.t += dt;
    }

    const ctx = canvas.getContext("2d");
    const W = r.width, H = r.height;

    placeCamera(r, s, fdt, W / H);

    const tk = tickRef.current;
    const atmos = currentAtmosphere(s.z + 30);
    r.atmos = atmos;
    drawSky(ctx, W, H, atmos, r.cam.z, qualityRef.current, r.horizonY());
    drawWorld(r, s, qualityRef.current, fdt, s.t);
    runner.draw(r, s, atmos.light, fdt, s.t);
    r.flush(ctx);

    if (atmos.name !== tk.zone) {
      tk.zone = atmos.name;
      tk.zoneAge = 0;
    } else if (!paused) {
      tk.zoneAge += dt;
    }

    if (live || paused) {
      tk.fpsAcc += fdt;
      tk.fpsN += paused ? 0 : 1;
      if (tk.fpsAcc > 0.5) {
        tk.fps = Math.round(tk.fpsN / tk.fpsAcc);
        tk.fpsAcc = 0;
        tk.fpsN = 0;
        /* Adaptive horizon: a struggling phone pulls the fog in rather
           than dropping frames, and gets the long view back when it can. */
        const q = qualityRef.current;
        if (tk.fps < 30) qualityRef.current = Math.max(0.58, q - 0.07);
        else if (tk.fps > 52) qualityRef.current = Math.min(1, q + 0.04);
      }
      drawHud(ctx, s, W, H, {
        best: bestRef.current,
        toast: tk.zone,
        toastAge: tk.zoneAge,
        quickBarHeight: 42,
        coarse,
        hint: s.dist < 55 && profileHintRef.current
          ? (coarse ? "Swipe to move · up to jump · down to slide · FIGHT to attack"
            : "Arrows to move · Space to jump · S to slide · A to attack")
          : null,
        hintAlpha: 1 - Math.max(0, (s.dist - 34) / 21),
      });
    }

    if (paused) {
      ctx.save();
      ctx.fillStyle = "rgba(5,7,12,0.55)";
      ctx.fillRect(0, 0, W, H);
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

  /* --------------------------- shop preview --------------------------- */

  /* A live turntable of the character, drawn with the same renderer and
     the same rig as the game. Cheap — one 460-triangle body — and it
     means the preview can never disagree with what you actually get. */
  useEffect(() => {
    if (screen !== "shop") return undefined;
    const canvas = previewRef.current;
    if (!canvas) return undefined;
    if (!previewRendererRef.current) previewRendererRef.current = createRenderer();
    const r = previewRendererRef.current;
    const runner = previewRunnerRef.current;
    let raf = 0;
    let prev = 0;

    const fit = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      const c = canvas.getContext("2d");
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      r.setSize(Math.max(1, rect.width), Math.max(1, rect.height));
    };
    fit();

    const pose = makeGame({ seed: 5, character: previewCharRef.current });
    pose.phase = "ready";
    pose.still = true;   // a turntable, not a run: no speed trails

    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - (prev || now)) / 1000);
      prev = now;
      const ch = characterById(previewCharRef.current);
      if (pose.character !== ch.id) { pose.character = ch.id; pose.profile = ch; }
      pose.runPhase += dt * 9.5;
      pose.t += dt;
      pose.speed = 16;
      pose.dist += dt * 16;

      const ctx = canvas.getContext("2d");
      const W = r.width, H = r.height;
      r.setAtmosphere("#1b2130", 60, 160, 170);
      const spin = pose.t * 0.7;
      /* Framed for a standing figure: far enough back that a 1.7 m
         character and whatever they are riding both fit, and aimed at
         chest height rather than at the floor. */
      const dist = 4.0;
      r.cam.x = Math.sin(spin) * dist;
      r.cam.y = 1.55;
      r.cam.z = -Math.cos(spin) * dist;
      /* The camera orbits the origin looking *inwards*. In this renderer
         forward is +z at yaw 0, and the depth of a point works out as
         d·cos(spin + yaw) — so the character is in front of the lens at
         yaw = −spin, and exactly behind it half a turn away. */
      r.cam.yaw = -spin;
      r.cam.pitch = 0.155;
      r.cam.roll = 0;
      r.atmos = { night: 0, light: 1 };

      ctx.clearRect(0, 0, W, H);
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#1b2130");
      g.addColorStop(1, "#0c0f17");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      r.begin();
      r.ground(-1.5, -1.5, 1.5, 1.5, -0.01, "#2b3242", 1, 2);
      /* Lit brighter than the game. The turntable has no sky, no sun and
         no bounce off the road, so the same tint that looks right at noon
         downtown leaves a character reading as a silhouette here. */
      runner.draw(r, pose, 1.5, dt, pose.t);
      r.flush(ctx);
    };
    raf = requestAnimationFrame(tick);
    const ro = new ResizeObserver(fit);
    ro.observe(canvas);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [screen]);

  /* ------------------------------ controls ------------------------------ */

  const begin = useCallback((characterId) => {
    const s = gameRef.current;
    if (!s) return;
    const id = characterId || readSave().selected;
    resetGame(s, undefined, id);
    resetCamera();
    resetPoseBlend();
    lastRef.current = 0;
    tickRef.current.zone = "";
    tickRef.current.zoneAge = 9;
    setResults(null);
    startRun(s);
    bankedRef.current = false;      // this run's coins are now owed
    setScreen("playing");
    const a = audioRef.current;
    a?.unlock();
    a?.play("start");
    if (!muted && music) a?.startMusic();
  }, [muted, music]);

  /* Everything that pauses goes through here: the button, the P key,
     losing focus, the tab being backgrounded. */
  const pauseGame = useCallback(() => {
    setScreen((cur) => {
      if (cur !== "playing") return cur;
      audioRef.current?.stopMusic();
      /* The impact wobble is a transient, and one that survives a pause
         is just a crooked screenshot that snaps straight on resume. */
      const s = gameRef.current;
      if (s) s.shake = 0;
      return "paused";
    });
  }, []);

  const resumeGame = useCallback(() => {
    setScreen((cur) => {
      if (cur !== "paused") return cur;
      lastRef.current = 0;
      const a = audioRef.current;
      a?.unlock();
      if (!muted && music) a?.startMusic();
      return "playing";
    });
  }, [muted, music]);

  const togglePause = useCallback(() => {
    if (screenRef.current === "playing") pauseGame();
    else if (screenRef.current === "paused") resumeGame();
  }, [pauseGame, resumeGame]);

  const setMuted = useCallback((v) => setProfile((p) => saveSettings(p, { muted: v })), []);
  const setMusic = useCallback((v) => setProfile((p) => saveSettings(p, { music: v })), []);
  const setHints = useCallback((v) => setProfile((p) => saveSettings(p, { hints: v })), []);

  const quitToMenu = useCallback(() => {
    audioRef.current?.stopMusic();
    /* Bank *before* resetting: resetGame zeroes s.coins, and this used to
       run first, which is why walking away from a good run through the
       pause card threw every coin in it away. Harmless after a death,
       because finishRun has already banked and the guard makes this a
       no-op. */
    bankRun();
    const s = gameRef.current;
    if (s) { resetGame(s, undefined, readSave().selected); resetCamera(); resetPoseBlend(); }
    setScreen("intro");
  }, [bankRun]);

  const openShop = useCallback(() => {
    setShopFocus(readSave().selected);
    setShopMsg("");
    setScreen("shop");
  }, []);

  const onBuy = useCallback((id) => {
    const { profile: next, bought, reason } = buyCharacter(readSave(), id);
    if (bought) {
      setProfile(next);
      setShopMsg(`${characterById(id).name} unlocked and selected.`);
      audioRef.current?.unlock();
      audioRef.current?.play("buy");
    } else if (reason === "coins") {
      setShopMsg(`${(characterById(id).price - next.bank).toLocaleString()} more coins needed.`);
      audioRef.current?.play("deny");
    }
  }, []);

  const onSelect = useCallback((id) => {
    setProfile(selectCharacter(readSave(), id));
    setShopMsg(`${characterById(id).name} selected.`);
    audioRef.current?.play("lane");
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
        case "arrowleft": moveLane(s, -1); break;
        case "arrowright": moveLane(s, 1); break;
        case "arrowup": case "w": case " ": jump(s); break;
        case "arrowdown": case "s": slide(s); break;
        case "a": case "f": attack(s); break;
        default: used = false;
      }
      if (used) e.preventDefault();
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [begin, togglePause, setMuted, muted]);

  /* swipes */
  const SWIPE_MIN = 24;
  const TAP_MAX = 16;
  const TAP_MS = 260;

  const onPointerDown = useCallback((e) => {
    /* Capture keeps a swipe that leaves the canvas mid-drag — off the top
       edge, or over the FIGHT button — still reporting to us. It is an
       optimisation, not a requirement, and it throws outright if the
       pointer has already been released by the time React runs the
       handler, so a failure here must not take the gesture with it. */
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* fine without it */ }
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

  const onAttackTouch = useCallback((e) => {
    // must not reach the gesture layer, or a jab reads as a tap-to-jump
    e.stopPropagation();
    e.preventDefault();
    const s = gameRef.current;
    if (s) attack(s);
    audioRef.current?.unlock();
  }, []);

  /* Closing the game card unmounts this component mid-run, which is the
     fourth way out of a run and just as much a "I am done, keep my
     coins" as the other three. Banking on unmount also covers a route
     change or the whole app being torn down. The write goes to
     localStorage synchronously, so it survives even though the React
     state update that follows it lands on a component that no longer
     exists — which React treats as a no-op, not an error. */
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
  const focus = characterById(shopFocus);
  const owned = profile.unlocked.includes(focus.id);
  const selectedChar = characterById(selected);

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

      {live && (
        <button
          type="button"
          className="krushFight"
          onPointerDown={onAttackTouch}
          onContextMenu={(e) => e.preventDefault()}
          aria-label="Attack"
        >
          FIGHT
        </button>
      )}

      {(live || screen === "paused") && (
        <div className="krushQuick">
          <button type="button" onClick={() => setMuted(!muted)} aria-label={muted ? "Unmute" : "Mute"} title="Sound (M)">
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

      {/* ------------------------------ intro ------------------------------ */}
      {screen === "intro" && (
        <div className="krushOverlay">
          <div className="krushCard">
            <p className="krushEyebrow">Game 04 · Endless runner</p>
            <h3>Kianimation<br />Endless Rush</h3>
            <p className="krushLead">
              Sprint through downtown, the market district, the greenbelt, a
              mountain pass and the night city — dodging, jumping, sliding,
              fighting, and occasionally flying over the rooftops.
            </p>

            <div className="krushStats">
              <div><strong>{profile.highScore.toLocaleString()}</strong><span>High score</span></div>
              <div><strong>{profile.bestDistance.toLocaleString()} m</strong><span>Best distance</span></div>
              <div><strong>{profile.bank.toLocaleString()}</strong><span>Coins to spend</span></div>
            </div>

            <button type="button" className="krushPicked" onClick={openShop}>
              <span className="krushPickedDot" style={{ background: selectedChar.accent }} />
              <span className="krushPickedText">
                <strong>{selectedChar.name}</strong>
                <em>{selectedChar.tagline}</em>
              </span>
              <span className="krushPickedGo">Change ›</span>
            </button>

            <div className="krushActions">
              <button type="button" className="krushPrimary" onClick={() => begin()}>Start running</button>
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
                  {POWER_BLURB.map(([key, blurb]) => (
                    <li key={key}>
                      <b aria-hidden="true" style={{ color: POWER_COLOUR[key] }}>{POWER_ICON[key]}</b>
                      <div><strong>{POWER_LABEL[key]}</strong><span>{blurb}</span></div>
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
                    <input type="checkbox" checked={profile.settings.hints} onChange={(e) => setHints(e.target.checked)} />
                    <span>On-screen control hint</span>
                  </label>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ------------------------------- shop ------------------------------- */}
      {screen === "shop" && (
        <div className="krushOverlay">
          <div className="krushCard krushCard--shop">
            <div className="krushShopHead">
              <div>
                <p className="krushEyebrow">Characters</p>
                <h3>Pick your runner</h3>
              </div>
              <div className="krushBank" title="Coins available to spend">
                <span className="krushCoin" aria-hidden="true" />
                <strong>{profile.bank.toLocaleString()}</strong>
              </div>
            </div>

            <div className="krushShopBody">
              <div className="krushPreview">
                <canvas ref={previewRef} />
                <div className="krushPreviewInfo">
                  <strong style={{ color: focus.accent }}>{focus.name}</strong>
                  <p>{focus.blurb}</p>
                  <ul>
                    {focus.traits.map((tr) => <li key={tr}>{tr}</li>)}
                  </ul>
                </div>
              </div>

              <ul className="krushRoster">
                {CHARACTERS.map((c) => {
                  const has = profile.unlocked.includes(c.id);
                  const isSel = selected === c.id;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        className={`krushRosterItem ${shopFocus === c.id ? "is-focus" : ""} ${has ? "" : "is-locked"}`}
                        style={{ "--accent": c.accent }}
                        onClick={() => setShopFocus(c.id)}
                      >
                        <span className="krushRosterDot" />
                        <span className="krushRosterName">
                          <strong>{c.name}</strong>
                          <em>
                            {has ? (isSel ? "Selected" : "Unlocked")
                              : `${c.price.toLocaleString()} coins`}
                          </em>
                        </span>
                        <span className="krushRosterMark" aria-hidden="true">
                          {isSel ? "✓" : has ? "" : "🔒"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            {shopMsg && <p className="krushShopMsg">{shopMsg}</p>}

            <div className="krushActions">
              {owned ? (
                <button
                  type="button"
                  className="krushPrimary"
                  disabled={selected === focus.id}
                  onClick={() => onSelect(focus.id)}
                >
                  {selected === focus.id ? "Selected" : `Select ${focus.name}`}
                </button>
              ) : (
                <button
                  type="button"
                  className="krushPrimary"
                  disabled={profile.bank < focus.price}
                  onClick={() => onBuy(focus.id)}
                >
                  Buy for {focus.price.toLocaleString()}
                </button>
              )}
              <button type="button" className="krushGhost" onClick={() => begin(owned ? focus.id : selected)}>
                Start running
              </button>
              <button type="button" className="krushGhost" onClick={() => setScreen("intro")}>Back</button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------ paused ------------------------------ */}
      {screen === "paused" && (
        <div className="krushOverlay">
          <div className="krushCard krushCard--slim">
            <p className="krushEyebrow">Paused</p>
            <h3>Catch your breath</h3>
            <div className="krushActions">
              <button type="button" className="krushPrimary" onClick={resumeGame}>Resume</button>
              <button type="button" className="krushGhost" onClick={() => begin()}>Restart</button>
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

      {/* ------------------------------ results ------------------------------ */}
      {screen === "over" && results && (
        <div className="krushOverlay">
          <div className="krushCard">
            <p className="krushEyebrow">{results.isRecord ? "New personal best" : "Run over"}</p>
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
              <li><span>Enemies beaten</span><b>{results.stats.enemiesBeaten}</b></li>
              <li><span>Best combo</span><b>{results.stats.bestCombo ? `×${results.stats.bestCombo}` : "—"}</b></li>
              <li><span>Rooftop metres</span><b>{Math.round(results.stats.roofMetres)} m</b></li>
              <li><span>Coins to spend</span><b>{profile.bank.toLocaleString()}</b></li>
            </ul>

            <div className="krushActions">
              <button type="button" className="krushPrimary" onClick={() => begin()}>Play again</button>
              <button type="button" className="krushGhost" onClick={openShop}>Characters</button>
              <button type="button" className="krushGhost" onClick={quitToMenu}>Back to menu</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
