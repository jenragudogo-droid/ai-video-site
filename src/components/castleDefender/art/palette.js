/* ------------------------------------------------------------------ *
 * Castle Defender — art direction colours.
 *
 * Warm painted storybook: saturated but never neon, every surface has
 * a lit side and a shaded side (sun from the upper left), and thin
 * dark outlines keep figures readable on grass and road.
 * ------------------------------------------------------------------ */

export const PAL = {
  /* terrain */
  grass: "#6f9a45", grassLight: "#86b054", grassDark: "#4a7233", grassDeep: "#3b5c2a",
  road: "#c8a46a", roadDark: "#a3814a", roadEdge: "#8c6d3c", pebble: "#dcc394",
  river: "#3f7d93", riverDeep: "#2c5f74", riverFoam: "#cfe6ee", riverBank: "#8a9a5a",
  rock: "#8f8a7c", rockLight: "#b5b0a2", rockDark: "#5f5a50",
  trunk: "#5a3d22", trunkDark: "#3c2816", leaf: "#5f9a3c", leafLight: "#8bc25a", leafDark: "#2f5a2a",
  field: "#c9b25a", fieldDark: "#a8923f",
  shadow: "rgba(24, 30, 14, 0.32)",

  /* castle */
  stone: "#b8b0a0", stoneLight: "#d9d2c2", stoneDark: "#8a8274", stoneDeep: "#6c6558", mortar: "rgba(40,30,20,0.16)",
  roof: "#8e2a2a", roofDark: "#6a1e1e", wood: "#7a5230", woodLight: "#a5773f", woodDark: "#4a3320", iron: "#3b3b44", ironLight: "#6b6b78",
  gateWood: "#3b2a1c",

  /* the realm (defenders) */
  red: "#9b2a2a", redLight: "#c04040", redDark: "#6a1a1a",
  gold: "#d9a83a", goldLight: "#f1d27a", goldDark: "#9c7a2c",
  mail: "#9ea3ad", mailDark: "#6d727c", plate: "#c9cbd0", plateDark: "#8d9098", plateLight: "#eef0f2",
  cloth: "#5b6b8a", clothDark: "#3d4a63", leather: "#7c5a3a", leatherDark: "#54391f",
  skin: "#e8b48c", skinDark: "#b7845c", skin2: "#8f5b3a", skin2Dark: "#6b4229",
  hair: "#4a2f1a",

  /* the Blackmoor Warband (enemies) */
  black: "#2b2a30", blackLight: "#4a4852", blackDark: "#18171c",
  ash: "#6a6a70", ashLight: "#8d8d94",
  rust: "#7a3c2a", rustLight: "#a4563c",
  bone: "#d9cfae",
  warGrey: "#5f5a52",

  /* effects */
  arrow: "#c9a36a", arrowHead: "#e8e2d4", fire: "#ff9a2e", fireHot: "#ffe08a", smoke: "rgba(60,55,50,0.55)", dust: "rgba(190,165,120,0.55)",
  coin: "#f3c43c", coinDark: "#b8871e",
  hpGreen: "#5bbf4a", hpRed: "#c8402f", hpBack: "rgba(20,16,10,0.65)",

  /* light */
  sun: "rgba(255, 226, 170, 0.18)", warm: "#f2c98a",
};

/* hex → lighter/darker hex. amt in [-1, 1]. */
export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255; let g = (n >> 8) & 255; let b = n & 255;
  if (amt >= 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
  else { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
  return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
}

export function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
