/* ------------------------------------------------------------------ *
 * Kianimation Turbo Rush — game data.
 * Every driver, car, power-up, combo, boss and cup is original to this
 * game. Nothing here is borrowed from any existing racing title.
 * ------------------------------------------------------------------ */

/* ---------------------------------------------------------------- *
 * DRIVERS — the full 9-driver roster. A normal race fields 6 racers
 * (player + 5 AI) drawn from this roster, so line-ups rotate.
 * ability: passive perk applied in the engine.
 * style feeds the AI personality when the driver races as an opponent.
 * ---------------------------------------------------------------- */
export const DRIVERS = [
  {
    id: "blaze", name: "Kofi Blaze", flag: "GH",
    look: { skin: "#8a5a33", suit: "#e6402e", trim: "#ffd34d", helmet: "#c81f0f", visor: "#2b8cff" },
    personality: "Loud, fearless, always first into a gap.",
    style: "aggressive", styleLabel: "Aggressive charger",
    ability: { id: "hotStart", label: "Hot Start", blurb: "Boosts last 25% longer." },
    prefers: "supercar",
    strengths: ["Straight-line pace", "Boost control"],
    weaknesses: ["Overheats in tight corners"],
    cost: 0, unlock: null,
    taunts: ["Eat my dust!", "Too slow, too late!", "This lane is MINE."],
  },
  {
    id: "serwaa", name: "Ama Serwaa", flag: "GH",
    look: { skin: "#7a4f2a", suit: "#1f9d55", trim: "#ffd34d", helmet: "#0e7a3d", visor: "#ffd34d" },
    personality: "Calm market-town legend who never wastes a move.",
    style: "balanced", styleLabel: "Balanced all-rounder",
    ability: { id: "goldenEye", label: "Golden Eye", blurb: "Coins are worth 50% more and pull from further away." },
    prefers: "rally",
    strengths: ["Consistency", "Coin hunting"],
    weaknesses: ["No single standout stat"],
    cost: 0, unlock: null,
    taunts: ["Patience wins races.", "Saw that coming.", "Smooth is fast."],
  },
  {
    id: "ghostrai", name: "Rai Kumi", flag: "JP",
    look: { skin: "#e8c39e", suit: "#37243f", trim: "#c86bff", helmet: "#241733", visor: "#c86bff" },
    personality: "Silent mountain drifter. Speaks only in tyre smoke.",
    style: "drift", styleLabel: "Drift specialist",
    ability: { id: "smokeLine", label: "Smoke Line", blurb: "Drift nitro charges 40% faster." },
    prefers: "rally",
    strengths: ["Hairpins", "Nitro economy"],
    weaknesses: ["Loses time on long straights"],
    cost: 900, unlock: null,
    taunts: ["...", "Follow the smoke.", "Corners tell the truth."],
  },
  {
    id: "orbit", name: "Dr. Nia Orbit", flag: "NG",
    look: { skin: "#6d452a", suit: "#e9eef5", trim: "#2b8cff", helmet: "#dfe7f2", visor: "#12336e" },
    personality: "Astro-engineer racing to fund her lab. Thinks in vectors.",
    style: "technical", styleLabel: "Zero-G technician",
    ability: { id: "vectorThrust", label: "Vector Thrust", blurb: "Full steering control in the air and in low gravity." },
    prefers: "space",
    strengths: ["Space tracks", "Jump landings"],
    weaknesses: ["Cautious on dirt"],
    cost: 1400, unlock: null,
    taunts: ["Trajectory locked.", "Physics is on my side.", "Escape velocity!"],
  },
  {
    id: "vidal", name: "Rosa Vidal", flag: "ES",
    look: { skin: "#c98d5f", suit: "#d31145", trim: "#ffffff", helmet: "#a80d36", visor: "#ffffff" },
    personality: "Precision racer who apologises while overtaking you.",
    style: "technical", styleLabel: "Technical racer",
    ability: { id: "apexLine", label: "Apex Line", blurb: "+15% grip. The car turns exactly where you point it." },
    prefers: "lightweight",
    strengths: ["Cornering", "Clean laps"],
    weaknesses: ["Fragile under contact"],
    cost: 900, unlock: null,
    taunts: ["Perdón — coming through.", "Millimetres matter.", "Clean and gone."],
  },
  {
    id: "baraka", name: "Baraka Stone", flag: "KE",
    look: { skin: "#5c3a21", suit: "#8a6b3f", trim: "#e0d6c2", helmet: "#6b4f2a", visor: "#3d2b14" },
    personality: "Safari rally veteran. Roads are a suggestion.",
    style: "offroad", styleLabel: "Off-road specialist",
    ability: { id: "trailblazer", label: "Trailblazer", blurb: "Half the usual off-road slowdown. Dirt is home." },
    prefers: "truck",
    strengths: ["Dirt shortcuts", "Rough ground"],
    weaknesses: ["Heavy on tarmac"],
    cost: 1200, unlock: null,
    taunts: ["Roads are for tourists.", "Through, not around!", "The bush is faster."],
  },
  {
    id: "frost", name: "Lena Frost", flag: "NO",
    look: { skin: "#efd7c3", suit: "#2f6fa8", trim: "#bfe3ff", helmet: "#1d4c78", visor: "#bfe3ff" },
    personality: "Ice-calm defender. Nobody gets past on her watch.",
    style: "defensive", styleLabel: "Defensive wall",
    ability: { id: "coldShoulder", label: "Cold Shoulder", blurb: "Starts every race with a free shield." },
    prefers: "armored",
    strengths: ["Holding position", "Surviving chaos"],
    weaknesses: ["Rarely attacks"],
    cost: 1200, unlock: null,
    taunts: ["The door is closed.", "Not today.", "Cool heads finish."],
  },
  {
    id: "volt", name: "Jax Volt", flag: "US",
    look: { skin: "#b97a4e", suit: "#f5a800", trim: "#222222", helmet: "#e09600", visor: "#33e0ff" },
    personality: "Showman inventor who treats every item box like a birthday.",
    style: "powerup", styleLabel: "Power-up specialist",
    ability: { id: "doubleTap", label: "Double Tap", blurb: "Item boxes have a 35% chance to give two power-ups." },
    prefers: "electric",
    strengths: ["Combo warfare", "Comebacks"],
    weaknesses: ["Forgets to steer while celebrating"],
    cost: 1600, unlock: { type: "boss", boss: "neonPhantom", label: "Beat the Neon Phantom" },
    taunts: ["Jackpot!", "Watch THIS one!", "Boom — combo time!"],
  },
  {
    id: "z1ko", name: "Z1-KO", flag: "AI",
    look: { skin: "#9fb2c8", suit: "#3a4756", trim: "#57f2c8", helmet: "#2b3644", visor: "#57f2c8" },
    personality: "A scout robot that memorised every map ever drawn.",
    style: "shortcut", styleLabel: "Shortcut specialist",
    ability: { id: "pathfinder", label: "Pathfinder", blurb: "Shortcuts glow on the minimap and give +10% speed inside them." },
    prefers: "hover",
    strengths: ["Route knowledge", "Risk assessment"],
    weaknesses: ["Predictable on plain circuits"],
    cost: 0, unlock: { type: "boss", boss: "spaceCommander", label: "Beat the Space Commander" },
    taunts: ["ROUTE RECALCULATED.", "SHORTCUT LOGGED.", "EFFICIENCY: MAXIMUM."],
  },
];

