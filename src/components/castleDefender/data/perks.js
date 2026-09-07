/* ------------------------------------------------------------------ *
 * Castle Defender — milestone perks and wave-unlocked powers.
 *
 * At milestone waves the player picks one of three perks. A perk is a
 * bundle of modifiers (`mods`) the engine reads in a handful of places:
 * ranges, damage, health, costs, cooldowns. Multipliers are stored as
 * fractions (0.15 = +15 %); a few are flat (`castleBonus`, `goldNow`).
 * Rarity sets the draw weight and the earliest wave a perk can appear.
 * ------------------------------------------------------------------ */

export const RARITY = {
  common: { name: "Common", weight: 10, minWave: 0 },
  rare: { name: "Rare", weight: 5, minWave: 3 },
  epic: { name: "Epic", weight: 2, minWave: 6 },
  legendary: { name: "Legendary", weight: 1, minWave: 8 },
};

export const PERKS = [
  /* common */
  { id: "longFletch", name: "Long Fletching", rarity: "common", icon: "archer", desc: "Archer towers +12% range.", mods: { archerRange: 0.12 } },
  { id: "bodkin", name: "Bodkin Points", rarity: "common", icon: "archer", desc: "Archer towers +12% damage.", mods: { archerDmg: 0.12 } },
  { id: "hardyLevies", name: "Hardy Levies", rarity: "common", icon: "barracks", desc: "Barracks soldiers +15% health.", mods: { soldierHp: 0.15 } },
  { id: "wideShot", name: "Wide Shot", rarity: "common", icon: "catapult", desc: "Catapult blast radius +20%.", mods: { catapultRadius: 0.2 } },
  { id: "heavyBolts", name: "Heavy Bolts", rarity: "common", icon: "ballista", desc: "Ballista damage +12%.", mods: { ballistaDmg: 0.12 } },
  { id: "plunder", name: "Plunder", rarity: "common", icon: "gold", desc: "+12% gold from every enemy.", mods: { bountyMul: 0.12 } },
  { id: "masons", name: "Guild Masons", rarity: "common", icon: "castle", desc: "Repair costs 25% less.", mods: { repairCost: -0.25 } },
  { id: "swordArm", name: "Sword Arm", rarity: "common", icon: "hero", desc: "Sir Edric +20% damage.", mods: { heroDmg: 0.2 } },
  /* rare */
  { id: "mailShirts", name: "Mail Shirts", rarity: "rare", icon: "barracks", desc: "Barracks soldiers +15% armour.", mods: { soldierArmour: 0.15 } },
  { id: "quarry", name: "Royal Quarry", rarity: "rare", icon: "castle", desc: "Towers and upgrades 10% cheaper.", mods: { towerCost: -0.1 } },
  { id: "quartermaster", name: "Quartermaster", rarity: "rare", icon: "ability", desc: "Castle powers recharge 20% faster.", mods: { abilityCd: -0.2 } },
  { id: "rainOfArrows", name: "Rain of Arrows", rarity: "rare", icon: "ability", desc: "Arrow Volley +40% damage and a wider fall.", mods: { volleyDmg: 0.4, volleyRadius: 0.25 } },
  { id: "drillSergeant", name: "Drill Sergeant", rarity: "rare", icon: "barracks", desc: "Fallen soldiers return 35% faster.", mods: { respawn: -0.35 } },
  { id: "stoutWalls", name: "Stout Walls", rarity: "rare", icon: "castle", desc: "+4 castle health now and to the maximum.", mods: { castleBonus: 4 } },
  /* epic */
  { id: "fireArrows", name: "Fire Arrows", rarity: "epic", icon: "archer", desc: "Archer arrows burn: +25% damage and a fifth of it ignores armour.", mods: { archerDmg: 0.25, archerPierce: 0.2 } },
  { id: "greatBallistas", name: "Great Ballistas", rarity: "epic", icon: "ballista", desc: "Every ballista bolt pierces one more enemy; +15% damage.", mods: { ballistaPierce: 1, ballistaDmg: 0.15 } },
  { id: "veterans", name: "Veteran Squads", rarity: "epic", icon: "barracks", desc: "Soldiers +25% health and +25% damage.", mods: { soldierHp: 0.25, soldierDmg: 0.25 } },
  { id: "kingsChampion", name: "King's Champion", rarity: "epic", icon: "hero", desc: "Sir Edric +30% health, Royal Charge recharges 30% faster.", mods: { heroHp: 0.3, heroChargeCd: -0.3 } },
  /* Stage III choices (offered from the Siege of Ashford onward) */
  { id: "pikeArmour", name: "Pike Shirts", rarity: "common", icon: "barracks", desc: "Pike units +15% armour.", mods: { pikeArmour: 0.15 }, minStage: 3 },
  { id: "fastWinch", name: "Fast Winch", rarity: "common", icon: "catapult", desc: "Catapults reload 15% faster.", mods: { catapultRate: 0.15 }, minStage: 3 },
  { id: "gateBars", name: "Iron Gate Bars", rarity: "rare", icon: "castle", desc: "+6 castle health now and to the maximum.", mods: { castleBonus: 6 }, minStage: 3 },
  { id: "muster", name: "Full Muster", rarity: "rare", icon: "ability", desc: "Reinforcements bring two more levies.", mods: { reinforceCount: 2 }, minStage: 3 },
  { id: "rallyHorns", name: "Rally Horns", rarity: "rare", icon: "hero", desc: "Royal Rally recharges 20% faster.", mods: { royalRallyCd: -0.2 }, minStage: 3 },
  { id: "boilingPitch", name: "Boiling Pitch", rarity: "epic", icon: "ability", desc: "Burning Oil burns 40% hotter and 30% wider.", mods: { oilDmg: 0.4, oilRadius: 0.3 }, minStage: 3 },
  { id: "masterMasons", name: "Master Masons", rarity: "epic", icon: "castle", desc: "Emergency Repair recharges 30% faster and mends 4 more.", mods: { emergencyCd: -0.3, emergencyHp: 4 }, minStage: 3 },
  /* legendary */
  { id: "ashfordBowmen", name: "Bowmen of Ashford", rarity: "legendary", icon: "archer", desc: "Archer towers shoot 25% faster and reach 15% further.", mods: { archerRate: 0.25, archerRange: 0.15 } },
  { id: "kingsPurse", name: "The King's Purse", rarity: "legendary", icon: "gold", desc: "+200 gold now and +20% gold from then on.", mods: { goldNow: 200, bountyMul: 0.2 } },
];

