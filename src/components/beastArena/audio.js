/* ------------------------------------------------------------------ *
 * Battle audio — every sound is synthesised with the Web Audio API at
 * runtime, so the game ships with zero audio files to download.
 * The AudioContext is only created from a real user gesture, which is
 * what browser autoplay policies require.
 * ------------------------------------------------------------------ */

const BPM = 132;
const STEP = 60 / BPM / 4; // sixteenth note

export function createBattleAudio() {
  let ctx = null;
  let master = null;
  let sfxBus = null;
  let musicBus = null;
  let noiseBuffer = null;
  let muted = false;
  let musicTimer = null;
  let musicRunning = false;
  let nextStepTime = 0;
  let stepIndex = 0;

  function makeNoise() {
    const len = Math.floor(ctx.sampleRate * 1.2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** Must be called from a click/tap handler before anything can be heard. */
  function unlock() {
    if (ctx) {
      if (ctx.state === "suspended") ctx.resume();
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.85;
    master.connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.5;
    sfxBus.connect(master);
    musicBus = ctx.createGain();
    musicBus.gain.value = 0.15;
    musicBus.connect(master);
    noiseBuffer = makeNoise();
    if (ctx.state === "suspended") ctx.resume();
    return true;
  }

  /* --------------------------- tiny synth helpers --------------------------- */

  function tone({ type = "sine", from, to, dur, peak = 0.3, at = 0, dest, curve = "exp" }) {
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    if (to && to !== from) {
      if (curve === "exp") osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
      else osc.frequency.linearRampToValueAtTime(Math.max(20, to), t + dur);
    }
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.04, dur * 0.25));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(dest || sfxBus);
    osc.start(t);
    osc.stop(t + dur + 0.05);
    return osc;
  }

  function noise({ dur, f0, f1, q = 1, peak = 0.3, at = 0, type = "bandpass", dest }) {
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(f0, t);
    filt.Q.value = q;
    if (f1 && f1 !== f0) filt.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.05, dur * 0.3));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt).connect(gain).connect(dest || sfxBus);
    src.start(t);
    src.stop(t + dur + 0.05);
    return src;
  }

  /** slow wobble on a gain node — gives roars their growl */
  function growlMod(target, rate, depth, dur, at = 0) {
    const t = ctx.currentTime + at;
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = rate;
    lfoGain.gain.value = depth;
    lfo.connect(lfoGain).connect(target);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
  }

  /* ------------------------------- the sounds ------------------------------- */

  const SOUNDS = {
    lionRoar() {
      const body = ctx.createGain();
      body.gain.value = 1;
      body.connect(sfxBus);
      growlMod(body.gain, 18, 0.35, 1.15);
      tone({ type: "sawtooth", from: 118, to: 74, dur: 1.15, peak: 0.34, dest: body });
      tone({ type: "sine", from: 62, to: 44, dur: 1.2, peak: 0.3, dest: body });
      noise({ dur: 1.1, f0: 420, f1: 150, q: 2.2, peak: 0.24, dest: body });
    },
    tigerGrowl() {
      const body = ctx.createGain();
      body.gain.value = 1;
      body.connect(sfxBus);
      growlMod(body.gain, 30, 0.45, 0.85);
      tone({ type: "sawtooth", from: 165, to: 108, dur: 0.85, peak: 0.3, dest: body });
      noise({ dur: 0.8, f0: 900, f1: 260, q: 3, peak: 0.26, dest: body });
    },
    gorillaPound() {
      [0, 0.19, 0.4].forEach((at, i) => {
        tone({ type: "sine", from: 96 - i * 8, to: 38, dur: 0.3, peak: 0.42, at });
        noise({ dur: 0.22, f0: 320, f1: 90, q: 1.2, peak: 0.3, at });
      });
      tone({ type: "sawtooth", from: 84, to: 60, dur: 0.7, peak: 0.16, at: 0.1 });
    },
    wolfHowl() {
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(300, t);
      osc.frequency.exponentialRampToValueAtTime(560, t + 0.35);
      osc.frequency.setValueAtTime(560, t + 0.8);
      osc.frequency.exponentialRampToValueAtTime(360, t + 1.25);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.26, t + 0.12);
      gain.gain.setValueAtTime(0.26, t + 0.85);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
      const filt = ctx.createBiquadFilter();
      filt.type = "lowpass";
      filt.frequency.value = 1800;
      osc.connect(filt).connect(gain).connect(sfxBus);
      osc.start(t);
      osc.stop(t + 1.35);
      noise({ dur: 1.2, f0: 700, f1: 400, q: 4, peak: 0.07 });
    },
    eagleScreech() {
      [0, 0.14, 0.29].forEach((at, i) => {
        tone({ type: "square", from: 1500 + i * 260, to: 2500 + i * 200, dur: 0.11, peak: 0.12, at });
        tone({ type: "sawtooth", from: 2100 + i * 200, to: 1500, dur: 0.13, peak: 0.07, at: at + 0.02 });
      });
      noise({ dur: 0.4, f0: 3200, f1: 1800, q: 6, peak: 0.08 });
    },
    dragonRoar() {
      const body = ctx.createGain();
      body.gain.value = 1;
      body.connect(sfxBus);
      growlMod(body.gain, 13, 0.4, 1.25);
      tone({ type: "sawtooth", from: 92, to: 58, dur: 1.25, peak: 0.32, dest: body });
      tone({ type: "square", from: 46, to: 32, dur: 1.3, peak: 0.22, dest: body });
      // the fiery hiss layered over the roar
      noise({ dur: 1.2, f0: 900, f1: 2600, q: 0.8, peak: 0.16, at: 0.15 });
      noise({ dur: 1.15, f0: 380, f1: 130, q: 2.4, peak: 0.22, dest: body });
    },
    cheetahChirp() {
      // cheetahs chirp rather than roar
      [0, 0.11, 0.22, 0.34].forEach((at, i) => {
        tone({ type: "sine", from: 900 + i * 90, to: 1500 + i * 120, dur: 0.09, peak: 0.14, at });
        tone({ type: "triangle", from: 1400 + i * 100, to: 1000, dur: 0.07, peak: 0.07, at: at + 0.01 });
      });
      noise({ dur: 0.3, f0: 2400, f1: 1400, q: 5, peak: 0.05 });
    },
    elephantTrumpet() {
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filt = ctx.createBiquadFilter();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(220, t);
      osc.frequency.exponentialRampToValueAtTime(560, t + 0.22);
      osc.frequency.setValueAtTime(560, t + 0.62);
      osc.frequency.exponentialRampToValueAtTime(300, t + 1.0);
      filt.type = "bandpass";
      filt.frequency.setValueAtTime(700, t);
      filt.frequency.exponentialRampToValueAtTime(1900, t + 0.3);
      filt.Q.value = 3.5;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.3, t + 0.09);
      gain.gain.setValueAtTime(0.3, t + 0.66);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.05);
      osc.connect(filt).connect(gain).connect(sfxBus);
      osc.start(t);
      osc.stop(t + 1.1);
      tone({ type: "sine", from: 110, to: 70, dur: 0.9, peak: 0.14 });
    },
    crocHiss() {
      noise({ dur: 0.75, f0: 2200, f1: 700, q: 1.6, peak: 0.2 });
      const body = ctx.createGain();
      body.gain.value = 1;
      body.connect(sfxBus);
      growlMod(body.gain, 22, 0.4, 0.8);
      tone({ type: "sawtooth", from: 74, to: 52, dur: 0.8, peak: 0.24, dest: body });
    },
    rhinoSnort() {
      [0, 0.16].forEach((at) => {
        noise({ dur: 0.2, f0: 620, f1: 180, q: 1.1, peak: 0.28, at });
        tone({ type: "sawtooth", from: 130, to: 68, dur: 0.24, peak: 0.24, at });
      });
      tone({ type: "sine", from: 70, to: 44, dur: 0.5, peak: 0.2, at: 0.05 });
    },
    swipe() {
      noise({ dur: 0.17, f0: 4200, f1: 800, q: 1.1, peak: 0.22 });
    },
    hit() {
      tone({ type: "sine", from: 190, to: 58, dur: 0.22, peak: 0.4 });
      noise({ dur: 0.13, f0: 1600, f1: 300, q: 0.9, peak: 0.28 });
    },
    heavyHit() {
      tone({ type: "sine", from: 150, to: 42, dur: 0.36, peak: 0.5 });
      noise({ dur: 0.24, f0: 1100, f1: 180, q: 0.8, peak: 0.34 });
    },
    block() {
      tone({ type: "triangle", from: 880, to: 620, dur: 0.16, peak: 0.18 });
      tone({ type: "triangle", from: 1320, to: 980, dur: 0.12, peak: 0.1 });
      noise({ dur: 0.1, f0: 2600, f1: 1400, q: 3, peak: 0.12 });
    },
    special() {
      tone({ type: "sawtooth", from: 180, to: 900, dur: 0.5, peak: 0.2, curve: "lin" });
      [0, 4, 7].forEach((semi, i) =>
        tone({ type: "square", from: 330 * 2 ** (semi / 12), dur: 0.5, peak: 0.09, at: 0.34 + i * 0.02 })
      );
      noise({ dur: 0.5, f0: 400, f1: 3000, q: 1.4, peak: 0.12 });
    },
    quake() {
      tone({ type: "sine", from: 70, to: 28, dur: 0.7, peak: 0.5 });
      noise({ dur: 0.6, f0: 240, f1: 60, q: 0.7, peak: 0.3 });
    },
    ko() {
      tone({ type: "sawtooth", from: 420, to: 90, dur: 0.8, peak: 0.24, curve: "lin" });
      noise({ dur: 0.5, f0: 900, f1: 120, q: 1, peak: 0.2 });
    },
    roundWin() {
      [0, 4, 7].forEach((semi, i) =>
        tone({ type: "triangle", from: 440 * 2 ** (semi / 12), dur: 0.24, peak: 0.2, at: i * 0.11 })
      );
    },
    matchWin() {
      [0, 4, 7, 12, 12].forEach((semi, i) =>
        tone({
          type: "square",
          from: 392 * 2 ** (semi / 12),
          dur: i === 4 ? 0.7 : 0.19,
          peak: 0.15,
          at: i * 0.14,
        })
      );
      [0, 7].forEach((semi, i) =>
        tone({ type: "triangle", from: 196 * 2 ** (semi / 12), dur: 0.9, peak: 0.12, at: 0.56 + i * 0.02 })
      );
    },
    matchLose() {
      [0, -3, -7].forEach((semi, i) =>
        tone({ type: "triangle", from: 330 * 2 ** (semi / 12), dur: 0.5, peak: 0.16, at: i * 0.18 })
      );
    },
    ui() {
      tone({ type: "square", from: 660, to: 880, dur: 0.07, peak: 0.09 });
    },
    bell() {
      tone({ type: "triangle", from: 1046, dur: 0.5, peak: 0.16 });
      tone({ type: "triangle", from: 1568, dur: 0.35, peak: 0.09 });
    },
  };

  function play(name) {
    if (!ctx || muted) return;
    const fn = SOUNDS[name];
    if (fn) {
      try {
        fn();
      } catch {
        /* an audio hiccup must never take the game down */
      }
    }
  }

  /* --------------------------- arcade battle music --------------------------- */
  /* 32-step loop: driving bass, offbeat arp stabs and a simple kit. */

  const BASS = [0, 0, 7, 0, 5, 0, 3, 0, 0, 0, 7, 0, 10, 0, 8, 7];
  const ARP = [12, null, 15, null, 19, null, 15, null, 12, null, 17, null, 19, null, 22, null];
  const ROOT = 82.41; // E2

  function scheduleStep(i, time) {
    const bar = Math.floor(i / 16) % 2;
    const s = i % 16;

    // bass
    const semi = BASS[s];
    if (s % 2 === 0 || s === 15) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.value = ROOT * 2 ** ((semi + (bar ? 3 : 0)) / 12);
      const filt = ctx.createBiquadFilter();
      filt.type = "lowpass";
      filt.frequency.value = 620;
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(0.3, time + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, time + STEP * 1.6);
      osc.connect(filt).connect(g).connect(musicBus);
      osc.start(time);
      osc.stop(time + STEP * 2);
    }

    // arp
    const a = ARP[s];
    if (a !== null && a !== undefined) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = ROOT * 2 ** ((a + (bar ? 3 : 0)) / 12);
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(0.075, time + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, time + STEP * 1.1);
      osc.connect(g).connect(musicBus);
      osc.start(time);
      osc.stop(time + STEP * 1.4);
    }

    // kick
    if (s === 0 || s === 6 || s === 8 || s === 14) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(150, time);
      osc.frequency.exponentialRampToValueAtTime(45, time + 0.11);
      g.gain.setValueAtTime(0.34, time);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.16);
      osc.connect(g).connect(musicBus);
      osc.start(time);
      osc.stop(time + 0.2);
    }

    // snare + hats
    if (s === 4 || s === 12) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      const filt = ctx.createBiquadFilter();
      filt.type = "highpass";
      filt.frequency.value = 1400;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.2, time);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.14);
      src.connect(filt).connect(g).connect(musicBus);
      src.start(time);
      src.stop(time + 0.16);
    }
    if (s % 2 === 1) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      const filt = ctx.createBiquadFilter();
      filt.type = "highpass";
      filt.frequency.value = 7000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.05, time);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
      src.connect(filt).connect(g).connect(musicBus);
      src.start(time);
      src.stop(time + 0.07);
    }
  }

  function pump() {
    if (!ctx || !musicRunning) return;
    while (nextStepTime < ctx.currentTime + 0.14) {
      scheduleStep(stepIndex % 32, nextStepTime);
      nextStepTime += STEP;
      stepIndex += 1;
    }
  }

  function startMusic() {
    if (!ctx || musicRunning) return;
    musicRunning = true;
    stepIndex = 0;
    nextStepTime = ctx.currentTime + 0.08;
    pump();
    musicTimer = setInterval(pump, 25);
  }

  function stopMusic() {
    musicRunning = false;
    if (musicTimer) clearInterval(musicTimer);
    musicTimer = null;
  }

  function setMuted(next) {
    muted = next;
    if (master) {
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setTargetAtTime(next ? 0 : 0.85, t, 0.05);
    }
  }

  function dispose() {
    stopMusic();
    if (ctx) {
      try {
        ctx.close();
      } catch {
        /* already closed */
      }
    }
    ctx = null;
  }

  return { unlock, play, startMusic, stopMusic, setMuted, isMuted: () => muted, dispose };
}
