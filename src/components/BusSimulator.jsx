import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRenderer } from "./busSim/render.js";
import {
  placeCamera, drawWorld, drawCockpit, drawStopMarker, resetCamera, VIEWS,
} from "./busSim/scene.js";
import { drawHud } from "./busSim/hud.js";
import { createBusAudio } from "./busSim/audio.js";
import { createVehicleLayer } from "./busSim/vehicles.js";
import {
  makeGame, stepGame, drainEvents, toggleDoors, toggleGear, recover,
  setIndicator, toggleHeadlights, ringBell, snapshot, restore,
  DIFFICULTY, CAPACITY,
} from "./busSim/engine.js";
import { ROUTES, REGION } from "./busSim/city.js";
import { readSave, writeSave, clearSave, describeSave } from "./busSim/save.js";
import "./BusSimulator.css";

const VIEW_LABEL = { cockpit: "Cockpit", chase: "Chase", top: "Overhead" };

const KEY_HELP = [
  ["W / ↑", "Accelerate"],
  ["S / ↓", "Brake"],
  ["A / D  ·  ← / →", "Steer"],
  ["Space", "Handbrake"],
  ["O", "Open / close doors"],
  ["R", "Gear  D → R → N"],
  ["Z / X", "Indicators"],
  ["H (hold)", "Horn"],
  ["B", "Bell"],
  ["L", "Headlights"],
  ["T", "Tow back to the road"],
  ["C", "Change camera"],
  ["P / Esc", "Pause"],
];

const AUTOSAVE_EVERY = 5000;   // ms

function freshInput() {
  return {
    throttle: 0, brake: 0,
    steerLeft: false, steerRight: false,
    handbrake: false,
  };
}

function routeRegions(route) {
  return [...new Set(route.regions)].map(
    (k) => REGION.find((r) => r.key === k)?.name || k,
  );
}