/* ---------------------------------------------------------------- *
 * BOSSES — special racers outside the 9-driver roster. Each has a
 * bespoke car, track, behaviour and reward.
 * ---------------------------------------------------------------- */
export const BOSSES = [
  {
    id: "mountainKing", name: "The Mountain King", track: "mountain",
    look: { skin: "#7c5537", suit: "#4a4034", trim: "#c9a227", helmet: "#3a3128", visor: "#c9a227" },
    car: "colossus", carName: "Granite Colossus",
    intro: "The pass belongs to me. Always has.",
    behaviour: "Rams hard, shrugs off mines and oil, unstoppable downhill.",
    traits: { ram: 1.0, hazardResist: true, downhillDemon: true, itemBias: ["shockwave", "mine"] },
    difficulty: 1.15, hpBonus: 2,
    reward: { coins: 1500, car: "colossus", label: "Granite Colossus + 1500 coins" },
    taunts: ["MOVE, pebble!", "My mountain. My rules.", "Avalanche time!"],
  },
  {
    id: "neonPhantom", name: "Neon Phantom", track: "neon",
    look: { skin: "#d8c8e8", suit: "#12001f", trim: "#ff2bd6", helmet: "#1c0330", visor: "#ff2bd6" },
    car: "spectreX", carName: "Spectre-X",
    intro: "You can't hit what you can't touch.",
    behaviour: "Blinks into ghost mode when attacked, brutally fast on straights.",
    traits: { ghostDodge: true, topSpeedBonus: 0.08, itemBias: ["ghost", "turbo"] },
    difficulty: 1.2, hpBonus: 0,
    reward: { coins: 2000, driver: "volt", label: "Jax Volt + 2000 coins" },
    taunts: ["Now you see me...", "Just a flicker in your mirrors.", "Phase out."],
  },
  {
    id: "desertTitan", name: "Desert Titan", track: "canyon",
    look: { skin: "#a06a3c", suit: "#7a2d12", trim: "#e8b04a", helmet: "#61230d", visor: "#e8b04a" },
    car: "duneWarden", carName: "Dune Warden",
    intro: "The canyon eats racers. I just clean up.",
    behaviour: "Lays minefields and shockwaves, nearly immune to contact.",
    traits: { armored: true, itemBias: ["mine", "shockwave", "oil"], itemRate: 1.6 },
    difficulty: 1.2, hpBonus: 3,
    reward: { coins: 2500, car: "duneWarden", label: "Dune Warden + 2500 coins" },
    taunts: ["Sand swallows the weak.", "Field is mined. You're welcome.", "CRUSH."],
  },
  {
    id: "spaceCommander", name: "Commander Vela", track: "moon",
    look: { skin: "#87643f", suit: "#10182b", trim: "#66d9ff", helmet: "#0b1120", visor: "#66d9ff" },
    car: "starlanceElite", carName: "Starlance Elite",
    intro: "Gravity is a tool. You'll learn — briefly.",
    behaviour: "Bends gravity, takes impossible orbital lines, masters every jump.",
    traits: { gravityMaster: true, itemBias: ["gravityPulse", "spaceBoost", "orbitalShield"], airLine: true },
    difficulty: 1.25, hpBonus: 1,
    reward: { coins: 3000, driver: "z1ko", label: "Z1-KO + 3000 coins" },
    taunts: ["Orbit acquired.", "You fly like cargo.", "Gravity check!"],
  },
  {
    id: "auroraRex", name: "Aurora Rex", track: "asteroid",
    look: { skin: "#c9a06a", suit: "#1a0a2e", trim: "#7cffd0", helmet: "#12061f", visor: "#7cffd0" },
    car: "singularity", carName: "Singularity",
    intro: "Every champion ends somewhere. This is where.",
    behaviour: "The final boss. Chains power-up combos, knows every shortcut, three-stage gauntlet.",
    traits: { comboMaster: true, allShortcuts: true, itemRate: 1.8, topSpeedBonus: 0.06, stages: 3 },
    difficulty: 1.3, hpBonus: 2,
    reward: { coins: 6000, car: "singularity", label: "Singularity + 6000 coins + Galactic Crown" },
    taunts: ["Is that everything?", "I invented that line.", "The crown stays with me."],
  },
];

