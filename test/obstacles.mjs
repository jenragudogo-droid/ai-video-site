/* Every obstacle must be honest for every character on the roster:
   its box has to permit exactly the action its `act` advertises, and
   forbid the others, whoever is riding. */
import {
  OBSTACLE, DODGE_MIN_TOP, JUMP_MAX_TOP, SLIDE_MIN_UNDERSIDE,
} from "../src/components/endlessRush/track.js";
import { STAND_H, SLIDE_H, PLAYER_HW } from "../src/components/endlessRush/engine.js";
import { CHARACTERS, jumpApex, airTime } from "../src/components/endlessRush/characters.js";

const LANE_W = 2.0;
let bad = 0;

console.log("characters");
let minApex = 99, maxApex = 0;
for (const c of CHARACTERS) {
  const a = jumpApex(c);
  minApex = Math.min(minApex, a);
  maxApex = Math.max(maxApex, a);
  console.log(`  ${c.name.padEnd(15)} speed ×${c.speed.toFixed(2)}  lane ×${c.laneTime.toFixed(2)}`
    + `  apex ${a.toFixed(2)} m  airtime ${airTime(c).toFixed(2)} s`);
}
console.log(`  → lowest apex ${minApex.toFixed(2)} m, highest ${maxApex.toFixed(2)} m\n`);

console.log("obstacles");
console.log("  name         act    box y..top    standing  low       verdict");
for (const [name, o] of Object.entries(OBSTACLE)) {
  const top = o.y + o.h;
  const standHits = o.y < STAND_H && top > 0;
  const lowHits = o.y < SLIDE_H && top > 0;
  let ok = true;
  const notes = [];

  if (o.act === "slide") {
    if (lowHits) { ok = false; notes.push("SLIDING STILL HITS IT"); }
    if (!standHits) { ok = false; notes.push("standing already clears it"); }
    if (o.y < SLIDE_MIN_UNDERSIDE) { ok = false; notes.push("underside too low to read"); }
  }
  if (o.act === "jump") {
    if (!standHits) { ok = false; notes.push("standing already clears it"); }
    if (top > JUMP_MAX_TOP) { ok = false; notes.push("too tall for the weakest jump"); }
    if (top > minApex - 0.3) { ok = false; notes.push(`NOT CLEARABLE BY EVERY CHARACTER (apex ${minApex.toFixed(2)})`); }
  }
  if (o.act === "dodge") {
    if (!standHits) { ok = false; notes.push("not actually in the way"); }
    if (!lowHits) { ok = false; notes.push("SLIDING WOULD PASS UNDER A DODGE OBSTACLE"); }
    if (top < DODGE_MIN_TOP) { ok = false; notes.push("below the dodge floor"); }
    if (top < maxApex) { ok = false; notes.push(`THE BEST JUMPER CLEARS IT (apex ${maxApex.toFixed(2)})`); }
  }
  if (o.w * 0.5 + PLAYER_HW > LANE_W) { ok = false; notes.push("too wide: blocks the next lane"); }

  if (!ok) bad += 1;
  console.log(`  ${name.padEnd(12)} ${o.act.padEnd(6)} `
    + `${(o.y.toFixed(2) + ".." + top.toFixed(2)).padEnd(13)}`
    + `${(standHits ? "hit" : "clear").padEnd(10)}${(lowHits ? "hit" : "clear").padEnd(10)}`
    + `${ok ? "ok" : "\u2717 " + notes.join("; ")}`);
}
console.log(`\n${bad === 0 ? "every obstacle is honest for every character" : bad + " OBSTACLE(S) LIE"}`);
process.exit(bad === 0 ? 0 : 1);
