/* ------------------------------------------------------------------ *
 * Castle Defender — kingdom-level progression.
 *
 * Crowns are earned by stars and first completions and spent here on
 * permanent upgrades. Each upgrade has up to three levels; every level
 * adds its `mods` to the modifiers a new battle starts with. The
 * categories are the ones planned for the long run; a few upgrades per
 * category exist now and more slot in without engine changes.
 * ------------------------------------------------------------------ */

export const CATEGORIES = [
  { id: "castle", name: "Castle", desc: "Walls, gate and the treasury." },
  { id: "archers", name: "Archers", desc: "Arrows, range and rate of fire." },
  { id: "barracks", name: "Barracks", desc: "Soldier health, armour and training." },
  { id: "siege", name: "Siege", desc: "Ballista and catapult engines." },
  { id: "hero", name: "Hero", desc: "Sir Edric's strength and abilities." },
  { id: "economy", name: "Economy", desc: "Gold, bonuses and costs." },
  { id: "special", name: "Special", desc: "Castle powers and reinforcements." },
];

export const KINGDOM_UPGRADES = [
  { id: "wallHealth", cat: "castle", name: "Thicker Walls", desc: "+2 castle health per level.", cost: [2, 3, 4], mods: { castleBonus: 2 } },
  { id: "masonsGuild", cat: "castle", name: "Masons' Guild", desc: "Repairs cost 10% less per level.", cost: [2, 3, 4], mods: { repairCost: -0.1 } },
  { id: "treasury", cat: "castle", name: "Treasury", desc: "+40 starting gold per level.", cost: [2, 3, 5], mods: { startGold: 40 } },
  { id: "fletchers", cat: "archers", name: "Fletchers", desc: "Archer towers +6% damage per level.", cost: [2, 3, 4], mods: { archerDmg: 0.06 } },
  { id: "longbows", cat: "archers", name: "Longbows", desc: "Archer towers +5% range per level.", cost: [2, 3, 4], mods: { archerRange: 0.05 } },
  { id: "drillYard", cat: "barracks", name: "Drill Yard", desc: "Soldiers +8% health per level.", cost: [2, 3, 4], mods: { soldierHp: 0.08 } },
  { id: "armourers", cat: "barracks", name: "Armourers", desc: "Soldiers +5% armour per level.", cost: [3, 4, 5], mods: { soldierArmour: 0.05 } },
  { id: "engineers", cat: "siege", name: "Engineers", desc: "Ballista damage +8% per level.", cost: [2, 3, 4], mods: { ballistaDmg: 0.08 } },
  { id: "heavyStones", cat: "siege", name: "Heavy Stones", desc: "Catapult damage +8% per level.", cost: [2, 3, 4], mods: { catapultDmg: 0.08 } },
  { id: "vigour", cat: "hero", name: "Vigour", desc: "Sir Edric +10% health per level.", cost: [2, 3, 4], mods: { heroHp: 0.1 } },
  { id: "swordmaster", cat: "hero", name: "Swordmaster", desc: "Sir Edric +8% damage per level.", cost: [2, 3, 4], mods: { heroDmg: 0.08 } },
  { id: "tithes", cat: "economy", name: "Tithes", desc: "+5% gold from enemies per level.", cost: [3, 4, 5], mods: { bountyMul: 0.05 } },
  { id: "heralds", cat: "economy", name: "Heralds", desc: "Early-call bonus +15% per level.", cost: [2, 3, 4], mods: { earlyBonus: 0.15 } },
  { id: "quartermasters", cat: "special", name: "Quartermasters", desc: "Castle powers recharge 6% faster per level.", cost: [3, 4, 5], mods: { abilityCd: -0.06 } },
  { id: "muster", cat: "special", name: "Muster", desc: "Reinforcement levies stay 5 seconds longer per level.", cost: [2, 3, 4], mods: { levyLife: 5 } },
];

export const UPGRADE_BY_ID = Object.fromEntries(KINGDOM_UPGRADES.map((u) => [u.id, u]));

/* Sum every bought level into one modifier table. */
export function metaMods(upgrades = {}) {
  const mods = {};
  for (const [id, level] of Object.entries(upgrades)) {
    const def = UPGRADE_BY_ID[id];
    if (!def || !level) continue;
    for (const [k, v] of Object.entries(def.mods)) mods[k] = (mods[k] || 0) + v * level;
  }
  return mods;
}

export function upgradeCost(id, level) {
  const def = UPGRADE_BY_ID[id];
  if (!def || level >= def.cost.length) return null;
  return def.cost[level];
}
