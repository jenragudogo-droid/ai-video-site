/* ------------------------------------------------------------------ *
 * Kianimation Football League — formations.
 * A formation is 11 slots. Each slot has a role and a normalised spot
 * on the pitch: nx 0 = own goal line, 1 = opponent goal line,
 * ny 0 = left touchline, 1 = right touchline (from the team's own view).
 * The engine mirrors these for whichever direction a team attacks.
 * ------------------------------------------------------------------ */

export const ROLES = [
  "GK", "LB", "CB", "RB", "LWB", "RWB",
  "CDM", "CM", "CAM", "LM", "RM",
  "LW", "RW", "CF", "ST",
];

/** Broad family of each role — used for out-of-position penalties. */
export const ROLE_LINE = {
  GK: "gk",
  LB: "def", CB: "def", RB: "def", LWB: "def", RWB: "def",
  CDM: "mid", CM: "mid", CAM: "mid", LM: "mid", RM: "mid",
  LW: "att", RW: "att", CF: "att", ST: "att",
};

/** How natural a player is in a slot (1 = perfect). Drives the pre-match warning. */
const NEIGHBOURS = {
  GK: [],
  LB: ["LWB", "CB", "LM"], CB: ["LB", "RB", "CDM"], RB: ["RWB", "CB", "RM"],
  LWB: ["LB", "LM"], RWB: ["RB", "RM"],
  CDM: ["CM", "CB"], CM: ["CDM", "CAM", "LM", "RM"], CAM: ["CM", "CF", "LW", "RW"],
  LM: ["LW", "LB", "CM"], RM: ["RW", "RB", "CM"],
  LW: ["LM", "CF", "CAM"], RW: ["RM", "CF", "CAM"],
  CF: ["ST", "CAM", "LW", "RW"], ST: ["CF", "CAM"],
};

export function positionFit(natural, slot) {
  if (natural === slot) return 1;
  if (natural === "GK" || slot === "GK") return 0.35;
  if (NEIGHBOURS[natural]?.includes(slot)) return 0.94;
  if (ROLE_LINE[natural] === ROLE_LINE[slot]) return 0.88;
  return 0.78;
}

/** Rating a player actually plays at in a given slot. */
export function ratingInSlot(player, slot) {
  return Math.round(player.overall * positionFit(player.position, slot));
}

export const FORMATIONS = {
  "4-3-3": {
    id: "4-3-3",
    name: "4-3-3",
    style: "Wide attacking",
    note: "Three up top, wingers stretch the pitch.",
    slots: [
      { role: "GK", nx: 0.045, ny: 0.5 },
      { role: "LB", nx: 0.24, ny: 0.14 },
      { role: "CB", nx: 0.17, ny: 0.38 },
      { role: "CB", nx: 0.17, ny: 0.62 },
      { role: "RB", nx: 0.24, ny: 0.86 },
      { role: "CDM", nx: 0.35, ny: 0.5 },
      { role: "CM", nx: 0.48, ny: 0.3 },
      { role: "CM", nx: 0.48, ny: 0.7 },
      { role: "LW", nx: 0.72, ny: 0.14 },
      { role: "ST", nx: 0.79, ny: 0.5 },
      { role: "RW", nx: 0.72, ny: 0.86 },
    ],
  },
  "4-4-2": {
    id: "4-4-2",
    name: "4-4-2",
    style: "Balanced",
    note: "Flat bank of four, two strikers.",
    slots: [
      { role: "GK", nx: 0.045, ny: 0.5 },
      { role: "LB", nx: 0.24, ny: 0.14 },
      { role: "CB", nx: 0.17, ny: 0.38 },
      { role: "CB", nx: 0.17, ny: 0.62 },
      { role: "RB", nx: 0.24, ny: 0.86 },
      { role: "LM", nx: 0.5, ny: 0.14 },
      { role: "CM", nx: 0.44, ny: 0.38 },
      { role: "CM", nx: 0.44, ny: 0.62 },
      { role: "RM", nx: 0.5, ny: 0.86 },
      { role: "ST", nx: 0.76, ny: 0.38 },
      { role: "ST", nx: 0.76, ny: 0.62 },
    ],
  },
  "4-2-3-1": {
    id: "4-2-3-1",
    name: "4-2-3-1",
    style: "Control",
    note: "Double pivot behind a creative ten.",
    slots: [
      { role: "GK", nx: 0.045, ny: 0.5 },
      { role: "LB", nx: 0.24, ny: 0.14 },
      { role: "CB", nx: 0.17, ny: 0.38 },
      { role: "CB", nx: 0.17, ny: 0.62 },
      { role: "RB", nx: 0.24, ny: 0.86 },
      { role: "CDM", nx: 0.34, ny: 0.38 },
      { role: "CDM", nx: 0.34, ny: 0.62 },
      { role: "LW", nx: 0.63, ny: 0.15 },
      { role: "CAM", nx: 0.6, ny: 0.5 },
      { role: "RW", nx: 0.63, ny: 0.85 },
      { role: "ST", nx: 0.8, ny: 0.5 },
    ],
  },
  "3-5-2": {
    id: "3-5-2",
    name: "3-5-2",
    style: "Wing-backs",
    note: "Back three with flying wing-backs.",
    slots: [
      { role: "GK", nx: 0.045, ny: 0.5 },
      { role: "CB", nx: 0.17, ny: 0.28 },
      { role: "CB", nx: 0.15, ny: 0.5 },
      { role: "CB", nx: 0.17, ny: 0.72 },
      { role: "LWB", nx: 0.46, ny: 0.1 },
      { role: "CM", nx: 0.38, ny: 0.5 },
      { role: "CM", nx: 0.5, ny: 0.33 },
      { role: "CM", nx: 0.5, ny: 0.67 },
      { role: "RWB", nx: 0.46, ny: 0.9 },
      { role: "ST", nx: 0.78, ny: 0.4 },
      { role: "CF", nx: 0.74, ny: 0.6 },
    ],
  },
  "5-3-2": {
    id: "5-3-2",
    name: "5-3-2",
    style: "Counter attack",
    note: "Five at the back, break at speed.",
    slots: [
      { role: "GK", nx: 0.045, ny: 0.5 },
      { role: "LWB", nx: 0.3, ny: 0.1 },
      { role: "CB", nx: 0.16, ny: 0.3 },
      { role: "CB", nx: 0.13, ny: 0.5 },
      { role: "CB", nx: 0.16, ny: 0.7 },
      { role: "RWB", nx: 0.3, ny: 0.9 },
      { role: "CM", nx: 0.42, ny: 0.3 },
      { role: "CM", nx: 0.4, ny: 0.5 },
      { role: "CM", nx: 0.42, ny: 0.7 },
      { role: "ST", nx: 0.74, ny: 0.4 },
      { role: "CF", nx: 0.72, ny: 0.6 },
    ],
  },
};

export const FORMATION_IDS = Object.keys(FORMATIONS);
