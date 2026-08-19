/* ------------------------------------------------------------------ *
 * Kianimation Football League — clubs and players.
 *
 * Every club, kit and player in the KFL is original and fictional.
 * Squads are generated from a fixed seed so the same club always has
 * the same players, which keeps save-free browsing consistent while
 * costing far less than shipping 150 hand written player records.
 * ------------------------------------------------------------------ */

import { ROLE_LINE, positionFit } from "./formations.js";

/* ------------------------------- rng ------------------------------- */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hashString = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const pick = (rand, list) => list[Math.floor(rand() * list.length)];
const between = (rand, lo, hi) => lo + rand() * (hi - lo);
const intBetween = (rand, lo, hi) => Math.round(between(rand, lo, hi));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ---------------------------- name pools ---------------------------- */
/* Invented given names and surnames — not modelled on real players. */

const FIRST_NAMES = [
  "Kofi", "Milo", "Rafe", "Dario", "Nuno", "Teodor", "Kwabena", "Ilyas", "Bruno", "Sami",
  "Vito", "Emeka", "Otis", "Lasse", "Kai", "Andrei", "Marek", "Tarik", "Juho", "Nando",
  "Salif", "Renzo", "Yannick", "Bo", "Iker", "Nkosi", "Dimitri", "Ferran", "Osei", "Luka",
  "Amadou", "Cato", "Jonas", "Rui", "Zeno", "Hakim", "Nils", "Tomas", "Ade", "Marius",
  "Elvin", "Kian", "Rasmus", "Sefu", "Bastien", "Ivo", "Nael", "Otto", "Diallo", "Remo",
  "Tavi", "Joel", "Kenji", "Mateo", "Aro", "Sandro", "Ruben", "Hugo", "Nathan", "Fode",
];

const LAST_NAMES = [
  "Adeyemi", "Vance", "Okoro", "Brandt", "Salgado", "Mensah", "Rivas", "Falk", "Duarte", "Novak",
  "Owusu", "Marchetti", "Verhoek", "Sylla", "Kastrati", "Bergman", "Da Costa", "Ferreiro", "Kalu", "Petrov",
  "Nyarko", "Solano", "Vandermeer", "Ibarra", "Lindqvist", "Traore", "Basara", "Oduya", "Renard", "Krause",
  "Amankwah", "Delgado", "Hovland", "Bakare", "Moreau", "Zanetti", "Osei-Bonsu", "Kovac", "Alvarado", "Dembo",
  "Steiner", "Marfo", "Quintero", "Bergstrom", "Ncube", "Farah", "Roldan", "Vukovic", "Boateng", "Serrano",
  "Lindmark", "Achebe", "Pardo", "Halvorsen", "Cisse", "Mabuza", "Rinaldi", "Tetteh", "Vasquez", "Ekstrom",
];

const NATIONS = [
  "Ghana", "Brazil", "Spain", "Nigeria", "Portugal", "France", "Croatia", "Sweden",
  "Senegal", "Italy", "Netherlands", "Argentina", "Morocco", "Japan", "Norway",
  "Serbia", "Ivory Coast", "Mexico", "Denmark", "Uruguay", "Cameroon", "Poland",
];

/* --------------------------- appearance ---------------------------- */

export const SKIN_TONES = ["#f3cfae", "#e8b98d", "#cf9b6b", "#a9714a", "#7d4c2e", "#5b3520"];
export const HAIR_COLOURS = ["#181212", "#2c1d13", "#4a2f1c", "#7b5321", "#c39b52", "#e8e2d4", "#a02f1e"];
export const HAIR_STYLES = ["short", "fade", "afro", "curls", "buzz", "long", "bun", "mohawk", "braids", "bald"];
export const BOOT_COLOURS = ["#f5f2ec", "#111114", "#ff5a1f", "#22d3a0", "#ffd83d", "#5b8cff", "#ff3d8b"];

