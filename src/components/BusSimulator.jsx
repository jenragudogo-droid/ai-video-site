import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRenderer } from "./busSim/render.js";
import {
  placeCamera, drawWorld, drawCockpit, drawStopMarker, resetCamera, VIEWS,
} from "./busSim/scene.js";
import { drawHud } from "./busSim/hud.js";
import { createBusAudio } from "./busSim/audio.js";
import {
  makeGame, stepGame, drainEvents, toggleDoors, toggleGear, recover,
  setIndicator, toggleHeadlights, ringBell, DIFFICULTY, CAPACITY,
} from "./busSim/engine.js";
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
  ["H", "Horn"],
  ["B", "Bell"],
  ["L", "Headlights"],
  ["T", "Tow back to the road"],
  ["C", "Change camera"],
  ["P / Esc", "Pause"],
];

function freshInput() {
  return {
    throttle: 0, brake: 0,
    steerLeft: false, steerRight: false,
    handbrake: false,
  };
}

export default function BusSimulator() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const gameRef = useRef(null);
  const audioRef = useRef(null);
  const inputRef = useRef(freshInput());
  const lastRef = useRef(0);
  const viewRef = useRef("cockpit");
  const runningRef = useRef(false);
  const tickRef = useRef({ indic: 0, brakeWas: 0, fpsAcc: 0, fpsN: 0, fps: 0 });

  const [screen, setScreen] = useState("briefing");   // briefing | playing | paused | results
  const [view, setView] = useState("cockpit");
  const [muted, setMuted] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [results, setResults] = useState(null);
  const [config, setConfig] = useState({ difficulty: "normal", dusk: false, mode: "route", seed: 7 });
  const [stopCount, setStopCount] = useState(8);
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

  useEffect(() => { audioRef.current?.setMuted(muted); }, [muted]);

  const handleEvents = useCallback((state) => {
    const a = audioRef.current;
    if (!a) return;
    const events = drainEvents(state);
    for (const e of events) {
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
        case "arrive":
          a.play("arrive");
          break;
        case "announce":
          a.announce(`Next stop, ${e.text}`);
          break;
        case "finish":
          a.play("finish");
          a.announce("End of route. Thank you for driving.");
          break;
        default: break;
      }
    }
  }, []);

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
          timeBonus: state.finalTimeBonus || 0,
          comfortBonus: state.finalComfortBonus || 0,
        });
        setScreen("results");
      }
    }

    placeCamera(r, state, v, dt, state.t);
    drawWorld(ctx, r, state, v, state.t);
    if (v === "cockpit") drawCockpit(ctx, state, W, H);

    const inPlay = screen === "playing" || screen === "paused";
    if (inPlay) {
      drawStopMarker(ctx, r, state, W, H);
      const tk = tickRef.current;
      tk.fpsAcc += dt; tk.fpsN += 1;
      if (tk.fpsAcc > 0.5) { tk.fps = Math.round(tk.fpsN / tk.fpsAcc); tk.fpsAcc = 0; tk.fpsN = 0; }
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
      case "horn": audioRef.current?.play("horn"); break;
      case "bell": ringBell(state); audioRef.current?.play("bell"); break;
      case "lights": toggleHeadlights(state); break;
      case "recover": recover(state); audioRef.current?.play("airBrake"); break;
      case "view": cycleView(); break;
      default: break;
    }
  }, [cycleView]);

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
        case "h": if (!e.repeat) command("horn"); break;
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
        default: break;
      }
    };
    const blur = () => { inputRef.current = freshInput(); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [command, screen]);

  useEffect(() => { runningRef.current = screen === "playing"; }, [screen]);
  useEffect(() => { viewRef.current = view; }, [view]);

  /* ------------------------------- start ------------------------------- */

  const start = useCallback((cfg) => {
    const next = { ...config, ...cfg };
    setConfig(next);
    const game = makeGame({
      seed: next.seed,
      mode: next.mode,
      difficulty: next.difficulty,
      dusk: next.dusk,
    });
    gameRef.current = game;
    setStopCount(game.city.stops.length);
    inputRef.current = freshInput();
    lastRef.current = 0;
    resetCamera();
    setResults(null);
    audioRef.current?.unlock();
    audioRef.current?.announce(
      next.mode === "free"
        ? "Free drive. Take your time."
        : `Route starting. First stop, ${game.city.stops[0].name}`,
    );
    setScreen("playing");
  }, [config]);

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
  const routeMinutes = useMemo(
    () => Math.round((diffMeta.timePerStop * stopCount) / 60),
    [diffMeta, stopCount],
  );

  /* -------------------------------- view -------------------------------- */

  return (
    <div className="bsim" ref={wrapRef}>
      <canvas ref={canvasRef} className="bsimCanvas" />

      {/* top-right quick actions */}
      {(screen === "playing" || screen === "paused") && (
        <div className="bsimQuick">
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
          </div>
          <div className="bsimTouchMid">
            <button type="button" className="bsimChip" onClick={() => command("left")}>◄ Ind</button>
            <button type="button" className="bsimChip" onClick={() => command("doors")}>Doors</button>
            <button type="button" className="bsimChip" onClick={() => command("gear")}>Gear</button>
            <button type="button" className="bsimChip" onClick={() => command("horn")}>Horn</button>
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
              Take the wheel of a 12-metre city bus. Run the route, stop level with
              the kerb, mind the lights and keep your passengers comfortable.
            </p>

            <div className="bsimOptions">
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
                <span>City</span>
                <div className="bsimSeg">
                  <button type="button" onClick={() => setConfig((c) => ({ ...c, seed: Math.floor(Math.random() * 9999) + 1 }))}>
                    Shuffle layout
                  </button>
                  <span className="bsimSeed">#{config.seed}</span>
                </div>
              </div>
            </div>

            <div className="bsimBrief">
              <div><strong>{stopCount}</strong><span>stops</span></div>
              <div><strong>{config.mode === "free" ? "∞" : `${routeMinutes}m`}</strong><span>on the clock</span></div>
              <div><strong>{CAPACITY}</strong><span>seats</span></div>
            </div>

            <div className="bsimActions">
              <button type="button" className="bsimPrimary" onClick={() => start({})}>Start shift</button>
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
            <p className="bsimEyebrow">Paused</p>
            <h3>Take a breath</h3>
            <div className="bsimActions">
              <button type="button" className="bsimPrimary" onClick={() => { lastRef.current = 0; setScreen("playing"); }}>
                Resume
              </button>
              <button type="button" className="bsimGhost" onClick={() => setScreen("briefing")}>End shift</button>
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
            <p className="bsimEyebrow">Shift complete</p>
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
            </ul>

            <div className="bsimActions">
              <button type="button" className="bsimPrimary" onClick={() => start({})}>Drive again</button>
              <button type="button" className="bsimGhost" onClick={() => setScreen("briefing")}>Change shift</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
