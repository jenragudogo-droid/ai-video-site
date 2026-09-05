/* ------------------------------------------------------------------ *
 * Castle Defender — the future roster.
 *
 * A catalogue of the special units, traits and battlefield features
 * planned for later stages and kingdoms. NOTHING in this file is used
 * by the Stage I simulation yet: it is the agreed design, kept as data
 * so each later stage can switch on units by name without changing
 * the engine's shape. See docs/castle-defender-roadmap.md for the
 * gameplay rules behind every trait.
 *
 * Traits are the behaviours the engine will learn to read from an
 * enemy or soldier definition (`def.traits`). Each trait lists the
 * numbers it needs, so balance lives in data from day one.
 * ------------------------------------------------------------------ */

export const TRAITS = {
  cavalry: {
    desc: "Fast. Charges the first defender it meets, breaks free from blocks, takes extra damage from spears and stakes.",
    fields: { speedMul: 2.0, chargeDmg: 25, chargeKnockback: 30, blockTime: 2.4, spearWeakness: 1.5 },
    effects: ["hoofDust", "hoofSound", "chargeTrail"],
  },
  elephant: {
    desc: "Very slow, enormous health, tramples soldiers aside, batters gates and can stun the tower it passes. Fire and pierce hurt it most. Rare and dramatic.",
    fields: { speedMul: 0.45, hpMul: 12, trampleRadius: 40, trampleKnockback: 60, gateDmg: 12, towerStun: 4, fireWeakness: 2.0, pierceWeakness: 1.5 },
    effects: ["footstepDust", "groundShakeLight", "trumpet", "bigHealthBar", "entranceHorn"],
  },
  chariot: {
    desc: "Fast, attacks while moving, strong on open ground and weak on narrow or rough segments.",
    fields: { speedMul: 1.7, movingAttack: true, openTerrainBonus: 1.3, narrowPenalty: 0.6 },
    effects: ["wheelSpin", "hoofDust", "wheelRattle"],
  },
  warDog: {
    desc: "Fastest unit, low health, slips past a blocker after a second. A pressure unit.",
    fields: { speedMul: 2.4, hpMul: 0.5, blockTime: 1.0 },
    effects: ["dustPuffs", "bark"],
  },
  standardBearer: {
    desc: "Buffs allies around the banner and becomes a priority target for archers.",
    fields: { auraRadius: 110, armourBonus: 0.15, speedBonus: 0.1, priorityTarget: true },
    effects: ["banner", "rallyShout"],
  },
  drummer: {
    desc: "Raises attack speed of nearby allies; the drum is heard on the battlefield.",
    fields: { auraRadius: 120, attackSpeedBonus: 0.25, priorityTarget: true },
    effects: ["drumLoop", "beatRing"],
  },
  scout: {
    desc: "Very fast and fragile; reaching a route marker pulls the next wave's countdown forward.",
    fields: { speedMul: 2.2, hpMul: 0.5, countdownPull: 6 },
    effects: ["dustPuffs", "hornShort"],
  },
  commander: {
    desc: "Elite fighter with an aura, a unique look and a mini-boss health bar.",
    fields: { hpMul: 4, dmgMul: 2, armourBonus: 0.2, auraRadius: 130, auraArmour: 0.1, miniBoss: true },
    effects: ["plume", "cape", "bigHealthBar", "entranceHorn"],
  },
  shieldWall: {
    desc: "Marches two abreast; while touching a wall-mate, frontal projectiles are mostly turned aside.",
    fields: { formation: "shieldwall", frontBlock: 0.7, wallArmourBonus: 0.15 },
    effects: ["shieldClatter"],
  },
  berserker: {
    desc: "Attacks faster as health drops; ignores the first stun.",
    fields: { rageBelow: 0.5, rageAttackSpeed: 0.5, stunImmunityOnce: true },
    effects: ["warCry"],
  },
  horseArcher: {
    desc: "Cavalry that shoots while riding past soldiers instead of stopping.",
    fields: { speedMul: 1.8, movingAttack: true, range: 160 },
    effects: ["hoofDust", "bowTwang"],
  },
  siege: {
    desc: "Cannot be blocked; soldiers chase it. Heavy gate damage.",
    fields: { unblockable: true },
    effects: ["creak", "wheelSpin"],
  },
  siegeTower: {
    desc: "Slow and vast; at the wall it deals damage every second until destroyed.",
    fields: { unblockable: true, gateDps: 3 },
    effects: ["creak", "bigHealthBar"],
  },
  longship: {
    desc: "Arrives along a river or coast and unloads a raiding party at a landing.",
    fields: { landing: true, cargo: 6 },
    effects: ["oars", "landingHorn"],
  },
};

