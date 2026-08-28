/* ------------------------------------------------------------------ *
 * Neon Space Shooter — canvas renderer.
 *
 * All the neon comes from sprites baked once, at startup, on small
 * offscreen canvases with the glow (shadowBlur) paid for at bake time.
 * A frame is then nothing but drawImage calls, gradient fills and a
 * pooled particle pass — cheap enough for a phone.
 *
 * The engine works in logical pixels (VIEW_H tall); draw() maps that
 * onto whatever CSS-pixel viewport the shell provides and letterboxes
 * the sides when the screen is wider than the playfield.
 * ------------------------------------------------------------------ */

import { VIEW_H, SHIP_R, MAX_WEAPON, MAX_HEARTS, POWER_TIME, POWER_LABEL } from "./engine.js";

const TAU = Math.PI * 2;

function bake(w, h, fn) {
  const c = typeof document !== "undefined"
    ? document.createElement("canvas")
    : { width: 0, height: 0, getContext: () => null };
  c.width = w * 2;
  c.height = h * 2;
  const ctx = c.getContext("2d");
  if (ctx) {
    ctx.scale(2, 2);
    fn(ctx, w, h);
  }
  return { canvas: c, w, h };
}

function glowPath(ctx, colour, blur, fill, drawFn) {
  ctx.save();
  ctx.shadowColor = colour;
  ctx.shadowBlur = blur;
  ctx.fillStyle = fill;
  drawFn(ctx);
  ctx.fill();
  ctx.restore();
}

/* ------------------------------ sprites ------------------------------ */

function bakeShip() {
  return bake(52, 58, (ctx, w) => {
    const cx = w / 2;
    // violet wing blades behind the hull
    glowPath(ctx, "#9e62ff", 9, "#5b2ea8", (c) => {
      c.beginPath();
      c.moveTo(cx - 7, 24); c.lineTo(2, 46); c.lineTo(cx - 8, 42);
      c.lineTo(cx + 8, 42); c.lineTo(w - 2, 46); c.lineTo(cx + 7, 24);
      c.closePath();
    });
    const wing = ctx.createLinearGradient(0, 20, 0, 48);
    wing.addColorStop(0, "#b487ff");
    wing.addColorStop(1, "#4a1f96");
    ctx.fillStyle = wing;
    ctx.beginPath();
    ctx.moveTo(cx - 6, 26); ctx.lineTo(5, 44); ctx.lineTo(cx - 7, 40); ctx.closePath();
    ctx.moveTo(cx + 6, 26); ctx.lineTo(w - 5, 44); ctx.lineTo(cx + 7, 40); ctx.closePath();
    ctx.fill();
    // main hull
    glowPath(ctx, "#52e9ff", 12, "#123c66", (c) => {
      c.beginPath();
      c.moveTo(cx, 2);
      c.quadraticCurveTo(cx + 9, 18, cx + 10, 34);
      c.lineTo(cx + 13, 48); c.lineTo(cx + 5, 44);
      c.lineTo(cx, 52); c.lineTo(cx - 5, 44);
      c.lineTo(cx - 13, 48); c.lineTo(cx - 10, 34);
      c.quadraticCurveTo(cx - 9, 18, cx, 2);
      c.closePath();
    });
    const hull = ctx.createLinearGradient(0, 2, 0, 52);
    hull.addColorStop(0, "#eafcff");
    hull.addColorStop(0.45, "#6fd9ff");
    hull.addColorStop(1, "#1e6fae");
    ctx.fillStyle = hull;
    ctx.beginPath();
    ctx.moveTo(cx, 4);
    ctx.quadraticCurveTo(cx + 8, 18, cx + 9, 34);
    ctx.lineTo(cx + 11, 46); ctx.lineTo(cx + 4, 42);
    ctx.lineTo(cx, 49); ctx.lineTo(cx - 4, 42);
    ctx.lineTo(cx - 11, 46); ctx.lineTo(cx - 9, 34);
    ctx.quadraticCurveTo(cx - 8, 18, cx, 4);
    ctx.closePath();
    ctx.fill();
    // spine line + cockpit
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillRect(cx - 0.7, 6, 1.4, 34);
    glowPath(ctx, "#7ef2ff", 8, "#dffbff", (c) => {
      c.beginPath();
      c.ellipse(cx, 22, 3.4, 6, 0, 0, TAU);
    });
    ctx.fillStyle = "#0f5c8f";
    ctx.beginPath();
    ctx.ellipse(cx, 24, 2, 3.4, 0, 0, TAU);
    ctx.fill();
  });
}

/* Each enemy gets a distinct silhouette and colour so a glance reads
   the threat, in the same soft-neon language as the player's ship. */
