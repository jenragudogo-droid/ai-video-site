import { useCallback, useEffect, useRef, useState } from "react";
import {
  DRIVERS, CARS, PAINTS, DECALS, WHEELS, FLAMES, GLOWS, UPGRADES, UPGRADE_MAX,
  upgradeCost, CUPS, BOSSES, ACHIEVEMENTS, EVENT_TYPES, POWERUPS, COMBOS,
  driverById, carById, bossById,
} from "./turboRush/data.js";
import { TRACKS, trackById } from "./turboRush/tracks.js";
import { createRace, stepRace, drainEvents, champPointsFor, activateSlot, tryCombo } from "./turboRush/engine.js";
import { createRaceScene } from "./turboRush/raceScene.js";
import { personalityFor, aiInput } from "./turboRush/ai.js";
import { mulberry } from "./turboRush/spline.js";
import { makeHudState, hudEvent, drawHud } from "./turboRush/hud.js";
import { createRushAudio } from "./turboRush/audio.js";
import {
  readSave, writeSave, freshSave, trophiesOf, cupUnlocked, driverAvailable, carAvailable,
  buyDriver, buyCar, buyUpgrade, recordRace, recordCupEvent, dailyChallenge,
} from "./turboRush/save.js";
import "./TurboRush.css";

/* ------------------------------------------------------------------ *
 * Kianimation Turbo Rush — React shell.
 * React owns menus, garage, shops, career and results. The race
 * itself runs in refs + canvases on one requestAnimationFrame loop.
 * ------------------------------------------------------------------ */

const MAX_SUB = 1 / 90;
const COMBO_WINDOW = 0.28; // seconds to press slots together (fingers are slower than keys)

const KEY_HELP = [
  ["↑ / W", "Accelerate"],
  ["↓ / S", "Brake — keep holding to reverse"],
  ["← / A", "Steer left"],
  ["→ / D", "Steer right"],
  ["Space", "Drift (hold in a turn — charges nitro)"],
  ["Shift", "Fire nitro"],
  ["1 · 2 · 3", "Use power-up slot — press two or three TOGETHER to combine"],
  ["P / Esc", "Pause"],
  ["M", "Mute"],
];

const isTouchDevice = () =>
  typeof window !== "undefined" && ("ontouchstart" in window || navigator.maxTouchPoints > 0);

function trackUnlocked(save, trackId) {
  if (["hills", "beach"].includes(trackId)) return true;
  const trophies = trophiesOf(save);
  for (const cup of CUPS) {
    if (cup.events.some((e) => e.track === trackId)) {
      if (trophies >= cup.need) return true;
    }
  }
  return false;
}

