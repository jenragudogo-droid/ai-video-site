/* ------------------------------------------------------------------ *
 * Local persistence for Castle Defender.
 *
 * One versioned record: campaign progress (stars, scores, completions),
 * the chosen difficulty, kingdom-level upgrades and their currency,
 * settings, and an optional saved battle for Continue. Falls back to
 * memory when localStorage is unavailable (private browsing, node
 * tests). An unreadable or older record never crashes the game: the
 * parts we understand are kept, the rest is dropped.
 * ------------------------------------------------------------------ */

import { BADGES, BADGE_ORDER } from "./data/frozenNorth.js";

const KEY = "castleDefenderSave.v1";   // storage key stays; `version` inside tells the format
export const SAVE_VERSION = 2;

const DEFAULTS = {
  version: SAVE_VERSION,
  stages: {},                 // id -> { stars, bestScore, bestWave, completed, hardStars }
  settings: { sound: true, music: true, sfxVol: 0.8, musicVol: 0.55, quality: "auto", seenHowTo: false },
  campaignsDone: [],
  difficulty: "normal",
  meta: { crowns: 0, spent: 0, upgrades: {}, unlocks: [] },
  badges: [],                 // cosmetic only: ids from data/frozenNorth.js BADGES
  battle: null,               // serialized battle from engine.serializeGame, or null
};

/* Badges that follow from progress the save already records. Deriving
   them (rather than only awarding them once) means a player who
   finished the campaign before badges existed has theirs the moment
   they load, and nobody can lose one to a half-written save. */
function derivedBadges(save) {
  const out = [];
  for (const [id, def] of Object.entries(BADGES)) {
    if (def.kingdom && (save.campaignsDone || []).includes(def.kingdom)) out.push(id);
  }
  return out;
}

/* the save's badges, existing plus derived, in display order */
export function badgesOf(save) {
  const held = new Set([...(save.badges || []), ...derivedBadges(save)]);
  return BADGE_ORDER.filter((id) => held.has(id));
}

export function hasBadge(save, id) {
  return badgesOf(save).includes(id);
}

let memory = null;

function storage() {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  } catch { /* blocked storage counts as absent */ }
  return null;
}

/* Bring any older record up to the current shape without losing progress. */
function migrate(data) {
  const out = structuredClone(DEFAULTS);
  if (!data || typeof data !== "object") return out;
  if (data.stages && typeof data.stages === "object") {
    for (const [id, rec] of Object.entries(data.stages)) {
      if (rec && typeof rec === "object") out.stages[id] = { stars: 0, bestScore: 0, bestWave: 0, completed: false, hardStars: 0, ...rec };
    }
  }
  if (data.settings && typeof data.settings === "object") out.settings = { ...out.settings, ...data.settings };
  if (Array.isArray(data.campaignsDone)) out.campaignsDone = data.campaignsDone.slice();
  if (data.difficulty === "hard" || data.difficulty === "normal") out.difficulty = data.difficulty;
  if (data.meta && typeof data.meta === "object") out.meta = { ...out.meta, ...data.meta, upgrades: { ...(data.meta.upgrades || {}) }, unlocks: Array.isArray(data.meta.unlocks) ? data.meta.unlocks.slice() : [] };
  /* badges: keep any that were stored, then add the ones progress has already earned */
  const stored = Array.isArray(data.badges) ? data.badges.filter((id) => BADGES[id]) : [];
  out.badges = BADGE_ORDER.filter((id) => new Set([...stored, ...derivedBadges(out)]).has(id));
  /* a saved battle only survives if it was written by this format */
  if (data.version === SAVE_VERSION && data.battle && typeof data.battle === "object" && data.battle.stageId) out.battle = data.battle;
  return out;
}

