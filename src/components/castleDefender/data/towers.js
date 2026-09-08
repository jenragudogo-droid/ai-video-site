/* ------------------------------------------------------------------ *
 * Castle Defender — defences, soldiers, the hero and castle abilities.
 *
 * Tower levels are cumulative: level N is level N-1 with the listed
 * fields overridden, so `towerLevel(type, n)` resolves the full stat
 * block. Costs are tuned for a 250-gold opening on stage I.
 * ------------------------------------------------------------------ */

export const TOWERS = {
  archer: {
    name: "Archer Tower", short: "Archers", cost: 70, upgrades: [60, 90, 130],
    role: "Fast arrows. Best against light troops.",
    levels: [
      { range: 190, rate: 0.9, dmg: [7, 10], shooters: 1, dtype: "arrow", label: "Wooden Platform" },
      { range: 200, rate: 0.62, dmg: [7, 10], shooters: 2, label: "Twin Archers" },
      { range: 215, rate: 0.62, dmg: [12, 16], shooters: 2, label: "Stone Tower" },
      { range: 230, rate: 0.56, dmg: [14, 18], shooters: 2, label: "Royal Bowmen",
        ability: { id: "arrowStorm", name: "Arrow Storm", cd: 25, volleys: 8, dmg: 10, radius: 80, desc: "Rain arrows on an area." } },
    ],
  },
  barracks: {
    name: "Barracks", short: "Barracks", cost: 90, upgrades: [70, 100, 140],
    role: "Soldiers who block the road and fight.",
    respawn: 10, rallyRange: 130,
    levels: [
      { soldiers: 3, unit: "militia", label: "Militia" },
      { unit: "manAtArms", label: "Men-at-Arms" },
      { unit: "knight", label: "Foot Knights" },
      { unit: "royalGuard", label: "Royal Guard" },
    ],
  },
  ballista: {
    name: "Ballista", short: "Ballista", cost: 120, upgrades: [90, 130, 180],
    role: "Slow, heavy bolts that punch through armour.",
    levels: [
      { range: 260, rate: 2.6, dmg: [40, 55], pierceArmour: 0.6, dtype: "pierce", label: "Ballista" },
      { rate: 2.1, label: "Quick Winch" },
      { dmg: [70, 90], label: "Heavy Bolts" },
      { pierceCount: 3, label: "Great Ballista",
        ability: { id: "skewer", name: "Skewer", cd: 30, dmg: 250, desc: "One bolt, one target, 250 damage." } },
    ],
  },
  catapult: {
    name: "Catapult", short: "Catapult", cost: 140, upgrades: [100, 140, 190],
    role: "Area damage that lands behind shields.",
    levels: [
      { range: 300, minRange: 90, rate: 3.4, dmg: [25, 35], radius: 60, dtype: "siege", label: "Catapult" },
      { radius: 75, label: "Wide Shot" },
      { dmg: [40, 55], label: "Heavy Stones" },
      { fire: { dur: 4, dps: 7, radius: 55 }, label: "Fire Pots",
        ability: { id: "barrage", name: "Barrage", cd: 30, count: 3, desc: "Three stones on a target." } },
    ],
  },
};

export const TOWER_ORDER = ["archer", "barracks", "ballista", "catapult"];
export const MAX_LEVEL = 4;
export const SELL_RATE = 0.7;

const levelCache = {};
export function towerLevel(type, level) {
  const key = `${type}:${level}`;
  if (levelCache[key]) return levelCache[key];
  const def = TOWERS[type];
  let out = {};
  for (let i = 0; i < level; i += 1) out = { ...out, ...def.levels[i] };
  out.level = level;
  out.type = type;
  levelCache[key] = out;
  return out;
}

export function upgradeCost(type, level) {
  const def = TOWERS[type];
  if (level >= MAX_LEVEL) return null;
  return def.upgrades[level - 1];
}

export function towerValue(type, level) {
  const def = TOWERS[type];
  let v = def.cost;
  for (let i = 1; i < level; i += 1) v += def.upgrades[i - 1];
  return v;
}

/* Soldiers from barracks and the reinforcement ability. `block` is a
   chance to negate a blow outright with the shield; `shieldWall` is
   bonus armour when standing beside another guard. */