function bakeEnemy(kind) {
  const P = {
    basic: { w: 38, h: 30, glow: "#ff5f8f" },
    fast: { w: 28, h: 32, glow: "#ffab47" },
    zigzag: { w: 36, h: 28, glow: "#3dffc8" },
    shooter: { w: 40, h: 36, glow: "#ff4747" },
    heavy: { w: 58, h: 50, glow: "#b06bff" },
    elite: { w: 48, h: 42, glow: "#ffd34d" },
    mini: { w: 78, h: 52, glow: "#ff416c" },
  }[kind];
  return bake(P.w, P.h, (ctx, w, h) => {
    const cx = w / 2, cy = h / 2;
    if (kind === "basic") {
      glowPath(ctx, P.glow, 9, "#7d1743", (c) => {
        c.beginPath(); c.ellipse(cx, cy + 3, 16, 9, 0, 0, TAU);
      });
      const g = ctx.createLinearGradient(0, cy - 6, 0, cy + 12);
      g.addColorStop(0, "#ff8fb3"); g.addColorStop(1, "#a01d55");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(cx, cy + 3, 14.5, 8, 0, 0, TAU); ctx.fill();
      glowPath(ctx, "#ffd0e2", 6, "#ffc4d9", (c) => {
        c.beginPath(); c.ellipse(cx, cy - 5, 6.5, 5.5, 0, Math.PI, 0); c.closePath();
      });
      ctx.fillStyle = "rgba(20,4,14,.6)";
      for (let i = -1; i <= 1; i += 1) { ctx.beginPath(); ctx.arc(cx + i * 8, cy + 5, 1.7, 0, TAU); ctx.fill(); }
    } else if (kind === "fast") {
      glowPath(ctx, P.glow, 9, "#8f4a08", (c) => {
        c.beginPath();
        c.moveTo(cx, h - 2); c.lineTo(cx + 11, 8); c.lineTo(cx, 13); c.lineTo(cx - 11, 8);
        c.closePath();
      });
      const g = ctx.createLinearGradient(0, 4, 0, h);
      g.addColorStop(0, "#ffd9a1"); g.addColorStop(0.5, "#ffab47"); g.addColorStop(1, "#c65f10");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(cx, h - 4); ctx.lineTo(cx + 9, 9); ctx.lineTo(cx, 13.5); ctx.lineTo(cx - 9, 9);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.75)";
      ctx.beginPath(); ctx.arc(cx, h - 11, 2.2, 0, TAU); ctx.fill();
    } else if (kind === "zigzag") {
      glowPath(ctx, P.glow, 9, "#0b5e46", (c) => {
        c.beginPath();
        c.moveTo(2, 6); c.lineTo(cx, 15); c.lineTo(w - 2, 6);
        c.lineTo(w - 8, h - 4); c.lineTo(cx, h - 12); c.lineTo(8, h - 4);
        c.closePath();
      });
      const g = ctx.createLinearGradient(0, 4, 0, h);
      g.addColorStop(0, "#9dffe4"); g.addColorStop(1, "#0f8a68");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(4, 7); ctx.lineTo(cx, 15.5); ctx.lineTo(w - 4, 7);
      ctx.lineTo(w - 9, h - 6); ctx.lineTo(cx, h - 13); ctx.lineTo(9, h - 6);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(6,30,24,.75)";
      ctx.beginPath(); ctx.arc(cx, cy + 2, 3, 0, TAU); ctx.fill();
    } else if (kind === "shooter") {
      glowPath(ctx, P.glow, 10, "#6e1212", (c) => {
        c.beginPath();
        c.moveTo(cx - 15, 6); c.lineTo(cx + 15, 6); c.lineTo(cx + 18, 20);
        c.lineTo(cx + 6, 26); c.lineTo(cx - 6, 26); c.lineTo(cx - 18, 20);
        c.closePath();
      });
      const g = ctx.createLinearGradient(0, 4, 0, 28);
      g.addColorStop(0, "#ff9d9d"); g.addColorStop(1, "#9c1414");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(cx - 13, 7.5); ctx.lineTo(cx + 13, 7.5); ctx.lineTo(cx + 16, 19.5);
      ctx.lineTo(cx + 5, 24.5); ctx.lineTo(cx - 5, 24.5); ctx.lineTo(cx - 16, 19.5);
      ctx.closePath(); ctx.fill();
      // the gun barrel, pointing at the player
      glowPath(ctx, "#ffce6b", 7, "#ffce6b", (c) => {
        c.beginPath(); c.rect(cx - 2.4, 24, 4.8, 9);
      });
      ctx.fillStyle = "rgba(30,3,3,.7)";
      ctx.beginPath(); ctx.arc(cx, 15, 3.4, 0, TAU); ctx.fill();
    } else if (kind === "heavy") {
      glowPath(ctx, P.glow, 11, "#3c1a68", (c) => {
        c.beginPath();
        c.moveTo(cx, 3); c.lineTo(w - 6, 14); c.lineTo(w - 3, 34);
        c.lineTo(cx, h - 3); c.lineTo(3, 34); c.lineTo(6, 14);
        c.closePath();
      });
      const g = ctx.createLinearGradient(0, 2, 0, h);
      g.addColorStop(0, "#d3a9ff"); g.addColorStop(0.55, "#8b46e0"); g.addColorStop(1, "#3c1a68");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(cx, 6); ctx.lineTo(w - 8, 15.5); ctx.lineTo(w - 5.5, 33);
      ctx.lineTo(cx, h - 6); ctx.lineTo(5.5, 33); ctx.lineTo(8, 15.5);
      ctx.closePath(); ctx.fill();
      // armour plates
      ctx.strokeStyle = "rgba(20,6,40,.55)";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(cx, 6); ctx.lineTo(cx, h - 6);
      ctx.moveTo(10, 18); ctx.lineTo(w - 10, 18);
      ctx.stroke();
      glowPath(ctx, "#ff7ce8", 8, "#ffb1f1", (c) => {
        c.beginPath(); c.arc(cx, cy + 2, 5.4, 0, TAU);
      });
    } else if (kind === "elite") {
      glowPath(ctx, P.glow, 11, "#7a5410", (c) => {
        c.beginPath();
        c.moveTo(cx, 2); c.lineTo(cx + 10, 12); c.lineTo(w - 2, 6); c.lineTo(w - 7, 26);
        c.lineTo(cx, h - 2); c.lineTo(7, 26); c.lineTo(2, 6); c.lineTo(cx - 10, 12);
        c.closePath();
      });
      const g = ctx.createLinearGradient(0, 2, 0, h);
      g.addColorStop(0, "#fff3c9"); g.addColorStop(0.5, "#ffd34d"); g.addColorStop(1, "#a8720e");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(cx, 5); ctx.lineTo(cx + 9, 13.5); ctx.lineTo(w - 5, 8); ctx.lineTo(w - 9, 25);
      ctx.lineTo(cx, h - 5); ctx.lineTo(9, 25); ctx.lineTo(5, 8); ctx.lineTo(cx - 9, 13.5);
      ctx.closePath(); ctx.fill();
      glowPath(ctx, "#9e62ff", 8, "#7736e0", (c) => {
        c.beginPath(); c.arc(cx, cy + 3, 5, 0, TAU);
      });
      ctx.fillStyle = "rgba(255,255,255,.8)";
      ctx.beginPath(); ctx.arc(cx, cy + 3, 2, 0, TAU); ctx.fill();
    } else { // mini boss cruiser
      glowPath(ctx, P.glow, 12, "#59102c", (c) => {
        c.beginPath();
        c.moveTo(6, 10); c.lineTo(w - 6, 10); c.lineTo(w - 2, 26);
        c.lineTo(cx + 14, h - 4); c.lineTo(cx - 14, h - 4); c.lineTo(2, 26);
        c.closePath();
      });
      const g = ctx.createLinearGradient(0, 6, 0, h);
      g.addColorStop(0, "#ff97b3"); g.addColorStop(0.5, "#e02458"); g.addColorStop(1, "#6e0f2f");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(8, 12); ctx.lineTo(w - 8, 12); ctx.lineTo(w - 5, 25.5);
      ctx.lineTo(cx + 12.5, h - 6); ctx.lineTo(cx - 12.5, h - 6); ctx.lineTo(5, 25.5);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(40,4,16,.5)";
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(cx, 12); ctx.lineTo(cx, h - 6); ctx.stroke();
      for (const dx of [-18, 0, 18]) {
        glowPath(ctx, "#ffe08a", 7, "#ffd34d", (c) => {
          c.beginPath(); c.arc(cx + dx, 19, 3.2, 0, TAU);
        });
      }
    }
  });
}

