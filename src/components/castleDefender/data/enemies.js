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
    dmg: [7, 10], atk: 0.9, r: 20, h: 70, blockTime: 2.4, horse: "outrider",
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
  /* Stage II cavalry. `charge` makes a unit build up and charge the
     defenders ahead on open ground; scouts have no charge and simply
     slip past a block after `blockTime`. */
  scoutCav: {
    name: "Cavalry Scout", kind: "cavalry",
    hp: 62, speed: 150, armour: 0.05, gateDmg: 1, bounty: 13, xp: 6,
    dmg: [6, 9], atk: 0.9, r: 20, h: 72, blockTime: 1.2, horse: "scout",
    stage: 2,
    desc: "Rides hard for the gate and slips past a block in a moment. Arrows bring it down.",
  },
  knightCav: {
    name: "Armoured Knight", kind: "cavalry",
    hp: 210, speed: 90, armour: 0.4, gateDmg: 2, bounty: 26, xp: 12,
    dmg: [12, 17], atk: 1.0, r: 22, h: 76, blockTime: 3.0, horse: "knight",
    charge: { buildup: 1.6, speedMul: 2.3, dist: 280, dmg: 34, kb: 44, stun: 0.7, cd: 9, spearDmg: 70 },
    spearWeakness: 1.6,
    stage: 2,
    desc: "Plate on rider and horse. Charges on open ground and scatters soldiers. Pikes and ballistas stop it.",
  },
  cavCommander: {
    name: "Captain Malric", kind: "cavalry",
    hp: 1400, speed: 76, armour: 0.45, gateDmg: 6, bounty: 130, xp: 40,
    dmg: [18, 26], atk: 1.0, r: 26, h: 88, blockTime: 4.0, horse: "commander", boss: "mini",
    charge: { buildup: 2.2, speedMul: 2.4, dist: 320, dmg: 60, kb: 60, stun: 1.0, cd: 8, spearDmg: 110 },
    aura: { radius: 180, armour: 0.15, speed: 1.15 },
    spearWeakness: 1.5,
    stage: 2,
    desc: "The Black Rider. Rallies the cavalry around him and charges with a horn's warning.",
  },
  ram: {
    name: "Battering Ram", kind: "siege",
    hp: 900, speed: 30, armour: 0.3, gateDmg: 8, bounty: 60, xp: 30,
    dmg: [0, 0], atk: 0, r: 34, h: 70, boss: "mini",
    desc: "An iron-headed ram pushed by four crew. Nothing blocks it.",
  },
  /* ---------------- Stage III: the Siege of Ashford ---------------- */
  heavyInf: {
    name: "Ironclad", kind: "infantry",
    hp: 330, speed: 38, armour: 0.6, shieldBlock: 0.3, gateDmg: 3, bounty: 26, xp: 12,
    dmg: [12, 16], atk: 1.2, r: 17, h: 64,
    stage: 3,
    desc: "Head-to-toe plate. Arrows glance off; catapult stones and fire do the work.",
  },
  eliteGuard: {
    name: "Blackmoor Guard", kind: "infantry",
    hp: 280, speed: 46, armour: 0.5, shieldBlock: 0.5, gateDmg: 2, bounty: 30, xp: 12,
    dmg: [11, 15], atk: 1.0, r: 16, h: 64, guard: true,
    stage: 3,
    desc: "The warlord's picked men. While they stand near him, nothing reaches him.",
  },
  siegeEngineer: {
    name: "Siege Engineer", kind: "infantry",
    hp: 95, speed: 46, armour: 0.1, gateDmg: 1, bounty: 18, xp: 7,
    dmg: [3, 5], atk: 1.2, r: 13, h: 57, engineer: { radius: 130, rate: 14 },
    stage: 3,
    desc: "Keeps the engines rolling: mends any siege engine nearby. Kill the crew first.",
  },
  fireArcher: {
    name: "Fire Archer", kind: "ranged",
    hp: 66, speed: 54, armour: 0, gateDmg: 1, bounty: 15, xp: 7,
    dmg: [7, 10], atk: 1.6, range: 190, r: 13, h: 58, burns: { dur: 5, slow: 0.4 },
    stage: 3,
    desc: "Shoots burning arrows at your towers: a burning tower shoots slower until the fire is out.",
  },
  heavyCav: {
    name: "Heavy Lancer", kind: "cavalry",
    hp: 300, speed: 84, armour: 0.5, gateDmg: 3, bounty: 34, xp: 14,
    dmg: [13, 18], atk: 1.0, r: 23, h: 78, blockTime: 3.2, horse: "heavy",
    charge: { buildup: 1.8, speedMul: 2.3, dist: 300, dmg: 44, kb: 50, stun: 0.8, cd: 9, spearDmg: 95 },
    spearWeakness: 1.7,
    stage: 3,
    desc: "Barded horse and couched lance. The hardest charge in the warband; pikes still take it on the point.",
  },
  warCaptain: {
    name: "Warband Captain", kind: "infantry",
    hp: 560, speed: 46, armour: 0.45, shieldBlock: 0.3, gateDmg: 4, bounty: 64, xp: 24,
    dmg: [14, 20], atk: 1.0, r: 17, h: 66, boss: "mini",
    aura: { radius: 200, armour: 0.12, speed: 1.15, all: true },
    stage: 3,
    desc: "Drives the warband on: everyone near his banner marches faster and shrugs off more.",
  },
  siegeRam: {
    name: "Iron Ram", kind: "siege",
    hp: 1500, speed: 26, armour: 0.4, gateDmg: 10, bounty: 95, xp: 36,
    dmg: [0, 0], atk: 0, r: 40, h: 80, boss: "mini", ram: true, wallDmg: 30, scale: 1.3,
    stage: 3,
    desc: "A roofed ram with an iron boar's head. It smashes the outer wall on the way and the gate at the end.",
  },
  siegeCatapult: {
    name: "Siege Catapult", kind: "siege",
    hp: 1150, speed: 20, armour: 0.35, gateDmg: 6, bounty: 110, xp: 40,
    dmg: [0, 0], atk: 0, r: 42, h: 96, boss: "mini",
    engine: { stopAt: 0.58, standoff: 340, reload: 9, windup: 1.4, castleDmg: 1, wallDmg: 22, towerBurn: 4, radius: 60 },
    stage: 3,
    desc: "Halts in the field and lobs stones at the wall, the castle and your towers. Nothing else matters until it burns.",
  },
  siegeTower: {
    name: "Siege Tower", kind: "siege",
    hp: 1400, speed: 22, armour: 0.35, gateDmg: 3, bounty: 90, xp: 40,
    dmg: [0, 0], atk: 0, r: 40, h: 130, boss: "mini",
    tower: { dockAt: 150, unloadEvery: 4, unloads: ["heavyInf", "manAtArms", "heavyInf", "manAtArms", "eliteGuard", "heavyInf"], wallDps: 2.5 },
    stage: 3,
    desc: "Slow and vast. At the wall it drops its ramp and pours armoured men onto the road, until it is burned down.",
  },
  warlord: {
    name: "Warlord Blackmoor", kind: "infantry",
    hp: 4200, speed: 40, armour: 0.5, shieldBlock: 0.2, gateDmg: 14, bounty: 400, xp: 80,
    dmg: [24, 34], atk: 1.1, r: 22, h: 88, boss: "final", persist: true,
    aura: { radius: 220, armour: 0.15, speed: 1.15, all: true },
    phases: {
      campAt: 160,
      sweep: { cd: 11, windup: 1.4, radius: 115, dmg: 48, kb: 60, stun: 1.2 },
      horn: { cd: 22, windup: 1.6, dur: 7, armour: 0.2, speed: 1.2, call: ["heavyInf", "heavyInf", "heavyInf", "eliteGuard"] },
      rage: { at: 0.4, atkMul: 1.5, speed: 60, sweepCd: 7, push: [["siegeRam", 0], ["heavyInf", 1], ["heavyInf", 1], ["heavyInf", 1], ["heavyCav", 2], ["heavyCav", 2], ["heavyInf", 0], ["heavyInf", 0]] },
    },
    stage: 3,
    desc: "The Warlord himself, with the Ironbreaker. He commands from his camp, then comes for the gate in person.",
  },

  /* ---------------- The Frozen North ---------------- */
  /* The north fights differently from the warband: fewer heavy blocks
     of infantry, more speed, flanking and harassment. Wolves slip past
     a line, shield raiders shrug off arrows, archers never come close
     and berserkers delete a squad if they reach it. */
  frostRaider: {
    name: "Frost Raider", kind: "infantry",
    hp: 105, speed: 74, armour: 0.12, gateDmg: 1, bounty: 11, xp: 6,
    dmg: [8, 12], atk: 0.95, r: 14, h: 59,
    kingdom: "frost",
    desc: "Fur and iron, and quicker than a man-at-arms. They come in numbers and keep coming.",
  },
  direWolf: {
    name: "Dire Wolf", kind: "cavalry", beast: true,
    hp: 78, speed: 168, armour: 0.05, gateDmg: 1, bounty: 12, xp: 6,
    dmg: [9, 13], atk: 0.8, r: 18, h: 60, blockTime: 1.0,
    kingdom: "frost",
    desc: "Runs the flank and slips a block in a heartbeat. Arrows and blades kill it easily, if they land.",
  },
  frostArcher: {
    name: "Frost Archer", kind: "ranged",
    hp: 72, speed: 60, armour: 0.05, gateDmg: 1, bounty: 13, xp: 7,
    dmg: [9, 13], atk: 1.5, range: 190, r: 13, h: 58,
    kingdom: "frost",
    desc: "Outranges every soldier you have, but not Lady Elara. Left alone she picks your line apart from the trees.",
  },
  shieldRaider: {
    name: "Shield Raider", kind: "infantry",
    hp: 230, speed: 50, armour: 0.25, shieldBlock: 0.75, gateDmg: 2, bounty: 18, xp: 10,
    dmg: [10, 14], atk: 1.15, r: 16, h: 62,
    kingdom: "frost",
    desc: "A wall of lime-wood and hide. Arrows are wasted on the shield face; catapults and blades are not.",
  },
  berserker: {
    name: "Northern Berserker", kind: "infantry",
    hp: 175, speed: 88, armour: 0.05, gateDmg: 3, bounty: 22, xp: 11,
    dmg: [22, 31], atk: 0.62, r: 15, h: 62,
    kingdom: "frost",
    desc: "No shield, no armour, and he swings faster than anything in the realm. Kill him before he reaches a squad.",
  },
  frostCaptain: {
    name: "Jarl's Huscarl", kind: "infantry",
    hp: 620, speed: 52, armour: 0.42, shieldBlock: 0.35, gateDmg: 4, bounty: 70, xp: 26,
    dmg: [16, 22], atk: 1.0, r: 17, h: 66, boss: "mini",
    aura: { radius: 200, armour: 0.14, speed: 1.18, all: true },
    kingdom: "frost",
    desc: "The Jarl's own. Everything near his horn fights harder and marches faster.",
  },
  wolfDen: {
    name: "Wolf Den", kind: "siege",
    hp: 620, speed: 46, armour: 0.2, gateDmg: 0, bounty: 55, xp: 22,
    dmg: [0, 0], atk: 0, r: 30, h: 62, boss: "mini", den: true,
    /* rolls a short way in, digs in, then lets wolves out until it is destroyed */
    tower: { dockAt: 40, unloadEvery: 6.5, unloads: ["direWolf", "direWolf", "direWolf", "direWolf", "direWolf", "direWolf", "direWolf", "direWolf"], wallDps: 0 },
    kingdom: "frost",
    desc: "A hide-and-timber den dragged onto the road. It keeps loosing wolves until somebody burns it.",
  },
  iceRam: {
    name: "Iron-Shod Ram", kind: "siege",
    hp: 1350, speed: 27, armour: 0.38, gateDmg: 9, bounty: 90, xp: 34,
    dmg: [0, 0], atk: 0, r: 38, h: 76, boss: "mini", ram: true, wallDmg: 28, scale: 1.2,
    kingdom: "frost",
    desc: "Oak and iron on sled runners. It breaks the ice wall on the way past and the gate at the end.",
  },
  frostThrower: {
    name: "Frost Trebuchet", kind: "siege",
    hp: 1050, speed: 21, armour: 0.32, gateDmg: 5, bounty: 105, xp: 38,
    dmg: [0, 0], atk: 0, r: 40, h: 92, boss: "mini",
    engine: { stopAt: 0.56, standoff: 330, reload: 9.5, windup: 1.5, castleDmg: 1, wallDmg: 20, towerBurn: 4, radius: 62 },
    kingdom: "frost",
    desc: "Hurls frozen stone at the wall, the keep and your towers. A burning tower shoots slower until the crew is dead.",
  },
  iceWarlord: {
    name: "Jarl Vorne", kind: "infantry",
    hp: 4300, speed: 44, armour: 0.45, gateDmg: 14, bounty: 420, xp: 90,
    dmg: [26, 36], atk: 1.05, r: 23, h: 90, boss: "final", persist: true,
    aura: { radius: 230, armour: 0.16, speed: 1.18, all: true },
    /* His fight is a shell, not a bodyguard: the ice on him has to be
       broken before anything reaches the Jarl, and it re-forms twice. */
    frost: {
      shell: 900, shellRegen: 18, shellBreak: 7,      // hp, regen per second, seconds open once broken
      camp: 190, patience: 55,                        // he advances anyway if the ice is never broken
      nova: { cd: 13, windup: 1.5, radius: 130, dmg: 42, freeze: 2.2 },
      howl: { cd: 24, windup: 1.6, dur: 8, wolves: 4, armour: 0.18, speed: 1.2 },
      blizzard: { cd: 30, windup: 2, dur: 10, towerRate: 0.4, towerRange: 0.2 },
      rage: { at: 0.35, atkMul: 1.5, speed: 66, novaCd: 8, shell: 0, push: [["direWolf", 1], ["direWolf", 1], ["direWolf", 2], ["berserker", 0], ["berserker", 0], ["shieldRaider", 1], ["frostRaider", 2], ["frostRaider", 2]] },
    },
    kingdom: "frost",
    desc: "The Ice Warlord. Ice closes over him faster than you can cut it, and the storm answers when he calls.",
  },
};

export const ENEMY_ORDER = ["bandit", "archer", "manAtArms", "outrider", "shieldBearer", "crossbow", "scoutCav", "knightCav", "cavCommander", "ram", "heavyInf", "fireArcher", "siegeEngineer", "heavyCav", "eliteGuard", "warCaptain", "siegeRam", "siegeCatapult", "siegeTower", "warlord",
  "frostRaider", "direWolf", "frostArcher", "shieldRaider", "berserker", "frostCaptain", "wolfDen", "iceRam", "frostThrower", "iceWarlord"];