/* ---------------------------------------------------------------- *
 * CARS — every design is original and procedural (see carModels.js).
 * Stats 0..1. weight affects shoving; dura = hits before spin-out.
 * ---------------------------------------------------------------- */
export const CARS = [
  { id: "sandfly", name: "Sandfly Buggy", type: "buggy", cost: 0, unlock: null,
    blurb: "Open-frame dune buggy. Slow, bouncy, unkillable fun.",
    stats: { top: 0.52, accel: 0.62, handling: 0.6, drift: 0.55, boost: 0.5, weight: 0.35, dura: 0.55, offroad: 0.85 } },
  { id: "kestrel", name: "Kestrel Rally", type: "rally", cost: 0, unlock: null,
    blurb: "Boxy rally weapon. At home sideways on any surface.",
    stats: { top: 0.62, accel: 0.66, handling: 0.68, drift: 0.8, boost: 0.6, weight: 0.5, dura: 0.6, offroad: 0.7 } },
  { id: "wisp", name: "Wisp R", type: "lightweight", cost: 1200, unlock: null,
    blurb: "Featherweight single-seater. Corners like a thought.",
    stats: { top: 0.66, accel: 0.78, handling: 0.9, drift: 0.62, boost: 0.62, weight: 0.2, dura: 0.35, offroad: 0.25 } },
  { id: "falconGT", name: "Falcon GT", type: "supercar", cost: 2200, unlock: null,
    blurb: "Low, wide, furious. The fastest thing on tarmac.",
    stats: { top: 0.9, accel: 0.72, handling: 0.72, drift: 0.6, boost: 0.7, weight: 0.55, dura: 0.5, offroad: 0.15 } },
  { id: "rhino", name: "Rhino XT", type: "truck", cost: 1800, unlock: null,
    blurb: "Off-road truck. Shrugs off hits, flattens shortcuts.",
    stats: { top: 0.58, accel: 0.55, handling: 0.55, drift: 0.5, boost: 0.55, weight: 0.9, dura: 0.9, offroad: 0.95 } },
  { id: "voltArrow", name: "Volt Arrow", type: "electric", cost: 2600, unlock: null,
    blurb: "Electric dart. Instant torque, silent speed.",
    stats: { top: 0.78, accel: 0.92, handling: 0.75, drift: 0.58, boost: 0.8, weight: 0.45, dura: 0.45, offroad: 0.3 } },
  { id: "aeroglide", name: "AeroGlide", type: "hover", cost: 3400, unlock: { type: "cup", cup: "cityCup", label: "Win the City Cup" },
    blurb: "Hover racer. Floats over ruts — and over some hazards.",
    stats: { top: 0.74, accel: 0.7, handling: 0.82, drift: 0.85, boost: 0.72, weight: 0.4, dura: 0.5, offroad: 0.8 } },
  { id: "starlance", name: "Starlance", type: "space", cost: 4200, unlock: { type: "cup", cup: "spaceLeague", label: "Reach the Space League" },
    blurb: "Mag-lock space racer built for stations and moons.",
    stats: { top: 0.84, accel: 0.76, handling: 0.78, drift: 0.66, boost: 0.85, weight: 0.5, dura: 0.6, offroad: 0.5 } },
  { id: "bastion", name: "Bastion Mk.II", type: "armored", cost: 3000, unlock: null,
    blurb: "Armoured arcade brute. Wins arguments by existing.",
    stats: { top: 0.64, accel: 0.58, handling: 0.6, drift: 0.52, boost: 0.6, weight: 1.0, dura: 1.0, offroad: 0.6 } },
  /* Boss machines — unlocked by beating their owners. */
  { id: "colossus", name: "Granite Colossus", type: "truck", cost: 0, unlock: { type: "boss", boss: "mountainKing", label: "Beat the Mountain King" },
    blurb: "The Mountain King's siege engine on wheels.",
    stats: { top: 0.68, accel: 0.6, handling: 0.58, drift: 0.5, boost: 0.66, weight: 1.0, dura: 1.0, offroad: 1.0 } },
  { id: "duneWarden", name: "Dune Warden", type: "armored", cost: 0, unlock: { type: "boss", boss: "desertTitan", label: "Beat the Desert Titan" },
    blurb: "The Desert Titan's armoured canyon crawler.",
    stats: { top: 0.72, accel: 0.62, handling: 0.62, drift: 0.55, boost: 0.7, weight: 0.95, dura: 0.95, offroad: 0.9 } },
  { id: "spectreX", name: "Spectre-X", type: "electric", cost: 0, unlock: { type: "boss", boss: "neonPhantom", label: "Beat the Neon Phantom" },
    blurb: "The Phantom's night machine. Barely legal, barely visible.",
    stats: { top: 0.92, accel: 0.85, handling: 0.78, drift: 0.7, boost: 0.85, weight: 0.4, dura: 0.4, offroad: 0.2 } },
  { id: "starlanceElite", name: "Starlance Elite", type: "space", cost: 6000, unlock: { type: "boss", boss: "spaceCommander", label: "Beat Commander Vela" },
    blurb: "Vela's personal ship-on-wheels. Gravity optional.",
    stats: { top: 0.9, accel: 0.82, handling: 0.84, drift: 0.7, boost: 0.92, weight: 0.5, dura: 0.65, offroad: 0.6 } },
  { id: "singularity", name: "Singularity", type: "space", cost: 0, unlock: { type: "boss", boss: "auroraRex", label: "Beat Aurora Rex" },
    blurb: "Aurora Rex's crown jewel. The best of everything.",
    stats: { top: 0.95, accel: 0.88, handling: 0.88, drift: 0.8, boost: 0.95, weight: 0.55, dura: 0.7, offroad: 0.6 } },
];

