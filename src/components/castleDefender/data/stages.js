/* ------------------------------------------------------------------ *
 * Castle Defender — stage data for the Realm of Ashford.
 *
 * Every stage ships TWO layouts of the same battlefield: a landscape
 * one (castle east, enemies from the west) and a portrait one (castle
 * north, enemies from the south) so a phone held upright gets a map
 * that fills the screen instead of a shrunken landscape. Plot indexes,
 * route indexes and wave scripts are shared between the two layouts.
 *
 * Coordinates are world units. Landscape worlds are 1600 x 900,
 * portrait worlds are 900 x 1600.
 * ------------------------------------------------------------------ */

const P = (x, y) => ({ x, y });

/* A wave is a list of groups. `at` is seconds after the wave starts,
   `every` is the gap between spawns in the group, `route` picks the
   road and `form` the formation (see waves.js). */
const W = (...groups) => groups;
const G = (type, count, o = {}) => ({ type, count, route: 0, at: 0, every: 1.3, form: "column", ...o });

export const STAGES = [
  {
    id: "greenhollow",
    number: 1,
    numeral: "I",
    name: "Greenhollow",
    subtitle: "The Western Road",
    kingdom: "ashford",
    available: true,
    time: "day",
    castleHp: 20,
    startGold: 250,
    firstCountdown: 18,
    countdown: 22,
    intro: [
      "The Blackmoor Warband has crossed the river.",
      "Hold the western road. Hold Greenhollow.",
    ],
    tips: [
      "Archer towers are cheap and fast. Start with two near the road.",
      "A barracks on the road holds enemies under your archers' fire.",
      "Ballistas pierce armour. Catapults land behind shields.",
      "Tap the road entrance banner to call the next wave early for bonus gold.",
    ],
    waves: [
      W(G("bandit", 8, { every: 1.4 })),
      W(G("bandit", 10, { every: 1.2 }), G("archer", 4, { at: 6, every: 1.6 })),
      W(G("bandit", 6, { every: 1.1 }), G("manAtArms", 6, { at: 4, every: 1.8, form: "line" })),
      W(G("outrider", 10, { every: 0.8, form: "rush" }), G("archer", 4, { at: 3, every: 1.5, route: 1 })),
      W(G("bandit", 6, { every: 1.0 }), G("manAtArms", 4, { at: 3, every: 1.2, form: "line" }), G("ram", 1, { at: 6 })),
      W(G("shieldBearer", 6, { every: 1.6, form: "shieldwall" }), G("archer", 6, { at: 2, every: 1.6 }), G("bandit", 8, { at: 8, every: 1.0, route: 1 })),
      W(G("manAtArms", 6, { every: 1.5, form: "line" }), G("shieldBearer", 4, { at: 4, every: 1.6, form: "shieldwall" }),
        G("outrider", 8, { at: 1, every: 0.9, route: 1, form: "rush" }), G("archer", 4, { at: 9, every: 1.5, route: 1 })),
      W(G("bandit", 12, { every: 0.9 }), G("shieldBearer", 6, { at: 5, every: 1.5, form: "shieldwall" }), G("archer", 8, { at: 7, every: 1.3 }),
        G("outrider", 8, { at: 2, every: 0.9, route: 1, form: "rush" }), G("manAtArms", 8, { at: 10, every: 1.4, route: 1, form: "line" }),
        G("ram", 1, { at: 18 }), G("ram", 1, { at: 22, route: 1 })),
    ],
    routeOpens: [1, 4],           // route index -> first wave it is used
    layouts: {
      landscape: {
        w: 1600, h: 900,
        routes: [
          { points: [P(-60, 240), P(140, 250), P(300, 330), P(430, 470), P(560, 600), P(720, 660), P(900, 620), P(1060, 690), P(1240, 720), P(1370, 650), P(1415, 560), P(1415, 478)] },
          { points: [P(760, -60), P(790, 110), P(900, 260), P(1020, 400), P(1120, 540), P(1240, 720), P(1370, 650), P(1415, 560), P(1415, 478)] },
        ],
        plots: [P(250, 410), P(440, 610), P(650, 540), P(830, 740), P(1000, 570), P(1180, 830), P(900, 380), P(1290, 580), P(1100, 260)],
        castle: { x: 1270, y: 150, w: 290, h: 320, gate: P(1415, 470) },
        river: [P(600, -60), P(620, 200), P(560, 420), P(545, 600), P(500, 800), P(470, 960)],
        bridges: [{ x: 553, y: 600, angle: 0.75 }],
        heroSpawn: P(1360, 545),
        flags: [P(70, 300), P(830, 80)],
        forests: [
          { x: 0, y: 0, w: 520, h: 200, n: 22 }, { x: 0, y: 560, w: 380, h: 340, n: 20 },
          { x: 900, y: 0, w: 700, h: 120, n: 16 }, { x: 1300, y: 720, w: 300, h: 180, n: 9 },
          { x: 620, y: 780, w: 500, h: 120, n: 10 }, { x: 640, y: 150, w: 100, h: 320, n: 6 },
        ],
        rocks: [P(680, 300), P(330, 700), P(1150, 150), P(1000, 860), P(560, 200), P(1490, 620)],
        fields: [{ x: 1060, y: 310, w: 120, h: 64 }],
        title: P(800, 420),
      },
      portrait: {
        w: 900, h: 1600,
        routes: [
          { points: [P(-60, 1420), P(120, 1400), P(250, 1290), P(330, 1140), P(240, 980), P(300, 800), P(470, 690), P(640, 570), P(560, 450), P(450, 400), P(450, 372)] },
          { points: [P(960, 980), P(800, 940), P(700, 820), P(740, 700), P(640, 570), P(560, 450), P(450, 400), P(450, 372)] },
        ],
        plots: [P(160, 1170), P(400, 1060), P(120, 820), P(420, 830), P(600, 740), P(820, 1080), P(810, 620), P(330, 520), P(690, 440)],
        castle: { x: 300, y: 90, w: 300, h: 270, gate: P(450, 360) },
        river: [P(960, 1520), P(720, 1440), P(480, 1330), P(250, 1280), P(60, 1200), P(-60, 1150)],
        bridges: [{ x: 250, y: 1283, angle: -0.95 }],
        heroSpawn: P(450, 430),
        flags: [P(80, 1470), P(850, 1040)],
        forests: [
          { x: 0, y: 380, w: 220, h: 320, n: 14 }, { x: 640, y: 80, w: 260, h: 360, n: 14 },
          { x: 0, y: 1380, w: 300, h: 220, n: 8 }, { x: 560, y: 1200, w: 340, h: 400, n: 18 },
          { x: 0, y: 0, w: 280, h: 120, n: 8 },
        ],
        rocks: [P(120, 1000), P(760, 500), P(560, 950), P(200, 640), P(840, 1300)],
        fields: [{ x: 70, y: 180, w: 120, h: 80 }],
        title: P(450, 800),
      },
    },
  },
  {
    id: "stonebridge",
    number: 2,
    numeral: "II",
    name: "Stonebridge Ford",
    subtitle: "The River Crossing",
    kingdom: "ashford",
    available: false,
    time: "day",
    castleHp: 20,
    startGold: 300,
    intro: ["The warband splits at the ford.", "Two roads. One bridge. Hold both."],
    waves: [],
    unlockNote: "Coming in the next build",
  },
  {
    id: "siege",
    number: 3,
    numeral: "III",
    name: "The Siege of Ashford",
    subtitle: "Warlord Blackmoor",
    kingdom: "ashford",
    available: false,
    time: "dusk",
    castleHp: 25,
    startGold: 350,
    intro: ["Every road leads to Ashford.", "Blackmoor himself rides with the Ironbreaker."],
    waves: [],
    unlockNote: "Coming in the next build",
  },
];

export function stageById(id) {
  return STAGES.find((s) => s.id === id) || STAGES[0];
}

export function waveCount(stage) {
  return stage.waves.length;
}
