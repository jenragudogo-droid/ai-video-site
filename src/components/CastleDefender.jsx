import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  makeGame, startStage, stepGame, drainEvents, summarise, setLayout,
  buildTower, upgradeTower, sellTower, sellValue, setRally, fireTowerAbility, towerAbility,
  moveHero, heroCharge, castVolley, castReinforce, repairCastle, callWave,
  plotAt, canBuild, canUpgrade, nextWaveSummary, towerLevel, PLOT_R,
  canDrill, setDrill, DRILL_COST, canMount, setMount, MOUNT_COST,
  serializeGame, restoreGame, orderUnits, unitAt, squadOf, isFullSquad, sharedAbility, triggerUnitAbility,
  castBurningOil, castEmergencyRepair, castBarrage, setFormation, formationFor, stagePowers, powerWave, kingsCharge, guardCount,
  heroAbility,
  choosePerk, skipPerk, powerUnlocked, castWatchfire, castRoyalRally, buildCost, upgradeCostFor, repairCost,
} from "./castleDefender/engine/engine.js";
import { createRenderer } from "./castleDefender/render.js";
import { createCastleAudio } from "./castleDefender/audio.js";
import { readSave, recordResult, saveSettings, resetProgress, stageRecord, totalStars, isStageUnlocked, saveBattle, clearBattle, saveDifficulty, buyUpgrade, badgesOf,
  KINGDOM_ORDER, isKingdomUnlocked, stagesOf,
} from "./castleDefender/save.js";
import { PERK_BY_ID, RARITY, POWERS } from "./castleDefender/data/perks.js";
import { CATEGORIES, KINGDOM_UPGRADES, upgradeCost as kingdomCost } from "./castleDefender/data/progression.js";
import { STAGES } from "./castleDefender/data/stages.js";
import { KINGDOMS } from "./castleDefender/data/kingdoms.js";
import { FROZEN_NORTH, FROST_TEASERS, FROST_HERO, SUNSPEAR, SUN_TEASERS, SUN_HERO, BADGES } from "./castleDefender/data/frozenNorth.js";
import { TOWERS, TOWER_ORDER, ABILITIES, HERO, heroStatsOf, DIFFICULTY, SOLDIERS, PIKE_UNITS } from "./castleDefender/data/towers.js";
import { ENEMIES } from "./castleDefender/data/enemies.js";
import { fullscreenElement, onFullscreenChange, toggleGameFullscreen, unlockPageScroll } from "./fullscreen.js";
import { displayWave, waveCard, plural } from "./castleDefender/hudText.js";

const PERK_ICON = { archer: ["tower", "archer"], barracks: ["tower", "barracks"], catapult: ["tower", "catapult"], ballista: ["tower", "ballista"], hero: ["figure", "hero"], castle: ["tower", "barracks"], gold: ["figure", "militia"], ability: ["figure", "bowman"] };
const SAVE_DEBOUNCE = 1200;
const SAVE_PERIOD = 10;
import "./CastleDefender.css";

/* ------------------------------------------------------------------ *
 * Castle Defender — the React shell.
 *
 * React owns menus, HUD, the build ring and the sheets; the battle is
 * painted on one canvas by render.js from the pure simulation in
 * engine.js. This file is the only place the three meet: it feeds
 * input in, drains events out to the renderer and the audio, and
 * snapshots a few numbers for the HUD ten times a second.
 * ------------------------------------------------------------------ */

const MAX_SUB = 1 / 60;
const MAX_SUBSTEPS = 6;
const HUD_INTERVAL = 0.1;

const KEYS = [
  ["Click", "Select a plot or tower"],
  ["1 · 2 · 3 · 4", "Build on the selected plot"],
  ["U / S", "Upgrade / sell"],
  ["H", "Select Sir Edric, then click to move"],
  ["Q", "Royal Charge toward the cursor"],
  ["V / R / F", "Volley · Reinforce · Repair"],
  ["Space", "Call the next wave early"],
  ["P / Esc", "Pause"],
];
const TOUCH = [
  ["Tap a plot", "Open the build ring"],
  ["Tap a tower", "Upgrade, sell, rally, ability"],
  ["Hero button", "Then tap where he should go"],
  ["Hold hero button", "Royal Charge at the next tap"],
  ["Banner", "Call the next wave early for gold"],
];

/* Snowfall over the teaser panel: a fixed set so React never reshuffles
   it, and CSS does the drifting (and stops under reduced motion). */
/* The campaign map reads the kingdom order from the save module, so a new
   kingdom appears here the moment it has stages and an entry below. */
const REALMS = {
  ashford: {
    eyebrow: "Kingdom one",
    name: "The Realm of Ashford",
    blurb: "Green country, stone walls and the road south. Hold the gate against Blackmoor's warband.",
    badge: "defenderOfAshford",
    doneNote: "Greenhollow, Stonebridge Ford and the Siege of Ashford are all won.",
    hero: { id: "hero", name: "Sir Edric", note: "Knight of Ashford · sword and Royal Charge" },
  },
  frost: {
    eyebrow: "Kingdom two",
    name: "The Frozen North",
    blurb: "Snow, wolves and a storm that fights beside them. Take the pass, the hollow and the Cairnhold.",
    badge: "guardianOfTheFrozenNorth",
    doneNote: "Frostwatch Pass, Wolfpine Hollow and the Cairnhold are all held.",
    hero: { id: "elara", name: "Lady Elara", note: "Ranger of the North · bow, evasion and Frost Arrow" },
  },
};

const SNOW = [12, 47, 78, 26, 61, 90, 5, 35, 68, 84, 19, 54, 73, 41].map((x, i) => ({
  x, d: (i * 0.83) % 5, t: 6 + ((i * 1.7) % 5), s: i % 3 === 0 ? 3 : 2,
}));

function IconCanvas({ kind, id, w = 48, h = 48, renderer, className, fluid = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current;
    const r = renderer.current;
    if (!c || !r) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = w * dpr; c.height = h * dpr;
    const ctx = c.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    r.drawIcon(ctx, kind, id, w, h);
  }, [kind, id, w, h, renderer]);
  return <canvas ref={ref} className={className} style={fluid ? undefined : { width: w, height: h }} aria-hidden="true" />;
}

function Stars({ n, big }) {
  return (
    <span className={`cdStars ${big ? "cdStars--big" : ""}`} aria-label={`${n} of 3 stars`}>
      {[1, 2, 3].map((i) => <span key={i} className={i <= n ? "is-on" : ""}>★</span>)}
    </span>
  );
}

function fmt(n) { return Math.round(n).toLocaleString(); }

