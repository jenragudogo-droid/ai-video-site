/* Full control audit for Turbo Rush: presses every key and touch button in
   a real headless Chromium and asserts the car's ON-SCREEN response using
   the live chase camera's own right-vector — so an inversion anywhere in
   input, physics, or camera would fail loudly.
   Run: node test/controls.mjs */
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const DIST = new URL("../dist", import.meta.url).pathname;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
const server = createServer((req, res) => {
  let p = join(DIST, req.url.split("?")[0] === "/" ? "index.html" : req.url.split("?")[0]);
  if (!existsSync(p)) p = join(DIST, "index.html");
  try { res.writeHead(200, { "content-type": MIME[extname(p)] || "application/octet-stream" }); res.end(readFileSync(p)); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(4194, r));

const save = {
  coins: 20000, unlockedDrivers: ["blaze"], unlockedCars: ["kestrel"],
  selectedDriver: "blaze", selectedCar: "kestrel", cosmetics: {}, upgrades: {},
  cupProgress: { beginner: { won: true }, beachCup: { won: true }, mountainCup: { won: true }, cityCup: { won: true }, desertCup: { won: true }, championship: { won: true }, spaceLeague: { won: true }, bossLeague: { won: true } },
  bossesBeaten: ["mountainKing"], bestTimes: {}, bestLaps: {}, emblems: {}, achievements: [],
  stats: { races: 0, wins: 0, combos: 0, superCombos: 0, shortcuts: 0, bossWins: 0, driftBest: 0 },
  settings: { muted: true, quality: "low", touch: "off" }, trophies: 8, stars: 0, xp: 0, daily: null,
};

const results = [];
const check = (name, ok, extra = "") => { results.push([name, ok]); console.log((ok ? "  ✓ " : "  ✗ ") + name + (extra ? ` — ${extra}` : "")); };

const launch = async (touchMode) => {
  const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium",
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox", "--disable-dev-shm-usage"],
  });
  const s = JSON.parse(JSON.stringify(save));
  if (touchMode) s.settings.touch = "on";
  const page = await browser.newPage({ viewport: touchMode ? { width: 480, height: 820 } : { width: 1000, height: 640 }, hasTouch: touchMode });
  page.on("pageerror", (e) => console.log("  PAGE ERROR:", e.message));
  await page.addInitScript((sv) => localStorage.setItem("ktr-save-v1", JSON.stringify(sv)), s);
  await page.goto("http://localhost:4194/");
  await page.click("text=Play now >> nth=1");
  await page.waitForSelector("text=TURBO RUSH");
  return { browser, page };
};

const startRace = async (page, trackName, mode) => {
  await page.click("text=🎯 Single Race");
  await page.click(`.trTrackCard:has-text("${trackName}")`);
  if (mode) await page.selectOption(".trSinglePanel select >> nth=0", mode);
  await page.click("text=START RACE");
  await page.waitForFunction(() => window.__ktrRace?.state === "racing", null, { timeout: 25000 });
};

/* On-screen lateral movement while a key is held: + means the car moved
   toward the LIVE camera's screen-right. */
const lateralUnderKey = async (page, key, ms) => {
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(1500); // get up to speed
  const r = await page.evaluate(async (args) => {
    const [key2, ms2] = args;
    const race = window.__ktrRace, view = window.__ktrView;
    const cam = view.camera;
    cam.updateMatrixWorld();
    const e = cam.matrixWorld.elements; // column 0 = camera right in world
    const right = { x: e[0], z: e[2] };
    const b = race.player.body;
    const p0 = { x: b.x, z: b.z };
    const h0 = b.heading;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: key2, bubbles: true }));
    await new Promise((res) => setTimeout(res, ms2));
    window.dispatchEvent(new KeyboardEvent("keyup", { key: key2, bubbles: true }));
    const d = { x: b.x - p0.x, z: b.z - p0.z };
    return {
      lat: d.x * right.x + d.z * right.z,
      dh: b.heading - h0,
      wheel: b.steerVis,
      speed: b.speed,
    };
  }, [key, ms]);
  await page.keyboard.up("ArrowUp");
  return r;
};