/* Units per kingdom. `stage` is the first campaign stage the unit is
   planned for; `side` says whether it fights for the player, the
   enemy, or both. Names are historically inspired, never caricature. */
export const ROSTER = {
  ashford: {
    style: "Medieval British",
    units: [
      { id: "mountedKnight", name: "Mounted Knight", side: "both", traits: ["cavalry"], stage: 2, note: "Royal cavalry charge for the player; enemy knights for the warband." },
      { id: "mountedScout", name: "Mounted Scout", side: "enemy", traits: ["cavalry", "scout"], stage: 2 },
      { id: "warDog", name: "War Dog", side: "enemy", traits: ["warDog"], stage: 2 },
      { id: "standardBearer", name: "Standard Bearer", side: "both", traits: ["standardBearer"], stage: 2 },
      { id: "crossbow", name: "Crossbowman", side: "enemy", traits: [], stage: 2, note: "Already in enemies.js." },
      { id: "siegeTower", name: "Siege Tower", side: "enemy", traits: ["siegeTower"], stage: 3, note: "Already in enemies.js." },
      { id: "warlord", name: "Warlord Blackmoor", side: "enemy", traits: ["commander"], stage: 3, note: "Boss with the Ironbreaker ram, three phases." },
      { id: "royalCavalryHero", name: "Sir Edric, mounted", side: "player", traits: ["cavalry"], stage: 3, note: "Hero upgrade: Royal Charge becomes a mounted charge." },
    ],
  },
  roma: {
    style: "Roman",
    units: [
      { id: "legionary", name: "Legionary", side: "both", traits: ["shieldWall"], stage: 1 },
      { id: "auxiliaryCavalry", name: "Auxiliary Cavalry", side: "both", traits: ["cavalry"], stage: 1 },
      { id: "mountedOfficer", name: "Mounted Officer", side: "enemy", traits: ["cavalry", "commander"], stage: 2 },
      { id: "signifer", name: "Signifer", side: "both", traits: ["standardBearer"], stage: 1 },
      { id: "ballistaCrew", name: "Ballista Crew", side: "enemy", traits: ["siege"], stage: 2, note: "Mobile siege engine that fires at towers." },
      { id: "chariot", name: "Chariot", side: "enemy", traits: ["chariot"], stage: 3, note: "Fantasy-flavoured arena chariot; open-field maps only." },
    ],
  },
  norse: {
    style: "Viking",
    units: [
      { id: "shieldBearer", name: "Shield Wall Warrior", side: "both", traits: ["shieldWall"], stage: 1 },
      { id: "axeWarrior", name: "Axe Warrior", side: "both", traits: [], stage: 1 },
      { id: "berserker", name: "Berserker", side: "enemy", traits: ["berserker", "commander"], stage: 2 },
      { id: "mountedScout", name: "Mounted Scout", side: "enemy", traits: ["cavalry", "scout"], stage: 2 },
      { id: "bannerCarrier", name: "Banner Carrier", side: "both", traits: ["standardBearer"], stage: 1 },
      { id: "longship", name: "Longship", side: "enemy", traits: ["longship"], stage: 2, note: "Coastal map: raiders land from the water." },
    ],
  },
  sakura: {
    style: "Samurai",
    units: [
      { id: "samurai", name: "Samurai", side: "both", traits: [], stage: 1 },
      { id: "mountedSamurai", name: "Mounted Samurai", side: "both", traits: ["cavalry"], stage: 1 },
      { id: "horseArcher", name: "Horse Archer", side: "enemy", traits: ["horseArcher"], stage: 2 },
      { id: "yariCavalry", name: "Yari Cavalry", side: "enemy", traits: ["cavalry"], stage: 2, note: "Spear cavalry: strong charge, no spear weakness." },
      { id: "eliteSword", name: "Elite Swordsman", side: "enemy", traits: ["commander"], stage: 3 },
      { id: "bowFormation", name: "Bow Formation", side: "enemy", traits: [], stage: 1, note: "Archers in a line that stop to volley together." },
      { id: "bannerUnit", name: "Banner Unit", side: "both", traits: ["standardBearer"], stage: 1 },
    ],
  },
  kemet: {
    style: "Ancient Egyptian",
    units: [
      { id: "spearman", name: "Spearman", side: "both", traits: [], stage: 1 },
      { id: "archer", name: "Archer", side: "both", traits: [], stage: 1 },
      { id: "chariot", name: "War Chariot", side: "both", traits: ["chariot"], stage: 1 },
      { id: "camelRider", name: "Camel Rider", side: "enemy", traits: ["cavalry"], stage: 2, note: "Desert cavalry; no spear weakness on sand." },
      { id: "desertCavalry", name: "Desert Cavalry", side: "enemy", traits: ["cavalry"], stage: 2 },
      { id: "eliteGuard", name: "Elite Guard", side: "both", traits: ["commander"], stage: 3 },
      { id: "siegeRam", name: "Siege Ram", side: "enemy", traits: ["siege"], stage: 3 },
    ],
  },
  savanna: {
    style: "West African",
    units: [
      { id: "royalGuard", name: "Royal Guard", side: "both", traits: [], stage: 1 },
      { id: "spearUnit", name: "Spear Unit", side: "both", traits: [], stage: 1 },
      { id: "archer", name: "Archer", side: "both", traits: [], stage: 1 },
      { id: "shieldUnit", name: "Shield Unit", side: "both", traits: ["shieldWall"], stage: 1 },
      { id: "royalHorseman", name: "Royal Horseman", side: "both", traits: ["cavalry"], stage: 1 },
      { id: "drummer", name: "Drummer", side: "both", traits: ["drummer"], stage: 1 },
      { id: "standardBearer", name: "Standard Bearer", side: "both", traits: ["standardBearer"], stage: 1 },
      { id: "eliteCommander", name: "Elite Commander", side: "enemy", traits: ["commander"], stage: 2 },
      { id: "warElephant", name: "War Elephant", side: "enemy", traits: ["elephant"], stage: 3, note: "Selected missions only, clearly fantasy-flavoured; large health bar and entrance." },
    ],
  },
};

