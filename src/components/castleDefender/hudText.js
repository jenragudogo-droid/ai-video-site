/* ------------------------------------------------------------------ *
 * Castle Defender — wave wording for the HUD and the wave-start card.
 *
 * Pure functions so the numbers can be tested under node. The total
 * always comes from the stage's own wave list (`s.totalWaves`), never
 * from a constant, so later stages can be any length.
 * ------------------------------------------------------------------ */

/* The wave the player should be thinking about: the one in progress,
   or the one about to arrive during a countdown. */
export function displayWave(wave, waveState, total) {
  const endless = total === Infinity;
  const current = waveState === "countdown" ? Math.min(endless ? Infinity : total, wave + 1) : Math.max(1, wave);
  const left = endless ? null : Math.max(0, total - current);
  return {
    current,
    total: endless ? null : total,
    left,
    final: !endless && current === total,
    endless,
    /* what the pill shows, e.g. "6 / 10" or "6" in endless mode */
    counter: endless ? `${current}` : `${current} / ${total}`,
    /* the quiet note beside it */
    note: endless ? "Endless" : left === 0 ? "Final wave" : `${left} left`,
  };
}

/* "8 Bandits", "6 Crossbowmen", "8 Men-at-Arms" */
export function plural(name, n) {
  if (n === 1) return `${n} ${name}`;
  if (name === "Man-at-Arms") return `${n} Men-at-Arms`;
  if (/man$/.test(name)) return `${n} ${name.replace(/man$/, "men")}`;
  return `${n} ${name}s`;
}

/* Title and subtitle of the card shown as a wave begins. `titles` is
   the stage's optional { waveNumber: "Subtitle" } map; `summary` is the
   wave composition from the engine. */
export function waveCard(n, total, titles, summary) {
  const endless = total === Infinity;
  const custom = titles && titles[n];
  const list = (summary || []).map((g) => plural(g.name, g.count)).join(" · ");
  if (!endless && n === total) {
    return { title: "Final wave", sub: `${n} / ${total}${custom ? ` · ${custom}` : ""}`, kind: "final", ms: 3200 };
  }
  return {
    title: endless ? `Wave ${n}` : `Wave ${n} / ${total}`,
    sub: custom || list,
    kind: custom ? "waveBig" : "wave",
    ms: custom ? 2600 : 2200,
  };
}