export const PERK_BY_ID = Object.fromEntries(PERKS.map((p) => [p.id, p]));

/* Castle powers that appear as the battle goes on. `unlockWave` is the
   wave number at which the power joins the ability row. */
export const POWERS = {
  volley: { name: "Arrow Volley", cd: 35, dmg: 55, radius: 75, delay: 0.9, key: "V", unlockWave: 0, desc: "The garrison rains arrows where you tap." },
  reinforce: { name: "Reinforcements", cd: 25, count: 2, key: "R", unlockWave: 0, desc: "Two levies hold the ground for 15 seconds." },
  repair: { name: "Repair", cost: 60, hp: 5, key: "F", unlockWave: 0, desc: "Masons restore 5 castle health." },
  watchfire: { name: "Watchfire", cd: 45, dur: 12, range: 0.3, key: "G", unlockWave: 4, icon: "🔥", label: "Watchfire", desc: "Every tower gains 30% range for 12 seconds." },
  royalRally: { name: "Royal Rally", cd: 55, dur: 8, heal: 0.4, armour: 0.2, key: "B", unlockWave: 7, icon: "🏴", label: "Rally", desc: "Every soldier heals 40% and gains armour for 8 seconds." },
  /* Stage III siege powers: a stage lists the wave each one joins on */
  burningOil: { name: "Burning Oil", cd: 40, dmg: 60, radius: 95, dps: 16, dur: 5, key: "O", stageOnly: true, icon: "🫗", label: "Oil", desc: "Pour burning oil in front of the gate: everyone within reach of the walls burns." },
  emergencyRepair: { name: "Emergency Repair", cd: 90, hp: 10, wall: 35, key: "E", stageOnly: true, icon: "🛠", label: "Masons", desc: "Masons rush the walls: +10 castle health and the outer wall mended. Long recharge." },
  catapultBarrage: { name: "Catapult Barrage", cd: 60, stones: 6, dmg: 58, radius: 70, spread: 60, delay: 0.7, key: "C", stageOnly: true, icon: "☄", label: "Barrage", desc: "Six stones fall where you tap over four seconds." },
};

export const POWER_ORDER = ["volley", "reinforce", "repair", "watchfire", "royalRally", "burningOil", "emergencyRepair", "catapultBarrage"];
