/* ------------------------------------------------------------------ *
 * The permanent coin balance.
 *
 * Walks the exact sequence a player does: note the balance, run, collect,
 * go back to the menu, check it went up, do it again, refresh, check it
 * survived. Every route out of a run is covered, because they are the
 * thing that goes wrong — dying, quitting from the pause card, and
 * closing the game outright are three different code paths and only one
 * of them used to bank anything.
 * ------------------------------------------------------------------ */

import { chromium } from "playwright";

const URL = process.env.RUSH_URL || "http://127.0.0.1:5199/";
const CHROME = process.env.RUSH_CHROME || undefined;
const KEY = "kianimation.endlessRush.v1";

let pass = 0, fail = 0; const bad = [];
const ck = (n, ok, d) => { if (ok) { pass++; console.log(`  ok   ${n}${d ? ` — ${d}` : ""}`); }
  else { fail++; bad.push(n); console.log(`  FAIL ${n}${d ? ` — ${d}` : ""}`); } };

const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: ["--mute-audio"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errs = [];
const noise = (t) => /youtube|ytimg|TUNNEL|NAME_NOT|INTERNET_DISCON/i.test(t);
page.on("console", (m) => { if (m.type() === "error" && !noise(m.text())) errs.push(m.text()); });
page.on("pageerror", (e) => { if (!noise(String(e))) errs.push(String(e)); });

const save = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "{}"), KEY);
const menuBalance = async () => {
  const t = await page.locator(".krushStats div", { hasText: "Coins to spend" }).locator("strong").innerText();
  return Number(t.replace(/[^0-9]/g, ""));
};

async function openGame() {
  await page.locator("#games").scrollIntoViewIfNeeded();
  const open = page.locator(".gameCard", { hasText: "Endless Rush" }).getByRole("button", { name: /Play now/i });
  if (await open.isVisible().catch(() => false)) await open.click();
  await page.waitForSelector("canvas.krushCanvas", { timeout: 20000 });
  await page.waitForTimeout(600);
}

/** Runs until at least `want` coins are collected. Returns the run total. */
async function collect(want, maxMs = 60000) {
  const t0 = Date.now();
  let got = 0;
  while (Date.now() - t0 < maxMs) {
    const s = await page.evaluate(() => {
      const g = window.__rush?.game?.current;
      return g ? { phase: g.phase, coins: g.coins } : null;
    });
    if (!s) break;
    got = s.coins;
    if (s.phase !== "running") break;
    if (got >= want) break;
    // steer toward coins using the same debug hook the other tests use
    const key = await page.evaluate(() => {
      const g = window.__rush?.game?.current;
      if (!g || g.phase !== "running") return null;
      let best = null;
      for (const c of g.chunks || []) for (const co of c.coins || []) {
        if (co.taken || co.sky || co.roof) continue;
        const dz = co.z - g.z;
        if (dz < 5 || dz > 40) continue;
        if (!best || dz < best.dz) best = { dz, lane: co.lane };
      }
      const lanes = [[], [], []];
      for (const c of g.chunks || []) for (const o of c.obstacles || []) {
        const dz = o.z - g.z;
        if (dz > -2 && dz < 34 && !(o.base > 0)) lanes[o.lane].push({ dz, act: o.act });
      }
      const mine = lanes[g.lane].filter(o => o.act === "dodge").sort((a,b)=>a.dz-b.dz)[0];
      const vert = lanes[g.lane].sort((a,b)=>a.dz-b.dz)[0];
      if (vert && vert.act === "jump" && vert.dz < g.speed * 0.36 && !g.airborne) return "Space";
      if (vert && vert.act === "slide" && vert.dz < g.speed * 0.44 && !g.sliding) return "s";
      if (mine && mine.dz < g.speed * 1.1) {
        for (const L of [g.lane - 1, g.lane + 1]) {
          if (L < 0 || L > 2) continue;
          const blk = lanes[L].filter(o => o.act === "dodge").sort((a,b)=>a.dz-b.dz)[0];
          if (!blk || blk.dz > g.speed * 1.6) return L > g.lane ? "ArrowRight" : "ArrowLeft";
        }
      }
      if (best && best.lane !== g.lane && best.dz > g.speed * 0.5) {
        const blk = lanes[best.lane].filter(o => o.act === "dodge").sort((a,b)=>a.dz-b.dz)[0];
        if (!blk || blk.dz > best.dz + 6) return best.lane > g.lane ? "ArrowRight" : "ArrowLeft";
      }
      return null;
    });
    if (key) await page.keyboard.press(key);
    await page.waitForTimeout(14);
  }
  return got;
}

