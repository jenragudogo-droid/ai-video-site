/* Headless play-test harness for Kianimation Endless Rush. */
import { chromium } from "playwright";
import fs from "node:fs";

const URL = process.env.RUSH_URL || "http://127.0.0.1:5199/";
const OUT = process.env.RUSH_SHOTS
  || new URL("../shots", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const log = (...a) => console.log(...a);
const errors = [];

export async function boot({ width = 1280, height = 800, mobile = false } = {}) {
  const browser = await chromium.launch({
    ...(process.env.RUSH_CHROME ? { executablePath: process.env.RUSH_CHROME } : {}),
    args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"],
  });
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: mobile ? 2 : 1,
    hasTouch: mobile,
    isMobile: mobile,
    userAgent: mobile
      ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
      : undefined,
  });
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") { errors.push(m.text()); log("  [console error]", m.text()); }
  });
  page.on("pageerror", (e) => { errors.push(String(e)); log("  [page error]", String(e)); });
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  /* The lab page is the game; the real site puts it behind a card, so
     open it if it is not already on screen. Same harness, either host. */
  if (!(await page.locator("canvas.krushCanvas").isVisible().catch(() => false))) {
    const card = page.locator(".gameCard", { hasText: "Endless Rush" })
      .getByRole("button", { name: /Play now/i });
    if (await card.isVisible().catch(() => false)) {
      await page.locator("#games").scrollIntoViewIfNeeded();
      await card.click();
    }
  }
  await page.waitForSelector("canvas.krushCanvas");
  return { browser, context, page };
}

export const state = (page) => page.evaluate(() => {
  const g = window.__rush?.game?.current;
  if (!g) return null;
  return {
    phase: g.phase, dist: g.dist, z: g.z, speed: g.speed,
    lane: g.lane, lanePos: g.lanePos, x: g.x,
    y: g.y, airborne: g.airborne, sliding: g.sliding,
    score: g.score, coins: g.coins,
    powers: { ...g.powers },
    chunks: g.chunks.length,
    obstacles: g.chunks.reduce((n, c) => n + c.obstacles.length, 0),
    coinsOnTrack: g.chunks.reduce((n, c) => n + c.coins.filter((x) => !x.taken).length, 0),
    powerupsOnTrack: g.chunks.reduce((n, c) => n + c.powerups.filter((x) => !x.taken).length, 0),
    fps: window.__rush?.tick?.current?.fps,
    quality: window.__rush?.quality?.current,
    items: window.__rush?.renderer?.current?.items,
  };
});

export const setState = (page, patch) => page.evaluate((p) => {
  const g = window.__rush?.game?.current;
  if (!g) return false;
  Object.assign(g, p);
  return true;
}, patch);

export const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });
export const getErrors = () => errors;
export { log };
