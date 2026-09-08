/* ------------------------------------------------------------------ *
 * Castle Defender — the renderer.
 *
 * Reads the simulation, never mutates it. Owns the camera, the baked
 * terrain, the sprite cache, particles, transient effects and the
 * opening cinematic. Everything is drawn in world units under one
 * transform; the shell hands over a context already scaled by the
 * device pixel ratio, so `view` is in CSS pixels.
 * ------------------------------------------------------------------ */

import { createSpriteCache } from "./art/bake.js";
import { createParticles } from "./art/fx.js";
import { bakeTerrain } from "./art/terrain.js";
import { drawCastle, castleFlags, castleDamagePoints, castleDamageState } from "./art/castle.js";
import {
  drawTowerBody, archerPositions, ballistaPivot, drawBallistaTop, catapultPivot, drawCatapultArm,
  catapultBrazier, towerFlag, TOWER_BOX,
} from "./art/towers.js";
import { FIGURES, figurePose, drawFigure, drawHorse, drawRam } from "./art/figures.js";
import { drawSiegeCatapult, drawSiegeTower, drawOuterWall } from "./art/siege.js";
import { PAL, rgba } from "./art/palette.js";
import { towerLevel } from "./engine/engine.js";
import { HERO, TOWERS } from "./data/towers.js";
import { sampleRoute } from "./engine/path.js";

const FIG_BOX = { w: 110, h: 132, ax: 48, ay: 122 };
const DEAD_BOX = { w: 150, h: 70, ax: 105, ay: 52 };
const FRAMES = { walk: 8, idle: 6, attack: 8, shoot: 8, dead: 6, stun: 4, charge: 6, push: 8, brace: 1 };

/* horse kinds: colours, rider, barding and size */
const HORSES = {
  outrider: { color: "#5a3c26", rider: "rider", size: 1.12, cloth: "#7a3c2a" },
  scout: { color: "#8a5a32", rider: "scoutRider", size: 1.14, cloth: "#6a2e22" },
  knight: { color: "#3c3c46", rider: "knightRider", size: 1.24, barding: "#7a2e22", trim: "#b8b8c0", chamfron: "#5a5a64" },
  commander: { color: "#1f1e24", rider: "commanderRider", size: 1.46, barding: "#1a1a20", trim: "#c04040", chamfron: "#2a2a32", plume: "#c04040" },
  heavy: { color: "#2c2830", rider: "heavyRider", size: 1.32, barding: "#3a2626", trim: "#8a8a92", chamfron: "#3a3a44", plume: "#a4563c" },
  /* the realm's Royal Knights: a grey destrier in red and gold caparison */
  royal: { color: "#d8d4cc", rider: "royalRider", size: 1.3, barding: "#9b2a2a", trim: "#d9a83a", chamfron: "#eef0f2", plume: "#d9a83a", saddle: "#54391f" },
};
/* Stage III lighting: 0 afternoon, 1 sunset, 2 night */
function lightTarget(s) {
  if (!s.stage || s.stage.lighting !== "siege") return 0;
  const w = s.wave + (s.waveState === "countdown" ? 1 : 0);
  return w >= 9 ? 2 : w >= 5 ? 1 : 0;
}
const IDLE_PERIOD = 2.856;      // matches sin(t * 2.2)
const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);

/* which figure spec an entity uses */
function figureKey(kind, unit, enemy) {
  if (enemy) {
    if (unit === "manAtArms") return "manAtArmsE";
    return unit;
  }
  return unit;
}

