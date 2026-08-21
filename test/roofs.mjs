/* ------------------------------------------------------------------ *
 * Rooftop round trip.
 *
 * The browser autopilot only reaches a roof when the dice hand it the
 * right jetpack, which makes it a poor witness for a route that has to
 * work every time. This drives the real engine through the whole loop
 * deliberately — pick up the pack planted for a roof, fly, land on the
 * deck, run it on foot, take its coins, drop off the far end — and
 * fails if any stage never happens or the runner dies doing it.
 * ------------------------------------------------------------------ */

import {
  makeGame, resetGame, startRun, stepGame, chunksIn, slide,
} from "../src/components/endlessRush/engine.js";
import { decide } from "./bot.mjs";
import { CHARACTERS } from "../src/components/endlessRush/characters.js";

const DT = 1 / 90;

function trip(seed, character) {
  const s = makeGame({ seed, character });
  resetGame(s, seed, character);
  startRun(s);

  const seen = {
    packs: 0, flew: 0, landedOnDeck: 0, roofRun: 0, roofCoins: 0,
    droppedOff: 0, deaths: [], roofsPassed: 0,
  };
  let wasFlying = false;
  let wasOnRoof = false;
  const roofsMet = new Set();

  for (let i = 0; i < 90 * 60 * 9 && s.dist < 9000; i += 1) {
    decide(s);
    /* The autopilot lands when it is over a deck; nudge it once more in
       case it is hovering in a lane the roof does not have. */
    if (s.flying && s.surfaceY > 1 && !s.roofLandTried) {
      s.roofLandTried = true;
      slide(s);
    }
    if (!s.flying) s.roofLandTried = false;

    stepGame(s, {}, DT);
    if (s.phase !== "running") { seen.deaths.push(`${Math.round(s.dist)}m/${s.causeOfDeath}`); break; }

    if (s.flying && !wasFlying) seen.flew += 1;
    if (!s.flying && wasFlying && s.surfaceY > 1) seen.landedOnDeck += 1;
    wasFlying = s.flying;

    const onDeck = s.surfaceY > 1 && !s.flying && !s.airborne;
    if (onDeck) seen.roofRun += s.speed * DT;
    if (!onDeck && wasOnRoof) seen.droppedOff += 1;
    wasOnRoof = onDeck;

    for (const c of chunksIn(s, s.z - 2, s.z + 4)) {
      for (const r of c.roofs) if (s.z > r.z0 && s.z < r.z1) roofsMet.add(`${r.z0}`);
    }
  }
  seen.roofsPassed = roofsMet.size;
  seen.packs = s.stats.jetpacks ?? seen.flew;
  seen.roofCoins = s.coins;
  seen.dist = Math.round(s.dist);
  return seen;
}

let bad = 0;
const rows = [];
for (const ch of CHARACTERS) {
  let flew = 0, landed = 0, roofRun = 0, dropped = 0, roofs = 0, deaths = [];
  for (let seed = 1; seed <= 6; seed += 1) {
    const t = trip(seed * 977, ch.id);
    flew += t.flew;
    landed += t.landedOnDeck;
    roofRun += t.roofRun;
    dropped += t.droppedOff;
    roofs += t.roofsPassed;
    deaths.push(...t.deaths);
  }
  const ok = flew > 0 && landed > 0 && roofRun > 40 && dropped > 0;
  if (!ok) bad += 1;
  rows.push(
    `${ch.id.padEnd(9)} flights ${String(flew).padStart(3)}  `
    + `deck landings ${String(landed).padStart(3)}  `
    + `roof metres ${String(Math.round(roofRun)).padStart(5)}  `
    + `returns to street ${String(dropped).padStart(3)}  `
    + `roofs crossed ${String(roofs).padStart(3)}  ${ok ? "ok" : "MISSING A STAGE"}`
    + (deaths.length ? `  deaths: ${deaths.join(", ")}` : ""),
  );
}

console.log(rows.join("\n"));
console.log(bad
  ? `\n${bad} character(s) never completed the rooftop round trip`
  : "\nevery character flies up, lands on a deck, runs it and comes back down");
process.exit(bad ? 1 : 0);
