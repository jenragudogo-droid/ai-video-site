/* ------------------------------------------------------------------ *
 * Kianimation Endless Rush — audio.
 *
 * Every sound in the game is synthesised at runtime from oscillators and
 * a short noise buffer. There are no audio files, nothing is fetched and
 * nothing is sampled from anywhere, so the whole soundtrack is original
 * and adds nothing to the download.
 *
 * The music is a small generative loop — a walking bass, an off-beat
 * pluck and a hat — scheduled with a 120 ms lookahead so it stays in
 * time even while the main thread is busy drawing. Its tempo and
 * brightness follow the runner's speed, which does more for the sense of
 * acceleration than the speed number in the HUD does.
 *
 * Browsers will not start an AudioContext until the player has touched
 * something, so `unlock()` must be called from inside a real gesture.
 * ------------------------------------------------------------------ */

const A_MINOR_PENT = [0, 3, 5, 7, 10];
const BASS_ROOT = 33;      // A1
const LEAD_ROOT = 69;      // A4

const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export function createRushAudio() {
  let ctx = null;
  let master = null;
  let sfxBus = null;
  let musicBus = null;
  let noise = null;
  let muted = false;
  let musicOn = true;
  let dead = false;

  let timer = 0;
  let step = 0;
  let nextTime = 0;
  let intensity = 0;      // 0..1, follows running speed
  let playing = false;

  function ensure() {
    if (dead) return null;
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { dead = true; return null; }
    try {
      ctx = new AC();
    } catch {
      dead = true;
      return null;
    }

    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.85;

    // a gentle limiter: lots of short blips can otherwise clip on phones
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 22;
    comp.ratio.value = 8;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;

    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.9;
    musicBus = ctx.createGain();
    musicBus.gain.value = 0.34;

    sfxBus.connect(comp);
    musicBus.connect(comp);
    comp.connect(master);
    master.connect(ctx.destination);

    const len = Math.floor(ctx.sampleRate * 0.7);
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;

    return ctx;
  }

  function unlock() {
    const c = ensure();
    if (!c) return;
    if (c.state === "suspended") c.resume().catch(() => {});
  }

  /* ------------------------------ voices ------------------------------ */

  function tone(freq, {
    at = 0, dur = 0.2, type = "sine", gain = 0.3,
    to = null, glide = 0, bus = null, attack = 0.005, detune = 0,
  } = {}) {
    const c = ensure();
    if (!c) return;
    const t0 = c.currentTime + at;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.detune.value = detune;
    osc.frequency.setValueAtTime(freq, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + (glide || dur));
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(bus || sfxBus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function hiss({
    at = 0, dur = 0.2, gain = 0.2, from = 2400, to = 400,
    q = 1, kind = "lowpass", bus = null,
  } = {}) {
    const c = ensure();
    if (!c || !noise) return;
    const t0 = c.currentTime + at;
    const src = c.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const filt = c.createBiquadFilter();
    filt.type = kind;
    filt.Q.value = q;
    filt.frequency.setValueAtTime(from, t0);
    filt.frequency.exponentialRampToValueAtTime(Math.max(60, to), t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(bus || sfxBus);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  /* ---------------------------- sound effects ---------------------------- */

  const SFX = {
    jump() {
      tone(300, { dur: 0.19, type: "sine", gain: 0.3, to: 660, glide: 0.13 });
      hiss({ dur: 0.1, gain: 0.06, from: 900, to: 2200, kind: "highpass" });
    },
    land() {
      tone(120, { dur: 0.11, type: "sine", gain: 0.2, to: 70 });
      hiss({ dur: 0.09, gain: 0.07, from: 1400, to: 300 });
    },
    slide() {
      hiss({ dur: 0.36, gain: 0.19, from: 2600, to: 320, q: 1.4 });
      tone(180, { dur: 0.22, type: "triangle", gain: 0.09, to: 110 });
    },
    dive() {
      tone(520, { dur: 0.14, type: "sawtooth", gain: 0.12, to: 180 });
    },
    coin() {
      tone(1318, { dur: 0.07, type: "square", gain: 0.14 });
      tone(1760, { at: 0.055, dur: 0.11, type: "square", gain: 0.13 });
    },
    power() {
      const seq = [0, 4, 7, 12];
      seq.forEach((n, i) => {
        tone(midiToHz(72 + n), {
          at: i * 0.055, dur: 0.2, type: "triangle", gain: 0.2,
        });
      });
      hiss({ dur: 0.3, gain: 0.07, from: 600, to: 4200, kind: "bandpass", q: 2 });
    },
    powerEnd() {
      tone(880, { dur: 0.16, type: "triangle", gain: 0.1, to: 520 });
    },
    shieldBreak() {
      hiss({ dur: 0.34, gain: 0.22, from: 5200, to: 700, kind: "bandpass", q: 1.2 });
      tone(520, { dur: 0.26, type: "square", gain: 0.13, to: 190 });
    },
    smash() {
      hiss({ dur: 0.18, gain: 0.2, from: 3600, to: 900, kind: "bandpass", q: 0.9 });
      tone(150, { dur: 0.16, type: "sawtooth", gain: 0.16, to: 60 });
    },
    bump() {
      hiss({ dur: 0.17, gain: 0.18, from: 1600, to: 260 });
      tone(96, { dur: 0.17, type: "sine", gain: 0.22, to: 58 });
    },
    crash() {
      hiss({ dur: 0.5, gain: 0.3, from: 3200, to: 140, q: 0.7 });
      tone(140, { dur: 0.42, type: "sawtooth", gain: 0.3, to: 42 });
      tone(84, { at: 0.02, dur: 0.5, type: "sine", gain: 0.26, to: 34 });
    },
    gameover() {
      [0, -3, -5, -12].forEach((n, i) => {
        tone(midiToHz(64 + n), {
          at: 0.14 + i * 0.17, dur: 0.5, type: "triangle", gain: 0.19,
        });
      });
    },
    start() {
      [0, 5, 7].forEach((n, i) => {
        tone(midiToHz(64 + n), { at: i * 0.07, dur: 0.22, type: "triangle", gain: 0.17 });
      });
    },
    lane() {
      hiss({ dur: 0.05, gain: 0.045, from: 2600, to: 1400, kind: "bandpass", q: 3 });
    },
    record() {
      [0, 4, 7, 12, 16].forEach((n, i) => {
        tone(midiToHz(69 + n), { at: i * 0.09, dur: 0.34, type: "triangle", gain: 0.2 });
      });
    },
  };

  function play(name) {
    if (muted || dead) return;
    const fn = SFX[name];
    if (!fn) return;
    if (!ensure()) return;
    fn();
  }

  /* -------------------------------- music -------------------------------- */

  /* One bar is 16 steps. Everything is derived from `step`, so the loop
     never needs to store a pattern, and the shape shifts as intensity
     rises without any transition logic. */
  function scheduleStep(when, i) {
    const bar = Math.floor(i / 16);
    const beat = i % 16;
    const deg = A_MINOR_PENT[(bar * 3 + Math.floor(beat / 4)) % A_MINOR_PENT.length];
    const c = ctx;
    if (!c) return;
    const at = when - c.currentTime;
    if (at < -0.05) return;

    // bass: root on the beat, fifth on the and
    if (beat % 4 === 0 || (beat % 8 === 6 && intensity > 0.35)) {
      const n = BASS_ROOT + deg + (beat % 8 === 6 ? 7 : 0);
      tone(midiToHz(n), {
        at, dur: 0.26, type: "sawtooth",
        gain: 0.16 + intensity * 0.06, bus: musicBus, attack: 0.008,
      });
    }

    // pluck: an off-beat arpeggio that fills in as the run gets faster
    if (beat % 2 === 1 && (intensity > 0.18 || beat % 8 === 3)) {
      const oct = intensity > 0.6 && beat % 8 === 5 ? 12 : 0;
      const n = LEAD_ROOT + A_MINOR_PENT[(beat + bar) % A_MINOR_PENT.length] + oct;
      tone(midiToHz(n), {
        at, dur: 0.16, type: "triangle",
        gain: 0.07 + intensity * 0.05, bus: musicBus,
      });
    }

    // hat
    if (beat % 2 === 0) {
      hiss({
        at, dur: 0.035, gain: 0.03 + intensity * 0.035,
        from: 7000, to: 4200, kind: "highpass", bus: musicBus,
      });
    }

    // a low swell at the top of every fourth bar
    if (beat === 0 && bar % 4 === 0) {
      tone(midiToHz(BASS_ROOT + 12), {
        at, dur: 1.6, type: "sine", gain: 0.09, bus: musicBus, attack: 0.25,
      });
    }
  }

  function pump() {
    const c = ctx;
    if (!c || !playing || muted || !musicOn) return;
    const spb = 60 / (104 + intensity * 34) / 4;   // seconds per 16th
    const horizon = c.currentTime + 0.22;
    let guard = 0;
    while (nextTime < horizon && guard < 32) {
      scheduleStep(nextTime, step);
      nextTime += spb;
      step += 1;
      guard += 1;
    }
  }

  function startMusic() {
    if (!ensure() || playing) return;
    playing = true;
    step = 0;
    nextTime = ctx.currentTime + 0.08;
    clearInterval(timer);
    timer = setInterval(pump, 60);
  }

  function stopMusic() {
    playing = false;
    clearInterval(timer);
    timer = 0;
  }

  /* -------------------------------- api -------------------------------- */

  return {
    unlock,
    play,
    startMusic,
    stopMusic,
    get available() { return !dead; },

    /** 0 → 1, normally (speed - start) / (top - start). */
    setIntensity(v) {
      intensity = Math.max(0, Math.min(1, v));
    },

    setMuted(v) {
      muted = !!v;
      if (master) master.gain.value = muted ? 0 : 0.85;
      if (muted) stopMusic();
    },

    setMusic(v) {
      musicOn = !!v;
      if (musicBus) musicBus.gain.value = musicOn ? 0.34 : 0;
      if (!musicOn) stopMusic();
    },

    dispose() {
      stopMusic();
      try { ctx?.close(); } catch { /* already gone */ }
      ctx = null;
      dead = true;
    },
  };
}
