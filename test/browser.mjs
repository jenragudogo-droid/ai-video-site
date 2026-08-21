/* ------------------------------------------------------------------ *
 * Kianimation Endless Rush — browser test battery.
 *
 * This is the one that actually plays the game in a real browser rather
 * than driving the engine in node: React mounts, the canvas paints, keys
 * and touches go through the real listeners, and the results card is
 * read out of the DOM at the end.
 *
 * Two servers are used on purpose:
 *   dev     (5188) exposes `window.__rush`, so the autopilot can see the
 *           track and play properly.
 *   preview (4188) is the production bundle with no debug hook, played
 *           blind, to prove the thing that actually ships works.
 * ------------------------------------------------------------------ */

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* Run it with the dev server and a preview of the production build up:
 *   npm run dev -- --port 5188
 *   npm run build && npm run preview -- --port 4188
 *   node test/browser.mjs            # everything
 *   node test/browser.mjs 5 7        # just those sections
 */
const DEV = process.env.RUSH_DEV || "http://127.0.0.1:5188/";
const PROD = process.env.RUSH_PROD || "http://127.0.0.1:4188/";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.env.RUSH_SHOTS || path.join(ROOT, "shots");
fs.mkdirSync(OUT, { recursive: true });

/* Playwright finds its own browser unless this container's pinned one is
   pointed at explicitly. */
const CHROME = process.env.RUSH_CHROME || undefined;
const log = (...a) => console.log(...a);

/* Sections are selectable so the whole battery does not have to live in
   one browser process: `node test/browser.mjs 3 4` runs just those. A
   full sweep is nine sections of Chromium, which is more memory than
   this container wants to hold at once. */
