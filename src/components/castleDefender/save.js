/* Local persistence for Castle Defender: stars and best scores per
   stage, endless best waves, settings. Falls back to memory when
   localStorage is unavailable (private browsing, node tests). */

const KEY = "castleDefenderSave.v1";

const DEFAULTS = {
  stages: {},                 // id -> { stars, bestScore, bestWave, completed, hardStars }
  settings: { sound: true, music: true, sfxVol: 0.8, musicVol: 0.55, quality: "auto", seenHowTo: false },
  campaignsDone: [],
};

let memory = null;

function storage() {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  } catch { /* blocked storage counts as absent */ }
  return null;
}

export function readSave() {
  const st = storage();
  try {
    const raw = st ? st.getItem(KEY) : memory;
    if (!raw) return structuredClone(DEFAULTS);
    const data = JSON.parse(raw);
    return {
      ...structuredClone(DEFAULTS),
      ...data,
      settings: { ...DEFAULTS.settings, ...(data.settings || {}) },
      stages: { ...(data.stages || {}) },
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function writeSave(save) {
  const raw = JSON.stringify(save);
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

/* Folds a finished run in and reports what was new. */
export function recordResult(save, sum) {
  const rec = { ...stageRecord(save, sum.stageId) };
  const flags = { newBest: false, newStars: false, newWave: false };
  if (sum.mode === "endless") {
    if (sum.wave > rec.bestWave) { rec.bestWave = sum.wave; flags.newWave = true; }
    if (sum.score > rec.bestScore) { rec.bestScore = sum.score; flags.newBest = true; }
  } else {
    if (sum.score > rec.bestScore) { rec.bestScore = sum.score; flags.newBest = true; }
    if (sum.won) {
      rec.completed = true;
      const key = sum.difficulty === "hard" ? "hardStars" : "stars";
      if (sum.stars > rec[key]) { rec[key] = sum.stars; flags.newStars = true; }
      if (sum.difficulty === "hard" && sum.stars > rec.stars) rec.stars = sum.stars;
    }
  }
  const next = { ...save, stages: { ...save.stages, [sum.stageId]: rec } };
  writeSave(next);
  return { save: next, ...flags };
}

export function saveSettings(save, patch) {
  const next = { ...save, settings: { ...save.settings, ...patch } };
  writeSave(next);
  return next;
}

export function resetProgress(save) {
  const next = { ...structuredClone(DEFAULTS), settings: save.settings };
  writeSave(next);
  return next;
}

export function totalStars(save) {
  return Object.values(save.stages).reduce((n, r) => n + (r.stars || 0), 0);
}

/* A stage is open when it is built and the previous stage is done. */
export function isStageUnlocked(save, stages, idx) {
  const st = stages[idx];
  if (!st || !st.available) return false;
  if (idx === 0) return true;
  return stageRecord(save, stages[idx - 1].id).completed;
}