function makeAppearance(rand) {
  return {
    skin: pick(rand, SKIN_TONES),
    hair: pick(rand, HAIR_STYLES),
    hairColour: pick(rand, HAIR_COLOURS),
    boots: pick(rand, BOOT_COLOURS),
    /* height in cm, drives how tall the figure is drawn and heading power */
    height: intBetween(rand, 168, 196),
    /* 0 lean .. 1 powerful, drives torso width */
    build: Math.round(between(rand, 0, 1) * 100) / 100,
    beard: rand() < 0.32,
    sleeves: rand() < 0.35 ? "long" : "short",
    socks: rand() < 0.25 ? "high" : "normal",
  };
}

/* ---------------------------- attributes ---------------------------- */

/* Weighting per role: [pace, shooting, passing, dribbling, defending, physical]. */
const ROLE_WEIGHTS = {
  GK: [0.55, 0.25, 0.55, 0.45, 0.4, 0.8],
  LB: [0.95, 0.45, 0.75, 0.72, 0.9, 0.8],
  RB: [0.95, 0.45, 0.75, 0.72, 0.9, 0.8],
  CB: [0.72, 0.35, 0.62, 0.55, 1.0, 1.0],
  LWB: [1.0, 0.52, 0.78, 0.8, 0.82, 0.82],
  RWB: [1.0, 0.52, 0.78, 0.8, 0.82, 0.82],
  CDM: [0.72, 0.5, 0.85, 0.72, 0.95, 0.95],
  CM: [0.8, 0.68, 0.95, 0.85, 0.75, 0.82],
  CAM: [0.85, 0.82, 0.97, 0.95, 0.5, 0.7],
  LM: [0.95, 0.68, 0.85, 0.9, 0.62, 0.72],
  RM: [0.95, 0.68, 0.85, 0.9, 0.62, 0.72],
  LW: [1.0, 0.82, 0.8, 0.98, 0.42, 0.66],
  RW: [1.0, 0.82, 0.8, 0.98, 0.42, 0.66],
  CF: [0.9, 0.95, 0.8, 0.9, 0.42, 0.85],
  ST: [0.93, 1.0, 0.72, 0.85, 0.35, 0.9],
};

const OUTFIELD_OVERALL = {
  gk: [0.1, 0.1, 0.2, 0.15, 0.2, 0.25],
  def: [0.12, 0.03, 0.13, 0.1, 0.4, 0.22],
  mid: [0.14, 0.14, 0.28, 0.2, 0.14, 0.1],
  att: [0.22, 0.33, 0.13, 0.22, 0.02, 0.08],
};

function makeAttributes(rand, role, tier) {
  const w = ROLE_WEIGHTS[role];
  const base = tier + between(rand, -7, 7);
  const roll = (weight) => clamp(Math.round(base * (0.55 + weight * 0.55) + between(rand, -6, 6)), 28, 96);

  const attrs = {
    pace: roll(w[0]),
    shooting: roll(w[1]),
    passing: roll(w[2]),
    dribbling: roll(w[3]),
    defending: roll(w[4]),
    physical: roll(w[5]),
    stamina: clamp(Math.round(base * 0.95 + between(rand, -8, 10)), 45, 97),
  };

  if (role === "GK") {
    attrs.diving = clamp(Math.round(base + between(rand, -5, 7)), 40, 95);
    attrs.handling = clamp(Math.round(base + between(rand, -6, 6)), 40, 94);
    attrs.kicking = clamp(Math.round(base + between(rand, -10, 6)), 35, 92);
    attrs.reflexes = clamp(Math.round(base + between(rand, -4, 8)), 42, 96);
    attrs.positioning = clamp(Math.round(base + between(rand, -6, 6)), 40, 94);
  }

  const line = ROLE_LINE[role];
  const weights = OUTFIELD_OVERALL[line];
  let overall;
  if (role === "GK") {
    overall = Math.round(
      attrs.diving * 0.21 + attrs.handling * 0.21 + attrs.reflexes * 0.24 +
      attrs.positioning * 0.21 + attrs.kicking * 0.13,
    );
  } else {
    const vals = [attrs.pace, attrs.shooting, attrs.passing, attrs.dribbling, attrs.defending, attrs.physical];
    overall = Math.round(vals.reduce((sum, v, i) => sum + v * weights[i], 0));
  }
  attrs.overall = clamp(overall, 40, 94);
  return attrs;
}