function StatBars({ stats }) {
  const rows = [
    ["Speed", stats.top], ["Accel", stats.accel], ["Handling", stats.handling],
    ["Drift", stats.drift], ["Boost", stats.boost], ["Off-road", stats.offroad],
    ["Weight", stats.weight], ["Armour", stats.dura],
  ];
  return (
    <div className="trStatBars">
      {rows.map(([label, v]) => (
        <div key={label} className="trStatRow">
          <span>{label}</span>
          <div className="trStatTrack"><div style={{ width: `${Math.min(100, v * 100)}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

function DriverFace({ look, size = 46 }) {
  return (
    <span className="trFace" style={{ width: size, height: size, background: look.helmet }}>
      <span className="trFaceVisor" style={{ background: look.visor }} />
      <span className="trFaceSuit" style={{ background: look.suit }} />
    </span>
  );
}

export default function TurboRush() {
  const wrapRef = useRef(null);
  const glRef = useRef(null);
  const hudRef = useRef(null);
  const viewRef = useRef(null);
  const raceRef = useRef(null);
  const hudStateRef = useRef(makeHudState());
  const audioRef = useRef(null);
  const inputRef = useRef({ steer: 0, throttle: 0, brake: 0, drift: false, nitro: false });
  const keysRef = useRef({});
  const comboBufRef = useRef({ slots: [], t: 0 });
  const lastRef = useRef(0);
  const rafRef = useRef(0);
  const screenRef = useRef("menu");
  const raceCtxRef = useRef(null); // {cupId, eventIdx, boss} while racing
  const wrongWayRef = useRef(0);
  const prevPlaceRef = useRef(1);
  const slowMoRef = useRef(0);

  const [save, setSave] = useState(() => readSave());
  const [screen, setScreen] = useState("menu"); // menu|career|single|garage|driverShop|carShop|achievements|racing
  const [results, setResults] = useState(null);
  const [paused, setPaused] = useState(false);
  const [bossIntro, setBossIntro] = useState(null);
  const [garageTab, setGarageTab] = useState("car");
  const [singleCfg, setSingleCfg] = useState({ trackId: "hills", type: "race", laps: 3, weather: "default" });
  const [muted, setMuted] = useState(save.settings.muted);
  const touch = save.settings.touch === "on" || (save.settings.touch === "auto" && isTouchDevice());
  const pausedRef = useRef(false);
  useEffect(() => { screenRef.current = screen; }, [screen]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  const persist = useCallback((next) => {
    setSave({ ...writeSave(next) });
  }, []);

  useEffect(() => {
    audioRef.current = createRushAudio();
    return () => audioRef.current?.stopEngine();
  }, []);
  useEffect(() => { audioRef.current?.setMuted(muted); }, [muted]);

  /* ---------------- input: keyboard ---------------- */
  const pressSlot = useCallback((i) => {
    const buf = comboBufRef.current;
    if (!buf.slots.includes(i)) buf.slots.push(i);
    buf.t = COMBO_WINDOW;
    hudStateRef.current.slotPress[i] = 0.25;
  }, []);

  useEffect(() => {
    const down = (e) => {
      const k = e.key;
      keysRef.current[k.toLowerCase()] = true;
      if (screenRef.current !== "racing") return;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(k)) e.preventDefault();
      if (k === "1") pressSlot(0);
      if (k === "2") pressSlot(1);
      if (k === "3") pressSlot(2);
      if (k.toLowerCase() === "m") setMuted((m) => !m);
      if (k === "p" || k === "P" || k === "Escape") setPaused((p) => !p);
    };
    const up = (e) => { keysRef.current[e.key.toLowerCase()] = false; };
    /* losing focus (Cmd-Tab, pause overlay click, phone rotation) must never
       leave a key latched down */
    const clearAll = () => {
      keysRef.current = {};
      inputRef.current = { steer: 0, throttle: 0, brake: 0, drift: false, nitro: false };
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clearAll);
    document.addEventListener("visibilitychange", clearAll);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clearAll);
      document.removeEventListener("visibilitychange", clearAll);
    };
  }, [pressSlot]);

  /* ---------------- quality ---------------- */
  const qualityFor = useCallback(() => {
    const q = save.settings.quality;
    if (q === "high") return 1;
    if (q === "low") return 0.5;
    return isTouchDevice() || window.innerWidth < 900 ? 0.55 : 1;
  }, [save.settings.quality]);

  /* ---------------- start a race ---------------- */
  const startRace = useCallback((cfg, ctx = null) => {
    const race = createRace({
      ...cfg,
      seed: Math.floor(Math.random() * 99999),
      player: {
        driverId: save.selectedDriver,
        carId: save.selectedCar,
        cosmetics: save.cosmetics,
        upgrades: save.upgrades[save.selectedCar] || {},
      },
    });
    raceRef.current = race;
    raceCtxRef.current = ctx;
    hudStateRef.current = makeHudState();
    prevPlaceRef.current = 1;
    wrongWayRef.current = 0;
    slowMoRef.current = 0;
    setResults(null);
    setPaused(false);
    setScreen("racing");
    if (cfg.bossId) {
      const b = bossById(cfg.bossId);
      setBossIntro(b);
      audioRef.current?.play("bossIntro");
      setTimeout(() => setBossIntro(null), 2600);
    }
    audioRef.current?.resume();
  }, [save]);

  /* ---------------- results ---------------- */
  const finishRaceUI = useCallback((race) => {
    const res = race.results;
    if (!res) return;
    const ctx = raceCtxRef.current;
    const s = readSave();
    const bossData = res.boss ? bossById(res.boss) : null;
    const rec = recordRace(s, res, { boss: bossData });
    let cupNotices = [];
    if (ctx?.cupId != null) {
      const out = recordCupEvent(s, ctx.cupId, ctx.eventIdx, res, champPointsFor(res.place));
      cupNotices = out.notices || [];
      const cup = CUPS.find((c) => c.id === ctx.cupId);
      if (cup?.championship && out.prog && !out.prog.won) {
        const pts = (out.prog.points || []).reduce((a, b) => a + (b || 0), 0);
        cupNotices.push({ kind: "cup", text: `Championship standings: ${pts} pts after ${out.prog.eventsDone}/${cup.events.length} races (+${champPointsFor(res.place)} this race)` });
      }
    }
    setSave({ ...s });
    setResults({ ...res, notices: [...rec.notices, ...cupNotices], unlocked: rec.unlocked, ctx });
  }, []);

  /* keep the race view on screen when a race starts */
  useEffect(() => {
    if (screen === "racing") wrapRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [screen]);

  /* ---------------- race loop ---------------- */
  useEffect(() => {
    if (screen !== "racing") return undefined;
    const canvas = glRef.current;
    const hudCanvas = hudRef.current;
    const view = createRaceScene(canvas, qualityFor());
    viewRef.current = view;
    view.setRace(raceRef.current);

    const resize = () => {
      const el = wrapRef.current;
      if (!el) return;
      const w = el.clientWidth, h = el.clientHeight;
      view.resize(w, h);
      hudCanvas.width = w; hudCanvas.height = h;
    };
    resize();
    window.addEventListener("resize", resize);
    lastRef.current = performance.now();

    const ctx2d = hudCanvas.getContext("2d");

    const loop = (now) => {
      rafRef.current = requestAnimationFrame(loop);
      const race = raceRef.current;
      if (!race) return;
      let dt = Math.min(0.1, (now - lastRef.current) / 1000);
      lastRef.current = now;
      if (slowMoRef.current > 0) { dt *= 0.35; slowMoRef.current -= dt; }

      const keys = keysRef.current;
      const inp = inputRef.current;
      const kb = {
        steer: (keys["arrowleft"] || keys["a"] ? -1 : 0) + (keys["arrowright"] || keys["d"] ? 1 : 0),
        throttle: keys["arrowup"] || keys["w"] ? 1 : 0,
        brake: keys["arrowdown"] || keys["s"] ? 1 : 0,
        drift: !!keys[" "],
        nitro: !!keys["shift"],
      };
      const input = {
        steer: Math.max(-1, Math.min(1, kb.steer + inp.steer)),
        throttle: Math.max(kb.throttle, inp.throttle),
        brake: Math.max(kb.brake, inp.brake),
        drift: kb.drift || inp.drift,
        nitro: kb.nitro || inp.nitro,
      };
      /* hidden demo/test autopilot: window.__ktrAutopilot = true */
      if (window.__ktrAutopilot && !race.player.finished) {
        if (!race.player.ai) race.player.ai = personalityFor(race.player.driver, 1, mulberry(7));
        Object.assign(input, aiInput(race, race.player, dt));
      }
      window.__ktrRace = race;

      const isPaused = pausedRef.current;
      if (!isPaused) {
        /* combo buffer: fire when the window closes */
        const buf = comboBufRef.current;
        if (buf.slots.length) {
          buf.t -= dt;
          if (buf.t <= 0 || buf.slots.length >= 3) {
            const filled = buf.slots.filter((i) => race.player.slots[i]);
            if (filled.length >= 2) tryCombo(race, race.player, filled);
            else if (filled.length === 1) activateSlot(race, race.player, filled[0]);
            buf.slots = [];
          }
        }

        let steps = 0;
        let rem = dt;
        while (rem > 0 && steps < 8) {
          const h = Math.min(MAX_SUB, rem);
          stepRace(race, input, h);
          rem -= h; steps++;
        }

        /* wrong-way detection */
        const pb = race.player.body;
        if (!pb.airborne && pb.route < 0 && race.state === "racing" && !race.player.finished) {
          const s = race.track.samples[pb.seg];
          let d = pb.heading - s.ang;
          while (d > Math.PI) d -= 2 * Math.PI;
          while (d < -Math.PI) d += 2 * Math.PI;
          if (Math.abs(d) > 2.4 && pb.speed > 6) wrongWayRef.current += dt;
          else wrongWayRef.current = 0;
        } else wrongWayRef.current = 0;

        /* rival taunts on being overtaken */
        if (race.player.place > prevPlaceRef.current && race.state === "racing" && Math.random() < 0.4) {
          const rival = race.racers.find((r) => r.place === race.player.place - 1 && !r.isPlayer);
          if (rival?.driver.taunts) {
            race.events.push({ t: "taunt", name: rival.driver.name, line: rival.driver.taunts[Math.floor(Math.random() * rival.driver.taunts.length)] });
          }
        }
        prevPlaceRef.current = race.player.place;

        /* drain events */
        for (const e of drainEvents(race)) {
          hudEvent(hudStateRef.current, e, race);
          audioRef.current?.onRaceEvent(e, race);
          if (e.t === "raceOver") {
            if (race.results?.photoFinish) { slowMoRef.current = 1.2; audioRef.current?.play("photo"); }
            finishRaceUI(race);
          }
        }
      }

      /* audio engine follows the player */
      const p = race.player;
      audioRef.current?.engine(
        Math.min(1, Math.abs(p.body.speed) / 70),
        p.fx.boostTime > 0, p.body.drift && !p.body.airborne, !!p.body.inTunnel,
        !!p.body.reversing,
      );

      view.frame(isPaused ? 0 : dt, race, input);
      drawHud(ctx2d, hudCanvas.width, hudCanvas.height, race, hudStateRef.current, isPaused ? 0 : dt,
        { wrongWay: wrongWayRef.current > 1.2 });
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      view.dispose();
      viewRef.current = null;
      audioRef.current?.stopEngine();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  const exitRace = useCallback(() => {
    raceRef.current = null;
    setResults(null);
    setPaused(false);
    setScreen(raceCtxRef.current?.cupId ? "career" : "menu");
  }, []);

  const nextCupEvent = useCallback(() => {
    const ctx = raceCtxRef.current;
    if (!ctx) return exitRace();
    const cup = CUPS.find((c) => c.id === ctx.cupId);
    const s = readSave();
    const prog = s.cupProgress[ctx.cupId] || { eventsDone: 0 };
    if (prog.eventsDone >= cup.events.length || prog.won) return exitRace();
    const idx = prog.eventsDone;
    const ev = cup.events[idx];
    startRace(
      { trackId: ev.track, type: ev.type, laps: ev.laps, bossId: ev.boss, difficulty: CUPS.indexOf(cup) * 0.35 },
      { cupId: cup.id, eventIdx: idx },
    );
  }, [exitRace, startRace]);

  /* ---------------- touch helpers ---------------- */
  /* touch-action:none in CSS stops scrolling; no preventDefault needed
     (React registers touch listeners passively). */
  const bindHold = (fn) => ({
    onTouchStart: () => { fn(true); audioRef.current?.resume(); },
    onTouchEnd: () => fn(false),
    onTouchCancel: () => fn(false),
    onMouseDown: () => fn(true),
    onMouseUp: () => fn(false),
    onMouseLeave: () => fn(false),
  });

  /* ================================================================ *
   * SCREENS
   * ================================================================ */
  const daily = dailyChallenge(save);
  const selDriver = driverById(save.selectedDriver);
  const selCar = carById(save.selectedCar);

  const header = (
    <div className="trTopBar">
      <button type="button" className="trBtn trBtn--ghost" onClick={() => { audioRef.current?.play("click"); setScreen("menu"); }}>
        ‹ Menu
      </button>
      <span className="trCoins">● {save.coins}</span>
      <span className="trTrophies">🏆 {trophiesOf(save)} · ⭐ {save.stars}</span>
    </div>
  );

  /* ---------------- MENU ---------------- */
  if (screen === "menu") {
    return (
      <div className="turboRush trMenuBg" ref={wrapRef}>
        <div className="trTitleWrap">
          <h2 className="trTitle">KIANIMATION<span>TURBO RUSH</span></h2>
          <p className="trTag">9 drivers · 14 machines · 12 worlds from the beach to the asteroid belt</p>
        </div>
        <div className="trMenuGrid">
          <button type="button" className="trCard trCard--big" onClick={() => setScreen("career")}>
            <strong>🏁 Career</strong>
            <span>{trophiesOf(save)}/9 cups won — bosses await</span>
          </button>
          <button type="button" className="trCard" onClick={() => setScreen("single")}>
            <strong>🎯 Single Race</strong><span>Any unlocked track, any mode</span>
          </button>
          <button type="button" className="trCard" onClick={() => setScreen("garage")}>
            <strong>🔧 Garage</strong><span>{selDriver.name} · {selCar.name}</span>
          </button>
          <button type="button" className="trCard" onClick={() => setScreen("driverShop")}>
            <strong>🪪 Driver Shop</strong><span>{save.unlockedDrivers.length}/9 drivers</span>
          </button>
          <button type="button" className="trCard" onClick={() => setScreen("carShop")}>
            <strong>🚗 Car Shop</strong><span>{save.unlockedCars.length}/{CARS.length} machines</span>
          </button>
          <button type="button" className="trCard" onClick={() => setScreen("achievements")}>
            <strong>🎖 Achievements</strong><span>{save.achievements.length}/{ACHIEVEMENTS.length}</span>
          </button>
          <button
            type="button"
            className={`trCard trCard--daily ${daily.done ? "trCard--done" : ""}`}
            onClick={() => !daily.done && trackUnlocked(save, daily.trackId) &&
              startRace({ trackId: daily.trackId, type: daily.type, difficulty: 1 })}
          >
            <strong>📅 Daily Challenge</strong>
            <span>
              {daily.done ? "Done — come back tomorrow!" :
                `${EVENT_TYPES[daily.type].name} @ ${trackById(daily.trackId).name} · +${daily.reward}`}
            </span>
          </button>
        </div>
        <div className="trMenuFoot">
          <span className="trCoins">● {save.coins} coins</span>
          <label className="trToggle">
            <input type="checkbox" checked={muted} onChange={(e) => {
              setMuted(e.target.checked);
              persist({ ...save, settings: { ...save.settings, muted: e.target.checked } });
            }} /> Mute
          </label>
          <select
            className="trSelect" value={save.settings.quality} aria-label="Graphics quality"
            onChange={(e) => persist({ ...save, settings: { ...save.settings, quality: e.target.value } })}
          >
            <option value="auto">Auto quality</option>
            <option value="high">High quality</option>
            <option value="low">Low quality (fast)</option>
          </select>
          <select
            className="trSelect" value={save.settings.touch} aria-label="Touch controls"
            onChange={(e) => persist({ ...save, settings: { ...save.settings, touch: e.target.value } })}
          >
            <option value="auto">Touch: auto</option>
            <option value="on">Touch: on</option>
            <option value="off">Touch: off</option>
          </select>
          <button
            type="button" className="trBtn trBtn--ghost"
            onClick={() => { if (window.confirm("Reset ALL Turbo Rush progress?")) persist(freshSave()); }}
          >Reset save</button>
        </div>
        <div className="trHelp">
          {KEY_HELP.map(([k, v]) => <p key={k}><b>{k}</b> {v}</p>)}
        </div>
      </div>
    );
  }

  /* ---------------- CAREER ---------------- */
  if (screen === "career") {
    return (
      <div className="turboRush trMenuBg">
        {header}
        <h3 className="trH3">Career — win cups, unlock worlds, beat the bosses</h3>
        <div className="trCupList">
          {CUPS.map((cup) => {
            const unlockedC = cupUnlocked(save, cup);
            const prog = save.cupProgress[cup.id] || { eventsDone: 0, won: false };
            return (
              <div key={cup.id} className={`trCup ${!unlockedC ? "trCup--locked" : ""} ${prog.won ? "trCup--won" : ""}`}>
                <div className="trCupHead">
                  <strong>{prog.won ? "🏆 " : ""}{cup.name}</strong>
                  <span className="trTier">{cup.tier}{cup.championship ? " · Championship" : ""}</span>
                </div>
                <p>{cup.blurb}</p>
                {!unlockedC && <p className="trLockLine">🔒 Needs {cup.need} {cup.need === 1 ? "trophy" : "trophies"}</p>}
                {unlockedC && (
                  <div className="trEventRow">
                    {cup.events.map((ev, i) => {
                      const done = i < prog.eventsDone || prog.won;
                      const next = i === prog.eventsDone && !prog.won;
                      const t = trackById(ev.track);
                      return (
                        <button
                          key={i} type="button"
                          className={`trEvent ${done ? "trEvent--done" : ""} ${next ? "trEvent--next" : ""}`}
                          disabled={!next && !done}
                          onClick={() => next && startRace(
                            { trackId: ev.track, type: ev.type, laps: ev.laps, bossId: ev.boss, difficulty: CUPS.indexOf(cup) * 0.35 },
                            { cupId: cup.id, eventIdx: i },
                          )}
                        >
                          <b>{ev.boss ? `⚔ ${bossById(ev.boss).name}` : EVENT_TYPES[ev.type].name}</b>
                          <span>{t.name}</span>
                          {done && <em>✓</em>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  /* ---------------- SINGLE RACE ---------------- */
  if (screen === "single") {
    const t = trackById(singleCfg.trackId);
    return (
      <div className="turboRush trMenuBg">
        {header}
        <h3 className="trH3">Single race</h3>
        <div className="trSingleGrid">
          <div className="trTrackPick">
            {TRACKS.map((tr) => {
              const open = trackUnlocked(save, tr.id);
              return (
                <button
                  key={tr.id} type="button"
                  className={`trTrackCard ${singleCfg.trackId === tr.id ? "trTrackCard--sel" : ""} ${!open ? "trTrackCard--locked" : ""}`}
                  onClick={() => open && setSingleCfg((c) => ({ ...c, trackId: tr.id }))}
                >
                  <b>{tr.world === "space" ? "🌌 " : ""}{tr.name}</b>
                  <span>{open ? tr.blurb : "🔒 Win more cups to unlock"}</span>
                  {save.bestTimes[tr.id] && <em>best {save.bestTimes[tr.id].toFixed(1)}s · {save.emblems[tr.id] || 0}/3 ❋</em>}
                </button>
              );
            })}
          </div>
          <div className="trSinglePanel">
            <label>Event
              <select className="trSelect" value={singleCfg.type} onChange={(e) => setSingleCfg((c) => ({ ...c, type: e.target.value }))}>
                {Object.entries(EVENT_TYPES).filter(([k]) => k !== "boss").map(([k, v]) => (
                  <option key={k} value={k}>{v.name}</option>
                ))}
              </select>
            </label>
            <label>Laps
              <select className="trSelect" value={singleCfg.laps} onChange={(e) => setSingleCfg((c) => ({ ...c, laps: +e.target.value }))}>
                {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label>Weather
              <select className="trSelect" value={singleCfg.weather} onChange={(e) => setSingleCfg((c) => ({ ...c, weather: e.target.value }))}>
                <option value="default">Track default</option>
                {t.weather.map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
            </label>
            <p className="trDim">{EVENT_TYPES[singleCfg.type].blurb}</p>
            {BOSSES.some((b) => b.track === t.id && save.bossesBeaten.includes(b.id)) && (
              <button
                type="button" className="trBtn trBtn--ghost"
                onClick={() => startRace({ trackId: t.id, type: "boss", laps: 2, bossId: BOSSES.find((b) => b.track === t.id).id, difficulty: 1 })}
              >⚔ Rematch the boss</button>
            )}
            <button
              type="button" className="trBtn trBtn--go"
              onClick={() => startRace({
                trackId: singleCfg.trackId, type: singleCfg.type, laps: singleCfg.laps,
                weather: singleCfg.weather === "default" ? undefined : singleCfg.weather,
                difficulty: Math.min(2, trophiesOf(save) * 0.25),
              })}
            >START RACE</button>
          </div>
        </div>
      </div>
    );
  }

  /* ---------------- GARAGE ---------------- */
  if (screen === "garage") {
    const ups = save.upgrades[save.selectedCar] || {};
    return (
      <div className="turboRush trMenuBg">
        {header}
        <div className="trTabs">
          {["car", "driver", "upgrades", "style"].map((tab) => (
            <button key={tab} type="button" className={`trTab ${garageTab === tab ? "trTab--sel" : ""}`} onClick={() => setGarageTab(tab)}>
              {{ car: "Cars", driver: "Drivers", upgrades: "Upgrades", style: "Style" }[tab]}
            </button>
          ))}
        </div>
        {garageTab === "car" && (
          <div className="trGrid">
            {CARS.filter((c) => save.unlockedCars.includes(c.id)).map((c) => (
              <button
                key={c.id} type="button"
                className={`trItemCard ${save.selectedCar === c.id ? "trItemCard--sel" : ""}`}
                onClick={() => persist({ ...save, selectedCar: c.id })}
              >
                <b>{c.name}</b><span className="trDim">{c.blurb}</span>
                <StatBars stats={c.stats} />
              </button>
            ))}
          </div>
        )}
        {garageTab === "driver" && (
          <div className="trGrid">
            {DRIVERS.filter((d) => save.unlockedDrivers.includes(d.id)).map((d) => (
              <button
                key={d.id} type="button"
                className={`trItemCard ${save.selectedDriver === d.id ? "trItemCard--sel" : ""}`}
                onClick={() => persist({ ...save, selectedDriver: d.id })}
              >
                <div className="trDriverRow"><DriverFace look={d.look} /><b>{d.name}</b></div>
                <span className="trDim">{d.styleLabel} — {d.personality}</span>
                <span className="trAbility">★ {d.ability.label}: {d.ability.blurb}</span>
              </button>
            ))}
          </div>
        )}
        {garageTab === "upgrades" && (
          <div className="trUpgrades">
            <p className="trDim">Upgrading: <b>{selCar.name}</b></p>
            {UPGRADES.map((u) => {
              const lvl = ups[u.id] || 0;
              const cost = upgradeCost(lvl);
              return (
                <div key={u.id} className="trUpRow">
                  <span className="trUpName">{u.icon} {u.name}</span>
                  <span className="trPips">{Array.from({ length: UPGRADE_MAX }, (_, i) => (
                    <i key={i} className={i < lvl ? "trPip trPip--on" : "trPip"} />
                  ))}</span>
                  <button
                    type="button" className="trBtn trBtn--small"
                    disabled={lvl >= UPGRADE_MAX || save.coins < cost}
                    onClick={() => { const s2 = buyUpgrade({ ...save }, save.selectedCar, u.id); if (s2) { setSave({ ...s2 }); audioRef.current?.play("buy"); } }}
                  >{lvl >= UPGRADE_MAX ? "MAX" : `● ${cost}`}</button>
                </div>
              );
            })}
          </div>
        )}
        {garageTab === "style" && (
          <div className="trStyle">
            <p className="trDim">Paint</p>
            <div className="trSwatchRow">{PAINTS.map((p) => (
              <button key={p.id} type="button" title={p.name} className={`trSwatch ${save.cosmetics.paint === p.c ? "trSwatch--sel" : ""}`}
                style={{ background: p.c }} onClick={() => persist({ ...save, cosmetics: { ...save.cosmetics, paint: p.c } })} />
            ))}</div>
            <p className="trDim">Decal</p>
            <div className="trChipRow">{DECALS.map((d) => (
              <button key={d.id} type="button" className={`trChip ${save.cosmetics.decal === d.id ? "trChip--sel" : ""}`}
                onClick={() => persist({ ...save, cosmetics: { ...save.cosmetics, decal: d.id } })}>{d.name}</button>
            ))}</div>
            <p className="trDim">Wheels</p>
            <div className="trChipRow">{WHEELS.map((w) => (
              <button key={w.id} type="button" className={`trChip ${save.cosmetics.rim === w.rim ? "trChip--sel" : ""}`}
                onClick={() => persist({ ...save, cosmetics: { ...save.cosmetics, rim: w.rim } })}>{w.name}</button>
            ))}</div>
            <p className="trDim">Boost flame</p>
            <div className="trChipRow">{FLAMES.map((f) => (
              <button key={f.id} type="button" className={`trChip ${save.cosmetics.flame === f.c ? "trChip--sel" : ""}`}
                onClick={() => persist({ ...save, cosmetics: { ...save.cosmetics, flame: f.c } })}>{f.name}</button>
            ))}</div>
            <p className="trDim">Underglow</p>
            <div className="trChipRow">{GLOWS.map((g) => (
              <button key={g.id} type="button" className={`trChip ${save.cosmetics.glow === g.c ? "trChip--sel" : ""}`}
                onClick={() => persist({ ...save, cosmetics: { ...save.cosmetics, glow: g.c } })}>{g.name}</button>
            ))}</div>
          </div>
        )}
      </div>
    );
  }

  /* ---------------- SHOPS ---------------- */
  if (screen === "driverShop" || screen === "carShop") {
    const isDrivers = screen === "driverShop";
    const items = isDrivers ? DRIVERS : CARS;
    return (
      <div className="turboRush trMenuBg">
        {header}
        <h3 className="trH3">{isDrivers ? "Driver shop" : "Car shop"}</h3>
        <div className="trGrid">
          {items.map((it) => {
            const owned = (isDrivers ? save.unlockedDrivers : save.unlockedCars).includes(it.id);
            const avail = isDrivers ? driverAvailable(save, it) : carAvailable(save, it);
            return (
              <div key={it.id} className={`trItemCard ${owned ? "trItemCard--owned" : ""}`}>
                {isDrivers
                  ? <div className="trDriverRow"><DriverFace look={it.look} /><b>{it.name}</b></div>
                  : <b>{it.name}</b>}
                <span className="trDim">{isDrivers ? `${it.styleLabel} — ${it.personality}` : it.blurb}</span>
                {isDrivers && <span className="trAbility">★ {it.ability.label}: {it.ability.blurb}</span>}
                {!isDrivers && <StatBars stats={it.stats} />}
                {owned ? <span className="trOwned">OWNED</span>
                  : avail.why ? <span className="trLockLine">🔒 {avail.why}</span>
                    : (
                      <button
                        type="button" className="trBtn trBtn--small" disabled={save.coins < (avail.buy || 0)}
                        onClick={() => {
                          const s2 = isDrivers ? buyDriver({ ...save }, it.id) : buyCar({ ...save }, it.id);
                          if (s2) { setSave({ ...s2 }); audioRef.current?.play("buy"); }
                        }}
                      >Buy · ● {avail.buy}</button>
                    )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  /* ---------------- ACHIEVEMENTS ---------------- */
  if (screen === "achievements") {
    return (
      <div className="turboRush trMenuBg">
        {header}
        <h3 className="trH3">Achievements</h3>
        <div className="trGrid">
          {ACHIEVEMENTS.map((a) => (
            <div key={a.id} className={`trItemCard ${save.achievements.includes(a.id) ? "trItemCard--owned" : ""}`}>
              <b>{save.achievements.includes(a.id) ? "✅" : "▫"} {a.name}</b>
              <span className="trDim">{a.blurb} · +{a.coins} coins</span>
            </div>
          ))}
        </div>
        <h3 className="trH3">Power-up combos discovered in the lab</h3>
        <div className="trComboList">
          {COMBOS.map((c) => (
            <span key={c.key} className="trComboChip">
              {c.ids.map((id) => POWERUPS[id].icon).join("+")} {c.name}
            </span>
          ))}
        </div>
      </div>
    );
  }

  /* ---------------- RACING ---------------- */
  return (
    <div className="turboRush trRaceWrap" ref={wrapRef}>
      <canvas ref={glRef} className="trGl" />
      <canvas ref={hudRef} className="trHudCanvas" />

      {bossIntro && (
        <div className="trBossIntro">
          <DriverFace look={bossIntro.look} size={72} />
          <div>
            <strong>{bossIntro.name}</strong>
            <p>“{bossIntro.intro}”</p>
            <em>{bossIntro.behaviour}</em>
          </div>
        </div>
      )}

      {/* Touch handlers only mutate inputRef inside pointer events — never
          during render — so the refs rule's warning here is a false positive. */}
      {/* eslint-disable react-hooks/refs */}
      {touch && !results && (
        <>
          <div className="trTouchLeft">
            <button type="button" className="trTouchBtn" {...bindHold((v) => { inputRef.current.steer = v ? -1 : (inputRef.current.steer === -1 ? 0 : inputRef.current.steer); })}>◀</button>
            <button type="button" className="trTouchBtn" {...bindHold((v) => { inputRef.current.steer = v ? 1 : (inputRef.current.steer === 1 ? 0 : inputRef.current.steer); })}>▶</button>
          </div>
          <div className="trTouchRight">
            <button type="button" className="trTouchBtn trTouchBtn--small" {...bindHold((v) => { inputRef.current.nitro = v; })}>🔥</button>
            <button type="button" className="trTouchBtn trTouchBtn--small" {...bindHold((v) => { inputRef.current.drift = v; })}>DRIFT</button>
            <button type="button" className="trTouchBtn" {...bindHold((v) => { inputRef.current.brake = v ? 1 : 0; })}>▼</button>
            <button type="button" className="trTouchBtn trTouchBtn--gas" {...bindHold((v) => { inputRef.current.throttle = v ? 1 : 0; })}>▲</button>
          </div>
          <div className="trTouchSlots">
            {[0, 1, 2].map((i) => (
              <button
                key={i} type="button" className="trTouchSlot"
                onTouchStart={() => pressSlot(i)}
                onMouseDown={() => pressSlot(i)}
              >{i + 1}</button>
            ))}
          </div>
        </>
      )}
      {/* eslint-enable react-hooks/refs */}

      <button type="button" className="trPauseBtn" onClick={() => setPaused((p) => !p)} aria-label="Pause">⏸</button>

      {paused && !results && (
        <div className="trOverlay">
          <div className="trPanel">
            <h3>Paused</h3>
            <button type="button" className="trBtn trBtn--go" onClick={() => setPaused(false)}>Resume</button>
            <button type="button" className="trBtn trBtn--ghost" onClick={exitRace}>Quit race</button>
            <label className="trToggle"><input type="checkbox" checked={muted} onChange={(e) => setMuted(e.target.checked)} /> Mute</label>
          </div>
        </div>
      )}

      {results && (
        <div className="trOverlay">
          <div className="trPanel trPanel--results">
            <h3>{results.won ? "🏆 VICTORY!" : results.place <= 3 ? "Podium finish!" : "Race over"}</h3>
            {results.photoFinish && <p className="trPhoto">📸 PHOTO FINISH — won by {(results.order[1]?.time - results.time).toFixed(2)}s!</p>}
            <ol className="trResultList">
              {results.order.map((o, i) => (
                <li key={i} className={o.isPlayer ? "trMe" : ""}>
                  <span>{o.isBoss ? "⚔ " : ""}{o.name}</span>
                  <span>{o.eliminated ? "OUT" : o.time ? `${o.time.toFixed(1)}s` : "DNF"}</span>
                </li>
              ))}
            </ol>
            <div className="trRewardRow">
              <span>+{results.coins} ●</span>
              {results.stars > 0 && <span>{"⭐".repeat(results.stars)}</span>}
              {results.driftScore > 0 && <span>drift {results.driftScore}</span>}
              {results.combos > 0 && <span>{results.combos} combos</span>}
              {results.usedShortcut && <span>🗺 {results.usedShortcut}</span>}
              {results.emblemsFound > 0 && <span>❋ ×{results.emblemsFound}</span>}
            </div>
            {results.notices?.map((n, i) => <p key={i} className={`trNotice trNotice--${n.kind}`}>{n.text}</p>)}
            {results.ctx?.cupId && !save.cupProgress[results.ctx.cupId]?.won && (readSave().cupProgress[results.ctx.cupId]?.eventsDone || 0) < (CUPS.find((c) => c.id === results.ctx.cupId)?.events.length || 0)
              ? <button type="button" className="trBtn trBtn--go" onClick={nextCupEvent}>
                  {results.place <= 3 ? "Next event ›" : "Retry event ↻"}
                </button>
              : null}
            <button type="button" className="trBtn trBtn--ghost" onClick={exitRace}>
              {results.ctx?.cupId ? "Back to career" : "Back to menu"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
