/* ------------------------------------------------------------------ *
 * Persistent profile in localStorage: coins, unlocks, upgrades,
 * career progress, best times, achievements, settings.
 * ------------------------------------------------------------------ */
import { DRIVERS, CARS, CUPS, ACHIEVEMENTS, driverById, carById, upgradeCost, UPGRADE_MAX } from "./data.js";

const KEY = "ktr-save-v1";

export function freshSave() {
  return {
    coins: 500,
    unlockedDrivers: ["blaze", "serwaa"],
    unlockedCars: ["sandfly", "kestrel"],
    selectedDriver: "blaze",
    selectedCar: "kestrel",
    cosmetics: { paint: "#d32f2f", decal: "none", rim: "#9aa2ab", flame: "#ff8c2e", glow: null },
    upgrades: {}, // carId -> {engine: n, ...}
    cupProgress: {}, // cupId -> { eventsDone: n, won: bool, points: [] }
    trophies: 0, stars: 0, xp: 0,
    bossesBeaten: [],
    bestTimes: {}, // trackId -> seconds
    bestLaps: {},
    emblems: {}, // trackId -> count found (max 3)
    achievements: [],
    stats: { races: 0, wins: 0, combos: 0, superCombos: 0, shortcuts: 0, bossWins: 0, driftBest: 0 },
    settings: { muted: false, quality: "auto", touch: "auto" },
    daily: null, // { date, trackId, type, done }
  };
}

export function readSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return freshSave();
    const s = { ...freshSave(), ...JSON.parse(raw) };
    s.stats = { ...freshSave().stats, ...s.stats };
    s.settings = { ...freshSave().settings, ...s.settings };
    return s;
  } catch { return freshSave(); }
}

export function writeSave(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ }
  return s;
}

export const trophiesOf = (s) => Object.values(s.cupProgress).filter((c) => c.won).length;

export function cupUnlocked(s, cup) {
  return trophiesOf(s) >= cup.need;
}

export function driverAvailable(s, d) {
  if (s.unlockedDrivers.includes(d.id)) return { ok: true };
  if (d.unlock?.type === "boss" && !s.bossesBeaten.includes(d.unlock.boss)) {
    return { ok: false, why: d.unlock.label };
  }
  if (d.cost > 0) return { ok: false, buy: d.cost };
  return { ok: false, buy: d.cost || 0 };
}

export function carAvailable(s, c) {
  if (s.unlockedCars.includes(c.id)) return { ok: true };
  if (c.unlock?.type === "boss" && !s.bossesBeaten.includes(c.unlock.boss)) {
    return { ok: false, why: c.unlock.label };
  }
  if (c.unlock?.type === "cup" && !s.cupProgress[c.unlock.cup]?.won) {
    return { ok: false, why: c.unlock.label };
  }
  return { ok: false, buy: c.cost };
}

export function buyDriver(s, id) {
  const d = driverById(id);
  const a = driverAvailable(s, d);
  if (a.ok || a.why || s.coins < (a.buy || 0)) return null;
  s.coins -= a.buy || 0;
  s.unlockedDrivers.push(id);
  return writeSave(s);
}

export function buyCar(s, id) {
  const c = carById(id);
  const a = carAvailable(s, c);
  if (a.ok || a.why || s.coins < (a.buy || 0)) return null;
  s.coins -= a.buy || 0;
  s.unlockedCars.push(id);
  return writeSave(s);
}

export function buyUpgrade(s, carId, upId) {
  const ups = s.upgrades[carId] || {};
  const lvl = ups[upId] || 0;
  if (lvl >= UPGRADE_MAX) return null;
  const cost = upgradeCost(lvl);
  if (s.coins < cost) return null;
  s.coins -= cost;
  s.upgrades[carId] = { ...ups, [upId]: lvl + 1 };
  return writeSave(s);
}

export function award(s, id) {
  if (s.achievements.includes(id)) return null;
  const a = ACHIEVEMENTS.find((x) => x.id === id);
  if (!a) return null;
  s.achievements.push(id);
  s.coins += a.coins;
  return a;
}

/* Deterministic daily challenge from the date. */
export function dailyChallenge(s) {
  const date = new Date().toISOString().slice(0, 10);
  if (s.daily?.date !== date) {
    let h = 0;
    for (const ch of date) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const tracks = ["beach", "hills", "mountain", "coastal", "canyon", "neon", "jungle", "volcano"];
    const types = ["race", "timeTrial", "elimination", "driftChallenge", "powerBattle"];
    s.daily = { date, trackId: tracks[h % tracks.length], type: types[(h >> 3) % types.length], done: false, reward: 250 };
    writeSave(s);
  }
  return s.daily;
}