export default function BusSimulator() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const gameRef = useRef(null);
  const audioRef = useRef(null);
  const modelRef = useRef(null);
  const inputRef = useRef(freshInput());
  const lastRef = useRef(0);
  const viewRef = useRef("cockpit");
  const mutedRef = useRef(false);
  const runningRef = useRef(false);
  const regionRef = useRef(-1);
  const qualityRef = useRef(1);
  const tickRef = useRef({ indic: 0, brakeWas: 0, fpsAcc: 0, fpsN: 0, fps: 0 });

  const [screen, setScreen] = useState("briefing");   // briefing | playing | paused | results
  const [view, setView] = useState("cockpit");
  const [muted, setMuted] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [results, setResults] = useState(null);
  const [config, setConfig] = useState({
    difficulty: "normal", dusk: false, mode: "route", seed: 7, routeId: ROUTES[0].id,
  });
  const [stopCount, setStopCount] = useState(8);
  const [saved, setSaved] = useState(() => readSave());
  const [regionName, setRegionName] = useState("");
  const [coarse, setCoarse] = useState(
    () => typeof window !== "undefined"
      && !!window.matchMedia
      && window.matchMedia("(pointer: coarse)").matches,
  );

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia("(pointer: coarse)");
    const onChange = (e) => setCoarse(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  /* ----------------------------- canvas size ----------------------------- */

  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const r = rendererRef.current;
    if (!canvas || !wrap || !r) return;
    const rect = wrap.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    const w = Math.max(320, Math.floor(rect.width));
    const h = Math.max(240, Math.floor(rect.height));
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    r.setSize(w, h);
    modelRef.current?.setSize(w, h, dpr);
  }, []);

  useEffect(() => {
    rendererRef.current = createRenderer();
    resize();
    const ro = new ResizeObserver(resize);
    if (wrapRef.current) ro.observe(wrapRef.current);
    window.addEventListener("resize", resize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [resize]);

  /* ------------------------------- audio ------------------------------- */

  useEffect(() => {
    audioRef.current = createBusAudio();
    return () => audioRef.current?.dispose();
  }, []);

  // glTF bus + traffic; the game stays fully playable if these never load
  useEffect(() => {
    const model = createVehicleLayer({
      onReady: () => resize(),
      onError: (why) => console.warn("[bus] falling back to built-in shapes:", why),
    });
    modelRef.current = model;
    resize();
    return () => { model.dispose(); modelRef.current = null; };
  }, [resize]);

  useEffect(() => { audioRef.current?.setMuted(muted); mutedRef.current = muted; }, [muted]);

  /* ------------------------------ autosave ------------------------------ */

  /* The journey is written whenever something meaningful changes, plus on
     a slow timer, plus on the way out of the page — between them a driver
     can close the tab, rotate the phone or lose the browser and still come
     back to the same stretch of road. */
  const saveNow = useCallback(() => {
    const state = gameRef.current;
    if (!state || state.phase === "finished") return;
    if (state.totalTime < 1) return;
    writeSave(snapshot(state), { view: viewRef.current, muted: mutedRef.current });
  }, []);

  const forgetJourney = useCallback(() => {
    clearSave();
    setSaved(null);
  }, []);

  /* Leaving a shift keeps the journey — the briefing then offers to resume
     it — so the saved blob has to be re-read on the way out. */
  const goBriefing = useCallback((keep) => {
    if (keep) saveNow();
    setSaved(readSave());
    setScreen("briefing");
  }, [saveNow]);

  const handleEvents = useCallback((state) => {
    const a = audioRef.current;
    const events = drainEvents(state);
    for (const e of events) {
      if (e.type === "autosave") { saveNow(); continue; }
      if (e.type === "routeDone") { clearSave(); setSaved(null); continue; }
      if (!a) continue;
      switch (e.type) {
        case "crash": a.play("crash", e.impact); break;
        case "kerb": a.play("kerb"); break;
        case "redLight": a.play("redLight"); break;
        case "pedHit": a.play("pedHit"); break;
        case "doorOpen": a.play("doorOpen"); break;
        case "doorClose": a.play("doorClose"); break;
        case "coin": a.play("coin"); break;
        case "step": a.play("step"); break;
        case "ready": a.play("ready"); break;
        case "gear": a.play("gear"); break;
        case "bell": a.play("bell"); break;
        case "stall": a.play("stall"); break;
        case "trafficHorn": a.play("trafficHorn"); break;
        case "arrive": a.play("arrive"); break;
        case "region": a.announce(`Now entering ${e.name}`); break;
        case "announce": a.announce(`Next stop, ${e.text}`); break;
        case "finish":
          a.play("finish");
          a.announce("End of route. Thank you for driving.");
          break;
        default: break;
      }
    }
  }, [saveNow]);

  /* ------------------------------- loop ------------------------------- */

  const frame = useCallback((now) => {
    const state = gameRef.current;
    const r = rendererRef.current;
    const canvas = canvasRef.current;
    if (!state || !r || !canvas) return;

    const last = lastRef.current || now;
    let dt = (now - last) / 1000;
    lastRef.current = now;
    if (dt > 0.25) dt = 0.25;

    const ctx = canvas.getContext("2d");
    const W = r.width, H = r.height;
    const v = viewRef.current;

    if (runningRef.current) {
      stepGame(state, inputRef.current, dt);
      handleEvents(state);

      if (state.region !== regionRef.current) {
        regionRef.current = state.region;
        setRegionName(REGION[state.region].name);
      }

      const a = audioRef.current;
      if (a) {
        a.updateEngine({
          rpm: state.bus.rpm,
          load: state.bus.throttle,
          speed: state.bus.speed,
          running: state.bus.engineOn,
        });
        const tk = tickRef.current;
        if (state.bus.indicator) {
          tk.indic -= dt;
          if (tk.indic <= 0) { tk.indic = 0.52; a.play("indicator"); }
        } else tk.indic = 0;
        if (tk.brakeWas > 0.35 && state.bus.brake < 0.1 && Math.abs(state.bus.speed) < 1.2) a.play("airBrake");
        tk.brakeWas = state.bus.brake;
      }

      if (state.phase === "finished" && screen === "playing") {
        runningRef.current = false;
        setResults({
          stars: state.stars,
          money: Math.round(state.money),
          penalties: Math.round(state.penalties),
          net: Math.round(state.net ?? state.money - state.penalties),
          carried: state.carried,
          comfort: Math.round(state.comfort),
          time: state.totalTime,
          stats: { ...state.stats },
          regions: state.regionSeen.slice(),
          route: state.city.route,
          timeBonus: state.finalTimeBonus || 0,
          comfortBonus: state.finalComfortBonus || 0,
        });
        setScreen("results");
      }
    }

    placeCamera(r, state, v, dt, state.t);
    drawWorld(ctx, r, state, v, state.t, modelRef.current, qualityRef.current);
    if (v === "cockpit") drawCockpit(ctx, state, W, H);

    const inPlay = screen === "playing" || screen === "paused";
    if (inPlay) {
      drawStopMarker(ctx, r, state, W, H);
      const tk = tickRef.current;
      tk.fpsAcc += dt; tk.fpsN += 1;
      if (tk.fpsAcc > 0.5) {
        tk.fps = Math.round(tk.fpsN / tk.fpsAcc);
        tk.fpsAcc = 0; tk.fpsN = 0;
        /* Adaptive view distance. A weak phone pulls the horizon in a
           little rather than dropping frames; a fast machine gets the
           long view back within a couple of seconds. */
        const q = qualityRef.current;
        if (tk.fps < 26) qualityRef.current = Math.max(0.62, q - 0.06);
        else if (tk.fps > 46) qualityRef.current = Math.min(1, q + 0.04);
      }
      drawHud(ctx, state, W, H, v, state.t, tk.fps);
    }

    if (!runningRef.current && screen === "paused") {
      ctx.save();
      ctx.fillStyle = "rgba(6,9,13,0.55)";
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }, [handleEvents, screen]);

  useEffect(() => {
    let raf = 0;
    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      frame(now);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [frame]);

  /* ------------------------------ commands ------------------------------ */

  const cycleView = useCallback(() => {
    setView((cur) => {
      const next = VIEWS[(VIEWS.indexOf(cur) + 1) % VIEWS.length];
      viewRef.current = next;
      return next;
    });
  }, []);

  const command = useCallback((name) => {
    const state = gameRef.current;
    if (!state) return;
    audioRef.current?.unlock();
    switch (name) {
      case "doors": toggleDoors(state); break;
      case "gear": toggleGear(state); break;
      case "left": setIndicator(state, "left"); break;
      case "right": setIndicator(state, "right"); break;
      case "bell": ringBell(state); audioRef.current?.play("bell"); break;
      case "lights": toggleHeadlights(state); break;
      case "recover": recover(state); audioRef.current?.play("airBrake"); break;
      case "view": cycleView(); break;
      default: break;
    }
  }, [cycleView]);

  /* The horn is held, not fired: press opens it, release closes it. The
     unlock() call has to happen inside the gesture itself, which is what
     mobile autoplay policies require. */
  const hornDown = useCallback((e) => {
    e?.preventDefault?.();
    e?.currentTarget?.setPointerCapture?.(e.pointerId);
    audioRef.current?.unlock();
    audioRef.current?.hornOn();
  }, []);

  const hornUp = useCallback((e) => {
    e?.preventDefault?.();
    audioRef.current?.hornOff();
  }, []);

  /* ------------------------------ keyboard ------------------------------ */

  useEffect(() => {
    const down = (e) => {
      if (screen !== "playing" && screen !== "paused") return;
      const k = e.key.toLowerCase();
      const inp = inputRef.current;
      let used = true;
      switch (k) {
        case "w": case "arrowup": inp.throttle = 1; break;
        case "s": case "arrowdown": inp.brake = 1; break;
        case "a": case "arrowleft": inp.steerLeft = true; break;
        case "d": case "arrowright": inp.steerRight = true; break;
        case " ": inp.handbrake = true; break;
        case "o": if (!e.repeat) command("doors"); break;
        case "r": if (!e.repeat) command("gear"); break;
        case "z": if (!e.repeat) command("left"); break;
        case "x": if (!e.repeat) command("right"); break;
        case "h": if (!e.repeat) hornDown(); break;
        case "b": if (!e.repeat) command("bell"); break;
        case "l": if (!e.repeat) command("lights"); break;
        case "t": if (!e.repeat) command("recover"); break;
        case "c": if (!e.repeat) command("view"); break;
        case "p": case "escape":
          if (!e.repeat) setScreen((s) => (s === "playing" ? "paused" : s === "paused" ? "playing" : s));
          break;
        default: used = false;
      }
      if (used) e.preventDefault();
    };
    const up = (e) => {
      const k = e.key.toLowerCase();
      const inp = inputRef.current;
      switch (k) {
        case "w": case "arrowup": inp.throttle = 0; break;
        case "s": case "arrowdown": inp.brake = 0; break;
        case "a": case "arrowleft": inp.steerLeft = false; break;
        case "d": case "arrowright": inp.steerRight = false; break;
        case " ": inp.handbrake = false; break;
        case "h": hornUp(); break;
        default: break;
      }
    };
    const blur = () => { inputRef.current = freshInput(); hornUp(); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [command, hornDown, hornUp, screen]);

  useEffect(() => { runningRef.current = screen === "playing"; }, [screen]);
  useEffect(() => { viewRef.current = view; }, [view]);

  /* Pausing, leaving the tab and leaving the page all write the journey.
     pagehide is the one that survives a phone rotating the browser away or
     the tab being discarded; visibilitychange covers backgrounding. */
  useEffect(() => {
    if (screen === "paused") saveNow();
  }, [screen, saveNow]);

  useEffect(() => {
    if (screen !== "playing") return undefined;
    const id = setInterval(saveNow, AUTOSAVE_EVERY);
    return () => clearInterval(id);
  }, [screen, saveNow]);

  useEffect(() => {
    const leave = () => saveNow();
    const vis = () => { if (document.visibilityState === "hidden") saveNow(); };
    window.addEventListener("pagehide", leave);
    window.addEventListener("beforeunload", leave);
    document.addEventListener("visibilitychange", vis);
    return () => {
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("beforeunload", leave);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [saveNow]);

  /* ------------------------------- start ------------------------------- */

  const beginWith = useCallback((game, announce) => {
    gameRef.current = game;
    setStopCount(game.city.stops.length);
    regionRef.current = game.region;
    setRegionName(REGION[game.region].name);
    inputRef.current = freshInput();
    lastRef.current = 0;
    resetCamera();
    setResults(null);
    audioRef.current?.unlock();
    if (announce) audioRef.current?.announce(announce);
    setScreen("playing");
  }, []);

  const start = useCallback((cfg) => {
    const next = { ...config, ...cfg };
    setConfig(next);
    clearSave();
    setSaved(null);
    const game = makeGame({
      seed: next.seed,
      mode: next.mode,
      difficulty: next.difficulty,
      dusk: next.dusk,
      routeId: next.routeId,
    });
    beginWith(game, next.mode === "free"
      ? "Free drive. Take your time."
      : `${game.city.route.name}. First stop, ${game.city.stops[0].name}`);
  }, [config, beginWith]);

  const continueJourney = useCallback(() => {
    const blob = readSave();
    if (!blob) { setSaved(null); return; }
    let restored;
    try {
      restored = restore(blob.snapshot);
    } catch {
      clearSave();
      setSaved(null);
      return;
    }
    const { state, moved } = restored;
    setConfig({
      difficulty: state.difficulty, dusk: state.dusk,
      mode: state.mode, seed: state.seed, routeId: state.routeId,
    });
    const ui = blob.ui || {};
    if (VIEWS.includes(ui.view)) { viewRef.current = ui.view; setView(ui.view); }
    if (typeof ui.muted === "boolean") setMuted(ui.muted);
    const stop = state.city.stops[state.activeStopId];
    beginWith(state, moved
      ? "Journey resumed. You were parked off the road, so we have put you back on it."
      : `Journey resumed. Next stop, ${stop ? stop.name : "the depot"}`);
  }, [beginWith]);

  // a game object always exists so the canvas has something to draw
  useEffect(() => {
    if (!gameRef.current) {
      const game = makeGame({ seed: 7, mode: "route", difficulty: "normal", dusk: false });
      gameRef.current = game;
      setStopCount(game.city.stops.length);
    }
  }, []);

  /* ------------------------------ touch pads ------------------------------ */

  /* The pressed/released state rides on data attributes so these handlers
     can be created once instead of per render — the input object is a
     ref and must not be touched while rendering. */
  const padDown = useCallback((e) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const { padKey, padHold } = e.currentTarget.dataset;
    inputRef.current[padKey] = padHold === "bool" ? true : 1;
    audioRef.current?.unlock();
  }, []);

  const padUp = useCallback((e) => {
    const { padKey, padHold } = e.currentTarget.dataset;
    inputRef.current[padKey] = padHold === "bool" ? false : 0;
  }, []);

  const noMenu = useCallback((e) => e.preventDefault(), []);

  const pad = (key, kind) => ({
    "data-pad-key": key,
    "data-pad-hold": kind,
    onPointerDown: padDown,
    onPointerUp: padUp,
    onPointerCancel: padUp,
    onPointerLeave: padUp,
    onContextMenu: noMenu,
  });

  const diffMeta = DIFFICULTY[config.difficulty];
  const routeMeta = useMemo(
    () => ROUTES.find((r) => r.id === config.routeId) || ROUTES[0],
    [config.routeId],
  );
  const routeMinutes = useMemo(
    () => Math.round((diffMeta.timePerStop * stopCount) / 60),
    [diffMeta, stopCount],
  );
  const savedLabel = useMemo(() => {
    if (!saved) return "";
    const r = ROUTES.find((x) => x.id === saved.snapshot.routeId);
    const reg = REGION[saved.snapshot.region];
    return describeSave(saved, r ? r.name : null, reg ? reg.name : null);
  }, [saved]);

  /* -------------------------------- view -------------------------------- */

  return (
    <div className="bsim" ref={wrapRef}>
      <canvas ref={canvasRef} className="bsimCanvas" />

      {/* top-right quick actions */}
      {(screen === "playing" || screen === "paused") && (
        <div className="bsimQuick">
          {regionName && <span className="bsimRegion">{regionName}</span>}
          <button type="button" onClick={cycleView} title="Camera (C)">{VIEW_LABEL[view]}</button>
          <button type="button" onClick={() => setMuted((m) => !m)} title="Sound">{muted ? "🔇" : "🔊"}</button>
          <button
            type="button"
            onClick={() => setScreen((s) => (s === "playing" ? "paused" : "playing"))}
            title="Pause (P)"
          >
            {screen === "playing" ? "❚❚" : "▶"}
          </button>
        </div>
      )}

      {/* touch driving controls */}
      {screen === "playing" && (
        <div className={`bsimTouch ${coarse ? "is-coarse" : ""}`}>
          <div className="bsimTouchLeft">
            <button type="button" className="bsimPad" {...pad("steerLeft", "bool")} aria-label="Steer left">◄</button>
            <button type="button" className="bsimPad" {...pad("steerRight", "bool")} aria-label="Steer right">►</button>
            <button
              type="button"
              className="bsimPad bsimPad--horn"
              onPointerDown={hornDown}
              onPointerUp={hornUp}
              onPointerCancel={hornUp}
              onPointerLeave={hornUp}
              onContextMenu={noMenu}
              aria-label="Horn (hold)"
            >HORN</button>
          </div>
          <div className="bsimTouchMid">
            <button type="button" className="bsimChip" onClick={() => command("left")}>◄ Ind</button>
            <button type="button" className="bsimChip" onClick={() => command("doors")}>Doors</button>
            <button type="button" className="bsimChip" onClick={() => command("gear")}>Gear</button>
            <button type="button" className="bsimChip" onClick={() => command("recover")}>Tow</button>
            <button type="button" className="bsimChip" onClick={() => command("right")}>Ind ►</button>
          </div>
          <div className="bsimTouchRight">
            <button type="button" className="bsimPad bsimPad--brake" {...pad("brake", "axis")} aria-label="Brake">BRAKE</button>
            <button type="button" className="bsimPad bsimPad--gas" {...pad("throttle", "axis")} aria-label="Accelerate">GO</button>
          </div>
        </div>
      )}

      {/* briefing */}
      {screen === "briefing" && (
        <div className="bsimOverlay">
          <div className="bsimCard">
            <p className="bsimEyebrow">Game 03</p>
            <h3>Metro City Bus</h3>
            <p className="bsimLead">
              Take the wheel of a 12-metre city bus across a whole region —
              downtown streets, suburbs, coast road, highway, forest, tunnels
              and the mountain pass. Run the route, stop level with the kerb
              and keep your passengers comfortable.
            </p>

            {saved && (
              <div className="bsimResume">
                <div>
                  <strong>Journey in progress</strong>
                  <span>{savedLabel}</span>
                </div>
                <div className="bsimResumeActions">
                  <button type="button" className="bsimPrimary" onClick={continueJourney}>
                    Continue journey
                  </button>
                  <button type="button" className="bsimGhost" onClick={forgetJourney}>
                    Reset saved journey
                  </button>
                </div>
              </div>
            )}

            <div className="bsimOptions">
              <div className="bsimOptGroup">
                <span>Route</span>
                <div className="bsimSeg bsimSeg--wrap">
                  {ROUTES.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className={config.routeId === r.id ? "is-on" : ""}
                      onClick={() => setConfig((c) => ({ ...c, routeId: r.id }))}
                    >{r.number} · {r.name}</button>
                  ))}
                </div>
              </div>

              <div className="bsimOptGroup">
                <span>Mode</span>
                <div className="bsimSeg">
                  {[["route", "Timed route"], ["free", "Free drive"]].map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      className={config.mode === id ? "is-on" : ""}
                      onClick={() => setConfig((c) => ({ ...c, mode: id }))}
                    >{label}</button>
                  ))}
                </div>
              </div>

              <div className="bsimOptGroup">
                <span>Shift</span>
                <div className="bsimSeg">
                  {Object.entries(DIFFICULTY).map(([id, d]) => (
                    <button
                      key={id}
                      type="button"
                      className={config.difficulty === id ? "is-on" : ""}
                      onClick={() => setConfig((c) => ({ ...c, difficulty: id }))}
                    >{d.label}</button>
                  ))}
                </div>
              </div>

              <div className="bsimOptGroup">
                <span>Time of day</span>
                <div className="bsimSeg">
                  {[[false, "Daylight"], [true, "Dusk"]].map(([id, label]) => (
                    <button
                      key={String(id)}
                      type="button"
                      className={config.dusk === id ? "is-on" : ""}
                      onClick={() => setConfig((c) => ({ ...c, dusk: id }))}
                    >{label}</button>
                  ))}
                </div>
              </div>

              <div className="bsimOptGroup">
                <span>World</span>
                <div className="bsimSeg">
                  <button type="button" onClick={() => setConfig((c) => ({ ...c, seed: Math.floor(Math.random() * 9999) + 1 }))}>
                    Shuffle scenery
                  </button>
                  <span className="bsimSeed">#{config.seed}</span>
                </div>
              </div>
            </div>

            <p className="bsimRouteLine">
              {routeMeta.number} {routeMeta.name}: {routeRegions(routeMeta).join(" → ")}
            </p>

            <div className="bsimBrief">
              <div><strong>{stopCount}</strong><span>stops</span></div>
              <div><strong>{config.mode === "free" ? "∞" : `${routeMinutes}m`}</strong><span>on the clock</span></div>
              <div><strong>{CAPACITY}</strong><span>seats</span></div>
            </div>

            <div className="bsimActions">
              <button type="button" className={saved ? "bsimGhost" : "bsimPrimary"} onClick={() => start({})}>
                {saved ? "Start new journey" : "Start shift"}
              </button>
              <button type="button" className="bsimGhost" onClick={() => setShowHelp((s) => !s)}>
                {showHelp ? "Hide controls" : "Controls"}
              </button>
            </div>

            {showHelp && (
              <ul className="bsimKeys">
                {KEY_HELP.map(([k, label]) => (
                  <li key={k}><kbd>{k}</kbd><span>{label}</span></li>
                ))}
                <li className="bsimKeysNote">
                  <span>On a phone, use the on-screen pedals and steering pads.</span>
                </li>
              </ul>
            )}
          </div>
        </div>
      )}

      {/* pause */}
      {screen === "paused" && (
        <div className="bsimOverlay">
          <div className="bsimCard bsimCard--slim">
            <p className="bsimEyebrow">Paused · progress saved</p>
            <h3>Take a breath</h3>
            <div className="bsimActions">
              <button type="button" className="bsimPrimary" onClick={() => { lastRef.current = 0; setScreen("playing"); }}>
                Resume
              </button>
              <button type="button" className="bsimGhost" onClick={() => goBriefing(true)}>
                End shift
              </button>
              <button type="button" className="bsimGhost" onClick={forgetJourney}>
                Reset saved journey
              </button>
            </div>
            <ul className="bsimKeys bsimKeys--compact">
              {KEY_HELP.map(([k, label]) => (
                <li key={k}><kbd>{k}</kbd><span>{label}</span></li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* results */}
      {screen === "results" && results && (
        <div className="bsimOverlay">
          <div className="bsimCard">
            <p className="bsimEyebrow">
              {results.route ? `${results.route.number} ${results.route.name} · ` : ""}Shift complete
            </p>
            <h3>{["Rough day", "Getting there", "Solid driving", "Sharp work", "Ace of the depot"][results.stars - 1]}</h3>
            <div className="bsimStars" aria-label={`${results.stars} out of 5 stars`}>
              {Array.from({ length: 5 }, (_, i) => (
                <span key={i} className={i < results.stars ? "is-on" : ""}>★</span>
              ))}
            </div>

            <div className="bsimScore">
              <div><span>Fares + bonuses</span><strong>₵{results.money}</strong></div>
              <div><span>Penalties</span><strong className="is-bad">−₵{results.penalties}</strong></div>
              <div className="bsimScoreTotal"><span>Take-home</span><strong>₵{results.net}</strong></div>
            </div>

            <ul className="bsimTally">
              <li><span>Passengers carried</span><b>{results.carried}</b></li>
              <li><span>Perfect kerb stops</span><b>{results.stats.perfectStops}</b></li>
              <li><span>Comfort rating</span><b>{results.comfort}%</b></li>
              <li><span>Red lights run</span><b>{results.stats.redLights}</b></li>
              <li><span>Collisions</span><b>{results.stats.collisions}</b></li>
              <li><span>Pedestrians hit</span><b>{results.stats.pedHits}</b></li>
              <li><span>Time driven</span><b>{Math.floor(results.time / 60)}m {Math.round(results.time % 60)}s</b></li>
              <li><span>Regions driven</span><b>{results.regions.length}</b></li>
            </ul>

            <div className="bsimActions">
              <button type="button" className="bsimPrimary" onClick={() => start({})}>Drive again</button>
              <button type="button" className="bsimGhost" onClick={() => goBriefing(false)}>Change shift</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
