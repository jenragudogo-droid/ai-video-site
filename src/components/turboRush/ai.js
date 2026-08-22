/* ------------------------------------------------------------------ *
 * AI opponents. Each gets a personality derived from its driver's
 * style: racing line offset, item habits, shortcut appetite, drift
 * thresholds. AI never teleports — it steers, drifts, boosts and uses
 * the same physics the player does. Rubber-banding is mild and capped.
 * ------------------------------------------------------------------ */
import { wrap } from "./physics.js";
import { maybeEnterShortcut } from "./physics.js";
import { curvatureAt } from "./spline.js";
import { activateSlot, tryCombo, progressGap } from "./powerups.js";

export function personalityFor(driver, difficulty, rng) {
  const base = {
    skill: 0.72, aggro: 0.5, itemRate: 0.5, comboRate: 0.15,
    shortcutAffinity: 0.4, driftLove: 0.5, lineNoise: 0.35, defend: 0.4,
  };
  switch (driver.style) {
    case "aggressive": Object.assign(base, { aggro: 0.95, itemRate: 0.7, driftLove: 0.55, lineNoise: 0.45 }); break;
    case "defensive": Object.assign(base, { defend: 0.95, aggro: 0.25, itemRate: 0.55, lineNoise: 0.2 }); break;
    case "drift": Object.assign(base, { driftLove: 0.98, skill: 0.8, lineNoise: 0.3 }); break;
    case "technical": Object.assign(base, { skill: 0.88, lineNoise: 0.12, driftLove: 0.45 }); break;
    case "offroad": Object.assign(base, { shortcutAffinity: 0.9, lineNoise: 0.5 }); break;
    case "shortcut": Object.assign(base, { shortcutAffinity: 1.0, skill: 0.8 }); break;
    case "powerup": Object.assign(base, { itemRate: 0.95, comboRate: 0.5, aggro: 0.6 }); break;
    case "balanced": Object.assign(base, { skill: 0.78 }); break;
    default: break;
  }
  base.skill = Math.min(0.98, base.skill * (0.82 + difficulty * 0.2));
  base.lineOffset = (rng() - 0.5) * 4;
  base.itemTimer = 1.5 + rng() * 3;
  base.decisionSeed = rng();
  return base;
}