export const PAINTS = [
  { id: "rushRed", name: "Rush Red", c: "#d32f2f" },
  { id: "kiaGold", name: "Kia Gold", c: "#e0a92e" },
  { id: "lagoon", name: "Lagoon Blue", c: "#1e78c8" },
  { id: "palmGreen", name: "Palm Green", c: "#2e9e4f" },
  { id: "midnight", name: "Midnight", c: "#232a36" },
  { id: "pearl", name: "Pearl White", c: "#e8e6df" },
  { id: "magma", name: "Magma Orange", c: "#e85d1f" },
  { id: "neon", name: "Neon Violet", c: "#8e3fd0" },
  { id: "ice", name: "Glacier Ice", c: "#a8d8e8" },
  { id: "stealth", name: "Stealth Grey", c: "#4a5058" },
];
export const DECALS = [
  { id: "none", name: "Clean" },
  { id: "stripe", name: "Racing Stripe" },
  { id: "flame", name: "Flame Side" },
  { id: "number", name: "Race Number" },
];
export const WHEELS = [
  { id: "steel", name: "Steel", rim: "#9aa2ab" },
  { id: "gold", name: "Gold Spoke", rim: "#e0b13a" },
  { id: "carbon", name: "Carbon", rim: "#2c2f33" },
  { id: "neonRim", name: "Neon Ring", rim: "#57f2c8" },
];
export const FLAMES = [
  { id: "orange", name: "Classic Flame", c: "#ff8c2e" },
  { id: "blue", name: "Plasma Blue", c: "#4db8ff" },
  { id: "green", name: "Toxic Green", c: "#5aff5a" },
  { id: "purple", name: "Void Purple", c: "#b45aff" },
];
export const GLOWS = [
  { id: "none", name: "No Underglow", c: null },
  { id: "cyan", name: "Cyan Glow", c: "#3ae0ff" },
  { id: "magenta", name: "Magenta Glow", c: "#ff3ad6" },
  { id: "gold", name: "Gold Glow", c: "#ffd34d" },
];

