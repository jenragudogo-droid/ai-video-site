/* ------------------------------------------------------------------ *
 * Kianimation Endless Rush — persistence.
 *
 * One small JSON blob in localStorage holds the records, the coin bank,
 * which characters have been bought and which one is selected. Nothing
 * about a run is stored: the track is regenerated from a seed, so there
 * is nothing to go stale and nothing that grows over time.
 *
 * Every access is wrapped, because localStorage is not actually
 * guaranteed: Safari's private mode throws on write rather than on
 * access, some embedded browsers disable it outright, and a full quota
 * throws too. A player whose browser refuses to store anything still
 * gets a complete game — they just start each session at zero.
 *
 * Two separate coin numbers matter and they are easy to confuse:
 *   `totalCoins` is a lifetime tally and only ever goes up.
 *   `bank`       is what is left to spend, and buying a character
 *                subtracts from it.
 * A purchase is permanent: an unlocked id is never removed, so nobody is
 * ever asked to buy the same character twice on the same profile.
 * ------------------------------------------------------------------ */

import { CHARACTERS, DEFAULT_CHARACTER } from "./characters.js";

export const SAVE_KEY = "kianimation.endlessRush.v1";
const VERSION = 2;

const IDS = CHARACTERS.map((c) => c.id);
const FREE = CHARACTERS.filter((c) => !c.price).map((c) => c.id);

const BLANK = {
  version: VERSION,
  highScore: 0,
  bestDistance: 0,
  bestCoins: 0,
  totalCoins: 0,
  bank: 0,
  runs: 0,
  unlocked: [...FREE],
  selected: DEFAULT_CHARACTER,
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

  /* Anything the free roster includes is always unlocked, and anything
     that is not a real character id is dropped — a profile written by an
     older build, or edited by hand, still has to describe this game. */
  const unlocked = Array.isArray(v.unlocked)
    ? [...new Set([...FREE, ...v.unlocked.filter((id) => IDS.includes(id))])]
    : [...FREE];
  const selected = IDS.includes(v.selected) && unlocked.includes(v.selected)
    ? v.selected : DEFAULT_CHARACTER;

  const totalCoins = num(v.totalCoins);
  /* v1 profiles have no bank. Everything earned back then was unspent by
     definition, so it all carries over rather than being written off. */
  const bank = v.bank === undefined ? totalCoins : num(v.bank);

  return {
    version: VERSION,
    highScore: num(v.highScore),
    bestDistance: num(v.bestDistance),
    bestCoins: num(v.bestCoins),
    totalCoins,
    bank: Math.min(bank, totalCoins),
    runs: num(v.runs),
    unlocked,
    selected,
    settings: {
      muted: !!(v.settings && v.settings.muted),
      music: v.settings ? v.settings.music !== false : true,
      hints: v.settings ? v.settings.hints !== false : true,
    },
  };
}

const blank = () => ({ ...BLANK, unlocked: [...FREE], settings: { ...BLANK.settings } });

/** The stored profile, or a blank one. Never returns null. */
export function readSave() {
  const ls = store();
  if (!ls) return blank();
  try {
    const raw = ls.getItem(SAVE_KEY);
    if (raw) {
      const parsed = sane(JSON.parse(raw));
      if (parsed) return parsed;
    }
  } catch {
    // unreadable, or from a build that no longer exists — start clean
  }
  try { ls.removeItem(SAVE_KEY); } catch { /* nothing useful to do */ }
  return blank();
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
 * Returns { profile, isRecord } so the results card can celebrate.
 */
export function recordRun(profile, run) {
  const next = {
    ...profile,
    settings: { ...profile.settings },
    unlocked: [...profile.unlocked],
    runs: profile.runs + 1,
    totalCoins: profile.totalCoins + (run.coins | 0),
    bank: profile.bank + (run.coins | 0),
  };
  const isRecord = run.score > profile.highScore;
  if (isRecord) next.highScore = Math.floor(run.score);
  if (run.distance > profile.bestDistance) next.bestDistance = Math.floor(run.distance);
  if (run.coins > profile.bestCoins) next.bestCoins = run.coins | 0;
  writeSave(next);
  return { profile: next, isRecord };
}

/** Buys a character. Returns the profile unchanged when it cannot. */
export function buyCharacter(profile, id) {
  const ch = CHARACTERS.find((c) => c.id === id);
  if (!ch) return { profile, bought: false, reason: "unknown" };
  if (profile.unlocked.includes(id)) return { profile, bought: false, reason: "owned" };
  if (profile.bank < ch.price) return { profile, bought: false, reason: "coins" };
  const next = {
    ...profile,
    settings: { ...profile.settings },
    bank: profile.bank - ch.price,
    unlocked: [...profile.unlocked, id],
    selected: id,
  };
  writeSave(next);
  return { profile: next, bought: true };
}

export function selectCharacter(profile, id) {
  if (!profile.unlocked.includes(id)) return profile;
  const next = { ...profile, settings: { ...profile.settings }, selected: id };
  writeSave(next);
  return next;
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