/* Apply a finished race's results to the profile. Returns notices. */
export function recordRace(s, results, ctx = {}) {
  const notices = [];
  const unlocked = [];
  s.coins += results.coins + (ctx.bonusCoins || 0);
  s.stars += results.stars;
  s.xp += results.coins;
  s.stats.races += 1;
  if (results.won) s.stats.wins += 1;
  s.stats.combos += results.combos;
  s.stats.superCombos += results.superCombos;
  if (results.usedShortcut) s.stats.shortcuts += 1;
  s.stats.driftBest = Math.max(s.stats.driftBest, results.driftScore);

  if (results.time && (!s.bestTimes[results.trackId] || results.time < s.bestTimes[results.trackId])) {
    s.bestTimes[results.trackId] = results.time;
    notices.push({ kind: "record", text: `New best time on this track: ${results.time.toFixed(1)}s` });
  }
  if (results.bestLap && (!s.bestLaps[results.trackId] || results.bestLap < s.bestLaps[results.trackId])) {
    s.bestLaps[results.trackId] = results.bestLap;
  }
  if (results.emblemsFound) {
    s.emblems[results.trackId] = Math.min(3, (s.emblems[results.trackId] || 0) + results.emblemsFound);
  }

  /* boss rewards */
  if (results.bossBeaten && !s.bossesBeaten.includes(results.boss)) {
    s.bossesBeaten.push(results.boss);
    s.stats.bossWins += 1;
    const bossData = ctx.boss;
    if (bossData?.reward) {
      s.coins += bossData.reward.coins || 0;
      if (bossData.reward.car && !s.unlockedCars.includes(bossData.reward.car)) {
        s.unlockedCars.push(bossData.reward.car);
        unlocked.push({ kind: "car", id: bossData.reward.car });
      }
      if (bossData.reward.driver && !s.unlockedDrivers.includes(bossData.reward.driver)) {
        s.unlockedDrivers.push(bossData.reward.driver);
        unlocked.push({ kind: "driver", id: bossData.reward.driver });
      }
      notices.push({ kind: "boss", text: `${bossData.name} defeated! ${bossData.reward.label}` });
    }
  }

  /* achievements */
  const tryA = (id, cond) => {
    if (!cond) return;
    const a = award(s, id);
    if (a) notices.push({ kind: "achievement", text: `Achievement: ${a.name} (+${a.coins})` });
  };
  tryA("firstWin", results.won);
  tryA("comboFirst", results.combos > 0);
  tryA("superCombo", results.superCombos > 0);
  tryA("shortcutFound", !!results.usedShortcut);
  tryA("driftKing", results.driftScore >= 2000);
  tryA("bossDown", results.bossBeaten);
  tryA("allBosses", s.bossesBeaten.length >= 5);
  tryA("spaceRace", ["station", "moon", "mars", "asteroid"].includes(results.trackId));
  tryA("rich", s.coins >= 5000);
  tryA("garageFull", s.unlockedCars.length >= 6);
  tryA("emblemHunter", Object.values(s.emblems).reduce((a, b) => a + b, 0) >= 10);
  tryA("cleanRace", results.won && results.timesHit === 0);
  tryA("photoFinish", results.won && results.photoFinish);

  /* daily challenge */
  if (s.daily && !s.daily.done && results.trackId === s.daily.trackId && results.mode === s.daily.type && results.place <= 3) {
    s.daily.done = true;
    s.coins += s.daily.reward;
    notices.push({ kind: "daily", text: `Daily challenge complete! +${s.daily.reward} coins` });
  }

  writeSave(s);
  return { notices, unlocked };
}

/* Career: mark an event finished; handle cup completion + rewards. */
export function recordCupEvent(s, cupId, eventIdx, results, champPoints) {
  const cup = CUPS.find((c) => c.id === cupId);
  if (!cup) return {};
  const prog = s.cupProgress[cupId] || { eventsDone: 0, won: false, points: [] };
  const notices = [];
  if (eventIdx === prog.eventsDone && results.place <= (cup.championship ? 6 : 3) && !results.eliminatedOut) {
    prog.points[eventIdx] = champPoints;
    prog.eventsDone += 1;
    if (prog.eventsDone >= cup.events.length) {
      const total = prog.points.reduce((a, b) => a + (b || 0), 0);
      const needed = cup.championship ? cup.events.length * 10 * 0.55 : 0;
      const champWon = !cup.championship || total >= needed;
      if (champWon && !prog.won) {
        prog.won = true;
        s.coins += cup.reward.coins;
        s.trophies = trophiesOf(s) + 1;
        notices.push({ kind: "cup", text: `${cup.name} WON! +${cup.reward.coins} coins 🏆` });
      } else if (!champWon) {
        prog.eventsDone = 0; prog.points = [];
        notices.push({ kind: "cupFail", text: `Not enough championship points — the ${cup.name} restarts.` });
      }
    }
  } else if (eventIdx === prog.eventsDone) {
    notices.push({ kind: "cupFail", text: cup.championship ? "Low score — but the championship continues." : "Finish top 3 to advance. Try again!" });
    if (cup.championship) { prog.points[eventIdx] = champPoints; prog.eventsDone += 1; }
  }
  s.cupProgress[cupId] = prog;
  writeSave(s);
  return { notices, prog };
}

export const allDrivers = () => DRIVERS;
export const allCars = () => CARS;
