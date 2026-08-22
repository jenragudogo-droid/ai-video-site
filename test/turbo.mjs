/* Headless browser playtest for Kianimation Turbo Rush.
   Serves the production build, opens the game in Chromium, and runs an
   autopiloted race end-to-end, checking menus, shops, combos, saving.
   Run: node test/turbo.mjs [trackId] */
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname } from "node:path";

const DIST = new URL("../dist", import.meta.url).pathname;
const SHOT = new URL("../test-shots", import.meta.url).pathname;
mkdirSync(SHOT, { recursive: true });

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".glb": "model/gltf-binary", ".png": "image/png" };
const server = createServer((req, res) => {
  let p = join(DIST, req.url.split("?")[0] === "/" ? "index.html" : req.url.split("?")[0]);
  if (!existsSync(p)) p = join(DIST, "index.html");
  try {
    const body = readFileSync(p);
    res.writeHead(200, { "content-type": MIME[extname(p)] || "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(4199, r));

const richSave = {
  coins: 20000,
  unlockedDrivers: ["blaze", "serwaa", "ghostrai", "orbit"],
  unlockedCars: ["sandfly", "kestrel", "falconGT", "starlance"],
  selectedDriver: "blaze", selectedCar: "kestrel",
  cosmetics: { paint: "#d32f2f", decal: "stripe", rim: "#e0b13a", flame: "#4db8ff", glow: "#3ae0ff" },
  upgrades: {}, trophies: 7, stars: 12, xp: 0,
  cupProgress: { beginner: { eventsDone: 3, won: true }, beachCup: { eventsDone: 3, won: true }, mountainCup: { eventsDone: 3, won: true }, cityCup: { eventsDone: 3, won: true }, desertCup: { eventsDone: 3, won: true }, championship: { eventsDone: 4, won: true }, spaceLeague: { eventsDone: 4, won: true }, bossLeague: { eventsDone: 4, won: true } },
  bossesBeaten: ["mountainKing"], bestTimes: {}, bestLaps: {}, emblems: {},
  achievements: [], stats: { races: 0, wins: 0, combos: 0, superCombos: 0, shortcuts: 0, bossWins: 0, driftBest: 0 },
  settings: { muted: true, quality: "low", touch: "off" },
  daily: null,
};

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox", "--disable-dev-shm-usage"],
});
const touchMode = process.argv[3] === "touch";
if (touchMode) richSave.settings.touch = "on";
const page = await browser.newPage({
  viewport: touchMode ? { width: 480, height: 820 } : { width: 1100, height: 700 },
  hasTouch: touchMode,
});
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
await page.addInitScript((s) => { localStorage.setItem("ktr-save-v1", JSON.stringify(s)); }, richSave);

const trackId = process.argv[2] || "beach";
const results = [];
const check = (name, ok, extra = "") => { results.push([name, ok, extra]); console.log((ok ? "  ✓ " : "  ✗ ") + name + (extra ? ` — ${extra}` : "")); };

await page.goto("http://localhost:4199/");
await page.click("text=Play now >> nth=1"); // second game card = Turbo Rush
await page.waitForSelector("text=TURBO RUSH", { timeout: 15000 });
check("game menu opens", true);
await page.screenshot({ path: join(SHOT, "01-menu.png") });

/* garage */
await page.click("text=🔧 Garage");
await page.waitForSelector("text=Cars");
check("garage opens", await page.isVisible("text=Kestrel Rally"));
await page.click("text=Upgrades");
const upBtn = page.locator(".trUpRow button").first();
await upBtn.click();
check("upgrade purchased", (await page.locator(".trPip--on").count()) >= 1);
await page.click("text=Style");
await page.click(".trSwatch >> nth=2");
await page.click("text=‹ Menu");

/* shops */
await page.click("text=🪪 Driver Shop");
await page.waitForSelector("text=Driver shop");
const buyBtns = page.locator("button:has-text('Buy ·')");
const nBuy = await buyBtns.count();
if (nBuy > 0) { await buyBtns.first().click(); }
check("driver shop + buy", nBuy > 0);
await page.screenshot({ path: join(SHOT, "02-driver-shop.png") });
await page.click("text=‹ Menu");
await page.click("text=🚗 Car Shop");
await page.waitForSelector("text=Car shop");
check("car shop opens", await page.isVisible("text=Bastion Mk.II"));
await page.click("text=‹ Menu");

/* career visible */
await page.click("text=🏁 Career");
await page.waitForSelector("text=Beginner Cup");
check("career shows cups", await page.isVisible("text=Galactic Championship"));
await page.screenshot({ path: join(SHOT, "03-career.png") });
await page.click("text=‹ Menu");

/* single race on the chosen track */
await page.click("text=🎯 Single Race");
await page.waitForSelector("text=Single race");
const NAME = { beach: "Palmwave", mountain: "Kestrel Pass", hills: "Greenveld", jungle: "Kanoa", canyon: "Ember", neon: "Volt City", coastal: "Azure", volcano: "Kindle", station: "Helios", moon: "Tranquility", mars: "Red Haven", asteroid: "Shatterfield" };
const cardSel = `.trTrackCard:not(.trTrackCard--locked):has-text("${NAME[trackId] || trackId}")`;
const trackCards = await page.locator(cardSel).count();
if (trackCards) await page.click(cardSel);
check("track selectable", trackCards > 0, trackId);
await page.evaluate(() => { window.__ktrAutopilot = true; });
await page.click("text=START RACE");
await page.waitForSelector(".trGl", { timeout: 15000 });
await page.waitForFunction(() => window.__ktrRace && window.__ktrRace.state !== "countdown", null, { timeout: 20000 });
check("race starts (countdown done)", true);
await page.screenshot({ path: join(SHOT, "04-race-start.png") });

/* verify world sanity while racing */
await page.waitForTimeout(6000);
const mid = await page.evaluate(() => {
  const race = window.__ktrRace;
  const p = race.player.body;
  return {
    racers: race.racers.length,
    speeds: race.racers.map((r) => +r.body.speed.toFixed(1)),
    playerY: +p.y.toFixed(2), lap: p.lap, s: +p.sProg.toFixed(0),
    aiOnGroundish: race.racers.every((r) => r.body.y > -30 && r.body.y < 120),
    slots: race.player.slots,
  };
});
check("6 racers in race", mid.racers === 6, JSON.stringify(mid.speeds));
check("racers move", mid.speeds.filter((s) => Math.abs(s) > 5).length >= 4);
check("nobody falls through world", mid.aiOnGroundish, `playerY=${mid.playerY}`);
await page.screenshot({ path: join(SHOT, "05-race-mid.png") });

/* space-track physics sanity */
const phys = await page.evaluate(() => ({
  gravity: window.__ktrRace.gravity, magnetic: window.__ktrRace.magnetic, world: window.__ktrRace.def.world,
}));
if (phys.world === "space") check("space physics active", phys.gravity < 1, `g=${phys.gravity} magnetic=${phys.magnetic}`);

/* touch controls */
if (touchMode) {
  check("touch buttons present", await page.isVisible(".trTouchSlot") && await page.isVisible(".trTouchBtn--gas"));
  await page.evaluate(() => { window.__ktrRace.player.slots = ["turbo", "shield", null]; });
  const slots = page.locator(".trTouchSlot");
  /* two near-simultaneous taps, like two thumbs */
  await page.evaluate(() => {
    const els = document.querySelectorAll(".trTouchSlot");
    const tap = (el) => {
      const r = el.getBoundingClientRect();
      const t = new Touch({ identifier: Math.random() * 1e6 | 0, target: el, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 });
      el.dispatchEvent(new TouchEvent("touchstart", { touches: [t], targetTouches: [t], changedTouches: [t], bubbles: true }));
      el.dispatchEvent(new TouchEvent("touchend", { touches: [], targetTouches: [], changedTouches: [t], bubbles: true }));
    };
    tap(els[0]); setTimeout(() => tap(els[1]), 60);
  });
  await page.waitForTimeout(700);
  const c = await page.evaluate(() => window.__ktrRace.player.combosDone);
  check("touch two-tap combo", c >= 1, `combos=${c}`);
}

/* combo test: inject items and press 1+2 together */
await page.evaluate(() => { window.__ktrRace.player.slots = ["turbo", "shield", "rocket"]; });
await page.keyboard.down("1");
await page.keyboard.down("2");
await page.waitForTimeout(80);
await page.keyboard.up("1");
await page.keyboard.up("2");
await page.waitForTimeout(500);
const combo1 = await page.evaluate(() => window.__ktrRace.player.combosDone);
check("2-key combo (SHIELDED TURBO)", combo1 >= 1, `combos=${combo1}`);
await page.evaluate(() => { window.__ktrRace.player.slots = ["turbo", "shield", "rocket"]; });
await page.keyboard.down("1"); await page.keyboard.down("2"); await page.keyboard.down("3");
await page.waitForTimeout(80);
await page.keyboard.up("1"); await page.keyboard.up("2"); await page.keyboard.up("3");
await page.waitForTimeout(500);
const combo2 = await page.evaluate(() => ({ c: window.__ktrRace.player.combosDone, s: window.__ktrRace.player.superCombosDone }));
check("3-key SUPER combo (JUGGERNAUT)", combo2.s >= 1, JSON.stringify(combo2));
await page.screenshot({ path: join(SHOT, "06-race-combo.png") });

/* let the race finish */
await page.waitForFunction(() => window.__ktrRace?.state === "finished", null, { timeout: 240000 });
await page.waitForSelector(".trPanel--results", { timeout: 10000 });
const res = await page.evaluate(() => window.__ktrRace.results);
check("race finishes with results", !!res, `place ${res.place}/${res.total} in ${res.time.toFixed(1)}s`);
await page.screenshot({ path: join(SHOT, "07-results.png") });

/* saving */
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("ktr-save-v1")));
check("save records race", saved.stats.races >= 1 && saved.coins !== 20000, `coins=${saved.coins}, races=${saved.stats.races}`);
check("best time saved", !!saved.bestTimes && Object.keys(saved.bestTimes).length >= 1, JSON.stringify(saved.bestTimes));

await page.click("text=Back to menu");
await page.waitForSelector("text=TURBO RUSH");
check("back to menu", true);

/* boss rematch: 1-v-1 duel with intro card */
await page.click("text=🎯 Single Race");
await page.click('.trTrackCard:has-text("Kestrel Pass")');
await page.click("text=⚔ Rematch the boss");
await page.waitForSelector(".trBossIntro", { timeout: 10000 });
check("boss intro shows", await page.isVisible("text=The Mountain King"));
await page.waitForFunction(() => window.__ktrRace && window.__ktrRace.state !== "countdown", null, { timeout: 20000 });
const bossState = await page.evaluate(() => ({
  n: window.__ktrRace.racers.length,
  boss: !!window.__ktrRace.racers.find((r) => r.isBoss),
}));
check("boss duel is 1-v-1", bossState.n === 2 && bossState.boss);
await page.screenshot({ path: join(SHOT, "08-boss.png") });
await page.keyboard.press("Escape");
await page.click("text=Quit race");
await page.waitForSelector("text=TURBO RUSH");
check("quit from pause works", true);

/* The landing page embeds YouTube iframes; in this sandbox their network
   is blocked and the third-party frame throws storage-access errors.
   Those are not game errors — filter them, keep everything else. */
const errFiltered = errors.filter((e) => !e.includes("WebGL") && !e.includes("GroupMarkerNotSet") && !e.includes("Autoplay") && !e.includes("AudioContext") && !e.includes("ERR_TUNNEL") && !e.includes("localStorage") && !e.includes("Failed to load resource"));
check("no page errors", errFiltered.length === 0, errFiltered.slice(0, 3).join(" | "));

await browser.close();
server.close();
const fails = results.filter(([, ok]) => !ok);
console.log(fails.length ? `\n${fails.length} FAILURES` : "\nALL CHECKS PASSED");
process.exit(fails.length ? 1 : 0);
