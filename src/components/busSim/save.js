/* ------------------------------------------------------------------ *
 * City Bus Simulator — journey persistence.
 *
 * One small JSON blob in localStorage holds everything needed to put a
 * driver back where they left off. The world itself is never stored: it
 * is regenerated from the seed, which keeps the save a couple of kB and
 * means an old save can never contradict the current world generator —
 * at worst the bus lands somewhere that is no longer road, and the
 * engine's restore validates and re-seats it.
 * ------------------------------------------------------------------ */

export const SAVE_KEY = "kianimation.busSim.journey.v1";
const VERSION = 1;

function store() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    // Safari in private mode throws on write, not on access
    const k = "__bsim_probe__";
    window.localStorage.setItem(k, "1");
    window.localStorage.removeItem(k);
    return window.localStorage;
  } catch {
    return null;
  }
}

export function saveAvailable() {
  return !!store();
}

function valid(save) {
  if (!save || typeof save !== "object") return false;
  if (save.version !== VERSION) return false;
  const s = save.snapshot;
  if (!s || typeof s !== "object") return false;
  if (!Number.isFinite(s.seed)) return false;
  if (!s.bus || !Number.isFinite(s.bus.x) || !Number.isFinite(s.bus.z)) return false;
  if (!Array.isArray(s.stops) || !s.stops.length) return false;
  return true;
}

/** The stored journey, or null when there is nothing usable. */
export function readSave() {
  const ls = store();
  if (!ls) return null;
  try {
    const raw = ls.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (valid(parsed)) return parsed;
  } catch {
    // unreadable: fall through and clear it out
  }
  // anything we cannot use is removed, so it is not retried on every load
  try { ls.removeItem(SAVE_KEY); } catch { /* nothing we can do */ }
  return null;
}

export function writeSave(snapshot, ui) {
  const ls = store();
  if (!ls) return false;
  try {
    ls.setItem(SAVE_KEY, JSON.stringify({
      version: VERSION,
      savedAt: Date.now(),
      snapshot,
      ui: ui || {},
    }));
    return true;
  } catch {
    // quota or private mode — a journey that cannot be saved is not fatal
    return false;
  }
}

export function clearSave() {
  const ls = store();
  if (!ls) return;
  try { ls.removeItem(SAVE_KEY); } catch { /* nothing we can do */ }
}

/** Short human summary for the Continue button. */
export function describeSave(save, routeName, regionName) {
  if (!save) return "";
  const s = save.snapshot;
  const stop = (s.routeIdx | 0) + 1;
  const total = s.stops.length;
  const bits = [];
  if (routeName) bits.push(routeName);
  bits.push(`stop ${Math.min(stop, total)} of ${total}`);
  if (regionName) bits.push(regionName);
  const when = save.savedAt ? timeAgo(save.savedAt) : "";
  if (when) bits.push(when);
  return bits.join(" · ");
}

function timeAgo(ts) {
  const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (secs < 90) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}