export function createRenderer() {
  const cache = createSpriteCache();
  const fx = createParticles(520);
  const view = { w: 800, h: 450, dpr: 1 };
  const cam = { x: 800, y: 450, zoom: 1 };
  let fit = { scale: 1, ox: 0, oy: 0 };
  let terrain = null;
  let terrainKey = "";
  let quality = 1;
  let time = 0;
  let intro = null;
  let sel = { plot: -1, hover: -1, range: null, rallyPick: false, heroPick: false, target: null, units: null, squad: false, hoverUnit: null };
  let gateShake = 0;
  const trails = new Map();
  let heroMark = null;
  let menuDrift = 0;
  let zoneFlicker = 0;
  let waveFlash = [0, 0];
  const blockText = new Map();
  const warnings = new Map();
  let lastChargeText = -9;
  const catMarks = new Map();     // catapult shots being wound up: id -> { tx, ty, r, t, max, kind, x, y }
  const bossMarks = [];           // boss wind-ups: { x, y, r, t, max, kind, id }
  let light = 0;                  // current lighting phase, eased toward lightTarget
  let lastGuardText = -9;
  let outro = null;               // the campaign victory sequence
  let frameDt = 1 / 60;           // last frame's dt, for effects drawn outside draw()
  const openings = new Map();     // boss id -> seconds left in the attack window

  /* ------------------------------ camera ------------------------------ */

  function computeFit(layout) {
    const s = Math.min(view.w / layout.w, view.h / layout.h);
    const scale = s * cam.zoom;
    let ox = view.w / 2 - cam.x * scale;
    let oy = view.h / 2 - cam.y * scale;
    if (cam.zoom <= 1.001) {
      ox = (view.w - layout.w * scale) / 2;
      oy = (view.h - layout.h * scale) / 2;
    } else {
      /* keep the zoomed view inside the map */
      ox = Math.min(0, Math.max(view.w - layout.w * scale, ox));
      oy = Math.min(0, Math.max(view.h - layout.h * scale, oy));
    }
    fit = { scale, ox, oy };
  }

  function toWorld(px, py) {
    return { x: (px - fit.ox) / fit.scale, y: (py - fit.oy) / fit.scale };
  }
  function toScreen(x, y) {
    return { x: fit.ox + x * fit.scale, y: fit.oy + y * fit.scale };
  }

  /* ------------------------------ sprites ------------------------------ */

  function figureSprite(key, variant, anim, frame) {
    const spec = FIGURES[key] || FIGURES.militia;
    const n = FRAMES[anim] || 6;
    const f = ((frame % n) + n) % n;
    const box = anim === "dead" ? DEAD_BOX : FIG_BOX;
    return cache.get(`fig:${key}:${variant}:${anim}:${f}`, box.w, box.h, box.ax, box.ay, (ctx) => {
      let t;
      if (anim === "walk" || anim === "charge" || anim === "push") t = f / n;
      else if (anim === "idle") t = (f / n) * IDLE_PERIOD;
      else if (anim === "stun") t = (f / n) * 1.4;
      else if (anim === "dead") t = (f + 0.5) / n;
      else t = (f + 0.5) / n;
      drawFigure(ctx, spec, figurePose(anim, t, { bow: spec.weapon === "bow" }), variant);
    });
  }

  function horseSprite(kind, anim, frame) {
    const H = HORSES[kind] || HORSES.outrider;
    const n = anim === "dead" ? 6 : anim === "rear" ? 4 : 8;
    const f = ((frame % n) + n) % n;
    const box = { w: Math.round(190 * H.size), h: Math.round(160 * H.size), ax: Math.round(84 * H.size), ay: Math.round(146 * H.size) };
    return cache.get(`horse:${kind}:${anim}:${f}`, box.w, box.h, box.ax, box.ay, (ctx) => {
      const spec = FIGURES[H.rider] || FIGURES.rider;
      const opts = { barding: H.barding, trim: H.trim, chamfron: H.chamfron, plume: H.plume, size: H.size, cloth: H.cloth };
      const riderAt = (pose) => {
        ctx.save(); ctx.scale(H.size, H.size); ctx.translate(-4, -40); ctx.scale(0.9, 0.9);
        drawFigure(ctx, spec, pose, 0);
        ctx.restore();
      };
      if (anim === "dead") {
        const k = (f + 0.5) / n;
        ctx.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
        ctx.rotate(-k * 1.2);
        drawHorse(ctx, 0.1, H.color, opts);
        riderAt(figurePose("idle", 0.5));
        return;
      }
      if (anim === "rear") {
        const k = 0.35 + (f / (n - 1)) * 0.65;
        drawHorse(ctx, 0.15, H.color, { ...opts, rear: k });
        ctx.save(); ctx.scale(H.size, H.size); ctx.translate(-14 * k, 0); ctx.rotate(-0.55 * k); ctx.scale(1 / H.size, 1 / H.size);
        riderAt(figurePose("rideRear", 0));
        ctx.restore();
        return;
      }
      const t = f / n;
      if (anim === "charge") {
        drawHorse(ctx, t, H.color, { ...opts, gallop: true });
        riderAt(figurePose("rideCharge", t));
        return;
      }
      drawHorse(ctx, anim === "walk" ? t : 0.1, H.color, opts);
      const rp = anim === "attack" ? figurePose("attack", (f + 0.5) / n) : figurePose("ride", anim === "walk" ? t : 0);
      if (anim === "attack") { rp.legN.hip = 34; rp.legN.knee = 46; rp.legF.hip = 34; rp.legF.knee = 46; }
      riderAt(rp);
    });
  }

  function ramSprite(frame, dead, scale = 1) {
    const n = 8;
    const f = ((frame % n) + n) % n;
    const W = Math.round(160 * scale); const H = Math.round(120 * scale);
    return cache.get(`ram:${scale}:${dead ? "dead" : "walk"}:${f}`, W, H, Math.round(76 * scale), Math.round(104 * scale), (ctx) => {
      ctx.scale(scale, scale);
      if (dead) {
        const k = (f + 0.5) / n;
        ctx.globalAlpha = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
        ctx.translate(0, k * 6); ctx.rotate(k * 0.12);
        drawRam(ctx, 0, { banner: false });
        return;
      }
      drawRam(ctx, f / n);
    });
  }

  function catapultSprite(frame, armStep, dead) {
    const n = 8;
    const f = ((frame % n) + n) % n;
    return cache.get(`siegeCat:${dead ? "dead" : armStep}:${f}`, 200, 150, 100, 132, (ctx) => {
      if (dead) { ctx.globalAlpha = 0.9; ctx.rotate(0.14); ctx.translate(0, 8); drawSiegeCatapult(ctx, 0, 1, { crew: false }); return; }
      drawSiegeCatapult(ctx, f / n, armStep / 6);
    });
  }

  function siegeTowerSprite(frame, ramp, dead) {
    const n = 8;
    const f = ((frame % n) + n) % n;
    return cache.get(`siegeTower:${dead ? "dead" : ramp}:${f}`, 180, 200, 90, 182, (ctx) => {
      if (dead) { ctx.rotate(0.1); ctx.translate(0, 10); drawSiegeTower(ctx, 0, 1, { dead: true }); return; }
      drawSiegeTower(ctx, f / n, ramp);
    });
  }

  function towerSprite(type, level) {
    return cache.get(`tower:${type}:${level}`, TOWER_BOX.w, TOWER_BOX.h, TOWER_BOX.ax, TOWER_BOX.ay, (ctx) => drawTowerBody(ctx, type, level));
  }

  function castleSprite(castle, dmg) {
    return cache.get(`castle:${castle.w}x${castle.h}:${dmg}`, castle.w + 70, castle.h + 150, 35, 118, (ctx) => drawCastle(ctx, castle, dmg));
  }

  /* ------------------------------ flags ------------------------------ */

  function drawFlag(ctx, x, y, h, size, color, trim, phase, alpha = 1) {
    const cw = 26 * size; const ch = 16 * size;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "rgba(28,20,12,0.7)"; ctx.lineWidth = 3.2 * size + 1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - h); ctx.stroke();
    ctx.strokeStyle = PAL.woodDark; ctx.lineWidth = 2.4 * size; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - h); ctx.stroke();
    ctx.fillStyle = PAL.gold; ctx.beginPath(); ctx.arc(x, y - h - 1.5 * size, 2.2 * size, 0, Math.PI * 2); ctx.fill();
    const top = y - h + 1;
    const segs = 6;
    ctx.beginPath();
    ctx.moveTo(x, top);
    for (let i = 0; i <= segs; i += 1) {
      const k = i / segs;
      const wob = Math.sin(time * 7 + phase + k * 4.2) * 2.4 * size * k;
      ctx.lineTo(x + cw * k, top + wob + k * 1.5);
    }
    for (let i = segs; i >= 0; i -= 1) {
      const k = i / segs;
      const wob = Math.sin(time * 7 + phase + k * 4.2) * 2.4 * size * k;
      const notch = i === segs ? -ch * 0.35 : 0;
      ctx.lineTo(x + cw * k, top + ch + wob + k * 1.5 + notch);
    }
    ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = trim || "rgba(28,20,12,0.6)"; ctx.lineWidth = 1.2 * size; ctx.stroke();
    /* shading ripple */
    ctx.save(); ctx.clip();
    ctx.fillStyle = rgba("#000000", 0.16);
    for (let i = 0; i < segs; i += 2) {
      const k = i / segs;
      ctx.fillRect(x + cw * k, top - 6, cw / segs, ch + 14);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /* warband banner at a route entrance (black, torn) */
  function drawWarFlag(ctx, x, y, alpha, glow) {
    if (glow > 0) {
      const k = Math.min(1, glow) * (0.7 + Math.sin(time * 9) * 0.3);
      const g = ctx.createRadialGradient(x + 8, y - 30, 4, x + 8, y - 30, 70);
      g.addColorStop(0, rgba(PAL.redLight, 0.45 * k)); g.addColorStop(1, rgba(PAL.red, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x + 8, y - 30, 70, 60, 0, 0, Math.PI * 2); ctx.fill();
    }
    drawFlag(ctx, x, y, 70, 1.1, PAL.blackDark, PAL.rust, 1.3, alpha);
  }

  /* ------------------------------ effects ------------------------------ */

  function onEvent(e, s) {
    switch (e.type) {
      case "hit":
        if (e.dtype === "arrow" || e.dtype === "pierce") fx.spawn("spark", e.x, e.y - 24, { n: 3, z: 0, color: "#fff5d0" });
        else if (e.dtype === "blade" || e.dtype === "charge") fx.spawn("spark", e.x, e.y - 26, { n: 5, z: 0, color: "#ffe9a8" });
        else if (e.dtype === "siege") fx.spawn("dust", e.x, e.y, { n: 3 });
        if (e.amount >= 30) fx.spawn("text", e.x, e.y - 40, { text: `${Math.round(e.amount)}`, size: 10, color: "#ffe6b0", max: 0.7 });
        break;
      case "shieldBlock": {
        fx.spawn("flash", e.x + 8, e.y - 30, { size: 9, color: "rgba(230,230,255,0.8)" });
        fx.spawn("spark", e.x + 8, e.y - 30, { n: 2, z: 0, color: "#dfe6ff" });
        const last = blockText.get(e.id) || -9;
        if (time - last > 1.6) { blockText.set(e.id, time); fx.spawn("text", e.x, e.y - 50, { text: "BLOCKED", size: 9, color: "#cfd6e6", max: 0.8 }); }
        break;
      }
      case "block": fx.spawn("flash", e.x + 6, e.y - 30, { size: 8, color: "rgba(255,240,200,0.8)" }); break;
      case "unitHit": fx.spawn("spark", e.x, e.y - 26, { n: 2, z: 0, color: e.hero ? "#ffd27a" : "#fff" }); break;
      case "swing": break;
      case "die":
        fx.spawn("dust", e.x, e.y, { n: 5 });
        if (e.boss) { fx.spawn("debris", e.x, e.y, { n: 16, color: PAL.wood }); fx.spawn("smoke", e.x, e.y, { n: 6, size: 10 }); fx.spawn("fire", e.x, e.y - 10, { n: 8, spread: 40 }); fx.spawn("ring", e.x, e.y, { size: 90, max: 0.7 }); }
        break;
      case "coin": fx.spawn("coin", e.x, e.y - 10, { text: `+${e.amount}` }); break;
      case "unitDown": fx.spawn("dust", e.x, e.y, { n: 4 }); break;
      case "heroDown": fx.spawn("dust", e.x, e.y, { n: 8 }); fx.spawn("text", e.x, e.y - 50, { text: "SIR EDRIC FALLS", size: 11, color: "#ffd9a0", max: 1.6, bold: true }); break;
      case "heroReturn": fx.spawn("ring", e.x, e.y, { size: 60, color: rgba(PAL.gold, 0.8) }); fx.spawn("flash", e.x, e.y - 30, { size: 26, color: rgba(PAL.goldLight, 0.7) }); break;
      case "heroLevel": fx.spawn("ring", e.x, e.y, { size: 70, color: rgba(PAL.goldLight, 0.9), width: 4 }); fx.spawn("text", e.x, e.y - 60, { text: `LEVEL ${e.level}`, size: 13, color: PAL.goldLight, max: 1.5, bold: true }); fx.spawn("spark", e.x, e.y - 30, { n: 14, color: PAL.goldLight }); break;
      case "charge": fx.spawn("dust", e.x, e.y, { n: 8 }); break;
      case "chargeHit": fx.spawn("flash", e.x, e.y - 28, { size: 16 }); fx.spawn("dust", e.x, e.y, { n: 3 }); break;
      case "stoneImpact":
        fx.spawn("dust", e.x, e.y, { n: 10 }); fx.spawn("debris", e.x, e.y, { n: 8 }); fx.spawn("ring", e.x, e.y, { size: e.radius * 1.6, max: 0.5 });
        fx.spawn("scorch", e.x, e.y, { size: e.radius * 0.5, max: e.fire ? 18 : 8 });
        if (e.fire) { fx.spawn("fire", e.x, e.y, { n: 10, spread: e.radius }); fx.spawn("ember", e.x, e.y, { n: 8 }); }
        gateShake = Math.max(gateShake, 0.12);
        break;
      case "miss": fx.spawn("arrowStuck", e.x, e.y, { angle: -1.2 + Math.random() * 0.4, enemy: e.kind === "enemyArrow" }); fx.spawn("dust", e.x, e.y, { n: 2 }); break;
      case "gateHit":
        gateShake = Math.max(gateShake, e.siege ? 0.6 : 0.3);
        fx.spawn("dust", e.x, e.y, { n: e.siege ? 16 : 6 }); fx.spawn("debris", e.x, e.y - 10, { n: e.siege ? 14 : 5 });
        fx.spawn("flash", e.x, e.y - 20, { size: e.siege ? 40 : 18, color: "rgba(255,200,140,0.8)" });
        fx.spawn("text", e.x, e.y - 60, { text: `-${e.dmg}`, size: 14, color: "#ff9c7a", max: 1.2, bold: true });
        break;
      case "build": fx.spawn("dust", e.x, e.y, { n: 10 }); fx.spawn("ring", e.x, e.y, { size: 60, color: rgba(PAL.goldLight, 0.8) }); break;
      case "upgrade": fx.spawn("ring", e.x, e.y, { size: 70, color: rgba(PAL.goldLight, 0.9), width: 4 }); fx.spawn("spark", e.x, e.y - 40, { n: 16, color: PAL.goldLight }); fx.spawn("dust", e.x, e.y, { n: 6 }); break;
      case "sell": fx.spawn("smoke", e.x, e.y - 20, { n: 6, size: 10 }); fx.spawn("coin", e.x, e.y, {}); fx.spawn("coin", e.x + 10, e.y, {}); break;
      case "rally": fx.spawn("rally", e.x, e.y, {}); break;
      case "heroMove": heroMark = { x: e.x, y: e.y, t: 0.8 }; break;
      case "volley": fx.spawn("ring", e.x, e.y, { size: 150, color: rgba(PAL.goldLight, 0.6), max: 0.9 }); break;
      case "strike":
        fx.spawn("dust", e.x, e.y, { n: e.kind === "volley" ? 10 : 3 });
        for (let i = 0; i < (e.kind === "volley" ? 9 : 3); i += 1) fx.spawn("arrowStuck", e.x + (Math.random() - 0.5) * e.r * 1.6, e.y + (Math.random() - 0.5) * e.r * 0.9, { angle: -1.3 + Math.random() * 0.5 });
        break;
      case "reinforce": fx.spawn("ring", e.x, e.y, { size: 50, color: rgba(PAL.goldLight, 0.8) }); fx.spawn("dust", e.x, e.y, { n: 6 }); break;
      case "repair": break;
      case "wave": waveFlash = waveFlash.map((v, i) => (e.summary && i === 0 ? 1.6 : v)); if (s) waveFlash = [1.6, s.layout.routes.length > 1 ? 1.6 : 0]; break;
      case "routeOpen": waveFlash[e.route] = 3; break;
      case "breakFree": fx.spawn("dust", e.x, e.y, { n: 8 }); fx.spawn("text", e.x, e.y - 60, { text: "BREAKS FREE", size: 10, color: "#ffd0a0", max: 1 }); break;
      case "chargeWarn":
        warnings.set(e.id, { x: e.x, y: e.y, t: e.buildup, max: e.buildup, dist: e.dist });
        if (time - lastChargeText > 0.9) { lastChargeText = time; fx.spawn("text", e.x, e.y - 90, { text: e.enemy === "cavCommander" ? "MALRIC CHARGES!" : "CHARGE!", size: 13, color: "#ff8f7a", max: 1.2, bold: true }); }
        fx.spawn("ring", e.x, e.y, { size: 60, color: "rgba(255,90,60,0.8)", width: 4, max: 0.6 });
        break;
      case "chargeStart": fx.spawn("dust", e.x, e.y, { n: 10 }); fx.spawn("ring", e.x, e.y, { size: 50, color: rgba(PAL.redLight, 0.7), max: 0.5 }); break;
      case "cavImpact": fx.spawn("flash", e.x, e.y - 26, { size: 18, color: "rgba(255,220,180,0.9)" }); fx.spawn("spark", e.x, e.y - 24, { n: 8, color: "#ffe0b0" }); fx.spawn("dust", e.x, e.y, { n: 6 }); gateShake = Math.max(gateShake, 0.14); break;
      case "chargeBroken": fx.spawn("ring", e.x, e.y, { size: 70, color: rgba(PAL.goldLight, 0.9), width: 4, max: 0.6 }); fx.spawn("spark", e.x, e.y - 30, { n: 12, color: PAL.goldLight }); fx.spawn("text", e.x, e.y - 90, { text: e.by === "hero" ? "CHARGE BROKEN" : "PIKES HOLD", size: 12, color: PAL.goldLight, max: 1.4, bold: true }); fx.spawn("dust", e.x, e.y, { n: 8 }); break;
      case "brace": fx.spawn("ring", e.x, e.y, { size: 26, color: rgba(PAL.goldLight, 0.6), max: 0.35 }); break;
      case "order": fx.spawn("ring", e.x, e.y, { size: e.kind === "attack" ? 40 : 34, color: e.kind === "attack" ? "rgba(255,120,90,0.9)" : rgba(PAL.goldLight, 0.9), max: 0.5 }); break;
      case "unitAbility": fx.spawn("ring", e.x, e.y, { size: 36, color: e.id === "braceSpears" ? "rgba(255,224,138,0.9)" : "rgba(191,224,255,0.9)", max: 0.5 }); fx.spawn("spark", e.x, e.y - 30, { n: 6, color: e.id === "braceSpears" ? "#ffe08a" : "#dff0ff" }); break;
      case "perk": fx.spawn("text", s.layout.castle.gate.x, s.layout.castle.gate.y - 80, { text: e.name.toUpperCase(), size: 13, color: PAL.goldLight, max: 1.8, bold: true }); fx.spawn("spark", s.layout.castle.gate.x, s.layout.castle.gate.y - 60, { n: 16, color: PAL.goldLight }); break;
      case "watchfire": s.towers.forEach((t, i) => { if (t && t.type !== "barracks") { const p = s.layout.plots[i]; fx.spawn("fire", p.x, p.y - 70, { n: 6, spread: 20 }); fx.spawn("ember", p.x, p.y - 60, { n: 6 }); } }); break;
      case "royalRally": fx.spawn("ring", e.x, e.y, { size: 160, color: rgba(PAL.goldLight, 0.8), width: 4, max: 0.9 }); s.units.forEach((u) => { if (u.state !== "dead") fx.spawn("spark", u.x, u.y - 30, { n: 4, color: PAL.goldLight }); }); break;
      case "drill": fx.spawn("ring", e.x, e.y, { size: 60, color: rgba(PAL.goldLight, 0.8) }); fx.spawn("text", e.x, e.y - 70, { text: e.pikes ? "PIKE DRILL" : "SWORD DRILL", size: 11, color: PAL.goldLight, max: 1.3, bold: true }); break;
      case "mount": fx.spawn("ring", e.x, e.y, { size: 70, color: rgba(PAL.goldLight, 0.9), width: 4 }); fx.spawn("dust", e.x, e.y + 10, { n: 12 }); fx.spawn("text", e.x, e.y - 70, { text: e.mounted ? "ROYAL KNIGHTS" : "DISMOUNTED", size: 11, color: PAL.goldLight, max: 1.4, bold: true }); break;
      case "miniboss": fx.spawn("ring", e.x, e.y, { size: 120, color: rgba(PAL.red, 0.7), max: 1.2, width: 4 }); break;
      case "minibossDown": break;
      case "spawn": fx.spawn("dust", e.x, e.y, { n: 2 }); break;
      case "levyLeave": fx.spawn("dust", e.x, e.y, { n: 3 }); break;
      case "layout": trails.clear(); break;
      /* Stage III siege */
      case "siegeHalt": fx.spawn("dust", e.x, e.y, { n: 10 }); fx.spawn("text", e.x, e.y - 110, { text: "IN RANGE", size: 11, color: "#ff9c7a", max: 1.4, bold: true }); break;
      case "catapultWarn": catMarks.set(e.id, { x: e.x, y: e.y, tx: e.tx, ty: e.ty, r: e.r, t: e.windup, max: e.windup, kind: e.kind }); break;
      case "siegeShot": catMarks.delete(e.id); fx.spawn("dust", e.x, e.y, { n: 6 }); fx.spawn("smoke", e.x, e.y - 60, { n: 3, size: 6 }); break;
      case "siegeImpact":
        fx.spawn("dust", e.x, e.y, { n: 14 }); fx.spawn("debris", e.x, e.y, { n: 14, color: e.kind === "tower" ? PAL.wood : PAL.rockLight }); fx.spawn("ring", e.x, e.y, { size: e.radius * 1.8, max: 0.6, width: 4 });
        fx.spawn("scorch", e.x, e.y, { size: e.radius * 0.5, max: 14 }); fx.spawn("smoke", e.x, e.y, { n: 5, size: 9 });
        gateShake = Math.max(gateShake, e.kind === "castle" ? 0.5 : 0.28);
        break;
      case "wallHit": fx.spawn("dust", e.x, e.y, { n: 8 }); fx.spawn("debris", e.x, e.y - 10, { n: 6, color: PAL.rockLight }); if (e.src === "ram" || e.src === "catapult") fx.spawn("text", e.x, e.y - 60, { text: `WALL -${Math.round(e.amount)}`, size: 11, color: "#ffb59a", max: 1.1, bold: true }); break;
      case "wallBreach": fx.spawn("debris", e.x, e.y, { n: 26, color: PAL.rockLight }); fx.spawn("dust", e.x, e.y, { n: 24 }); fx.spawn("smoke", e.x, e.y, { n: 10, size: 12 }); fx.spawn("ring", e.x, e.y, { size: 160, max: 1, width: 5, color: rgba(PAL.redLight, 0.8) }); fx.spawn("text", e.x, e.y - 90, { text: "THE WALL FALLS", size: 15, color: "#ff8f7a", max: 2.2, bold: true }); gateShake = Math.max(gateShake, 0.8); break;
      case "ramWall": fx.spawn("dust", e.x, e.y, { n: 10 }); fx.spawn("debris", e.x, e.y - 20, { n: 8, color: PAL.rockLight }); gateShake = Math.max(gateShake, 0.4); break;
      case "towerDock": fx.spawn("dust", e.x, e.y, { n: 12 }); fx.spawn("text", e.x, e.y - 150, { text: "RAMP DOWN", size: 12, color: "#ff9c7a", max: 1.6, bold: true }); gateShake = Math.max(gateShake, 0.25); break;
      case "unload": fx.spawn("dust", e.x, e.y, { n: 4 }); break;
      case "towerBurn": fx.spawn("fire", e.x, e.y - 20, { n: 10, spread: 22 }); fx.spawn("ember", e.x, e.y - 30, { n: 6 }); fx.spawn("text", e.x, e.y - 80, { text: "BURNING", size: 10, color: "#ffb347", max: 1.2, bold: true }); break;
      case "engineerRepair": fx.spawn("spark", e.x, e.y, { n: 4, color: "#ffd27a" }); break;
      case "bossEnter": fx.spawn("ring", e.x, e.y, { size: 180, color: rgba(PAL.red, 0.8), max: 1.6, width: 5 }); break;
      case "bossPhase":
        fx.spawn("ring", e.x, e.y, { size: e.phase === 3 ? 220 : 160, color: e.phase === 3 ? "rgba(255,60,40,0.9)" : rgba(PAL.redLight, 0.8), max: 1.4, width: 5 });
        fx.spawn("text", e.x, e.y - 120, { text: e.phase === 3 ? "ENRAGED" : "BLACKMOOR ADVANCES", size: 14, color: "#ff8f7a", max: 2, bold: true });
        if (e.phase === 3) { fx.spawn("fire", e.x, e.y, { n: 14, spread: 50 }); fx.spawn("ember", e.x, e.y - 20, { n: 12 }); }
        break;
      case "bossWind": bossMarks.push({ x: e.x, y: e.y, r: e.r, t: e.dur, max: e.dur, kind: e.kind, id: e.id }); if (e.kind === "sweep") fx.spawn("text", e.x, e.y - 120, { text: "SWEEP!", size: 13, color: "#ff8f7a", max: 1.2, bold: true }); else fx.spawn("text", e.x, e.y - 120, { text: "HORN OF BLACKMOOR", size: 12, color: "#ffb59a", max: 1.6, bold: true }); break;
      case "bossSweep": fx.spawn("ring", e.x, e.y, { size: e.r * 2, color: "rgba(255,120,80,0.9)", max: 0.5, width: 6 }); fx.spawn("dust", e.x, e.y, { n: 18 }); fx.spawn("spark", e.x, e.y - 30, { n: 14, color: "#ffd0a0" }); gateShake = Math.max(gateShake, 0.3); break;
      case "bossHorn": fx.spawn("ring", e.x, e.y, { size: 300, color: rgba(PAL.redLight, 0.6), max: 1.2, width: 4 }); break;
      case "bossDown": openings.clear(); fx.spawn("ring", e.x, e.y, { size: 260, color: rgba(PAL.goldLight, 0.9), max: 1.6, width: 6 }); fx.spawn("ring", e.x, e.y, { size: 120, color: "rgba(255,120,80,0.9)", max: 0.8, width: 5 }); fx.spawn("spark", e.x, e.y - 30, { n: 40, color: PAL.goldLight }); fx.spawn("debris", e.x, e.y, { n: 18, color: PAL.iron }); fx.spawn("smoke", e.x, e.y, { n: 8, size: 12 }); fx.spawn("text", e.x, e.y - 130, { text: "BLACKMOOR FALLS", size: 16, color: PAL.goldLight, max: 3, bold: true }); gateShake = Math.max(gateShake, 0.7); break;
      case "bossOpen": openings.set(e.id, { t: e.dur, max: e.dur }); fx.spawn("ring", e.x, e.y, { size: 90, color: rgba(PAL.goldLight, 0.95), max: 0.6, width: 5 }); fx.spawn("text", e.x, e.y - 118, { text: "STRIKE NOW", size: 13, color: PAL.goldLight, max: 1.4, bold: true }); break;
      case "bossOpenEnd": openings.delete(e.id); break;
      case "bossRoarEnd": fx.spawn("ring", e.x, e.y, { size: 160, color: "rgba(255,80,50,0.9)", max: 0.6, width: 5 }); fx.spawn("dust", e.x, e.y, { n: 14 }); break;
      case "wallCrack": fx.spawn("debris", e.x, e.y, { n: 10, color: PAL.rockLight }); fx.spawn("dust", e.x, e.y, { n: 10 }); fx.spawn("text", e.x, e.y - 60, { text: "THE WALL CRACKS", size: 12, color: "#ffb59a", max: 1.6, bold: true }); gateShake = Math.max(gateShake, 0.3); break;
      case "gateFailing": { const c = s.layout.castle; fx.spawn("debris", c.gate.x, c.gate.y - 10, { n: 10, color: PAL.rockLight }); fx.spawn("smoke", c.gate.x, c.gate.y - 30, { n: 6, size: 9 }); gateShake = Math.max(gateShake, 0.4); break; }
      case "guarded": if (time - lastGuardText > 1.5) { lastGuardText = time; fx.spawn("text", e.x, e.y - 110, { text: "GUARDED", size: 11, color: "#cfd6e6", max: 1 }); } fx.spawn("flash", e.x, e.y - 40, { size: 22, color: "rgba(200,210,255,0.5)" }); break;
      case "kingsCharge": fx.spawn("ring", e.x, e.y, { size: e.r * 2, color: rgba(PAL.goldLight, 0.95), max: 0.7, width: 6 }); fx.spawn("spark", e.x, e.y - 30, { n: 22, color: PAL.goldLight }); fx.spawn("dust", e.x, e.y, { n: 16 }); fx.spawn("text", e.x, e.y - 100, { text: "KING'S CHARGE", size: 13, color: PAL.goldLight, max: 1.4, bold: true }); gateShake = Math.max(gateShake, 0.2); break;
      case "oil": fx.spawn("fire", e.x, e.y, { n: 24, spread: e.r }); fx.spawn("ember", e.x, e.y, { n: 12 }); fx.spawn("smoke", e.x, e.y, { n: 8, size: 10 }); fx.spawn("scorch", e.x, e.y, { size: e.r * 0.6, max: 20 }); fx.spawn("ring", e.x, e.y, { size: e.r * 2, color: rgba(PAL.fire, 0.8), max: 0.6, width: 4 }); break;
      case "emergencyRepair": { const c = s.layout.castle; for (let i = 0; i < 6; i += 1) fx.spawn("spark", c.x + 20 + (i / 5) * (c.w - 40), c.y + c.h - 20, { n: 4, color: PAL.goldLight }); fx.spawn("text", e.x, e.y - 90, { text: "MASONS AT WORK", size: 12, color: PAL.goldLight, max: 1.6, bold: true }); break; }
      case "barrage": fx.spawn("ring", e.x, e.y, { size: e.r * 2, color: rgba(PAL.goldLight, 0.6), max: 1, width: 3 }); break;
      case "formation": fx.spawn("ring", e.x, e.y, { size: 44, color: e.kind ? rgba(PAL.goldLight, 0.9) : "rgba(255,255,255,0.6)", max: 0.5 }); if (e.kind) fx.spawn("text", e.x, e.y - 70, { text: e.kind === "pikeWall" ? "PIKE WALL" : "SHIELD WALL", size: 11, color: PAL.goldLight, max: 1.2, bold: true }); break;
      default: break;
    }
  }

  /* ------------------------------ entities ------------------------------ */

  function unitAnim(u, enemy) {
    const def = u.def;
    if (u.state === "dead") return { anim: "dead", frame: Math.floor((1 - Math.max(0, u.deadT) / 1.5) * FRAMES.dead) };
    if (!enemy && u.bracing && (u.state === "idle" || u.state === "fight")) return { anim: "brace", frame: 0 };
    if (u.state === "stun") return { anim: "stun", frame: Math.floor(u.animT * 6) };
    if (u.state === "wind") return { anim: "brace", frame: 0 };
    if (u.state === "charge") return { anim: "charge", frame: Math.floor(u.animT * 14) };
    if (u.state === "fight") {
      const atk = enemy ? def.atk : (u.kind === "hero" ? HERO.atk : def.atk);
      const phase = Math.max(0, Math.min(0.999, 1 - u.atkCd / atk));
      return { anim: "attack", frame: Math.floor(phase * FRAMES.attack) };
    }
    if (u.state === "shoot") {
      const phase = Math.max(0, Math.min(0.999, 1 - u.atkCd / def.atk));
      return { anim: "shoot", frame: Math.floor(phase * FRAMES.shoot) };
    }
    if (u.state === "walk") {
      const speed = enemy ? def.speed : (u.kind === "hero" ? HERO.speed : def.speed);
      return { anim: "walk", frame: Math.floor((u.animT * speed / 56) * FRAMES.walk) };
    }
    return { anim: "idle", frame: Math.floor(((u.animT % IDLE_PERIOD) / IDLE_PERIOD) * FRAMES.idle) };
  }

  function hpBar(ctx, x, y, w, ratio, enemy, boss) {
    const h = boss ? 5 : 3.5;
    ctx.fillStyle = PAL.hpBack; ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = enemy ? PAL.hpRed : PAL.hpGreen;
    ctx.fillRect(x - w / 2, y, w * Math.max(0, ratio), h);
    ctx.fillStyle = rgba("#ffffff", 0.25); ctx.fillRect(x - w / 2, y, w * Math.max(0, ratio), 1.2);
  }

  function drawEnemy(ctx, e) {
    const def = e.def;
    const flip = e.face < 0;
    let sp;
    let ay = 0;
    if (def.horse) {
      const a = e.state === "dead" ? "dead" : e.state === "charge" ? "charge" : e.state === "rear" ? "rear" : e.state === "fight" ? "attack" : e.state === "walk" ? "walk" : "idle";
      let frame;
      if (a === "dead") frame = Math.floor((1 - Math.max(0, e.deadT) / 1.5) * 6);
      else if (a === "rear") frame = Math.floor(Math.min(0.999, 1 - e.chargeT / (def.charge ? def.charge.buildup : 1)) * 4);
      else if (a === "charge") frame = Math.floor(e.animT * 14);
      else if (a === "walk") frame = Math.floor(e.animT * def.speed / 60 * 8);
      else frame = Math.floor(e.animT * 6);
      sp = horseSprite(def.horse, a, frame);
      if (e.state === "charge") { fx.spawn("dust", e.x - e.face * 18, e.y + 2, { n: 2 }); if (Math.random() < 0.5) fx.spawn("dust", e.x + e.face * 10, e.y + 4, { n: 1 }); }
      else if (e.state === "walk" && Math.random() < 0.3) fx.spawn("dust", e.x - e.face * 16, e.y + 3, { n: 1 });
      if (e.buffT > 0) { ctx.fillStyle = rgba(PAL.redLight, 0.18); ctx.beginPath(); ctx.ellipse(e.x, e.y + 2, 26, 11, 0, 0, Math.PI * 2); ctx.fill(); }
    } else if (e.type === "ram" || def.ram) {
      sp = ramSprite(e.state === "dead" ? Math.floor((1 - Math.max(0, e.deadT) / 1.5) * 8) : Math.floor(e.d / 14), e.state === "dead", def.scale || 1);
      if (e.state !== "dead" && Math.random() < 0.08) fx.spawn("dust", e.x - 30 * e.face, e.y + 4, { n: 1 });
    } else if (def.engine) {
      const eg = def.engine;
      let arm = 0;
      if (e.windT > 0) arm = 0.08 * (1 - e.windT / eg.windup);
      else if (e.stopped && e.reload > eg.reload - 0.7) arm = 1 - (eg.reload - e.reload) / 0.7;
      sp = catapultSprite(e.stopped ? 0 : Math.floor(e.d / 14), Math.round(Math.max(0, Math.min(1, arm)) * 6), e.state === "dead");
      if (e.state !== "dead" && !e.stopped && Math.random() < 0.08) fx.spawn("dust", e.x - 40 * e.face, e.y + 4, { n: 1 });
      if (e.state === "dead") { if (Math.random() < 0.5) fx.spawn("fire", e.x + (Math.random() - 0.5) * 60, e.y - 20, { n: 1, size: 5 }); if (Math.random() < 0.2) fx.spawn("smoke", e.x, e.y - 40, { n: 1, size: 8 }); }
    } else if (def.tower) {
      sp = siegeTowerSprite(e.docked ? 0 : Math.floor(e.d / 14), e.docked ? 1 : 0, e.state === "dead");
      if (e.state !== "dead" && !e.docked && Math.random() < 0.1) fx.spawn("dust", e.x - 40 * e.face, e.y + 4, { n: 1 });
      if (e.state === "dead") { if (Math.random() < 0.6) fx.spawn("fire", e.x + (Math.random() - 0.5) * 40, e.y - 60 - Math.random() * 60, { n: 1, size: 6 }); if (Math.random() < 0.3) fx.spawn("smoke", e.x, e.y - 110, { n: 1, size: 10 }); }
      else if (e.docked && Math.random() < 0.06) fx.spawn("dust", e.x + e.face * 34, e.y + 2, { n: 1 });
    } else {
      const { anim, frame } = unitAnim(e, true);
      sp = figureSprite(figureKey("enemy", e.type, true), e.id % 2, anim, frame);
    }
    const hitFlash = e.hitT > 0.12;
    if (e.boss) {
      /* the warlord: a red glow that deepens as he rages, a shimmer while guarded */
      const raged = e.boss.raged;
      const g = ctx.createRadialGradient(e.x, e.y + 2, 4, e.x, e.y + 2, raged ? 70 : 48);
      g.addColorStop(0, rgba(raged ? "#ff4a2a" : PAL.redLight, (raged ? 0.45 : 0.25) + Math.sin(time * (raged ? 9 : 4)) * 0.08)); g.addColorStop(1, rgba(PAL.redLight, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(e.x, e.y + 2, raged ? 70 : 48, raged ? 30 : 20, 0, 0, Math.PI * 2); ctx.fill();
      if (e.boss.phase === 1 && e.state !== "dead") { ctx.strokeStyle = rgba("#cfd6e6", 0.45 + Math.sin(time * 3) * 0.15); ctx.lineWidth = 2; ctx.setLineDash([5, 7]); ctx.beginPath(); ctx.ellipse(e.x, e.y + 2, 40, 17, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
      const op = openings.get(e.id);
      if (op && e.state !== "dead") {
        /* the attack window: a gold ring closing as it runs out */
        op.t -= frameDt;
        const k = Math.max(0, op.t / op.max);
        ctx.strokeStyle = rgba(PAL.goldLight, 0.55 + Math.sin(time * 10) * 0.25); ctx.lineWidth = 4;
        ctx.beginPath(); ctx.ellipse(e.x, e.y + 2, 46 * (0.5 + k * 0.5), 20 * (0.5 + k * 0.5), 0, 0, Math.PI * 2); ctx.stroke();
        if (Math.random() < 0.4) fx.spawn("spark", e.x + (Math.random() - 0.5) * 40, e.y - 30, { n: 1, color: PAL.goldLight });
        if (op.t <= 0) openings.delete(e.id);
      }
      if (e.boss.roarT > 0 && e.state !== "dead") { const k = e.boss.roarT / 1.6; ctx.strokeStyle = rgba("#ff5a3c", 0.5 + Math.sin(time * 18) * 0.3); ctx.lineWidth = 5; ctx.beginPath(); ctx.ellipse(e.x, e.y + 2, 70 * (1.4 - k), 30 * (1.4 - k), 0, 0, Math.PI * 2); ctx.stroke(); if (Math.random() < 0.6) fx.spawn("ember", e.x + (Math.random() - 0.5) * 50, e.y - 30, { n: 1 }); }
      if (raged && Math.random() < 0.4) fx.spawn("ember", e.x + (Math.random() - 0.5) * 30, e.y - 20, { n: 1 });
    }
    cache.blit(ctx, sp, e.x, e.y + ay, flip);
    if (hitFlash && e.state !== "dead") {
      ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.45;
      cache.blit(ctx, sp, e.x, e.y + ay, flip);
      ctx.restore();
    }
    if (e.state !== "dead" && e.hp < e.maxHp) {
      const w = def.boss === "final" ? 90 : def.boss ? 64 : def.horse ? 30 : 24;
      hpBar(ctx, e.x, e.y - def.h - 8, w, e.hp / e.maxHp, true, !!def.boss);
    }
    if (e.stun > 0) {
      for (let i = 0; i < 3; i += 1) {
        const a = time * 6 + i * 2.1;
        ctx.fillStyle = PAL.goldLight; ctx.beginPath(); ctx.arc(e.x + Math.cos(a) * 12, e.y - def.h - 4 + Math.sin(a) * 4, 2, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  function drawUnit(ctx, u) {
    const key = u.kind === "hero" ? "hero" : u.unit;
    const { anim, frame } = unitAnim(u, false);
    let sp;
    if (u.def && u.def.horse) {
      /* a mounted soldier: the horse carries the rider (same rig the cavalry uses) */
      const a = u.state === "dead" ? "dead" : u.state === "fight" ? "attack" : u.state === "walk" ? "walk" : "idle";
      const fr = a === "dead" ? Math.floor((1 - Math.max(0, u.deadT) / 1.5) * 6) : a === "walk" ? Math.floor(u.animT * u.def.speed / 60 * 8) : a === "attack" ? Math.floor(Math.max(0, Math.min(0.999, 1 - u.atkCd / u.def.atk)) * 8) : Math.floor(u.animT * 6);
      sp = horseSprite(u.def.horse, a, fr);
      if (u.state === "walk" && Math.random() < (u.abilityT > 0 ? 0.7 : 0.3)) fx.spawn("dust", u.x - u.face * 16, u.y + 3, { n: 1 });
    } else sp = figureSprite(key, u.kind === "hero" ? 0 : u.id % 2, anim, frame);
    const flip = u.face < 0;
    const alpha = u.fade ? 0.5 : 1;
    cache.blit(ctx, sp, u.x, u.y, flip, alpha);
    if (u.hitT > 0.12 && u.state !== "dead") {
      ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.4;
      cache.blit(ctx, sp, u.x, u.y, flip);
      ctx.restore();
    }
    if (u.state === "charge" && Math.random() < 0.6) fx.spawn("dust", u.x - u.face * 10, u.y, { n: 1 });
    if (u.abilityT > 0 && u.state !== "dead") {
      const rider = !!(u.def && u.def.horse);
      ctx.strokeStyle = rgba(u.def.brace ? "#ffe08a" : rider ? PAL.goldLight : "#bfe0ff", 0.5 + Math.sin(time * 8) * 0.2); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(u.x, u.y - (rider ? 40 : 30), rider ? 30 : 16, rider ? 36 : 26, 0, 0, Math.PI * 2); ctx.stroke();
    }
    const h = u.kind === "hero" ? 70 : u.def && u.def.horse ? 84 : 60;
    if (u.state !== "dead" && u.state !== "respawn" && u.hp < u.maxHp) hpBar(ctx, u.x, u.y - h - 6, u.kind === "hero" ? 34 : u.def && u.def.horse ? 30 : 22, u.hp / u.maxHp, false, false);
    if (u.kind === "hero" && u.state !== "dead" && u.state !== "respawn") {
      /* gold pips for the level under the health bar position */
      for (let i = 0; i < u.level; i += 1) {
        ctx.fillStyle = PAL.gold; ctx.beginPath(); ctx.arc(u.x - (u.level - 1) * 3 + i * 6, u.y - h - 12, 1.8, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  function drawTower(ctx, i, t, s) {
    const p = s.layout.plots[i];
    const lvl = towerLevel(t.type, t.level);
    const pop = t.buildT > 0 ? 1 + Math.sin((0.8 - Math.min(0.8, t.buildT)) / 0.8 * Math.PI) * 0.08 : 1;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(pop, pop);
    ctx.translate(-p.x, -p.y);
    cache.blit(ctx, towerSprite(t.type, t.level), p.x, p.y);
    const elapsed = lvl.rate ? lvl.rate - t.cd : 0;
    if (t.type === "archer") {
      const phase = lvl.rate ? Math.max(0, Math.min(0.999, elapsed / lvl.rate)) : 0;
      archerPositions(t.level).forEach((pos, k) => {
        const mine = lvl.shooters === 1 || (t.shooter === k);
        const anim = t.target != null ? "shoot" : "idle";
        const frame = anim === "shoot" ? Math.floor((mine ? phase : (phase + 0.5) % 1) * FRAMES.shoot) : Math.floor(((time + k) % IDLE_PERIOD) / IDLE_PERIOD * FRAMES.idle);
        const sp = figureSprite("bowman", k, anim, frame);
        const face = t.angle > Math.PI / 2 || t.angle < -Math.PI / 2 ? -1 : 1;
        ctx.save(); ctx.translate(p.x + pos.x, p.y + pos.y); ctx.scale(0.86, 0.86); ctx.translate(-(p.x + pos.x), -(p.y + pos.y));
        cache.blit(ctx, sp, p.x + pos.x, p.y + pos.y, face < 0);
        ctx.restore();
      });
    } else if (t.type === "ballista") {
      const piv = ballistaPivot(t.level);
      const loaded = elapsed > 0.5 || t.cd <= 0;
      ctx.save(); ctx.translate(p.x + piv.x, p.y + piv.y);
      ctx.scale(1, 0.72); ctx.rotate(t.angle);
      const sp = cache.get(`ballistaTop:${t.level}:${loaded ? 1 : 0}`, 130, 90, 45, 45, (c) => drawBallistaTop(c, t.level, loaded));
      cache.blit(ctx, sp, 0, 0);
      ctx.restore();
    } else if (t.type === "catapult") {
      const piv = catapultPivot(t.level);
      let phase = 0;
      if (t.fireT > 0) phase = 1 - t.fireT / 0.35;
      else if (elapsed < 1.4 && t.cd > 0) phase = Math.max(0, 1 - (elapsed - 0.35) / 1.0);
      const loaded = elapsed > 1.6 || t.cd <= 0 || t.target == null;
      ctx.save(); ctx.translate(p.x + piv.x, p.y + piv.y);
      const fr = Math.floor(phase * 7.99);
      const sp = cache.get(`catArm:${t.level}:${fr}:${loaded ? 1 : 0}`, 110, 110, 30, 70, (c) => drawCatapultArm(c, t.level, fr / 8, loaded));
      cache.blit(ctx, sp, 0, 0);
      ctx.restore();
      const br = catapultBrazier(t.level);
      if (br && Math.random() < 0.5) fx.spawn("fire", p.x + br.x, p.y + br.y, { n: 1, size: 3, spread: 4 });
    }
    const flag = towerFlag(t.type, t.level);
    if (flag) drawFlag(ctx, p.x + flag.x, p.y + flag.y, flag.h, flag.size, PAL.red, PAL.gold, i * 1.7);
    ctx.restore();
    if (t.buildT > 0 && Math.random() < 0.4) fx.spawn("dust", p.x + (Math.random() - 0.5) * 50, p.y + 4, { n: 1 });
  }

  function drawProjectile(ctx, pr) {
    const z = pr.z || 0;
    const sx = pr.x; const sy = pr.y - z;
    let tr = trails.get(pr.id);
    if (!tr) { tr = []; trails.set(pr.id, tr); }
    tr.push(sx, sy);
    if (tr.length > 10) tr.splice(0, 2);
    const ang = tr.length >= 4 ? Math.atan2(sy - tr[tr.length - 4 + 1], sx - tr[tr.length - 4]) : Math.atan2(pr.dy || 0, pr.dx || 1);
    if (pr.kind === "siegeStone") {
      if (Math.random() < 0.8) fx.spawn("smoke", sx, sy, { n: 1, size: 5, z: 0, color: "rgba(70,60,50,0.45)" });
      ctx.fillStyle = "rgba(28,20,12,0.75)"; ctx.beginPath(); ctx.arc(sx, sy, 12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = PAL.rockDark; ctx.beginPath(); ctx.arc(sx, sy, 10.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = PAL.rock; ctx.beginPath(); ctx.arc(sx - 2, sy - 2, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = rgba("#ffffff", 0.25); ctx.beginPath(); ctx.arc(sx - 3, sy - 4, 3, 0, Math.PI * 2); ctx.fill();
      return;
    }
    if (pr.kind === "stone") {
      /* trail smoke for fire pots */
      if (pr.fire && Math.random() < 0.7) fx.spawn("smoke", sx, sy, { n: 1, size: 3, z: 0, color: "rgba(80,60,40,0.4)" });
      if (pr.fire) { ctx.fillStyle = rgba(PAL.fire, 0.5); ctx.beginPath(); ctx.arc(sx, sy, 9, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = "rgba(28,20,12,0.7)"; ctx.beginPath(); ctx.arc(sx, sy, 6.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = pr.fire ? "#3a2418" : PAL.rock; ctx.beginPath(); ctx.arc(sx, sy, 5.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = rgba("#ffffff", 0.3); ctx.beginPath(); ctx.arc(sx - 1.6, sy - 1.8, 2, 0, Math.PI * 2); ctx.fill();
      return;
    }
    /* trail */
    if (tr.length >= 6) {
      ctx.lineCap = "round";
      for (let i = 0; i < tr.length - 2; i += 2) {
        const k = i / tr.length;
        ctx.strokeStyle = pr.kind === "enemyArrow" ? rgba("#444444", 0.35 * k) : rgba("#fff3d0", 0.4 * k);
        ctx.lineWidth = (pr.kind === "bolt" ? 2.4 : 1.4) * k + 0.4;
        ctx.beginPath(); ctx.moveTo(tr[i], tr[i + 1]); ctx.lineTo(tr[i + 2], tr[i + 3]); ctx.stroke();
      }
    }
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(ang);
    const L = pr.kind === "bolt" ? (pr.big ? 30 : 22) : 16;
    const enemy = pr.kind === "enemyArrow";
    ctx.strokeStyle = "rgba(28,20,12,0.6)"; ctx.lineWidth = pr.kind === "bolt" ? 4 : 2.8;
    ctx.beginPath(); ctx.moveTo(-L, 0); ctx.lineTo(2, 0); ctx.stroke();
    ctx.strokeStyle = enemy ? "#3a3535" : PAL.arrow; ctx.lineWidth = pr.kind === "bolt" ? 2.6 : 1.6;
    ctx.beginPath(); ctx.moveTo(-L, 0); ctx.lineTo(2, 0); ctx.stroke();
    ctx.fillStyle = enemy ? "#8a8a90" : PAL.arrowHead;
    ctx.beginPath(); ctx.moveTo(1, -2.2); ctx.lineTo(7, 0); ctx.lineTo(1, 2.2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = enemy ? "#5a5050" : (pr.kind === "bolt" ? PAL.red : "#e8e2d4");
    ctx.beginPath(); ctx.moveTo(-L, 0); ctx.lineTo(-L - 4, -2.4); ctx.lineTo(-L + 3, -1.2); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-L, 0); ctx.lineTo(-L - 4, 2.4); ctx.lineTo(-L + 3, 1.2); ctx.closePath(); ctx.fill();
    if (pr.fire) { ctx.fillStyle = rgba(PAL.fire, 0.75); ctx.beginPath(); ctx.ellipse(4, 0, 6, 3, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = rgba(PAL.fireHot, 0.8); ctx.beginPath(); ctx.arc(5, 0, 2, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
    if (pr.fire && Math.random() < 0.6) fx.spawn("ember", sx, sy, { n: 1, z: 0 });
  }

  /* ------------------------------ main draw ------------------------------ */

  /* bake resolution follows the un-zoomed fit so the intro and menu
     camera never trigger a rebake; zoomed views upscale a little */
  function baseScale(layout) {
    return Math.min(view.w / layout.w, view.h / layout.h) * view.dpr;
  }

  function ensureTerrain(s) {
    const bakeScale = Math.min(2.2, Math.max(0.6, baseScale(s.layout) * 1.15));
    const key = `${s.stage.id}:${s.layout.name}:${bakeScale.toFixed(2)}:${quality}`;
    if (terrainKey !== key) {
      terrain = bakeTerrain(s.layout, s.stage, bakeScale, quality);
      terrainKey = key;
    }
  }

  function draw(ctx, s, dt, opts = {}) {
    time += dt; frameDt = dt;
    const layout = s.layout;
    if (opts.menu) {
      menuDrift += dt;
      cam.zoom = 1.55;
      cam.x = layout.w * 0.62 + Math.sin(menuDrift * 0.11) * layout.w * 0.14;
      cam.y = layout.h * 0.5 + Math.cos(menuDrift * 0.09) * layout.h * 0.12;
    } else if (intro) {
      stepIntro(s, dt);
    } else if (outro) {
      stepOutro(s, dt);
    } else {
      cam.zoom = 1; cam.x = layout.w / 2; cam.y = layout.h / 2;
    }
    computeFit(layout);
    const spriteScale = Math.min(2.5, baseScale(layout) * 1.15);
    if (cache.setScale(spriteScale)) { /* sprites rebake lazily */ }
    ensureTerrain(s);
    if (gateShake > 0) gateShake -= dt;
    if (heroMark) { heroMark.t -= dt; if (heroMark.t <= 0) heroMark = null; }
    waveFlash = waveFlash.map((v) => Math.max(0, v - dt));
    zoneFlicker += dt;

    /* letterbox ground */
    ctx.fillStyle = "#1a2012";
    ctx.fillRect(0, 0, view.w, view.h);
    ctx.save();
    const shakeX = gateShake > 0 ? (Math.random() - 0.5) * gateShake * 8 : 0;
    const shakeY = gateShake > 0 ? (Math.random() - 0.5) * gateShake * 6 : 0;
    ctx.translate(fit.ox + shakeX, fit.oy + shakeY);
    ctx.scale(fit.scale, fit.scale);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "medium";

    /* terrain */
    ctx.drawImage(terrain.canvas, 0, 0, layout.w, layout.h);
    drawWater(ctx, layout);
    /* the outer siege wall, live so its damage shows */
    if (layout.outerWall) {
      const ratio = s.wallMax ? Math.max(0, s.wallHp) / s.wallMax : 1;
      const key = `wall:${layout.name}:${ratio <= 0 ? 0 : ratio < 0.4 ? 1 : ratio < 0.75 ? 2 : 3}`;
      const sp = cache.get(key, layout.w, 120, 0, 60, (c) => { c.translate(0, 0); const ow = layout.outerWall; const minY = Math.min(...ow.segments.flat().map((q) => q.y)); c.translate(0, -minY + 60); drawOuterWall(c, ow, ratio); });
      const minY = Math.min(...layout.outerWall.segments.flat().map((q) => q.y));
      cache.blit(ctx, sp, 0, minY);
      if (ratio > 0 && ratio < 0.4 && Math.random() < 0.3 * quality) { const ow = layout.outerWall; const seg = ow.segments[Math.floor(Math.random() * ow.segments.length)]; const k = Math.random(); fx.spawn("smoke", seg[0].x + (seg[1].x - seg[0].x) * k, seg[0].y + (seg[1].y - seg[0].y) * k - 10, { n: 1, size: 5 }); }
    }
    /* siege camp fires and the warband's banners */
    if (!opts.menu) {
      for (const cp of layout.camps || []) { if (Math.random() < 0.35 * quality) fx.spawn("fire", cp.x + 4, cp.y - 10, { n: 1, size: 4, spread: 6 }); if (Math.random() < 0.08) fx.spawn("smoke", cp.x + 4, cp.y - 16, { n: 1, size: 5 }); }
    }

    /* ground decorations: zones, particles, plots, ranges, markers */
    for (const z of s.zones) {
      const k = Math.min(1, z.t / 1);
      const fl = 0.85 + Math.sin(zoneFlicker * 18 + z.x) * 0.15;
      ctx.fillStyle = rgba("#ff7a1e", 0.28 * k * fl);
      ctx.beginPath(); ctx.ellipse(z.x, z.y, z.r, z.r * 0.55, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = rgba("#ffd27a", 0.2 * k * fl);
      ctx.beginPath(); ctx.ellipse(z.x, z.y, z.r * 0.55, z.r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
      if (Math.random() < 0.7 * quality) fx.spawn("fire", z.x + (Math.random() - 0.5) * z.r * 1.6, z.y + (Math.random() - 0.5) * z.r * 0.8, { n: 1, size: 4 });
      if (Math.random() < 0.15) fx.spawn("smoke", z.x + (Math.random() - 0.5) * z.r, z.y, { n: 1, size: 4 });
    }
    fx.drawGround(ctx);

    /* cavalry charge warnings: a pulsing dashed arrow along the road ahead */
    for (const [id, wn] of warnings) {
      const e = s.enemies.find((x) => x.id === id);
      if (!e || e.state === "dead" || (!e.charging && e.chargeT <= 0)) { warnings.delete(id); continue; }
      const route = layout.routes[e.route];
      const k = e.chargeT > 0 ? 1 - e.chargeT / wn.max : 1;
      const pulse = 0.65 + Math.sin(time * 14) * 0.3;
      const len = e.charging ? Math.max(30, e.chargeLeft) : wn.dist;
      const pathAhead = () => { ctx.beginPath(); for (let d = 0; d <= len; d += 12) { const p = sampleRoute(route, e.d + d); if (d === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); } };
      /* wide translucent band, then the dashed arrow on top */
      ctx.lineCap = "round";
      ctx.strokeStyle = rgba("#ff5a3c", (e.charging ? 0.14 : 0.1 + k * 0.12) * pulse); ctx.lineWidth = 34; pathAhead(); ctx.stroke();
      ctx.setLineDash([14, 10]); ctx.lineDashOffset = -time * 80;
      ctx.strokeStyle = rgba("#ff3b1e", (e.charging ? 0.7 : 0.5 + k * 0.4) * pulse); ctx.lineWidth = 6; pathAhead(); ctx.stroke();
      ctx.strokeStyle = rgba("#fff0d0", 0.5 * pulse); ctx.lineWidth = 2; pathAhead(); ctx.stroke();
      ctx.setLineDash([]); ctx.lineDashOffset = 0;
      const tip = sampleRoute(route, e.d + len);
      ctx.fillStyle = rgba("#ff3b1e", 0.95 * pulse);
      ctx.beginPath(); ctx.moveTo(tip.x + tip.tx * 22, tip.y + tip.ty * 22); ctx.lineTo(tip.x + tip.nx * 14, tip.y + tip.ny * 14); ctx.lineTo(tip.x - tip.nx * 14, tip.y - tip.ny * 14); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = rgba("#fff0d0", 0.7 * pulse); ctx.lineWidth = 1.5; ctx.stroke();
      if (!e.charging) {
        const g = ctx.createRadialGradient(e.x, e.y + 2, 6, e.x, e.y + 2, 60);
        g.addColorStop(0, rgba("#ff5a3c", 0.45 * pulse)); g.addColorStop(1, rgba("#ff5a3c", 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(e.x, e.y + 2, 60, 28, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = rgba("#ff3b1e", 0.95 * pulse); ctx.lineWidth = 3;
        ctx.beginPath(); ctx.ellipse(e.x, e.y + 2, 36 + k * 10, 16 + k * 5, 0, 0, Math.PI * 2); ctx.stroke();
        /* countdown pip above the rider */
        ctx.fillStyle = rgba("#ff3b1e", 0.9); ctx.font = "bold 16px Cinzel, Georgia, serif"; ctx.textAlign = "center";
        ctx.lineWidth = 3; ctx.strokeStyle = "rgba(20,10,5,0.8)"; ctx.strokeText("!", e.x, e.y - 96); ctx.fillText("!", e.x, e.y - 96);
      }
    }
    /* catapult shots being wound up: a red marker where the stone will land */
    for (const [id, m] of catMarks) {
      const e = s.enemies.find((x) => x.id === id);
      if (!e || e.state === "dead") { catMarks.delete(id); continue; }
      m.t -= dt;
      if (m.t <= -0.2) { catMarks.delete(id); continue; }
      const k = 1 - Math.max(0, m.t) / m.max;
      const pulse = 0.6 + Math.sin(time * 12) * 0.3;
      ctx.setLineDash([8, 8]); ctx.lineDashOffset = -time * 40; ctx.strokeStyle = rgba("#ff5a3c", 0.35 * pulse); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(e.x, e.y - 40); ctx.quadraticCurveTo((e.x + m.tx) / 2, Math.min(e.y, m.ty) - 160, m.tx, m.ty); ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
      const g = ctx.createRadialGradient(m.tx, m.ty, 4, m.tx, m.ty, m.r);
      g.addColorStop(0, rgba("#ff5a3c", 0.35 * pulse * k)); g.addColorStop(1, rgba("#ff5a3c", 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(m.tx, m.ty, m.r, m.r * 0.55, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = rgba("#ff3b1e", (0.5 + k * 0.5) * pulse); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(m.tx, m.ty, m.r * (1.2 - k * 0.2), m.r * 0.55 * (1.2 - k * 0.2), 0, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = rgba("#ff3b1e", 0.95 * pulse); ctx.font = "bold 14px Cinzel, Georgia, serif"; ctx.textAlign = "center";
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(20,10,5,0.8)"; ctx.strokeText("!", m.tx, m.ty - 16); ctx.fillText("!", m.tx, m.ty - 16);
    }
    /* boss wind-ups: sweep radius or horn call */
    for (let i = bossMarks.length - 1; i >= 0; i -= 1) {
      const m = bossMarks[i];
      const e = s.enemies.find((x) => x.id === m.id);
      m.t -= dt;
      if (!e || e.state === "dead" || m.t <= -0.1) { bossMarks.splice(i, 1); continue; }
      const k = 1 - Math.max(0, m.t) / m.max;
      const pulse = 0.6 + Math.sin(time * 14) * 0.3;
      if (m.kind === "sweep") {
        const g = ctx.createRadialGradient(e.x, e.y + 2, 6, e.x, e.y + 2, m.r);
        g.addColorStop(0, rgba("#ff5a3c", 0.12 * pulse)); g.addColorStop(0.7, rgba("#ff5a3c", 0.25 * pulse * k)); g.addColorStop(1, rgba("#ff5a3c", 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(e.x, e.y + 2, m.r, m.r * 0.55, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = rgba("#ff3b1e", (0.5 + k * 0.5) * pulse); ctx.lineWidth = 4; ctx.setLineDash([12, 8]); ctx.lineDashOffset = -time * 60;
        ctx.beginPath(); ctx.ellipse(e.x, e.y + 2, m.r * k, m.r * 0.55 * k, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
      } else {
        ctx.strokeStyle = rgba("#ffb59a", (0.4 + k * 0.5) * pulse); ctx.lineWidth = 3;
        for (let r = 0; r < 3; r += 1) { const rr = 40 + ((time * 120 + r * 60) % 180); ctx.globalAlpha = 1 - rr / 220; ctx.beginPath(); ctx.ellipse(e.x, e.y + 2, rr, rr * 0.5, 0, 0, Math.PI * 2); ctx.stroke(); }
        ctx.globalAlpha = 1;
      }
    }
    for (const c of s.enemies) {
      if (c.state === "dead" || !c.def.aura) continue;
      ctx.strokeStyle = rgba(PAL.redLight, 0.28 + Math.sin(time * 3) * 0.08); ctx.lineWidth = 2; ctx.setLineDash([6, 10]);
      ctx.beginPath(); ctx.ellipse(c.x, c.y + 2, c.def.aura.radius, c.def.aura.radius * 0.5, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }

    if (!opts.menu && !intro) {
      /* hover / selection rings on plots */
      layout.plots.forEach((p, i) => {
        const t = s.towers[i];
        if (i === sel.plot) {
          ctx.strokeStyle = rgba(PAL.goldLight, 0.9); ctx.lineWidth = 3;
          ctx.beginPath(); ctx.ellipse(p.x, p.y + 2, 40 + Math.sin(time * 5) * 2, 18 + Math.sin(time * 5), 0, 0, Math.PI * 2); ctx.stroke();
        } else if (i === sel.hover) {
          ctx.strokeStyle = rgba("#ffffff", 0.6); ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(p.x, p.y + 2, 38, 17, 0, 0, Math.PI * 2); ctx.stroke();
        } else if (!t && s.phase === "playing" && opts.pulsePlots) {
          ctx.strokeStyle = rgba(PAL.goldLight, 0.25 + Math.sin(time * 3 + i) * 0.15); ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(p.x, p.y + 2, 36, 16, 0, 0, Math.PI * 2); ctx.stroke();
        }
      });
      /* range preview */
      if (sel.range) {
        const r = sel.range;
        ctx.fillStyle = rgba("#ffffff", 0.09); ctx.strokeStyle = rgba("#ffffff", 0.55); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        if (r.min) { ctx.strokeStyle = rgba("#ff9a7a", 0.6); ctx.beginPath(); ctx.arc(r.x, r.y, r.min, 0, Math.PI * 2); ctx.stroke(); }
      }
      /* rally points for the selected barracks */
      if (sel.plot >= 0 && s.towers[sel.plot] && s.towers[sel.plot].type === "barracks") {
        const t = s.towers[sel.plot];
        const p = layout.plots[sel.plot];
        ctx.setLineDash([6, 6]); ctx.strokeStyle = rgba(PAL.goldLight, 0.5); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, TOWERS.barracks.rallyRange, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        ctx.strokeStyle = rgba(PAL.goldLight, 0.9); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(t.rally.x, t.rally.y, 22, 10, 0, 0, Math.PI * 2); ctx.stroke();
        drawFlag(ctx, t.rally.x, t.rally.y, 26, 0.6, PAL.gold, PAL.red, 2.2);
      }
      if (sel.rallyPick || sel.heroPick || sel.target) {
        const tp = sel.target;
        if (tp) {
          ctx.strokeStyle = rgba(tp.color || PAL.goldLight, 0.85); ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
          ctx.beginPath(); ctx.arc(tp.x, tp.y, tp.r || 40, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        }
      }
      if (heroMark) {
        ctx.strokeStyle = rgba(PAL.goldLight, heroMark.t); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(heroMark.x, heroMark.y, 14 * (1.6 - heroMark.t), 7 * (1.6 - heroMark.t), 0, 0, Math.PI * 2); ctx.stroke();
      }
      /* selected soldiers: a bright double ring, a bobbing chevron over the
         head, and a dashed line back to the post. One soldier gets a name
         tag; a whole squad is drawn in banner blue with a hull around the
         group and a SQUAD tag so it reads differently from a hand-picked
         group. */
      if (sel.units && sel.units.size) {
        const picked = s.units.filter((u) => sel.units.has(u.id) && u.state !== "dead" && u.state !== "respawn");
        const squad = !!sel.squad && picked.length > 1;
        const c1 = squad ? "#bfe6ff" : PAL.goldLight;
        const c2 = squad ? "#5fb4ee" : PAL.gold;
        const pulse = 1 + Math.sin(time * 6) * 0.06;
        const bob = Math.sin(time * 5) * 3;
        for (const u of picked) {
          ctx.save();
          ctx.shadowColor = rgba(c1, 0.9); ctx.shadowBlur = 10;
          ctx.strokeStyle = rgba(c1, 1); ctx.lineWidth = 3;
          ctx.beginPath(); ctx.ellipse(u.x, u.y + 2, 19 * pulse, 8.5 * pulse, 0, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
          ctx.strokeStyle = rgba(c2, 0.7); ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.ellipse(u.x, u.y + 2, 25 * pulse, 11 * pulse, 0, 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = rgba(c1, 0.14); ctx.beginPath(); ctx.ellipse(u.x, u.y + 2, 19 * pulse, 8.5 * pulse, 0, 0, Math.PI * 2); ctx.fill();
          /* chevron above the head */
          const ty = u.y - 62 + bob;
          ctx.fillStyle = rgba(c1, 0.95); ctx.strokeStyle = "rgba(20,14,8,0.85)"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(u.x - 7, ty - 9); ctx.lineTo(u.x + 7, ty - 9); ctx.lineTo(u.x, ty); ctx.closePath(); ctx.stroke(); ctx.fill();
          if (u.home && (u.order || u.hold) && dist2(u.home.x, u.home.y, u.x, u.y) > 30 * 30) {
            ctx.setLineDash([4, 6]); ctx.strokeStyle = rgba(c1, 0.45); ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(u.x, u.y); ctx.lineTo(u.home.x, u.home.y); ctx.stroke(); ctx.setLineDash([]);
            ctx.strokeStyle = rgba(c1, 0.7); ctx.beginPath(); ctx.ellipse(u.home.x, u.home.y, 10, 5, 0, 0, Math.PI * 2); ctx.stroke();
          }
          if (u.hold) {
            ctx.fillStyle = rgba(c1, 0.95); ctx.font = "bold 11px Cinzel, Georgia, serif"; ctx.textAlign = "center";
            ctx.lineWidth = 3; ctx.strokeStyle = "rgba(20,14,8,0.8)"; ctx.strokeText("HOLD", u.x, u.y + 22); ctx.fillText("HOLD", u.x, u.y + 22);
          }
        }
        if (picked.length === 1) {
          const u = picked[0];
          const name = (u.def && u.def.name) || "Soldier";
          ctx.font = "bold 12px Cinzel, Georgia, serif"; ctx.textAlign = "center";
          const w = ctx.measureText(name).width + 16;
          ctx.fillStyle = "rgba(20,14,8,0.78)"; ctx.strokeStyle = rgba(c1, 0.9); ctx.lineWidth = 1;
          ctx.beginPath(); ctx.roundRect(u.x - w / 2, u.y - 92 + bob, w, 18, 6); ctx.fill(); ctx.stroke();
          ctx.fillStyle = rgba(c1, 1); ctx.fillText(name, u.x, u.y - 79 + bob);
        } else if (picked.length > 1) {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const u of picked) { minX = Math.min(minX, u.x); maxX = Math.max(maxX, u.x); minY = Math.min(minY, u.y); maxY = Math.max(maxY, u.y); }
          const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
          const rx = (maxX - minX) / 2 + 34, ry = (maxY - minY) / 2 + 20;
          ctx.setLineDash([6, 6]); ctx.lineDashOffset = -time * 20;
          ctx.strokeStyle = rgba(c2, squad ? 0.9 : 0.55); ctx.lineWidth = squad ? 2.5 : 1.5;
          ctx.beginPath(); ctx.ellipse(cx, cy + 2, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
          ctx.setLineDash([]); ctx.lineDashOffset = 0;
          const tag = squad ? `SQUAD · ${picked.length}` : `${picked.length} SELECTED`;
          ctx.font = "bold 12px Cinzel, Georgia, serif"; ctx.textAlign = "center";
          const w = ctx.measureText(tag).width + 18;
          const ty = minY - 100 + bob;
          ctx.fillStyle = squad ? "rgba(18,40,60,0.85)" : "rgba(20,14,8,0.78)"; ctx.strokeStyle = rgba(c1, 0.9); ctx.lineWidth = 1;
          ctx.beginPath(); ctx.roundRect(cx - w / 2, ty, w, 18, 6); ctx.fill(); ctx.stroke();
          ctx.fillStyle = rgba(c1, 1); ctx.fillText(tag, cx, ty + 13);
        }
      }
      if (sel.hoverUnit != null) {
        const u = s.units.find((x) => x.id === sel.hoverUnit);
        if (u && u.state !== "dead") { ctx.strokeStyle = rgba("#ffffff", 0.6); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(u.x, u.y + 2, 18, 8, 0, 0, Math.PI * 2); ctx.stroke(); }
      }
      /* watchfire and royal rally glows */
      if (s.boostT > 0) {
        s.towers.forEach((t, i) => { if (!t || t.type === "barracks") return; const p = layout.plots[i]; const k = Math.min(1, s.boostT); ctx.strokeStyle = rgba("#ffb347", 0.35 * k + Math.sin(time * 5) * 0.1); ctx.lineWidth = 2; ctx.setLineDash([8, 8]); ctx.beginPath(); ctx.arc(p.x, p.y, 60 + Math.sin(time * 3) * 4, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); });
      }
      if (s.rallyT > 0) {
        for (const u of s.units) { if (u.state === "dead" || u.state === "respawn") continue; ctx.fillStyle = rgba(PAL.goldLight, 0.16 + Math.sin(time * 6) * 0.05); ctx.beginPath(); ctx.ellipse(u.x, u.y + 2, 20, 9, 0, 0, Math.PI * 2); ctx.fill(); }
      }
      /* strike telegraphs */
      for (const st of s.strikes) {
        const k = 1 - Math.max(0, Math.min(1, st.t / 0.9));
        ctx.strokeStyle = rgba(PAL.goldLight, 0.35 + k * 0.5); ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.ellipse(st.x, st.y, st.r, st.r * 0.55, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        if (st.t < 0.32) {
          /* arrows streaking down */
          const n = st.kind === "volley" ? 12 : 3;
          for (let i = 0; i < n; i += 1) {
            const ax = st.x + Math.sin(i * 7.3 + st.id) * st.r * 0.8;
            const ay = st.y + Math.cos(i * 5.1 + st.id) * st.r * 0.4;
            const fall = 1 - st.t / 0.32;
            const h = 160 * (1 - fall);
            ctx.strokeStyle = rgba("#fff3d0", 0.8); ctx.lineWidth = 1.4;
            ctx.beginPath(); ctx.moveTo(ax + 6, ay - h - 18); ctx.lineTo(ax, ay - h); ctx.stroke();
          }
        }
      }
    }

    /* shadows */
    ctx.fillStyle = PAL.shadow;
    const shadow = (x, y, r) => { ctx.beginPath(); ctx.ellipse(x + 3, y + 2, r, r * 0.42, 0, 0, Math.PI * 2); ctx.fill(); };
    for (const e of s.enemies) if (e.state !== "dead" || e.deadT > 0.8) shadow(e.x, e.y, e.def.engine ? 56 : e.def.tower ? 48 : e.def.ram ? 44 * (e.def.scale || 1) : e.type === "ram" ? 44 : e.def.horse ? 26 * (HORSES[e.def.horse]?.size || 1) : e.boss ? 20 : 12);
    for (const u of s.units) if (u.state !== "dead" && u.state !== "respawn") shadow(u.x, u.y, u.def && u.def.horse ? 26 * (HORSES[u.def.horse]?.size || 1) : 11);
    if (s.hero.state !== "dead" && s.hero.state !== "respawn") shadow(s.hero.x, s.hero.y, 13);
    for (const pr of s.projectiles) { ctx.fillStyle = rgba("#000000", 0.22); ctx.beginPath(); ctx.ellipse(pr.x, pr.y + 2, pr.kind === "stone" ? 5 : 4, 2, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = PAL.shadow;

    /* depth-sorted drawables */
    const items = [];
    s.towers.forEach((t, i) => { if (t) items.push({ y: layout.plots[i].y + 6, fn: () => drawTower(ctx, i, t, s) }); });
    const castle = layout.castle;
    const dmg = castleDamageState(s.castleHp, s.castleMax);
    items.push({ y: castle.y + castle.h - 2, fn: () => drawCastleLive(ctx, s, castle, dmg) });
    if (!opts.menu) {
      for (const e of s.enemies) if (!outro || (e.state === "dead" && !e.routed)) items.push({ y: e.y + (e.state === "dead" ? -30 : 0), fn: () => drawEnemy(ctx, e) });
      for (const u of s.units) if (u.state !== "respawn") items.push({ y: u.y + (u.state === "dead" ? -30 : 0), fn: () => drawUnit(ctx, u) });
      if (s.hero.state !== "respawn") items.push({ y: s.hero.y + (s.hero.state === "dead" ? -30 : 0), fn: () => drawUnit(ctx, s.hero) });
      for (const pr of s.projectiles) items.push({ y: pr.y + 1, fn: () => drawProjectile(ctx, pr) });
    }
    if (intro && intro.parade) for (const pe of intro.parade) items.push({ y: pe.y, fn: () => drawParade(ctx, pe) });
    if (outro) for (const fe of outro.flee) items.push({ y: fe.y, fn: () => drawFlee(ctx, fe) });
    /* route entrance banners */
    layout.flags.forEach((f, i) => {
      if (i > 0 && s.wave + 1 < (layout.routes[i].opensAt || 1) && s.mode !== "endless") return;
      items.push({ y: f.y, fn: () => drawWarFlag(ctx, f.x, f.y, opts.menu ? 0 : 0.95, waveFlash[i] || 0) });
    });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.fn();

    /* burning towers and formation marks */
    if (!opts.menu) {
      s.towers.forEach((t, i) => {
        if (!t || !(t.burnT > 0)) return;
        const p = layout.plots[i];
        if (Math.random() < 0.7 * quality) fx.spawn("fire", p.x + (Math.random() - 0.5) * 30, p.y - 40 - Math.random() * 40, { n: 1, size: 5 });
        if (Math.random() < 0.25) fx.spawn("smoke", p.x, p.y - 80, { n: 1, size: 7 });
        if (Math.random() < 0.15) fx.spawn("ember", p.x, p.y - 60, { n: 1 });
      });
      for (const u of s.units) {
        if (!u.formation || u.state === "dead" || u.state === "respawn") continue;
        const pike = u.formation === "pikeWall";
        ctx.fillStyle = rgba(pike ? "#ffe08a" : "#bfe0ff", 0.85); ctx.font = "bold 10px Cinzel, Georgia, serif"; ctx.textAlign = "center";
        ctx.lineWidth = 2.5; ctx.strokeStyle = "rgba(20,14,8,0.8)"; ctx.strokeText(pike ? "⟋" : "⛨", u.x, u.y - 70); ctx.fillText(pike ? "⟋" : "⛨", u.x, u.y - 70);
      }
      /* the warband's camp banners */
      for (const b of layout.banners || []) drawFlag(ctx, b.x, b.y, 34, 0.9, PAL.blackDark, PAL.red, b.x * 0.01, 0.95);
    }

    /* prune projectile trails */
    if (s.projectiles.length === 0 && trails.size) trails.clear();
    else if (trails.size > 200) { const live = new Set(s.projectiles.map((p) => p.id)); for (const k of trails.keys()) if (!live.has(k)) trails.delete(k); }

    /* air particles and castle smoke */
    fx.update(dt);
    fx.drawAir(ctx);

    /* Stage III lighting: afternoon, sunset, then a night siege lit by torches and fire */
    const lt = lightTarget(s);
    light += (lt - light) * Math.min(1, dt * 0.35);
    if (light > 0.01) {
      const sunset = Math.min(1, light);
      const night = Math.max(0, light - 1);
      const g = ctx.createLinearGradient(0, 0, 0, layout.h);
      g.addColorStop(0, rgba("#ff8a3a", 0.16 * sunset * (1 - night * 0.6))); g.addColorStop(1, rgba("#7a3a2a", 0.22 * sunset * (1 - night * 0.6)));
      ctx.fillStyle = g; ctx.fillRect(-200, -200, layout.w + 400, layout.h + 400);
      if (night > 0.01) {
        ctx.save(); ctx.globalCompositeOperation = "multiply";
        ctx.fillStyle = rgba("#4a5898", 0.72 * night); ctx.fillRect(-200, -200, layout.w + 400, layout.h + 400);
        ctx.restore();
        /* torches and fires push the dark back */
        ctx.save(); ctx.globalCompositeOperation = "lighter";
        const glow = (x, y, r, a, hot) => { const fl = 0.85 + Math.sin(time * 9 + x * 0.05) * 0.1 + Math.sin(time * 23 + y * 0.03) * 0.05; const rg = ctx.createRadialGradient(x, y, 4, x, y, r * fl); rg.addColorStop(0, rgba(hot ? "#ffb060" : "#ff9a40", a * night * fl)); rg.addColorStop(1, rgba("#ff8a30", 0)); ctx.fillStyle = rg; ctx.beginPath(); ctx.ellipse(x, y, r * fl, r * fl * 0.7, 0, 0, Math.PI * 2); ctx.fill(); };
        for (const t of layout.torches || []) { glow(t.x, t.y - 20, 95, 0.42, false); if (Math.random() < 0.35 * quality) fx.spawn("fire", t.x, t.y - 30, { n: 1, size: 3, spread: 3 }); }
        for (const z of s.zones) glow(z.x, z.y, z.r * 1.8, 0.5, true);
        for (const cp of layout.camps || []) glow(cp.x + 4, cp.y - 10, 80, 0.4, false);
        s.towers.forEach((t, i) => { if (t && t.burnT > 0) glow(layout.plots[i].x, layout.plots[i].y - 50, 110, 0.5, true); });
        for (const e of s.enemies) if ((e.def.engine || e.def.tower) && e.state === "dead") glow(e.x, e.y - 30, 90, 0.4, true);
        const c = layout.castle; glow(c.x + c.w / 2, c.y + c.h - 20, 200, 0.22, false);
        ctx.restore();
      }
    }
    if (opts.menu) {
      /* dusk */
      const g = ctx.createLinearGradient(0, 0, 0, layout.h);
      g.addColorStop(0, rgba("#2a1a3a", 0.35)); g.addColorStop(1, rgba("#3a2410", 0.45));
      ctx.fillStyle = g; ctx.fillRect(-200, -200, layout.w + 400, layout.h + 400);
    }
    if (intro) {
      ctx.fillStyle = rgba("#1a1408", intro.fade);
      ctx.fillRect(-500, -500, layout.w + 1000, layout.h + 1000);
    }
    if (outro && outro.fade > 0) {
      ctx.fillStyle = rgba("#1a1408", outro.fade * 0.85);
      ctx.fillRect(-500, -500, layout.w + 1000, layout.h + 1000);
    }
    ctx.restore();
  }

  function drawCastleLive(ctx, s, castle, dmg) {
    const sp = castleSprite(castle, dmg);
    cache.blit(ctx, sp, castle.x, castle.y);
    castleFlags(castle).forEach((f, i) => drawFlag(ctx, castle.x + f.x, castle.y + f.y, f.h, f.size, f.color, f.trim, i * 1.3));
    if (outro && outro.banners > 0) {
      /* the realm's banners go up along the south wall */
      const k = Math.min(1, outro.banners);
      for (let i = 0; i < 5; i += 1) {
        const fx0 = castle.x + 30 + (i / 4) * (castle.w - 60); const fy = castle.y + castle.h - 36;
        const hh = 8 + 34 * k;
        drawFlag(ctx, fx0, fy, hh, 0.9 + k * 0.3, i % 2 ? PAL.gold : PAL.red, i % 2 ? PAL.red : PAL.gold, i * 0.9 + 1, Math.min(1, k * 1.5));
      }
    }
    for (const p of castleDamagePoints(castle, dmg)) {
      if (Math.random() < 0.25 * quality) fx.spawn("smoke", castle.x + p.x, castle.y + p.y, { n: 1, size: 5, z: 10 });
      if (p.fire && Math.random() < 0.6) fx.spawn("fire", castle.x + p.x, castle.y + p.y, { n: 1, size: 5, z: 6 });
      if (p.fire && Math.random() < 0.1) fx.spawn("ember", castle.x + p.x, castle.y + p.y, { n: 1, z: 12 });
    }
    /* repair sparkle */
    if (s.t - (s.lastRepair || -10) < 1) fx.spawn("spark", castle.gate.x, castle.gate.y - 20, { n: 2, color: PAL.goldLight });
  }

  function drawWater(ctx, layout) {
    if (!layout.river || quality < 0.7) return;
    const pts = layout.river;
    ctx.strokeStyle = rgba("#dff3ff", 0.35); ctx.lineWidth = 1.6; ctx.lineCap = "round";
    for (let i = 0; i < pts.length - 1; i += 1) {
      const a = pts[i]; const b = pts[i + 1];
      for (let k = 0; k < 3; k += 1) {
        const f = ((time * 0.08 + k * 0.33 + i * 0.17) % 1);
        const x = a.x + (b.x - a.x) * f + Math.sin(f * 9) * 8;
        const y = a.y + (b.y - a.y) * f;
        ctx.beginPath(); ctx.moveTo(x - 5, y); ctx.lineTo(x + 5, y); ctx.stroke();
      }
    }
  }

  /* ------------------------------ outro: the realm holds ------------------------------ */

  /* After the final wave: the warband runs, the camera finds the gate, then
     the castle raises its banners. ~7.5 seconds, skippable. */
  function startOutro(s) {
    const layout = s.layout;
    const flee = [];
    for (const e of s.enemies) {
      if (e.state === "dead" && !e.routed) continue;
      const route = layout.routes[e.route] || layout.routes[0];
      flee.push({ type: e.type, d: e.d, lat: e.lat, route, x: e.x, y: e.y, face: -1, t: Math.random() * 3, speed: (e.def.speed || 50) * 1.6, horse: e.def.horse, engine: !!(e.def.engine || e.def.tower || e.def.ram || e.type === "ram"), alpha: 1 });
    }
    outro = { t: 0, dur: 7.6, flee, fade: 0, phase: 0, banners: 0 };
    stepOutro(s, 0);
  }

  function stepOutro(s, dt) {
    const layout = s.layout; const it = outro; it.t += dt;
    const c = layout.castle; const gate = c.gate; const h = s.hero;
    const ease = (k) => k * k * (3 - 2 * k);
    const t = it.t;
    const heroAt = { x: h.state === "dead" || h.state === "respawn" ? gate.x : h.x, y: h.state === "dead" || h.state === "respawn" ? gate.y + 30 : h.y };
    if (t < 2.6) { it.phase = 0; cam.zoom = 1.45; cam.x = heroAt.x; cam.y = heroAt.y - 20; it.fade = 0; }
    else if (t < 5.4) { it.phase = 1; const k = ease((t - 2.6) / 2.8); cam.zoom = 1.45 + k * 0.15; cam.x = heroAt.x + (c.x + c.w / 2 - heroAt.x) * k; cam.y = heroAt.y - 20 + (c.y + c.h * 0.45 - heroAt.y + 20) * k; it.banners = Math.max(0, (t - 3.4) / 1.6); }
    else { it.phase = 2; it.banners = 1; const k = ease(Math.min(1, (t - 5.4) / 2.2)); cam.zoom = 1.6 - k * 0.5; cam.x = c.x + c.w / 2 + (layout.w / 2 - c.x - c.w / 2) * k; cam.y = c.y + c.h * 0.45 + (layout.h / 2 - c.y - c.h * 0.45) * k; it.fade = t > 6.8 ? Math.min(1, (t - 6.8) / 0.8) : 0; }
    for (const fe of it.flee) {
      fe.d -= fe.speed * dt; fe.t += dt;
      if (fe.d <= 0) { fe.alpha = 0; continue; }
      const p = sampleRoute(fe.route, fe.d);
      fe.x = p.x + p.nx * fe.lat; fe.y = p.y + p.ny * fe.lat;
      fe.face = p.tx < 0 ? 1 : -1;
      if (fe.horse && Math.random() < 0.3) fx.spawn("dust", fe.x + fe.face * 14, fe.y + 3, { n: 1 });
    }
    /* gold sparks over the castle as the banners go up */
    if (it.banners > 0 && it.banners < 1 && Math.random() < 0.5 * quality) fx.spawn("spark", c.x + 20 + Math.random() * (c.w - 40), c.y + 10 + Math.random() * 40, { n: 3, color: PAL.goldLight, z: 40 });
    if (it.phase >= 1 && Math.random() < 0.08 * quality) fx.spawn("ember", c.x + Math.random() * c.w, c.y + c.h - 30, { n: 1, z: 30 });
    if (t >= it.dur) outro = null;
  }

  function drawFlee(ctx, fe) {
    if (fe.alpha <= 0) return;
    ctx.fillStyle = PAL.shadow; ctx.beginPath(); ctx.ellipse(fe.x + 3, fe.y + 2, fe.engine ? 40 : fe.horse ? 26 : 12, fe.engine ? 16 : fe.horse ? 11 : 5, 0, 0, Math.PI * 2); ctx.fill();
    let sp;
    if (fe.horse) sp = horseSprite(fe.horse, "walk", Math.floor(fe.t * 10));
    else if (fe.engine) sp = fe.type === "siegeCatapult" ? catapultSprite(Math.floor(fe.t * 6), 0, false) : fe.type === "siegeTower" ? siegeTowerSprite(Math.floor(fe.t * 6), 0, false) : ramSprite(Math.floor(fe.t * 6), false, 1.3);
    else sp = figureSprite(figureKey("enemy", fe.type, true), 0, "walk", Math.floor(fe.t * 12));
    cache.blit(ctx, sp, fe.x, fe.y, fe.face < 0, fe.alpha);
  }

  /* ------------------------------ intro ------------------------------ */

  function startIntro(s) {
    const layout = s.layout;
    const route = layout.routes[0];
    const parade = [];
    const types = ["bandit", "bandit", "manAtArms", "bandit", "shieldBearer", "bandit", "archer", "bandit", "manAtArms", "archer", "bandit", "bandit"];
    types.forEach((type, i) => {
      parade.push({ type, d: 10 + i * 28 + (i % 2) * 6, lat: (i % 3 - 1) * 14, speed: 30, route, x: 0, y: 0, face: 1, t: Math.random() * 3 });
    });
    intro = { t: 0, dur: 5.2, parade, fade: 1, phase: 0 };
    stepIntro(s, 0);
  }

  function stepIntro(s, dt) {
    const layout = s.layout;
    const it = intro;
    it.t += dt;
    const c = layout.castle;
    const gate = c.gate;
    const entry = sampleRoute(layout.routes[0], 120);
    const ease = (k) => k * k * (3 - 2 * k);
    const t = it.t;
    if (t < 1.7) {
      it.phase = 0;
      cam.zoom = 1.9 - ease(Math.min(1, t / 1.7)) * 0.2;
      cam.x = gate.x; cam.y = gate.y - c.h * 0.35;
      it.fade = Math.max(0, 1 - t / 0.8);
    } else if (t < 3.6) {
      it.phase = 1;
      const k = ease((t - 1.7) / 1.9);
      cam.zoom = 1.7 - k * 0.2;
      cam.x = gate.x + (entry.x - gate.x) * k;
      cam.y = (gate.y - c.h * 0.35) + (entry.y - (gate.y - c.h * 0.35)) * k;
      it.fade = 0;
    } else {
      it.phase = 2;
      const k = ease(Math.min(1, (t - 3.6) / 1.5));
      cam.zoom = 1.5 - k * 0.5;
      cam.x = entry.x + (layout.w / 2 - entry.x) * k;
      cam.y = entry.y + (layout.h / 2 - entry.y) * k;
      it.fade = 0;
    }
    for (const pe of it.parade) {
      pe.d += pe.speed * dt;
      pe.t += dt;
      const p = sampleRoute(pe.route, pe.d);
      pe.x = p.x + p.nx * pe.lat; pe.y = p.y + p.ny * pe.lat;
      pe.face = p.tx < 0 ? -1 : 1;
      pe.alpha = t > 4.4 ? Math.max(0, 1 - (t - 4.4) / 0.7) : 1;
    }
    if (t >= it.dur) intro = null;
  }

  function drawParade(ctx, pe) {
    const sp = figureSprite(figureKey("enemy", pe.type, true), 0, "walk", Math.floor(pe.t * 30 / 56 * 8));
    ctx.fillStyle = PAL.shadow; ctx.beginPath(); ctx.ellipse(pe.x + 3, pe.y + 2, 12, 5, 0, 0, Math.PI * 2); ctx.fill();
    cache.blit(ctx, sp, pe.x, pe.y, pe.face < 0, pe.alpha);
  }

  /* ------------------------------ menus ------------------------------ */

  /* icon of a figure or tower for menus: draws into a css-pixel box */
  function drawIcon(ctx, kind, id, w, h) {
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    if (kind === "tower") {
      ctx.translate(w / 2, h * 0.92); const k = Math.min(w / 120, h / 140); ctx.scale(k, k);
      drawTowerBody(ctx, id, id === "archer" ? 3 : 2);
    } else if (kind === "figure") {
      ctx.translate(w / 2, h * 0.9); const k = Math.min(w / 80, h / 90); ctx.scale(k, k);
      drawFigure(ctx, FIGURES[id] || FIGURES.militia, figurePose("idle", 0.4, { bow: (FIGURES[id] || {}).weapon === "bow" }), 0);
    } else if (kind === "horse") {
      const H = HORSES[id] || HORSES.outrider;
      ctx.translate(w / 2, h * 0.92); const k = Math.min(w / (120 * H.size), h / (100 * H.size)); ctx.scale(k, k);
      drawHorse(ctx, 0.2, H.color, { barding: H.barding, trim: H.trim, chamfron: H.chamfron, plume: H.plume, size: H.size, cloth: H.cloth });
      ctx.scale(H.size, H.size); ctx.translate(-4, -40); ctx.scale(0.9, 0.9);
      drawFigure(ctx, FIGURES[H.rider] || FIGURES.rider, figurePose("ride", 0), 0);
    } else if (kind === "ram") {
      ctx.translate(w / 2, h * 0.9); const k = Math.min(w / 140, h / 110); ctx.scale(k, k);
      drawRam(ctx, 0.2);
    }
    ctx.restore();
  }

  return {
    setView(w, h, dpr) { view.w = w; view.h = h; view.dpr = dpr; },
    setQuality(q) { quality = q; terrainKey = ""; },
    draw, onEvent, toWorld, toScreen,
    setSelection(patch) { sel = { ...sel, ...patch }; },
    get selection() { return sel; },
    startIntro, skipIntro() { intro = null; }, get intro() { return intro; },
    startOutro, skipOutro() { outro = null; }, get outro() { return outro; },
    fx, cache, drawIcon,
    get fit() { return fit; },
    reset() { fx.clear(); trails.clear(); warnings.clear(); catMarks.clear(); bossMarks.length = 0; openings.clear(); light = 0; intro = null; outro = null; gateShake = 0; heroMark = null; sel = { plot: -1, hover: -1, range: null, units: null, squad: false, hoverUnit: null, target: null }; },
    stats() { return { ...cache.stats(), particles: fx.count }; },
  };
}
