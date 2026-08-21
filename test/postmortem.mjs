/* For each death, reconstruct what the runner could actually have done. */
import {
  makeGame, resetGame, startRun, stepGame, drainEvents, chunksIn, surfaceAt,
} from "../src/components/endlessRush/engine.js";
import { decide } from "./bot.mjs";

const DT = 1 / 90;
const character = process.argv[2] || "runner";
const seeds = Number(process.argv[3] || 25);
const target = Number(process.argv[4] || 8000);

const reasons = {};
for (let i = 0; i < seeds; i += 1) {
  const seed = 1000 + i * 7919;
  const s = makeGame({ seed, character });
  resetGame(s, seed, character);
  startRun(s);
  const trail = [];
  let death = null;
  while (s.phase === "running" && s.dist < target) {
    const before = {
      z: s.dist, lane: s.lane, y: s.y, air: s.airborne, sl: s.sliding,
      deck: s.surfaceY, fly: s.flying, land: s.flyLand, sb: s.slideBuffer, jb: s.jumpBuffer,
    };
    decide(s);
    stepGame(s, null, DT);
    trail.push(before);
    if (trail.length > 400) trail.shift();
    for (const e of drainEvents(s)) {
      if (e.type === "crash") death = { dist: s.dist, type: e.a };
    }
  }
  if (!death) continue;

  // what was around at the moment of death?
  const deck = s.surfaceY;
  const near = [];
  for (const c of chunksIn(s, s.z - 4, s.z + 4)) {
    for (const o of c.obstacles) {
      if (Math.abs(o.z - s.z) < 3) near.push({ lane: o.lane, act: o.act, art: o.art, base: o.base || 0, dz: +(o.z - s.z).toFixed(2) });
    }
  }
  const rowLanes = [null, null, null];
  for (const o of near) if (Math.abs(o.base - deck) < 1.5 && Math.abs(o.dz) < 1.2) rowLanes[o.lane] = o.act;
  const openLanes = rowLanes.filter((a) => a === null || a !== "dodge").length;

  // where was the runner in the second before?
  const back = trail.slice(-90);
  const wasFlying = back.some((f) => f.fly || f.land > 0);
  const wasOnRoof = back.some((f) => f.deck > 1);
  const key = `${death.type}${deck > 1 ? " (on a roof)" : ""}`
    + `${wasFlying ? " [just landed from flight]" : ""}`;
  reasons[key] = (reasons[key] || 0) + 1;

  if (Object.values(reasons).reduce((a, b) => a + b, 0) <= 4) {
    console.log(`\nseed ${seed}: died at ${Math.round(death.dist)} m on ${death.type}`);
    console.log(`  deck=${deck.toFixed(1)} lane=${s.lane} y=${s.y.toFixed(2)} air=${s.airborne} sliding=${s.sliding}`
      + ` flying=${s.flying} landing=${s.flyLand.toFixed(2)} slideBuf=${s.slideBuffer.toFixed(2)}`);
    console.log(`  row at death: [${rowLanes.map((a) => a || "·").join(" ")}]  open lanes=${openLanes}`);
    console.log(`  wasFlying(last 1s)=${wasFlying} wasOnRoof=${wasOnRoof}`);
    console.log("  nearby: " + near.map((o) => `${o.art}@${o.dz}m L${o.lane} base${o.base.toFixed(1)}`).join(", "));
  }
}
console.log(`\n${character}: death causes`);
for (const [k, v] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`);
void surfaceAt;