const startRun = async () => {
  await page.locator(".krushPrimary", { hasText: "Start running" }).click();
  await page.waitForTimeout(800);
};

/* Every coin count in this file is taken while paused.
   The game does not wait for the test: between reading `g.coins` and
   clicking a button, Playwright spends a few hundred milliseconds
   scrolling and hit-testing, and the runner keeps collecting for all of
   it. Comparisons then fail by one or two coins and look exactly like a
   banking bug. Pause freezes the simulation — proven frame-identical
   elsewhere in this suite — so the number measured is the number
   banked. */
const pause = async () => { await page.keyboard.press("p"); await page.waitForTimeout(350); };
const resume = async () => {
  await page.locator(".krushPrimary", { hasText: "Resume" }).click();
  await page.waitForTimeout(300);
};
const coinsNow = () => page.evaluate(() => window.__rush.game.current.coins);
const quitFromPause = async () => {
  await page.locator(".krushGhost", { hasText: "Quit run" }).click();
  await page.waitForTimeout(500);
};
/** Collect at least `want`, then freeze and report the exact tally. */
const runAndCount = async (want, ms = 45000) => {
  await collect(want, ms);
  await pause();
  return coinsNow();
};
const quitViaPause = async () => { await pause(); await quitFromPause(); };

/* ------------------------------ the sequence ------------------------------ */

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.evaluate((k) => localStorage.removeItem(k), KEY);
await page.reload({ waitUntil: "domcontentloaded" });
await openGame();

/* This suite steers the runner toward coins and counts them, which needs
   `window.__rush` — the debug hook the dev server exposes and the
   production bundle deliberately does not. Point it at `npm run dev`. */
if (!(await page.evaluate(() => typeof window.__rush !== "undefined"))) {
  console.log("\nThis suite needs the dev server (window.__rush is absent).");
  console.log("Run:  npm run dev -- --port 5199   then   node test/coins.mjs");
  await browser.close();
  process.exit(2);
}

console.log("\n0 — an existing profile is never trampled");
{
  await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({
    version: 2, highScore: 9876, bestDistance: 4321, bestCoins: 250,
    totalCoins: 12000, bank: 3500, runs: 42,
    unlocked: ["runner", "courier", "skyrider"], selected: "skyrider",
    settings: { muted: true, music: false, hints: false },
  })), KEY);
  await page.reload({ waitUntil: "domcontentloaded" });
  await openGame();
  const kept = await save();
  ck("saved bank survives a reload untouched", kept.bank === 3500, `${kept.bank}`);
  ck("lifetime total survives", kept.totalCoins === 12000, `${kept.totalCoins}`);
  ck("purchases survive", kept.unlocked.length === 3, kept.unlocked.join(","));
  ck("selection survives", kept.selected === "skyrider", kept.selected);
  ck("high score survives", kept.highScore === 9876, `${kept.highScore}`);
  ck("settings survive", kept.settings.muted === true && kept.settings.hints === false);
  const shown = await menuBalance();
  ck("menu shows the stored bank, not the lifetime total", shown === 3500, `${shown}`);

  // and a run adds on top of it rather than replacing it
  await startRun();
  const r = await runAndCount(5, 40000);
  await quitFromPause();
  const after = await save();
  ck("a run adds to the existing bank", after.bank === 3500 + r, `3500 + ${r} = ${3500 + r}, bank ${after.bank}`);
  ck("and to the existing lifetime total", after.totalCoins === 12000 + r, `${after.totalCoins}`);
  ck("spending history is preserved (bank stays below total)", after.bank < after.totalCoins,
    `bank ${after.bank} < total ${after.totalCoins}`);
  ck("purchases still intact after a run", after.unlocked.length === 3, after.unlocked.join(","));
}

// now start clean for the rest of the sequence
await page.evaluate((k) => localStorage.removeItem(k), KEY);
await page.reload({ waitUntil: "domcontentloaded" });
await openGame();

console.log("\n1 — a fresh profile starts at zero");
const start = await menuBalance();
ck("menu shows 0 to spend", start === 0, `${start}`);