/* ---------------------------------------------------------------- *
 * UPGRADES — 7 channels, 5 levels each. Bonuses are additive to the
 * car's base 0..1 stat (clamped in physics).
 * ---------------------------------------------------------------- */
export const UPGRADES = [
  { id: "engine", name: "Engine", stat: "top", per: 0.035, icon: "⚙" },
  { id: "accel", name: "Acceleration", stat: "accel", per: 0.04, icon: "⏩" },
  { id: "handling", name: "Handling", stat: "handling", per: 0.035, icon: "🎯" },
  { id: "boost", name: "Boost", stat: "boost", per: 0.04, icon: "🔥" },
  { id: "tires", name: "Tyres", stat: "drift", per: 0.04, icon: "◎" },
  { id: "suspension", name: "Suspension", stat: "offroad", per: 0.04, icon: "🛞" },
  { id: "armor", name: "Durability", stat: "dura", per: 0.05, icon: "🛡" },
];
export const UPGRADE_MAX = 5;
export const upgradeCost = (level) => [250, 500, 900, 1500, 2400][level] || 999999;

/* ---------------------------------------------------------------- *
 * POWER-UPS. kind: instant | timed | projectile | trap | field
 * space:true items only appear in boxes on space tracks.
 * ---------------------------------------------------------------- */
