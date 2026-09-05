/* ------------------------------------------------------------------ *
 * Castle Defender — particles and decals.
 *
 * Dust, sparks, smoke, fire, embers, debris, coins, floating text,
 * shock rings, arrows stuck in the ground and scorch marks. Ground
 * effects draw under the figures, air effects over them. A hard cap
 * keeps phones honest: when full, the oldest particle is recycled.
 * ------------------------------------------------------------------ */

import { PAL, rgba } from "./palette.js";

const GROUND = new Set(["dust", "ring", "scorch", "arrowStuck", "rally", "shadowPuff"]);

export function createParticles(limit = 500) {
  let list = [];
  let head = 0;

  const push = (p) => {
    if (list.length < limit) list.push(p);
    else { list[head] = p; head = (head + 1) % limit; }
  };

  const spawn = (kind, x, y, o = {}) => {
    const r = Math.random;
    switch (kind) {
      case "dust":
        for (let i = 0; i < (o.n || 4); i += 1) {
          const a = r() * Math.PI * 2; const sp = 12 + r() * 30;
          push({ kind, x: x + (r() - 0.5) * 8, y: y + (r() - 0.5) * 4, z: 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.5, vz: 8 + r() * 12, life: 0, max: 0.6 + r() * 0.4, size: 4 + r() * 5, color: o.color || PAL.dust });
        }
        break;
      case "smoke":
        for (let i = 0; i < (o.n || 1); i += 1) {
          push({ kind, x: x + (r() - 0.5) * 6, y, z: o.z || 0, vx: (r() - 0.5) * 10 + (o.wind || 6), vy: -2, vz: 18 + r() * 14, life: 0, max: 1.6 + r() * 1.2, size: (o.size || 6) + r() * 4, grow: 9, color: o.color || PAL.smoke });
        }
        break;
      case "fire":
        for (let i = 0; i < (o.n || 2); i += 1) {
          push({ kind, x: x + (r() - 0.5) * (o.spread || 8), y: y + (r() - 0.5) * 3, z: o.z || 0, vx: (r() - 0.5) * 8, vy: 0, vz: 26 + r() * 20, life: 0, max: 0.35 + r() * 0.35, size: (o.size || 5) + r() * 4 });
        }
        break;
      case "ember":
        for (let i = 0; i < (o.n || 3); i += 1) {
          push({ kind, x, y, z: o.z || 4, vx: (r() - 0.5) * 40, vy: (r() - 0.5) * 20, vz: 30 + r() * 40, life: 0, max: 0.6 + r() * 0.6, size: 1.2 + r() * 1.2 });
        }
        break;
      case "spark":
        for (let i = 0; i < (o.n || 6); i += 1) {
          const a = r() * Math.PI * 2; const sp = 50 + r() * 90;
          push({ kind, x, y, z: o.z || 20, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6, vz: 30 + r() * 60, g: 260, life: 0, max: 0.25 + r() * 0.25, size: 1.6, color: o.color || "#fff2c0" });
        }
        break;
      case "debris":
        for (let i = 0; i < (o.n || 6); i += 1) {
          const a = r() * Math.PI * 2; const sp = 30 + r() * 80;
          push({ kind, x, y, z: o.z || 10, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6, vz: 60 + r() * 90, g: 320, rot: r() * 6, vr: (r() - 0.5) * 12, life: 0, max: 0.6 + r() * 0.5, size: 2 + r() * 3, color: o.color || PAL.rockLight });
        }
        break;
      case "ring":
        push({ kind, x, y, z: 0, life: 0, max: o.max || 0.45, size: o.size || 40, color: o.color || "rgba(255,240,200,0.7)", width: o.width || 3 });
        break;
      case "flash":
        push({ kind, x, y, z: o.z || 20, life: 0, max: 0.14, size: o.size || 14, color: o.color || "rgba(255,245,210,0.85)" });
        break;
      case "coin":
        push({ kind, x, y, z: 12, vx: (r() - 0.5) * 20, vy: 0, vz: 90 + r() * 30, g: 240, life: 0, max: 0.9, size: 4.5, spin: r() * 6, text: o.text });
        break;
      case "text":
        push({ kind, x, y, z: o.z || 30, vx: 0, vy: 0, vz: 22, life: 0, max: o.max || 1.0, size: o.size || 11, text: o.text, color: o.color || "#fff5dc", stroke: o.stroke || "rgba(20,14,8,0.85)", bold: o.bold });
        break;
      case "arrowStuck":
        push({ kind, x, y, z: 0, life: 0, max: 6, angle: o.angle ?? -1.1, enemy: !!o.enemy });
        break;
      case "scorch":
        push({ kind, x, y, z: 0, life: 0, max: o.max || 14, size: o.size || 30 });
        break;
      case "rally":
        push({ kind, x, y, z: 0, life: 0, max: 0.8, size: 30 });
        break;
      case "leaf":
        break;
      default: break;
    }
  };

  const update = (dt) => {
    let alive = 0;
    for (let i = 0; i < list.length; i += 1) {
      const p = list[i];
      p.life += dt;
      if (p.life >= p.max) { p.dead = true; continue; }
      alive += 1;
      if (p.vx != null) { p.x += p.vx * dt; p.y += p.vy * dt; }
      if (p.vz != null) { p.z += p.vz * dt; if (p.g) p.vz -= p.g * dt; }
      if (p.kind === "dust") { p.vx *= 0.94; p.vy *= 0.94; p.size += 10 * dt; }
      if (p.kind === "smoke") { p.size += p.grow * dt; p.vx *= 0.99; }
      if (p.kind === "debris" && p.z < 0) { p.z = 0; p.vz = -p.vz * 0.35; p.vx *= 0.6; p.vy *= 0.6; }
      if (p.kind === "coin" && p.z < 0) { p.z = 0; p.vz = 0; }
      if (p.vr) p.rot += p.vr * dt;
    }
    if (list.length > 64 && alive < list.length * 0.6) { list = list.filter((p) => !p.dead); head = 0; }
    return alive;
  };

  const drawGround = (ctx) => {
    for (const p of list) {
      if (p.dead || !GROUND.has(p.kind)) continue;
      const t = p.life / p.max;
      switch (p.kind) {
        case "dust": {
          ctx.fillStyle = p.color; ctx.globalAlpha = (1 - t) * 0.7;
          ctx.beginPath(); ctx.ellipse(p.x, p.y - p.z * 0.5, p.size, p.size * 0.55, 0, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case "ring": {
          ctx.strokeStyle = p.color; ctx.globalAlpha = 1 - t; ctx.lineWidth = p.width * (1 - t * 0.6);
          ctx.beginPath(); ctx.ellipse(p.x, p.y, p.size * (0.2 + t * 0.8), p.size * (0.2 + t * 0.8) * 0.5, 0, 0, Math.PI * 2); ctx.stroke();
          break;
        }
        case "scorch": {
          ctx.fillStyle = "#1e160e"; ctx.globalAlpha = 0.5 * (1 - t);
          ctx.beginPath(); ctx.ellipse(p.x, p.y, p.size, p.size * 0.5, 0, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case "arrowStuck": {
          ctx.globalAlpha = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angle);
          ctx.strokeStyle = p.enemy ? "#3a3535" : PAL.arrow; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(16, 0); ctx.stroke();
          ctx.fillStyle = p.enemy ? "#777" : "#e8e2d4"; ctx.beginPath(); ctx.moveTo(14, -2); ctx.lineTo(18, -1.4); ctx.lineTo(14, 0); ctx.lineTo(18, 1.4); ctx.lineTo(14, 2); ctx.fill();
          ctx.restore();
          break;
        }
        case "rally": {
          ctx.strokeStyle = rgba(PAL.gold, 1 - t); ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(p.x, p.y, p.size * (1 - t * 0.6), p.size * (1 - t * 0.6) * 0.5, 0, 0, Math.PI * 2); ctx.stroke();
          break;
        }
        default: break;
      }
      ctx.globalAlpha = 1;
    }
  };

  const drawAir = (ctx) => {
    for (const p of list) {
      if (p.dead || GROUND.has(p.kind)) continue;
      const t = p.life / p.max;
      const sy = p.y - p.z;
      switch (p.kind) {
        case "smoke": {
          ctx.fillStyle = p.color; ctx.globalAlpha = (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85) * 0.75;
          ctx.beginPath(); ctx.arc(p.x, sy, p.size, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case "fire": {
          const k = 1 - t;
          ctx.globalAlpha = 0.9 * k;
          ctx.fillStyle = t < 0.4 ? PAL.fireHot : t < 0.75 ? PAL.fire : "#c93b1a";
          ctx.beginPath(); ctx.ellipse(p.x, sy, p.size * (0.5 + k * 0.5), p.size * (0.8 + k * 0.6), 0, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case "ember": {
          ctx.globalAlpha = 1 - t; ctx.fillStyle = t < 0.5 ? PAL.fireHot : PAL.fire;
          ctx.beginPath(); ctx.arc(p.x, sy, p.size, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case "spark": {
          ctx.globalAlpha = 1 - t; ctx.strokeStyle = p.color; ctx.lineWidth = p.size;
          ctx.beginPath(); ctx.moveTo(p.x, sy); ctx.lineTo(p.x - p.vx * 0.03, sy - (p.vy - p.vz) * 0.03); ctx.stroke();
          break;
        }
        case "debris": {
          ctx.globalAlpha = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1; ctx.fillStyle = p.color;
          ctx.save(); ctx.translate(p.x, sy); ctx.rotate(p.rot); ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7); ctx.restore();
          break;
        }
        case "flash": {
          ctx.globalAlpha = 1 - t; ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.arc(p.x, sy, p.size * (0.6 + t * 0.8), 0, Math.PI * 2); ctx.fill();
          break;
        }
        case "coin": {
          ctx.globalAlpha = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
          const w = Math.abs(Math.cos(p.spin + p.life * 12)) * p.size;
          ctx.fillStyle = PAL.coinDark; ctx.beginPath(); ctx.ellipse(p.x + 0.6, sy + 0.6, w, p.size, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = PAL.coin; ctx.beginPath(); ctx.ellipse(p.x, sy, w, p.size, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "#fff0b0"; ctx.beginPath(); ctx.ellipse(p.x - w * 0.3, sy - p.size * 0.3, w * 0.3, p.size * 0.3, 0, 0, Math.PI * 2); ctx.fill();
          if (p.text) {
            ctx.font = "bold 10px Cinzel, Georgia, serif"; ctx.textAlign = "center";
            ctx.lineWidth = 3; ctx.strokeStyle = "rgba(20,14,8,0.8)"; ctx.strokeText(p.text, p.x, sy - 8);
            ctx.fillStyle = PAL.coin; ctx.fillText(p.text, p.x, sy - 8);
          }
          break;
        }
        case "text": {
          ctx.globalAlpha = t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1;
          ctx.font = `${p.bold ? "bold " : ""}${p.size}px Cinzel, Georgia, serif`; ctx.textAlign = "center";
          ctx.lineWidth = 3; ctx.strokeStyle = p.stroke; ctx.strokeText(p.text, p.x, sy);
          ctx.fillStyle = p.color; ctx.fillText(p.text, p.x, sy);
          break;
        }
        default: break;
      }
      ctx.globalAlpha = 1;
    }
  };

  return {
    spawn, update, drawGround, drawAir,
    get count() { return list.filter((p) => !p.dead).length; },
    clear() { list = []; head = 0; },
  };
}