console.log("\n2 — run, collect, quit from the pause card");
await startRun();
const run1 = await runAndCount(10);
ck("collected at least 10 coins", run1 >= 10, `${run1} coins`);
await quitFromPause();
const menu1 = await menuBalance();
ck("menu balance went up by exactly the run's coins", menu1 === start + run1, `${start} + ${run1} = ${start + run1}, menu shows ${menu1}`);
const save1 = await save();
ck("saved bank matches the menu", save1.bank === menu1, `bank ${save1.bank}`);
ck("lifetime total also recorded", save1.totalCoins === run1, `totalCoins ${save1.totalCoins}`);

console.log("\n3 — a second run adds to the old balance");
await page.locator(".krushPrimary", { hasText: "Start running" }).click();
await pause();
const midRun = await coinsNow();
ck("the new run starts its own counter at 0", midRun === 0, `${midRun}`);
await resume();
const run2 = await runAndCount(10);
ck("collected again", run2 >= 10, `${run2} coins`);
await quitFromPause();
const menu2 = await menuBalance();
ck("second run added on top, not replaced", menu2 === menu1 + run2, `${menu1} + ${run2} = ${menu1 + run2}, menu shows ${menu2}`);

console.log("\n4 — refreshing keeps it");
await page.reload({ waitUntil: "domcontentloaded" });
await openGame();
const menu3 = await menuBalance();
ck("balance survives a page refresh", menu3 === menu2, `${menu2} -> ${menu3}`);

console.log("\n5 — the shop sees the same balance");
await page.locator(".krushPicked").click();
await page.waitForSelector(".krushCard--shop");
const shopTxt = await page.locator(".krushBank strong").innerText();
const shopBal = Number(shopTxt.replace(/[^0-9]/g, ""));
ck("shop shows the same number as the menu", shopBal === menu3, `menu ${menu3}, shop ${shopBal}`);
await page.locator(".krushGhost", { hasText: "Back" }).click();
await page.waitForTimeout(300);

console.log("\n6 — dying banks once, and going back to the menu does not bank again");
await startRun();
const run3 = await collect(6, 45000);
// crash on purpose: stand still in one lane until something hits
const t0 = Date.now();
while (Date.now() - t0 < 60000) {
  const s = await page.evaluate(() => { const g = window.__rush?.game?.current; return g ? { p: g.phase, c: g.coins } : null; });
  if (!s || s.p !== "running") break;
  await page.waitForTimeout(60);
}
const died = await page.evaluate(() => { const g = window.__rush.game.current; return { phase: g.phase, coins: g.coins }; });
ck("the run ended", died.phase !== "running", died.phase);
await page.waitForSelector(".krushCard .krushScore", { timeout: 10000 });
const afterDeath = await save();
ck("death banked the run once", afterDeath.bank === menu3 + died.coins, `${menu3} + ${died.coins} = ${menu3 + died.coins}, bank ${afterDeath.bank}`);
await page.locator(".krushGhost", { hasText: "Back to menu" }).click();
await page.waitForTimeout(600);
const afterBack = await save();
ck("returning to the menu did NOT bank a second time", afterBack.bank === afterDeath.bank, `${afterDeath.bank} -> ${afterBack.bank}`);
const menu4 = await menuBalance();
ck("menu agrees with the save", menu4 === afterBack.bank, `menu ${menu4}, save ${afterBack.bank}`);

console.log("\n7 — closing the game mid-run does not lose the coins");
await startRun();
const run4 = await runAndCount(8, 45000);
await page.locator(".gameCard", { hasText: "Endless Rush" }).getByRole("button", { name: /Close game/i }).click();
await page.waitForTimeout(800);
const afterClose = await save();
ck("coins banked when the game was closed", afterClose.bank === afterBack.bank + run4,
  `${afterBack.bank} + ${run4} = ${afterBack.bank + run4}, bank ${afterClose.bank}`);

console.log("\n8 — nothing else was disturbed");
const fin = await save();
ck("unlocked characters intact", Array.isArray(fin.unlocked) && fin.unlocked.includes("runner"), (fin.unlocked||[]).join(","));
ck("selected character intact", !!fin.selected, fin.selected);
ck("settings intact", fin.settings && typeof fin.settings.muted === "boolean");
ck("runs counted", fin.runs >= 4, `${fin.runs} runs`);
ck("bank never exceeds lifetime total", fin.bank <= fin.totalCoins, `bank ${fin.bank} <= total ${fin.totalCoins}`);
ck("no console errors", errs.length === 0, errs.slice(0, 2).join(" / "));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) console.log("failed:", bad.join(", "));
process.exit(fail ? 1 : 0);