function bakeBoss() {
  return bake(124, 78, (ctx, w, h) => {
    const cx = w / 2;
    // wings
    glowPath(ctx, "#ff416c", 12, "#4d0a22", (c) => {
      c.beginPath();
      c.moveTo(2, 16); c.lineTo(cx - 18, 26); c.lineTo(cx - 14, 52); c.lineTo(6, 44);
      c.closePath();
      c.moveTo(w - 2, 16); c.lineTo(cx + 18, 26); c.lineTo(cx + 14, 52); c.lineTo(w - 6, 44);
      c.closePath();
    });
    const wg = ctx.createLinearGradient(0, 12, 0, 54);
    wg.addColorStop(0, "#ff6c93"); wg.addColorStop(1, "#7a1136");
    ctx.fillStyle = wg;
    ctx.beginPath();
    ctx.moveTo(5, 18); ctx.lineTo(cx - 18, 27); ctx.lineTo(cx - 15, 49); ctx.lineTo(9, 42);
    ctx.closePath();
    ctx.moveTo(w - 5, 18); ctx.lineTo(cx + 18, 27); ctx.lineTo(cx + 15, 49); ctx.lineTo(w - 9, 42);
    ctx.closePath();
    ctx.fill();
    // hull
    glowPath(ctx, "#b06bff", 14, "#2b1052", (c) => {
      c.beginPath();
      c.moveTo(cx - 20, 6); c.lineTo(cx + 20, 6); c.lineTo(cx + 26, 34);
      c.lineTo(cx + 12, h - 6); c.lineTo(cx - 12, h - 6); c.lineTo(cx - 26, 34);
      c.closePath();
    });
    const g = ctx.createLinearGradient(0, 4, 0, h);
    g.addColorStop(0, "#cfa4ff"); g.addColorStop(0.5, "#7d3ce0"); g.addColorStop(1, "#2b1052");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx - 18, 8); ctx.lineTo(cx + 18, 8); ctx.lineTo(cx + 24, 33);
    ctx.lineTo(cx + 10.5, h - 8); ctx.lineTo(cx - 10.5, h - 8); ctx.lineTo(cx - 24, 33);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(18,4,40,.6)";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(cx, 8); ctx.lineTo(cx, h - 8);
    ctx.moveTo(cx - 22, 24); ctx.lineTo(cx + 22, 24);
    ctx.stroke();
    // the core — the renderer pulses this at runtime during weak windows
    glowPath(ctx, "#7ef2ff", 12, "#aef7ff", (c) => {
      c.beginPath(); c.arc(cx, 38, 9, 0, TAU);
    });
    ctx.fillStyle = "#0f5c8f";
    ctx.beginPath(); ctx.arc(cx, 38, 4.4, 0, TAU); ctx.fill();
    // gun pods
    for (const dx of [-30, 30]) {
      glowPath(ctx, "#ffd34d", 8, "#ffce6b", (c) => {
        c.beginPath(); c.arc(cx + dx, 46, 4.2, 0, TAU);
      });
    }
  });
}

function bakeShot(heavy) {
  const w = heavy ? 12 : 8, h = heavy ? 26 : 22;
  return bake(w, h, (ctx) => {
    glowPath(ctx, "#52e9ff", 8, "#52e9ff", (c) => {
      c.beginPath();
      c.roundRect(w / 2 - (heavy ? 3.2 : 2.2), 3, heavy ? 6.4 : 4.4, h - 6, 4);
    });
    ctx.fillStyle = "#eaffff";
    ctx.beginPath();
    ctx.roundRect(w / 2 - (heavy ? 1.6 : 1.1), 4.5, heavy ? 3.2 : 2.2, h - 9, 3);
    ctx.fill();
  });
}

function bakeBolt() {
  return bake(14, 14, (ctx, w, h) => {
    glowPath(ctx, "#ff5f3c", 8, "#ff5f3c", (c) => {
      c.beginPath(); c.arc(w / 2, h / 2, 3.6, 0, TAU);
    });
    ctx.fillStyle = "#ffd9c9";
    ctx.beginPath(); ctx.arc(w / 2, h / 2, 1.8, 0, TAU); ctx.fill();
  });
}

function bakeMissile() {
  return bake(10, 22, (ctx, w, h) => {
    glowPath(ctx, "#7ef2ff", 6, "#bdeeff", (c) => {
      c.beginPath();
      c.moveTo(w / 2, 2); c.lineTo(w / 2 + 3, 10); c.lineTo(w / 2 + 2.4, h - 4);
      c.lineTo(w / 2 - 2.4, h - 4); c.lineTo(w / 2 - 3, 10);
      c.closePath();
    });
    ctx.fillStyle = "#3aa7ff";
    ctx.fillRect(w / 2 - 2, h - 6, 4, 3);
  });
}

