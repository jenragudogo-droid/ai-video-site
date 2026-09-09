/* ------------------------------------------------------------------ *
 * Castle Defender — synthesised sound and generative music.
 *
 * Nothing is downloaded and nothing is copyrighted: every effect is
 * built from oscillators and filtered noise, and the music is a small
 * generative score in D Dorian — a plucked lute line, a low drone and
 * a frame drum — that changes tempo and density with the battle.
 * The context is created lazily on the first user gesture.
 * ------------------------------------------------------------------ */

export function createCastleAudio() {
  let ctx = null;
  let master = null;
  let sfxBus = null;
  let musicBus = null;
  let noiseBuf = null;
  let soundOn = true;
  let musicOn = true;
  let sfxVol = 0.8;
  let musicVol = 0.55;
  const lastAt = {};

  /* music state */
  let mode = null;                 // menu | calm | battle | boss | null
  let nextBeat = 0;
  let beat = 0;
  let timer = null;
  let bar = 0;
  let drone = null;
  let phraseIdx = 0;

  const ensure = () => {
    if (ctx) return true;
    const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    master.connect(comp).connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = soundOn ? sfxVol : 0; sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = musicOn ? musicVol : 0; musicBus.connect(master);
    const len = ctx.sampleRate * 1.0;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i += 1) d[i] = Math.random() * 2 - 1;
    return true;
  };

  /* --------------------------- building blocks --------------------------- */

  const tone = (type, f0, f1, t0, dur, vol, bus = sfxBus, curve = "exp", attack = 0.004) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(1, f0), t0);
    if (f1 !== f0) {
      if (curve === "exp") o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
      else o.frequency.linearRampToValueAtTime(f1, t0 + dur);
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(bus);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
    return o;
  };

  const noise = (t0, dur, vol, freq = 900, q = 0.7, kind = "lowpass", bus = sfxBus, to = null) => {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = kind;
    f.frequency.setValueAtTime(freq, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, to ?? freq * 0.15), t0 + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(bus);
    src.start(t0);
    src.stop(t0 + dur + 0.03);
  };

  /* a plucked string: bright triangle with a fast lowpass sweep */
  const pluck = (freq, t0, dur, vol, bus = musicBus) => {
    const o = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = "triangle"; o2.type = "sawtooth";
    o.frequency.value = freq; o2.frequency.value = freq * 2.002;
    f.type = "lowpass";
    f.frequency.setValueAtTime(freq * 6, t0);
    f.frequency.exponentialRampToValueAtTime(freq * 1.2, t0 + dur * 0.6);
    f.Q.value = 1.5;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(vol * 0.35, t0 + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    const g2 = ctx.createGain(); g2.gain.value = 0.18;
    o.connect(f); o2.connect(g2).connect(f);
    f.connect(g).connect(bus);
    o.start(t0); o2.start(t0);
    o.stop(t0 + dur + 0.02); o2.stop(t0 + dur + 0.02);
  };

  const flute = (freq, t0, dur, vol, bus = musicBus) => {
    const o = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lg = ctx.createGain();
    const g = ctx.createGain();
    o.type = "sine"; o.frequency.value = freq;
    lfo.frequency.value = 5.2; lg.gain.value = freq * 0.006;
    lfo.connect(lg).connect(o.frequency);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.08);
    g.gain.setValueAtTime(vol, t0 + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(bus);
    o.start(t0); lfo.start(t0);
    o.stop(t0 + dur + 0.02); lfo.stop(t0 + dur + 0.02);
  };

  const drum = (t0, vol, low = true, bus = musicBus) => {
    tone("sine", low ? 110 : 180, low ? 45 : 70, t0, low ? 0.28 : 0.16, vol, bus, "exp", 0.002);
    noise(t0, low ? 0.12 : 0.08, vol * 0.5, low ? 600 : 1800, 0.8, "lowpass", bus);
  };

  const horn = (freq, t0, dur, vol, bus = musicBus) => {
    const o = ctx.createOscillator(); const o2 = ctx.createOscillator();
    const f = ctx.createBiquadFilter(); const g = ctx.createGain();
    o.type = "sawtooth"; o2.type = "sawtooth";
    o.frequency.value = freq; o2.frequency.value = freq * 0.5;
    f.type = "lowpass"; f.frequency.value = freq * 3; f.Q.value = 2;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.06);
    g.gain.setValueAtTime(vol, t0 + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(f); o2.connect(f); f.connect(g).connect(bus);
    o.start(t0); o2.start(t0); o.stop(t0 + dur + 0.02); o2.stop(t0 + dur + 0.02);
  };

  /* ------------------------------- effects ------------------------------- */

  const SOUNDS = {
    arrow: [0.05, (t) => { noise(t, 0.12, 0.12, 2600, 1.2, "bandpass"); tone("sine", 1400, 500, t, 0.08, 0.03); }],
    enemyShoot: [0.06, (t) => { noise(t, 0.1, 0.08, 2000, 1.2, "bandpass"); }],
    arrowHit: [0.05, (t) => { noise(t, 0.06, 0.16, 1200, 1, "lowpass"); tone("triangle", 300, 120, t, 0.06, 0.08); }],
    bolt: [0.1, (t) => { tone("sawtooth", 160, 40, t, 0.18, 0.12); noise(t, 0.16, 0.16, 1800, 1, "bandpass"); tone("sine", 900, 200, t, 0.1, 0.06); }],
    catapult: [0.15, (t) => { tone("sawtooth", 90, 60, t, 0.35, 0.08, sfxBus, "lin"); noise(t + 0.05, 0.25, 0.14, 700, 0.8); tone("square", 70, 40, t + 0.2, 0.15, 0.06); }],
    stoneImpact: [0.08, (t) => { noise(t, 0.45, 0.4, 900, 0.7); tone("sine", 140, 30, t, 0.45, 0.32); tone("triangle", 70, 30, t, 0.3, 0.12); }],
    fireImpact: [0.08, (t) => { noise(t, 0.5, 0.38, 1200, 0.7); tone("sine", 130, 30, t, 0.45, 0.3); noise(t + 0.1, 0.6, 0.12, 3000, 0.5, "highpass"); }],
    sword: [0.06, (t) => { tone("triangle", 2200 + Math.random() * 600, 900, t, 0.12, 0.08); tone("sine", 3400, 2600, t, 0.08, 0.04); noise(t, 0.05, 0.1, 5000, 1, "highpass"); }],
    hit: [0.06, (t) => { noise(t, 0.08, 0.14, 800, 0.9); tone("sine", 220, 90, t, 0.1, 0.08); }],
    shieldBlock: [0.08, (t) => { noise(t, 0.08, 0.16, 600, 0.9); tone("triangle", 520, 380, t, 0.18, 0.1); tone("sine", 1600, 1200, t, 0.1, 0.03); }],
    block: [0.08, (t) => { noise(t, 0.07, 0.14, 700, 0.9); tone("triangle", 640, 420, t, 0.14, 0.08); }],
    die: [0.05, (t) => { noise(t, 0.16, 0.14, 500, 0.8); tone("sawtooth", 180, 60, t, 0.16, 0.05); }],
    unitDown: [0.1, (t) => { noise(t, 0.2, 0.16, 400, 0.8); tone("triangle", 200, 60, t, 0.25, 0.08); }],
    heroDown: [0.5, (t) => { tone("triangle", 330, 165, t, 0.6, 0.14); tone("triangle", 262, 131, t + 0.3, 0.7, 0.12); noise(t, 0.3, 0.14, 500, 0.8); }],
    heroReturn: [0.5, (t) => { horn(294, t, 0.3, 0.1, sfxBus); horn(392, t + 0.25, 0.5, 0.11, sfxBus); }],
    coin: [0.04, (t) => { tone("sine", 1560, 1560, t, 0.07, 0.07); tone("sine", 2340, 2340, t + 0.05, 0.14, 0.06); }],
    build: [0.3, (t) => { for (let i = 0; i < 3; i += 1) { noise(t + i * 0.13, 0.05, 0.16, 1500, 1); tone("square", 600 - i * 60, 300, t + i * 0.13, 0.05, 0.05); } tone("sine", 520, 780, t + 0.4, 0.2, 0.06, sfxBus, "lin"); }],
    upgrade: [0.3, (t) => { [440, 554, 659, 880].forEach((f, i) => tone("triangle", f, f, t + i * 0.09, 0.22, 0.08)); noise(t, 0.08, 0.1, 1500, 1); noise(t + 0.13, 0.08, 0.1, 1500, 1); }],
    sell: [0.3, (t) => { [1560, 1240, 1040, 880].forEach((f, i) => tone("sine", f, f, t + i * 0.06, 0.1, 0.06)); }],
    select: [0.04, (t) => { tone("square", 900, 700, t, 0.04, 0.03); }],
    open: [0.05, (t) => { tone("sine", 660, 990, t, 0.08, 0.05, sfxBus, "lin"); }],
    close: [0.05, (t) => { tone("sine", 990, 660, t, 0.08, 0.04, sfxBus, "lin"); }],
    error: [0.15, (t) => { tone("square", 220, 180, t, 0.14, 0.06); tone("square", 165, 140, t + 0.1, 0.14, 0.06); }],
    wave: [0.5, (t) => { for (let i = 0; i < 6; i += 1) drum(t + i * 0.07, 0.12, i % 2 === 0, sfxBus); horn(196, t + 0.4, 0.5, 0.12, sfxBus); horn(294, t + 0.8, 0.7, 0.13, sfxBus); }],
    waveClear: [0.5, (t) => { [392, 494, 587, 784].forEach((f, i) => tone("triangle", f, f, t + i * 0.1, 0.3, 0.09)); }],
    earlyBonus: [0.3, (t) => { [784, 988, 1175].forEach((f, i) => tone("sine", f, f, t + i * 0.07, 0.16, 0.07)); }],
    gateHit: [0.15, (t) => { noise(t, 0.5, 0.42, 700, 0.6); tone("sine", 90, 28, t, 0.55, 0.36); tone("triangle", 60, 30, t, 0.4, 0.14); noise(t + 0.15, 0.4, 0.1, 300, 0.6); }],
    gateHitSiege: [0.3, (t) => { noise(t, 0.9, 0.5, 600, 0.6); tone("sine", 70, 22, t, 0.9, 0.42); tone("square", 50, 25, t, 0.5, 0.1); noise(t + 0.3, 0.8, 0.14, 200, 0.6); }],
    march: [0.6, (t) => { for (let i = 0; i < 4; i += 1) drum(t + i * 0.16, 0.1, i % 2 === 0, sfxBus); }],
    hooves: [0.25, (t) => { for (let i = 0; i < 4; i += 1) { noise(t + i * 0.09, 0.04, 0.12, 900, 1.2, "bandpass"); } }],
    charge: [0.5, (t) => { noise(t, 0.4, 0.2, 3000, 0.8, "bandpass", sfxBus, 400); horn(330, t, 0.35, 0.12, sfxBus); horn(440, t + 0.2, 0.5, 0.12, sfxBus); }],
    chargeHit: [0.05, (t) => { noise(t, 0.1, 0.18, 900, 0.9); tone("triangle", 400, 120, t, 0.14, 0.1); }],
    heroLevel: [0.5, (t) => { [523, 659, 784, 1047].forEach((f, i) => tone("sine", f, f, t + i * 0.09, 0.35, 0.09)); tone("sine", 1568, 1568, t + 0.4, 0.5, 0.06); }],
    victory: [1, (t) => { const seq = [[392, 0], [523, 0.18], [659, 0.36], [784, 0.54], [659, 0.9], [784, 1.08], [1047, 1.3]]; seq.forEach(([f, d]) => { horn(f, t + d, 0.35, 0.12, sfxBus); tone("triangle", f * 2, f * 2, t + d, 0.3, 0.04); }); for (let i = 0; i < 8; i += 1) drum(t + 1.3 + i * 0.12, 0.1, i % 2 === 0, sfxBus); }],
    defeat: [1, (t) => { [0, 0.9, 1.8].forEach((d, i) => { tone("sine", 130 - i * 8, 120 - i * 8, t + d, 1.4, 0.2); tone("sine", 260 - i * 16, 245 - i * 16, t + d, 1.2, 0.08); noise(t + d, 0.3, 0.08, 400, 0.7); }); }],
    miniboss: [1, (t) => { horn(110, t, 0.9, 0.16, sfxBus); horn(147, t + 0.5, 0.9, 0.16, sfxBus); for (let i = 0; i < 6; i += 1) drum(t + i * 0.18, 0.14, true, sfxBus); }],
    minibossDown: [0.5, (t) => { noise(t, 0.8, 0.4, 800, 0.7); tone("sine", 120, 26, t, 0.9, 0.3); [523, 659, 784].forEach((f, i) => tone("triangle", f, f, t + 0.6 + i * 0.1, 0.25, 0.08)); }],
    routeOpen: [1, (t) => { horn(262, t, 0.25, 0.12, sfxBus); horn(262, t + 0.3, 0.25, 0.12, sfxBus); horn(349, t + 0.6, 0.6, 0.14, sfxBus); }],
    volley: [0.5, (t) => { for (let i = 0; i < 10; i += 1) noise(t + i * 0.03, 0.14, 0.06, 2600, 1.2, "bandpass"); tone("sine", 900, 500, t, 0.3, 0.04); }],
    strike: [0.2, (t) => { for (let i = 0; i < 5; i += 1) { noise(t + i * 0.025, 0.06, 0.1, 1200, 1); } }],
    reinforce: [0.5, (t) => { for (let i = 0; i < 3; i += 1) drum(t + i * 0.14, 0.12, i !== 1, sfxBus); tone("triangle", 392, 392, t + 0.3, 0.2, 0.06); }],
    repair: [0.3, (t) => { for (let i = 0; i < 4; i += 1) { noise(t + i * 0.11, 0.04, 0.12, 2000, 1); tone("square", 700, 500, t + i * 0.11, 0.04, 0.04); } tone("sine", 660, 880, t + 0.5, 0.2, 0.05, sfxBus, "lin"); }],
    breakFree: [0.3, (t) => { tone("sawtooth", 500, 900, t, 0.25, 0.06, sfxBus, "lin"); noise(t, 0.2, 0.12, 1200, 0.8); }],
    fire: [0.4, (t) => { noise(t, 0.6, 0.08, 2500, 0.5, "highpass"); }],
    stun: [0.2, (t) => { tone("sine", 1200, 900, t, 0.1, 0.05); tone("sine", 1500, 1100, t + 0.1, 0.1, 0.04); }],
    spawnRam: [1, (t) => { for (let i = 0; i < 3; i += 1) { noise(t + i * 0.3, 0.25, 0.14, 300, 0.6); tone("sine", 60, 40, t + i * 0.3, 0.3, 0.14); } }],
    intro: [1, (t) => { horn(147, t, 1.2, 0.1, sfxBus); horn(220, t + 0.9, 1.4, 0.1, sfxBus); for (let i = 0; i < 8; i += 1) drum(t + 1.8 + i * 0.2, 0.08, i % 2 === 0, sfxBus); }],
    star: [0.1, (t) => { tone("sine", 1047, 1047, t, 0.3, 0.09); tone("sine", 1568, 1568, t + 0.05, 0.4, 0.07); }],
    /* Stage II cavalry */
    gallop: [0.3, (t) => { for (let i = 0; i < 6; i += 1) { const d = i * 0.075 + (i % 3 === 2 ? 0.03 : 0); noise(t + d, 0.045, 0.14, 700, 1.4, "bandpass"); tone("sine", 140, 90, t + d, 0.05, 0.05); } }],
    chargeHorn: [1.2, (t) => { horn(262, t, 0.28, 0.14, sfxBus); horn(262, t + 0.3, 0.28, 0.14, sfxBus); horn(392, t + 0.6, 0.8, 0.16, sfxBus); tone("triangle", 784, 784, t + 0.6, 0.6, 0.04); }],
    chargeGo: [0.5, (t) => { noise(t, 0.5, 0.22, 500, 0.8, "lowpass", sfxBus, 120); for (let i = 0; i < 8; i += 1) noise(t + i * 0.06, 0.04, 0.16, 800, 1.4, "bandpass"); }],
    armour: [0.4, (t) => { for (let i = 0; i < 3; i += 1) { noise(t + i * 0.08, 0.05, 0.08, 3200, 2, "bandpass"); tone("triangle", 1800 + i * 200, 1400, t + i * 0.08, 0.05, 0.03); } }],
    cavImpact: [0.12, (t) => { noise(t, 0.28, 0.34, 600, 0.8); tone("sine", 120, 40, t, 0.3, 0.26); tone("triangle", 2400, 900, t, 0.12, 0.08); noise(t + 0.05, 0.12, 0.12, 4000, 1, "highpass"); }],
    chargeBroken: [0.4, (t) => { noise(t, 0.2, 0.26, 900, 0.9); tone("sawtooth", 600, 180, t, 0.3, 0.1); tone("sine", 90, 40, t, 0.35, 0.2); [523, 659].forEach((f, i) => tone("triangle", f, f, t + 0.3 + i * 0.1, 0.2, 0.08)); }],
    brace: [0.5, (t) => { for (let i = 0; i < 3; i += 1) { noise(t + i * 0.05, 0.03, 0.14, 1400, 1.2); tone("square", 300, 220, t + i * 0.05, 0.04, 0.05); } }],
    rear: [0.6, (t) => { tone("sawtooth", 700, 1100, t, 0.18, 0.05, sfxBus, "lin"); tone("sawtooth", 1100, 500, t + 0.18, 0.3, 0.05, sfxBus, "lin"); noise(t, 0.3, 0.06, 2000, 1.2, "bandpass"); }],
    commanderEnter: [1.5, (t) => { horn(110, t, 1.0, 0.16, sfxBus); horn(165, t + 0.6, 1.0, 0.16, sfxBus); horn(220, t + 1.2, 1.4, 0.18, sfxBus); for (let i = 0; i < 8; i += 1) drum(t + i * 0.16, 0.14, i % 2 === 0, sfxBus); for (let i = 0; i < 6; i += 1) noise(t + 1.6 + i * 0.075, 0.045, 0.12, 700, 1.4, "bandpass"); }],
    order: [0.12, (t) => { tone("square", 700, 900, t, 0.05, 0.04, sfxBus, "lin"); tone("sine", 1200, 1200, t + 0.05, 0.06, 0.04); }],
    shieldBrace: [0.3, (t) => { for (let i = 0; i < 3; i += 1) { noise(t + i * 0.06, 0.05, 0.14, 900, 1); tone("triangle", 600 - i * 80, 400, t + i * 0.06, 0.06, 0.06); } tone("sine", 1400, 1400, t + 0.2, 0.15, 0.04); }],
    perk: [0.5, (t) => { [523, 659, 784, 1047, 1319].forEach((f, i) => tone("sine", f, f, t + i * 0.07, 0.35, 0.08)); noise(t, 0.3, 0.06, 4000, 0.5, "highpass"); }],
    unlock: [0.8, (t) => { horn(330, t, 0.35, 0.1, sfxBus); horn(440, t + 0.3, 0.35, 0.1, sfxBus); horn(660, t + 0.6, 0.7, 0.12, sfxBus); [1047, 1319].forEach((f, i) => tone("sine", f, f, t + 0.7 + i * 0.1, 0.4, 0.05)); }],
    watchfire: [0.6, (t) => { noise(t, 0.6, 0.2, 2200, 0.6, "bandpass", sfxBus, 300); tone("sawtooth", 200, 400, t, 0.5, 0.05, sfxBus, "lin"); for (let i = 0; i < 4; i += 1) noise(t + 0.2 + i * 0.1, 0.2, 0.06, 3000, 0.5, "highpass"); }],
    royalRally: [0.8, (t) => { horn(392, t, 0.3, 0.12, sfxBus); horn(523, t + 0.28, 0.3, 0.12, sfxBus); horn(659, t + 0.56, 0.8, 0.14, sfxBus); for (let i = 0; i < 4; i += 1) drum(t + i * 0.14, 0.1, i % 2 === 0, sfxBus); }],
    resume: [0.5, (t) => { [523, 784].forEach((f, i) => tone("triangle", f, f, t + i * 0.12, 0.25, 0.08)); }],
    /* Stage III siege */
    warDrums: [1.5, (t) => { for (let i = 0; i < 12; i += 1) drum(t + i * 0.16, i % 4 === 0 ? 0.18 : 0.1, i % 2 === 0, sfxBus); horn(110, t + 1.0, 1.2, 0.14, sfxBus); horn(147, t + 1.6, 1.4, 0.14, sfxBus); }],
    catapultLaunch: [0.4, (t) => { tone("sawtooth", 70, 40, t, 0.4, 0.1, sfxBus, "lin"); noise(t + 0.05, 0.35, 0.16, 500, 0.7); tone("square", 50, 30, t + 0.25, 0.2, 0.06); noise(t + 0.3, 0.5, 0.06, 2600, 0.6, "bandpass"); }],
    siegeStone: [0.3, (t) => { noise(t, 0.7, 0.5, 700, 0.6); tone("sine", 60, 20, t, 0.8, 0.4); tone("triangle", 45, 25, t, 0.5, 0.14); noise(t + 0.2, 0.7, 0.16, 1400, 0.5); }],
    wallHit: [0.3, (t) => { noise(t, 0.5, 0.4, 900, 0.7); tone("sine", 110, 30, t, 0.5, 0.3); }],
    wallBreach: [2, (t) => { noise(t, 1.6, 0.5, 400, 0.5); tone("sine", 50, 18, t, 1.6, 0.42); for (let i = 0; i < 5; i += 1) noise(t + 0.2 + i * 0.22, 0.3, 0.2, 800 - i * 100, 0.7); horn(98, t + 0.6, 1.4, 0.14, sfxBus); }],
    ramWall: [0.5, (t) => { noise(t, 0.6, 0.45, 600, 0.6); tone("sine", 65, 22, t, 0.7, 0.4); tone("square", 48, 24, t, 0.4, 0.08); }],
    towerDock: [1, (t) => { tone("sawtooth", 120, 60, t, 0.9, 0.06, sfxBus, "lin"); noise(t, 0.9, 0.12, 600, 0.6); noise(t + 0.9, 0.3, 0.3, 900, 0.7); tone("sine", 90, 30, t + 0.9, 0.4, 0.26); }],
    towerBurn: [0.4, (t) => { noise(t, 0.7, 0.16, 2600, 0.5, "highpass"); tone("sawtooth", 160, 320, t, 0.4, 0.05, sfxBus, "lin"); }],
    hammer: [0.2, (t) => { noise(t, 0.05, 0.14, 1800, 1); tone("square", 800, 500, t, 0.05, 0.05); }],
    shieldWall: [0.5, (t) => { for (let i = 0; i < 4; i += 1) { noise(t + i * 0.07, 0.06, 0.16, 800, 1); tone("triangle", 500 - i * 60, 380, t + i * 0.07, 0.07, 0.07); } tone("sine", 220, 220, t + 0.3, 0.3, 0.05); }],
    pikeWall: [0.5, (t) => { for (let i = 0; i < 4; i += 1) { noise(t + i * 0.06, 0.03, 0.14, 1400, 1.2); tone("square", 320, 240, t + i * 0.06, 0.04, 0.05); } }],
    oil: [0.6, (t) => { noise(t, 0.5, 0.2, 2000, 0.6, "bandpass", sfxBus, 300); noise(t + 0.3, 0.9, 0.26, 3000, 0.5, "highpass"); tone("sawtooth", 100, 260, t + 0.3, 0.6, 0.06, sfxBus, "lin"); }],
    barrage: [0.6, (t) => { for (let i = 0; i < 3; i += 1) { tone("sawtooth", 80, 50, t + i * 0.16, 0.3, 0.08, sfxBus, "lin"); noise(t + 0.05 + i * 0.16, 0.2, 0.12, 700, 0.8); } }],
    emergencyRepair: [0.6, (t) => { for (let i = 0; i < 6; i += 1) { noise(t + i * 0.08, 0.04, 0.14, 2000, 1); tone("square", 700 + (i % 2) * 120, 500, t + i * 0.08, 0.04, 0.05); } [523, 659, 784].forEach((f, i) => tone("triangle", f, f, t + 0.5 + i * 0.08, 0.3, 0.07)); }],
    bossEnter: [2, (t) => { for (let i = 0; i < 8; i += 1) drum(t + i * 0.2, i % 2 ? 0.1 : 0.2, i % 2 === 0, sfxBus); horn(82, t + 0.4, 1.6, 0.18, sfxBus); horn(110, t + 1.2, 1.6, 0.18, sfxBus); horn(123, t + 2.0, 2.0, 0.2, sfxBus); }],
    bossHornWind: [1, (t) => { horn(147, t, 0.5, 0.14, sfxBus); horn(147, t + 0.5, 0.5, 0.14, sfxBus); horn(196, t + 1.0, 1.0, 0.18, sfxBus); }],
    bossSweepWind: [0.6, (t) => { tone("sawtooth", 90, 180, t, 0.9, 0.08, sfxBus, "lin"); noise(t, 0.9, 0.1, 400, 0.6); }],
    bossSweep: [0.3, (t) => { noise(t, 0.4, 0.4, 700, 0.7); tone("sine", 80, 30, t, 0.5, 0.34); tone("triangle", 2600, 900, t, 0.14, 0.08); noise(t + 0.08, 0.3, 0.2, 2200, 0.8, "bandpass"); }],
    bossRage: [2, (t) => { horn(73, t, 1.8, 0.2, sfxBus); horn(98, t + 0.3, 1.8, 0.18, sfxBus); for (let i = 0; i < 10; i += 1) drum(t + i * 0.12, 0.14, i % 2 === 0, sfxBus); noise(t, 1.2, 0.12, 300, 0.5); }],
    bossDown: [3, (t) => { noise(t, 1.2, 0.45, 600, 0.6); tone("sine", 70, 20, t, 1.4, 0.4); [392, 523, 659, 784, 1047].forEach((f, i) => horn(f, t + 0.8 + i * 0.22, 0.9, 0.12, sfxBus)); }],
    kingsCharge: [0.8, (t) => { noise(t, 0.5, 0.24, 2800, 0.8, "bandpass", sfxBus, 400); horn(392, t, 0.3, 0.14, sfxBus); horn(523, t + 0.2, 0.3, 0.14, sfxBus); horn(659, t + 0.4, 0.8, 0.16, sfxBus); noise(t + 0.5, 0.4, 0.3, 500, 0.7); }],
    conquered: [3, (t) => { const seq = [[392, 0], [523, 0.2], [659, 0.4], [784, 0.6], [1047, 0.9], [784, 1.4], [1047, 1.6], [1319, 1.9], [1047, 2.5], [1319, 2.7], [1568, 3.0]]; seq.forEach(([f, d]) => horn(f, t + d, 0.5, 0.14, sfxBus)); for (let i = 0; i < 12; i += 1) drum(t + i * 0.25, 0.14, i % 2 === 0, sfxBus); }],
    catapultWind: [0.8, (t) => { for (let i = 0; i < 6; i += 1) { tone("sawtooth", 140 + i * 18, 150 + i * 18, t + i * 0.18, 0.16, 0.035, sfxBus, "lin"); noise(t + i * 0.18, 0.1, 0.05, 900, 0.8); } }],
    wallCrack: [1, (t) => { noise(t, 0.35, 0.3, 1200, 0.7); tone("sine", 90, 40, t, 0.5, 0.26); for (let i = 0; i < 4; i += 1) noise(t + 0.15 + i * 0.12, 0.12, 0.16, 2200 - i * 300, 0.9, "bandpass"); }],
    gateFailing: [1.5, (t) => { horn(98, t, 0.6, 0.14, sfxBus); horn(92, t + 0.5, 1.2, 0.16, sfxBus); noise(t, 0.6, 0.2, 500, 0.6); for (let i = 0; i < 4; i += 1) drum(t + 0.2 + i * 0.22, 0.12, true, sfxBus); }],
    bossOpen: [0.4, (t) => { tone("sine", 1047, 1047, t, 0.25, 0.08); tone("sine", 1568, 1568, t + 0.08, 0.35, 0.07); noise(t, 0.12, 0.05, 4000, 0.5, "highpass"); }],
    bossRoar: [1.6, (t) => { tone("sawtooth", 70, 55, t, 1.4, 0.12, sfxBus, "lin"); noise(t, 1.4, 0.16, 300, 0.6); for (let i = 0; i < 6; i += 1) drum(t + i * 0.16, 0.14, i % 2 === 0, sfxBus); horn(65, t + 0.3, 1.2, 0.16, sfxBus); }],
    rout: [1.5, (t) => { horn(392, t, 0.3, 0.12, sfxBus); horn(523, t + 0.25, 0.3, 0.12, sfxBus); horn(659, t + 0.5, 0.4, 0.14, sfxBus); horn(784, t + 0.8, 0.9, 0.16, sfxBus); for (let i = 0; i < 8; i += 1) noise(t + 1.0 + i * 0.07, 0.05, 0.08, 800, 1.2, "bandpass"); }],
    /* ---------------------------- the Frozen North --------------------------- */
    /* A wolf on a ridge: a slow rise, a held note, a fall, over thin wind. */
    wolfHowl: [1.6, (t) => {
      tone("sawtooth", 240, 430, t, 0.5, 0.07, sfxBus, "lin");
      tone("sawtooth", 430, 415, t + 0.5, 0.7, 0.08, sfxBus, "lin");
      tone("sawtooth", 415, 210, t + 1.15, 0.55, 0.06, sfxBus, "lin");
      tone("sine", 860, 830, t + 0.5, 0.7, 0.02);
      noise(t, 1.8, 0.05, 700, 0.5, "bandpass");
    }],
    /* The storm arriving: noise swelling up through a rising filter. */
    blizzard: [4, (t) => {
      noise(t, 2.6, 0.16, 900, 0.4, "highpass", sfxBus, 2600);
      noise(t + 0.3, 2.4, 0.1, 400, 0.5);
      tone("sine", 62, 58, t, 2.4, 0.07, sfxBus, "lin");
      for (let i = 0; i < 5; i += 1) tone("sine", 1500 + i * 260, 1100 + i * 260, t + i * 0.22, 0.5, 0.012);
    }],
    /* the wind getting up: a rising hiss, no melody, so it reads as weather */
    windRise: [3, (t) => { noise(t, 2.2, 0.1, 300, 0.5, "highpass", sfxBus, 1800); tone("sine", 90, 150, t, 2.0, 0.05, sfxBus, "lin"); }],
    windEase: [2, (t) => { noise(t, 1.4, 0.11, 2200, 0.5, "highpass", sfxBus, 500); tone("sine", 520, 392, t, 0.7, 0.03); }],
    /* Ice: struck, broken, re-formed. Bandpassed noise plus glassy partials. */
    shellHit: [0.05, (t) => { noise(t, 0.06, 0.13, 3200, 2.2, "bandpass"); tone("sine", 2300, 1700, t, 0.07, 0.03); }],
    shellBreak: [1.2, (t) => {
      noise(t, 0.5, 0.34, 2600, 0.8, "highpass");
      tone("sine", 90, 40, t, 0.4, 0.18);
      [2960, 2350, 1970, 1560, 1180].forEach((f, i) => tone("triangle", f, f * 0.72, t + i * 0.045, 0.3, 0.055));
      for (let i = 0; i < 7; i += 1) noise(t + 0.12 + i * 0.06, 0.07, 0.12, 4200 - i * 380, 2.4, "bandpass");
    }],
    shellReform: [1.5, (t) => { [740, 988, 1319, 1760].forEach((f, i) => tone("sine", f, f, t + i * 0.1, 0.35, 0.05)); noise(t, 0.4, 0.07, 3400, 1.4, "bandpass"); }],
    /* The nova: a held rising shimmer, then cold weight. */
    novaWind: [1, (t) => { tone("sine", 700, 1500, t, 1.1, 0.045, sfxBus, "lin"); noise(t, 1.1, 0.07, 2400, 1.6, "bandpass"); }],
    frostNova: [0.6, (t) => {
      tone("sine", 150, 44, t, 0.7, 0.3);
      noise(t, 0.55, 0.28, 1500, 0.6);
      [1760, 1319, 988].forEach((f, i) => tone("triangle", f, f * 0.6, t + 0.04 + i * 0.05, 0.4, 0.06));
      noise(t + 0.1, 0.5, 0.1, 5200, 0.6, "highpass");
    }],
    /* Elara: a bowstring, an icy head, a small burst where it lands. */
    bowShot: [0.05, (t) => { tone("triangle", 300, 150, t, 0.09, 0.06); noise(t, 0.1, 0.1, 2800, 1.4, "bandpass"); }],
    frostArrow: [0.4, (t) => { tone("sine", 1200, 2200, t, 0.3, 0.05, sfxBus, "lin"); noise(t, 0.3, 0.1, 3200, 1.6, "bandpass"); tone("triangle", 660, 990, t, 0.2, 0.04); }],
    frostBurst: [0.25, (t) => {
      noise(t, 0.3, 0.2, 2000, 0.9);
      tone("sine", 200, 70, t, 0.3, 0.12);
      [1568, 1175, 880].forEach((f, i) => tone("sine", f, f * 0.68, t + i * 0.05, 0.28, 0.045));
    }],
    evade: [0.25, (t) => { noise(t, 0.14, 0.09, 1800, 1.1, "bandpass", sfxBus, 3600); tone("sine", 880, 1320, t, 0.1, 0.025); }],
    drill: [0.4, (t) => { for (let i = 0; i < 3; i += 1) { noise(t + i * 0.09, 0.04, 0.14, 1200, 1); tone("square", 500, 380, t + i * 0.09, 0.05, 0.04); } tone("triangle", 660, 990, t + 0.3, 0.2, 0.06, sfxBus, "lin"); }],
  };

  /* -------------------------------- music -------------------------------- */

  /* D Dorian across two octaves (D3 = 146.83) */
  const SCALE = [146.83, 164.81, 174.61, 196.0, 220.0, 246.94, 261.63, 293.66, 329.63, 349.23, 392.0, 440.0, 493.88, 523.25, 587.33];
  const PHRASES = [
    [7, 9, 10, 9, 7, 5, 7, -1], [7, 10, 12, 10, 9, 7, 5, -1], [4, 7, 9, 7, 4, 2, 0, -1],
    [7, 7, 9, 10, 12, 10, 9, 7], [5, 7, 9, 5, 7, 9, 10, -1], [12, 10, 9, 7, 9, 7, 5, 4], [0, 4, 7, 9, 7, 4, 2, 0],
  ];
  const BATTLE_PHRASES = [
    [7, 7, 10, 7, 12, 10, 9, 7], [7, 9, 10, 12, 10, 9, 7, 5], [4, 4, 7, 4, 9, 7, 5, 4], [12, 12, 10, 9, 10, 9, 7, 7],
  ];
  const BOSS_PHRASES = [
    [0, 0, 3, 0, 5, 3, 0, 0], [0, 3, 5, 3, 0, -1, 2, 0], [7, 7, 5, 3, 0, 0, 2, 3],
  ];

  const SIEGE_PHRASES = [
    [0, 0, 2, 3, 0, 0, 5, 3], [0, 3, 2, 0, -1, 0, 2, 3], [7, 5, 3, 2, 0, 0, 2, 0], [3, 3, 5, 7, 5, 3, 2, 0],
  ];
  /* The north: the same D Dorian world, but minor-leaning and sparser, so a
     frost stage sounds like the same game in a colder place. */
  const FROST_PHRASES = [
    [7, 5, 3, 5, 7, -1, 10, 7], [0, 3, 7, 3, 0, -1, -1, 2], [10, 9, 7, 5, 3, -1, 2, 0], [7, 7, 10, 12, 10, 7, 5, -1],
  ];
  const tempo = () => (mode === "boss" ? 132 : mode === "siege" ? 120 : mode === "battle" ? 112 : mode === "frost" ? 96 : mode === "menu" ? 72 : 84);

  const startDrone = () => {
    if (drone || !ctx) return;
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    g.gain.linearRampToValueAtTime(0.09, ctx.currentTime + 2);
    const o1 = ctx.createOscillator(); const o2 = ctx.createOscillator(); const o3 = ctx.createOscillator();
    o1.type = "triangle"; o2.type = "sine"; o3.type = "sine";
    o1.frequency.value = 73.42; o2.frequency.value = 73.42 * 1.5; o3.frequency.value = 73.42 * 2.003;
    const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 300;
    const lfo = ctx.createOscillator(); const lg = ctx.createGain();
    lfo.frequency.value = 0.15; lg.gain.value = 80; lfo.connect(lg).connect(f.frequency);
    o1.connect(f); o2.connect(f); o3.connect(f); f.connect(g).connect(musicBus);
    o1.start(); o2.start(); o3.start(); lfo.start();
    drone = { g, stop() { const t = ctx.currentTime; g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0.0001, t + 1.2); setTimeout(() => { try { o1.stop(); o2.stop(); o3.stop(); lfo.stop(); } catch { /* fine */ } }, 1400); } };
  };

  const stopDrone = () => { if (drone) { drone.stop(); drone = null; } };

  const scheduleBeat = (t) => {
    const bpm = tempo();
    const step = 60 / bpm / 2;            // eighth notes
    const i = beat % 8;
    if (i === 0) { bar += 1; if (bar % 2 === 0) phraseIdx = Math.floor(Math.random() * 100); }
    const bank = mode === "boss" ? BOSS_PHRASES : mode === "siege" ? SIEGE_PHRASES : mode === "frost" ? FROST_PHRASES : mode === "battle" ? BATTLE_PHRASES : PHRASES;
    const phrase = bank[phraseIdx % bank.length];
    const deg = phrase[i];
    const lead = mode === "menu" ? (bar % 2 === 0) : true;
    if (deg >= 0 && lead) {
      const f = SCALE[deg];
      if (mode === "menu" || mode === "calm" || mode === "frost") {
        pluck(f, t, step * 1.8, 0.16);
        if (i % 4 === 0 && bar % 4 === 1) flute(f * 2, t, step * 3.5, 0.05);
      } else {
        pluck(f, t, step * 1.3, mode === "boss" ? 0.14 : 0.16);
        if (mode === "boss" && i % 4 === 0) horn(SCALE[0] * (bar % 2 ? 1 : 0.75), t, step * 1.6, 0.09);
      }
    }
    /* bass pluck on the downbeat, fifth on beat 5 */
    if (i === 0) pluck(SCALE[0] / 2, t, step * 3, 0.14);
    if (i === 4) pluck(SCALE[(mode === "boss" ? 3 : 4)] / 2, t, step * 3, 0.1);
    /* drums */
    if (mode === "battle" || mode === "boss" || mode === "siege") {
      if (i === 0 || i === 4) drum(t, mode === "siege" ? 0.2 : 0.16, true);
      if (i === 2 || i === 6) drum(t, 0.08, false);
      if (mode === "siege" && (i === 3 || i === 7)) drum(t, 0.12, true);
      if (mode === "siege" && i === 0 && bar % 4 === 0) horn(SCALE[0] * 0.5, t, step * 3, 0.08);
      if (mode === "boss" && (i === 3 || i === 7)) drum(t, 0.1, false);
      if (mode === "boss" && i === 7 && bar % 4 === 0) for (let k = 0; k < 4; k += 1) drum(t + k * step * 0.25, 0.07, false);
    } else if (mode === "calm") {
      if (i === 0) drum(t, 0.08, true);
      if (i === 5) drum(t, 0.04, false);
    }
    beat += 1;
    return step;
  };

  const tick = () => {
    if (!ctx || !mode || !musicOn) return;
    const now = ctx.currentTime;
    if (nextBeat < now - 0.5) nextBeat = now + 0.05;
    while (nextBeat < now + 0.35) nextBeat += scheduleBeat(nextBeat);
  };

  const setMode = (m) => {
    if (m === mode) return;
    mode = m;
    if (!ctx) return;
    if (!m) { stopDrone(); if (timer) { clearInterval(timer); timer = null; } return; }
    startDrone();
    if (!timer) timer = setInterval(tick, 100);
    beat = 0; bar = 0;
    nextBeat = ctx.currentTime + 0.1;
  };

  return {
    unlock() {
      if (!ensure()) return;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      if (mode && !timer && musicOn) { startDrone(); timer = setInterval(tick, 100); nextBeat = ctx.currentTime + 0.1; }
    },
    setSound(v) { soundOn = !!v; if (sfxBus) sfxBus.gain.value = soundOn ? sfxVol : 0; },
    setMusic(v) {
      musicOn = !!v;
      if (musicBus) musicBus.gain.value = musicOn ? musicVol : 0;
      if (!musicOn) { stopDrone(); if (timer) { clearInterval(timer); timer = null; } }
      else if (mode && ctx) { startDrone(); if (!timer) timer = setInterval(tick, 100); nextBeat = ctx.currentTime + 0.1; }
    },
    setVolumes(s, m) {
      sfxVol = s; musicVol = m;
      if (sfxBus) sfxBus.gain.value = soundOn ? sfxVol : 0;
      if (musicBus) musicBus.gain.value = musicOn ? musicVol : 0;
    },
    play(name) {
      if (!soundOn || !ctx || ctx.state !== "running") return;
      const def = SOUNDS[name];
      if (!def) return;
      const now = ctx.currentTime;
      if (lastAt[name] && now - lastAt[name] < def[0]) return;
      lastAt[name] = now;
      try { def[1](now); } catch { /* a failed blip is not worth a crash */ }
    },
    music(m) { setMode(m); },
    get mode() { return mode; },
    dispose() {
      if (timer) clearInterval(timer);
      timer = null;
      stopDrone();
      if (ctx) ctx.close().catch(() => {});
      ctx = null; master = null; sfxBus = null; musicBus = null;
    },
  };
}
