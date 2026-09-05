/* ------------------------------------------------------------------ *
 * Castle Defender — the kingdoms.
 *
 * One entry per faction. `status: "playable"` kingdoms have stages in
 * stages.js and art in art/; the rest are shown on the Kingdoms page
 * as Coming Soon with their colours and hero so the menu never has a
 * dead button. Adding a kingdom later means filling in an entry here,
 * an art module, stage data and a hero script — nothing in the engine,
 * renderer or save format changes.
 * ------------------------------------------------------------------ */

export const KINGDOMS = [
  {
    id: "ashford",
    name: "Realm of Ashford",
    style: "Medieval British",
    status: "playable",
    tagline: "Stone castles, longbows and the knights of the realm.",
    colours: { primary: "#9b2a2a", secondary: "#d9a83a", ground: "#6f9a45" },
    hero: { name: "Sir Edric", ability: "Royal Charge" },
    units: ["Militia", "Men-at-Arms", "Knight", "Royal Guard", "Longbow Archer"],
    environment: "Green countryside, rivers and oak forest",
    campaign: "The Realm of Ashford",
  },
  {
    id: "roma",
    name: "Legion of the Frontier",
    style: "Roman",
    status: "soon",
    tagline: "Red shields, disciplined lines and stone fortifications.",
    colours: { primary: "#a63a2a", secondary: "#c9a24a", ground: "#b8a26a" },
    hero: { name: "Centurion Varro", ability: "Shield Wall" },
    units: ["Legionary", "Spearman", "Archer", "Centurion"],
    environment: "Mediterranean coast and olive hills",
    campaign: "The Roman Frontier",
  },
  {
    id: "norse",
    name: "Jarldom of the Fjords",
    style: "Viking",
    status: "soon",
    tagline: "Round shields, axes and wooden palisades in the snow.",
    colours: { primary: "#3b5a7a", secondary: "#c8c8c8", ground: "#dfe6ea" },
    hero: { name: "Jarl Sigrun", ability: "Battle Fury" },
    units: ["Raider", "Axe Warrior", "Archer", "Jarl"],
    environment: "Snowy coast and dark pine forest",
    campaign: "The Viking Coast",
  },
  {
    id: "sakura",
    name: "Domain of the Mountain",
    style: "Samurai",
    status: "soon",
    tagline: "Lacquered armour, long bows and a fortress under cherry blossom.",
    colours: { primary: "#5a2a4a", secondary: "#e8b4c8", ground: "#7d9a6a" },
    hero: { name: "Lord Takeda", ability: "Blade Storm" },
    units: ["Samurai", "Archer", "Spearman", "Daimyo"],
    environment: "Mountain passes and blossom groves",
    campaign: "The Samurai Fortress",
  },
  {
    id: "kemet",
    name: "Kingdom of the Two Rivers",
    style: "Ancient Egyptian",
    status: "soon",
    tagline: "Sandstone walls, chariots and gold against the desert.",
    colours: { primary: "#2a4a8a", secondary: "#d9b23a", ground: "#d9c28a" },
    hero: { name: "General Neferu", ability: "Sun Standard" },
    units: ["Spearman", "Archer", "Charioteer", "Royal Guard"],
    environment: "Desert dunes and a green river valley",
    campaign: "The Egyptian Desert",
  },
  {
    id: "savanna",
    name: "Kingdom of the Golden Stool",
    style: "West African",
    status: "soon",
    tagline: "Royal guards in woven cloth, tall shields and a fortified city.",
    colours: { primary: "#c8781e", secondary: "#2a6a4a", ground: "#b8a04a" },
    hero: { name: "Captain Adjoa", ability: "Guardian Rally" },
    units: ["Royal Guard", "Spearman", "Archer", "Shield Captain"],
    environment: "Warm savanna and forest edge",
    campaign: "The African Kingdom",
  },
];

export function kingdomById(id) {
  return KINGDOMS.find((k) => k.id === id) || KINGDOMS[0];
}