export function aiInput(race, r, dt) {
  const b = r.body;
  const p = r.ai;
  const track = race.track;
  const onSc = b.route >= 0;
  const samples = onSc ? track.shortcuts[b.route].samples : track.samples;
  const loop = !onSc;
  const n = samples.length;

  /* ------- steering: chase a look-ahead point on the line ------- */
  const lookN = Math.max(3, Math.round(3 + b.speed * 0.22));
  const li = loop ? (b.seg + lookN) % n : Math.min(n - 1, b.routeSeg + lookN);
  const ls = samples[li];
  /* line offset: personality bias + avoid nearby traps + overtake shifts */
  let off = p.lineOffset * (0.4 + 0.6 * Math.sin(b.sProg * 0.01 + p.decisionSeed * 9));
  for (const tr of race.traps) {
    const d = Math.hypot(tr.x - ls.x, tr.z - ls.z);
    if (d < 7) off += (Math.sin(ls.ang) * (tr.x - ls.x) < 0 ? 1 : -1) * 3.2; // swerve
  }
  for (const hz of race.track.hazards) {
    const d = Math.hypot(hz.x - ls.x, hz.z - ls.z);
    if (d < 6) off += (Math.sin(ls.ang) * (hz.x - ls.x) < 0 ? 1 : -1) * 2.6; // dodge boulders
  }
  /* overtake / defend against the nearest racer */
  for (const v of race.racers) {
    if (v === r || v.finished) continue;
    const gap = progressGap(race, v, r);
    if (gap > 2 && gap < 14) off += (p.decisionSeed > 0.5 ? 1 : -1) * 2.4; // pull out to pass
    if (gap < -2 && gap > -10 && p.defend > 0.6) {
      const lat = (v.body.x - b.x) * Math.cos(b.heading);
      off += Math.sign(lat) * 1.6; // block the inside
    }
  }
  off = Math.max(-ls.w * 0.4, Math.min(ls.w * 0.4, off));
  const tx = ls.x + Math.cos(ls.ang) * off;
  const tz = ls.z - Math.sin(ls.ang) * off;
  const want = Math.atan2(tx - b.x, tz - b.z);
  let dh = wrap(want - b.heading);
  const noise = (Math.sin(race.time * 1.7 + p.decisionSeed * 20) * p.lineNoise) * 0.08;
  let steer = Math.max(-1, Math.min(1, dh * 1.8 + noise));

  /* ------- throttle from curvature ahead ------- */
  const curveIdx = loop ? (b.seg + Math.round(lookN * 1.6)) % n : Math.min(n - 1, b.routeSeg + lookN);
  const curv = Math.abs(curvatureAt(samples, curveIdx, loop));
  const comfort = 0.028 * (0.6 + p.skill);
  let throttle = 1;
  let brake = 0;
  if (curv > comfort && b.speed > 18) {
    throttle = Math.max(0.35, 1 - (curv - comfort) * 26);
    if (curv > comfort * 2.4 && b.speed > r.st.maxSpeed * 0.55) brake = 0.5;
  }
  /* hesitate when frozen-blind */
  if (r.smokeT > 0) { throttle *= 0.75; steer *= 0.7; }

  /* off the road: forget the racing line, aim straight back at the tarmac */
  if (b.offroad) {
    const cs = samples[loop ? b.seg : b.routeSeg];
    const backIdx = loop ? (b.seg + 4) % n : Math.min(n - 1, b.routeSeg + 4);
    const bs = samples[backIdx];
    const wantBack = Math.atan2(bs.x - b.x, bs.z - b.z);
    steer = Math.max(-1, Math.min(1, wrap(wantBack - b.heading) * 2.2));
    throttle = Math.min(throttle, 0.6);
    void cs;
  }

  /* ------- drift on sharp sustained corners ------- */
  const drift = p.driftLove > 0.35 && curv > comfort * 1.5 && b.speed > r.st.maxSpeed * 0.45 && Math.abs(steer) > 0.4;

  /* ------- nitro: spend when it's full-ish and the road is straight ------- */
  if (b.nitro > 0.85 && curv < comfort * 0.7 && !b.airborne) {
    r.fx.boostTime = Math.max(r.fx.boostTime, 1.2);
    b.nitro = 0;
  }

  /* ------- shortcuts ------- */
  maybeEnterShortcut(r, track, (sc) => {
    const dare = p.shortcutAffinity * (0.65 + 0.35 * p.decisionSeed);
    return dare > sc.skill + 0.1;
  });

  /* ------- items ------- */
  p.itemTimer -= dt;
  if (p.itemTimer <= 0) {
    p.itemTimer = 2 + (1 - p.itemRate) * 5 + Math.random() * 2;
    const have = r.slots.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
    let comboDone = false;
    if (have.length >= 2 && Math.random() < p.comboRate) {
      /* look for a pair (or triple) that actually combines */
      outer:
      for (let a = 0; a < have.length; a++) {
        for (let bI = a + 1; bI < have.length; bI++) {
          const idxs = [have[a], have[bI]];
          if (have.length === 3 && Math.random() < 0.35) idxs.push(have[3 - a - bI] !== undefined ? have.find((h) => !idxs.includes(h)) : null);
          const clean = idxs.filter((v) => v !== null && v !== undefined);
          const res = tryCombo(race, r, clean);
          if (res.ok) { comboDone = true; break outer; }
        }
      }
    }
    if (!comboDone && have.length) {
      /* prefer defensive items when leading, offensive when chasing */
      const prefer = (ids) => {
        for (const i of have) if (ids.includes(r.slots[i])) return i;
        return null;
      };
      let pick;
      if (r.place <= 2) pick = prefer(["shield", "oil", "mine", "smoke", "turbo", "superTurbo"]) ?? have[0];
      else pick = prefer(["rocket", "tripleRocket", "freeze", "turbo", "superTurbo", "teleport", "emp"]) ?? have[0];
      if (r.bossTraits?.itemBias) pick = prefer(r.bossTraits.itemBias) ?? pick;
      activateSlot(race, r, pick);
    }
  }

  /* ------- recovery: stuck against a wall / facing backwards ------- */
  if (r.recoverT > 0) {
    /* committed reverse burst: back out and turn, then resume driving */
    r.recoverT -= dt;
    throttle = 0; brake = 0.85;
    steer = p.decisionSeed > 0.5 ? 1 : -1;
  } else if (Math.abs(b.speed) < 3 && race.time > 5 && !r.finished) {
    r.stuckT = (r.stuckT || 0) + dt;
    if (r.stuckT > 1.2) { r.recoverT = 1.1; r.stuckT = 0; } // never teleports
  } else r.stuckT = 0;

  /* boss quirks */
  if (r.bossTraits?.ram) {
    const pl = race.player;
    if (pl && !pl.finished) {
      const gap = progressGap(race, pl, r);
      const d = Math.hypot(pl.body.x - b.x, pl.body.z - b.z);
      if (gap > -4 && gap < 12 && d < 10) {
        const want2 = Math.atan2(pl.body.x - b.x, pl.body.z - b.z);
        steer = Math.max(-1, Math.min(1, wrap(want2 - b.heading) * 2.2));
        throttle = 1;
      }
    }
  }
  if (r.bossTraits?.ghostDodge && r.fx.ghost <= 0) {
    const threat = race.projectiles.some((pr) => Math.hypot(pr.x - b.x, pr.z - b.z) < 16 && pr.owner !== r.id);
    if (threat && Math.random() < 0.04) r.fx.ghost = 1.6;
  }

  /* The AI plans in the internal heading frame (positive steer raises the
     heading angle). Player input uses screen frame (+1 = screen right),
     which physics negates once on entry — so the AI's plan is negated
     here to pass through that same front door unchanged. */
  return { steer: -steer, throttle, brake, drift, boost: false };
}

/* Mild rubber-band factor for AI top speed. The player can still gap the
   field — the correction caps at ±6% and fades inside 60 m. */
export function rubberBand(race, r) {
  if (r.isPlayer || !race.player) return 1;
  const gap = progressGap(race, race.player, r); // + = player ahead
  const f = Math.max(-1, Math.min(1, gap / 220));
  const band = 1 + f * 0.06;
  return band * (r.bossTraits ? race.bossDifficulty || 1 : race.aiDifficulty || 1);
}
