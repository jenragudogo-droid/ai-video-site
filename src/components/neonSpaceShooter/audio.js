/* ------------------------------------------------------------------ *
 * Neon Space Shooter — synthesised arcade sound.
 *
 * Everything is generated with oscillators and a shared noise buffer:
 * no assets, nothing to download, nothing copyrighted. The context is
 * created lazily on the first user gesture (unlock), because browsers
 * refuse autoplaying audio contexts.
 * ------------------------------------------------------------------ */

export function createShooterAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let muted = false;
  const lastAt = {};

  const ensure = () => {
    if (ctx) return true;
    const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
    const len = ctx.sampleRate * 0.5;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i += 1) d[i] = Math.random() * 2 - 1;
    return true;
  };

  const tone = (type, f0, f1, t0, dur, vol, curve = "exp") => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) {
      if (curve === "exp") o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
      else o.frequency.linearRampToValueAtTime(f1, t0 + dur);
    }
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  };

  const noise = (t0, dur, vol, freq = 900, q = 0.7) => {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(freq, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.12), t0 + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  };

  /* name -> [minimum seconds between plays, builder] — the throttle is
     what keeps triple lasers at rapid-fire rates from becoming a drone */
  const SOUNDS = {
    shoot: [0.09, (t) => tone("square", 880, 220, t, 0.09, 0.05)],
    missile: [0.12, (t) => { tone("sawtooth", 240, 620, t, 0.18, 0.05, "lin"); noise(t, 0.14, 0.05, 1600); }],
    boom: [0.05, (t) => { noise(t, 0.3, 0.3, 1100); tone("sine", 190, 45, t, 0.3, 0.24); }],
    bigBoom: [0.1, (t) => { noise(t, 0.75, 0.42, 900); tone("sine", 130, 30, t, 0.75, 0.34); tone("square", 90, 28, t, 0.5, 0.1); }],
    spark: [0.11, (t) => tone("triangle", 1500, 900, t, 0.045, 0.03)],
    crystal: [0.06, (t) => { tone("sine", 990, 990, t, 0.09, 0.11); tone("sine", 1480, 1480, t + 0.07, 0.13, 0.1); }],
    hit: [0.1, (t) => { tone("sawtooth", 300, 70, t, 0.32, 0.26); noise(t, 0.24, 0.2, 700); }],
    shieldBreak: [0.1, (t) => { tone("triangle", 900, 180, t, 0.3, 0.2); noise(t, 0.2, 0.12, 2400); }],
    power: [0.1, (t) => { tone("square", 420, 420, t, 0.08, 0.09); tone("square", 640, 640, t + 0.07, 0.08, 0.09); tone("square", 860, 860, t + 0.14, 0.14, 0.1); }],
    upgrade: [0.1, (t) => { tone("square", 520, 520, t, 0.09, 0.1); tone("square", 780, 780, t + 0.08, 0.09, 0.1); tone("square", 1040, 1560, t + 0.16, 0.2, 0.11); }],
    wave: [0.4, (t) => { tone("sine", 620, 930, t, 0.22, 0.09, "lin"); }],
    bossWarn: [0.4, (t) => { for (let i = 0; i < 3; i += 1) { tone("sawtooth", 320, 560, t + i * 0.36, 0.2, 0.13, "lin"); tone("sawtooth", 560, 320, t + i * 0.36 + 0.18, 0.16, 0.11, "lin"); } }],
    beamWarn: [0.3, (t) => tone("sawtooth", 200, 480, t, 0.5, 0.08, "lin")],
    beamFire: [0.3, (t) => { noise(t, 0.7, 0.16, 3000, 3); tone("sawtooth", 110, 96, t, 0.7, 0.1); }],
    bossDown: [0.5, (t) => {
      noise(t, 1.1, 0.4, 800); tone("sine", 120, 26, t, 1.1, 0.32);
      tone("square", 523, 523, t + 0.55, 0.12, 0.09); tone("square", 659, 659, t + 0.68, 0.12, 0.09);
      tone("square", 784, 784, t + 0.81, 0.12, 0.09); tone("square", 1046, 1046, t + 0.94, 0.3, 0.1);
    }],
    gameover: [0.5, (t) => { tone("triangle", 420, 105, t, 1.15, 0.2); tone("triangle", 210, 52, t + 0.12, 1.1, 0.14); }],
    record: [0.5, (t) => { [660, 880, 1100, 1320].forEach((f, i) => tone("square", f, f, t + i * 0.11, 0.16, 0.1)); }],
    dash: [0.15, (t) => { noise(t, 0.16, 0.1, 3600, 2); tone("sine", 300, 900, t, 0.14, 0.07, "lin"); }],
    shieldHit: [0.1, (t) => { tone("triangle", 520, 300, t, 0.16, 0.16); noise(t, 0.1, 0.08, 1400); }],
    special: [0.5, (t) => {
      noise(t, 1.2, 0.4, 500); tone("sawtooth", 60, 240, t, 0.5, 0.22, "lin");
      tone("sawtooth", 120, 480, t + 0.1, 0.6, 0.16, "lin"); tone("sine", 90, 24, t + 0.4, 0.8, 0.26);
    }],
    specialReady: [0.5, (t) => { tone("sine", 880, 880, t, 0.1, 0.11); tone("sine", 1320, 1320, t + 0.09, 0.2, 0.12); }],
    nearMiss: [0.3, (t) => tone("triangle", 2100, 1600, t, 0.06, 0.05)],
    repair: [0.2, (t) => { tone("sine", 520, 520, t, 0.12, 0.11); tone("sine", 780, 780, t + 0.1, 0.12, 0.11); tone("sine", 1040, 1040, t + 0.2, 0.2, 0.12); }],
    invuln: [0.2, (t) => { [700, 950, 1250, 1600, 2000].forEach((f, i) => tone("triangle", f, f, t + i * 0.06, 0.12, 0.08)); }],
    slow: [0.2, (t) => { tone("sine", 700, 130, t, 0.7, 0.14, "lin"); tone("sine", 350, 65, t + 0.05, 0.7, 0.1, "lin"); }],
    bossPhase: [0.4, (t) => { for (let i = 0; i < 2; i += 1) { tone("square", 260, 260, t + i * 0.22, 0.12, 0.13); tone("square", 390, 390, t + i * 0.22 + 0.1, 0.12, 0.13); } }],
    coreOpen: [0.3, (t) => { tone("sine", 660, 660, t, 0.1, 0.1); tone("sine", 990, 990, t + 0.08, 0.1, 0.1); tone("sine", 1320, 1320, t + 0.16, 0.18, 0.11); }],
    comboReward: [0.3, (t) => { [523, 659, 784].forEach((f, i) => tone("square", f, f, t + i * 0.07, 0.12, 0.09)); }],
    podDown: [0.2, (t) => { noise(t, 0.3, 0.24, 1500); tone("sine", 240, 60, t, 0.3, 0.18); tone("square", 880, 880, t + 0.16, 0.12, 0.08); }],
  };

  return {
    unlock() {
      if (!ensure()) return;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
    },
    setMuted(v) {
      muted = v;
      if (master) master.gain.value = v ? 0 : 0.5;
    },
    play(name) {
      if (muted || !ctx || ctx.state !== "running") return;
      const def = SOUNDS[name];
      if (!def) return;
      const now = ctx.currentTime;
      if (lastAt[name] && now - lastAt[name] < def[0]) return;
      lastAt[name] = now;
      try { def[1](now); } catch { /* a failed blip is not worth a crash */ }
    },
    dispose() {
      if (ctx) ctx.close().catch(() => {});
      ctx = null;
      master = null;
    },
  };
}
