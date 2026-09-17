/* ------------------------------------------------------------------ *
 * Castle Defender — kingdom teasers and cosmetic badges.
 *
 * The Frozen North was teased here in v1.1 and is a real kingdom in
 * v2.0: its enemies, hero and stages now live in enemies.js, towers.js
 * and stages.js, and what stays here is the badge and the teaser copy
 * the campaign map still shows before it is unlocked.
 *
 * The Sunspear Reach is the next tease, and follows the same rule the
 * Frozen North did: art, a name, and deliberately no stats, so a locked
 * card can never be mistaken for a balance decision made early.
 * ------------------------------------------------------------------ */

export const FROZEN_NORTH = {
  id: "frost",
  name: "The Frozen North",
  eyebrow: "The next kingdom",
  scene: "frostNorth",
  /* two short lines: any longer and it stops reading as a legend */
  flavour: [
    "Beyond Ashford's northern border,",
    "an ancient army is waking beneath the snow.",
  ],
  environment: "Snow-covered mountains, frozen forest and ruined watchtowers",
  status: "playable",
};

/* Kingdom three, teased in v2.0 and real in v3.0: sand and heat against
   Ashford's green and the north's white. The teaser copy below is what
   the campaign map still shows while the Reach is locked. */
export const SUNSPEAR = {
  id: "sun",
  name: "The Sunspear Reach",
  eyebrow: "Kingdom three",
  scene: "sunReach",
  flavour: [
    "South past the last frozen river,",
    "the Reach's own guard has turned on it.",
  ],
  environment: "Red dunes, sandstone bastions and a sun that does not set",
  status: "playable",
};

/* Kingdom four is only a plan. It is drawn up in the war room on the
   Kingdoms page with the rest of the roadmap, and it says so: no art,
   no stats, no promises it cannot keep. */
export const NEXT_REALM = {
  id: "savanna",
  name: "The Kingdom of the Golden Stool",
  eyebrow: "The next kingdom",
  flavour: [
    "Beyond the last dune the sand gives way to grass,",
    "and a fortified city that has never opened its gates.",
  ],
  environment: "Warm savanna, forest edge and a city of woven banners",
  status: "soon",
};

export const SUN_TEASERS = [
  { id: "duneRaider", name: "Dune Raider", art: "figure", note: "Rides the sand" },
  { id: "sandWyrm", name: "Sand Wyrm", art: "wyrm", note: "Comes from below" },
  { id: "sunGuard", name: "Sunspear Guard", art: "figure", note: "Bronze and fire" },
];

export const SUN_HERO = { id: "kesi", name: "Kesi of the Reach", art: "figure", note: "Spear-dancer · sun and sand" };

/* Shadow cards. `art` picks the silhouette the renderer draws. */
export const FROST_TEASERS = [
  { id: "frostRaider", name: "Frost Raider", art: "figure", note: "Northern raider" },
  { id: "direWolf", name: "Dire Wolf", art: "wolf", note: "Hunts in packs" },
  { id: "iceWarlord", name: "Ice Warlord", art: "figure", note: "Frost-armoured" },
];

export const FROST_HERO = { id: "elara", name: "Lady Elara", art: "figure", note: "Northern ranger · bow and short sword" };

/* Cosmetic only. Badges never touch gameplay: no modifiers, no crowns. */
export const BADGES = {
  defenderOfAshford: {
    id: "defenderOfAshford",
    name: "Defender of Ashford",
    desc: "Warlord Blackmoor is dead and the realm still stands.",
    icon: "🛡",
    /* awarded when this kingdom's campaign is completed */
    kingdom: "ashford",
  },
  championOfTheRealms: {
    id: "championOfTheRealms",
    name: "Champion of the Realms",
    desc: "Every stage of every realm, won again on New Game+.",
    icon: "⚔",
    /* earned from the record rather than a single victory: the last
       stage of the set awards it, and an older save that already has
       them all gets it on load */
    everyStageOnLegend: true,
  },
  guardianOfTheFrozenNorth: {
    id: "guardianOfTheFrozenNorth",
    name: "Guardian of the Frozen North",
    desc: "Jarl Vorne is broken and the Cairnhold still stands.",
    icon: "❄",
    kingdom: "frost",
  },
  keeperOfTheSunspear: {
    id: "keeperOfTheSunspear",
    name: "Keeper of the Sunspear",
    desc: "Sun-Tyrant Sarkaan is thrown down and the Reach is free.",
    icon: "☀",
    kingdom: "sun",
  },
};

export const BADGE_ORDER = ["defenderOfAshford", "guardianOfTheFrozenNorth", "keeperOfTheSunspear", "championOfTheRealms"];