/* ------------------------------ squads ------------------------------ */

/* 18 players: a full XI shape plus a seven man bench. */
const SQUAD_PLAN = [
  "GK", "GK",
  "LB", "CB", "CB", "CB", "RB", "LWB", "RWB",
  "CDM", "CDM", "CM", "CM", "CAM", "LM", "RM",
  "LW", "RW", "ST", "ST", "CF",
];

function makeSquad(club) {
  const rand = mulberry32(hashString(`kfl:${club.id}`));
  const usedNames = new Set();
  const usedNumbers = new Set();

  const nextNumber = (role, index) => {
    let n = role === "GK" ? (index === 0 ? 1 : intBetween(rand, 12, 40)) : intBetween(rand, 2, 45);
    let guard = 0;
    while (usedNumbers.has(n) && guard < 90) {
      n = intBetween(rand, 2, 60);
      guard += 1;
    }
    usedNumbers.add(n);
    return n;
  };

  return SQUAD_PLAN.map((role, i) => {
    let name = `${pick(rand, FIRST_NAMES)} ${pick(rand, LAST_NAMES)}`;
    let guard = 0;
    while (usedNames.has(name) && guard < 40) {
      name = `${pick(rand, FIRST_NAMES)} ${pick(rand, LAST_NAMES)}`;
      guard += 1;
    }
    usedNames.add(name);

    /* the first eleven entries of the plan are the strongest players */
    const starterBoost = i < 11 ? 4 : -3;
    const attrs = makeAttributes(rand, role, club.tier + starterBoost);

    return {
      id: `${club.id}-${i}`,
      name,
      number: nextNumber(role, i),
      position: role,
      nationality: pick(rand, NATIONS),
      age: intBetween(rand, 18, 35),
      foot: rand() < 0.24 ? "Left" : "Right",
      look: makeAppearance(rand),
      ...attrs,
    };
  }).sort((a, b) => b.overall - a.overall);
}

/* ------------------------------ clubs ------------------------------- */
/* Original club identities, kits and grounds — no real world branding. */