export function readSave() {
  const st = storage();
  try {
    const raw = st ? st.getItem(KEY) : memory;
    if (!raw) return structuredClone(DEFAULTS);
    return migrate(JSON.parse(raw));
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function writeSave(save) {
  const raw = JSON.stringify({ ...save, version: SAVE_VERSION });
  const st = storage();
  try {
    if (st) st.setItem(KEY, raw);
    else memory = raw;
  } catch { memory = raw; }
  return save;
}

export function stageRecord(save, id) {
  return save.stages[id] || { stars: 0, bestScore: 0, bestWave: 0, completed: false, hardStars: 0 };
}

/* Crowns are the kingdom-upgrade currency: one per star, three more for
   a first completion. Returns what was new. */
export function recordResult(save, sum) {
  const rec = { ...stageRecord(save, sum.stageId) };
  const flags = { newBest: false, newStars: false, newWave: false, crowns: 0, realmComplete: false, newBadges: [] };
  if (sum.mode === "endless") {
    if (sum.wave > rec.bestWave) { rec.bestWave = sum.wave; flags.newWave = true; flags.crowns += Math.floor((sum.wave - (save.stages[sum.stageId]?.bestWave || 0)) / 5); }
    if (sum.score > rec.bestScore) { rec.bestScore = sum.score; flags.newBest = true; }
  } else {
    if (sum.score > rec.bestScore) { rec.bestScore = sum.score; flags.newBest = true; }
    if (sum.won) {
      if (!rec.completed) flags.crowns += 3;
      rec.completed = true;
      const key = sum.difficulty === "hard" ? "hardStars" : "stars";
      if (sum.stars > rec[key]) { flags.crowns += sum.stars - rec[key]; rec[key] = sum.stars; flags.newStars = true; }
      if (sum.difficulty === "hard" && sum.stars > rec.stars) rec.stars = sum.stars;
    }
  }
  /* the last stage of a kingdom: the realm is complete */
  let campaignsDone = save.campaignsDone || [];
  if (sum.won && sum.finale && sum.kingdom && !campaignsDone.includes(sum.kingdom)) { campaignsDone = [...campaignsDone, sum.kingdom]; flags.realmComplete = true; flags.crowns += 5; }
  const meta = { ...save.meta, crowns: (save.meta?.crowns || 0) + flags.crowns };
  /* a finished kingdom earns its cosmetic badge, once */
  const badges = BADGE_ORDER.filter((id) => new Set([...(save.badges || []), ...derivedBadges({ campaignsDone })]).has(id));
  flags.newBadges = badges.filter((id) => !(save.badges || []).includes(id));
  /* only a finished battle leaves the slot; quitting to the menu keeps it for Continue */
  const next = { ...save, stages: { ...save.stages, [sum.stageId]: rec }, meta, campaignsDone, badges, battle: sum.finished ? null : save.battle };
  writeSave(next);
  return { save: next, ...flags };
}

export function saveSettings(save, patch) {
  const next = { ...save, settings: { ...save.settings, ...patch } };
  writeSave(next);
  return next;
}

export function saveDifficulty(save, difficulty) {
  const next = { ...save, difficulty };
  writeSave(next);
  return next;
}

/* ------------------------------ battle slot ------------------------------ */

export function saveBattle(save, battle) {
  const next = { ...save, battle: { ...battle, savedAt: Date.now() } };
  writeSave(next);
  return next;
}

export function clearBattle(save) {
  if (!save.battle) return save;
  const next = { ...save, battle: null };
  writeSave(next);
  return next;
}

/* ------------------------------ kingdom upgrades ------------------------------ */

export function buyUpgrade(save, id, cost) {
  const meta = save.meta || DEFAULTS.meta;
  if ((meta.crowns || 0) < cost) return null;
  const upgrades = { ...meta.upgrades, [id]: (meta.upgrades[id] || 0) + 1 };
  const next = { ...save, meta: { ...meta, crowns: meta.crowns - cost, spent: (meta.spent || 0) + cost, upgrades } };
  writeSave(next);
  return next;
}

export function addUnlock(save, id) {
  const meta = save.meta || DEFAULTS.meta;
  if (meta.unlocks.includes(id)) return save;
  const next = { ...save, meta: { ...meta, unlocks: [...meta.unlocks, id] } };
  writeSave(next);
  return next;
}

export function resetProgress(save) {
  /* a full reset clears badges too: they are a record of this profile's run */
  const next = { ...structuredClone(DEFAULTS), settings: save.settings };
  writeSave(next);
  return next;
}

export function totalStars(save) {
  return Object.values(save.stages).reduce((n, r) => n + (r.stars || 0), 0);
}

/* Kingdoms open in order: Ashford from the start, and each one after it
   when the kingdom before it has been completed. */
export const KINGDOM_ORDER = ["ashford", "frost"];

export function isKingdomUnlocked(save, kingdomId) {
  const i = KINGDOM_ORDER.indexOf(kingdomId);
  if (i <= 0) return i === 0;
  return (save.campaignsDone || []).includes(KINGDOM_ORDER[i - 1]);
}

export function stagesOf(stages, kingdomId) {
  return stages.filter((st) => (st.kingdom || "ashford") === kingdomId);
}

/* A stage is open when it is built, its kingdom is open, and the stage
   before it *in that kingdom* is done. `idx` is an index into `stages`,
   which may hold more than one kingdom. */
export function isStageUnlocked(save, stages, idx) {
  const st = stages[idx];
  if (!st || !st.available) return false;
  const kid = st.kingdom || "ashford";
  if (!isKingdomUnlocked(save, kid)) return false;
  const mine = stagesOf(stages, kid);
  const at = mine.findIndex((x) => x.id === st.id);
  if (at <= 0) return true;
  return stageRecord(save, mine[at - 1].id).completed;
}
