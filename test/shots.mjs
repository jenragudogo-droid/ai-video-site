/* Screenshot tour: captures gameplay on several tracks for visual review. */
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname } from "node:path";
const DIST = new URL("../dist", import.meta.url).pathname;
const SHOT = new URL("../test-shots", import.meta.url).pathname;
mkdirSync(SHOT, { recursive: true });
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
const server = createServer((req, res) => {
  let p = join(DIST, req.url.split("?")[0] === "/" ? "index.html" : req.url.split("?")[0]);
  if (!existsSync(p)) p = join(DIST, "index.html");
  try { res.writeHead(200, {"content-type": MIME[extname(p)]||"application/octet-stream"}); res.end(readFileSync(p)); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(4197, r));
const save = { coins: 20000, unlockedDrivers:["blaze"], unlockedCars:["kestrel","falconGT"], selectedDriver:"blaze", selectedCar:"falconGT",
  cosmetics:{paint:"#d32f2f",decal:"stripe",rim:"#e0b13a",flame:"#ff8c2e",glow:"#3ae0ff"}, upgrades:{},
  cupProgress:{beginner:{won:true},beachCup:{won:true},mountainCup:{won:true},cityCup:{won:true},desertCup:{won:true},championship:{won:true},spaceLeague:{won:true},bossLeague:{won:true}},
  bossesBeaten:[], bestTimes:{}, bestLaps:{}, emblems:{}, achievements:[],
  stats:{races:0,wins:0,combos:0,superCombos:0,shortcuts:0,bossWins:0,driftBest:0},
  settings:{muted:true,quality:"high",touch:"off"}, trophies:8, stars:0, xp:0, daily:null };
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium",
  args: ["--use-gl=angle","--use-angle=swiftshader","--no-sandbox","--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1200, height: 750 } });
await page.addInitScript((s) => localStorage.setItem("ktr-save-v1", JSON.stringify(s)), save);
await page.goto("http://localhost:4197/");
await page.click("text=Play now >> nth=1");
await page.waitForSelector("text=TURBO RUSH");
const NAMES = { beach: "Palmwave", mountain: "Kestrel Pass", neon: "Volt City", volcano: "Kindle", station: "Helios", moon: "Tranquility", canyon: "Ember", asteroid: "Shatterfield" };
for (const [id, name] of Object.entries(NAMES)) {
  await page.click("text=🎯 Single Race");
  await page.click(`.trTrackCard:has-text("${name}")`);
  await page.evaluate(() => { window.__ktrAutopilot = true; });
  await page.click("text=START RACE");
  await page.waitForFunction(() => window.__ktrRace && window.__ktrRace.state === "racing", null, { timeout: 20000 });
  await page.locator(".trGl").scrollIntoViewIfNeeded();
  await page.waitForTimeout(id === "neon" || id === "station" ? 9000 : 6000);
  await page.screenshot({ path: join(SHOT, `track-${id}.png`) });
  await page.keyboard.press("Escape");
  await page.click("text=Quit race");
  await page.waitForSelector("text=TURBO RUSH");
}
await browser.close(); server.close();
console.log("shots done");