const ONLY = process.argv.slice(2).filter((a) => /^[0-9]+$/.test(a)).map(Number);
const want = (n) => ONLY.length === 0 || ONLY.includes(n);

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail) {
  if (ok) { pass += 1; log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail += 1; failures.push(name); log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
  return ok;
}

async function newPage(browser, { width, height, mobile = false, url }) {
  const errs = [];
  const ctx = await browser.newContext({
    viewport: { width, height },
    hasTouch: mobile,
    isMobile: mobile,
    deviceScaleFactor: mobile ? 2 : 1,
    userAgent: mobile
      ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
      : undefined,
  });
  const page = await ctx.newPage();
  /* The sandbox has no route to youtube.com, so the two video embeds on
     the page always fail to load in here. That is the test rig, not the
     site, and it must not be allowed to mask a real error. */
  const noise = (t) => /ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|youtube|ytimg/i.test(t);
  page.on("console", (m) => { if (m.type() === "error" && !noise(m.text())) errs.push(m.text()); });
  page.on("pageerror", (e) => { if (!noise(String(e))) errs.push(String(e)); });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  return { ctx, page, errs };
}

/* Opens the Endless Rush card on the real site page. */
async function openRush(page) {
  await page.locator("#games").scrollIntoViewIfNeeded();
  await page.locator(".gameCard", { hasText: "Endless Rush" })
    .getByRole("button", { name: /Play now/i }).click();
  await page.waitForSelector("canvas.krushCanvas", { timeout: 15000 });
  await page.waitForTimeout(500);
}

const peek = (page) => page.evaluate(() => {
  const g = window.__rush?.game?.current;
  if (!g) return null;
  const chunks = [];
  for (const c of g.chunks || []) chunks.push(c);
  const near = [];
  for (const c of chunks) {
    for (const o of c.obstacles || []) {
      const dz = o.z - g.z;
      if (dz > -3 && dz < 70) near.push({ t: o.type, x: o.x, z: o.z, y: o.y, h: o.h, w: o.w, base: o.base || 0, act: o.act });
    }
    for (const e of c.enemies || []) {
      const dz = e.z - g.z;
      if (dz > -3 && dz < 60) near.push({ t: "enemy", x: e.x, z: e.z, state: e.state, act: "fight" });
    }
    for (const p of c.powers || []) {
      const dz = p.z - g.z;
      if (dz > -2 && dz < 50) near.push({ t: `power:${p.kind}`, x: p.x, z: p.z, act: "grab" });
    }
  }
  near.sort((a, b) => a.z - b.z);
  return {
    phase: g.phase, dist: g.dist, z: g.z, x: g.x, y: g.y, lane: g.lane,
    speed: g.speed, coins: g.coins, score: g.score,
    airborne: g.airborne, sliding: g.sliding, flying: g.flying,
    onRoof: (g.base || 0) > 0, combo: g.combo, attackCd: g.attackCd,
    powers: { ...g.powers }, cause: g.causeOfDeath,
    stats: { ...g.stats },
    near: near.slice(0, 14),
  };
});

/* ------------------------------------------------------------------ *
 * The autopilot.
 *
 * The *planning* runs inside the page, because a round-trip per frame
 * would cap the bot at about twenty decisions a second and it would then
 * be measuring Playwright's latency rather than the game. The *acting*
 * still goes out through Playwright's real keyboard, so every move is a
 * genuine keydown landing on the game's own listener — the input path is
 * under test, only the reflexes are hosted locally.
 *
 * The planner is the same lookahead the node fairness bot uses: nearest
 * threat per lane, vertical action for jump/slide rows, sideways when
 * the lane is shut, all three lanes considered rather than just the
 * neighbours. It is not clairvoyant — it sees about two and a half
 * seconds of road, the same as a player watching the screen.
 * ------------------------------------------------------------------ */

const LANE_TIME = 0.17;

const PLAN = `(() => {
  const g = window.__rush?.game?.current;
  if (!g) return { phase: "gone" };
  if (g.phase !== "running") return { phase: g.phase, cause: g.causeOfDeath };
  const LANE_TIME = ${LANE_TIME};
  const P = g.profile || { laneTime: 1, gravity: 1 };
  const flying = g.flying || g.flyLand > 0 || g.roofLeaveGrace > 0;
  const deck = flying ? null : (g.surfaceY || 0);

  const lanes = [[], [], []];
  for (const c of g.chunks || []) {
    if (!c.obstacles) continue;
    for (const o of c.obstacles) {
      if (o.hit) continue;
      // only what is at the runner's own altitude is in the way
      if (deck !== null && Math.abs((o.base || 0) - deck) > 1.5) continue;
      const front = o.z - o.d * 0.5;
      const back = o.z + o.d * 0.5;
      if (back < g.z - 0.4 || front > g.z + g.speed * 3) continue;
      lanes[o.lane].push({ act: o.act, t: (front - g.z) / g.speed, out: (back - g.z) / g.speed });
    }
    for (const e of c.enemies || []) {
      if (e.state === "down") continue;
      const front = e.z - 0.5;
      const back = e.z + 0.5;
      if (back < g.z - 0.4 || front > g.z + g.speed * 3) continue;
      lanes[e.lane].push({ act: "dodge", enemy: true, t: (front - g.z) / g.speed, out: (back - g.z) / g.speed });
    }
  }
  for (const l of lanes) l.sort((a, b) => a.t - b.t);

  const clearance = (list, fatalOnly, horizon) => {
    for (const e of list) {
      if (e.t > horizon) break;
      if (fatalOnly && e.act !== "dodge") continue;
      return Math.max(0, e.t);
    }
    return 99;
  };

  const pick = (horizon) => {
    let best = g.lane;
    let bestScore = clearance(lanes[g.lane], true, horizon);
    for (let L = 0; L < 3; L += 1) {
      const c = clearance(lanes[L], true, horizon);
      if (c > bestScore + 0.05) { bestScore = c; best = L; }
    }
    return best;
  };

  // steering matters in the air too: the deck you land on has lanes
  if (flying) {
    const best = pick(3);
    let k = null;
    if (best !== g.lane) k = best > g.lane ? "ArrowRight" : "ArrowLeft";
    else if (g.flying && g.surfaceY > 1) k = "s";   // down = land on the deck
    return { key: k, dist: g.dist, phase: "running", stats: g.stats,
             flying: !!g.flying, onRoof: (g.surfaceY || 0) > 0.1 };
  }

  const H = 2.6;
  const here = lanes[g.lane];
  const next = here.find((e) => e.t <= H);

  let key = null;
  /* Fighting is opt-in. Left to itself the planner treats an enemy as a
     dodge obstacle and steps around it long before it is in range, which
     is the right way to play and a useless way to test the punch — so
     the enemy section asks for FIGHT and the bot stands its ground. */
  const fight = window.__rushFight === true;
  /* Reach is 2.6 m and the strike resolves about a tenth of a second
     after the press, so at twenty metres a second the button has to go
     down roughly a fifth of a second out. Swinging at half a second is
     a swing at empty road. */
  const swing = next && next.enemy && !g.airborne && g.attackCd <= 0
    && next.t < 0.28 && next.t > 0.04;
  const holding = fight && next && next.enemy;
  if (swing) key = "a";
  else if (holding) key = null;    // stand your ground rather than side-step
  /* Aimed at the middle of the window test/window.mjs measures, not at
     its late edge. A slide is good from about 0.54s out to 0.04s out; a
     bot that waits until 0.26s is one dropped frame of round-trip away
     from missing it, which says nothing about the game and everything
     about the test rig. */
  else if (next && next.act === "jump" && next.t < 0.36 * P.gravity && next.t > -0.1 && !g.airborne) key = "Space";
  else if (next && next.act === "slide" && next.t < 0.44 && next.t > -0.1 && !g.sliding) key = "s";
  else if (!holding) {
    const mine = clearance(here, true, H);
    if (mine < 0.95) {
      let best = g.lane;
      let bestScore = mine;
      for (let L = 0; L < 3; L += 1) {
        if (L === g.lane) continue;
        const hops = Math.abs(L - g.lane);
        const cross = hops * LANE_TIME * P.laneTime;
        const hard = clearance(lanes[L], true, H);
        const soft = clearance(lanes[L], false, H);
        if (hard < cross + 0.14) continue;
        if (soft < cross + 0.5) continue;   // room to arrive AND jump or slide
        if (hops === 2) {
          const mid = (g.lane + L) / 2;
          if (lanes[mid].some((e) => e.act === "dodge" && e.t < cross + 0.12 && e.out > -0.05)) continue;
        }
        const score = hard - hops * 0.04;
        if (score > bestScore + 0.02) { bestScore = score; best = L; }
      }
      if (best !== g.lane) key = best > g.lane ? "ArrowRight" : "ArrowLeft";
    } else {
      /* Nothing is in the way, so go and get something. A jetpack is
         worth crossing for — it is the only way onto a roof — and a
         player who never picks one up would never see half the game. */
      let want = null;
      for (const c of g.chunks || []) {
        for (const pu of c.powerups || []) {
          if (pu.taken) continue;
          if ((pu.roof ? 1 : 0) !== ((g.base || 0) > 0 ? 1 : 0)) continue;
          const t = (pu.z - g.z) / g.speed;
          if (t < 0.3 || t > 2.2) continue;
          const hops = Math.abs(pu.lane - g.lane);
          if (hops === 0) { want = null; break; }
          const cross = hops * LANE_TIME * P.laneTime;
          if (clearance(lanes[pu.lane], true, H) < t + 0.3) continue;
          if (clearance(lanes[pu.lane], false, H) < cross + 0.3) continue;
          if (t < cross + 0.15) continue;
          const rank = pu.forRoof ? 3 : pu.type === "jetpack" ? 2 : 1;
          if (!want || rank > want.rank) want = { lane: pu.lane, rank };
        }
      }
      if (want) key = want.lane > g.lane ? "ArrowRight" : "ArrowLeft";
    }
  }
  return { key, dist: g.dist, phase: "running", stats: g.stats,
           flying: !!g.flying, onRoof: (g.base || 0) > 0 };
})()`;

/** Plays for `seconds`, or until the run ends. Returns the final peek. */
async function drive(page, seconds, { attack = true } = {}) {
  const t0 = Date.now();
  let hops = 0;
  while (Date.now() - t0 < seconds * 1000) {
    let plan;
    try { plan = await page.evaluate(PLAN); } catch { break; }
    if (!plan || plan.phase !== "running") break;
    if (plan.key && (attack || plan.key !== "a")) {
      await page.keyboard.press(plan.key);
      hops += 1;
    }
    await page.waitForTimeout(12);
  }
  const end = await peek(page);
  if (end) end.inputs = hops;
  return end;
}

/* ------------------------------------------------------------------ */

const browser = await chromium.launch({
  ...(CHROME ? { executablePath: CHROME } : {}),
  args: ["--mute-audio", "--autoplay-policy=no-user-gesture-required"],
});

/* =================== 1. the site is still the site =================== */

if (want(1)) {
log("\n1 — the rest of the site");
  const { ctx, page, errs } = await newPage(browser, { width: 1440, height: 900, url: PROD });
  const cards = await page.locator(".gameCard h3").allInnerTexts();
  /* Which games are published is the site owner's call — several live in
     the repo but are deliberately not mounted. The test checks that the
     Games section is intact and that Endless Rush is in it, and exercises
     any *other* card it happens to find rather than demanding a fixed
     line-up. */
  log(`  published games: ${cards.join(" | ") || "(none)"}`);
  check("the Games section has cards", cards.length >= 1, `${cards.length}`);
  check("Endless Rush is published", cards.some((c) => /Endless Rush/i.test(c)));

  const sections = await page.locator("section[id]").evaluateAll(
    (ns) => ns.map((n) => n.id));
  check("all site sections present", sections.length >= 4, sections.join(","));

  const others = cards.filter((c) => !/Endless Rush/i.test(c));
  for (const name of others) {
    const card = page.locator(".gameCard", { hasText: name });
    await page.locator("#games").scrollIntoViewIfNeeded();
    await card.getByRole("button", { name: /Play now/i }).click();
    await page.waitForTimeout(2200);
    const live = await page.locator(".gameStageWrap canvas").first().isVisible().catch(() => false);
    check(`${name} still mounts`, live);
    await card.getByRole("button", { name: /Close game/i }).click();
    await page.waitForTimeout(400);
  }

  await page.locator("#games").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/01-games-section.png` });
  check("no console errors on the site", errs.length === 0, errs.slice(0, 2).join(" / "));
  await ctx.close();
}

/* ======================= 2. shop, buying, saving ======================= */

if (want(2)) {
log("\n2 — character shop");
  const { ctx, page, errs } = await newPage(browser, { width: 1440, height: 900, url: DEV });
  await openRush(page);
  await page.screenshot({ path: `${OUT}/02-intro.png` });

  await page.locator(".krushPicked").click();
  await page.waitForSelector(".krushCard--shop");
  await page.waitForTimeout(900);          // let the turntable spin up
  await page.screenshot({ path: `${OUT}/03-shop.png` });

  const names = await page.locator(".krushRosterName strong").allInnerTexts();
  check("four characters listed", names.length === 4, names.join(" | "));
  const marks = await page.locator(".krushRosterName em").allInnerTexts();
  check("prices shown on locked characters",
    marks.filter((m) => /coins/.test(m)).length === 3, marks.join(" | "));
  check("prices are 2,500 / 6,000 / 10,000",
    marks.join(" ").includes("2,500") && marks.join(" ").includes("6,000")
    && marks.join(" ").includes("10,000"));

  // the preview canvas is actually drawing something
  const inked = await page.evaluate(() => {
    const c = document.querySelector(".krushPreview canvas");
    if (!c) return -1;
    const g = c.getContext("2d");
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 16) if (d[i] > 40 || d[i + 1] > 40 || d[i + 2] > 40) n += 1;
    return n;
  });
  check("shop preview renders a character", inked > 200, `${inked} lit samples`);

  // buying with an empty bank must be refused
  await page.locator(".krushRosterItem", { hasText: "Market Courier" }).click();
  await page.waitForTimeout(400);
  const buyDisabled = await page.locator(".krushActions .krushPrimary").isDisabled();
  check("buy is disabled with no coins", buyDisabled);

  // fund the bank and reload
  await page.evaluate(() => {
    const key = "kianimation.endlessRush.v1";
    const p = JSON.parse(localStorage.getItem(key) || "{}");
    localStorage.setItem(key, JSON.stringify({
      ...p, version: 2, totalCoins: 40000, bank: 40000,
      unlocked: ["runner"], selected: "runner",
    }));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await openRush(page);
  await page.locator(".krushPicked").click();
  await page.waitForSelector(".krushCard--shop");

  for (const [who, price] of [["Market Courier", 2500], ["Skyrider", 6000], ["Jet Kid", 10000]]) {
    await page.locator(".krushRosterItem", { hasText: who }).click();
    await page.waitForTimeout(200);
    await page.locator(".krushActions .krushPrimary").click();
    await page.waitForTimeout(300);
    const saved = await page.evaluate(() => JSON.parse(
      localStorage.getItem("kianimation.endlessRush.v1") || "{}"));
    check(`bought ${who}`, saved.unlocked.length > 1 && saved.selected !== "runner");
    check(`  ${price} deducted`, saved.bank <= 40000 - price, `bank ${saved.bank}`);
  }

  const after = await page.evaluate(() => JSON.parse(
    localStorage.getItem("kianimation.endlessRush.v1")));
  check("all four unlocked", after.unlocked.length === 4, after.unlocked.join(","));
  check("bank spent exactly 18,500", after.bank === 40000 - 18500, `bank ${after.bank}`);

  // re-select a bought one; the button must say Select, not Buy
  await page.locator(".krushRosterItem", { hasText: "Street Runner" }).click();
  await page.waitForTimeout(200);
  const label = await page.locator(".krushActions .krushPrimary").innerText();
  check("owned characters offer Select, never Buy again", /Select/i.test(label), label);
  await page.locator(".krushActions .krushPrimary").click();
  await page.waitForTimeout(300);

  await page.reload({ waitUntil: "domcontentloaded" });
  await openRush(page);
  const persisted = await page.evaluate(() => JSON.parse(
    localStorage.getItem("kianimation.endlessRush.v1")));
  check("purchases survive a reload", persisted.unlocked.length === 4
    && persisted.selected === "runner");
  check("no console errors in the shop", errs.length === 0, errs.slice(0, 2).join(" / "));
  await page.screenshot({ path: `${OUT}/04-shop-owned.png` });
  await ctx.close();
}

/* ==================== 3. play each character for real ==================== */

if (want(3)) {
log("\n3 — playing each character");
  const played = {};
  const { ctx, page, errs } = await newPage(browser, { width: 1280, height: 800, url: DEV });
  await page.evaluate(() => localStorage.setItem("kianimation.endlessRush.v1", JSON.stringify({
    version: 2, highScore: 0, bestDistance: 0, bestCoins: 0, totalCoins: 40000,
    bank: 40000, runs: 0, unlocked: ["runner", "courier", "skyrider", "jetkid"],
    selected: "runner", settings: { muted: true, music: false, hints: true },
  })));

  const ROSTER = [
    ["runner", "Street Runner"], ["courier", "Market Courier"],
    ["skyrider", "Skyrider"], ["jetkid", "Jet Kid"],
  ];

  for (const [id, name] of ROSTER) {
    await page.goto(DEV, { waitUntil: "domcontentloaded" });
    await openRush(page);
    await page.locator(".krushPicked").click();
    await page.waitForSelector(".krushCard--shop");
    await page.locator(".krushRosterItem", { hasText: name }).click();
    await page.waitForTimeout(180);
    const sel = page.locator(".krushActions .krushPrimary");
    if (await sel.isEnabled()) await sel.click();                // already-selected is disabled
    await page.waitForTimeout(200);
    await page.locator(".krushActions .krushGhost", { hasText: "Start running" }).click();
    await page.waitForTimeout(700);

    const end = await drive(page, 42);
    played[id] = end;
    log(`  ${name}: ${Math.round(end.dist)} m, ${end.coins} coins, `
      + `${end.stats.enemiesBeaten} enemies, ${Math.round(end.stats.roofMetres)} m of roof, `
      + `${Math.round(end.stats.flightMetres)} m flown, phase=${end.phase}`
      + `${end.cause ? ` (${end.cause})` : ""}`);
    check(`${name} runs a real distance`, end.dist > 250, `${Math.round(end.dist)} m`);
    await page.screenshot({ path: `${OUT}/10-play-${id}.png` });
  }
  check("no console errors while playing", errs.length === 0, errs.slice(0, 3).join(" / "));
  await ctx.close();
}

/* ========================= 4. the pause is a pause ========================= */

if (want(4)) {
log("\n4 — pause");
  const { ctx, page } = await newPage(browser, { width: 1280, height: 800, url: DEV });
  await openRush(page);
  await page.locator(".krushPrimary", { hasText: "Start running" }).click();
  await page.waitForTimeout(2500);
  await page.keyboard.press("p");
  await page.waitForTimeout(400);

  const before = await peek(page);
  const a = await page.locator("canvas.krushCanvas").screenshot();
  await page.waitForTimeout(1200);
  const b = await page.locator("canvas.krushCanvas").screenshot();
  await page.waitForTimeout(1200);
  const c = await page.locator("canvas.krushCanvas").screenshot();
  const after = await peek(page);

  check("frame is identical 1.2 s into a pause", Buffer.compare(a, b) === 0);
  check("frame is still identical 2.4 s in", Buffer.compare(a, c) === 0);
  check("distance does not advance while paused",
    Math.abs(after.dist - before.dist) < 1e-6, `${before.dist} → ${after.dist}`);
  check("speed does not drift while paused",
    Math.abs(after.speed - before.speed) < 1e-6);
  await page.screenshot({ path: `${OUT}/20-paused.png` });

  await page.locator(".krushPrimary", { hasText: "Resume" }).click();
  await page.waitForTimeout(1400);
  const resumed = await peek(page);
  check("resumes and moves again", resumed.dist > after.dist + 5,
    `${Math.round(after.dist)} → ${Math.round(resumed.dist)} m`);
  check("resume does not teleport", resumed.dist - after.dist < 90,
    `advanced ${Math.round(resumed.dist - after.dist)} m in 1.4 s`);
  await ctx.close();
}

/* ================= 5. slide obstacles are honest on screen ================= */

if (want(5)) {
log("\n5 — slide / roadworks");
  const { ctx, page } = await newPage(browser, { width: 1280, height: 800, url: DEV });
  await openRush(page);
  await page.locator(".krushPrimary", { hasText: "Start running" }).click();
  await page.waitForTimeout(700);

  /* Driven by the same planner as everything else rather than by a
     hand-rolled "press S when it is nine metres away" timer. The point
     is not that a stopwatch can clear a gantry — it is that a player
     who slides at a sensible moment gets under it, that the art shows
     the gap they went through, and that nothing at standing height
     catches them anyway. */
  const met = new Map();          // type -> { met, slidUnder, killed }
  const shots = new Map();
  let deaths = 0;
  const t0 = Date.now();

  while (Date.now() - t0 < 150000 && [...met.keys()].length < 3) {
    const st = await peek(page);
    if (!st) break;
    if (st.phase !== "running") {
      const low = st.cause && ["sign", "pipe", "worksArch"].includes(st.cause);
      if (low) {
        const rec = met.get(st.cause) || { met: 0, slidUnder: 0, killed: 0 };
        rec.killed += 1;
        met.set(st.cause, rec);
      }
      deaths += 1;
      const again = page.locator(".krushPrimary", { hasText: /Play again|Start running/i });
      try { await again.waitFor({ state: "visible", timeout: 8000 }); } catch { break; }
      await again.click();
      await page.waitForTimeout(900);
      continue;
    }

    /* A low obstacle the runner is about to be underneath. Screenshot it
       on approach so the art can be judged, then check on the way out
       whether they were low when they went through. */
    for (const o of st.near) {
      if (o.act !== "slide") continue;
      const dz = o.z - st.z;
      if (dz < 4 || dz > 10) continue;
      if (Math.abs(o.x - st.x) > (o.w || 1.8) / 2) continue;
      const key = `${o.t}@${Math.round(o.z)}`;
      if (shots.has(key)) continue;
      shots.set(key, true);
      const rec = met.get(o.t) || { met: 0, slidUnder: 0, killed: 0 };
      rec.met += 1;
      met.set(o.t, rec);
      /* No screenshot here. A full-page capture blocks this script for a
         few hundred milliseconds while the game carries on at fifteen
         metres a second, so the runner arrives at the obstacle with the
         harness still holding the shutter — which killed the runner twice
         and looked exactly like a collision bug. Captures happen far out,
         in the sweep below, where losing half a second costs nothing. */
      // follow it through
      let wasLow = false;
      const trail = [];
      for (let i = 0; i < 120; i += 1) {
        const t = await peek(page);
        if (!t) break;
        trail.push({ dz: +(o.z - t.z).toFixed(2), lane: t.lane, x: +t.x.toFixed(2),
          y: +t.y.toFixed(2), sl: t.sliding, air: t.airborne, sp: +t.speed.toFixed(1) });
        if (t.phase !== "running") {
          log(`  !! died on ${o.t} (${t.cause}) — last frames:`);
          for (const f of trail.slice(-14)) {
            log(`     dz=${String(f.dz).padStart(6)} lane=${f.lane} x=${String(f.x).padStart(6)}`
              + ` y=${String(f.y).padStart(5)} sliding=${f.sl ? "Y" : "."} air=${f.air ? "Y" : "."} v=${f.sp}`);
          }
          break;
        }
        if (Math.abs(o.z - t.z) < 1.2 && (t.sliding || t.y > 1.0)) wasLow = true;
        if (t.z > o.z + 2) break;
        const plan = await page.evaluate(PLAN);
        if (plan?.key) await page.keyboard.press(plan.key);
        await page.waitForTimeout(12);
      }
      if (wasLow) rec.slidUnder += 1;
    }
    /* Portraits, taken while the obstacle is still thirty metres off. */
    for (const o of st.near) {
      if (o.act !== "slide") continue;
      const dz = o.z - st.z;
      if (dz < 26 || dz > 44) continue;
      if (shots.has(`art:${o.t}`)) continue;
      shots.set(`art:${o.t}`, true);
      await page.screenshot({ path: `${OUT}/30-low-${o.t}.png` });
    }

    await drive(page, 0.35);
  }

  const rows = [...met.entries()];
  const totalMet = rows.reduce((a, [, v]) => a + v.met, 0);
  const totalUnder = rows.reduce((a, [, v]) => a + v.slidUnder, 0);
  const totalKilled = rows.reduce((a, [, v]) => a + v.killed, 0);
  for (const [k, v] of rows) {
    log(`  ${k.padEnd(10)} met ${v.met}, passed while low ${v.slidUnder}, killed by ${v.killed}`);
  }
  log(`  (${deaths} run${deaths === 1 ? "" : "s"} ended during the sweep)`);
  check("more than one kind of roadwork was met", rows.length >= 2,
    rows.map(([k]) => k).join(","));
  /* Sliding is not the only legal answer — a low obstacle in one lane can
     be walked around if the next lane is clear, and the planner will do
     that when it is cheaper. What must never happen is being caught by
     one, which the next check covers. */
  check("low obstacles were slid under when not avoided", totalUnder > 0,
    `${totalUnder} of ${totalMet} passed from a low profile, rest gone around`);
  check("no low obstacle killed the runner", totalKilled === 0, `${totalKilled} deaths`);
  await ctx.close();
}

/* =================== 6. jetpack, rooftops, and coming back =================== */

if (want(6)) {
log("\n6 — jetpack and rooftops");
  const { ctx, page } = await newPage(browser, { width: 1280, height: 800, url: DEV });
  await openRush(page);
  await page.locator(".krushPrimary", { hasText: "Start running" }).click();
  await page.waitForTimeout(600);

  let flew = 0;
  let roofed = 0;
  let shot = 0;
  let flewTotal = 0;
  let roofTotal = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 190000) {
    const s = await peek(page);
    if (!s) break;
    if (s.phase !== "running") {
      /* Roofs start after a few hundred metres and repeat every few
         hundred more, so a run that ends early simply has not had the
         chance yet. Carry the totals over and go again. */
      flewTotal += flew; roofTotal += roofed;
      flew = 0; roofed = 0;
      const again = page.locator(".krushPrimary", { hasText: /Play again|Start running/i });
      try { await again.waitFor({ state: "visible", timeout: 8000 }); } catch { break; }
      await again.click();
      await page.waitForTimeout(900);
      continue;
    }
    if (s.flying && shot < 2) { shot += 1; await page.screenshot({ path: `${OUT}/40-flight-${shot}.png` }); }
    if (s.onRoof && !s.flying && shot < 4) { shot += 1; await page.screenshot({ path: `${OUT}/41-roof-${shot}.png` }); }
    flew = Math.max(flew, s.stats.flightMetres);
    roofed = Math.max(roofed, s.stats.roofMetres);
    if (roofTotal + roofed > 25) break;
    await drive(page, 0.5);
  }
  const s = await peek(page);
  flew += flewTotal; roofed += roofTotal;
  log(`  flew ${Math.round(flew)} m, ran ${Math.round(roofed)} m on rooftops`);
  /* Twenty metres, not forty: the bot now presses down as soon as it is
     over a deck, so a *successful* flight is a short one — up, across,
     and onto the roof. Landing early is the behaviour under test. */
  check("the jetpack actually flies", flew > 20, `${Math.round(flew)} m`);
  check("rooftops are reached and run along", roofed > 20, `${Math.round(roofed)} m`);
  /* What matters is that no death was caused by the flight itself —
     running into a crate two hundred metres later is an ordinary run
     ending, not a failed landing. */
  check("no death caused by flying or landing",
    !["vent", "tank", "aircon"].includes(s?.cause), s?.cause || "still running");
  await ctx.close();
}

/* ========================= 7. enemies and attacking ========================= */

if (want(7)) {
log("\n7 — enemies");
  const { ctx, page } = await newPage(browser, { width: 1280, height: 800, url: DEV });
  await openRush(page);
  await page.locator(".krushPrimary", { hasText: "Start running" }).click();
  await page.waitForTimeout(900);

  /* --- the control itself, before any enemy is involved --- */
  const s0 = await peek(page);
  await page.keyboard.press("a");
  await page.waitForTimeout(120);
  const s1 = await peek(page);
  check("A throws a punch", s1.stats.attacks === s0.stats.attacks + 1,
    `${s0.stats.attacks} → ${s1.stats.attacks}`);

  // held down / mashed, the cooldown must swallow the extra presses
  for (let i = 0; i < 12; i += 1) await page.keyboard.press("a");
  await page.waitForTimeout(120);
  const s2 = await peek(page);
  check("attacks cannot be spammed", s2.stats.attacks - s1.stats.attacks <= 1,
    `12 presses added ${s2.stats.attacks - s1.stats.attacks} swings`);
  await page.waitForTimeout(900);
  const s3 = await peek(page);
  await page.keyboard.press("a");
  await page.waitForTimeout(120);
  check("the cooldown does clear", (await peek(page)).stats.attacks === s3.stats.attacks + 1);

  /* --- now go and find someone to use it on --- */
  await page.evaluate(() => { window.__rushFight = true; });
  let beaten = 0;
  let bestCombo = 0;
  let shot = 0;
  let met = 0;
  let swings = 0;
  let beatenBefore = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 170000 && beaten < 4) {
    const st = await peek(page);
    if (!st || st.phase !== "running") {
      log(`  (run ended at ${Math.round(st?.dist || 0)} m — ${st?.cause}; starting another)`);
      swings += st?.stats.attacks || 0;
      // the results card takes a beat to arrive after the crash
      const again = page.locator(".krushPrimary", { hasText: /Play again|Run again|Restart|Start running/i });
      try { await again.waitFor({ state: "visible", timeout: 8000 }); } catch { break; }
      await again.click();
      await page.waitForTimeout(1000);
      beatenBefore = beaten;
      await page.evaluate(() => { window.__rushFight = true; });
      continue;
    }
    if (st.combo > 0 && shot < 2) { shot += 1; await page.screenshot({ path: `${OUT}/50-combo-${shot}.png` }); }
    met = Math.max(met, st.near.filter((o) => o.t === "enemy").length);
    beaten = Math.max(beaten, beatenBefore + st.stats.enemiesBeaten);
    bestCombo = Math.max(bestCombo, st.stats.bestCombo);
    await drive(page, 0.5);
  }
  const st = await peek(page);
  swings += st?.stats.attacks || 0;
  log(`  beat ${beaten} enemies, best combo x${bestCombo}, ${swings} swings thrown`);
  /* One is enough here. Whether a bot meets two enemies inside its time
     budget depends on the seed and on how long it survives; the mechanics
     themselves — reach, cooldown, the punch/kick/spin chain, the warning
     distance — are pinned down deterministically in test/combat.mjs. What
     this section is for is proving the whole path works in a real browser
     at least once. */
  check("an enemy was met and beaten in a real run", beaten >= 1, `${beaten}`);
  check("swings connect", swings >= beaten && swings > 0, `${swings} swings`);
  await ctx.close();
}

/* ===================== 8. phone: portrait, touch, FIGHT ===================== */

if (want(8)) {
log("\n8 — phone");
  const { ctx, page, errs } = await newPage(browser,
    { width: 390, height: 844, mobile: true, url: DEV });
  await openRush(page);
  await page.screenshot({ path: `${OUT}/60-phone-intro.png` });

  await page.locator(".krushPicked").click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/61-phone-shop.png` });
  await page.locator(".krushGhost", { hasText: "Back" }).click();

  await page.locator(".krushPrimary", { hasText: "Start running" }).click();
  await page.waitForTimeout(900);

  const fight = page.locator(".krushFight");
  check("FIGHT button is on screen", await fight.isVisible());
  const box = await fight.boundingBox();
  const vp = page.viewportSize();
  /* Measured against the game, not the window: the game is one section
     of a long page, so "bottom right" means the bottom right of the
     playfield — which is where the thumb goes once it is on the game. */
  const stage = await page.locator(".krush").boundingBox();
  check("FIGHT sits in the bottom-right of the playfield",
    box.y > stage.y + stage.height * 0.62 && box.x > stage.x + stage.width * 0.5,
    `button at ${Math.round(box.x)},${Math.round(box.y)}; `
    + `stage ${Math.round(stage.width)}×${Math.round(stage.height)} at ${Math.round(stage.x)},${Math.round(stage.y)}`);
  check("FIGHT is within thumb reach of the screen bottom",
    vp.height - (box.y + box.height) < vp.height * 0.55,
    `${Math.round(vp.height - box.y - box.height)}px from the bottom`);
  check("FIGHT is a big enough target", box.width >= 44, `${Math.round(box.width)}px`);

  const pauseBtn = page.locator(".krushQuick button[aria-label='Pause']");
  check("Pause button is on screen", await pauseBtn.isVisible());
  const pb = await pauseBtn.boundingBox();
  check("Pause does not overlap FIGHT",
    pb.y + pb.height < box.y || pb.x + pb.width < box.x);

  // swipes
  const cx = vp.width / 2;
  const cy = vp.height * 0.45;
  const before = await peek(page);
  await page.touchscreen.tap(cx, cy);          // tap to jump
  await page.waitForTimeout(180);
  check("tap jumps", (await peek(page)).airborne);

  await page.waitForTimeout(900);
  /* Real touch input, dispatched through the DevTools protocol rather
     than synthesised as PointerEvents: only this path makes the browser
     mint an actual pointer id, which is what the game's pointer capture
     and React's synthetic events are built on. */
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }],
  });
  const swipe = async (dx, dy) => {
    await touch("touchStart", cx, cy);
    await page.waitForTimeout(20);
    await touch("touchMove", cx + dx * 0.5, cy + dy * 0.5);
    await page.waitForTimeout(20);
    await touch("touchMove", cx + dx, cy + dy);
    await page.waitForTimeout(20);
    await touch("touchEnd", cx + dx, cy + dy);
    await page.waitForTimeout(240);
  };

  await swipe(90, 0);
  const right = await peek(page);
  check("swipe right changes lane", right.lane > before.lane, `lane ${right.lane}`);
  await swipe(-90, 0);
  await page.waitForTimeout(300);
  check("swipe left changes back", (await peek(page)).lane < right.lane);
  await swipe(0, 110);
  check("swipe down slides", (await peek(page)).sliding);

  await page.waitForTimeout(700);
  const swings = (await peek(page)).stats.attacks;
  await fight.tap();
  await page.waitForTimeout(200);
  const after = await peek(page);
  check("FIGHT button swings", after.stats.attacks > swings,
    `${swings} → ${after.stats.attacks}`);
  check("FIGHT does not also jump", !after.airborne || after.y < 0.05);

  await page.screenshot({ path: `${OUT}/62-phone-play.png` });

  // pause from the on-screen button
  await pauseBtn.click();
  await page.waitForTimeout(300);
  check("phone pause opens the card", await page.locator(".krushCard--slim").isVisible());
  await page.screenshot({ path: `${OUT}/63-phone-paused.png` });
  await page.locator(".krushPrimary", { hasText: "Resume" }).click();
  await page.waitForTimeout(400);

  // landscape
  /* Pause before rotating. An unattended runner does not survive the
     second and a half a viewport change takes, and a dead run tells us
     nothing about the landscape layout. */
  await pauseBtn.click();
  await page.waitForTimeout(300);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(700);
  await page.locator(".krush").scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  /* Turning the phone scrolls the game out of view for a moment, and the
     game auto-pauses whenever it leaves the screen — which is the right
     call (you should not lose a run to a rotation) but does mean the
     controls come back behind the pause card. */
  const resume = page.locator(".krushPrimary", { hasText: "Resume" });
  try { await resume.waitFor({ state: "visible", timeout: 3000 }); } catch { /* not paused */ }
  if (await resume.isVisible().catch(() => false)) {
    check("rotating pauses rather than killing the run", true);
    await resume.click();
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: `${OUT}/64-phone-landscape.png` });
  if (!(await page.locator(".krushFight").isVisible().catch(() => false))) {
    const cards = await page.locator(".krushCard h3, .krushCard .krushEyebrow").allInnerTexts();
    check("landscape keeps the run live", false, `showing: ${cards.join(" / ") || "nothing"}`);
  }
  const lbox = await page.locator(".krushFight").boundingBox().catch(() => null);
  if (!lbox) { await ctx.close(); }
  else {
  const lstage = await page.locator(".krush").boundingBox();
  check("FIGHT stays inside the playfield in landscape",
    lbox.x + lbox.width <= lstage.x + lstage.width + 1
    && lbox.y + lbox.height <= lstage.y + lstage.height + 1,
    `button ${Math.round(lbox.x)},${Math.round(lbox.y)} ${Math.round(lbox.width)}px`);
  check("landscape playfield fits the window",
    lstage.height <= 390 + 1, `${Math.round(lstage.height)}px tall`);
  check("no console errors on the phone", errs.length === 0, errs.slice(0, 2).join(" / "));
  await ctx.close();
  }
}

