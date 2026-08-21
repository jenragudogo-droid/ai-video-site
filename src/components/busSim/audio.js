/* ------------------------------------------------------------------ *
 * City Bus Simulator — audio.
 *
 * Everything is synthesised with the Web Audio API: a diesel engine
 * built from two detuned saws plus filtered noise, air brakes, door
 * hiss, horn, bell and the stop announcements. Nothing is downloaded
 * and nothing starts until the player taps, which is what mobile
 * autoplay policies require.
 * ------------------------------------------------------------------ */

export function createBusAudio() {
  let ctx = null;
  let master = null;
  let sfxBus = null;
  let engineBus = null;
  let ambientBus = null;
  let noiseBuffer = null;

  let engineOsc1 = null;
  let engineOsc2 = null;
  let engineSub = null;
  let engineFilter = null;
  let engineGain = null;
  let dieselSrc = null;
  let dieselFilter = null;
  let dieselGain = null;
  let ambientSrc = null;
  let ambientGain = null;
  let hornGain = null;
  let hornOscA = null;
  let hornOscB = null;
  let hornOscC = null;
  let hornSub = null;
  let hornAir = null;
  let hornHeld = false;
  let ready = false;

  const volumes = { master: 0.85, sfx: 0.8, engine: 0.5, ambient: 0.3 };
  let muted = false;

  const speech = typeof window !== "undefined" ? window.speechSynthesis : null;
  let voice = null;
  function pickVoice() {
    if (!speech) return;
    const list = speech.getVoices();
    if (!list.length) return;
    voice = list.find((v) => /en-GB/i.test(v.lang) && /female|kate|serena|martha/i.test(v.name))
      || list.find((v) => /en-GB/i.test(v.lang))
      || list.find((v) => /^en/i.test(v.lang))
      || list[0];
  }
  if (speech) {
    pickVoice();
    speech.onvoiceschanged = pickVoice;
  }

  function makeNoise() {
    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** Must run inside a real tap/click handler. */
  function unlock() {
    if (ctx) {
      try { if (ctx.state === "suspended") ctx.resume(); } catch { /* not resumable */ }
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();

    master = ctx.createGain();
    master.gain.value = muted ? 0 : volumes.master;
    master.connect(ctx.destination);

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    comp.connect(master);

    sfxBus = ctx.createGain();
    sfxBus.gain.value = volumes.sfx;
    sfxBus.connect(comp);

    engineBus = ctx.createGain();
    engineBus.gain.value = volumes.engine;
    engineBus.connect(comp);

    ambientBus = ctx.createGain();
    ambientBus.gain.value = volumes.ambient;
    ambientBus.connect(comp);

    noiseBuffer = makeNoise();
    startEngine();
    startAmbient();
    startHorn();
    ready = true;
    return true;
  }

  function startEngine() {
    engineFilter = ctx.createBiquadFilter();
    engineFilter.type = "lowpass";
    engineFilter.frequency.value = 420;
    engineFilter.Q.value = 3;

    engineGain = ctx.createGain();
    engineGain.gain.value = 0.0001;
    engineFilter.connect(engineGain);
    engineGain.connect(engineBus);

    engineOsc1 = ctx.createOscillator();
    engineOsc1.type = "sawtooth";
    engineOsc1.frequency.value = 46;
    engineOsc1.connect(engineFilter);
    engineOsc1.start();

    engineOsc2 = ctx.createOscillator();
    engineOsc2.type = "square";
    engineOsc2.frequency.value = 46 * 1.51;
    const g2 = ctx.createGain();
    g2.gain.value = 0.28;
    engineOsc2.connect(g2);
    g2.connect(engineFilter);
    engineOsc2.start();

    engineSub = ctx.createOscillator();
    engineSub.type = "sine";
    engineSub.frequency.value = 23;
    const gs = ctx.createGain();
    gs.gain.value = 0.6;
    engineSub.connect(gs);
    gs.connect(engineFilter);
    engineSub.start();

    // diesel clatter
    dieselSrc = ctx.createBufferSource();
    dieselSrc.buffer = noiseBuffer;
    dieselSrc.loop = true;
    dieselFilter = ctx.createBiquadFilter();
    dieselFilter.type = "bandpass";
    dieselFilter.frequency.value = 260;
    dieselFilter.Q.value = 1.4;
    dieselGain = ctx.createGain();
    dieselGain.gain.value = 0.0001;
    dieselSrc.connect(dieselFilter);
    dieselFilter.connect(dieselGain);
    dieselGain.connect(engineBus);
    dieselSrc.start();
  }

  /**
   * A city bus horn, not a car beep: two detuned saw voices a minor third
   * apart for the two-tone air-horn character, a sine an octave down for
   * the weight you feel rather than hear, and a whisper of filtered noise
   * for air rush. It runs continuously at silence and is opened and closed
   * by one gain envelope, so holding the horn is genuinely sustained and
   * releasing it tails off instead of clicking.
   */
  function startHorn() {
    hornGain = ctx.createGain();
    hornGain.gain.value = 0.0001;
    hornGain.connect(sfxBus);

    // a little body resonance so it reads as a horn bell, not a synth tone
    const body = ctx.createBiquadFilter();
    body.type = "peaking";
    body.frequency.value = 620;
    body.Q.value = 0.9;
    body.gain.value = 6;
    body.connect(hornGain);

    const voice = (freq, level, detune) => {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = freq;
      if (detune) o.detune.value = detune;
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 2100;
      f.Q.value = 0.8;
      const g = ctx.createGain();
      g.gain.value = level;
      o.connect(f); f.connect(g); g.connect(body);
      o.start();
      return o;
    };

    // ~A#2 and ~D3: the classic two-tone interval on a large vehicle
    hornOscA = voice(186, 0.34, 0);
    hornOscB = voice(233, 0.28, 0);
    hornOscC = voice(186, 0.16, 11);      // slight beat against A, adds life
    hornSub = ctx.createOscillator();
    hornSub.type = "sine";
    hornSub.frequency.value = 93;
    const subG = ctx.createGain();
    subG.gain.value = 0.5;
    hornSub.connect(subG); subG.connect(hornGain);
    hornSub.start();

    hornAir = ctx.createBufferSource();
    hornAir.buffer = noiseBuffer;
    hornAir.loop = true;
    const airF = ctx.createBiquadFilter();
    airF.type = "bandpass";
    airF.frequency.value = 1500;
    airF.Q.value = 0.7;
    const airG = ctx.createGain();
    airG.gain.value = 0.045;
    hornAir.connect(airF); airF.connect(airG); airG.connect(hornGain);
    hornAir.start();
  }

  const HORN_LEVEL = 0.5;

  /** Press: opens the horn and holds it until hornOff. */
  function hornOn() {
    if (!ready || !ctx || hornHeld) return;
    hornHeld = true;
    // a tab that lost focus can leave the context suspended
    try { if (ctx.state === "suspended") ctx.resume(); } catch { /* not resumable */ }
    const now = ctx.currentTime;
    // real air horns bloom in pitch as pressure builds
    for (const [o, f] of [[hornOscA, 186], [hornOscB, 233], [hornOscC, 186]]) {
      if (!o) continue;
      o.frequency.cancelScheduledValues(now);
      o.frequency.setValueAtTime(f * 0.955, now);
      o.frequency.linearRampToValueAtTime(f, now + 0.09);
    }
    if (hornSub) {
      hornSub.frequency.cancelScheduledValues(now);
      hornSub.frequency.setValueAtTime(93 * 0.955, now);
      hornSub.frequency.linearRampToValueAtTime(93, now + 0.09);
    }
    hornGain.gain.cancelScheduledValues(now);
    hornGain.gain.setValueAtTime(Math.max(0.0001, hornGain.gain.value), now);
    hornGain.gain.linearRampToValueAtTime(HORN_LEVEL, now + 0.035);
  }

  /** Release: smooth tail-off, never an abrupt cut. */
  function hornOff() {
    if (!ready || !ctx || !hornHeld) return;
    hornHeld = false;
    const now = ctx.currentTime;
    hornGain.gain.cancelScheduledValues(now);
    hornGain.gain.setValueAtTime(Math.max(0.0001, hornGain.gain.value), now);
    hornGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
  }

  function startAmbient() {
    ambientSrc = ctx.createBufferSource();
    ambientSrc.buffer = noiseBuffer;
    ambientSrc.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 700;
    ambientGain = ctx.createGain();
    ambientGain.gain.value = 0.05;
    ambientSrc.connect(f);
    f.connect(ambientGain);
    ambientGain.connect(ambientBus);
    ambientSrc.start();
  }

  /** Called every frame with the current drivetrain state. */
  function updateEngine({ rpm = 0.1, load = 0, speed = 0, running = true }) {
    if (!ready || !ctx) return;
    const now = ctx.currentTime;
    const base = 42 + rpm * 118;
    const target = running ? base : 0.001;
    engineOsc1.frequency.setTargetAtTime(target, now, 0.09);
    engineOsc2.frequency.setTargetAtTime(target * 1.51, now, 0.09);
    engineSub.frequency.setTargetAtTime(target * 0.5, now, 0.12);
    engineFilter.frequency.setTargetAtTime(320 + rpm * 900 + load * 500, now, 0.1);
    engineGain.gain.setTargetAtTime(running ? 0.1 + load * 0.16 + rpm * 0.1 : 0.0001, now, 0.12);
    dieselFilter.frequency.setTargetAtTime(180 + rpm * 460, now, 0.1);
    dieselGain.gain.setTargetAtTime(running ? 0.03 + load * 0.07 : 0.0001, now, 0.12);
    // tyre and wind noise rides on the ambient bed
    ambientGain.gain.setTargetAtTime(0.04 + Math.min(1, Math.abs(speed) / 24) * 0.16, now, 0.2);
  }

  /* ------------------------------ one-shots ------------------------------ */

  function noiseBurst({ dur = 0.4, type = "highpass", freq = 1200, q = 1, gain = 0.3 }) {
    if (!ready) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    const now = ctx.currentTime;
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(f); f.connect(g); g.connect(sfxBus);
    src.start(now);
    src.stop(now + dur + 0.02);
  }

  function tone({ freq = 440, type = "sine", dur = 0.25, gain = 0.22, glide = 0, delay = 0 }) {
    if (!ready) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    const now = ctx.currentTime + delay;
    o.frequency.setValueAtTime(freq, now);
    if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + glide), now + dur);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain, now + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(g); g.connect(sfxBus);
    o.start(now);
    o.stop(now + dur + 0.03);
  }

  const S = {
    horn() {
      // a tap: same voice, just closed again straight away
      hornOn();
      const at = ctx.currentTime + 0.22;
      hornGain.gain.cancelScheduledValues(at);
      hornGain.gain.setValueAtTime(HORN_LEVEL, at);
      hornGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
      hornHeld = false;
    },
    trafficHorn() {
      // a small car two blocks away, not the bus
      tone({ freq: 405, type: "square", dur: 0.26, gain: 0.05 });
      tone({ freq: 508, type: "square", dur: 0.26, gain: 0.04 });
      tone({ freq: 203, type: "sawtooth", dur: 0.24, gain: 0.03 });
    },
    airBrake() { noiseBurst({ dur: 0.7, type: "highpass", freq: 2100, gain: 0.22, q: 0.7 }); },
    doorOpen() {
      noiseBurst({ dur: 0.55, type: "bandpass", freq: 1600, q: 1.6, gain: 0.24 });
      tone({ freq: 880, dur: 0.16, gain: 0.09, delay: 0.05 });
      tone({ freq: 1174, dur: 0.2, gain: 0.09, delay: 0.16 });
    },
    doorClose() {
      noiseBurst({ dur: 0.45, type: "bandpass", freq: 1200, q: 1.4, gain: 0.2 });
      tone({ freq: 1174, dur: 0.16, gain: 0.08 });
      tone({ freq: 880, dur: 0.2, gain: 0.08, delay: 0.12 });
    },
    bell() { tone({ freq: 1568, dur: 0.5, gain: 0.15 }); tone({ freq: 2093, dur: 0.35, gain: 0.08 }); },
    coin() { tone({ freq: 1046, dur: 0.09, gain: 0.1 }); tone({ freq: 1568, dur: 0.12, gain: 0.08, delay: 0.06 }); },
    step() { noiseBurst({ dur: 0.12, type: "bandpass", freq: 420, q: 2, gain: 0.1 }); },
    crash(impact = 4) {
      const k = Math.min(1, impact / 8);
      noiseBurst({ dur: 0.4 + k * 0.3, type: "lowpass", freq: 500 + k * 900, gain: 0.25 + k * 0.3 });
      tone({ freq: 90, type: "sawtooth", dur: 0.3, gain: 0.16 * k, glide: -50 });
    },
    kerb() { noiseBurst({ dur: 0.22, type: "lowpass", freq: 320, gain: 0.2 }); },
    redLight() { tone({ freq: 180, type: "square", dur: 0.5, gain: 0.14, glide: -60 }); },
    pedHit() {
      noiseBurst({ dur: 0.5, type: "lowpass", freq: 380, gain: 0.34 });
      tone({ freq: 140, type: "sawtooth", dur: 0.6, gain: 0.15, glide: -70 });
    },
    indicator() { tone({ freq: 1400, type: "square", dur: 0.045, gain: 0.06 }); },
    gear() { noiseBurst({ dur: 0.14, type: "bandpass", freq: 700, q: 3, gain: 0.14 }); },
    ready() { tone({ freq: 659, dur: 0.16, gain: 0.11 }); tone({ freq: 880, dur: 0.22, gain: 0.11, delay: 0.13 }); },
    arrive() { tone({ freq: 523, dur: 0.16, gain: 0.1 }); tone({ freq: 784, dur: 0.24, gain: 0.1, delay: 0.13 }); },
    stall() { tone({ freq: 120, type: "sawtooth", dur: 1.1, gain: 0.16, glide: -80 }); },
    finish() {
      [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, dur: 0.4, gain: 0.12, delay: i * 0.13 }));
    },
  };

  function play(name, arg) {
    if (!ready || muted) return;
    const fn = S[name];
    if (fn) fn(arg);
  }

  function announce(text) {
    if (!speech || muted) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      if (voice) u.voice = voice;
      u.rate = 0.98;
      u.pitch = 1.02;
      u.volume = 0.85;
      speech.cancel();
      speech.speak(u);
    } catch { /* speech is a nicety, never a requirement */ }
  }

  function setMuted(next) {
    muted = next;
    if (next) hornOff();
    if (master) master.gain.setTargetAtTime(next ? 0 : volumes.master, ctx.currentTime, 0.05);
    if (next && speech) speech.cancel();
  }

  function dispose() {
    if (speech) speech.cancel();
    try {
      [engineOsc1, engineOsc2, engineSub, dieselSrc, ambientSrc,
        hornOscA, hornOscB, hornOscC, hornSub, hornAir].forEach((n) => n && n.stop());
      if (ctx) ctx.close();
    } catch { /* already gone */ }
    ctx = null;
    ready = false;
  }

  return {
    unlock, updateEngine, play, announce, setMuted, dispose,
    hornOn, hornOff,
    get ready() { return ready; },
  };
}
