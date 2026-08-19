/* ------------------------------------------------------------------ *
 * KFL audio — crowd, whistles and kicks are synthesised with the Web
 * Audio API, commentary is spoken with the browser's speech engine.
 * Nothing is downloaded, and nothing starts until the player taps,
 * which is what mobile autoplay policies require.
 * ------------------------------------------------------------------ */

export function createFootballAudio() {
  let ctx = null;
  let master = null;
  let sfxBus = null;
  let musicBus = null;
  let crowdBus = null;
  let noiseBuffer = null;
  let crowdSource = null;
  let crowdFilter = null;
  let crowdGain = null;
  let musicTimer = null;
  let ready = false;

  const volumes = { master: 0.9, sfx: 0.75, music: 0.4, crowd: 0.5, commentary: 1 };
  let muted = false;
  let excitement = 0.25;

  const speech = typeof window !== "undefined" ? window.speechSynthesis : null;
  let voice = null;

  function pickVoice() {
    if (!speech) return;
    const voices = speech.getVoices();
    if (!voices.length) return;
    voice = voices.find((v) => /en-GB/i.test(v.lang) && /male|daniel|arthur|george/i.test(v.name))
      || voices.find((v) => /en-GB/i.test(v.lang))
      || voices.find((v) => /^en/i.test(v.lang))
      || voices[0];
  }
  if (speech) {
    pickVoice();
    speech.onvoiceschanged = pickVoice;
  }

  function makeNoise() {
    const len = Math.floor(ctx.sampleRate * 2.5);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i += 1) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    return buf;
  }

  /** Must be called from a real tap/click before anything can be heard. */
  function unlock() {
    if (ctx) {
      if (ctx.state === "suspended") ctx.resume();
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : volumes.master;
    master.connect(ctx.destination);

    sfxBus = ctx.createGain();
    sfxBus.gain.value = volumes.sfx;
    sfxBus.connect(master);

    musicBus = ctx.createGain();
    musicBus.gain.value = volumes.music;
    musicBus.connect(master);

    crowdBus = ctx.createGain();
    crowdBus.gain.value = volumes.crowd;
    crowdBus.connect(master);

    noiseBuffer = makeNoise();
    if (ctx.state === "suspended") ctx.resume();
    ready = true;
    return true;
  }

  /* ---------------------------- synth helpers ---------------------------- */

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
    gain.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.03, dur * 0.25));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(dest || sfxBus);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  function noise({ dur, f0, f1, q = 1, peak = 0.3, at = 0, type = "bandpass", dest, attack = 0.05 }) {
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
    gain.gain.exponentialRampToValueAtTime(peak, t + Math.min(attack, dur * 0.5));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt).connect(gain).connect(dest || sfxBus);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  /* ------------------------------ the sounds ----------------------------- */

  const SOUNDS = {
    kick() {
      noise({ dur: 0.09, f0: 2600, f1: 700, q: 0.9, peak: 0.42, attack: 0.004 });
      tone({ type: "sine", from: 190, to: 70, dur: 0.11, peak: 0.3 });
    },
    kickHard() {
      noise({ dur: 0.13, f0: 3400, f1: 600, q: 0.8, peak: 0.55, attack: 0.003 });
      tone({ type: "triangle", from: 240, to: 60, dur: 0.16, peak: 0.4 });
    },
    header() {
      noise({ dur: 0.08, f0: 1200, f1: 380, q: 1.4, peak: 0.34, attack: 0.004 });
    },
    tackle() {
      noise({ dur: 0.22, f0: 900, f1: 120, q: 0.7, peak: 0.42, attack: 0.006 });
      tone({ type: "sine", from: 120, to: 45, dur: 0.24, peak: 0.28 });
    },
    post() {
      tone({ type: "sine", from: 1480, to: 1180, dur: 0.55, peak: 0.36 });
      tone({ type: "sine", from: 2960, to: 2300, dur: 0.35, peak: 0.16 });
      noise({ dur: 0.1, f0: 3200, f1: 1400, q: 3, peak: 0.2, attack: 0.003 });
    },
    whistle() {
      whistleBlast(0.34, 0);
    },
    whistleShort() {
      whistleBlast(0.2, 0);
    },
    whistleDouble() {
      whistleBlast(0.2, 0);
      whistleBlast(0.34, 0.28);
    },
    whistleLong() {
      whistleBlast(0.24, 0);
      whistleBlast(0.24, 0.3);
      whistleBlast(0.75, 0.6);
    },
    crowdOoh() {
      crowdSwell(1.2, 0.55, 700, 380);
    },
    crowdCheer() {
      crowdSwell(1.8, 0.8, 1100, 620);
    },
    goalRoar() {
      crowdSwell(4.2, 1, 1500, 700);
      tone({ type: "sawtooth", from: 220, to: 330, dur: 1.2, peak: 0.06, dest: crowdBus });
      for (let i = 0; i < 3; i += 1) {
        tone({ type: "square", from: 520 + i * 120, to: 780 + i * 120, dur: 0.5, peak: 0.05, at: i * 0.18, dest: crowdBus });
      }
    },
    applause() {
      crowdSwell(1.4, 0.5, 2400, 1200);
    },
    ui() {
      tone({ type: "sine", from: 640, to: 880, dur: 0.09, peak: 0.2 });
    },
  };

  function whistleBlast(dur, at) {
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc2.type = "sine";
    osc.frequency.value = 2380;
    osc2.frequency.value = 3120;
    lfo.frequency.value = 42;
    lfoGain.gain.value = 140;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    lfoGain.connect(osc2.frequency);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.32, t + 0.02);
    gain.gain.setValueAtTime(0.32, t + dur * 0.7);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    osc2.connect(gain);
    gain.connect(sfxBus);
    [osc, osc2, lfo].forEach((o) => {
      o.start(t);
      o.stop(t + dur + 0.05);
    });
    noise({ dur, f0: 2600, f1: 2600, q: 6, peak: 0.06, at });
  }

  function crowdSwell(dur, peak, f0, f1) {
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = "bandpass";
    filt.frequency.setValueAtTime(f0, t);
    filt.frequency.exponentialRampToValueAtTime(f1, t + dur);
    filt.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak * 0.5, t + Math.min(0.25, dur * 0.2));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt).connect(gain).connect(crowdBus);
    src.start(t);
    src.stop(t + dur + 0.1);
  }

  /* --------------------------- crowd ambience ---------------------------- */

  function startCrowd() {
    if (!ready || crowdSource) return;
    crowdSource = ctx.createBufferSource();
    crowdSource.buffer = noiseBuffer;
    crowdSource.loop = true;
    crowdFilter = ctx.createBiquadFilter();
    crowdFilter.type = "bandpass";
    crowdFilter.frequency.value = 460;
    crowdFilter.Q.value = 0.55;
    crowdGain = ctx.createGain();
    crowdGain.gain.value = 0.16;
    crowdSource.connect(crowdFilter).connect(crowdGain).connect(crowdBus);
    crowdSource.start();
  }

  function stopCrowd() {
    if (!crowdSource) return;
    try {
      crowdSource.stop();
    } catch {
      /* already stopped */
    }
    crowdSource.disconnect();
    crowdSource = null;
  }

  /** 0 = quiet ground, 1 = the ball is in the box */
  function setExcitement(v) {
    excitement = Math.max(0, Math.min(1, v));
    if (!crowdGain || !ctx) return;
    const target = 0.1 + excitement * 0.3;
    crowdGain.gain.setTargetAtTime(target, ctx.currentTime, 0.6);
    crowdFilter.frequency.setTargetAtTime(380 + excitement * 620, ctx.currentTime, 0.8);
  }

  /* -------------------------------- music -------------------------------- */

  const CHORDS = [
    [110, 165, 220, 277],
    [98, 147, 196, 247],
    [123, 185, 247, 311],
    [82, 123, 165, 208],
  ];
  let chordIndex = 0;

  function startMusic() {
    if (!ready || musicTimer) return;
    const step = () => {
      const chord = CHORDS[chordIndex % CHORDS.length];
      chordIndex += 1;
      chord.forEach((f, i) => {
        tone({ type: i === 0 ? "triangle" : "sine", from: f, to: f, dur: 2.6, peak: 0.05, at: i * 0.02, dest: musicBus });
      });
      tone({ type: "sine", from: chord[0] / 2, to: chord[0] / 2, dur: 2.8, peak: 0.07, dest: musicBus });
    };
    step();
    musicTimer = setInterval(step, 2600);
  }

  function stopMusic() {
    if (musicTimer) clearInterval(musicTimer);
    musicTimer = null;
  }

  /* ------------------------------ commentary ----------------------------- */

  function speak(text, { rate = 1.06, pitch = 0.95, excited = false } = {}) {
    if (!speech || muted || volumes.commentary <= 0.01 || !text) return false;
    try {
      const u = new SpeechSynthesisUtterance(text);
      if (voice) u.voice = voice;
      u.rate = excited ? rate + 0.1 : rate;
      u.pitch = excited ? pitch + 0.25 : pitch;
      u.volume = Math.min(1, volumes.commentary * volumes.master);
      speech.speak(u);
      return true;
    } catch {
      return false;
    }
  }

  function cancelSpeech() {
    if (speech) {
      try {
        speech.cancel();
      } catch {
        /* nothing to cancel */
      }
    }
  }

  /* -------------------------------- api ---------------------------------- */

  function play(name, opts) {
    if (!ready || muted) return;
    const fn = SOUNDS[name];
    if (fn) fn(opts);
  }

  function setVolume(bus, value) {
    volumes[bus] = Math.max(0, Math.min(1, value));
    if (!ready) return;
    if (bus === "master") master.gain.value = muted ? 0 : volumes.master;
    if (bus === "sfx") sfxBus.gain.value = volumes.sfx;
    if (bus === "music") musicBus.gain.value = volumes.music;
    if (bus === "crowd") crowdBus.gain.value = volumes.crowd;
  }

  function setMuted(next) {
    muted = next;
    if (ready) master.gain.value = muted ? 0 : volumes.master;
    if (muted) cancelSpeech();
  }

  function dispose() {
    stopMusic();
    stopCrowd();
    cancelSpeech();
    if (ctx) ctx.close();
    ctx = null;
    ready = false;
  }

  return {
    unlock,
    play,
    speak,
    cancelSpeech,
    startCrowd,
    stopCrowd,
    setExcitement,
    startMusic,
    stopMusic,
    setVolume,
    setMuted,
    dispose,
    get muted() {
      return muted;
    },
    get ready() {
      return ready;
    },
    get volumes() {
      return { ...volumes };
    },
    get hasSpeech() {
      return !!speech;
    },
  };
}