export default function CastleDefender() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const gameRef = useRef(null);
  const menuGameRef = useRef(null);
  const audioRef = useRef(null);
  const screenRef = useRef("menu");
  const lastRef = useRef(0);
  const viewRef = useRef({ w: 800, h: 450 });
  const hudClock = useRef(0);
  const bankedRef = useRef(true);
  const pointerRef = useRef(null);
  const ringRef = useRef(null);
  const waveBtnRef = useRef(null);
  const topRef = useRef(null);
  const sheetRef = useRef(null);
  const modeRef = useRef(null);
  const selRef = useRef(-1);
  const heroSelRef = useRef(false);
  const fpsRef = useRef({ frames: 0, t: 0, decided: false });
  const bannerId = useRef(0);
  const holdRef = useRef(null);
  const introStartedRef = useRef(false);
  const outroRef = useRef(false);
  const saveTimerRef = useRef(null);
  const lastSaveRef = useRef(0);
  const selUnitsRef = useRef([]);
  const multiRef = useRef(false);
  const shiftHeld = useRef(false);

  const [screen, setScreenState] = useState("menu");
  const [game, setGame] = useState(null);
  const [profile, setProfile] = useState(() => readSave());
  const [hud, setHud] = useState(null);
  const [selected, setSelected] = useState(-1);
  const [mode, setMode] = useState(null);           // rally | hero | charge | volley | reinforce | ability
  const [heroSel, setHeroSel] = useState(false);
  const [banners, setBanners] = useState([]);
  const [results, setResults] = useState(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [pseudoFull, setPseudoFull] = useState(false);
  const [howPage, setHowPage] = useState(0);
  const [difficulty, setDifficultyState] = useState(() => readSave().difficulty || "normal");
  const [selUnits, setSelUnits] = useState([]);
  const [multi, setMulti] = useState(false);
  const [confirmNew, setConfirmNew] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [introPhase, setIntroPhase] = useState(0);
  const [confirmReset, setConfirmReset] = useState(false);
  const [starsShown, setStarsShown] = useState(0);
  const [coarse, setCoarse] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(pointer: coarse)").matches,
  );

  const settings = profile.settings;
  const setScreen = useCallback((v) => { screenRef.current = v; setScreenState(v); }, []);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { selRef.current = selected; }, [selected]);
  useEffect(() => { heroSelRef.current = heroSel; }, [heroSel]);
  useEffect(() => { selUnitsRef.current = selUnits; const s = gameRef.current; rendererRef.current?.setSelection({ units: new Set(selUnits), squad: !!s && isFullSquad(s, selUnits) }); }, [selUnits]);
  useEffect(() => { multiRef.current = multi; }, [multi]);
  const setDifficulty = useCallback((d) => { setDifficultyState(d); setProfile((p) => saveDifficulty(p, d)); }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia("(pointer: coarse)");
    const onChange = (e) => setCoarse(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  /* ------------------------------ banners ------------------------------ */

  const bannerTimers = useRef(new Set());
  const banner = useCallback((text, sub, kind = "wave", ms = 2600) => {
    const id = ++bannerId.current;
    /* a wave-start card stands alone: it replaces cleared/early-call notices */
    const waveKind = kind === "wave" || kind === "waveBig" || kind === "final";
    setBanners((b) => (waveKind ? [{ id, text, sub, kind }] : [...b.slice(-2), { id, text, sub, kind }]));
    const timer = setTimeout(() => { bannerTimers.current.delete(timer); setBanners((b) => b.filter((x) => x.id !== id)); }, ms);
    bannerTimers.current.add(timer);
  }, []);
  useEffect(() => () => { for (const t of bannerTimers.current) clearTimeout(t); bannerTimers.current.clear(); }, []);

  /* ------------------------------ canvas ------------------------------ */

  const layoutFor = useCallback((w, h) => (h > w * 1.05 ? "portrait" : "landscape"), []);

  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const r = rendererRef.current;
    if (!canvas || !wrap || !r) return;
    const rect = wrap.getBoundingClientRect();
    const raw = window.devicePixelRatio || 1;
    const q = readSave().settings.quality;
    const dpr = Math.min(raw, q === "low" ? 1.25 : coarse ? 1.75 : 2);
    const w = Math.max(300, Math.floor(rect.width));
    const h = Math.max(220, Math.floor(rect.height));
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
    viewRef.current = { w, h, dpr };
    r.setView(w, h, dpr);
    const s = gameRef.current;
    const want = layoutFor(w, h);
    if (s && s.layout.name !== want) setLayout(s, want);
    const m = menuGameRef.current;
    if (m && m.layout.name !== want) setLayout(m, want);
  }, [coarse, layoutFor]);

  useEffect(() => {
    rendererRef.current = createRenderer();
    menuGameRef.current = makeGame({ stageId: "greenhollow", layout: "landscape" });
    const q = readSave().settings.quality;
    rendererRef.current.setQuality(q === "low" ? 0.6 : 1);
    resize();
    if (import.meta.env?.DEV && typeof window !== "undefined") {
      window.__castle = { game: gameRef, renderer: rendererRef, view: viewRef, menu: menuGameRef, screen: screenRef, audio: audioRef };
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
    const a = createCastleAudio();
    audioRef.current = a;
    const st = readSave().settings;
    a.setSound(st.sound); a.setMusic(st.music); a.setVolumes(st.sfxVol, st.musicVol);
    return () => { a.dispose(); audioRef.current = null; };
  }, []);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.setSound(settings.sound); a.setMusic(settings.music); a.setVolumes(settings.sfxVol, settings.musicVol);
  }, [settings.sound, settings.music, settings.sfxVol, settings.musicVol]);

  useEffect(() => {
    const r = rendererRef.current;
    if (r) r.setQuality(settings.quality === "low" ? 0.6 : 1);
    resize();
  }, [settings.quality, resize]);

  /* ------------------------------ music ------------------------------ */

  const musicFor = useCallback(() => {
    const scr = screenRef.current;
    const s = gameRef.current;
    if (scr === "menu" || scr === "campaign" || scr === "kingdoms" || scr === "howto" || scr === "settings") return "menu";
    if (scr === "intro") return "calm";
    if (scr === "playing" || scr === "paused") {
      if (!s) return "calm";
      if (s.enemies.some((e) => e.def.boss && e.state !== "dead" && !(e.boss && e.boss.phase === 1))) return "boss";
      if (s.stage.finale && s.waveState === "active") return "siege";
      if (s.waveState !== "active") return "calm";
      /* the north gets its own colder battle theme */
      return s.stage.kingdom === "frost" ? "frost" : "battle";
    }
    return null;
  }, []);

  /* ------------------------------ autosave ------------------------------ */

  /* Writes the battle to the save slot. Called directly at the moments
     that matter (wave cleared, build, leaving) and through a debounce
     for everything else, never per frame. */
  const saveNow = useCallback(() => {
    const s = gameRef.current;
    if (!s || s.phase !== "playing") return false;
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    try {
      const next = saveBattle(readSave(), serializeGame(s));
      setProfile(next);
      lastSaveRef.current = s.t;
      return true;
    } catch { return false; }
  }, []);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) return;
    saveTimerRef.current = setTimeout(() => { saveTimerRef.current = null; saveNow(); }, SAVE_DEBOUNCE);
  }, [saveNow]);

  useEffect(() => {
    const leave = () => { saveNow(); };
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
  useEffect(() => () => { saveNow(); if (saveTimerRef.current) clearTimeout(saveTimerRef.current); }, [saveNow]);

  /* ------------------------------ results ------------------------------ */

  const bankRun = useCallback(() => {
    const s = gameRef.current;
    if (!s || bankedRef.current) return null;
    bankedRef.current = true;
    const sum = summarise(s);
    const res = recordResult(readSave(), sum);
    setProfile(res.save);
    return { sum, ...res };
  }, []);

  const finishRun = useCallback((won) => {
    const s = gameRef.current;
    if (!s) return;
    /* always record the finished run: recordResult only ever raises records,
       so a partial bank from an earlier unmount cannot hide a victory */
    bankedRef.current = true;
    const sum = summarise(s);
    const res = recordResult(readSave(), sum);
    setProfile(res.save);
    setResults({ ...sum, newBest: res.newBest, newStars: res.newStars, newWave: res.newWave, crowns: res.crowns, realmComplete: res.realmComplete, newBadges: res.newBadges || [] });
    setSelected(-1); setMode(null); setHeroSel(false);
    rendererRef.current?.setSelection({ plot: -1, hover: -1, range: null, target: null });
    setStarsShown(0);
    setScreen(won ? "victory" : "defeat");
    const a = audioRef.current;
    a?.music(null);
    a?.play(won ? (sum.finale && sum.mode !== "endless" ? "conquered" : "victory") : "defeat");
    if (won) {
      for (let i = 1; i <= sum.stars; i += 1) setTimeout(() => { setStarsShown(i); audioRef.current?.play("star"); }, 900 + i * 500);
    }
  }, [setScreen]);

  /* ------------------------------ events ------------------------------ */

  const handleEvents = useCallback(() => {
    const s = gameRef.current;
    const a = audioRef.current;
    const r = rendererRef.current;
    if (!s) return;
    for (const e of drainEvents(s)) {
      r?.onEvent(e, s);
      switch (e.type) {
        case "arrow": a?.play("arrow"); break;
        case "enemyShoot": a?.play("enemyShoot"); break;
        case "bolt": a?.play("bolt"); break;
        case "catapult": a?.play("catapult"); break;
        case "stoneImpact": a?.play(e.fire ? "fireImpact" : "stoneImpact"); break;
        case "hit": if (e.dtype === "arrow" || e.dtype === "pierce") a?.play("arrowHit"); else if (e.dtype === "siege") a?.play("hit"); break;
        case "swing": a?.play("sword"); break;
        case "shieldBlock": a?.play("shieldBlock"); break;
        case "block": a?.play("block"); break;
        case "unitHit": a?.play("hit"); break;
        case "die": if (!e.boss) a?.play("die"); break;
        case "coin": a?.play("coin"); break;
        case "unitDown": a?.play("unitDown"); break;
        case "heroDown": { const hn = (s.heroDef || HERO); a?.play("heroDown"); banner(`${hn.name} has fallen`, `${hn.id === "elara" ? "She" : "He"} returns at the gate in 12 seconds`, "alert", 2400); break; }
        case "heroReturn": a?.play("heroReturn"); break;
        case "heroLevel": a?.play("heroLevel"); banner(`${(s.heroDef || HERO).name} reaches level ${e.level}`, "More health, harder blows, a faster recharge", "good", 2200); break;
        case "build": a?.play("build"); scheduleSave(); break;
        case "upgrade": a?.play("upgrade"); scheduleSave(); break;
        case "sell": a?.play("sell"); scheduleSave(); break;
        case "rally": a?.play("select"); break;
        case "wave": {
          if (s && s.stage.finale && (e.n === 1 || e.n === s.totalWaves)) a?.play("warDrums");
          const card = waveCard(e.n, e.total, s.stage.waveTitles, e.summary);
          scheduleSave();
          a?.play("wave");
          if (card.kind === "final") a?.play("march");
          banner(card.title, card.sub, card.kind, card.ms);
          break;
        }
        case "waveClear": a?.play("waveClear"); banner(`Wave ${e.n} cleared`, `+${e.bonus} gold`, "good", 2000); saveNow(); break;
        case "earlyBonus": a?.play("earlyBonus"); banner(`Early call  +${e.amount} gold`, "", "good", 1600); break;
        case "gateHit": a?.play(e.siege ? "gateHitSiege" : "gateHit"); break;
        case "spawn": if (e.enemy === "outrider" || e.enemy === "scoutCav") a?.play("hooves"); else if (e.enemy === "knightCav") a?.play("gallop"); else if (e.enemy === "ram") a?.play("spawnRam"); break;
        case "miniboss":
          if (e.enemy === "wolfDen") { a?.play("wolfHowl"); banner("Wolf den", "It keeps loosing wolves until it burns. Kill the den.", "boss", 3000); }
          else if (e.enemy === "frostCaptain") { a?.play("commanderEnter"); banner("A huscarl of the Jarl", "Everything near his horn fights harder. Cut him down.", "boss", 3200); }
          else if (e.enemy === "iceRam") { a?.play("spawnRam"); banner("Iron-Shod Ram", "It breaks the ice wall on its way to the gate.", "boss", 3000); }
          else if (e.enemy === "frostThrower") { a?.play("spawnRam"); banner("Frost trebuchet", "It halts in the snow and throws at the wall. Kill it first.", "boss", 3000); }
          else if (e.enemy === "cavCommander") { a?.play("commanderEnter"); banner("Captain Malric rides", "The Black Rider. He charges with a horn's warning and rallies the cavalry.", "boss", 3600); }
          else if (e.enemy === "siegeCatapult") { a?.play("spawnRam"); banner("Siege catapult", "It will halt in the field and pound the wall. Kill it first.", "boss", 3000); }
          else if (e.enemy === "siegeTower") { a?.play("spawnRam"); banner("Siege tower", "Slow and vast. Burn it before it reaches the wall.", "boss", 3000); }
          else if (e.enemy === "siegeRam") { a?.play("spawnRam"); banner("Iron Ram", "It will smash the outer wall on its way to the gate.", "boss", 3000); }
          else if (e.enemy === "warCaptain") { a?.play("commanderEnter"); banner("Warband Captain", "Everyone near his banner fights harder. Cut him down.", "boss", 3200); }
          else { a?.play("miniboss"); banner("Battering Ram", "Nothing blocks it. Ballistas and catapults, now.", "boss", 3200); }
          break;
        case "minibossDown": a?.play("minibossDown"); banner(s.stage.id === "stonebridge" && s.wave >= 10 ? "Captain Malric falls" : s.stage.finale ? "Siege engine destroyed" : "The ram is broken", "", "good", 2000); break;
        case "charge": a?.play("charge"); break;
        case "chargeHit": a?.play("chargeHit"); break;
        case "routeOpen": a?.play("routeOpen"); banner("A new road has opened", "The warband is coming from the north too", "alert", 3400); break;
        case "volley": a?.play("volley"); break;
        case "strike": a?.play("strike"); break;
        case "reinforce": a?.play("reinforce"); break;
        case "repair": a?.play("repair"); if (s) s.lastRepair = s.t; scheduleSave(); break;
        case "breakFree": a?.play("breakFree"); break;
        case "chargeWarn": a?.play(e.enemy === "cavCommander" ? "chargeHorn" : "rear"); if (e.enemy !== "cavCommander") a?.play("chargeHorn"); break;
        case "chargeStart": a?.play("chargeGo"); a?.play("gallop"); break;
        case "cavImpact": a?.play("cavImpact"); a?.play("armour"); break;
        case "chargeBroken": a?.play("chargeBroken"); if (e.by === "hero") banner("Charge broken", "Royal Charge stopped the rider", "good", 1600); break;
        case "brace": a?.play("brace"); break;
        case "drill": a?.play("drill"); scheduleSave(); break;
        case "mount": a?.play(e.mounted ? "gallop" : "drill"); if (e.mounted) banner("Royal Knights", "The Guard mounts up: faster, harder-hitting, with a Lance Charge. Arrows find riders more easily.", "good", 3200); scheduleSave(); break;
        case "order": a?.play("order"); saveNow(); break;
        case "unitAbility": a?.play(e.id === "braceSpears" ? "brace" : "shieldBrace"); saveNow(); break;
        case "perkOffer": a?.play("perk"); saveNow(); break;
        case "perk": a?.play("perk"); banner(e.name, `${RARITY[e.rarity]?.name || ""} perk chosen`, "good", 2000); saveNow(); break;
        case "unlock": a?.play(e.hero ? "kingsCharge" : "unlock"); banner(e.hero ? e.name : `New power: ${e.name}`, e.hero ? (e.desc || "") : POWERS[e.id]?.desc || "", "good", 3400); scheduleSave(); break;
        /* Stage III siege */
        case "siegeHalt": a?.play("march"); banner("Siege catapult in range", "It will pound the wall and the castle until it burns", "alert", 2600); break;
        case "catapultWarn": a?.play("catapultWind"); break;
        case "siegeShot": a?.play("catapultLaunch"); break;
        case "siegeImpact": a?.play("siegeStone"); break;
        case "wallHit": if (e.src !== "tower") a?.play("wallHit"); break;
        case "wallBreach": a?.play("wallBreach"); banner("The outer wall has fallen", "A breach is open. The warband will pour through it.", "boss", 3600); break;
        case "ramWall": a?.play("ramWall"); break;
        case "towerDock": a?.play("towerDock"); banner("Siege tower at the wall", "Its ramp is down. Burn it before it empties.", "alert", 3000); break;
        case "unload": a?.play("march"); break;
        case "towerBurn": a?.play("towerBurn"); break;
        case "engineerRepair": a?.play("hammer"); break;
        case "bossEnter":
          a?.play("bossEnter");
          if (e.enemy === "iceWarlord") banner("Jarl Vorne", "The ice takes every blow for him. Break it, then strike before it closes.", "boss", 4200);
          else banner("Warlord Blackmoor", "He waits at his camp behind his guard. Break the guard to draw him out.", "boss", 4200);
          break;
        case "bossPhase":
          if (e.boss === "vorne" || s.stage.kingdom === "frost") {
            if (e.phase === 2) { a?.play("bossEnter"); banner("Vorne comes down the road", "The ice re-forms after every break. Watch the ring before the nova.", "boss", 3600); }
            else { a?.play("bossRage"); banner("Vorne is enraged", "The ice will not return, and the storm comes with him.", "boss", 3800); }
          }
          else if (e.phase === 2) { a?.play("bossEnter"); banner("Blackmoor advances", "The Ironbreaker is coming for the gate. Watch for the sweep.", "boss", 3600); }
          else { a?.play("bossRage"); a?.play("bossRoar"); banner("Blackmoor is enraged", "He roars, untouchable, then comes on faster. Strike after every sweep.", "boss", 3800); }
          scheduleSave();
          break;
        case "bossWind": a?.play(e.kind === "sweep" ? "bossSweepWind" : e.kind === "nova" ? "novaWind" : e.kind === "blizzard" ? "bossHornWind" : "bossHornWind"); break;
        case "bossSweep": a?.play("bossSweep"); break;
        case "bossHorn": a?.play("chargeHorn"); banner("The horn of Blackmoor", "Reinforcements answer the call", "alert", 2200); break;
        case "bossDown": {
          const nm = s.stage.kingdom === "frost" ? "Vorne falls" : "Blackmoor falls";
          a?.play("bossDown");
          if (e.routed) { a?.play("rout"); banner(nm, s.stage.kingdom === "frost" ? "The host breaks and runs for the snow!" : "The warband breaks and runs!", "good", 3600); }
          else banner(nm, "Hold the gate!", "good", 3600);
          break;
        }
        case "bossOpen": a?.play("bossOpen"); break;
        case "bossRoarEnd": a?.play("chargeGo"); break;
        case "wallCrack": a?.play("wallCrack"); banner("The outer wall is cracking", "Half its strength is gone. Emergency Repair mends it.", "alert", 2800); break;
        case "gateFailing": a?.play("gateFailing"); banner("The gate is failing", "Repair the castle before the next push", "boss", 3200); break;
        case "kingsCharge": a?.play("kingsCharge"); break;
        case "oil": a?.play("oil"); break;
        case "emergencyRepair": a?.play("emergencyRepair"); if (s) s.lastRepair = s.t; scheduleSave(); break;
        case "barrage": a?.play("barrage"); break;
        case "formation": a?.play(e.kind === "pikeWall" ? "pikeWall" : e.kind === "shieldWall" ? "shieldWall" : "close"); saveNow(); break;
        /* the Frozen North */
        case "blizzard":
          if (e.on) { a?.play("blizzard"); banner("Blizzard", "Your towers shoot slower and see less until it blows over", "alert", 3000); }
          else { a?.play("windEase"); banner("The wind eases", "", "good", 1600); }
          scheduleSave();
          break;
        case "shellBreak": a?.play("shellBreak"); banner("The ice breaks", "Strike the Jarl before it closes again", "good", 2600); break;
        case "shellReform": a?.play("shellReform"); break;
        case "shellHit": break;
        case "bossNova": a?.play("frostNova"); break;
        case "bossHowl": a?.play("wolfHowl"); banner("The pack answers", "Wolves are coming in from the roads", "alert", 2400); break;
        case "frostArrow": a?.play("frostArrow"); break;
        case "frostBurst": a?.play("frostBurst"); break;
        case "heroShot": a?.play("bowShot"); break;
        case "heroEvade": a?.play("evade"); break;
        case "watchfire": a?.play("watchfire"); break;
        case "royalRally": a?.play("royalRally"); break;
        case "towerAbility": a?.play(e.id === "skewer" ? "bolt" : e.id === "barrage" ? "catapult" : "volley"); break;
        case "victory": if (s.stage.finale && s.mode !== "endless") { outroRef.current = false; setScreen("outro"); a?.music(null); a?.play("rout"); } else finishRun(true); break;
        case "defeat": finishRun(false); break;
        default: break;
      }
    }
  }, [banner, finishRun, saveNow, scheduleSave, setScreen]);

  /* ------------------------------ HUD snapshot ------------------------------ */

  const snapshot = useCallback(() => {
    const s = gameRef.current;
    if (!s) return;
    const h = s.hero;
    const HD = s.heroDef || HERO;
    const st = heroStatsOf(HD, h.level);
    const ab = heroAbility(s);
    const boss = s.enemies.find((e) => e.def.boss && e.state !== "dead");
    const sel = selRef.current;
    const t = sel >= 0 ? s.towers[sel] : null;
    setHud({
      gold: s.gold, castleHp: s.castleHp, castleMax: s.castleMax,
      wave: s.wave, total: s.totalWaves, waveState: s.waveState,
      countdown: s.countdown, countdownMax: s.countdownMax,
      next: nextWaveSummary(s),
      heroHp: h.hp, heroMax: h.maxHp, heroLevel: h.level, heroState: h.state, heroRespawn: h.respawnT,
      chargeCd: h.chargeCd, chargeMax: st.chargeCd,
      volley: s.abilities.volley, reinforce: s.abilities.reinforce,
      canRepair: s.gold >= repairCost(s) && s.castleHp < s.castleMax,
      boss: boss ? {
        name: boss.def.name, ratio: boss.hp / boss.maxHp, phase: boss.boss ? boss.boss.phase : 0, final: boss.def.boss === "final",
        guards: boss.boss && boss.boss.phase === 1 && boss.def.phases ? guardCount(s) : 0,
        open: !!(boss.boss && boss.boss.openT > 0), roar: !!(boss.boss && boss.boss.roarT > 0),
        shell: boss.shellMax ? Math.max(0, boss.shell) / boss.shellMax : 0, hasShell: !!boss.shellMax, frost: !!boss.def.frost,
      } : null,
      wall: s.wallHp != null ? { hp: s.wallHp, max: s.wallMax } : null,
      kingsCharge: kingsCharge(s), formations: !!s.stage.formations, finale: !!s.stage.finale,
      hero: { id: HD.id, name: HD.name, ranged: !!HD.range, ability: { name: ab.name, desc: ab.desc, key: ab.key || "Q", upgraded: !!ab.upgraded, kind: ab.kind || "charge" } },
      kingdom: s.stage.kingdom || "ashford",
      blizzard: s.blizzT > 0 ? Math.ceil(s.blizzT) : 0,
      tower: t ? { type: t.type, level: t.level, abilityCd: t.abilityCd, canUp: canUpgrade(s, sel), upCost: upgradeCostFor(s, t.type, t.level), sell: sellValue(s, sel), pikes: !!t.pikes, canDrill: canDrill(s, sel), mounted: !!t.mounted, canMount: canMount(s, sel), squad: t.type === "barracks" ? squadOf(s, sel).length : 0 } : null,
      repairCost: repairCost(s),
      buildCosts: Object.fromEntries(TOWER_ORDER.map((k) => [k, buildCost(s, k)])),
      powerList: stagePowers(s),
      powers: Object.fromEntries(stagePowers(s).map((id) => [id, { cd: s.abilities[id] || 0, unlocked: powerUnlocked(s, id), wave: powerWave(s, id), active: id === "watchfire" ? s.boostT > 0 : id === "royalRally" ? s.rallyT > 0 : false, usable: id === "emergencyRepair" ? (s.castleHp < s.castleMax || (s.wallHp != null && s.wallHp > 0 && s.wallHp < s.wallMax)) : true }])),
      perkPending: s.perkPending, perkOffer: s.perkOffer ? s.perkOffer.slice() : null, perks: s.perks.slice(),
      selection: (() => { const ids = selUnitsRef.current.filter((id) => s.units.some((u) => u.id === id && u.state !== "respawn")); if (ids.length !== selUnitsRef.current.length) setSelUnits(ids); const ab = ids.length ? sharedAbility(s, ids) : null; const first = ids.length ? s.units.find((u) => u.id === ids[0]) : null; return { count: ids.length, ability: ab, unit: first ? first.def.name : null, tower: first ? first.tower : -1, squad: isFullSquad(s, ids), formation: ids.length ? formationFor(s, ids) : null, holding: ids.length > 0 && ids.every((id) => s.units.find((u) => u.id === id)?.hold) }; })(),
      earlyBonus: s.wave === 0 ? 0 : Math.round(60 * (s.countdown / s.countdownMax)),
      phase: s.phase,
      score: s.stats.score,
    });
  }, []);

  /* ------------------------------ loop ------------------------------ */

  const frame = useCallback((now) => {
    const r = rendererRef.current;
    const canvas = canvasRef.current;
    if (!r || !canvas) return;
    const last = lastRef.current || now;
    let dt = (now - last) / 1000;
    lastRef.current = now;
    if (dt > 0.25) dt = 0.25;
    if (dt <= 0) dt = 1 / 60;
    const scr = screenRef.current;
    const ctx = canvas.getContext("2d");
    const { w, h } = viewRef.current;
    const a = audioRef.current;

    if (scr === "menu" || scr === "campaign" || scr === "kingdoms" || scr === "howto" || scr === "settings") {
      const m = menuGameRef.current;
      if (m) r.draw(ctx, m, dt, { menu: true });
      if (a && a.mode !== "menu") a.music("menu");
      return;
    }
    const s = gameRef.current;
    if (!s) return;

    if (scr === "intro") {
      if (!introStartedRef.current) { introStartedRef.current = true; r.startIntro(s); a?.play("intro"); }
      r.draw(ctx, s, dt, {});
      const it = r.intro;
      const ph = it ? it.phase : 3;
      setIntroPhase((p) => (p === ph ? p : ph));
      if (!it) {
        startStage(s);
        handleEvents();
        setScreen("playing");
        banner(`Stage ${s.stage.numeral} · ${s.stage.name}`, coarse ? "Tap a plot to build your first tower" : "Click a plot to build your first tower", "wave", 3600);
      }
      if (a && a.mode !== "calm") a.music("calm");
      return;
    }

    if (scr === "outro") {
      if (!outroRef.current) { outroRef.current = true; r.startOutro(s); }
      r.draw(ctx, s, dt, {});
      const ot = r.outro;
      const oph = ot ? ot.phase : 3;
      setIntroPhase((p) => (p === oph ? p : oph));
      if (!ot) finishRun(true);
      return;
    }

    if (scr === "playing") {
      const n = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(dt / MAX_SUB)));
      const hh = dt / n;
      for (let i = 0; i < n && s.phase === "playing"; i += 1) stepGame(s, hh);
      handleEvents();
      /* fps watch for auto quality */
      const f = fpsRef.current;
      if (!f.decided && readSave().settings.quality === "auto") {
        f.frames += 1; f.t += dt;
        if (f.t > 6) {
          f.decided = true;
          if (f.frames / f.t < 40) { r.setQuality(0.6); }
        }
      }
    }

    const paused = scr === "paused";
    r.draw(ctx, s, paused ? 0 : dt, { pulsePlots: s.wave === 0 && s.towers.every((t) => !t) });

    /* world-anchored DOM: build ring / sheet at the selected plot, the wave banner at the road */
    const sel = selRef.current;
    if (sel >= 0 && ringRef.current) {
      /* keep all four ring buttons inside the game area on small screens */
      const p = s.layout.plots[sel];
      const sp = r.toScreen(p.x, p.y);
      const mx = coarse ? 108 : 98; const my = coarse ? 118 : 106;
      const rx = Math.max(mx, Math.min(w - mx, sp.x));
      const ry = Math.max(my, Math.min(h - 84, sp.y));
      ringRef.current.style.transform = `translate(${rx}px, ${ry}px)`;
    }
    if (sheetRef.current && sel >= 0 && !coarse) {
      const p = s.layout.plots[sel];
      const sp = r.toScreen(p.x, p.y);
      const el = sheetRef.current;
      const ew = el.offsetWidth || 240; const eh = el.offsetHeight || 160;
      let x = sp.x + 56; let y = sp.y - eh / 2;
      if (x + ew > w - 8) x = sp.x - 56 - ew;
      x = Math.max(8, Math.min(w - ew - 8, x));
      y = Math.max(8, Math.min(h - eh - 8, y));
      el.style.transform = `translate(${x}px, ${y}px)`;
    }
    if (waveBtnRef.current) {
      const f = s.layout.flags[0];
      const sp = r.toScreen(f.x, f.y);
      const el = waveBtnRef.current;
      const ew = el.offsetWidth || 160;
      const eh = el.offsetHeight || 60;
      const x = Math.max(8, Math.min(w - ew - 8, sp.x - ew / 2 + 40));
      const topBottom = topRef.current ? (topRef.current.getBoundingClientRect().bottom - wrapRef.current.getBoundingClientRect().top) + 6 : 52;
      let y = Math.max(topBottom, Math.min(h - 120, sp.y - 116));
      /* never sit on an open tower sheet: slide above it when they overlap */
      const sh = sheetRef.current;
      if (sh && coarse) {
        const wr = wrapRef.current.getBoundingClientRect();
        const sr = sh.getBoundingClientRect();
        const sl = sr.left - wr.left; const st = sr.top - wr.top; const srr = sr.right - wr.left; const sb = sr.bottom - wr.top;
        if (x < srr && x + ew > sl && y < sb && y + eh > st) y = Math.max(topBottom, st - eh - 8);
      }
      el.style.transform = `translate(${x}px, ${y}px)`;
    }

    hudClock.current += dt;
    if (hudClock.current >= HUD_INTERVAL) { hudClock.current = 0; snapshot(); }
    if (scr === "playing" && s.t - lastSaveRef.current > SAVE_PERIOD) scheduleSave();
    if (a && (scr === "playing")) { const want = musicFor(); if (want !== a.mode) a.music(want); }
  }, [handleEvents, snapshot, musicFor, setScreen, banner, coarse, scheduleSave, finishRun]);

  useEffect(() => {
    let raf = 0;
    const tick = (now) => { raf = requestAnimationFrame(tick); frame(now); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [frame]);

  /* ------------------------------ flow ------------------------------ */

  const startRun = useCallback((stageId, opts = {}) => {
    /* a saved battle is precious: ask before replacing it */
    if (!opts.force && readSave().battle && !(gameRef.current && gameRef.current.phase === "playing")) { setConfirmNew({ stageId, opts }); return; }
    const { w, h } = viewRef.current;
    const save = readSave();
    const g = makeGame({ stageId, layout: layoutFor(w, h), difficulty: opts.difficulty || difficulty, mode: opts.mode || "campaign", seed: (Math.random() * 0x7fffffff) | 0, upgrades: save.meta?.upgrades || null });
    gameRef.current = g;
    setGame(g);
    setProfile(clearBattle(save));
    rendererRef.current?.reset();
    bankedRef.current = false;
    fpsRef.current = { frames: 0, t: 0, decided: false };
    introStartedRef.current = false;
    lastSaveRef.current = 0;
    setConfirmNew(null);
    setResults(null); setSelected(-1); setMode(null); setHeroSel(false); setSelUnits([]); setMulti(false); setBanners([]);
    lastRef.current = 0;
    hudClock.current = 1;
    const a = audioRef.current;
    a?.unlock();
    if (coarse && wrapRef.current && !document.fullscreenElement) {
      toggleGameFullscreen(wrapRef.current, { real: false, pseudo: false }, (st) => { setPseudoFull(st.pseudo); setTimeout(resize, 60); setTimeout(resize, 400); });
    }
    if (opts.mode === "endless" || opts.skipIntro) {
      startStage(g);
      handleEvents();
      setScreen("playing");
      banner(opts.mode === "endless" ? "Endless siege" : `Stage ${g.stage.numeral} · ${g.stage.name}`, opts.mode === "endless" ? "How many waves can Ashford hold?" : "", "wave", 3000);
    } else {
      setIntroPhase(0);
      setScreen("intro");
    }
  }, [coarse, difficulty, handleEvents, layoutFor, setScreen, banner, resize]);

  /* Continue: rebuild the saved battle and drop straight in */
  const continueBattle = useCallback(() => {
    const save = readSave();
    if (!save.battle) return;
    const { w, h } = viewRef.current;
    let g;
    try { g = restoreGame(save.battle, { layout: layoutFor(w, h) }); }
    catch { setProfile(clearBattle(save)); banner("Saved battle could not be loaded", "It was from an older version. Progress and stars are safe.", "alert", 3600); return; }
    gameRef.current = g;
    setGame(g);
    rendererRef.current?.reset();
    bankedRef.current = false;
    fpsRef.current = { frames: 0, t: 0, decided: false };
    introStartedRef.current = true;
    lastSaveRef.current = g.t;
    setConfirmNew(null); setResults(null); setSelected(-1); setMode(null); setHeroSel(false); setSelUnits([]); setMulti(false); setBanners([]);
    lastRef.current = 0; hudClock.current = 1;
    audioRef.current?.unlock();
    if (coarse && wrapRef.current && !document.fullscreenElement) {
      toggleGameFullscreen(wrapRef.current, { real: false, pseudo: false }, (st) => { setPseudoFull(st.pseudo); setTimeout(resize, 60); setTimeout(resize, 400); });
    }
    handleEvents();
    setScreen("playing");
    const dw = displayWave(g.wave, g.waveState, g.totalWaves);
    banner("Battle resumed", `${g.stage.name} · Wave ${dw.counter}`, "good", 3000);
    audioRef.current?.play("resume");
  }, [banner, coarse, handleEvents, layoutFor, resize, setScreen]);

  const skipIntro = useCallback(() => {
    const r = rendererRef.current;
    if (r && r.intro) r.skipIntro();
  }, []);

  const pauseGame = useCallback(() => { if (screenRef.current === "playing") { setScreen("paused"); audioRef.current?.play("close"); } }, [setScreen]);
  const resumeGame = useCallback(() => { if (screenRef.current === "paused") { lastRef.current = 0; audioRef.current?.unlock(); setScreen("playing"); } }, [setScreen]);
  const togglePause = useCallback(() => { if (screenRef.current === "playing") pauseGame(); else if (screenRef.current === "paused") resumeGame(); }, [pauseGame, resumeGame]);

  const quitToMenu = useCallback(() => {
    saveNow();
    bankRun();
    gameRef.current = null;
    setGame(null);
    rendererRef.current?.reset();
    setSelected(-1); setMode(null); setHeroSel(false); setBanners([]);
    setSelUnits([]); setMulti(false);
    setScreen("menu");
    audioRef.current?.play("close");
  }, [bankRun, saveNow, setScreen]);

  const restart = useCallback(() => {
    const s = gameRef.current;
    if (!s) return;
    bankRun();
    startRun(s.stage.id, { mode: s.mode, difficulty: s.difficulty, skipIntro: true, force: true });
  }, [bankRun, startRun]);

  const patchSettings = useCallback((patch) => setProfile((p) => saveSettings(p, patch)), []);

  /* ------------------------------ actions ------------------------------ */

  const select = useCallback((idx) => {
    setSelected(idx);
    setMode(null);
    setHeroSel(false);
    if (idx >= 0) setSelUnits([]);
    const r = rendererRef.current;
    const s = gameRef.current;
    if (!r || !s) return;
    let range = null;
    if (idx >= 0 && s.towers[idx] && s.towers[idx].type !== "barracks") {
      const lvl = towerLevel(s.towers[idx].type, s.towers[idx].level);
      const p = s.layout.plots[idx];
      range = { x: p.x, y: p.y, r: lvl.range, min: lvl.minRange || 0 };
    }
    r.setSelection({ plot: idx, range, target: null });
    audioRef.current?.play(idx >= 0 ? "open" : "close");
  }, []);

  const previewRange = useCallback((type) => {
    const r = rendererRef.current; const s = gameRef.current;
    const idx = selRef.current;
    if (!r || !s || idx < 0) return;
    if (!type) { r.setSelection({ range: null }); return; }
    const lvl = towerLevel(type, 1);
    const p = s.layout.plots[idx];
    r.setSelection({ range: { x: p.x, y: p.y, r: type === "barracks" ? TOWERS.barracks.rallyRange : lvl.range, min: lvl.minRange || 0 } });
  }, []);

  /* ------------------------------ soldiers ------------------------------ */

  const selectUnits = useCallback((ids) => {
    setSelUnits(ids);
    if (ids.length) { setSelected(-1); setHeroSel(false); setMode(null); rendererRef.current?.setSelection({ plot: -1, range: null, target: null }); }
    audioRef.current?.play(ids.length ? "select" : "close");
  }, []);

  const giveOrder = useCallback((order) => {
    const s = gameRef.current; const ids = selUnitsRef.current;
    if (!s || !ids.length) return false;
    const ok = orderUnits(s, ids, order);
    if (!ok) audioRef.current?.play("error");
    handleEvents(); snapshot();
    return ok;
  }, [handleEvents, snapshot]);

  const unitAbilityNow = useCallback(() => {
    const s = gameRef.current; const ids = selUnitsRef.current;
    if (!s || !ids.length) return;
    if (!triggerUnitAbility(s, ids)) audioRef.current?.play("error");
    handleEvents(); snapshot();
  }, [handleEvents, snapshot]);

  const selectSquad = useCallback((plot) => {
    const s = gameRef.current;
    if (!s) return;
    const ids = squadOf(s, plot);
    if (ids.length) selectUnits(ids);
  }, [selectUnits]);

  const doBuyUpgrade = useCallback((id) => {
    const save = readSave();
    const level = save.meta?.upgrades?.[id] || 0;
    const cost = kingdomCost(id, level);
    if (cost == null) return;
    const next = buyUpgrade(save, id, cost);
    if (!next) { audioRef.current?.play("error"); return; }
    setProfile(next);
    audioRef.current?.play("upgrade");
  }, []);

  const doChoosePerk = useCallback((id) => {
    const s = gameRef.current;
    if (!s) return;
    if (choosePerk(s, id)) { handleEvents(); snapshot(); }
  }, [handleEvents, snapshot]);

  const doSkipPerk = useCallback(() => {
    const s = gameRef.current;
    if (!s) return;
    if (skipPerk(s)) { audioRef.current?.play("close"); snapshot(); saveNow(); }
  }, [snapshot, saveNow]);

  const castPower = useCallback((id) => {
    const s = gameRef.current;
    if (!s) return;
    if (id === "catapultBarrage") {
      if (powerUnlocked(s, id) && (s.abilities.catapultBarrage || 0) <= 0) { setMode((cur) => (cur === "barrage" ? null : "barrage")); rendererRef.current?.setSelection({ target: null }); audioRef.current?.play("open"); }
      else audioRef.current?.play("error");
      return;
    }
    const ok = id === "watchfire" ? castWatchfire(s) : id === "royalRally" ? castRoyalRally(s) : id === "burningOil" ? castBurningOil(s) : id === "emergencyRepair" ? castEmergencyRepair(s) : false;
    if (!ok) audioRef.current?.play("error");
    handleEvents(); snapshot();
  }, [handleEvents, snapshot]);

  const toggleFormation = useCallback(() => {
    const s = gameRef.current; const ids = selUnitsRef.current;
    if (!s || !ids.length) return;
    const f = formationFor(s, ids);
    if (!f) return;
    if (!setFormation(s, ids, f.on ? null : f.kind)) audioRef.current?.play("error");
    handleEvents(); snapshot();
  }, [handleEvents, snapshot]);

  const doBuild = useCallback((type) => {
    const s = gameRef.current; const idx = selRef.current;
    if (!s || idx < 0) return;
    if (!buildTower(s, idx, type)) { audioRef.current?.play("error"); banner("Not enough gold", `${TOWERS[type].name} costs ${buildCost(s, type)}`, "alert", 1400); return; }
    handleEvents();
    snapshot();
    select(idx);
  }, [banner, handleEvents, select, snapshot]);

  const doUpgrade = useCallback(() => {
    const s = gameRef.current; const idx = selRef.current;
    if (!s || idx < 0) return;
    if (!upgradeTower(s, idx)) { audioRef.current?.play("error"); return; }
    handleEvents(); snapshot(); select(idx);
  }, [handleEvents, select, snapshot]);

  const doSell = useCallback(() => {
    const s = gameRef.current; const idx = selRef.current;
    if (!s || idx < 0) return;
    if (sellTower(s, idx)) { handleEvents(); snapshot(); select(-1); }
  }, [handleEvents, select, snapshot]);

  const doDrill = useCallback((pikes) => {
    const s = gameRef.current; const idx = selRef.current;
    if (!s || idx < 0) return;
    if (!setDrill(s, idx, pikes)) { audioRef.current?.play("error"); banner("Not enough gold", `Drill costs ${DRILL_COST}`, "alert", 1400); return; }
    handleEvents(); snapshot(); select(idx);
  }, [banner, handleEvents, select, snapshot]);

  const doMount = useCallback((mounted) => {
    const s = gameRef.current; const idx = selRef.current;
    if (!s || idx < 0) return;
    if (!setMount(s, idx, mounted)) { audioRef.current?.play("error"); banner("Not enough gold", `Mounting the squad costs ${MOUNT_COST}`, "alert", 1400); return; }
    handleEvents(); snapshot(); select(idx);
  }, [banner, handleEvents, select, snapshot]);

  const enterMode = useCallback((m) => {
    setMode((cur) => (cur === m ? null : m));
    const r = rendererRef.current;
    r?.setSelection({ target: null });
    audioRef.current?.play("open");
  }, []);

  const toggleHero = useCallback(() => {
    setHeroSel((v) => !v);
    setSelected(-1); setMode(null);
    rendererRef.current?.setSelection({ plot: -1, range: null });
    audioRef.current?.play("open");
  }, []);

  const doCallWave = useCallback(() => {
    const s = gameRef.current;
    if (!s) return;
    if (callWave(s)) { handleEvents(); snapshot(); }
  }, [handleEvents, snapshot]);

  const doRepair = useCallback(() => {
    const s = gameRef.current;
    if (!s) return;
    if (!repairCastle(s)) { audioRef.current?.play("error"); return; }
    handleEvents(); snapshot();
  }, [handleEvents, snapshot]);

  const toggleHold = useCallback(() => {
    const s = gameRef.current; const ids = selUnitsRef.current;
    if (!s || !ids.length) return;
    const allHold = ids.every((id) => s.units.find((u) => u.id === id)?.hold);
    giveOrder({ kind: allHold ? "rally" : "hold" });
  }, [giveOrder]);

  /* a tap or click on the battlefield in world coordinates */
  const worldTap = useCallback((x, y, right = false) => {
    const s = gameRef.current; const r = rendererRef.current;
    if (!s || !r || screenRef.current !== "playing") return;
    const m = modeRef.current;
    const idx = selRef.current;
    if (right) { if (selUnitsRef.current.length) giveOrder({ kind: "move", x, y }); else if (moveHero(s, x, y)) handleEvents(); return; }
    if (m === "rally") { if (idx >= 0) setRally(s, idx, x, y); handleEvents(); setMode(null); return; }
    if (m === "volley") { if (castVolley(s, x, y)) { handleEvents(); setMode(null); snapshot(); } else audioRef.current?.play("error"); return; }
    if (m === "reinforce") { if (castReinforce(s, x, y)) { handleEvents(); setMode(null); snapshot(); } else audioRef.current?.play("error"); return; }
    if (m === "barrage") { if (castBarrage(s, x, y)) { handleEvents(); setMode(null); snapshot(); } else audioRef.current?.play("error"); return; }
    if (m === "ability") {
      if (idx >= 0 && fireTowerAbility(s, idx, x, y)) { handleEvents(); setMode(null); snapshot(); }
      else { audioRef.current?.play("error"); banner("Out of range", "Pick a target inside the tower's circle", "alert", 1400); }
      return;
    }
    if (m === "charge") { if (heroCharge(s, x, y)) { handleEvents(); setMode(null); setHeroSel(false); } else audioRef.current?.play("error"); return; }
    if (m === "unitMove") { if (giveOrder({ kind: "move", x, y })) setMode(null); return; }
    if (m === "unitAttack") {
      let best = null; let bd = Math.max(40, 30 / r.fit.scale) ** 2;
      for (const e of s.enemies) { if (e.state === "dead") continue; const d = (e.x - x) ** 2 + (e.y - 20 - y) ** 2; if (d < bd) { bd = d; best = e; } }
      if (best && giveOrder({ kind: "attack", enemyId: best.id })) setMode(null);
      else { audioRef.current?.play("error"); banner("No enemy there", "Tap an enemy on the road", "alert", 1200); }
      return;
    }
    if (m === "unitTower") {
      const plot = plotAt(s, x, y, Math.max(PLOT_R, 26 / r.fit.scale));
      if (plot >= 0 && s.towers[plot] && giveOrder({ kind: "tower", plot })) setMode(null);
      else { audioRef.current?.play("error"); banner("Tap a tower", "The squad will guard its stretch of road", "alert", 1200); }
      return;
    }
    /* soldiers first: they are small and stand on the road */
    const unitR = Math.max(26, 22 / r.fit.scale);
    const uHit = unitAt(s, x, y, unitR);
    if (uHit) {
      const cur = selUnitsRef.current;
      if (multiRef.current || shiftHeld.current) selectUnits(cur.includes(uHit.id) ? cur.filter((id) => id !== uHit.id) : [...cur, uHit.id]);
      else selectUnits([uHit.id]);
      return;
    }
    const tapR = Math.max(PLOT_R, 26 / r.fit.scale);
    const plot = plotAt(s, x, y, tapR);
    if (plot >= 0) { select(plot); return; }
    const hDist = Math.hypot(s.hero.x - x, s.hero.y - (y + 20));
    if (hDist < Math.max(30, 22 / r.fit.scale) && s.hero.state !== "dead" && s.hero.state !== "respawn" && !heroSelRef.current) { toggleHero(); return; }
    if (heroSelRef.current) { if (moveHero(s, x, y)) { handleEvents(); if (coarse) setHeroSel(false); } return; }
    const f = s.layout.flags[0];
    if (Math.hypot(f.x - x, f.y - 40 - y) < 70 && s.waveState === "countdown") { doCallWave(); return; }
    /* selected soldiers walk to a tapped spot on the ground */
    if (selUnitsRef.current.length) { giveOrder({ kind: "move", x, y }); return; }
    if (idx >= 0) select(-1);
  }, [banner, coarse, doCallWave, giveOrder, handleEvents, select, selectUnits, snapshot, toggleHero]);

  const onPointerDown = useCallback((e) => {
    if (e.button === 2) return;
    shiftHeld.current = !!e.shiftKey;
    pointerRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
    audioRef.current?.unlock();
  }, []);

  const onPointerMove = useCallback((e) => {
    const g = pointerRef.current;
    if (g && g.id === e.pointerId && Math.hypot(e.clientX - g.x, e.clientY - g.y) > 10) g.moved = true;
    if (coarse) return;
    const r = rendererRef.current; const s = gameRef.current; const wrap = wrapRef.current;
    if (!r || !s || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    const wpt = r.toWorld(e.clientX - rect.left, e.clientY - rect.top);
    const m = modeRef.current;
    if (m === "volley" || m === "reinforce" || m === "ability" || m === "rally") {
      const idx = selRef.current;
      let rad = m === "volley" ? ABILITIES.volley.radius : m === "reinforce" ? 30 : 40;
      if (m === "ability" && idx >= 0) { const ab = towerAbility(s, idx); rad = ab?.radius || 40; }
      r.setSelection({ target: { x: wpt.x, y: wpt.y, r: rad, color: m === "rally" ? "#f1d27a" : "#fff" } });
    } else {
      const hov = plotAt(s, wpt.x, wpt.y, Math.max(PLOT_R, 22 / r.fit.scale));
      if (r.selection.hover !== hov) r.setSelection({ hover: hov });
      const hu = unitAt(s, wpt.x, wpt.y, Math.max(26, 22 / r.fit.scale));
      const huId = hu ? hu.id : null;
      if (r.selection.hoverUnit !== huId) r.setSelection({ hoverUnit: huId });
    }
    wrap.dataset.cursor = m ? "target" : "";
  }, [coarse]);

  const onPointerUp = useCallback((e) => {
    const g = pointerRef.current;
    if (!g || g.id !== e.pointerId) return;
    pointerRef.current = null;
    if (g.moved) return;
    const r = rendererRef.current; const wrap = wrapRef.current;
    if (!r || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    const w = r.toWorld(e.clientX - rect.left, e.clientY - rect.top);
    worldTap(w.x, w.y, false);
  }, [worldTap]);

  const onContextMenu = useCallback((e) => {
    e.preventDefault();
    const r = rendererRef.current; const wrap = wrapRef.current;
    if (!r || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    const w = r.toWorld(e.clientX - rect.left, e.clientY - rect.top);
    worldTap(w.x, w.y, true);
  }, [worldTap]);

  /* hero button: tap = select / deselect, hold = charge mode */
  const onHeroDown = useCallback((e) => {
    e.preventDefault(); e.stopPropagation();
    audioRef.current?.unlock();
    holdRef.current = setTimeout(() => {
      holdRef.current = null;
      const s = gameRef.current;
      if (s && s.hero.chargeCd <= 0) { const ab = heroAbility(s); const hn = (s.heroDef || HERO).name; setHeroSel(true); setMode("charge"); audioRef.current?.play("open"); banner(ab.name, `${coarse ? "Tap" : "Click"} where ${hn} should ${ab.kind === "frostArrow" ? "shoot" : "charge"}`, "good", 1400); }
      else audioRef.current?.play("error");
    }, 420);
  }, [banner, coarse]);
  const onHeroUp = useCallback((e) => {
    e.preventDefault(); e.stopPropagation();
    if (holdRef.current) { clearTimeout(holdRef.current); holdRef.current = null; toggleHero(); }
  }, [toggleHero]);

  const chargeNow = useCallback(() => {
    const s = gameRef.current;
    if (!s || s.hero.chargeCd > 0) { audioRef.current?.play("error"); return; }
    setHeroSel(true); setMode("charge"); audioRef.current?.play("open");
  }, []);

  /* keyboard */
  useEffect(() => {
    const down = (e) => {
      const scr = screenRef.current;
      const k = e.key.toLowerCase();
      if (k === "m") { patchSettings({ sound: !readSave().settings.sound }); return; }
      if (k === "p" || k === "escape") {
        if (scr === "playing") {
          if (modeRef.current || selRef.current >= 0 || heroSelRef.current || selUnitsRef.current.length) { setMode(null); select(-1); setSelUnits([]); return; }
          e.preventDefault(); pauseGame();
        } else if (scr === "paused") { e.preventDefault(); resumeGame(); }
        else if (scr === "intro") skipIntro();
        else if (scr === "outro") rendererRef.current?.skipOutro();
        return;
      }
      if (scr === "intro" && (k === " " || k === "enter")) { e.preventDefault(); skipIntro(); return; }
      if (scr === "outro" && (k === " " || k === "enter" || k === "escape")) { e.preventDefault(); rendererRef.current?.skipOutro(); return; }
      if (scr !== "playing") return;
      const s = gameRef.current;
      if (!s) return;
      const idx = selRef.current;
      if (k >= "1" && k <= "4") { e.preventDefault(); if (idx >= 0 && !s.towers[idx]) doBuild(TOWER_ORDER[Number(k) - 1]); return; }
      if (k === "u") { if (idx >= 0) doUpgrade(); return; }
      if (k === "s") { if (idx >= 0 && s.towers[idx]) doSell(); return; }
      if (k === " ") { e.preventDefault(); doCallWave(); return; }
      if (k === "h") { toggleHero(); return; }
      if (k === "q") { chargeNow(); return; }
      if (k === "v") { enterMode("volley"); return; }
      if (k === "r") { enterMode("reinforce"); return; }
      if (k === "f") { doRepair(); return; }
      if (k === "g") { castPower("watchfire"); return; }
      if (k === "b") { castPower("royalRally"); return; }
      if (k === "o") { castPower("burningOil"); return; }
      if (k === "e") { castPower("emergencyRepair"); return; }
      if (k === "c") { castPower("catapultBarrage"); return; }
      if (k === "w" && selUnitsRef.current.length) { toggleFormation(); return; }
      if (k === "escape" && selUnitsRef.current.length) { setSelUnits([]); return; }
      if (k === "e") { if (idx >= 0 && towerAbility(s, idx)) enterMode("ability"); return; }
      if (k === "t") { if (idx >= 0 && s.towers[idx]?.type === "barracks") enterMode("rally"); }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [castPower, chargeNow, doBuild, doCallWave, doRepair, doSell, doUpgrade, enterMode, patchSettings, pauseGame, resumeGame, select, skipIntro, toggleFormation, toggleHero]);

  useEffect(() => () => { bankRun(); }, [bankRun]);

  /* auto-pause whenever the game leaves the screen */
  useEffect(() => {
    /* window.__castleNoAutoPause lets the dev harness drive frames while unfocused */
    const away = () => { if (import.meta.env?.DEV && window.__castleNoAutoPause) return; pauseGame(); };
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

  /* ------------------------------ derived ------------------------------ */

  const stage0 = STAGES[0];
  const rec0 = stageRecord(profile, stage0.id);
  const live = screen === "playing";
  const inGame = live || screen === "paused";
  const s = game;
  /* rings and sheets collapse while a targeting mode is active so the
     "tap where…" prompt and the combat controls are never covered */
  const targeting = !!mode || heroSel;
  const selTower = live && selected >= 0 && s && !targeting ? s.towers[selected] : null;
  const selPlotFree = live && selected >= 0 && s && !targeting ? !s.towers[selected] : false;
  const stars = totalStars(profile);
  const controlList = coarse ? TOUCH : KEYS;
  const sheetTop = !coarse;

  const heroName = hud?.hero?.name || "Sir Edric";
  const heroKind = hud?.hero?.ability?.kind || "charge";
  const modeHint = useMemo(() => {
    if (!mode && !heroSel) return null;
    const tap = coarse ? "Tap" : "Click";
    if (mode === "rally") return `${tap} the ground where the soldiers should stand`;
    if (mode === "volley") return `${tap} where the arrows should fall`;
    if (mode === "reinforce") return `${tap} where the levies should stand`;
    if (mode === "barrage") return `${tap} where the stones should fall`;
    if (mode === "ability") return `${tap} a target inside the tower's range`;
    if (mode === "charge") return `${tap} where ${heroName} should ${heroKind === "frostArrow" ? "put the arrow" : "charge"}`;
    if (mode === "unitMove") return `${tap} where the soldiers should go`;
    if (mode === "unitAttack") return `${tap} the enemy to attack`;
    if (mode === "unitTower") return `${tap} the tower to defend`;
    if (heroSel) return `${tap} where ${heroName} should go`;
    return null;
  }, [mode, heroSel, coarse, heroName, heroKind]);
  const battle = profile.battle;
  const battleWave = battle ? displayWave(battle.wave, battle.waveState, battle.mode === "endless" ? Infinity : (STAGES.find((st) => st.id === battle.stageId)?.waves.length || 0)) : null;
  const battleStage = battle ? STAGES.find((st) => st.id === battle.stageId) : null;
  const crowns = profile.meta?.crowns || 0;
  const realmDone = (profile.campaignsDone || []).includes("ashford");
  const northDone = (profile.campaignsDone || []).includes("frost");
  const outroFrost = (game?.stage.kingdom || "ashford") === "frost";
  const winFrost = (results?.kingdom || "ashford") === "frost";
  const badges = badgesOf(profile);

  /* ------------------------------ view ------------------------------ */

  return (
    <div
      className={`cd ${live ? "is-live" : ""} ${fullscreen || pseudoFull ? "is-full" : ""} ${pseudoFull ? "is-pseudo" : ""} ${coarse ? "is-coarse" : ""} ${inGame ? "is-ingame" : ""} ${live && hud && hud.selection.count > 0 && !targeting ? "is-cmd" : ""} ${hud && hud.boss ? "has-boss" : ""} ${hud && (hud.powerList || []).length > 3 ? "has-many" : ""}`}
      ref={wrapRef}
    >
      <canvas ref={canvasRef} className="cdCanvas" />

      {live && (
        <div
          className="cdGestures"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => { pointerRef.current = null; }}
          onContextMenu={onContextMenu}
        />
      )}

      {/* ------------------------------ HUD ------------------------------ */}
      {inGame && hud && (
        <>
          <div className="cdTop" ref={topRef}>
            <div className="cdStat cdStat--gold" title="Gold"><span className="cdCoin" />{fmt(hud.gold)}</div>
            <div className="cdStat cdStat--castle" title="Castle health">
              <span className="cdCastleIcon" />
              <span className="cdBar"><span className={`cdBarFill ${hud.castleHp / hud.castleMax < 0.35 ? "is-low" : ""}`} style={{ width: `${(hud.castleHp / hud.castleMax) * 100}%` }} /></span>
              <span className="cdBarText">{hud.castleHp}/{hud.castleMax}</span>
            </div>
            {hud.blizzard > 0 && (
              <div className="cdStat cdStat--blizz" title="The storm: your towers shoot slower and see less">
                <span className="cdWaveLabel">Blizzard</span>
                <strong>{hud.blizzard}s</strong>
              </div>
            )}
            {hud.wall && (
              <div className={`cdStat cdStat--wall ${hud.wall.hp <= 0 ? "is-down" : ""}`} title={hud.wall.hp > 0 ? `Outer wall ${Math.round(hud.wall.hp)} / ${hud.wall.max}: slows the warband at the siege gate while it stands` : "The outer wall has fallen; the breach road is open"}>
                <span className="cdWaveLabel">Wall</span>
                <span className="cdBar cdBar--wall"><span className="cdBarFill is-wall" style={{ width: `${Math.max(0, hud.wall.hp / hud.wall.max) * 100}%` }} /></span>
              </div>
            )}
            {(() => { const dw = displayWave(hud.wave, hud.waveState, hud.total); return (
              <div className={`cdStat cdStat--wave ${dw.final ? "is-final" : ""}`} title={dw.endless ? "Endless siege" : `${dw.left} ${dw.left === 1 ? "wave" : "waves"} remaining after this one`}>
                <span className="cdWaveLabel">{dw.final ? "Final" : "Wave"}</span>
                <strong>{dw.counter}</strong>
                <em className="cdWaveLeft">{dw.note}</em>
                {hud.waveState === "countdown" && hud.wave < hud.total && <span className="cdTimer">{Math.ceil(hud.countdown)}s</span>}
              </div>
            ); })()}
            <div className="cdQuick">
              <button type="button" onClick={() => patchSettings({ sound: !settings.sound })} aria-label={settings.sound ? "Mute sound" : "Unmute sound"} title="Sound (M)">{settings.sound ? "🔊" : "🔇"}</button>
              <button type="button" onClick={() => patchSettings({ music: !settings.music })} aria-label={settings.music ? "Music off" : "Music on"} title="Music">{settings.music ? "♪" : "♪̶"}</button>
              <button type="button" onClick={toggleFullscreen} aria-label="Fullscreen" title="Fullscreen">{fullscreen || pseudoFull ? "⤡" : "⤢"}</button>
              <button type="button" onClick={togglePause} aria-label="Pause" title="Pause (P)">{live ? "❚❚" : "▶"}</button>
            </div>
          </div>

          {hud.boss && (
            <div className={`cdBoss ${hud.boss.final ? "cdBoss--final" : ""} ${hud.boss.phase === 3 ? "is-raged" : ""} ${hud.boss.open || (hud.boss.frost && hud.boss.shell <= 0) ? "is-open" : ""} ${hud.boss.roar ? "is-roar" : ""}`}>
              <span>
                {hud.boss.final && hud.boss.phase ? <i className="cdBossPips" aria-hidden="true">{[1, 2, 3].map((n) => <b key={n} className={n <= hud.boss.phase ? "is-on" : ""} />)}</i> : null}
                {hud.boss.name}
                {hud.boss.final && hud.boss.phase ? <em className="cdBossPhase">{
                  hud.boss.frost
                    ? (hud.boss.shell > 0 ? "Sheathed in ice · break it" : hud.boss.phase === 3 ? "Phase 3 · Enraged" : "The ice is broken · strike now")
                    : hud.boss.open ? "Winded · strike now" : hud.boss.roar ? "Roaring · untouchable" : hud.boss.phase === 1 ? `Behind his guard · ${hud.boss.guards} left` : hud.boss.phase === 2 ? "Phase 2 · Marching on the gate" : "Phase 3 · Enraged"
                }</em> : null}
              </span>
              <span className="cdBar cdBar--boss"><span className="cdBarFill is-boss" style={{ width: `${hud.boss.ratio * 100}%` }} /></span>
              {hud.boss.hasShell && <span className="cdBar cdBar--shell" title="The ice shell takes every blow until it breaks"><span className="cdBarFill is-shell" style={{ width: `${hud.boss.shell * 100}%` }} /></span>}
            </div>
          )}

          {live && hud.waveState === "countdown" && hud.wave < hud.total && (
            <button type="button" ref={waveBtnRef} className="cdWaveBtn" onClick={doCallWave}>
              <span className="cdWaveBtnRing" style={{ "--p": hud.countdownMax ? 1 - hud.countdown / hud.countdownMax : 0 }} />
              <span className="cdWaveBtnBody">
                <strong>{hud.wave === 0 ? "Begin the siege" : "Next wave"}</strong>
                <span className="cdWaveNext">
                  {hud.next.map((g) => <em key={g.type}>{plural(g.name, g.count)}</em>)}
                </span>
                {hud.earlyBonus > 0 && <small>+{hud.earlyBonus} gold now</small>}
              </span>
            </button>
          )}

          <div className="cdBottomLeft">
            <button
              type="button"
              className={`cdHero ${heroSel ? "is-on" : ""} ${hud.heroState === "dead" || hud.heroState === "respawn" ? "is-down" : ""}`}
              onPointerDown={onHeroDown}
              onPointerUp={onHeroUp}
              onPointerCancel={() => { if (holdRef.current) { clearTimeout(holdRef.current); holdRef.current = null; } }}
              onContextMenu={(e) => e.preventDefault()}
              aria-label={hud.hero.name}
              title={`Select ${hud.hero.name} (H). Hold for ${hud.hero.ability.name} (${hud.hero.ability.key})`}
            >
              <IconCanvas kind="figure" id={hud.hero.id === "elara" ? "elara" : "hero"} w={46} h={54} renderer={rendererRef} className="cdHeroPortrait" />
              <span className="cdHeroInfo">
                <strong>{hud.hero.name}</strong>
                <span className="cdBar cdBar--hero"><span className="cdBarFill is-hero" style={{ width: `${Math.max(0, hud.heroHp / hud.heroMax) * 100}%` }} /></span>
                <span className="cdPips">{[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= hud.heroLevel ? "is-on" : ""} />)}</span>
                {(hud.heroState === "dead" || hud.heroState === "respawn") && <em>returns in {Math.max(1, Math.ceil(hud.heroRespawn))}s</em>}
              </span>
            </button>
            <button type="button" className={`cdAbility cdAbility--charge ${hud.chargeCd <= 0 ? "is-ready" : ""} ${mode === "charge" ? "is-on" : ""}`} onClick={chargeNow} disabled={hud.chargeCd > 0 || hud.heroState === "dead" || hud.heroState === "respawn"} title={`${hud.hero.ability.name} (${hud.hero.ability.key}): ${hud.hero.ability.desc || ""}`}>
              <span className="cdCd" style={{ "--p": hud.chargeMax ? Math.max(0, hud.chargeCd) / hud.chargeMax : 0 }} />
              <span className="cdAbilityLabel">{hud.hero.ability.kind === "frostArrow" ? (hud.hero.ability.upgraded ? "Volley" : "Frost") : hud.hero.ability.upgraded ? "King's" : "Charge"}</span>
              {hud.hero.ability.upgraded && <span className="cdCrownBadge" aria-hidden="true">{hud.hero.ability.kind === "frostArrow" ? "❄" : "👑"}</span>}
              {hud.chargeCd > 0 && <span className="cdCdText">{Math.ceil(hud.chargeCd)}</span>}
            </button>
          </div>

          <div className={`cdBottomRight ${(hud.powerList || []).length > 3 ? "is-many" : ""}`}>
            <button type="button" className={`cdAbility ${hud.volley <= 0 ? "is-ready" : ""} ${mode === "volley" ? "is-on" : ""}`} onClick={() => enterMode("volley")} disabled={hud.volley > 0} title="Arrow Volley (V)">
              <span className="cdCd" style={{ "--p": Math.max(0, hud.volley) / ABILITIES.volley.cd }} />
              <span className="cdAbilityIcon">➶</span><span className="cdAbilityLabel">Volley</span>
              {hud.volley > 0 && <span className="cdCdText">{Math.ceil(hud.volley)}</span>}
            </button>
            <button type="button" className={`cdAbility ${hud.reinforce <= 0 ? "is-ready" : ""} ${mode === "reinforce" ? "is-on" : ""}`} onClick={() => enterMode("reinforce")} disabled={hud.reinforce > 0} title="Reinforcements (R)">
              <span className="cdCd" style={{ "--p": Math.max(0, hud.reinforce) / ABILITIES.reinforce.cd }} />
              <span className="cdAbilityIcon">⚔</span><span className="cdAbilityLabel">Levies</span>
              {hud.reinforce > 0 && <span className="cdCdText">{Math.ceil(hud.reinforce)}</span>}
            </button>
            <button type="button" className={`cdAbility cdAbility--repair ${hud.canRepair ? "is-ready" : ""}`} onClick={doRepair} disabled={!hud.canRepair} title="Repair the castle (F)">
              <span className="cdAbilityIcon">⚒</span><span className="cdAbilityLabel">Repair</span>
              <span className="cdCost"><span className="cdCoin cdCoin--s" />{hud.repairCost}</span>
            </button>
            {(hud.powerList || []).map((id) => {
              const pw = hud.powers[id]; const def = POWERS[id];
              if (!pw) return null;
              if (!pw.unlocked) return <div key={id} className="cdAbility cdAbility--locked" title={`${def.name}: unlocks on wave ${pw.wave}`}><span className="cdAbilityIcon">🔒</span><span className="cdAbilityLabel">W{pw.wave}</span></div>;
              return (
                <button type="button" key={id} className={`cdAbility ${pw.cd <= 0 && pw.usable ? "is-ready" : ""} ${pw.active || mode === (id === "catapultBarrage" ? "barrage" : "") ? "is-on" : ""}`} onClick={() => castPower(id)} disabled={pw.cd > 0 || !pw.usable} title={`${def.name} (${def.key}): ${def.desc}`}>
                  <span className="cdCd" style={{ "--p": Math.max(0, pw.cd) / def.cd }} />
                  <span className="cdAbilityIcon">{def.icon}</span><span className="cdAbilityLabel">{def.label}</span>
                  {pw.cd > 0 && <span className="cdCdText">{Math.ceil(pw.cd)}</span>}
                </button>
              );
            })}
          </div>

          {/* soldier command bar */}
          {live && hud.selection.count > 0 && !targeting && (
            <div className={`cdCmd ${hud.selection.squad ? "is-squad" : ""} ${(hud.powerList || []).length > 3 ? "is-lifted" : ""}`} onPointerDown={(e) => e.stopPropagation()}>
              <div className="cdCmdHead">
                <strong>
                  {hud.selection.squad && <em className="cdCmdBadge">Squad</em>}
                  {hud.selection.count === 1 ? hud.selection.unit : hud.selection.squad ? `Whole squad · ${hud.selection.count} soldiers` : `${hud.selection.count} soldiers picked`}
                </strong>
                <button type="button" className={`cdCmdMini ${multi ? "is-on" : ""}`} onClick={() => setMulti((v) => !v)} title="Add or remove soldiers with each tap">Multi</button>
                {hud.selection.tower >= 0 && <button type="button" className="cdCmdMini" onClick={() => selectSquad(hud.selection.tower)} title="Select the whole squad">Squad</button>}
                <button type="button" className="cdCmdMini cdCmdClose" onClick={() => setSelUnits([])} aria-label="Deselect">✕</button>
              </div>
              <div className="cdCmdRow">
                <button type="button" onClick={() => enterMode("unitMove")} title="Walk to a spot you tap"><i>➜</i>Move</button>
                <button type="button" className={hud.selection.holding ? "is-on" : ""} onClick={toggleHold} title="Stand fast where they are"><i>⛨</i>{hud.selection.holding ? "Release" : "Hold"}</button>
                <button type="button" onClick={() => enterMode("unitAttack")} title="Attack an enemy you tap"><i>⚔</i>Attack</button>
                <button type="button" onClick={() => giveOrder({ kind: "gate" })} title="Guard the castle gate"><i>🏰</i>Defend Gate</button>
                <button type="button" onClick={() => enterMode("unitTower")} title="Guard a tower you tap"><i>🗼</i>Defend Tower</button>
                <button type="button" onClick={() => giveOrder({ kind: "rally" })} title="Return to the barracks rally flag"><i>⚑</i>Rally</button>
                {hud.selection.formation && (
                  <button type="button" className={`cdCmdAbility cdCmdFormation ${hud.selection.formation.on ? "is-on" : "is-ready"}`} onClick={toggleFormation} title={`${hud.selection.formation.name} (W): ${hud.selection.formation.desc}`}>
                    <i>{hud.selection.formation.icon}</i>{hud.selection.formation.on ? `Break ${hud.selection.formation.name}` : hud.selection.formation.name}
                  </button>
                )}
                {hud.selection.ability && (
                  <button type="button" className={`cdCmdAbility ${hud.selection.ability.ready ? "is-ready" : ""}`} disabled={!hud.selection.ability.ready} onClick={unitAbilityNow} title={hud.selection.ability.desc}>
                    <i>✦</i>{hud.selection.ability.name}{!hud.selection.ability.ready && <small>{Math.ceil(hud.selection.ability.cd)}s</small>}
                  </button>
                )}
              </div>
            </div>
          )}

          {modeHint && live && (
            <div className="cdModeHint">
              {modeHint}
              <button type="button" onClick={() => { setMode(null); setHeroSel(false); }}>Cancel</button>
            </div>
          )}

          {/* build ring on an empty plot */}
          {live && selPlotFree && (
            <div className="cdRing" ref={ringRef} onPointerDown={(e) => e.stopPropagation()}>
              {TOWER_ORDER.map((type, i) => {
                const def = TOWERS[type];
                const ok = s && canBuild(s, selected, type);
                const cost = hud.buildCosts ? hud.buildCosts[type] : def.cost;
                return (
                  <button
                    type="button"
                    key={type}
                    className={`cdRingBtn cdRingBtn--${i} ${ok ? "" : "is-off"}`}
                    onClick={() => doBuild(type)}
                    onMouseEnter={() => previewRange(type)}
                    onMouseLeave={() => previewRange(null)}
                    aria-label={`Build ${def.name} for ${def.cost} gold`}
                  >
                    <IconCanvas kind="tower" id={type} w={44} h={44} renderer={rendererRef} />
                    <span className="cdRingName">{def.short}</span>
                    <span className="cdRingCost"><span className="cdCoin cdCoin--s" />{cost}</span>
                    {!coarse && <span className="cdKey">{i + 1}</span>}
                  </button>
                );
              })}
              <button type="button" className="cdRingClose" onClick={() => select(-1)} aria-label="Close">✕</button>
            </div>
          )}

          {/* tower sheet */}
          {live && selTower && hud.tower && (
            <div className={`cdSheet ${sheetTop ? "cdSheet--float" : "cdSheet--bottom"}`} ref={sheetRef} onPointerDown={(e) => e.stopPropagation()}>
              <div className="cdSheetHead">
                <IconCanvas kind="tower" id={selTower.type} w={44} h={44} renderer={rendererRef} />
                <div>
                  <strong>{TOWERS[selTower.type].name}</strong>
                  <span>Level {selTower.level} · {hud.tower.mounted ? "Royal Knights" : hud.tower.pikes ? SOLDIERS[PIKE_UNITS[selTower.level - 1]].name : towerLevel(selTower.type, selTower.level).label}</span>
                </div>
                <button type="button" className="cdSheetClose" onClick={() => select(-1)} aria-label="Close">✕</button>
              </div>
              <p className="cdSheetStats">{towerStatLine(selTower.type, selTower.level, hud.tower.pikes, hud.tower.mounted)}</p>
              <div className="cdSheetRow">
                {hud.tower.upCost != null ? (
                  <button type="button" className={`cdBtn cdBtn--gold ${hud.tower.canUp ? "" : "is-off"}`} onClick={doUpgrade}>
                    Upgrade <span className="cdCost"><span className="cdCoin cdCoin--s" />{hud.tower.upCost}</span>{!coarse && <span className="cdKey">U</span>}
                  </button>
                ) : <span className="cdMax">Fully upgraded</span>}
                <button type="button" className="cdBtn cdBtn--ghost" onClick={doSell}>Sell <span className="cdCost"><span className="cdCoin cdCoin--s" />{hud.tower.sell}</span>{!coarse && <span className="cdKey">S</span>}</button>
              </div>
              {selTower.type === "barracks" && hud.tower.canDrill && (
                <div className="cdSheetRow cdDrill">
                  <button type="button" className={`cdBtn ${!hud.tower.pikes ? "is-on" : ""}`} onClick={() => doDrill(false)} title="Swords: armour and shields, steady against infantry">Swords{hud.tower.pikes && <span className="cdCost"><span className="cdCoin cdCoin--s" />{DRILL_COST}</span>}</button>
                  <button type="button" className={`cdBtn ${hud.tower.pikes ? "is-on" : ""}`} onClick={() => doDrill(true)} title="Pikes: brace against cavalry, weak to archers">Pikes{!hud.tower.pikes && <span className="cdCost"><span className="cdCoin cdCoin--s" />{DRILL_COST}</span>}</button>
                </div>
              )}
              {selTower.type === "barracks" && hud.tower.canMount && (
                <div className="cdSheetRow cdDrill">
                  {hud.tower.mounted
                    ? <button type="button" className="cdBtn is-on" onClick={() => doMount(false)} title="Back on foot as Royal Guard">Dismount</button>
                    : <button type="button" className="cdBtn cdBtn--gold" onClick={() => doMount(true)} title="Royal Knights: mounted, fast, Lance Charge; arrows find riders more easily">Mount up · Royal Knights<span className="cdCost"><span className="cdCoin cdCoin--s" />{MOUNT_COST}</span></button>}
                </div>
              )}
              <div className="cdSheetRow">
                {selTower.type === "barracks" && (
                  <button type="button" className={`cdBtn ${mode === "rally" ? "is-on" : ""}`} onClick={() => enterMode("rally")}>Rally point{!coarse && <span className="cdKey">T</span>}</button>
                )}
                {selTower.type === "barracks" && hud.tower.squad > 0 && (
                  <button type="button" className="cdBtn" onClick={() => selectSquad(selected)} title="Select the squad to give it orders">Select squad</button>
                )}
                {towerAbility(s, selected) && (
                  <button type="button" className={`cdBtn cdBtn--ability ${hud.tower.abilityCd <= 0 ? "is-ready" : "is-off"} ${mode === "ability" ? "is-on" : ""}`} onClick={() => hud.tower.abilityCd <= 0 && enterMode("ability")}>
                    {towerAbility(s, selected).name}{hud.tower.abilityCd > 0 ? ` · ${Math.ceil(hud.tower.abilityCd)}s` : ""}{!coarse && <span className="cdKey">E</span>}
                  </button>
                )}
              </div>
              {selTower.level < 4 && <p className="cdSheetNext">Next: {towerLevel(selTower.type, selTower.level + 1).label} — {nextLevelBlurb(selTower.type, selTower.level + 1)}</p>}
            </div>
          )}
        </>
      )}

      {/* perk choice at milestone waves */}
      {inGame && hud && hud.perkPending && hud.perkOffer && (
        <div className="cdOverlay cdOverlay--perk">
          <div className="cdPerkPanel">
            <p className="cdEyebrow">Wave {hud.wave} held · choose a perk</p>
            <h3>The realm rewards you</h3>
            <div className="cdPerks">
              {hud.perkOffer.map((id) => { const pk = PERK_BY_ID[id]; if (!pk) return null; const ic = PERK_ICON[pk.icon] || PERK_ICON.castle; return (
                <button type="button" key={id} className={`cdPerk cdPerk--${pk.rarity}`} onClick={() => doChoosePerk(id)}>
                  <span className="cdPerkSeal">{RARITY[pk.rarity].name}</span>
                  <IconCanvas kind={ic[0]} id={ic[1]} w={64} h={64} renderer={rendererRef} />
                  <strong>{pk.name}</strong>
                  <span>{pk.desc}</span>
                </button>
              ); })}
            </div>
            <button type="button" className="cdBtn cdBtn--ghost cdPerkSkip" onClick={doSkipPerk}>Skip for now</button>
          </div>
        </div>
      )}

      {confirmNew && (
        <div className="cdOverlay cdOverlay--modal">
          <div className="cdCard cdCard--slim">
            <p className="cdEyebrow">Saved battle</p>
            <h3>Replace it?</h3>
            <p className="cdResultLine">Starting a new battle will replace your current saved battle{battleStage ? ` (${battleStage.name}, wave ${battleWave?.counter})` : ""}.</p>
            <div className="cdCol">
              <button type="button" className="cdBtn cdBtn--main" onClick={continueBattle}>Continue saved battle</button>
              <button type="button" className="cdBtn" onClick={() => startRun(confirmNew.stageId, { ...confirmNew.opts, force: true })}>Start new battle</button>
              <button type="button" className="cdBtn cdBtn--ghost" onClick={() => setConfirmNew(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* banners */}
      {(inGame || screen === "intro" || screen === "outro") && banners.length > 0 && (
        <div className="cdBanners" aria-live="polite">
          {banners.map((b) => (
            <div key={b.id} className={`cdBanner cdBanner--${b.kind}`}>
              <strong>{b.text}</strong>
              {b.sub && <span>{b.sub}</span>}
            </div>
          ))}
        </div>
      )}

      {/* ------------------------------ intro ------------------------------ */}
      {screen === "outro" && (
        <div className={`cdIntro cdIntro--outro ${outroFrost ? "cdIntro--north" : ""}`} onClick={() => rendererRef.current?.skipOutro()}>
          <div className="cdLetterbox cdLetterbox--top" />
          <div className="cdLetterbox cdLetterbox--bottom" />
          <div className={`cdIntroText cdIntroText--${introPhase}`}>
            {introPhase === 0 && (outroFrost
              ? (<><p className="cdEyebrow">The ice gives way</p><h3>Vorne is broken</h3></>)
              : (<><p className="cdEyebrow">The warband breaks</p><h3>Blackmoor is fallen</h3></>))}
            {introPhase === 1 && (outroFrost
              ? (<><p className="cdEyebrow">The Frozen North</p><h3>The Cairnhold holds</h3></>)
              : (<><p className="cdEyebrow">The Realm of Ashford</p><h3>Ashford stands</h3></>))}
            {introPhase === 2 && (outroFrost
              ? (<><p className="cdEyebrow">Frostwatch Pass · Wolfpine Hollow · The Cairnhold</p><h3>The north is yours</h3></>)
              : (<><p className="cdEyebrow">Greenhollow · Stonebridge Ford · The Siege of Ashford</p><h3>The campaign is won</h3></>))}
          </div>
          <button type="button" className="cdSkip" onClick={(e) => { e.stopPropagation(); rendererRef.current?.skipOutro(); }}>Skip ▸</button>
        </div>
      )}

      {screen === "intro" && (
        <div className="cdIntro" onClick={skipIntro}>
          <div className="cdLetterbox cdLetterbox--top" />
          <div className="cdLetterbox cdLetterbox--bottom" />
          <div className={`cdIntroText cdIntroText--${introPhase}`}>
            {introPhase === 0 && (<><p className="cdEyebrow">{game?.stage.kingdom === "frost" ? "The Frozen North" : "The Realm of Ashford"}</p><h3>Stage {game?.stage.numeral} · {game?.stage.name}</h3></>)}
            {introPhase === 1 && (<><p className="cdEyebrow">{game?.stage.kingdom === "frost" ? "Out of the snow" : "From the west"}</p><h3>{game?.stage.kingdom === "frost" ? (game?.stage.id === "cairnhold" ? "Jarl Vorne comes to the Cairnhold" : "The northern host is moving") : game?.stage.id === "stonebridge" ? "The warband rides on Stonebridge" : "The Blackmoor Warband approaches"}</h3></>)}
            {introPhase >= 2 && (<>{(game?.stage.intro || []).map((l) => <h3 key={l} className="cdIntroLine">{l}</h3>)}</>)}
          </div>
          <button type="button" className="cdSkip" onClick={(e) => { e.stopPropagation(); skipIntro(); }}>Skip ▸</button>
        </div>
      )}

      {/* ------------------------------ menus ------------------------------ */}
      {screen === "menu" && (
        <div className="cdOverlay cdOverlay--menu">
          <div className="cdTitleBlock">
            <p className="cdEyebrow">Kianimation Studio presents</p>
            <h2 className="cdTitle">Castle<span>Defender</span></h2>
            <p className="cdTagline">Hold the Realm of Ashford against the Blackmoor Warband</p>
          </div>
          <nav className="cdMenu">
            {battle && battleStage && (
              <button type="button" className="cdBtn cdBtn--main cdBtn--continue" onClick={continueBattle}>
                <span>Continue</span>
                <small>{battleStage.name} · {battleWave?.endless ? `Wave ${battleWave.current} · Endless` : `Wave ${battleWave?.current} of ${battleWave?.total}`}</small>
              </button>
            )}
            <button type="button" className={`cdBtn ${battle ? "" : "cdBtn--main"}`} onClick={() => startRun(stageRecord(profile, STAGES[1].id).completed ? STAGES[1].id : stageRecord(profile, stage0.id).completed && STAGES[1].available ? STAGES[1].id : stage0.id)}>Play</button>
            <button type="button" className="cdBtn" onClick={() => { setScreen("campaign"); audioRef.current?.unlock(); audioRef.current?.play("open"); }}>Campaign</button>
            <button type="button" className="cdBtn" onClick={() => { setScreen("kingdoms"); audioRef.current?.unlock(); audioRef.current?.play("open"); }}>Kingdoms</button>
            <button type="button" className="cdBtn" onClick={() => { setHowPage(0); setScreen("howto"); audioRef.current?.unlock(); audioRef.current?.play("open"); }}>How to Play</button>
            <button type="button" className="cdBtn" onClick={() => { setScreen("settings"); audioRef.current?.unlock(); audioRef.current?.play("open"); }}>Settings</button>
          </nav>
          <div className="cdMenuFoot">
            <span><Stars n={rec0.stars} /> Greenhollow</span>
            <span>{stars} {stars === 1 ? "star" : "stars"} earned</span>
            <span title="Crowns buy kingdom upgrades on the Campaign page">👑 {crowns}</span>
            {badges.map((id) => (
              <span key={id} className="cdBadge cdBadge--sm" title={BADGES[id].desc}><i aria-hidden="true">{BADGES[id].icon}</i>{BADGES[id].name}</span>
            ))}
            <button type="button" className="cdIconBtn" onClick={toggleFullscreen} aria-label="Fullscreen">{fullscreen || pseudoFull ? "⤡" : "⤢"}</button>
          </div>
        </div>
      )}

      {screen === "campaign" && (
        <div className="cdOverlay cdOverlay--page">
          <div className="cdPage">
            <div className="cdPageHead">
              <button type="button" className="cdBack" onClick={() => setScreen("menu")}>‹ Back</button>
              <h3>The Campaign</h3>
              <button type="button" className="cdBack cdCrownBtn" onClick={() => { setScreen("kingdom"); audioRef.current?.play("open"); }} title="Spend crowns on permanent upgrades">👑 {crowns} · Kingdom upgrades</button>
              {badges.map((id) => (
                <span key={id} className="cdBadge" title={BADGES[id].desc}><i aria-hidden="true">{BADGES[id].icon}</i>{BADGES[id].name}</span>
              ))}
              <div className="cdDiff">
                {Object.entries(DIFFICULTY).map(([id, d]) => (
                  <button type="button" key={id} className={difficulty === id ? "is-on" : ""} onClick={() => setDifficulty(id)} title={d.desc}>{d.name}</button>
                ))}
              </div>
            </div>
            <div className="cdStageList">
              {KINGDOM_ORDER.map((kid) => {
                const realm = REALMS[kid];
                if (!realm) return null;
                const list = stagesOf(STAGES, kid);
                if (!list.length) return null;
                const open = isKingdomUnlocked(profile, kid);
                const done = (profile.campaignsDone || []).includes(kid);
                const won = list.filter((st) => stageRecord(profile, st.id).completed).length;
                const stars = list.reduce((n, st) => n + (difficulty === "hard" ? stageRecord(profile, st.id).hardStars : stageRecord(profile, st.id).stars), 0);
                return (
                  <section key={kid} className={`cdRealm ${open ? "" : "is-locked"} ${kid === "frost" ? "cdRealm--frost" : ""}`} aria-label={realm.name}>
                    <header className="cdRealmHead">
                      <div className="cdRealmTitle">
                        <p className="cdEyebrow">{realm.eyebrow}</p>
                        <h4>{realm.name}</h4>
                        <p className="cdRealmBlurb">{realm.blurb}</p>
                      </div>
                      {open && (
                        <div className="cdRealmMeta">
                          <span className="cdRealmStars" title="Stars in this kingdom">★ {stars} / {list.length * 3}</span>
                          <span>{won} of {list.length} stages won</span>
                          {done && badges.includes(realm.badge) && (
                            <span className="cdBadge cdBadge--realm" title={BADGES[realm.badge].desc}><i aria-hidden="true">{BADGES[realm.badge].icon}</i>{BADGES[realm.badge].name}</span>
                          )}
                        </div>
                      )}
                    </header>

                    {open && done && (
                      <div className="cdRealmDone">
                        <strong>Kingdom complete</strong>
                        <span>{realm.doneNote}</span>
                      </div>
                    )}

                    {open && (
                      <div className="cdRealmHero">
                        <IconCanvas kind="figure" id={realm.hero.id} w={46} h={56} renderer={rendererRef} className="cdRealmHeroArt" />
                        <div>
                          <p className="cdEyebrow">Your hero here</p>
                          <strong>{realm.hero.name}</strong>
                          <span>{realm.hero.note}</span>
                        </div>
                      </div>
                    )}

                    {open ? list.map((st) => {
                      const i = STAGES.indexOf(st);
                      const rec = stageRecord(profile, st.id);
                      const unlocked = isStageUnlocked(profile, STAGES, i);
                      return (
                        <article key={st.id} className={`cdStage ${unlocked ? "" : "is-locked"}`}>
                          <div className="cdStageNum">{st.numeral}</div>
                          <div className="cdStageBody">
                            <h4>{st.name}</h4>
                            <p className="cdStageSub">{st.subtitle}{st.waves.length ? ` · ${st.waves.length} waves` : ""}</p>
                            <p className="cdStageIntro">{st.intro.join(" ")}</p>
                            {unlocked ? (
                              <div className="cdStageMeta">
                                <Stars n={difficulty === "hard" ? rec.hardStars : rec.stars} />
                                <span>Best {fmt(rec.bestScore)}</span>
                                {rec.bestWave > 0 && <span>Endless: wave {rec.bestWave}</span>}
                              </div>
                            ) : (
                              <p className="cdLocked">{st.available ? "Complete the previous stage to unlock" : st.unlockNote}</p>
                            )}
                          </div>
                          {unlocked && (
                            <div className="cdStageActions">
                              <button type="button" className="cdBtn cdBtn--main" onClick={() => startRun(st.id, { difficulty })}>Play</button>
                              {rec.completed && <button type="button" className="cdBtn" onClick={() => startRun(st.id, { difficulty, mode: "endless" })}>Endless</button>}
                            </div>
                          )}
                        </article>
                      );
                    }) : (
                      <div className="cdFrostArt cdFrostArt--locked">
                        <IconCanvas kind="scene" id="frostNorth" w={760} h={310} renderer={rendererRef} className="cdFrostScene" fluid />
                        <div className="cdSnow" aria-hidden="true">{SNOW.map((f, i) => <i key={i} style={{ left: `${f.x}%`, animationDelay: `${f.d}s`, animationDuration: `${f.t}s`, width: f.s, height: f.s }} />)}</div>
                        <div className="cdFrostText">
                          <p className="cdEyebrow">{list.length} stages · a new hero</p>
                          <h4>{FROZEN_NORTH.name}</h4>
                          <p className="cdFrostFlavour">{FROZEN_NORTH.flavour.map((line) => <span key={line}>{line}</span>)}</p>
                          <span className="cdSoon cdSoon--frost">🔒 Win the Siege of Ashford to march north</span>
                        </div>
                      </div>
                    )}

                    {!open && (
                      <>
                        <div className="cdShadowRow">
                          {FROST_TEASERS.map((t) => (
                            <div key={t.id} className="cdShadowCard">
                              <IconCanvas kind="shade" id={t.id} w={78} h={78} renderer={rendererRef} className="cdShadowArt" fluid />
                              <strong>{t.name}</strong>
                              <span>{t.note}</span>
                            </div>
                          ))}
                        </div>
                        <div className="cdShadowCard cdShadowCard--hero">
                          <IconCanvas kind="shade" id={FROST_HERO.id} w={66} h={78} renderer={rendererRef} className="cdShadowArt cdShadowArt--hero" fluid />
                          <div>
                            <p className="cdEyebrow">New hero</p>
                            <strong>{FROST_HERO.name}</strong>
                            <span>{FROST_HERO.note}</span>
                          </div>
                        </div>
                      </>
                    )}
                  </section>
                );
              })}

              {northDone && (
                <section className="cdFrost cdFrost--sun" aria-label={`${SUNSPEAR.name}, coming soon`}>
                  <div className="cdFrostArt">
                    <IconCanvas kind="scene" id="sunReach" w={760} h={310} renderer={rendererRef} className="cdFrostScene" fluid />
                    <div className="cdFrostText">
                      <p className="cdEyebrow">{SUNSPEAR.eyebrow}</p>
                      <h4>{SUNSPEAR.name}</h4>
                      <p className="cdFrostFlavour">{SUNSPEAR.flavour.map((line) => <span key={line}>{line}</span>)}</p>
                      <span className="cdSoon cdSoon--sun">🔒 Coming soon</span>
                    </div>
                  </div>
                  <div className="cdShadowRow">
                    {SUN_TEASERS.map((t) => (
                      <div key={t.id} className="cdShadowCard">
                        <IconCanvas kind="shade" id={t.id} w={78} h={78} renderer={rendererRef} className="cdShadowArt" fluid />
                        <strong>{t.name}</strong>
                        <span>{t.note}</span>
                      </div>
                    ))}
                  </div>
                  <div className="cdShadowCard cdShadowCard--hero">
                    <IconCanvas kind="shade" id={SUN_HERO.id} w={66} h={78} renderer={rendererRef} className="cdShadowArt cdShadowArt--hero" fluid />
                    <div>
                      <p className="cdEyebrow">New hero — coming soon</p>
                      <strong>{SUN_HERO.name}</strong>
                      <span>{SUN_HERO.note}</span>
                    </div>
                  </div>
                </section>
              )}

              {realmDone && (
                <article className="cdStage cdStage--next is-locked">
                  <div className="cdStageNum">✦</div>
                  <div className="cdStageBody">
                    <h4>New Game+</h4>
                    <p className="cdStageSub">The whole campaign, again</p>
                    <p className="cdStageIntro">Replay every kingdom with tougher enemies and new rewards.</p>
                    <p className="cdLocked">Coming soon</p>
                  </div>
                </article>
              )}
            </div>
          </div>
        </div>
      )}

      {screen === "kingdom" && (
        <div className="cdOverlay cdOverlay--page">
          <div className="cdPage">
            <div className="cdPageHead">
              <button type="button" className="cdBack" onClick={() => setScreen("campaign")}>‹ Back</button>
              <h3>Kingdom Upgrades</h3>
              <span className="cdPageNote">👑 {crowns} crowns · earn one per star and three for a first victory</span>
            </div>
            <div className="cdUpgrades">
              {CATEGORIES.map((cat) => (
                <section key={cat.id} className="cdUpgradeCat">
                  <h4>{cat.name}</h4>
                  <p>{cat.desc}</p>
                  {KINGDOM_UPGRADES.filter((u) => u.cat === cat.id).map((u) => {
                    const level = profile.meta?.upgrades?.[u.id] || 0; const cost = kingdomCost(u.id, level);
                    return (
                      <div key={u.id} className="cdUpgrade">
                        <div><strong>{u.name}</strong><span>{u.desc}</span></div>
                        <span className="cdPips">{[1, 2, 3].map((i) => <i key={i} className={i <= level ? "is-on" : ""} />)}</span>
                        {cost == null ? <span className="cdMax">Max</span> : <button type="button" className={`cdBtn cdBtn--gold ${crowns >= cost ? "" : "is-off"}`} onClick={() => doBuyUpgrade(u.id)}>👑 {cost}</button>}
                      </div>
                    );
                  })}
                </section>
              ))}
            </div>
          </div>
        </div>
      )}

      {screen === "kingdoms" && (
        <div className="cdOverlay cdOverlay--page">
          <div className="cdPage">
            <div className="cdPageHead">
              <button type="button" className="cdBack" onClick={() => setScreen("menu")}>‹ Back</button>
              <h3>Kingdoms</h3>
              <span className="cdPageNote">Six kingdoms, each with its own castle, army and hero</span>
            </div>
            <div className="cdKingdoms">
              {KINGDOMS.map((k) => (
                <article key={k.id} className={`cdKingdom ${k.status === "playable" ? "" : "is-soon"}`} style={{ "--k1": k.colours.primary, "--k2": k.colours.secondary, "--k3": k.colours.ground }}>
                  <div className="cdKingdomBanner"><span /></div>
                  <div className="cdKingdomBody">
                    <p className="cdEyebrow">{k.style}</p>
                    <h4>{k.name}</h4>
                    <p>{k.tagline}</p>
                    <dl>
                      <dt>Hero</dt><dd>{k.hero.name} · {k.hero.ability}</dd>
                      <dt>Units</dt><dd>{k.units.join(", ")}</dd>
                      <dt>Land</dt><dd>{k.environment}</dd>
                    </dl>
                    {k.status === "playable"
                      ? <button type="button" className="cdBtn cdBtn--main" onClick={() => startRun(stage0.id)}>Play</button>
                      : <span className="cdSoon">Coming soon</span>}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      )}

      {screen === "howto" && (
        <div className="cdOverlay cdOverlay--page">
          <div className="cdPage cdPage--how">
            <div className="cdPageHead">
              <button type="button" className="cdBack" onClick={() => setScreen("menu")}>‹ Back</button>
              <h3>How to Play</h3>
              <span className="cdPageNote">{howPage + 1} / 4</span>
            </div>
            {howPage === 0 && (
              <div className="cdHow">
                <h4>Build on the plots</h4>
                <p>Enemies march along the road to your gate. {coarse ? "Tap" : "Click"} a stone plot beside the road to open the build ring, then pick a defence. Every tower has four levels and looks different at each one.</p>
                <div className="cdHowGrid">
                  {TOWER_ORDER.map((t) => (
                    <div key={t} className="cdHowCard">
                      <IconCanvas kind="tower" id={t} w={64} h={64} renderer={rendererRef} />
                      <strong>{TOWERS[t].name}</strong>
                      <span>{TOWERS[t].role}</span>
                      <em><span className="cdCoin cdCoin--s" />{TOWERS[t].cost}</em>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {howPage === 1 && (
              <div className="cdHow">
                <h4>Soldiers and Sir Edric</h4>
                <p>Barracks send three soldiers to a rally point on the road. They stop enemies so your towers can shoot. Sir Edric is yours to command: {coarse ? "tap his portrait, then tap where he should go. Hold the portrait" : "press H or click him, then click where he should go. Press Q"} for Royal Charge, which knocks down everyone in a line and interrupts big attacks.</p>
                <div className="cdHowGrid">
                  {["militia", "knight", "royalGuard", "hero"].map((u) => (
                    <div key={u} className="cdHowCard">
                      <IconCanvas kind="figure" id={u} w={64} h={72} renderer={rendererRef} />
                      <strong>{u === "hero" ? HERO.name : SOLDIERS[u].name}</strong>
                      <span>{u === "hero" ? "Health, sword, Royal Charge, five levels" : `${SOLDIERS[u].hp} health · ${Math.round(SOLDIERS[u].armour * 100)}% armour`}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {howPage === 2 && (
              <div className="cdHow">
                <h4>Know the warband</h4>
                <p>Arrows shred bandits but bounce off men-at-arms. Shield bearers block arrows from the front; catapults land behind them. Outriders break free from soldiers. Nothing blocks a battering ram, so bring ballistas. From Stonebridge on, knights charge on open ground: a red arrow shows where, and braced pikemen or a Royal Charge stop them.</p>
                <div className="cdHowGrid cdHowGrid--enemies">
                  {["bandit", "archer", "manAtArms", "outrider", "shieldBearer", "ram", "scoutCav", "knightCav", "cavCommander"].map((e) => (
                    <div key={e} className="cdHowCard">
                      <IconCanvas kind={ENEMIES[e].horse ? "horse" : e === "ram" ? "ram" : "figure"} id={ENEMIES[e].horse ? ENEMIES[e].horse : e === "manAtArms" ? "manAtArmsE" : e} w={e === "ram" ? 84 : 64} h={72} renderer={rendererRef} />
                      <strong>{ENEMIES[e].name}</strong>
                      <span>{ENEMIES[e].desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {howPage === 3 && (
              <div className="cdHow">
                <h4>Waves, abilities and stars</h4>
                <p>The road banner shows the next wave. Call it early for bonus gold. Between waves, spend on upgrades or repairs. Volley rains arrows anywhere, Reinforcements hold a spot for fifteen seconds, and Repair restores the gate for gold.</p>
                <ul className="cdHowList">
                  <li><Stars n={3} /> Finish with the castle above 90% health</li>
                  <li><Stars n={2} /> Finish above 50%</li>
                  <li><Stars n={1} /> Survive every wave</li>
                </ul>
                <div className="cdHowKeys">
                  {controlList.map(([k, what]) => <div key={k}><span>{k}</span>{what}</div>)}
                </div>
              </div>
            )}
            <div className="cdPager">
              <button type="button" className="cdBtn" disabled={howPage === 0} onClick={() => setHowPage((p) => p - 1)}>‹ Previous</button>
              {howPage < 3
                ? <button type="button" className="cdBtn cdBtn--main" onClick={() => setHowPage((p) => p + 1)}>Next ›</button>
                : <button type="button" className="cdBtn cdBtn--main" onClick={() => startRun(stage0.id)}>Play</button>}
            </div>
          </div>
        </div>
      )}

      {screen === "settings" && (
        <div className="cdOverlay cdOverlay--page">
          <div className="cdPage cdPage--settings">
            <div className="cdPageHead">
              <button type="button" className="cdBack" onClick={() => setScreen("menu")}>‹ Back</button>
              <h3>Settings</h3>
            </div>
            <div className="cdSettings">
              <label className="cdToggle"><span>Sound effects</span><input type="checkbox" checked={settings.sound} onChange={(e) => patchSettings({ sound: e.target.checked })} /><i /></label>
              <label className="cdToggle"><span>Music</span><input type="checkbox" checked={settings.music} onChange={(e) => patchSettings({ music: e.target.checked })} /><i /></label>
              <label className="cdSlider"><span>Effects volume</span><input type="range" min="0" max="1" step="0.05" value={settings.sfxVol} onChange={(e) => patchSettings({ sfxVol: Number(e.target.value) })} /></label>
              <label className="cdSlider"><span>Music volume</span><input type="range" min="0" max="1" step="0.05" value={settings.musicVol} onChange={(e) => patchSettings({ musicVol: Number(e.target.value) })} /></label>
              <div className="cdChoice">
                <span>Graphics quality</span>
                <div>
                  {["auto", "high", "low"].map((q) => <button type="button" key={q} className={settings.quality === q ? "is-on" : ""} onClick={() => patchSettings({ quality: q })}>{q[0].toUpperCase() + q.slice(1)}</button>)}
                </div>
              </div>
              {battle && battleStage && (
                <div className="cdChoice">
                  <span>Saved battle: {battleStage.name}, wave {battleWave?.counter}</span>
                  {confirmClear
                    ? <div><button type="button" className="cdBtn cdBtn--danger" onClick={() => { setProfile(clearBattle(readSave())); setConfirmClear(false); }}>Yes, clear it</button><button type="button" className="cdBtn" onClick={() => setConfirmClear(false)}>Keep it</button></div>
                    : <div><button type="button" className="cdBtn cdBtn--ghost" onClick={() => setConfirmClear(true)}>Clear saved battle</button></div>}
                </div>
              )}
              <div className="cdChoice">
                <span>Progress</span>
                {confirmReset
                  ? <div><button type="button" className="cdBtn cdBtn--danger" onClick={() => { setProfile(resetProgress(readSave())); setConfirmReset(false); }}>Yes, erase everything</button><button type="button" className="cdBtn" onClick={() => setConfirmReset(false)}>Keep it</button></div>
                  : <div><button type="button" className="cdBtn cdBtn--ghost" onClick={() => setConfirmReset(true)}>Reset progress</button></div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {screen === "paused" && (
        <div className="cdOverlay cdOverlay--thin">
          <div className="cdCard cdCard--slim">
            <p className="cdEyebrow">Stage {game?.stage.numeral} · wave {hud?.wave}</p>
            <h3>Paused</h3>
            <div className="cdCol">
              <button type="button" className="cdBtn cdBtn--main" onClick={resumeGame}>Resume</button>
              <button type="button" className="cdBtn" onClick={restart}>Restart stage</button>
              <div className="cdRow">
                <button type="button" className="cdBtn cdBtn--ghost" onClick={() => patchSettings({ sound: !settings.sound })}>{settings.sound ? "Sound on" : "Sound off"}</button>
                <button type="button" className="cdBtn cdBtn--ghost" onClick={() => patchSettings({ music: !settings.music })}>{settings.music ? "Music on" : "Music off"}</button>
              </div>
              <button type="button" className="cdBtn cdBtn--ghost" onClick={quitToMenu}>Main menu</button>
            </div>
          </div>
        </div>
      )}

      {screen === "victory" && results && (
        <div className="cdOverlay">
          <div className={`cdCard cdCard--result ${results.finale && results.mode !== "endless" ? "cdCard--conquered" : ""}`}>
            <p className="cdEyebrow">{results.mode === "endless" ? "The siege ends" : results.finale ? (winFrost ? "The Frozen North" : "Realm of Ashford") : `Stage ${game?.stage.numeral} complete`}</p>
            <h3>{results.finale && results.mode !== "endless" ? "Conquered" : "Victory"}</h3>
            <Stars n={starsShown} big />
            <p className="cdResultLine">{results.finale && results.mode !== "endless" ? (winFrost ? "Jarl Vorne is broken and the storm has passed. The Frozen North is yours." : "Warlord Blackmoor is dead and the siege is broken. The Realm of Ashford is yours.") : results.stars === 3 ? (winFrost ? "Barely a mark on the walls. The north salutes you." : "The walls barely scratched. Ashford salutes you.") : results.stars === 2 ? "The gate held, though the masons have work to do." : "Won by a thread. The castle needs rebuilding."}{results.crowns ? ` +${results.crowns} crowns for the kingdom.` : ""}</p>
            {results.finale && results.mode !== "endless" && (
              <div className="cdConquered">
                <div className="cdConqueredRow"><span>Best score</span><strong>{fmt(Math.max(results.score, stageRecord(profile, results.stageId).bestScore || 0))}</strong></div>
                <div className="cdConqueredRow"><span>Crowns earned</span><strong>👑 {results.crowns || 0}</strong></div>
                <div className="cdConqueredRow"><span>Perks earned</span><strong>{results.perks && results.perks.length ? results.perks.map((id) => PERK_BY_ID[id]?.name || id).join(" · ") : "None chosen"}</strong></div>
                <div className="cdConqueredRow"><span>Kingdom</span><strong>{winFrost ? "The Frozen North" : "The Realm of Ashford"}{results.realmComplete ? " · first conquest" : ""}</strong></div>
                {(results.newBadges || []).length > 0 && (
                  <div className="cdConqueredRow"><span>Badge earned</span><strong>{results.newBadges.map((id) => `${BADGES[id]?.icon || "★"} ${BADGES[id]?.name || id}`).join(" · ")}</strong></div>
                )}
              </div>
            )}
            <div className="cdResultGrid">
              <div><strong>{fmt(results.score)}</strong><span>Score{results.newBest ? " · new best" : ""}</span></div>
              <div><strong>{results.castleHp}/{results.castleMax}</strong><span>Castle health</span></div>
              <div><strong>{results.kills}</strong><span>Enemies felled</span></div>
              <div><strong>{results.heroLevel}</strong><span>{results.hero === "elara" ? "Lady Elara's level" : "Sir Edric's level"}</span></div>
            </div>
            <div className="cdCol">
              {(() => { const idx = STAGES.findIndex((st) => st.id === results.stageId); const next = STAGES[idx + 1]; if (results.finale && results.mode !== "endless") {
                  const nk = STAGES.find((st) => (st.kingdom || "ashford") !== (results.kingdom || "ashford") && KINGDOM_ORDER.indexOf(st.kingdom || "ashford") > KINGDOM_ORDER.indexOf(results.kingdom || "ashford"));
                  return nk
                    ? <button type="button" className="cdBtn cdBtn--main" onClick={() => startRun(nk.id)}>March north · {nk.name}</button>
                    : <div className="cdBtn cdBtn--soon" aria-disabled="true"><span>Next kingdom</span><small>Coming soon</small></div>;
                } return next && next.available && results.mode !== "endless"
                ? <button type="button" className="cdBtn cdBtn--main" onClick={() => startRun(next.id)}>Next stage · {next.name}</button>
                : <button type="button" className="cdBtn cdBtn--main" onClick={() => startRun(results.stageId, { mode: "endless" })}>Endless siege on this map</button>; })()}
              <div className="cdRow">
                <button type="button" className="cdBtn" onClick={() => startRun(results.stageId, { skipIntro: true })}>Play again</button>
                <button type="button" className="cdBtn cdBtn--ghost" onClick={quitToMenu}>Main menu</button>
              </div>
              {results.stageId === "greenhollow" && !STAGES[1].available && <p className="cdNote">Stage II, Stonebridge Ford, is in development.</p>}
              {results.finale && results.mode !== "endless" && <p className="cdNote">Endless siege on this map is open from the campaign page.</p>}
            </div>
          </div>
        </div>
      )}

      {screen === "defeat" && results && (
        <div className="cdOverlay">
          <div className="cdCard cdCard--result cdCard--defeat">
            <p className="cdEyebrow">{results.mode === "endless" ? `Endless · wave ${results.wave}` : `Wave ${results.wave} of ${results.totalWaves}`}</p>
            <h3>The gate has fallen</h3>
            <p className="cdResultLine">{results.mode === "endless" ? (results.newWave ? "A new record. Ashford remembers." : "The warband floods the courtyard.") : "The warband floods the courtyard. Rebuild and try again."}</p>
            <div className="cdResultGrid">
              <div><strong>{fmt(results.score)}</strong><span>Score{results.newBest ? " · new best" : ""}</span></div>
              <div><strong>{results.kills}</strong><span>Enemies felled</span></div>
              <div><strong>{results.heroLevel}</strong><span>{results.hero === "elara" ? "Lady Elara's level" : "Sir Edric's level"}</span></div>
              <div><strong>{Math.round(results.time)}s</strong><span>Held for</span></div>
            </div>
            <div className="cdCol">
              <button type="button" className="cdBtn cdBtn--main" onClick={restart}>Try again</button>
              <div className="cdRow">
                <button type="button" className="cdBtn" onClick={() => startRun(results.stageId, { mode: results.mode, skipIntro: results.mode === "endless" })}>Restart</button>
                <button type="button" className="cdBtn cdBtn--ghost" onClick={quitToMenu}>Main menu</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function towerStatLine(type, level, pikes, mounted) {
  const l = towerLevel(type, level);
  if (type === "barracks") { const u = SOLDIERS[mounted ? "royalKnight" : pikes ? PIKE_UNITS[level - 1] : l.unit]; return `3 × ${u.name} · ${u.hp} health · ${u.dmg[0]}–${u.dmg[1]} damage · ${Math.round(u.armour * 100)}% armour${u.spear ? " · braces and breaks cavalry charges · weak to arrows" : ""}${u.mounted ? " · mounted, speed " + u.speed + " · Lance Charge · arrows hit riders harder" : ""}`; }
  const base = `${l.dmg[0]}–${l.dmg[1]} damage · every ${l.rate}s · range ${l.range}`;
  if (type === "catapult") return `${base} · blast ${l.radius}${l.fire ? " · burning ground" : ""}`;
  if (type === "ballista") return `${base} · ignores ${Math.round(l.pierceArmour * 100)}% armour${l.pierceCount ? ` · pierces ${l.pierceCount}` : ""}`;
  return `${base} · ${l.shooters} archer${l.shooters > 1 ? "s" : ""}`;
}

function nextLevelBlurb(type, level) {
  const l = towerLevel(type, level);
  if (l.ability) return `unlocks ${l.ability.name}`;
  if (type === "barracks") return `${SOLDIERS[l.unit].name}, ${SOLDIERS[l.unit].hp} health`;
  const prev = towerLevel(type, level - 1);
  const parts = [];
  if (l.dmg[0] !== prev.dmg[0]) parts.push(`${l.dmg[0]}–${l.dmg[1]} damage`);
  if (l.rate !== prev.rate) parts.push(`every ${l.rate}s`);
  if (l.shooters !== prev.shooters) parts.push(`${l.shooters} archers`);
  if (l.radius !== prev.radius) parts.push(`blast ${l.radius}`);
  if (l.range !== prev.range) parts.push(`range ${l.range}`);
  return parts.join(", ") || "stronger";
}
