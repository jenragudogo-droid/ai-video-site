/* ------------------------------------------------------------------ *
 * Castle Defender — the Blackmoor Warband.
 *
 * Every number that makes one enemy different from another lives
 * here. `kind` picks the behaviour script in the engine:
 *   infantry  walks, is blocked by soldiers, fights back
 *   ranged    stops at range and shoots soldiers and the hero
 *   cavalry   fast; breaks free from a block after `blockTime`
 *   siege     cannot be blocked; soldiers chase it instead
 * Armour is the fraction of blade/arrow damage shrugged off.
 * `shieldBlock` is the extra fraction removed from projectiles that
 * strike the shield face (arrows arriving from the front).
 * ------------------------------------------------------------------ */

export const ENEMIES = {
  bandit: {
    name: "Bandit", kind: "infantry",
    hp: 50, speed: 62, armour: 0, gateDmg: 1, bounty: 7, xp: 4,
    dmg: [5, 8], atk: 1.0, r: 13, h: 58,
    desc: "Light raiders in leather and cloth. Arrows tear through them.",
  },
  archer: {
    name: "Rebel Archer", kind: "ranged",
    hp: 50, speed: 58, armour: 0, gateDmg: 1, bounty: 9, xp: 5,
    dmg: [6, 9], atk: 1.4, range: 150, r: 13, h: 58,
    desc: "Stops to shoot your soldiers and hero from a distance.",
  },
  manAtArms: {
    name: "Man-at-Arms", kind: "infantry",
    hp: 180, speed: 48, armour: 0.45, gateDmg: 2, bounty: 14, xp: 8,
    dmg: [9, 13], atk: 1.1, r: 15, h: 62,
    desc: "Mail and plate. Arrows and blades lose almost half their bite.",
  },
  outrider: {
    name: "Outrider", kind: "cavalry",
    hp: 90, speed: 120, armour: 0.1, gateDmg: 1, bounty: 12, xp: 6,
    dmg: [7, 10], atk: 0.9, r: 20, h: 70, blockTime: 2.4,
    desc: "Mounted and fast. Soldiers can only hold one for a moment.",
  },
  shieldBearer: {
    name: "Shield Bearer", kind: "infantry",
    hp: 220, speed: 44, armour: 0.2, shieldBlock: 0.7, gateDmg: 2, bounty: 16, xp: 9,
    dmg: [8, 11], atk: 1.2, r: 16, h: 62,
    desc: "A tall shield turns most arrows aside. Catapults land behind it.",
  },
  crossbow: {
    name: "Crossbowman", kind: "ranged",
    hp: 70, speed: 52, armour: 0.1, gateDmg: 1, bounty: 11, xp: 6,
    dmg: [10, 14], atk: 1.8, range: 200, pierce: 0.5, r: 13, h: 58,
    stage: 2,
    desc: "Longer reach and bolts that punch through soldier armour.",
  },
  ram: {
    name: "Battering Ram", kind: "siege",
    hp: 900, speed: 30, armour: 0.3, gateDmg: 8, bounty: 60, xp: 30,
    dmg: [0, 0], atk: 0, r: 34, h: 70, boss: "mini",
    desc: "An iron-headed ram pushed by four crew. Nothing blocks it.",
  },
  siegeTower: {
    name: "Siege Tower", kind: "siege",
    hp: 1400, speed: 22, armour: 0.35, gateDmg: 3, gateDps: 3, bounty: 80, xp: 40,
    dmg: [0, 0], atk: 0, r: 38, h: 120, boss: "mini",
    stage: 3,
    desc: "Slow and vast. At the wall it batters the castle until destroyed.",
  },
};

export const ENEMY_ORDER = ["bandit", "archer", "manAtArms", "outrider", "shieldBearer", "crossbow", "ram", "siegeTower"];