export const SOLDIERS = {
  militia:     { name: "Militia",       hp: 80,  dmg: [4, 6],   armour: 0,    atk: 1.0, speed: 95, r: 12 },
  manAtArms:   { name: "Man-at-Arms",   hp: 130, dmg: [7, 10],  armour: 0.2,  atk: 1.0, speed: 92, r: 13 },
  knight:      { name: "Foot Knight",   hp: 200, dmg: [10, 14], armour: 0.35, atk: 0.95, speed: 90, r: 14, block: 0.2, ability: { id: "shieldBrace", name: "Shield Brace", cd: 14, dur: 4, armour: 0.3, desc: "Raise shields: +30% armour for 4 seconds." } },
  royalGuard:  { name: "Royal Guard",   hp: 260, dmg: [12, 18], armour: 0.45, atk: 0.9, speed: 90, r: 14, block: 0.2, shieldWall: 0.15, ability: { id: "shieldBrace", name: "Shield Brace", cd: 14, dur: 4, armour: 0.3, desc: "Raise shields: +30% armour for 4 seconds." } },
  reinforcement: { name: "Levy",        hp: 70,  dmg: [4, 6],   armour: 0,    atk: 1.0, speed: 100, r: 12, life: 15 },
  /* Pike drill (Stage II onward): the same barracks squad with pikes.
     `spear` units brace against a charge, break it and deal `vsCavalry`
     times damage to riders; in return they take `rangedWeakness` times
     damage from arrows and bolts and wear lighter armour. */
  pikeMilitia:   { name: "Levy Pikemen",  hp: 85,  dmg: [5, 7],   armour: 0,    atk: 1.05, speed: 92, r: 12, spear: true, brace: true, vsCavalry: 1.6, rangedWeakness: 1.5, ability: { id: "braceSpears", name: "Brace Spears", cd: 12, dur: 4, desc: "Set the pikes for 4 seconds, whether or not a charge is coming." } },
  pikeManAtArms: { name: "Pikemen",       hp: 135, dmg: [8, 11],  armour: 0.12, atk: 1.05, speed: 90, r: 13, spear: true, brace: true, vsCavalry: 1.6, rangedWeakness: 1.5, ability: { id: "braceSpears", name: "Brace Spears", cd: 12, dur: 4, desc: "Set the pikes for 4 seconds, whether or not a charge is coming." } },
  pikeKnight:    { name: "Halberdiers",   hp: 195, dmg: [11, 15], armour: 0.25, atk: 1.0, speed: 88, r: 14, spear: true, brace: true, vsCavalry: 1.7, rangedWeakness: 1.4, ability: { id: "braceSpears", name: "Brace Spears", cd: 12, dur: 4, desc: "Set the pikes for 4 seconds, whether or not a charge is coming." } },
  pikeRoyal:     { name: "Royal Pikes",   hp: 250, dmg: [13, 19], armour: 0.35, atk: 0.95, speed: 88, r: 14, spear: true, brace: true, vsCavalry: 1.8, rangedWeakness: 1.3, ability: { id: "braceSpears", name: "Brace Spears", cd: 12, dur: 4, desc: "Set the pikes for 4 seconds, whether or not a charge is coming." }, shieldWall: 0.1 },
};

export const PIKE_UNITS = ["pikeMilitia", "pikeManAtArms", "pikeKnight", "pikeRoyal"];

/* Royal Knights: once a barracks has reached Royal Guard (level 4) the squad can
   mount up. Faster than any foot soldier, harder-hitting, with a Lance Charge,
   but lighter armour than the Guard and arrows find the rider more easily. */
SOLDIERS.royalKnight = { name: "Royal Knight", hp: 280, dmg: [15, 21], armour: 0.35, atk: 0.85, speed: 150, r: 18, block: 0.15, mounted: true, horse: "royal", rangedWeakness: 1.3, vsCavalry: 1.15, ability: { id: "lanceCharge", name: "Lance Charge", cd: 16, dur: 4, dmg: 0.8, speed: 0.5, desc: "Couch lances: +80% damage and +50% speed for 4 seconds." } };
export const MOUNT_UNIT = "royalKnight";
export const MOUNT_COST = 120;

/* Formations (Stage III onward). A formation is a standing order on a
   soldier: slower on the move, but stronger at what it is for. Pike
   Wall needs pike units and keeps the spears set at all times; Shield
   Wall is for sword-and-shield squads. */
export const FORMATIONS = {
  shieldWall: { name: "Shield Wall", icon: "⛨", armour: 0.25, dmg: -0.1, speed: 0.65, needs: "shield", desc: "Shields locked: +25% armour, slower on the move." },
  pikeWall: { name: "Pike Wall", icon: "⟋", armour: 0.05, dmg: 0, speed: 0.65, needs: "spear", vsCavalry: 1.25, desc: "Spears set at all times: breaks every charge, slower on the move." },
};
export const DRILL_COST = 40;

export const HERO = {
  id: "edric", name: "Sir Edric", title: "Knight of Ashford",
  hp: 320, hpPerLevel: 60, dmg: [15, 21], dmgPerLevel: 3, armour: 0.3, atk: 0.9, speed: 125, r: 15,
  regen: 8, respawn: 12, engageRange: 70,
  charge: { name: "Royal Charge", cd: 20, dist: 260, dmg: 60, dmgPerLevel: 12, stun: 1.0, kb: 45, width: 42 },
  /* Stage III upgrade: wider, harder, longer, and a shockwave where it ends */
  kingsCharge: { name: "King's Charge", dist: 330, dmgMul: 1.4, stun: 1.6, kb: 80, width: 64, wave: 90, waveDmg: 0.6, desc: "Sir Edric's charge strikes wider and harder, throws riders back further, and ends in a shockwave." },
  xpLevels: [0, 40, 100, 180, 290],
  maxLevel: 5,
};

export function heroStats(level) {
  const l = Math.max(1, Math.min(HERO.maxLevel, level));
  return {
    maxHp: HERO.hp + HERO.hpPerLevel * (l - 1),
    dmg: [HERO.dmg[0] + HERO.dmgPerLevel * (l - 1), HERO.dmg[1] + HERO.dmgPerLevel * (l - 1)],
    chargeDmg: HERO.charge.dmg + HERO.charge.dmgPerLevel * (l - 1),
    chargeCd: HERO.charge.cd - (l - 1) * 1.5,
    armour: HERO.armour + (l - 1) * 0.03,
  };
}

export const ABILITIES = {
  volley:    { name: "Arrow Volley",   cd: 35, dmg: 55, radius: 75, delay: 0.9, key: "V", desc: "The garrison rains arrows where you tap." },
  reinforce: { name: "Reinforcements", cd: 25, count: 2, key: "R", desc: "Two levies hold the ground for 15 seconds." },
  repair:    { name: "Repair",         cost: 60, hp: 5, key: "F", desc: "Masons restore 5 castle health." },
};

export const DIFFICULTY = {
  normal: { name: "Normal", hp: 1, gold: 1, desc: "The way it is meant to be played." },
  hard:   { name: "Hard",   hp: 1.18, gold: 0.9, desc: "Tougher enemies, thinner purse." },
};
