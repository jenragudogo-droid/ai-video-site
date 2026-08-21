/* The node bot, but with its keypresses delayed, to separate "the track
   is unfair" from "the browser harness is slow". */
import { makeGame, resetGame, startRun, stepGame, moveLane, jump, slide, attack } from "../src/components/endlessRush/engine.js";
import { decide } from "./bot.mjs";
const DT = 1/90;
for (const lagMs of [0, 20, 40, 70, 110]) {
  const lag = Math.round(lagMs/1000/DT);
  const tally = {};
  let survived = 0;
  const N = 40;
  for (let k = 0; k < N; k++) {
    const seed = 1000 + k*37;
    const s = makeGame({ seed }); resetGame(s, seed); startRun(s);
    const q = [];
    // intercept: decide() acts immediately, so instead run decide on a *stale* copy
    const hist = [];
    for (let i = 0; i < 90*60*12 && s.dist < 6000; i++) {
      hist.push({ z: s.z, y: s.y });
      // emulate latency by only letting decide see the world `lag` frames ago:
      // easiest faithful approximation is to delay the *effect* of the decision
      const before = { lane: s.lane, jb: s.jumpBuffer, sb: s.slideBuffer, cd: s.attackCd };
      decide(s);
      const act = s.lane !== before.lane ? ["lane", s.lane] :
                  s.jumpBuffer > before.jb ? ["jump"] :
                  s.slideBuffer > before.sb ? ["slide"] :
                  s.attackCd > before.cd ? ["attack"] : null;
      if (act) { s.lane = before.lane; s.jumpBuffer = before.jb; s.slideBuffer = before.sb; s.attackCd = before.cd; q.push({ at: i + lag, act }); }
      while (q.length && q[0].at <= i) {
        const a = q.shift().act;
        if (a[0] === "lane") moveLane(s, Math.sign(a[1] - s.lane));
        else if (a[0] === "jump") jump(s);
        else if (a[0] === "slide") slide(s);
        else attack(s);
      }
      stepGame(s, {}, DT);
      if (s.phase !== "running") { tally[s.causeOfDeath] = (tally[s.causeOfDeath]||0)+1; break; }
    }
    if (s.phase === "running") survived++;
  }
  const low = (tally.sign||0)+(tally.pipe||0)+(tally.worksArch||0);
  console.log(`lag ${String(lagMs).padStart(3)}ms  survived ${survived}/${N} to 6km   slide deaths ${low}   ${JSON.stringify(tally)}`);
}
