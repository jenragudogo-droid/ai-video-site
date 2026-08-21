/* ------------------------------------------------------------------ *
 * How forgiving is the timing?
 *
 * "Every obstacle is passable" is a weaker promise than it sounds: an
 * obstacle you can only clear by pressing within thirty milliseconds of
 * a particular instant is passable and still unfair. This measures the
 * actual window — the runner is put in front of one obstacle at a time
 * and the correct key is pressed at every offset from 1.4 s early to
 * dead late, and the offsets that survive are reported.
 *
 * A window narrower than about a fifth of a second is a bug, not a
 * difficulty setting.
 * ------------------------------------------------------------------ */

import {
  makeGame, resetGame, startRun, stepGame, jump, slide, moveLane,
} from "../src/components/endlessRush/engine.js";
import { OBSTACLE } from "../src/components/endlessRush/track.js";
import { CHARACTERS } from "../src/components/endlessRush/characters.js";

const DT = 1 / 90;
const LANES = [-2.4, 0, 2.4];

/* Drops a single obstacle onto otherwise clear road and runs at it. */
function attempt(type, ch, pressAt) {
  const o = OBSTACLE[type];
  const s = makeGame({ seed: 4242, character: ch.id });
  resetGame(s, 4242, ch.id);
  startRun(s);

  // clear the road and plant exactly one obstacle 60 m ahead
  const targetZ = 60;
  for (const c of s.chunks) { c.obstacles.length = 0; c.enemies.length = 0; c.powerups.length = 0; }
  let planted = false;
  const plant = () => {
    if (planted) return;
    for (const c of s.chunks) {
      if (targetZ >= c.z0 && targetZ < c.z1) {
        c.obstacles.push({
          type, art: o.art, lane: 1, x: LANES[1], y: o.y, base: 0, z: targetZ,
          w: o.w, h: o.h, d: o.d, act: o.act, sev: o.sev, hit: false, seed: 1,
        });
        planted = true;
      }
    }
  };
  plant();

  let pressed = false;
  for (let i = 0; i < 90 * 20; i += 1) {
    // keep everything else off the road so only this obstacle matters
    for (const c of s.chunks) {
      c.enemies.length = 0;
      c.powerups.length = 0;
      if (!planted || c.obstacles.some((x) => x.z !== targetZ)) {
        c.obstacles = c.obstacles.filter((x) => x.z === targetZ);
      }
    }
    plant();
    if (s.lane !== 1) moveLane(s, Math.sign(1 - s.lane));

    const t = (targetZ - o.d * 0.5 - s.z) / s.speed;   // seconds to contact
    if (!pressed && t <= pressAt) {
      pressed = true;
      if (o.act === "jump") jump(s);
      else if (o.act === "slide") slide(s);
    }
    stepGame(s, {}, DT);
    if (s.phase !== "running") return false;
    if (s.z > targetZ + 6) return true;
  }
  return false;
}

const OFFSETS = [];
for (let t = 1.4; t >= -0.02; t -= 0.02) OFFSETS.push(Number(t.toFixed(2)));

const MIN_WINDOW = 0.2;
let bad = 0;
const rows = [];

for (const type of Object.keys(OBSTACLE)) {
  const o = OBSTACLE[type];
  if (o.act === "dodge") continue;
  for (const ch of CHARACTERS) {
    const ok = OFFSETS.filter((t) => attempt(type, ch, t));
    if (!ok.length) {
      bad += 1;
      rows.push(`${type.padEnd(10)} ${ch.id.padEnd(9)} ${o.act.padEnd(5)}  NO WINDOW AT ALL`);
      continue;
    }
    /* The useful number is the longest *unbroken* run of working press
       times. Two separate slivers with a dead patch between them is not
       a window a player can aim at. */
    let best = 0, bestFrom = 0, bestTo = 0, runFrom = ok[0], prev = ok[0];
    for (let i = 1; i <= ok.length; i += 1) {
      const cur = ok[i];
      if (cur !== undefined && Math.abs(prev - cur - 0.02) < 1e-6) { prev = cur; continue; }
      const span = runFrom - prev;
      if (span >= best) { best = span; bestFrom = runFrom; bestTo = prev; }
      if (cur === undefined) break;
      runFrom = cur; prev = cur;
    }
    const narrow = best < MIN_WINDOW;
    if (narrow) bad += 1;
    rows.push(
      `${type.padEnd(10)} ${ch.id.padEnd(9)} ${o.act.padEnd(5)}  `
      + `window ${best.toFixed(2)}s  (press ${bestFrom.toFixed(2)}s to ${bestTo.toFixed(2)}s before contact)`
      + `${narrow ? "  TOO NARROW" : ""}`,
    );
  }
}

console.log(rows.join("\n"));
console.log(bad
  ? `\n${bad} obstacle/character pairs give less than ${MIN_WINDOW}s to act`
  : `\nevery jump and slide has at least ${MIN_WINDOW}s of usable window, for every character`);
process.exit(bad ? 1 : 0);