export const POWERUPS = {
  turbo:        { name: "Turbo",          icon: "🔥", c: "#ff8c2e", kind: "timed",  blurb: "Strong speed boost." },
  superTurbo:   { name: "Super Turbo",    icon: "🚀", c: "#ff5a2e", kind: "timed",  blurb: "Huge speed boost.", rare: true },
  shield:       { name: "Shield",         icon: "🛡", c: "#4db8ff", kind: "timed",  blurb: "Blocks one hit." },
  rocket:       { name: "Homing Rocket",  icon: "🎯", c: "#ff4d4d", kind: "projectile", blurb: "Chases the racer ahead." },
  tripleRocket: { name: "Triple Rocket",  icon: "🎇", c: "#ff6b6b", kind: "projectile", blurb: "Three rockets, one target.", rare: true },
  emp:          { name: "EMP",            icon: "⚡", c: "#ffe14d", kind: "instant", blurb: "Zaps nearby racers' speed." },
  freeze:       { name: "Freeze Blast",   icon: "❄", c: "#a8e8ff", kind: "projectile", blurb: "Freezes the racer it hits." },
  shockwave:    { name: "Shockwave",      icon: "💥", c: "#ffb84d", kind: "instant", blurb: "Knocks back everyone close." },
  oil:          { name: "Oil Trap",       icon: "🛢", c: "#5a4a3a", kind: "trap",   blurb: "Slippery slick behind you." },
  mine:         { name: "Mine",           icon: "☀", c: "#d34d4d", kind: "trap",   blurb: "Explosive surprise behind you." },
  smoke:        { name: "Smoke Screen",   icon: "🌫", c: "#9aa2ab", kind: "trap",   blurb: "Blinding cloud behind you." },
  ghost:        { name: "Ghost Mode",     icon: "👻", c: "#c8b8e8", kind: "timed",  blurb: "Untouchable for a while." },
  invinc:       { name: "Invincibility",  icon: "⭐", c: "#ffd34d", kind: "timed",  blurb: "Nothing can stop you.", rare: true },
  magnet:       { name: "Coin Magnet",    icon: "🧲", c: "#e05aa0", kind: "timed",  blurb: "Coins fly to you." },
  jump:         { name: "Jump Boost",     icon: "🦘", c: "#8ee85a", kind: "instant", blurb: "Launch into the air." },
  repair:       { name: "Repair Kit",     icon: "🔧", c: "#5ae8b8", kind: "instant", blurb: "Fixes all damage." },
  slowField:    { name: "Slow Field",     icon: "🕸", c: "#b89ae8", kind: "timed",  blurb: "Racers near you crawl." },
  gravityPulse: { name: "Gravity Pulse",  icon: "🌀", c: "#7c9aff", kind: "instant", blurb: "Drags racers ahead backwards.", space: true },
  teleport:     { name: "Teleport Dash",  icon: "✦", c: "#e8e05a", kind: "instant", blurb: "Blink 40 metres forward." },
  spaceBoost:   { name: "Ion Surge",      icon: "☄", c: "#66d9ff", kind: "timed",  blurb: "Space-grade turbo.", space: true },
  orbitalShield:{ name: "Orbital Shield", icon: "🪐", c: "#9ad4ff", kind: "timed",  blurb: "Two orbiting guards block hits.", space: true },
};

/* ---------------------------------------------------------------- *
 * COMBOS — press two (or three) slots inside the combo window.
 * key = sorted ids joined by "+". pair order never matters.
 * ---------------------------------------------------------------- */
const combo = (ids, name, effect, blurb) => ({ key: [...ids].sort().join("+"), ids, name, effect, blurb });
export const COMBOS = [
  combo(["turbo", "shield"], "SHIELDED TURBO", "shieldedTurbo", "Big boost while protected."),
  combo(["rocket", "turbo"], "TURBO ROCKET", "turboRocket", "Faster, harder-hitting rocket."),
  combo(["rocket", "rocket"], "DOUBLE ROCKET", "doubleRocket", "Two rockets, back to back."),
  combo(["rocket", "rocket", "rocket"], "ROCKET BARRAGE", "rocketBarrage", "Five-rocket storm."),
  combo(["shield", "emp"], "ELECTRIC SHIELD", "electricShield", "Protects you, shocks anyone close."),
  combo(["freeze", "rocket"], "ICE ROCKET", "iceRocket", "Homing shot that freezes and slows."),
  combo(["oil", "freeze"], "ICE TRAP", "iceTrap", "A frozen skating rink behind you."),
  combo(["jump", "turbo"], "ROCKET JUMP", "rocketJump", "A huge boosted leap forward."),
  combo(["ghost", "turbo"], "PHANTOM BOOST", "phantomBoost", "Untouchable speed."),
  combo(["magnet", "turbo"], "SUPER MAGNET RUSH", "magnetRush", "Boost + giant coin vacuum."),
  combo(["shield", "shield"], "STRONG SHIELD", "strongShield", "A shield that takes three hits."),
  combo(["emp", "rocket"], "EMP ROCKET", "empRocket", "Rocket that shorts out its target's boost."),
  combo(["mine", "oil"], "STICKY MINEFIELD", "stickyMinefield", "Oil slick seeded with mines."),
  combo(["smoke", "oil"], "BLINDING SLICK", "blindingSlick", "Slippery AND invisible."),
  combo(["shockwave", "jump"], "QUAKE LEAP", "quakeLeap", "Leap, then slam down a shockwave."),
  combo(["freeze", "shockwave"], "FROST NOVA", "frostNova", "Freezes everyone around you."),
  combo(["teleport", "turbo"], "WARP STRIKE", "warpStrike", "Blink far ahead at full boost."),
  combo(["slowField", "shield"], "TIME BUBBLE", "timeBubble", "Slows attackers, shields you."),
  combo(["gravityPulse", "rocket"], "GRAVITON MISSILE", "gravitonMissile", "A rocket that drags its victim backwards."),
  combo(["superTurbo", "turbo"], "OVERDRIVE", "overdrive", "The fastest this game gets."),
  combo(["repair", "shield"], "FORTRESS", "fortress", "Full repair plus a strong shield."),
  combo(["invinc", "turbo"], "COMET MODE", "cometMode", "Invincible and blazing fast."),
  combo(["magnet", "rocket"], "MAGNO MISSILE", "magnoMissile", "A rocket that never misses."),
  combo(["spaceBoost", "shield"], "ION AEGIS", "ionAegis", "Ion speed inside a hard-light shell."),
  combo(["turbo", "turbo"], "TWIN TURBO", "twinTurbo", "Twice the boost, twice as long."),
  /* Named triples — any other 3 distinct combo-friendly items become TRIPLE FUSION. */
  combo(["turbo", "shield", "rocket"], "JUGGERNAUT", "juggernaut", "Boosted, armoured, armed."),
  combo(["freeze", "oil", "mine"], "WINTER MINEFIELD", "winterMinefield", "Ice, oil and mines in one nightmare."),
  combo(["ghost", "turbo", "magnet"], "SPECTRE HARVEST", "spectreHarvest", "Untouchable, fast, and rich."),
];
export const COMBO_BY_KEY = Object.fromEntries(COMBOS.map((c) => [c.key, c]));
export const comboFor = (ids) => COMBO_BY_KEY[[...ids].sort().join("+")] || null;
/* Items that can take part in a generic TRIPLE FUSION. */
export const FUSABLE = new Set(["turbo", "superTurbo", "shield", "ghost", "magnet", "invinc", "spaceBoost", "orbitalShield", "slowField", "repair", "jump", "teleport"]);