/* Battlefield features later stages can declare in their layouts. */
export const BATTLEFIELD_FEATURES = {
  river: "Water strip; crossed only at bridges and fords.",
  bridge: "Narrow choke point; counts as `narrow` terrain for chariots and cavalry.",
  ford: "Shallow crossing: slows everyone, opens on a later wave.",
  castleWall: "A wall segment with its own health that enemies must breach.",
  siegeGate: "Destructible gate ahead of the castle; buys time while it stands.",
  barricade: "Destructible plot-built obstacle that blocks a road until broken.",
  forest: "Decor zone; hides nothing but frames routes.",
  hill: "Raised ground: towers on hill plots gain range.",
  farmland: "Open ground: cavalry and chariots gain their open-terrain bonus.",
  desert: "Sand: camels keep full speed, horses lose a little.",
  snowyCoast: "Snow and shore: longship landings, slower marching.",
  mountainPass: "Narrow winding routes that favour infantry.",
  village: "Buildings beside the road; some hold temporary reinforcements.",
  siegeCamp: "Enemy camp at a route entrance; spawns formations and can be raided by the hero.",
  reinforcementEvent: "Scripted arrival of friendly troops at a wave number.",
};

/* Terrain tags a route segment can carry, read by trait rules. */
export const TERRAIN_TAGS = ["open", "narrow", "bridge", "ford", "sand", "snow", "rough"];
