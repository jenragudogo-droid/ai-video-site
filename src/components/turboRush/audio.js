/* ------------------------------------------------------------------ *
 * All Turbo Rush sound is synthesised WebAudio — engine hum, skids,
 * pickups, combos, crowd stingers. No audio files, nothing borrowed.
 * ------------------------------------------------------------------ */
export function createRushAudio() {
  let ctx = null, master = null, engineNodes = null, skidNodes = null, echo = null;
  let muted = false, started = false;

  const ensure = () => {
    if (ctx) return true;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.5;
      /* tunnel echo bus */
      echo = { delay: ctx.createDelay(0.5), fb: ctx.createGain(), wet: ctx.createGain() };
      echo.delay.delayTime.value = 0.16;
      echo.fb.gain.value = 0.35;
      echo.wet.gain.value = 0;
      master.connect(echo.delay);
      echo.delay.connect(echo.fb); echo.fb.connect(echo.delay);
      echo.delay.connect(echo.wet);
      echo.wet.connect(ctx.destination);
      master.connect(ctx.destination);
      return true;
    } catch { return false; }
  };

  const resume = () => {
    if (!ensure()) return;
    if (ctx.state === "suspended") ctx.resume();
    started = true;
  };

  const setMuted = (m) => {
    muted = m;
    if (master) master.gain.value = m ? 0 : 0.5;
  };

  /* ---------------- engine loop ---------------- */
  const startEngine = () => {
    if (!ctx || engineNodes) return;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    const osc2 = ctx.createOscillator();
    osc2.type = "square";
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 400;
    const g = ctx.createGain(); g.gain.value = 0;
    const g2 = ctx.createGain(); g2.gain.value = 0.4;
    osc.connect(lp); osc2.connect(g2); g2.connect(lp);
    lp.connect(g); g.connect(master);
    osc.start(); osc2.start();
    engineNodes = { osc, osc2, lp, g };
    /* skid noise */
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 900; bp.Q.value = 1.4;
    const sg = ctx.createGain(); sg.gain.value = 0;
    src.connect(bp); bp.connect(sg); sg.connect(master);
    src.start();
    skidNodes = { src, sg, bp };
  };
  const stopEngine = () => {
    if (!engineNodes) return;
    try { engineNodes.osc.stop(); engineNodes.osc2.stop(); skidNodes?.src.stop(); } catch { /* no-op */ }
    engineNodes = null; skidNodes = null;
  };

  const engine = (speedK, boosting, drifting, inTunnel) => {
    if (!ctx || !started) return;
    if (!engineNodes) startEngine();
    const t = ctx.currentTime;
    const f = 42 + speedK * 130 + (boosting ? 40 : 0);
    engineNodes.osc.frequency.setTargetAtTime(f, t, 0.05);
    engineNodes.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    engineNodes.lp.frequency.setTargetAtTime(300 + speedK * 1400 + (boosting ? 800 : 0), t, 0.08);
    engineNodes.g.gain.setTargetAtTime(0.05 + speedK * 0.075, t, 0.1);
    if (skidNodes) skidNodes.sg.gain.setTargetAtTime(drifting ? 0.09 : 0, t, 0.05);
    if (echo) echo.wet.gain.setTargetAtTime(inTunnel ? 0.35 : 0, t, 0.2);
  };

  /* ---------------- one-shots ---------------- */
  const blip = (freq, dur = 0.12, type = "sine", vol = 0.25, slide = 0) => {
    if (!ctx || !started || muted) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  };
  const noise = (dur = 0.3, freq = 800, vol = 0.3) => {
    if (!ctx || !started || muted) return;
    const t = ctx.currentTime;
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = freq;
    const g = ctx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t);
  };
  const chord = (freqs, dur = 0.4, vol = 0.16, type = "triangle") => {
    freqs.forEach((f, i) => setTimeout(() => blip(f, dur, type, vol), i * 60));
  };

  const play = (name) => {
    switch (name) {
      case "count": blip(440, 0.15, "square", 0.2); break;
      case "go": blip(880, 0.4, "square", 0.28); break;
      case "coin": blip(1320, 0.09, "sine", 0.18, 400); break;
      case "box": blip(660, 0.14, "triangle", 0.22, 220); break;
      case "use": blip(520, 0.12, "square", 0.18, 150); break;
      case "combo": chord([523, 659, 784], 0.3, 0.2); break;
      case "superCombo": chord([523, 659, 784, 1046], 0.5, 0.24, "sawtooth"); break;
      case "comboFail": blip(180, 0.2, "square", 0.15, -60); break;
      case "rocket": noise(0.4, 1600, 0.22); blip(240, 0.3, "sawtooth", 0.14, 300); break;
      case "boom": noise(0.6, 300, 0.5); blip(70, 0.5, "sine", 0.4, -30); break;
      case "hit": noise(0.35, 500, 0.4); break;
      case "shieldBreak": blip(320, 0.25, "triangle", 0.25, -160); break;
      case "freeze": blip(1800, 0.35, "sine", 0.2, -900); break;
      case "emp": blip(90, 0.4, "sawtooth", 0.3, 500); break;
      case "pad": blip(392, 0.18, "square", 0.2, 200); break;
      case "nitro": noise(0.5, 2400, 0.2); blip(300, 0.4, "sawtooth", 0.16, 500); break;
      case "jump": blip(300, 0.25, "sine", 0.2, 260); break;
      case "land": noise(0.15, 400, 0.25); break;
      case "trick": chord([784, 988, 1175], 0.25, 0.2); break;
      case "lap": chord([659, 784], 0.3, 0.2); break;
      case "emblem": chord([880, 1109, 1319], 0.35, 0.2); break;
      case "eliminated": chord([392, 330, 262], 0.4, 0.2, "square"); break;
      case "win": chord([523, 659, 784, 1046, 1319], 0.6, 0.22); break;
      case "lose": chord([330, 294, 262, 220], 0.5, 0.18, "square"); break;
      case "bossIntro": chord([110, 165, 220], 0.8, 0.3, "sawtooth"); break;
      case "click": blip(700, 0.06, "sine", 0.12); break;
      case "buy": chord([659, 880], 0.2, 0.2); break;
      case "teleport": blip(1200, 0.3, "sine", 0.22, -800); break;
      case "photo": blip(1568, 0.12, "square", 0.24); break;
      default: break;
    }
  };

  /* map race events to sounds */
  const onRaceEvent = (e, race) => {
    switch (e.t) {
      case "count": play("count"); break;
      case "go": play("go"); break;
      case "coin": play("coin"); break;
      case "box": if (e.who === "player") play("box"); break;
      case "use": if (e.who === "player") play("use"); break;
      case "combo": if (e.who === "player") play(e.super ? "superCombo" : "combo"); break;
      case "comboFail": play("comboFail"); break;
      case "hit": play(e.who === "player" ? "hit" : "boom"); break;
      case "mineBoom": play("boom"); break;
      case "shieldBreak": if (e.who === "player") play("shieldBreak"); break;
      case "frozenHit": play("freeze"); break;
      case "emp": case "empHit": play("emp"); break;
      case "pad": play("pad"); break;
      case "nitro": play("nitro"); break;
      case "trick": play("trick"); break;
      case "bigAir": play("jump"); break;
      case "lap": play("lap"); break;
      case "emblem": play("emblem"); break;
      case "eliminated": play("eliminated"); break;
      case "teleport": play("teleport"); break;
      case "checkpoint": play("lap"); break;
      case "raceOver": play(e.won ? "win" : "lose"); break;
      default: break;
    }
    void race;
  };

  return { resume, setMuted, engine, play, onRaceEvent, stopEngine, get muted() { return muted; } };
}