/* ---------------------------------------------------------------- *
 * CAREER — cups. Each event: { track, type, laps?, boss? }.
 * unlock: trophies needed. Rewards paid once, on first win.
 * ---------------------------------------------------------------- */
export const CUPS = [
  { id: "beginner", name: "Beginner Cup", tier: "Earth", need: 0,
    blurb: "Learn the craft on friendly roads.",
    events: [
      { track: "hills", type: "race", laps: 2 },
      { track: "beach", type: "race", laps: 2 },
      { track: "hills", type: "timeTrial", laps: 1 },
    ],
    reward: { coins: 600 } },
  { id: "beachCup", name: "Beach Cup", tier: "Earth", need: 1,
    blurb: "Sun, sand, and no mercy.",
    events: [
      { track: "beach", type: "race", laps: 3 },
      { track: "coastal", type: "race", laps: 2 },
      { track: "beach", type: "powerBattle", laps: 2 },
    ],
    reward: { coins: 900 } },
  { id: "mountainCup", name: "Mountain Cup", tier: "Earth", need: 2,
    blurb: "Thin air, long drops — and the King is watching.",
    events: [
      { track: "mountain", type: "race", laps: 2 },
      { track: "hills", type: "elimination", laps: 3 },
      { track: "mountain", type: "boss", boss: "mountainKing", laps: 2 },
    ],
    reward: { coins: 1200 } },
  { id: "cityCup", name: "City Cup", tier: "Earth", need: 3,
    blurb: "Neon nights and rooftop lines.",
    events: [
      { track: "neon", type: "race", laps: 2 },
      { track: "coastal", type: "driftChallenge", laps: 2 },
      { track: "neon", type: "boss", boss: "neonPhantom", laps: 2 },
    ],
    reward: { coins: 1500 } },
  { id: "desertCup", name: "Desert Cup", tier: "Earth", need: 4,
    blurb: "Heat, dust, and a Titan in the sand.",
    events: [
      { track: "canyon", type: "race", laps: 2 },
      { track: "jungle", type: "checkpoint", laps: 2 },
      { track: "canyon", type: "boss", boss: "desertTitan", laps: 2 },
    ],
    reward: { coins: 1800 } },
  { id: "championship", name: "Championship Cup", tier: "Earth", need: 5,
    blurb: "Four-race championship across the whole planet.",
    championship: true,
    events: [
      { track: "jungle", type: "race", laps: 2 },
      { track: "volcano", type: "race", laps: 2 },
      { track: "coastal", type: "race", laps: 3 },
      { track: "volcano", type: "elimination", laps: 3 },
    ],
    reward: { coins: 2500 } },
  { id: "spaceLeague", name: "Space League", tier: "Space", need: 6,
    blurb: "Leave the sky behind. Racing goes orbital.",
    events: [
      { track: "station", type: "race", laps: 2 },
      { track: "moon", type: "race", laps: 2 },
      { track: "station", type: "boostChallenge", laps: 2 },
      { track: "moon", type: "boss", boss: "spaceCommander", laps: 2 },
    ],
    reward: { coins: 3000 } },
  { id: "bossLeague", name: "Boss League", tier: "Space", need: 7,
    blurb: "Every boss. Back to back. Good luck.",
    events: [
      { track: "mountain", type: "boss", boss: "mountainKing", laps: 2 },
      { track: "neon", type: "boss", boss: "neonPhantom", laps: 2 },
      { track: "canyon", type: "boss", boss: "desertTitan", laps: 2 },
      { track: "moon", type: "boss", boss: "spaceCommander", laps: 2 },
    ],
    reward: { coins: 4000 } },
  { id: "galactic", name: "Galactic Championship", tier: "Space", need: 8,
    blurb: "Mars, asteroids — and Aurora Rex at the end of it all.",
    championship: true,
    events: [
      { track: "mars", type: "race", laps: 2 },
      { track: "asteroid", type: "race", laps: 2 },
      { track: "station", type: "race", laps: 2 },
      { track: "asteroid", type: "boss", boss: "auroraRex", laps: 3 },
    ],
    reward: { coins: 6000 } },
];

