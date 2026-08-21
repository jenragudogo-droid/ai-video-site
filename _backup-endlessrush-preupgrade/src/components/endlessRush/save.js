/* ------------------------------------------------------------------ *
 * Kianimation Endless Rush — persistence.
 *
 * One small JSON blob in localStorage holds the high score, the lifetime
 * coin count and the player's settings. Nothing about the run itself is
 * stored: the track is regenerated from a seed, so there is nothing to
 * go stale and nothing that can grow over time.
 *
 * Every access is wrapped, because localStorage is not actually
 * guaranteed: Safari's private mode throws on write rather than on
 * access, some embedded browsers disable it outright, and a full quota
 * throws too. A player whose browser refuses to store anything still
 * gets a complete game — they just start each session at zero.
 * ------------------------------------------------------------------ */

export const SAVE_KEY = "kianimation.endlessRush.v1";
const VERSION = 1;

const BLANK = {
  version: VERSION,
  highScore: 0,
  bestDistance: 0,
  bestCoins: 0,
  totalCoins: 0,
  runs: 0,
  settings: { muted: false, music: true, hints: true },
};

function store() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    const probe = "__rush_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

export function saveAvailable() {
  return !!store();
}

function sane(v) {
  if (!v || typeof v !== "object") return null;
  const num = (x) => (Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0);
  return {
    version: VERSION,
    highScore: num(v.highScore),
    bestDistance: num(v.bestDistance),
    bestCoins: num(v.bestCoins),
    totalCoins: num(v.totalCoins),
    runs: num(v.runs),
    settings: {
      muted: !!(v.settings && v.settings.muted),
      music: v.settings ? v.settings.music !== false : true,
      hints: v.settings ? v.settings.hints !== false : true,
    },
  };
}

/** The stored profile, or a blank one. Never returns null. */
export function readSave() {
  const ls = store();
  if (!ls) return { ...BLANK, settings: { ...BLANK.settings } };
  try {
    const raw = ls.getItem(SAVE_KEY);
    if (raw) {
      const parsed = sane(JSON.parse(raw));
      if (parsed) return parsed;
    }
  } catch {
    // unreadable or from a future version — start clean rather than crash
  }
  try { ls.removeItem(SAVE_KEY); } catch { /* nothing useful to do */ }
  return { ...BLANK, settings: { ...BLANK.settings } };
}

export function writeSave(profile) {
  const ls = store();
  if (!ls) return false;
  try {
    ls.setItem(SAVE_KEY, JSON.stringify(sane(profile) || BLANK));
    return true;
  } catch {
    return false;
  }
}

/**
 * Folds one finished run into the profile and writes it back.
 * Returns { profile, isRecord } so the game-over screen can celebrate.
 */
export function recordRun(profile, run) {
  const next = {
    ...profile,
    settings: { ...profile.settings },
    runs: profile.runs + 1,
    totalCoins: profile.totalCoins + (run.coins | 0),
  };
  const isRecord = run.score > profile.highScore;
  if (isRecord) next.highScore = Math.floor(run.score);
  if (run.distance > profile.bestDistance) next.bestDistance = Math.floor(run.distance);
  if (run.coins > profile.bestCoins) next.bestCoins = run.coins | 0;
  writeSave(next);
  return { profile: next, isRecord };
}

export function saveSettings(profile, patch) {
  const next = { ...profile, settings: { ...profile.settings, ...patch } };
  writeSave(next);
  return next;
}

export function clearSave() {
  const ls = store();
  if (!ls) return;
  try { ls.removeItem(SAVE_KEY); } catch { /* nothing useful to do */ }
}
