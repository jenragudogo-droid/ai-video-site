/* Career flow: fresh save, run Beginner Cup event 1 end-to-end. */
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
await new Promise(r => server.listen(4195, r));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium",
  args: ["--use-gl=angle","--use-angle=swiftshader","--no-sandbox","--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
await page.goto("http://localhost:4195/");
await page.click("text=Play now >> nth=1");
await page.waitForSelector("text=TURBO RUSH");
// fresh save: mute for sanity
await page.click("text=🏁 Career");
await page.waitForSelector("text=Beginner Cup");
const lockedCount = await page.locator(".trCup--locked").count();
console.log("locked cups on fresh save:", lockedCount, "(expect 8)");
await page.evaluate(() => { window.__ktrAutopilot = true; });
await page.click(".trEvent--next >> nth=0");
await page.waitForFunction(() => window.__ktrRace?.state === "racing", null, { timeout: 25000 });
console.log("career event 1 racing...");
await page.waitForFunction(() => window.__ktrRace?.state === "finished", null, { timeout: 240000 });
await page.waitForSelector(".trPanel--results");
const res = await page.evaluate(() => window.__ktrRace.results);
console.log("event 1 done: place", res.place + "/" + res.total);
const hasNext = await page.isVisible("text=Next event ›");
const hasRetry = await page.isVisible("text=Retry event ↻");
console.log("next:", hasNext, "retry:", hasRetry);
if (hasNext) {
  await page.click("text=Next event ›");
  await page.waitForFunction(() => window.__ktrRace?.state === "racing" || window.__ktrRace?.state === "countdown", null, { timeout: 25000 });
  console.log("event 2 started ✓ (chained from results)");
  await page.keyboard.press("Escape");
  await page.click("text=Quit race");
} else if (hasRetry) {
  console.log("player finished off-podium; retry path shown ✓");
  await page.click("text=Retry event ↻");
  await page.waitForFunction(() => window.__ktrRace?.state === "racing" || window.__ktrRace?.state === "countdown", null, { timeout: 25000 });
  console.log("retry started ✓");
  await page.keyboard.press("Escape");
  await page.click("text=Quit race");
}
await page.waitForSelector("text=TURBO RUSH");
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("ktr-save-v1")));
console.log("cupProgress:", JSON.stringify(saved.cupProgress), "coins:", saved.coins);
await browser.close(); server.close();
console.log("CAREER FLOW OK");
