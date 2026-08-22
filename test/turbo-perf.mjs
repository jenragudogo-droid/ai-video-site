import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
const DIST = new URL("../dist", import.meta.url).pathname;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
const server = createServer((req, res) => {
  let p = join(DIST, req.url.split("?")[0] === "/" ? "index.html" : req.url.split("?")[0]);
  if (!existsSync(p)) p = join(DIST, "index.html");
  try { res.writeHead(200, {"content-type": MIME[extname(p)]||"application/octet-stream"}); res.end(readFileSync(p)); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(4196, r));
const save = { coins: 0, unlockedDrivers:["blaze"], unlockedCars:["kestrel"], selectedDriver:"blaze", selectedCar:"kestrel",
  cosmetics:{}, upgrades:{}, cupProgress:{beginner:{won:true},beachCup:{won:true},mountainCup:{won:true},cityCup:{won:true},desertCup:{won:true},championship:{won:true},spaceLeague:{won:true},bossLeague:{won:true}},
  bossesBeaten:[], bestTimes:{}, bestLaps:{}, emblems:{}, achievements:[],
  stats:{races:0,wins:0,combos:0,superCombos:0,shortcuts:0,bossWins:0,driftBest:0},
  settings:{muted:true,quality:process.argv[3]||"high",touch:"off"}, trophies:8, stars:0, xp:0, daily:null };
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium",
  args: ["--use-gl=angle","--use-angle=swiftshader","--no-sandbox","--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1200, height: 750 } });
await page.addInitScript((s) => localStorage.setItem("ktr-save-v1", JSON.stringify(s)), save);
await page.goto("http://localhost:4196/");
await page.click("text=Play now >> nth=1");
await page.waitForSelector("text=TURBO RUSH");
const NAMES = { neon: "Volt City", asteroid: "Shatterfield", mountain: "Kestrel Pass" };
const name = NAMES[process.argv[2] || "neon"];
await page.click("text=🎯 Single Race");
await page.click(`.trTrackCard:has-text("${name}")`);
await page.evaluate(() => { window.__ktrAutopilot = true; });
await page.click("text=START RACE");
await page.waitForFunction(() => window.__ktrRace?.state === "racing", null, { timeout: 20000 });
await page.waitForTimeout(3000);

const stats = await page.evaluate(() => new Promise((resolve) => {
  let frames = 0;
  const t0 = performance.now();
  const tick = () => { frames++; if (performance.now() - t0 < 5000) requestAnimationFrame(tick); else resolve({ fps: frames / 5 }); };
  requestAnimationFrame(tick);
}));
const info = await page.evaluate(() => window.__ktrView
  ? { calls: window.__ktrView.renderer.info.render.calls, tris: window.__ktrView.renderer.info.render.triangles }
  : null);
console.log(process.argv[2], process.argv[3] || "high", "fps:", stats.fps.toFixed(1), "render:", JSON.stringify(info), "(software GL — real GPUs are far faster)");
await browser.close(); server.close();