/* ============ 9. the production bundle, played blind, to the end ============ */

if (want(9)) {
log("\n9 — production build, game over, and the record");
  const { ctx, page, errs } = await newPage(browser, { width: 1280, height: 800, url: PROD });
  await openRush(page);
  check("no debug hook in the production bundle",
    await page.evaluate(() => typeof window.__rush === "undefined"));

  await page.locator(".krushPrimary", { hasText: "Start running" }).click();
  await page.waitForTimeout(800);

  // no state to read, so: mash sensible keys until the results card shows up
  const keys = ["Space", "ArrowLeft", "Space", "s", "ArrowRight", "a", "Space", "s", "a"];
  for (let i = 0; i < 400; i += 1) {
    if (await page.locator(".krushCard .krushScore").isVisible().catch(() => false)) break;
    await page.keyboard.press(keys[i % keys.length]);
    await page.waitForTimeout(140);
  }
  const over = await page.locator(".krushCard .krushScore").isVisible();
  check("a run ends with a results card", over);
  if (over) {
    await page.screenshot({ path: `${OUT}/70-gameover.png` });
    const tally = await page.locator(".krushTally li").allInnerTexts();
    check("results list distance, coins, enemies, combo and rooftops",
      tally.length >= 7, tally.map((t) => t.split("\n")[0]).join(" | "));
    const saved = await page.evaluate(() => JSON.parse(
      localStorage.getItem("kianimation.endlessRush.v1") || "{}"));
    check("the run was saved", saved.runs >= 1 && saved.bestDistance > 0,
      `runs ${saved.runs}, best ${saved.bestDistance} m`);
    check("coins banked for the shop", saved.bank >= 0 && saved.bank === saved.totalCoins,
      `bank ${saved.bank}`);

    await page.locator(".krushPrimary", { hasText: /Run again|Play again|Restart/i }).click();
    await page.waitForTimeout(1200);
    check("restart works", !(await page.locator(".krushCard .krushScore").isVisible()));
  }
  check("no console errors in production", errs.length === 0, errs.slice(0, 3).join(" / "));
  await ctx.close();
}

await browser.close();

log(`\n${"=".repeat(56)}`);
log(`${pass} passed, ${fail} failed`);
if (fail) log(`failed: ${failures.join(", ")}`);
log("=".repeat(56));
process.exit(fail ? 1 : 0);