const CLUB_DEFS = [
  {
    id: "kianimation-united", name: "Kianimation United", short: "Kianimation", abbr: "KIA",
    city: "Studio City", tier: 78, nickname: "The Storytellers",
    kit: { shirt: "#7b3cff", shirtAlt: "#4a1f9e", shorts: "#12101c", socks: "#7b3cff", number: "#f7f3ff", trim: "#f4b965" },
    gkKit: { shirt: "#22d3a0", shirtAlt: "#0d7a5c", shorts: "#0b1a17", socks: "#22d3a0", number: "#04140f", trim: "#04140f" },
  },
  {
    id: "accra-comets", name: "Accra Comets", short: "Comets", abbr: "ACC",
    city: "Accra", tier: 76, nickname: "The Sky Riders",
    kit: { shirt: "#f4b965", shirtAlt: "#c07f22", shorts: "#141212", socks: "#f4b965", number: "#2a1a06", trim: "#2a1a06" },
    gkKit: { shirt: "#ff4d6d", shirtAlt: "#a11b36", shorts: "#1a0a10", socks: "#ff4d6d", number: "#fff0f3", trim: "#fff0f3" },
  },
  {
    id: "north-harbour", name: "North Harbour FC", short: "Harbour", abbr: "NHB",
    city: "North Harbour", tier: 74, nickname: "The Dockers",
    kit: { shirt: "#1e5fd0", shirtAlt: "#0d3576", shorts: "#f6f6f8", socks: "#1e5fd0", number: "#f4f8ff", trim: "#f4f8ff" },
    gkKit: { shirt: "#ffd83d", shirtAlt: "#b3910f", shorts: "#1b1a10", socks: "#ffd83d", number: "#241f04", trim: "#241f04" },
  },
  {
    id: "savannah-lions", name: "Savannah Lions", short: "Lions", abbr: "SAV", 
    city: "Savannah", tier: 79, nickname: "The Pride",
    kit: { shirt: "#e8a020", shirtAlt: "#8c5a06", shorts: "#8c5a06", socks: "#e8a020", number: "#2a1804", trim: "#2a1804" },
    gkKit: { shirt: "#3a3f4a", shirtAlt: "#1d2027", shorts: "#12141a", socks: "#3a3f4a", number: "#e9edf5", trim: "#e9edf5" },
  },
  {
    id: "iron-valley", name: "Iron Valley", short: "Iron Valley", abbr: "IRV",
    city: "Iron Valley", tier: 72, nickname: "The Forge",
    kit: { shirt: "#d02020", shirtAlt: "#7c0f0f", shorts: "#151013", socks: "#d02020", number: "#fff1f1", trim: "#fff1f1" },
    gkKit: { shirt: "#7ce27c", shirtAlt: "#2f7c2f", shorts: "#0e1a0e", socks: "#7ce27c", number: "#08210a", trim: "#08210a" },
  },
  {
    id: "coastline-rangers", name: "Coastline Rangers", short: "Coastline", abbr: "CLR",
    city: "Coastline", tier: 71, nickname: "The Tide",
    kit: { shirt: "#12b5c9", shirtAlt: "#0a6d7a", shorts: "#0b1418", socks: "#12b5c9", number: "#eafcff", trim: "#eafcff" },
    gkKit: { shirt: "#f06a1f", shirtAlt: "#8f3906", shorts: "#1a0f06", socks: "#f06a1f", number: "#28120a", trim: "#28120a" },
  },
  {
    id: "midnight-athletic", name: "Midnight Athletic", short: "Midnight", abbr: "MID",
    city: "Midnight Row", tier: 77, nickname: "The Owls",
    kit: { shirt: "#20223a", shirtAlt: "#0d0e1c", shorts: "#20223a", socks: "#c8ccf5", number: "#dfe3ff", trim: "#8c93ff" },
    gkKit: { shirt: "#c6ff4d", shirtAlt: "#6c9b0b", shorts: "#141a06", socks: "#c6ff4d", number: "#1c2405", trim: "#1c2405" },
  },
  {
    id: "highland-wanderers", name: "Highland Wanderers", short: "Highland", abbr: "HLW",
    city: "Highland", tier: 70, nickname: "The Ridge",
    kit: { shirt: "#f2f3f7", shirtAlt: "#c3c7d4", shorts: "#1b2f52", socks: "#f2f3f7", number: "#1b2338", trim: "#1b2338" },
    gkKit: { shirt: "#8a2be2", shirtAlt: "#4d128a", shorts: "#150a22", socks: "#8a2be2", number: "#f4ecff", trim: "#f4ecff" },
  },
];

export const CLUBS = CLUB_DEFS.map((c) => ({ ...c, squad: makeSquad(c) }));

export const clubById = (id) => CLUBS.find((c) => c.id === id) || CLUBS[0];

export const DEFAULT_HOME = "kianimation-united";
export const DEFAULT_AWAY = "savannah-lions";

/** Best available XI for a formation, greedy by rating in slot. */
export function autoLineup(squad, formation) {
  const taken = new Set();
  const keeper = squad.find((p) => p.position === "GK");
  const xi = [];

  formation.slots.forEach((slot) => {
    if (slot.role === "GK") {
      xi.push(keeper.id);
      taken.add(keeper.id);
      return;
    }
    let best = null;
    let bestScore = -1;
    squad.forEach((p) => {
      if (taken.has(p.id) || p.position === "GK") return;
      const score = p.overall * positionFit(p.position, slot.role);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    });
    xi.push(best.id);
    taken.add(best.id);
  });

  const bench = squad.filter((p) => !taken.has(p.id)).slice(0, 7).map((p) => p.id);
  return { xi, bench };
}

export function teamRating(squad, xi) {
  const chosen = xi.map((id) => squad.find((p) => p.id === id)).filter(Boolean);
  if (!chosen.length) return 0;
  return Math.round(chosen.reduce((sum, p) => sum + p.overall, 0) / chosen.length);
}