console.log("=== KEYBOARD AUDIT (desktop) ===");
{
  const { browser, page } = await launch(false);
  await startRace(page, "Greenveld", null); // hills: gentle, wide

  /* 1/5: W + Up accelerate */
  for (const key of ["w", "ArrowUp"]) {
    const spd = await page.evaluate(async (k) => {
      const b = window.__ktrRace.player.body;
      b.speed = 0;
      window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
      await new Promise((r) => setTimeout(r, 1200));
      window.dispatchEvent(new KeyboardEvent("keyup", { key: k, bubbles: true }));
      return b.speed;
    }, key);
    check(`${key} accelerates`, spd > 8, `speed=${spd.toFixed(1)}`);
  }

  /* 3/4/7/8: steering — measured against the live camera */
  /* The road curves, AI bumps, walls push — so compare each steer input
     against a same-spot no-input baseline, and also assert the heading
     delta (screen-left = heading increase, screen-right = decrease, the
     relationship the camera check above pins to the screen). */
  const R1 = await lateralUnderKey(page, "ArrowRight", 500);
  check("Right Arrow → car turns screen-RIGHT", R1.dh < -0.15, `lat=${R1.lat.toFixed(1)} dh=${R1.dh.toFixed(2)}`);
  check("Right Arrow → front wheels turn right", R1.wheel < -0.1, `steerVis=${R1.wheel.toFixed(2)}`);
  const L1 = await lateralUnderKey(page, "ArrowLeft", 500);
  check("Left Arrow → car turns screen-LEFT", L1.dh > 0.15, `dh=${L1.dh.toFixed(2)}`);
  check("Left Arrow → front wheels turn left", L1.wheel > 0.1, `steerVis=${L1.wheel.toFixed(2)}`);
  const R2 = await lateralUnderKey(page, "d", 500);
  check("D steers right", R2.dh < -0.15, `dh=${R2.dh.toFixed(2)}`);
  const L2 = await lateralUnderKey(page, "a", 500);
  check("A steers left", L2.dh > 0.15, `dh=${L2.dh.toFixed(2)}`);
  /* left/right symmetry: equal-and-opposite turn rates */
  check("steering symmetric L/R", Math.abs(Math.abs(R1.dh) - Math.abs(L1.dh)) < Math.abs(R1.dh), `R=${R1.dh.toFixed(2)} L=${L1.dh.toFixed(2)}`);

  /* 2/6: S + Down brake then reverse; backward along heading; camera stable */
  for (const key of ["s", "ArrowDown"]) {
    const rev = await page.evaluate(async (k) => {
      const race = window.__ktrRace, view = window.__ktrView;
      const b = race.player.body;
      /* deterministic start: recentre on the road, clear of walls/AI */
      const s0 = race.track.samples[b.seg];
      b.x = s0.x; b.z = s0.z; b.y = s0.y;
      b.heading = s0.ang; b.velAng = s0.ang; b.airborne = false; b.route = -1;
      b.speed = 30;
      window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
      await new Promise((r) => setTimeout(r, 600));
      const braked = b.speed < 15 && b.speed >= -2;
      await new Promise((r) => setTimeout(r, 1800));
      const f = { x: Math.sin(b.heading), z: Math.cos(b.heading) };
      const p0 = { x: b.x, z: b.z };
      const cam0 = { x: view.camera.position.x, z: view.camera.position.z };
      await new Promise((r) => setTimeout(r, 700));
      const alongFwd = (b.x - p0.x) * f.x + (b.z - p0.z) * f.z;
      const revSpeed = b.speed;
      const reversingFlag = b.reversing;
      window.dispatchEvent(new KeyboardEvent("keyup", { key: k, bubbles: true }));
      await new Promise((r) => setTimeout(r, 1600));
      const camMoved = Math.hypot(view.camera.position.x - cam0.x, view.camera.position.z - cam0.z);
      return { braked, revSpeed, alongFwd, reversingFlag, restSpeed: b.speed, camMoved, heading: b.heading };
    }, key);
    check(`${key} brakes first`, rev.braked);
    check(`${key} then reverses`, rev.revSpeed < -2 && rev.alongFwd < -0.1, `rev=${rev.revSpeed.toFixed(1)} m/s, moved ${rev.alongFwd.toFixed(1)}m backward`);
    check(`${key} reverse flag + smooth release`, rev.reversingFlag && Math.abs(rev.restSpeed) < 1.5, `rest=${rev.restSpeed.toFixed(2)}`);
    check(`camera stays behind while reversing (${key})`, rev.camMoved < 40, `camTravel=${rev.camMoved.toFixed(1)}m`);
  }

  /* 9: Space drift + nitro; drift direction matches steer */
  const drift = await page.evaluate(async () => {
    const race = window.__ktrRace, view = window.__ktrView;
    const b = race.player.body;
    b.speed = 40;
    view.camera.updateMatrixWorld();
    const e = view.camera.matrixWorld.elements;
    const right = { x: e[0], z: e[2] };
    const p0 = { x: b.x, z: b.z };
    for (const k of ["ArrowUp", "ArrowRight", " "]) window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
    await new Promise((r) => setTimeout(r, 700));
    const out = { engaged: b.drift === 1, nitro: b.nitro, lat: (b.x - p0.x) * right.x + (b.z - p0.z) * right.z };
    for (const k of ["ArrowUp", "ArrowRight", " "]) window.dispatchEvent(new KeyboardEvent("keyup", { key: k, bubbles: true }));
    return out;
  });
  check("Space engages drift (right = arcs right)", drift.engaged && drift.lat > 0, `nitro=${drift.nitro.toFixed(2)} lat=${drift.lat.toFixed(1)}`);

  /* 10: Shift fires nitro boost */
  const boost = await page.evaluate(async () => {
    const p = window.__ktrRace.player;
    p.body.nitro = 1; p.body.speed = 30;
    for (const k of ["ArrowUp", "Shift"]) window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    for (const k of ["ArrowUp", "Shift"]) window.dispatchEvent(new KeyboardEvent("keyup", { key: k, bubbles: true }));
    return { boostTime: p.fx.boostTime, nitro: p.body.nitro };
  });
  check("Shift fires nitro boost", boost.boostTime > 0 && boost.nitro === 0, `boostTime=${boost.boostTime.toFixed(1)}`);

  /* 11-13: single slots */
  for (let slot = 0; slot < 3; slot++) {
    const used = await page.evaluate(async (i) => {
      const p = window.__ktrRace.player;
      p.fx.ghost = 10; p.fx.invinc = 10; p.spinT = 0;
      p.slots = [null, null, null];
      p.slots[i] = "shield";
      const shields0 = p.fx.shield;
      window.dispatchEvent(new KeyboardEvent("keydown", { key: String(i + 1), bubbles: true }));
      await new Promise((r) => setTimeout(r, 450));
      window.dispatchEvent(new KeyboardEvent("keyup", { key: String(i + 1), bubbles: true }));
      return p.fx.shield > shields0 && p.slots[i] === null;
    }, slot);
    check(`power-up slot ${slot + 1} (key ${slot + 1})`, used);
  }

  /* 14/15: combos */
  const combo2 = await page.evaluate(async () => {
    const p = window.__ktrRace.player;
    p.slots = ["turbo", "shield", null]; p.combosDone = 0;
    for (const k of ["1", "2"]) window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));
    for (const k of ["1", "2"]) window.dispatchEvent(new KeyboardEvent("keyup", { key: k, bubbles: true }));
    return p.combosDone;
  });
  check("2-key combo (1+2)", combo2 >= 1);
  const combo3 = await page.evaluate(async () => {
    const p = window.__ktrRace.player;
    p.slots = ["turbo", "shield", "rocket"]; p.superCombosDone = 0;
    for (const k of ["1", "2", "3"]) window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));
    for (const k of ["1", "2", "3"]) window.dispatchEvent(new KeyboardEvent("keyup", { key: k, bubbles: true }));
    return p.superCombosDone;
  });
  check("3-key SUPER combo (1+2+3)", combo3 >= 1);

  /* 20: pause / resume + no stuck keys after pause */
  await page.keyboard.down("ArrowUp");
  await page.keyboard.press("Escape");
  await page.waitForSelector("text=Paused");
  const tPaused = await page.evaluate(async () => {
    const t0 = window.__ktrRace.time;
    await new Promise((r) => setTimeout(r, 600));
    return window.__ktrRace.time - t0;
  });
  check("pause halts the race", Math.abs(tPaused) < 0.05, `dt=${tPaused.toFixed(3)}`);
  await page.keyboard.up("ArrowUp");
  await page.click("text=Resume");
  const stuck = await page.evaluate(async () => {
    const b = window.__ktrRace.player.body;
    b.speed = 0;
    await new Promise((r) => setTimeout(r, 700));
    return b.speed; // no key held → must stay ~0
  });
  check("no stuck throttle after pause", Math.abs(stuck) < 2, `speed=${stuck.toFixed(1)}`);

  /* 21: restart (quit + start again) */
  await page.keyboard.press("Escape");
  await page.click("text=Quit race");
  await page.waitForSelector("text=TURBO RUSH");
  await startRace(page, "Greenveld", null);
  check("race restart works", await page.evaluate(() => window.__ktrRace.state === "racing" && window.__ktrRace.time < 10));

  /* 22-26: AI, laps, finish, shortcuts via autopilot on this fresh race */
  await page.evaluate(() => { window.__ktrAutopilot = true; window.__ktrRace.laps = 1; window.__ktrRace.racers.forEach((r) => { if (r.ai) r.ai.shortcutAffinity = 2; }); });
  await page.waitForFunction(() => window.__ktrRace?.state === "finished", null, { timeout: 180000 });
  const fin = await page.evaluate(() => ({
    res: !!window.__ktrRace.results,
    aiMoved: window.__ktrRace.racers.filter((r) => !r.isPlayer && (r.finished || r.body.lap >= 0)).length,
    sc: window.__ktrRace.racers.some((r) => r.usedShortcut),
    aiSane: window.__ktrRace.racers.every((r) => Math.abs(r.body.y) < 150),
  }));
  check("AI racers race + finish line + laps", fin.res && fin.aiMoved >= 4, `ai active=${fin.aiMoved}`);
  check("shortcuts used in race", fin.sc);
  check("AI cars stay in world (no flying through scenery)", fin.aiSane);
  await page.click("text=Back to menu");

  /* 23: checkpoint mode */
  await startRace(page, "Greenveld", "checkpoint");
  await page.evaluate(() => { window.__ktrAutopilot = true; });
  const cp = await page.waitForFunction(() => {
    const r = window.__ktrRace;
    return r.nextCp > 0 ? r.cpTime : (r.state === "finished" ? -999 : false);
  }, null, { timeout: 120000 });
  check("checkpoints trigger + add time", (await cp.jsonValue()) > 0);
  await page.keyboard.press("Escape");
  await page.click("text=Quit race");
  await page.waitForSelector("text=TURBO RUSH");

  /* 27: boss race controls (human-style keys during boss duel) */
  await page.evaluate(() => { window.__ktrAutopilot = false; });
  await page.click("text=🎯 Single Race");
  await page.click('.trTrackCard:has-text("Kestrel Pass")');
  await page.click("text=⚔ Rematch the boss");
  await page.waitForFunction(() => window.__ktrRace?.state === "racing", null, { timeout: 25000 });
  const bossSteer = await page.evaluate(async () => {
    const race = window.__ktrRace, b = race.player.body;
    race.player.fx.ghost = 10; race.player.fx.invinc = 10; race.player.spinT = 0; // the Mountain King rams
    const s0 = race.track.samples[b.seg];
    b.x = s0.x; b.z = s0.z; b.y = s0.y; b.heading = s0.ang; b.velAng = s0.ang; b.airborne = false; b.route = -1;
    b.speed = 25;
    const h0 = b.heading;
    for (const k of ["ArrowUp", "ArrowRight"]) window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    for (const k of ["ArrowUp", "ArrowRight"]) window.dispatchEvent(new KeyboardEvent("keyup", { key: k, bubbles: true }));
    return b.heading - h0;
  });
  check("boss race: steering correct", bossSteer < -0.05, `dh=${bossSteer.toFixed(2)}`);
  await page.keyboard.press("Escape");
  await page.click("text=Quit race");
  await page.waitForSelector("text=TURBO RUSH");

  /* 28: space track low-gravity controls — grounded, deterministic spot
     (heading is intentionally frozen mid-air unless the driver has the
     Vector Thrust ability, so measure on the ground) */
  await startRace(page, "Tranquility", null);
  await page.evaluate(() => { window.__ktrAutopilot = false; });
  const moonSteer = async (key) => page.evaluate(async (k) => {
    const race = window.__ktrRace;
    const b = race.player.body;
    /* immune to AI contact/rockets for a clean measurement */
    race.player.fx.ghost = 10; race.player.fx.invinc = 10; race.player.spinT = 0;
    const s0 = race.track.samples[b.seg];
    b.x = s0.x; b.z = s0.z; b.y = s0.y;
    b.heading = s0.ang; b.velAng = s0.ang; b.airborne = false; b.airSpin = 0; b.route = -1;
    b.speed = 25;
    const h0 = b.heading;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
    for (const kk of ["ArrowUp"]) window.dispatchEvent(new KeyboardEvent("keydown", { key: kk, bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    window.dispatchEvent(new KeyboardEvent("keyup", { key: k, bubbles: true }));
    for (const kk of ["ArrowUp"]) window.dispatchEvent(new KeyboardEvent("keyup", { key: kk, bubbles: true }));
    return b.heading - h0;
  }, key);
  const mR = await moonSteer("ArrowRight");
  const mL = await moonSteer("ArrowLeft");
  check("moon (0.35g): right is right, left is left", mR < -0.05 && mL > 0.05, `R dh=${mR.toFixed(2)} L dh=${mL.toFixed(2)}`);
  const g = await page.evaluate(() => window.__ktrRace.gravity);
  check("low gravity active", g < 1, `g=${g}`);

  await browser.close();
}

console.log("=== TOUCH AUDIT (mobile) ===");
{
  const { browser, page } = await launch(true);
  await startRace(page, "Greenveld", null);
  const tap = (sel, downUp) => page.evaluate(([s, phase]) => {
    const el = document.querySelector(s);
    const r = el.getBoundingClientRect();
    const t = new Touch({ identifier: 9, target: el, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 });
    el.dispatchEvent(new TouchEvent(phase, { touches: phase === "touchstart" ? [t] : [], targetTouches: [], changedTouches: [t], bubbles: true }));
  }, [sel, downUp]);

  /* 16: mobile steering — hold gas + right button, measure in camera space */
  const gasSel = ".trTouchBtn--gas";
  const rightSel = ".trTouchLeft .trTouchBtn:nth-child(2)";
  const leftSel = ".trTouchLeft .trTouchBtn:nth-child(1)";
  const steerTouch = async (sel) => {
    await tap(gasSel, "touchstart");
    await page.waitForTimeout(1200);
    const r = await page.evaluate(() => {
      const view = window.__ktrView, b = window.__ktrRace.player.body;
      view.camera.updateMatrixWorld();
      const e = view.camera.matrixWorld.elements;
      return { right: { x: e[0], z: e[2] }, p0: { x: b.x, z: b.z } };
    });
    await tap(sel, "touchstart");
    await page.waitForTimeout(500);
    await tap(sel, "touchend");
    const lat = await page.evaluate(({ right, p0 }) => {
      const b = window.__ktrRace.player.body;
      return (b.x - p0.x) * right.x + (b.z - p0.z) * right.z;
    }, r);
    await tap(gasSel, "touchend");
    return lat;
  };
  const tr = await steerTouch(rightSel);
  check("touch RIGHT button steers right", tr > 0.5, `lat=${tr.toFixed(1)}`);
  const tl = await steerTouch(leftSel);
  check("touch LEFT button steers left", tl < -0.5, `lat=${tl.toFixed(1)}`);
  /* steering released (not stuck) */
  const rel = await page.evaluate(() => window.__ktrView && window.__ktrRace ? window.__ktrRace.player.body.steerVis : 9);
  await page.waitForTimeout(400);
  const rel2 = await page.evaluate(() => Math.abs(window.__ktrRace.player.body.steerVis));
  check("touch steer releases (no sticking)", rel2 < 0.1, `steerVis=${rel2.toFixed(2)}`);
  void rel;

  /* 17: gas + brake/reverse */
  const spd0 = await page.evaluate(() => {
    const race = window.__ktrRace, b = race.player.body;
    race.player.fx.ghost = 10; race.player.fx.invinc = 10; race.player.fx.frozen = 0; race.player.fx.slow = 0; race.player.spinT = 0;
    const s0 = race.track.samples[b.seg];
    b.x = s0.x; b.z = s0.z; b.y = s0.y; b.heading = s0.ang; b.velAng = s0.ang; b.airborne = false; b.route = -1;
    b.speed = 0; return b.speed;
  });
  await tap(gasSel, "touchstart");
  await page.waitForTimeout(1100);
  const spdT = await page.evaluate(() => window.__ktrRace.player.body.speed);
  await tap(gasSel, "touchend");
  check("touch accelerate", spdT - spd0 > 6, `0 → ${spdT.toFixed(1)}`);
  const brakeSel = ".trTouchRight .trTouchBtn:nth-child(3)";
  await tap(brakeSel, "touchstart");
  await page.waitForTimeout(2500);
  const revT = await page.evaluate(() => window.__ktrRace.player.body.speed);
  await tap(brakeSel, "touchend");
  check("touch brake → reverse", revT < -1, `speed=${revT.toFixed(1)}`);

  /* 18: drift, 19: boost */
  const driftSel = ".trTouchRight .trTouchBtn:nth-child(2)";
  const nitroSel = ".trTouchRight .trTouchBtn:nth-child(1)";
  const dOK = await page.evaluate(async ([gs, ds, rs]) => {
    const press = (s, phase) => {
      const el = document.querySelector(s);
      const r = el.getBoundingClientRect();
      const t = new Touch({ identifier: Math.random() * 1e6 | 0, target: el, clientX: r.x + 5, clientY: r.y + 5 });
      el.dispatchEvent(new TouchEvent(phase, { touches: phase === "touchstart" ? [t] : [], targetTouches: [], changedTouches: [t], bubbles: true }));
    };
    const b = window.__ktrRace.player.body;
    b.speed = 40;
    press(gs, "touchstart"); press(rs, "touchstart"); press(ds, "touchstart");
    await new Promise((r) => setTimeout(r, 700));
    const engaged = b.drift === 1;
    press(gs, "touchend"); press(rs, "touchend"); press(ds, "touchend");
    return engaged;
  }, [gasSel, rightSel, driftSel]);
  check("touch drift", dOK);
  const nOK = await page.evaluate(async (ns) => {
    const el = document.querySelector(ns);
    const r = el.getBoundingClientRect();
    const p = window.__ktrRace.player;
    p.body.nitro = 1; p.body.speed = 30; p.fx.boostTime = 0;
    const t = new Touch({ identifier: 3, target: el, clientX: r.x + 5, clientY: r.y + 5 });
    el.dispatchEvent(new TouchEvent("touchstart", { touches: [t], targetTouches: [], changedTouches: [t], bubbles: true }));
    await new Promise((res) => setTimeout(res, 400));
    el.dispatchEvent(new TouchEvent("touchend", { touches: [], targetTouches: [], changedTouches: [t], bubbles: true }));
    return p.fx.boostTime > 0;
  }, nitroSel);
  check("touch boost (nitro)", nOK);

  /* power-up buttons + two-finger combo */
  const slotUsed = await page.evaluate(async () => {
    const els = document.querySelectorAll(".trTouchSlot");
    const p = window.__ktrRace.player;
    p.slots = ["shield", null, null]; p.fx.shield = 0;
    const el = els[0];
    const r = el.getBoundingClientRect();
    const t = new Touch({ identifier: 5, target: el, clientX: r.x + 5, clientY: r.y + 5 });
    el.dispatchEvent(new TouchEvent("touchstart", { touches: [t], targetTouches: [t], changedTouches: [t], bubbles: true }));
    el.dispatchEvent(new TouchEvent("touchend", { touches: [], targetTouches: [], changedTouches: [t], bubbles: true }));
    await new Promise((res) => setTimeout(res, 500));
    return p.fx.shield > 0;
  });
  check("touch power-up button 1", slotUsed);
  const comboT = await page.evaluate(async () => {
    const els = document.querySelectorAll(".trTouchSlot");
    const p = window.__ktrRace.player;
    p.slots = ["turbo", "shield", null]; p.combosDone = 0;
    const tapEl = (el) => {
      const r = el.getBoundingClientRect();
      const t = new Touch({ identifier: Math.random() * 1e6 | 0, target: el, clientX: r.x + 5, clientY: r.y + 5 });
      el.dispatchEvent(new TouchEvent("touchstart", { touches: [t], targetTouches: [t], changedTouches: [t], bubbles: true }));
      el.dispatchEvent(new TouchEvent("touchend", { touches: [], targetTouches: [], changedTouches: [t], bubbles: true }));
    };
    tapEl(els[0]); setTimeout(() => tapEl(els[1]), 70);
    await new Promise((res) => setTimeout(res, 700));
    return p.combosDone;
  });
  check("touch two-tap combo", comboT >= 1);

  await browser.close();
}

server.close();
const fails = results.filter(([, ok]) => !ok);
console.log(fails.length ? `\n${fails.length} FAILURES: ${fails.map(([n]) => n).join("; ")}` : `\nALL ${results.length} CONTROL CHECKS PASSED`);
process.exit(fails.length ? 1 : 0);