function bakeCrystal() {
  return bake(20, 24, (ctx, w, h) => {
    glowPath(ctx, "#3dffc8", 9, "#0f8a68", (c) => {
      c.beginPath();
      c.moveTo(w / 2, 2); c.lineTo(w - 3, h * 0.4); c.lineTo(w / 2, h - 2); c.lineTo(3, h * 0.4);
      c.closePath();
    });
    const g = ctx.createLinearGradient(0, 2, 0, h);
    g.addColorStop(0, "#d8fff2"); g.addColorStop(0.45, "#5cffd9"); g.addColorStop(1, "#0f9a74");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(w / 2, 4); ctx.lineTo(w - 5, h * 0.4); ctx.lineTo(w / 2, h - 4); ctx.lineTo(5, h * 0.4);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.8)";
    ctx.beginPath();
    ctx.moveTo(w / 2, 5.5); ctx.lineTo(w / 2 + 3.6, h * 0.36); ctx.lineTo(w / 2, h * 0.44);
    ctx.closePath(); ctx.fill();
  });
}

const POWER_STYLE = {
  upgrade: ["#ffd34d", "▲"],
  double: ["#52e9ff", "‖"],
  triple: ["#9e62ff", "Ψ"],
  rapid: ["#ffab47", "»"],
  shield: ["#4d9fff", "◍"],
  beam: ["#ff5f8f", "†"],
  missiles: ["#ff6c50", "➤"],
  magnet: ["#3dffc8", "U"],
};

function bakeDrop(kind) {
  const [colour, glyph] = POWER_STYLE[kind];
  return bake(32, 32, (ctx, w, h) => {
    glowPath(ctx, colour, 9, "rgba(10,14,26,.92)", (c) => {
      c.beginPath();
      c.roundRect(4, 4, w - 8, h - 8, 9);
    });
    ctx.strokeStyle = colour;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(4, 4, w - 8, h - 8, 9);
    ctx.stroke();
    ctx.fillStyle = colour;
    ctx.font = "700 15px 'DM Sans', Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(glyph, w / 2, h / 2 + 1);
  });
}

function bakeHeart(on) {
  return bake(22, 20, (ctx, w) => {
    const draw = (c) => {
      c.beginPath();
      c.moveTo(w / 2, 17.5);
      c.bezierCurveTo(2, 10, 2.5, 2.5, w / 2 - 0.5, 6.5);
      c.bezierCurveTo(w - 2.5, 2.5, w - 2, 10, w / 2, 17.5);
      c.closePath();
    };
    if (on) {
      glowPath(ctx, "#ff5f8f", 8, "#ff4d7e", draw);
      ctx.fillStyle = "rgba(255,255,255,.35)";
      ctx.beginPath(); ctx.ellipse(7.4, 7.4, 2.6, 1.8, -0.5, 0, TAU); ctx.fill();
    } else {
      ctx.strokeStyle = "rgba(255,255,255,.28)";
      ctx.lineWidth = 1.6;
      draw(ctx);
      ctx.stroke();
    }
  });
}

function bakePlanet(size, inner, mid, outer, glow) {
  return bake(size, size, (ctx, w) => {
    const r = w / 2 - 4;
    glowPath(ctx, glow, 10, "#000", (c) => {
      c.beginPath(); c.arc(w / 2, w / 2, r, 0, TAU);
    });
    const g = ctx.createRadialGradient(w * 0.36, w * 0.32, r * 0.1, w / 2, w / 2, r);
    g.addColorStop(0, inner); g.addColorStop(0.55, mid); g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(w / 2, w / 2, r, 0, TAU); ctx.fill();
    // terminator shadow
    ctx.fillStyle = "rgba(3,6,20,.55)";
    ctx.beginPath();
    ctx.arc(w / 2, w / 2, r, -0.6, Math.PI * 0.7);
    ctx.arc(w * 0.62, w * 0.42, r * 0.92, Math.PI * 0.7, -0.6, true);
    ctx.closePath(); ctx.fill();
  });
}