export const EVENT_TYPES = {
  race:           { name: "Race",              blurb: "6 racers, first over the line wins." },
  timeTrial:      { name: "Time Trial",        blurb: "Just you and the clock." },
  elimination:    { name: "Elimination",       blurb: "Every 20 seconds, last place is out." },
  boss:           { name: "Boss Race",         blurb: "One-on-one against a boss on their home track." },
  powerBattle:    { name: "Power-up Battle",   blurb: "Double item boxes. Hits score bonus coins." },
  checkpoint:     { name: "Checkpoint Rush",   blurb: "Beat the clock gate to gate." },
  driftChallenge: { name: "Drift Challenge",   blurb: "Place well AND rack up drift points." },
  boostChallenge: { name: "Boost Challenge",   blurb: "Hit every boost gate for bonus time." },
};

export const CHAMP_POINTS = [10, 8, 6, 4, 2, 1];

/* ---------------------------------------------------------------- *
 * ACHIEVEMENTS
 * ---------------------------------------------------------------- */
export const ACHIEVEMENTS = [
  { id: "firstWin", name: "First Blood", blurb: "Win any race.", coins: 200 },
  { id: "comboFirst", name: "Chemistry Set", blurb: "Trigger your first power-up combo.", coins: 200 },
  { id: "superCombo", name: "Triple Threat", blurb: "Trigger a 3-power-up SUPER COMBO.", coins: 500 },
  { id: "shortcutFound", name: "Off The Map", blurb: "Use a shortcut in a race.", coins: 150 },
  { id: "bigAir", name: "Frequent Flyer", blurb: "Stay airborne for 2 seconds.", coins: 150 },
  { id: "driftKing", name: "Sideways Royalty", blurb: "Score 2000 drift points in one race.", coins: 300 },
  { id: "bossDown", name: "Giant Slayer", blurb: "Beat your first boss.", coins: 500 },
  { id: "allBosses", name: "Crown Collector", blurb: "Beat every boss.", coins: 2000 },
  { id: "spaceRace", name: "Leaving Earth", blurb: "Finish a space track.", coins: 300 },
  { id: "rich", name: "Coin Tycoon", blurb: "Hold 5000 coins at once.", coins: 500 },
  { id: "garageFull", name: "Collector", blurb: "Own 6 cars.", coins: 800 },
  { id: "emblemHunter", name: "Emblem Hunter", blurb: "Collect 10 hidden K-emblems.", coins: 600 },
  { id: "cleanRace", name: "Untouchable", blurb: "Win a race without being hit.", coins: 400 },
  { id: "photoFinish", name: "By A Bumper", blurb: "Win a race by under half a second.", coins: 400 },
];

export const driverById = (id) => DRIVERS.find((d) => d.id === id) || DRIVERS[0];
export const carById = (id) => CARS.find((c) => c.id === id) || CARS[0];
export const bossById = (id) => BOSSES.find((b) => b.id === id) || null;
export const cupById = (id) => CUPS.find((c) => c.id === id) || null;
