/* ------------------------------------------------------------------ *
 * Castle Defender — the Frozen North teaser (v1.1).
 *
 * Content only: what the locked teaser shows once the Realm of Ashford
 * is complete. Nothing here is playable. There are deliberately no
 * stats: the enemies and the hero are silhouettes and a name, so the
 * teaser can never be mistaken for a balance decision made early.
 *
 * When the kingdom is really built, these entries move into
 * enemies.js / towers.js / stages.js and this file shrinks to nothing.
 * ------------------------------------------------------------------ */

export const FROZEN_NORTH = {
  id: "frost",
  name: "The Frozen North",
  eyebrow: "The next kingdom",
  /* two short lines: any longer and it stops reading as a legend */
  flavour: [
    "Beyond Ashford's northern border,",
    "an ancient army is waking beneath the snow.",
  ],
  environment: "Snow-covered mountains, frozen forest and ruined watchtowers",
  status: "soon",
};

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
};

export const BADGE_ORDER = ["defenderOfAshford"];