function bakeNebula(colour1, colour2) {
  return bake(240, 180, (ctx, w, h) => {
    for (const [fx, fy, fr, col] of [
      [0.4, 0.5, 0.5, colour1],
      [0.62, 0.36, 0.32, colour2],
      [0.28, 0.62, 0.3, colour2],
    ]) {
      const g = ctx.createRadialGradient(w * fx, h * fy, 4, w * fx, h * fy, w * fr);
      g.addColorStop(0, col);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  });
}

function bakeStation() {
  return bake(90, 40, (ctx, w, h) => {
    ctx.fillStyle = "#141b33";
    ctx.fillRect(8, h / 2 - 4, w - 16, 8);
    ctx.fillRect(w / 2 - 5, 4, 10, h - 8);
    ctx.beginPath(); ctx.ellipse(w / 2, h / 2, 14, 7, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = "rgba(122,226,255,.75)";
    for (let i = 0; i < 7; i += 1) ctx.fillRect(13 + i * 10, h / 2 - 1.2, 3, 2.4);
    glowPath(ctx, "#ff5f8f", 6, "#ff5f8f", (c) => {
      c.beginPath(); c.arc(w / 2, 6, 1.8, 0, TAU);
    });
  });
}

/* ------------------------------ renderer ------------------------------ */

const EXPLODE_COLOURS = {
  basic: ["#ff8fb3", "#ff5f8f"],
  fast: ["#ffd9a1", "#ffab47"],
  zigzag: ["#9dffe4", "#3dffc8"],
  shooter: ["#ff9d9d", "#ff4747"],
  heavy: ["#d3a9ff", "#b06bff"],
  elite: ["#fff3c9", "#ffd34d"],
  mini: ["#ff97b3", "#ff416c"],
  boss: ["#cfa4ff", "#ff6c93"],
  missile: ["#bdeeff", "#52e9ff"],
  player: ["#eafcff", "#52e9ff"],
};

const MAX_PARTICLES = 220;

export function createRenderer() {
  const spr = {
    ship: bakeShip(),
    basic: bakeEnemy("basic"),
    fast: bakeEnemy("fast"),
    zigzag: bakeEnemy("zigzag"),
    shooter: bakeEnemy("shooter"),
    heavy: bakeEnemy("heavy"),
    elite: bakeEnemy("elite"),
    mini: bakeEnemy("mini"),
    boss: bakeBoss(),
    shot: bakeShot(false),
    heavyShot: bakeShot(true),
    bolt: bakeBolt(),
    missile: bakeMissile(),
    crystal: bakeCrystal(),
    heart: bakeHeart(true),
    heartOff: bakeHeart(false),
    planetA: bakePlanet(120, "#9be8ff", "#2a7ad2", "#123a78", "#5abeff"),
    planetB: bakePlanet(74, "#ffc9ec", "#b0479e", "#4d1147", "#ff8fd9"),
    nebulaA: bakeNebula("rgba(122,58,224,.4)", "rgba(64,120,255,.3)"),
    nebulaB: bakeNebula("rgba(255,72,150,.28)", "rgba(122,58,224,.26)"),
    station: bakeStation(),
    drops: Object.fromEntries(Object.keys(POWER_STYLE).map((k) => [k, bakeDrop(k)])),
  };

  /* stars live in normalised coords so a resize never re-rolls the sky */
  const mkStars = (n, seedMul) => {
    const out = [];
    for (let i = 0; i < n; i += 1) {
      const a = Math.sin(i * 127.1 * seedMul) * 43758.5453;
      const b = Math.sin(i * 269.5 * seedMul) * 24634.6345;
      out.push({ fx: a - Math.floor(a), fy: b - Math.floor(b), tw: 2 + (i % 5), ph: i * 1.7 });
    }
    return out;
  };
  const starsFar = mkStars(64, 1);
  const starsMid = mkStars(36, 2.3);
  const starsNear = mkStars(18, 3.7);

  const fx = {
    particles: [],
    toasts: [],        // {text, colour, t}
    announce: null,    // {lines: [big, small], t, dur, colour}
    combo: null,       // {text, t}
    flash: 0,          // red damage vignette
    starT: 0,
  };

  function particle(p) {
    if (fx.particles.length >= MAX_PARTICLES) return;
    fx.particles.push(p);
  }

  function explode(x, y, kind, big) {
    const [c1, c2] = EXPLODE_COLOURS[kind] || EXPLODE_COLOURS.basic;
    const n = big ? 16 : 9;
    const speed = big ? 260 : 170;
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * TAU + Math.sin(x + i) * 0.5;
      const v = speed * (0.35 + ((i * 37) % 10) / 14);
      particle({
        type: "spark", x, y,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life: 0, max: big ? 0.7 : 0.45,
        size: big ? 3.4 : 2.4,
        colour: i % 2 ? c1 : c2,
      });
    }
    particle({ type: "flash", x, y, life: 0, max: big ? 0.3 : 0.2, size: big ? 60 : 34, colour: c1 });
    particle({ type: "ring", x, y, life: 0, max: big ? 0.55 : 0.38, size: big ? 74 : 42, colour: c2 });
  }

  function onEvent(e) {
    switch (e.type) {
      case "explode":
        explode(e.x, e.y, e.a.kind, e.a.big);
        break;
      case "spark":
        particle({ type: "spark", x: e.x, y: e.y, vx: 0, vy: -60, life: 0, max: 0.18, size: 2, colour: "#aef7ff" });
        break;
      case "crystal":
        for (let i = 0; i < 5; i += 1) {
          particle({
            type: "spark", x: e.x, y: e.y,
            vx: Math.cos(i * 1.26) * 90, vy: Math.sin(i * 1.26) * 90 - 40,
            life: 0, max: 0.3, size: 2, colour: "#5cffd9",
          });
        }
        break;
      case "hit":
        fx.flash = 0.55;
        break;
      case "shieldBreak":
        fx.flash = 0.3;
        fx.toasts.push({ text: "SHIELD DOWN", colour: "#4d9fff", t: 0 });
        break;
      case "power":
        fx.toasts.push({ text: POWER_LABEL[e.a] || "POWER-UP", colour: POWER_STYLE[e.a]?.[0] || "#fff", t: 0 });
        break;
      case "upgrade":
        fx.toasts.push({ text: `WEAPON LEVEL ${e.a}`, colour: "#ffd34d", t: 0 });
        break;
      case "combo":
        fx.combo = { text: e.a, t: 0 };
        break;
      case "wave":
        fx.announce = { lines: [`WAVE ${e.a}`, null], t: 0, dur: 1.6, colour: "#52e9ff" };
        break;
      case "bossWarn":
        fx.announce = { lines: ["WARNING", "BOSS INCOMING"], t: 0, dur: 2.2, colour: "#ff416c", pulse: true };
        break;
      case "bossDown":
        fx.announce = { lines: ["BOSS DESTROYED", null], t: 0, dur: 2.4, colour: "#ffd34d" };
        break;
      default:
        break;
    }
  }

  function reset() {
    fx.particles.length = 0;
    fx.toasts.length = 0;
    fx.announce = null;
    fx.combo = null;
    fx.flash = 0;
  }

  /* ----------------------------- background ----------------------------- */

  function drawBackground(ctx, s, vw, vh, t) {
    const g = ctx.createLinearGradient(0, 0, 0, vh);
    g.addColorStop(0, "#05060f");
    g.addColorStop(0.5, "#0b0a22");
    g.addColorStop(1, "#120b20");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, vw, vh);

    // nebulae drift very slowly; parallax comes from different scroll rates
    const nebY = (off, sp) => ((t * sp + off) % (vh + 340)) - 260;
    ctx.globalAlpha = 0.75;
    ctx.drawImage(spr.nebulaA.canvas, vw * 0.06, nebY(60, 6), 300, 225);
    ctx.drawImage(spr.nebulaB.canvas, vw * 0.55, nebY(vh * 0.62, 8), 260, 195);
    ctx.globalAlpha = 1;

    const layer = (stars, sp, size, alpha) => {
      ctx.fillStyle = "#fff";
      for (const st of stars) {
        const x = st.fx * vw;
        const y = (st.fy * vh + t * sp) % vh;
        const tw = alpha * (0.55 + 0.45 * Math.sin(t * st.tw + st.ph));
        ctx.globalAlpha = tw;
        ctx.fillRect(x, y, size, size + (sp > 40 ? 3 : 0));
      }
      ctx.globalAlpha = 1;
    };
    layer(starsFar, 12, 1, 0.5);
    layer(starsMid, 26, 1.5, 0.7);
    layer(starsNear, 58, 2, 0.95);

    // set dressing on long loops so it stays scenery, not noise
    const loop = (period, off) => ((t * 9 + off) % period) - 160;
    ctx.globalAlpha = 0.9;
    ctx.drawImage(spr.planetA.canvas, vw * 0.72, loop(vh + 900, 0), 96, 96);
    ctx.globalAlpha = 0.8;
    ctx.drawImage(spr.planetB.canvas, vw * 0.08, loop(vh + 1300, 700), 56, 56);
    ctx.globalAlpha = 0.65;
    ctx.drawImage(spr.station.canvas, vw * 0.3, loop(vh + 1700, 1200), 76, 34);
    ctx.globalAlpha = 1;
  }

  /* ------------------------------ entities ------------------------------ */

  function drawSprite(ctx, sp, x, y, scale = 1, rot = 0, alpha = 1) {
    const w = sp.w * scale, h = sp.h * scale;
    if (alpha !== 1) ctx.globalAlpha = alpha;
    if (rot) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.drawImage(sp.canvas, -w / 2, -h / 2, w, h);
      ctx.restore();
    } else {
      ctx.drawImage(sp.canvas, x - w / 2, y - h / 2, w, h);
    }
    if (alpha !== 1) ctx.globalAlpha = 1;
  }

  function drawShip(ctx, s, t) {
    const sh = s.ship;
    if (s.phase === "over") return;
    const blink = s.inv > 0 && Math.floor(t * 14) % 2 === 0;
    const alpha = blink ? 0.35 : 1;

    // engine flame: two flickering additive cones under the hull
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const fl = 12 + Math.sin(t * 31) * 4;
    const grad = ctx.createLinearGradient(0, sh.y + 20, 0, sh.y + 24 + fl * 1.6);
    grad.addColorStop(0, "rgba(158,242,255,.85)");
    grad.addColorStop(0.5, "rgba(58,167,255,.5)");
    grad.addColorStop(1, "rgba(58,167,255,0)");
    ctx.fillStyle = grad;
    ctx.globalAlpha = alpha;
    for (const dx of [-6, 6]) {
      ctx.beginPath();
      ctx.moveTo(sh.x + dx - 3.4, sh.y + 19);
      ctx.lineTo(sh.x + dx + 3.4, sh.y + 19);
      ctx.lineTo(sh.x + dx, sh.y + 22 + fl);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    drawSprite(ctx, spr.ship, sh.x, sh.y, 1, sh.tilt * 0.22, alpha);

    if (s.shield) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = "rgba(90,170,255,.8)";
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.55 + Math.sin(t * 6) * 0.2;
      ctx.beginPath();
      ctx.arc(sh.x, sh.y - 2, SHIP_R + 15, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha *= 0.35;
      ctx.fillStyle = "#4d9fff";
      ctx.fill();
      ctx.restore();
    }

    if (s.power.beam > 0) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const bw = 20 + Math.sin(t * 26) * 5;
      const bg = ctx.createLinearGradient(sh.x - bw, 0, sh.x + bw, 0);
      bg.addColorStop(0, "rgba(82,233,255,0)");
      bg.addColorStop(0.5, "rgba(190,250,255,.9)");
      bg.addColorStop(1, "rgba(82,233,255,0)");
      ctx.fillStyle = bg;
      ctx.fillRect(sh.x - bw, -10, bw * 2, sh.y - 18);
      ctx.fillStyle = "rgba(255,255,255,.9)";
      ctx.fillRect(sh.x - 3, -10, 6, sh.y - 18);
      ctx.restore();
    }
  }

  function drawHpBar(ctx, x, y, w, frac, colour) {
    ctx.fillStyle = "rgba(8,10,20,.72)";
    ctx.fillRect(x, y, w, 4.4);
    ctx.fillStyle = colour;
    ctx.fillRect(x + 0.7, y + 0.7, Math.max(0, (w - 1.4) * frac), 3);
  }

  function drawEnemies(ctx, s, t) {
    for (const e of s.enemies) {
      const sp = spr[e.type];
      const bob = e.type === "basic" || e.type === "heavy" ? Math.sin(t * 3 + e.seed) * 2 : 0;
      drawSprite(ctx, sp, e.x, e.y + bob, 1, e.type === "zigzag" ? Math.sin(e.t * 4) * 0.12 : 0);
      if ((e.type === "heavy" || e.type === "elite" || e.type === "mini") && e.hp < e.maxHp) {
        drawHpBar(ctx, e.x - e.r, e.y - e.r - 10, e.r * 2, e.hp / e.maxHp,
          e.type === "mini" ? "#ff416c" : "#b06bff");
      }
    }
  }

  function drawBoss(ctx, s, t) {
    const b = s.boss;
    if (!b) return;
    const weak = b.state === "idle";
    // weak windows read as the core flaring open
    if (weak) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.35 + Math.sin(t * 9) * 0.2;
      ctx.fillStyle = "#7ef2ff";
      ctx.beginPath();
      ctx.arc(b.x, b.y + 8, 26, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    drawSprite(ctx, spr.boss, b.x, b.y, 1, Math.sin(t * 0.9) * 0.03);

    const pat = b.state === "attack" ? ["spread", "barrage", "beam", "wave"][b.pattern] : null;
    if (pat === "beam") {
      ctx.save();
      if (!b.beamOn) {
        // telegraph: a thin warning line where the beam will strike
        ctx.globalAlpha = 0.4 + Math.sin(t * 22) * 0.25;
        ctx.fillStyle = "#ff416c";
        ctx.fillRect(b.beamX - 2.4, b.y + 30, 4.8, s.H);
      } else {
        ctx.globalCompositeOperation = "lighter";
        const bw = 30 + Math.sin(t * 30) * 6;
        const bg = ctx.createLinearGradient(b.beamX - bw, 0, b.beamX + bw, 0);
        bg.addColorStop(0, "rgba(255,65,108,0)");
        bg.addColorStop(0.5, "rgba(255,180,200,.95)");
        bg.addColorStop(1, "rgba(255,65,108,0)");
        ctx.fillStyle = bg;
        ctx.fillRect(b.beamX - bw, b.y + 24, bw * 2, s.H);
        ctx.fillStyle = "rgba(255,255,255,.95)";
        ctx.fillRect(b.beamX - 4, b.y + 24, 8, s.H);
      }
      ctx.restore();
    }
  }

  function drawParticles(ctx, dt) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = fx.particles.length - 1; i >= 0; i -= 1) {
      const p = fx.particles[i];
      p.life += dt;
      if (p.life >= p.max) { fx.particles.splice(i, 1); continue; }
      const k = p.life / p.max;
      if (p.type === "spark") {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 1 - dt * 2.2;
        p.vy *= 1 - dt * 2.2;
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = p.colour;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      } else if (p.type === "flash") {
        const r = p.size * (0.5 + k * 0.8);
        const g = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, r);
        g.addColorStop(0, "rgba(255,255,255,.9)");
        g.addColorStop(0.4, p.colour + "");
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.globalAlpha = (1 - k) * 0.85;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, TAU);
        ctx.fill();
      } else { // ring
        ctx.globalAlpha = (1 - k) * 0.8;
        ctx.strokeStyle = p.colour;
        ctx.lineWidth = 2.4 * (1 - k) + 0.6;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.15 + k), 0, TAU);
        ctx.stroke();
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /* -------------------------------- HUD -------------------------------- */

  function drawHud(ctx, s, best, t, dt) {
    const W = s.W;
    ctx.textBaseline = "alphabetic";

    // score / best
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(246,242,233,.55)";
    ctx.font = "700 11px 'DM Sans', Arial, sans-serif";
    ctx.fillText("SCORE", 14, 26);
    ctx.fillStyle = "#f6f2e9";
    ctx.font = "700 24px 'DM Sans', Arial, sans-serif";
    ctx.fillText(`${Math.round(s.score).toLocaleString()}`, 14, 50);
    ctx.fillStyle = "rgba(246,242,233,.55)";
    ctx.font = "600 11px 'DM Sans', Arial, sans-serif";
    ctx.fillText(`BEST: ${Math.max(best, Math.round(s.score)).toLocaleString()}`, 14, 68);

    // wave, top centre (small, persistent)
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(246,242,233,.5)";
    ctx.font = "700 11px 'DM Sans', Arial, sans-serif";
    if (!s.boss) ctx.fillText(`WAVE ${s.wave}`, W / 2, 26);

    // hearts + crystals, top right
    for (let i = 0; i < MAX_HEARTS; i += 1) {
      const sp = i < s.hearts ? spr.heart : spr.heartOff;
      drawSprite(ctx, sp, W - 22 - i * 26, 24, 1);
    }
    drawSprite(ctx, spr.crystal, W - 24, 52, 0.8);
    ctx.textAlign = "right";
    ctx.fillStyle = "#5cffd9";
    ctx.font = "700 15px 'DM Sans', Arial, sans-serif";
    ctx.fillText(`${s.crystalRun}`, W - 38, 57);

    // weapon level pips, bottom left
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(246,242,233,.5)";
    ctx.font = "700 10px 'DM Sans', Arial, sans-serif";
    ctx.fillText(`WEAPON LV ${s.weapon}`, 14, s.H - 40);
    for (let i = 0; i < MAX_WEAPON; i += 1) {
      ctx.fillStyle = i < s.weapon ? "#52e9ff" : "rgba(255,255,255,.16)";
      ctx.fillRect(14 + i * 14, s.H - 34, 10, 4);
    }

    // active power-up pills, bottom left above weapon
    let py = s.H - 58;
    for (const k of Object.keys(POWER_TIME)) {
      if (s.power[k] <= 0) continue;
      const frac = s.power[k] / POWER_TIME[k];
      const [colour] = POWER_STYLE[k];
      drawSprite(ctx, spr.drops[k], 24, py, 0.62);
      ctx.fillStyle = "rgba(8,10,20,.72)";
      ctx.fillRect(38, py - 2.4, 44, 4.8);
      ctx.fillStyle = colour;
      ctx.fillRect(38.7, py - 1.7, 42.6 * frac, 3.4);
      py -= 24;
    }
    if (s.shield) drawSprite(ctx, spr.drops.shield, 24, py, 0.62);

    // combo counter under the score while a chain is alive
    if (s.combo >= 2) {
      ctx.textAlign = "left";
      ctx.fillStyle = "#ffd34d";
      ctx.font = "700 14px 'DM Sans', Arial, sans-serif";
      ctx.fillText(`COMBO x${s.combo}`, 14, 88);
      ctx.fillStyle = "rgba(255,211,77,.35)";
      ctx.fillRect(14, 93, 60 * (s.comboTimer / 3.5), 3);
    }

    // boss bar
    if (s.boss && s.boss.state !== "enter") {
      const b = s.boss;
      const bw = Math.min(W - 120, 380);
      ctx.textAlign = "center";
      ctx.fillStyle = "#ff8fb3";
      ctx.font = "700 11px 'DM Sans', Arial, sans-serif";
      ctx.fillText(s.wave >= 10 ? "DREADNOUGHT" : "NEON DREADNOUGHT", W / 2, 22);
      ctx.fillStyle = "rgba(8,10,20,.78)";
      ctx.fillRect(W / 2 - bw / 2, 28, bw, 9);
      const g = ctx.createLinearGradient(W / 2 - bw / 2, 0, W / 2 + bw / 2, 0);
      g.addColorStop(0, "#ff416c");
      g.addColorStop(1, "#b06bff");
      ctx.fillStyle = g;
      ctx.fillRect(W / 2 - bw / 2 + 1.2, 29.2, (bw - 2.4) * Math.max(0, b.hp / b.maxHp), 6.6);
    }

    // toasts float up from above the ship
    for (let i = fx.toasts.length - 1; i >= 0; i -= 1) {
      const toast = fx.toasts[i];
      toast.t += dt;
      if (toast.t > 1.4) { fx.toasts.splice(i, 1); continue; }
      const k = toast.t / 1.4;
      ctx.globalAlpha = k < 0.12 ? k / 0.12 : 1 - Math.max(0, (k - 0.6) / 0.4);
      ctx.textAlign = "center";
      ctx.fillStyle = toast.colour;
      ctx.font = "700 16px 'DM Sans', Arial, sans-serif";
      ctx.fillText(toast.text, s.ship.x, s.ship.y - 52 - k * 34 - i * 20);
      ctx.globalAlpha = 1;
    }

    // combo pop, mid-screen
    if (fx.combo) {
      fx.combo.t += dt;
      if (fx.combo.t > 0.9) fx.combo = null;
      else {
        const k = fx.combo.t / 0.9;
        const pop = k < 0.18 ? 0.6 + (k / 0.18) * 0.55 : 1.15 - (k - 0.18) * 0.12;
        ctx.save();
        ctx.translate(W / 2, s.H * 0.36);
        ctx.scale(pop, pop);
        ctx.globalAlpha = 1 - Math.max(0, (k - 0.55) / 0.45);
        ctx.textAlign = "center";
        ctx.fillStyle = "#ffd34d";
        ctx.font = "800 26px 'DM Sans', Arial, sans-serif";
        ctx.shadowColor = "#ffd34d";
        ctx.shadowBlur = 14;
        ctx.fillText(fx.combo.text, 0, 0);
        ctx.restore();
        ctx.globalAlpha = 1;
      }
    }

    // big announcements (wave / boss warning / boss destroyed)
    if (fx.announce) {
      const a = fx.announce;
      a.t += dt;
      if (a.t > a.dur) fx.announce = null;
      else {
        const k = a.t / a.dur;
        let alpha = k < 0.15 ? k / 0.15 : k > 0.75 ? (1 - k) / 0.25 : 1;
        if (a.pulse) alpha *= 0.65 + 0.35 * Math.sin(a.t * 14);
        ctx.save();
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.textAlign = "center";
        ctx.fillStyle = a.colour;
        ctx.shadowColor = a.colour;
        ctx.shadowBlur = 18;
        ctx.font = "800 34px 'DM Sans', Arial, sans-serif";
        ctx.fillText(a.lines[0], W / 2, s.H * 0.3);
        if (a.lines[1]) {
          ctx.font = "700 18px 'DM Sans', Arial, sans-serif";
          ctx.fillText(a.lines[1], W / 2, s.H * 0.3 + 30);
        }
        ctx.restore();
        ctx.globalAlpha = 1;
      }
    }

    // damage vignette
    if (fx.flash > 0) {
      fx.flash = Math.max(0, fx.flash - dt * 1.6);
      const g = ctx.createRadialGradient(W / 2, s.H / 2, s.H * 0.3, W / 2, s.H / 2, s.H * 0.75);
      g.addColorStop(0, "rgba(255,40,70,0)");
      g.addColorStop(1, `rgba(255,40,70,${0.5 * fx.flash})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, s.H);
    }
  }

  /* -------------------------------- frame -------------------------------- */

  function draw(ctx, s, vw, vh, dt, { best = 0, showHud = true } = {}) {
    fx.starT += dt;
    const t = fx.starT;
    drawBackground(ctx, s, vw, vh, t);

    const scale = vh / VIEW_H;
    const offX = (vw - s.W * scale) / 2;
    ctx.save();
    ctx.translate(offX, 0);
    ctx.scale(scale, scale);

    // playfield edge glow when the screen is wider than the field
    if (offX > 2) {
      ctx.strokeStyle = "rgba(122,226,255,.14)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(0.7, 0); ctx.lineTo(0.7, s.H);
      ctx.moveTo(s.W - 0.7, 0); ctx.lineTo(s.W - 0.7, s.H);
      ctx.stroke();
    }

    // impact shake — everything in the field moves, kept small enough
    // that the HUD stays readable
    if (s.shake > 0.2) {
      ctx.translate(
        Math.sin(t * 71) * s.shake * 0.55,
        Math.cos(t * 63) * s.shake * 0.4,
      );
    }

    for (const c of s.crystals) drawSprite(ctx, spr.crystal, c.x, c.y, 0.9, Math.sin(c.t * 3) * 0.35);
    for (const d of s.drops) drawSprite(ctx, spr.drops[d.kind], d.x, d.y, 1, Math.sin(d.t * 2.4) * 0.16);
    drawEnemies(ctx, s, t);
    drawBoss(ctx, s, t);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of s.shots) drawSprite(ctx, p.heavy ? spr.heavyShot : spr.shot, p.x, p.y, 1, Math.atan2(p.vx, -p.vy));
    for (const p of s.enemyShots) drawSprite(ctx, spr.bolt, p.x, p.y, 1);
    ctx.restore();
    for (const m of s.missiles) drawSprite(ctx, spr.missile, m.x, m.y, 1, Math.atan2(m.vx, -m.vy));

    drawShip(ctx, s, t);
    drawParticles(ctx, dt);

    if (showHud) drawHud(ctx, s, best, t, dt);
    ctx.restore();
  }

  return { draw, onEvent, reset, sprites: spr };
}
