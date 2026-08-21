import { boot, state, setState, log, getErrors } from "./play.mjs";

async function measure(page, label) {
  const r = await page.evaluate(() => new Promise((res) => {
    const times = []; let last = performance.now(); let n = 0;
    const tick = () => {
      const now = performance.now();
      times.push(now - last); last = now; n++;
      if (n < 140) requestAnimationFrame(tick);
      else {
        times.sort((a, b) => a - b);
        res({ median: times[70], p95: times[133], worst: times[139] });
      }
    };
    requestAnimationFrame(tick);
  }));
  const st = await state(page);
  log(`${label.padEnd(26)} median ${r.median.toFixed(1)}ms  p95 ${r.p95.toFixed(1)}ms  worst ${r.worst.toFixed(1)}ms   items=${st.items} quality=${st.quality?.toFixed(2)}`);
}

for (const [w, h, mob, name] of [[1440, 900, false, "desktop 1440x900"], [390, 844, true, "iphone portrait"], [844, 390, true, "iphone landscape"]]) {
  const { browser, page } = await boot({ width: w, height: h, mobile: mob });
  await page.getByRole("button", { name: "Start running" }).click();
  await page.waitForTimeout(700);
  for (const [z, zone] of [[140, "city"], [660, "market"], [1180, "forest"], [1700, "mountain"], [2220, "night"]]) {
    await setState(page, { dist: z, z, phase: "running", invuln: 9999 });
    await page.waitForTimeout(900);
    await measure(page, `${name} / ${zone}`);
  }
  await browser.close();
}
log("errors:", getErrors().filter(e => !e.includes("404")));
