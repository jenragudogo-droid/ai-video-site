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

/* Kingdom three, teased once the north is held. Sand and heat against
   Ashford's green and the north's white: as far from a blizzard as the
   world goes. Nothing here is playable. */
export const SUNSPEAR = {
  id: "sun",
  name: "The Sunspear Reach",
  eyebrow: "The next kingdom",
  scene: "sunReach",
  flavour: [
    "South past the last frozen river,",
    "a burning kingdom has been waiting for its turn.",
  ],
  environment: "Red dunes, sandstone bastions and a sun that does not set",
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
  guardianOfTheFrozenNorth: {
    id: "guardianOfTheFrozenNorth",
    name: "Guardian of the Frozen North",
    desc: "Jarl Vorne is broken and the Cairnhold still stands.",
    icon: "❄",
    kingdom: "frost",
  },
};

export const BADGE_ORDER = ["defenderOfAshford", "guardianOfTheFrozenNorth"];
