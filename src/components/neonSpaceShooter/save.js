/* Local persistence for Neon Space Shooter: best score, lifetime
   crystal total and settings. Falls back to memory when localStorage
   is unavailable (private browsing, node tests). */

const KEY = "neonSpaceShooterSave.v1";

const DEFAULTS = { best: 0, crystals: 0, settings: { muted: false } };

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

/* Folds a finished run in and reports whether it set a record. */
export function recordRun(save, run) {
  const isRecord = run.score > save.best;
  const next = {
    ...save,
    best: Math.max(save.best, run.score),
    crystals: save.crystals + run.crystals,
  };
  writeSave(next);
  return { save: next, isRecord };
}

export function saveSettings(save, patch) {
  const next = { ...save, settings: { ...save.settings, ...patch } };
  writeSave(next);
  return next;
}
