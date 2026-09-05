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
import { PAL, rgba } from "./art/palette.js";
import { towerLevel } from "./engine/engine.js";
import { HERO, TOWERS } from "./data/towers.js";
import { sampleRoute } from "./engine/path.js";

const FIG_BOX = { w: 110, h: 132, ax: 48, ay: 122 };
const DEAD_BOX = { w: 150, h: 70, ax: 105, ay: 52 };
const FRAMES = { walk: 8, idle: 6, attack: 8, shoot: 8, dead: 6, stun: 4, charge: 6, push: 8 };
const IDLE_PERIOD = 2.856;      // matches sin(t * 2.2)

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
  let sel = { plot: -1, hover: -1, range: null, rallyPick: false, heroPick: false, target: null };
  let gateShake = 0;
  const trails = new Map();
  let heroMark = null;
  let menuDrift = 0;
  let zoneFlicker = 0;
  let waveFlash = [0, 0];
  const blockText = new Map();

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

  function horseSprite(anim, frame) {
    const n = anim === "dead" ? 6 : 8;
    const f = ((frame % n) + n) % n;
    return cache.get(`horse:${anim}:${f}`, 150, 120, 66, 108, (ctx) => {
      if (anim === "dead") {
        const k = (f + 0.5) / n;
        ctx.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
        ctx.rotate(-k * 1.2);
        drawHorse(ctx, 0.1, "#4a3323");
        ctx.save(); ctx.translate(-4, -40); ctx.scale(0.9, 0.9);
        drawFigure(ctx, FIGURES.rider, figurePose("idle", 0.5), 0);
        ctx.restore();
        return;
      }
      const t = anim === "walk" ? f / n : 0.1;
      drawHorse(ctx, t, "#4a3323");
      const rp = anim === "attack" ? figurePose("attack", (f + 0.5) / n) : figurePose("idle", (f / n) * IDLE_PERIOD);
      rp.legN.hip = 30; rp.legN.knee = 40; rp.legF.hip = 30; rp.legF.knee = 40;
      ctx.save(); ctx.translate(-4, -40); ctx.scale(0.9, 0.9);
      drawFigure(ctx, FIGURES.rider, rp, 0);
      ctx.restore();
    });
  }

  function ramSprite(frame, dead) {
    const n = 8;
    const f = ((frame % n) + n) % n;
    return cache.get(`ram:${dead ? "dead" : "walk"}:${f}`, 160, 120, 76, 104, (ctx) => {
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
      case "miniboss": fx.spawn("ring", e.x, e.y, { size: 120, color: rgba(PAL.red, 0.7), max: 1.2, width: 4 }); break;
      case "minibossDown": break;
      case "spawn": fx.spawn("dust", e.x, e.y, { n: 2 }); break;
      case "levyLeave": fx.spawn("dust", e.x, e.y, { n: 3 }); break;
      case "layout": trails.clear(); break;
      default: break;
    }
  }

  /* ------------------------------ entities ------------------------------ */

  function unitAnim(u, enemy) {
    const def = u.def;
    if (u.state === "dead") return { anim: "dead", frame: Math.floor((1 - Math.max(0, u.deadT) / 1.5) * FRAMES.dead) };
    if (u.state === "stun") return { anim: "stun", frame: Math.floor(u.animT * 6) };
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
    if (e.type === "outrider") {
      const a = e.state === "dead" ? "dead" : e.state === "fight" ? "attack" : e.state === "walk" ? "walk" : "idle";
      const frame = a === "dead" ? Math.floor((1 - Math.max(0, e.deadT) / 1.5) * 6) : a === "walk" ? Math.floor(e.animT * def.speed / 60 * 8) : Math.floor(e.animT * 6);
      sp = horseSprite(a, frame);
    } else if (e.type === "ram") {
      sp = ramSprite(e.state === "dead" ? Math.floor((1 - Math.max(0, e.deadT) / 1.5) * 8) : Math.floor(e.d / 14), e.state === "dead");
      if (e.state !== "dead" && Math.random() < 0.08) fx.spawn("dust", e.x - 30 * e.face, e.y + 4, { n: 1 });
    } else {
      const { anim, frame } = unitAnim(e, true);
      sp = figureSprite(figureKey("enemy", e.type, true), e.id % 2, anim, frame);
    }
    const hitFlash = e.hitT > 0.12;
    cache.blit(ctx, sp, e.x, e.y + ay, flip);
    if (hitFlash && e.state !== "dead") {
      ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.45;
      cache.blit(ctx, sp, e.x, e.y + ay, flip);
      ctx.restore();
    }
    if (e.state !== "dead" && e.hp < e.maxHp) {
      const w = def.boss ? 60 : 24;
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
    const sp = figureSprite(key, u.kind === "hero" ? 0 : u.id % 2, anim, frame);
    const flip = u.face < 0;
    const alpha = u.fade ? 0.5 : 1;
    cache.blit(ctx, sp, u.x, u.y, flip, alpha);
    if (u.hitT > 0.12 && u.state !== "dead") {
      ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.4;
      cache.blit(ctx, sp, u.x, u.y, flip);
      ctx.restore();
    }
    if (u.state === "charge" && Math.random() < 0.6) fx.spawn("dust", u.x - u.face * 10, u.y, { n: 1 });
    const h = u.kind === "hero" ? 70 : 60;
    if (u.state !== "dead" && u.state !== "respawn" && u.hp < u.maxHp) hpBar(ctx, u.x, u.y - h - 6, u.kind === "hero" ? 34 : 22, u.hp / u.maxHp, false, false);
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
    ctx.restore();
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
    time += dt;
    const layout = s.layout;
    if (opts.menu) {
      menuDrift += dt;
      cam.zoom = 1.55;
      cam.x = layout.w * 0.62 + Math.sin(menuDrift * 0.11) * layout.w * 0.14;
      cam.y = layout.h * 0.5 + Math.cos(menuDrift * 0.09) * layout.h * 0.12;
    } else if (intro) {
      stepIntro(s, dt);
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
    for (const e of s.enemies) if (e.state !== "dead" || e.deadT > 0.8) shadow(e.x, e.y, e.type === "ram" ? 44 : e.type === "outrider" ? 26 : 12);
    for (const u of s.units) if (u.state !== "dead" && u.state !== "respawn") shadow(u.x, u.y, 11);
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
      for (const e of s.enemies) items.push({ y: e.y + (e.state === "dead" ? -30 : 0), fn: () => drawEnemy(ctx, e) });
      for (const u of s.units) if (u.state !== "respawn") items.push({ y: u.y + (u.state === "dead" ? -30 : 0), fn: () => drawUnit(ctx, u) });
      if (s.hero.state !== "respawn") items.push({ y: s.hero.y + (s.hero.state === "dead" ? -30 : 0), fn: () => drawUnit(ctx, s.hero) });
      for (const pr of s.projectiles) items.push({ y: pr.y + 1, fn: () => drawProjectile(ctx, pr) });
    }
    if (intro && intro.parade) for (const pe of intro.parade) items.push({ y: pe.y, fn: () => drawParade(ctx, pe) });
    /* route entrance banners */
    layout.flags.forEach((f, i) => {
      if (i > 0 && s.wave + 1 < (layout.routes[i].opensAt || 1) && s.mode !== "endless") return;
      items.push({ y: f.y, fn: () => drawWarFlag(ctx, f.x, f.y, opts.menu ? 0 : 0.95, waveFlash[i] || 0) });
    });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.fn();

    /* prune projectile trails */
    if (s.projectiles.length === 0 && trails.size) trails.clear();
    else if (trails.size > 200) { const live = new Set(s.projectiles.map((p) => p.id)); for (const k of trails.keys()) if (!live.has(k)) trails.delete(k); }

    /* air particles and castle smoke */
    fx.update(dt);
    fx.drawAir(ctx);

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
    ctx.restore();
  }

  function drawCastleLive(ctx, s, castle, dmg) {
    const sp = castleSprite(castle, dmg);
    cache.blit(ctx, sp, castle.x, castle.y);
    castleFlags(castle).forEach((f, i) => drawFlag(ctx, castle.x + f.x, castle.y + f.y, f.h, f.size, f.color, f.trim, i * 1.3));
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
      ctx.translate(w / 2, h * 0.9); const k = Math.min(w / 110, h / 90); ctx.scale(k, k);
      drawHorse(ctx, 0.2, "#4a3323");
      ctx.translate(-4, -40); ctx.scale(0.9, 0.9); const rp = figurePose("idle", 0.3); rp.legN.hip = 30; rp.legF.hip = 30; rp.legN.knee = 40; rp.legF.knee = 40;
      drawFigure(ctx, FIGURES.rider, rp, 0);
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
    fx, cache, drawIcon,
    get fit() { return fit; },
    reset() { fx.clear(); trails.clear(); intro = null; gateShake = 0; heroMark = null; sel = { plot: -1, hover: -1, range: null }; },
    stats() { return { ...cache.stats(), particles: fx.count }; },
  };
}
