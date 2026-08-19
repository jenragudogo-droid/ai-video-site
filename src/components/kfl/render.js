/* ------------------------------------------------------------------ *
 * Kianimation Football League — 2.5D canvas renderer.
 *
 * The pitch is drawn in a tilted top-down projection: the y axis is
 * compressed, players are drawn as standing figures with shadows and
 * the ball lifts off the ground with its height. Everything is vector
 * work generated at runtime, so the game downloads no image assets.
 * ------------------------------------------------------------------ */

import { PITCH } from "./engine.js";

const TILT = 0.6;          // how far the pitch is laid back
const VERT = 0.88;         // vertical squash applied to standing figures
const GOAL_Y0 = PITCH.W / 2 - PITCH.GOAL_W / 2;
const GOAL_Y1 = PITCH.W / 2 + PITCH.GOAL_W / 2;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/* ------------------------------ crowd tile ----------------------------- */

function makeCrowdTile(seed) {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#0b0d16";
  g.fillRect(0, 0, 128, 128);

  let s = seed;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const shirts = ["#7b3cff", "#f4b965", "#e9e6f5", "#2b2f45", "#4a2f8f", "#c9c4d8", "#1b1f30", "#ff8a3d"];
  for (let row = 0; row < 16; row += 1) {
    for (let col = 0; col < 16; col += 1) {
      const x = col * 8 + (row % 2) * 4 + rand() * 1.5;
      const y = row * 8 + rand() * 1.5;
      const shade = 0.45 + (row / 16) * 0.55;
      g.globalAlpha = shade;
      g.fillStyle = shirts[Math.floor(rand() * shirts.length)];
      g.beginPath();
      g.arc(x, y, 2.1 + rand() * 0.7, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.globalAlpha = 1;
  return c;
}

/* ------------------------------ hair shapes ---------------------------- */

function drawHair(g, style, colour, r) {
  g.fillStyle = colour;
  switch (style) {
    case "bald":
      break;
    case "buzz":
      g.beginPath();
      g.arc(0, -0.15 * r, r * 0.98, Math.PI, 0);
      g.fill();
      break;
    case "afro":
      g.beginPath();
      g.arc(0, -0.62 * r, r * 1.28, 0, Math.PI * 2);
      g.fill();
      break;
    case "curls":
      for (let i = -2; i <= 2; i += 1) {
        g.beginPath();
        g.arc(i * r * 0.5, -0.5 * r - Math.abs(i) * 0.1 * r, r * 0.55, 0, Math.PI * 2);
        g.fill();
      }
      break;
    case "mohawk":
      g.beginPath();
      g.ellipse(0, -r * 0.95, r * 0.32, r * 0.85, 0, 0, Math.PI * 2);
      g.fill();
      break;
    case "long":
      g.beginPath();
      g.ellipse(-r * 0.95, -r * 0.1, r * 0.42, r * 1.05, 0, 0, Math.PI * 2);
      g.ellipse(r * 0.95, -r * 0.1, r * 0.42, r * 1.05, 0, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.arc(0, -0.25 * r, r * 1.12, Math.PI, 0);
      g.fill();
      break;
    case "bun":
      g.beginPath();
      g.arc(0, -0.2 * r, r * 1.05, Math.PI, 0);
      g.fill();
      g.beginPath();
      g.arc(0, -r * 1.15, r * 0.45, 0, Math.PI * 2);
      g.fill();
      break;
    case "braids":
      g.beginPath();
      g.arc(0, -0.2 * r, r * 1.05, Math.PI, 0);
      g.fill();
      for (let i = -1; i <= 1; i += 1) {
        g.fillRect(i * r * 0.6 - r * 0.12, -r * 0.2, r * 0.24, r * 1.5);
      }
      break;
    case "fade":
      g.beginPath();
      g.arc(0, -0.35 * r, r * 1.05, Math.PI * 0.98, Math.PI * 2.02);
      g.fill();
      break;
    default:
      g.beginPath();
      g.arc(0, -0.25 * r, r * 1.1, Math.PI, 0);
      g.fill();
  }
}

/* ------------------------------- renderer ------------------------------ */

export function createRenderer(canvas) {
  const ctx = canvas.getContext("2d", { alpha: false });
  const crowdTile = makeCrowdTile(9731);
  let crowdPattern = null;
  let w = 0;
  let h = 0;
  let dpr = 1;
  const cam = { x: PITCH.L / 2, y: PITCH.W / 2, scale: 12, target: 12, play: 12, wide: 8 };

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, rect.width < 700 ? 2 : 1.75);
    w = Math.max(320, Math.round(rect.width));
    h = Math.max(200, Math.round(rect.height));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    crowdPattern = ctx.createPattern(crowdTile, "repeat");
    /* how much pitch is in frame during play */
    const metres = w < 620 ? 44 : w < 1000 ? 56 : 68;
    cam.play = w / metres;
    /* the whole ground, used for kickoffs and celebrations */
    cam.wide = Math.min(w / (PITCH.L + 26), h / ((PITCH.W + 34) * TILT));
    cam.target = cam.play;
  }

  const sx = (x) => (x - cam.x) * cam.scale + w / 2;
  const sy = (y, z = 0) => (y - cam.y) * cam.scale * TILT + h * 0.56 - z * cam.scale * VERT;

  const WIDE_PHASES = ["kickoff", "goal", "halftime", "fulltime", "etBreak"];

  function follow(world, dt) {
    const b = world.ball;
    const stadium = WIDE_PHASES.includes(world.phase);
    cam.target = stadium ? cam.wide : cam.play;

    const margin = stadium ? 0 : 18;
    const lead = 0.35;
    const tx = stadium
      ? PITCH.L / 2
      : clamp(b.x + b.vx * lead, margin, PITCH.L - margin);
    const ty = stadium
      ? PITCH.W / 2
      : clamp(b.y + b.vy * lead, 16, PITCH.W - 16);

    const k = 1 - Math.pow(0.0015, dt);
    cam.x += (tx - cam.x) * k;
    cam.y += (ty - cam.y) * k;
    cam.scale += (cam.target - cam.scale) * Math.min(1, dt * (stadium ? 1.6 : 3));
  }

  /* -------------------------------- stadium ------------------------------ */

  function drawStands() {
    const outer = 40;
    ctx.save();
    /* the bowl: four blocks of crowd around the pitch */
    const blocks = [
      { x0: -outer, y0: -outer, x1: PITCH.L + outer, y1: -6 },
      { x0: -outer, y0: PITCH.W + 6, x1: PITCH.L + outer, y1: PITCH.W + outer },
      { x0: -outer, y0: -6, x1: -8, y1: PITCH.W + 6 },
      { x0: PITCH.L + 8, y0: -6, x1: PITCH.L + outer, y1: PITCH.W + 6 },
    ];
    blocks.forEach((b) => {
      const x = sx(b.x0);
      const y = sy(b.y0);
      const bw = sx(b.x1) - x;
      const bh = sy(b.y1) - y;
      ctx.fillStyle = "#0a0c14";
      ctx.fillRect(x, y, bw, bh);
      if (crowdPattern) {
        ctx.save();
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = crowdPattern;
        ctx.translate(x, y);
        ctx.fillRect(0, 0, bw, bh);
        ctx.restore();
      }
      const grad = ctx.createLinearGradient(x, y, x, y + bh);
      grad.addColorStop(0, "rgba(4,5,10,0.75)");
      grad.addColorStop(0.5, "rgba(4,5,10,0.1)");
      grad.addColorStop(1, "rgba(4,5,10,0.75)");
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, bw, bh);
    });

    /* advertising boards ring the pitch */
    ctx.fillStyle = "#15121f";
    ctx.fillRect(sx(-8), sy(-6.2), sx(PITCH.L + 8) - sx(-8), Math.max(3, cam.scale * 1.5 * TILT));
    ctx.fillRect(sx(-8), sy(PITCH.W + 4.8), sx(PITCH.L + 8) - sx(-8), Math.max(3, cam.scale * 1.5 * TILT));
    ctx.fillStyle = "rgba(123,60,255,0.5)";
    ctx.fillRect(sx(-8), sy(-6.2), sx(PITCH.L + 8) - sx(-8), Math.max(1, cam.scale * 0.25 * TILT));
    ctx.restore();
  }

  function drawFloodlights() {
    const corners = [
      [-24, -22], [PITCH.L + 24, -22],
      [-24, PITCH.W + 22], [PITCH.L + 24, PITCH.W + 22],
    ];
    corners.forEach(([x, y]) => {
      const px = sx(x);
      const py = sy(y);
      const r = cam.scale * 26;
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, "rgba(214,226,255,0.16)");
      g.addColorStop(1, "rgba(214,226,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();

      /* pylon */
      ctx.fillStyle = "#1a1d2b";
      ctx.fillRect(px - cam.scale * 0.3, py - cam.scale * 9, cam.scale * 0.6, cam.scale * 9);
      ctx.fillStyle = "#e8eeff";
      for (let i = 0; i < 3; i += 1) {
        for (let j = 0; j < 2; j += 1) {
          ctx.fillRect(px - cam.scale * 1.5 + i * cam.scale * 1.1, py - cam.scale * 10.4 + j * cam.scale * 0.8,
            cam.scale * 0.85, cam.scale * 0.6);
        }
      }
    });
  }

  function drawScoreboard(world) {
    const x = sx(PITCH.L / 2);
    const bw = cam.scale * 26;
    const bh = cam.scale * 7;
    /* keep the board on screen when the camera is tight or the frame is tall */
    const y = Math.max(sy(-26), bh + 6);
    if (y > h * 0.6) return;
    ctx.fillStyle = "#07080e";
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 1;
    ctx.fillRect(x - bw / 2, y - bh, bw, bh);
    ctx.strokeRect(x - bw / 2, y - bh, bw, bh);
    const size = Math.max(9, cam.scale * 1.9);
    ctx.font = `700 ${size}px "DM Sans", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#f4b965";
    const [a, b] = world.score;
    ctx.fillText(
      `${world.teams[0].club.abbr}  ${a} - ${b}  ${world.teams[1].club.abbr}`,
      x, y - bh * 0.58,
    );
    ctx.fillStyle = "rgba(240,240,255,0.65)";
    ctx.font = `600 ${size * 0.72}px "DM Sans", system-ui, sans-serif`;
    ctx.fillText(`${Math.floor(world.displayMinute)}'`, x, y - bh * 0.22);
  }

  /* --------------------------------- pitch -------------------------------- */

  function line(x0, y0, x1, y1) {
    ctx.beginPath();
    ctx.moveTo(sx(x0), sy(y0));
    ctx.lineTo(sx(x1), sy(y1));
    ctx.stroke();
  }

  function ellipse(cx, cy, rx, ry) {
    ctx.beginPath();
    ctx.ellipse(sx(cx), sy(cy), rx * cam.scale, ry * cam.scale * TILT, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawPitch() {
    /* turf with mowing stripes */
    const stripes = 14;
    const stripeW = PITCH.L / stripes;
    for (let i = 0; i < stripes; i += 1) {
      ctx.fillStyle = i % 2 ? "#1f7a3d" : "#1b6d36";
      ctx.fillRect(sx(i * stripeW), sy(0), stripeW * cam.scale + 1, (PITCH.W) * cam.scale * TILT);
    }
    /* surround */
    ctx.fillStyle = "#14532a";
    ctx.fillRect(sx(-6), sy(-6), (PITCH.L + 12) * cam.scale, 6 * cam.scale * TILT);
    ctx.fillRect(sx(-6), sy(PITCH.W), (PITCH.L + 12) * cam.scale, 6 * cam.scale * TILT);
    ctx.fillRect(sx(-6), sy(-6), 6 * cam.scale, (PITCH.W + 12) * cam.scale * TILT);
    ctx.fillRect(sx(PITCH.L), sy(-6), 6 * cam.scale, (PITCH.W + 12) * cam.scale * TILT);

    ctx.strokeStyle = "rgba(255,255,255,0.78)";
    ctx.lineWidth = Math.max(1, cam.scale * 0.12);

    /* touchlines and halfway */
    ctx.strokeRect(sx(0), sy(0), PITCH.L * cam.scale, PITCH.W * cam.scale * TILT);
    line(PITCH.L / 2, 0, PITCH.L / 2, PITCH.W);
    ellipse(PITCH.L / 2, PITCH.W / 2, PITCH.CIRCLE, PITCH.CIRCLE);
    dot(PITCH.L / 2, PITCH.W / 2);

    [0, 1].forEach((side) => {
      const gx = side === 0 ? 0 : PITCH.L;
      const dir = side === 0 ? 1 : -1;
      /* penalty area */
      const bx = gx + dir * PITCH.BOX_D;
      line(gx, PITCH.W / 2 - PITCH.BOX_W / 2, bx, PITCH.W / 2 - PITCH.BOX_W / 2);
      line(gx, PITCH.W / 2 + PITCH.BOX_W / 2, bx, PITCH.W / 2 + PITCH.BOX_W / 2);
      line(bx, PITCH.W / 2 - PITCH.BOX_W / 2, bx, PITCH.W / 2 + PITCH.BOX_W / 2);
      /* six yard box */
      const sxx = gx + dir * PITCH.SIX_D;
      line(gx, PITCH.W / 2 - PITCH.SIX_W / 2, sxx, PITCH.W / 2 - PITCH.SIX_W / 2);
      line(gx, PITCH.W / 2 + PITCH.SIX_W / 2, sxx, PITCH.W / 2 + PITCH.SIX_W / 2);
      line(sxx, PITCH.W / 2 - PITCH.SIX_W / 2, sxx, PITCH.W / 2 + PITCH.SIX_W / 2);
      /* penalty spot and D */
      dot(gx + dir * PITCH.SPOT, PITCH.W / 2);
      ctx.beginPath();
      const spotX = sx(gx + dir * PITCH.SPOT);
      ctx.ellipse(spotX, sy(PITCH.W / 2), PITCH.CIRCLE * cam.scale, PITCH.CIRCLE * cam.scale * TILT,
        0, dir === 1 ? -0.9 : Math.PI - 0.9, dir === 1 ? 0.9 : Math.PI + 0.9);
      ctx.stroke();
      /* corner arcs */
      [0, PITCH.W].forEach((cy) => {
        ctx.beginPath();
        ctx.ellipse(sx(gx), sy(cy), 1 * cam.scale, 1 * cam.scale * TILT, 0, 0, Math.PI * 2);
        ctx.stroke();
      });
    });
  }

  function dot(x, y) {
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.ellipse(sx(x), sy(y), cam.scale * 0.16, cam.scale * 0.16 * TILT, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawGoal(side, behind) {
    const gx = side === 0 ? 0 : PITCH.L;
    const dir = side === 0 ? -1 : 1;
    const depth = 2;
    const postW = Math.max(1.5, cam.scale * 0.16);
    const topY0 = sy(GOAL_Y0, PITCH.GOAL_H);
    const topY1 = sy(GOAL_Y1, PITCH.GOAL_H);
    const baseY0 = sy(GOAL_Y0);
    const baseY1 = sy(GOAL_Y1);
    const x = sx(gx);
    const xBack = sx(gx + dir * depth);

    if (behind) {
      /* net */
      ctx.strokeStyle = "rgba(235,240,255,0.28)";
      ctx.lineWidth = 1;
      const cols = 10;
      for (let i = 0; i <= cols; i += 1) {
        const t = i / cols;
        const yy = GOAL_Y0 + (GOAL_Y1 - GOAL_Y0) * t;
        ctx.beginPath();
        ctx.moveTo(sx(gx), sy(yy, PITCH.GOAL_H));
        ctx.lineTo(sx(gx + dir * depth), sy(yy + dir * 0.2, PITCH.GOAL_H * 0.72));
        ctx.lineTo(sx(gx + dir * depth), sy(yy + dir * 0.2));
        ctx.stroke();
      }
      for (let i = 0; i <= 5; i += 1) {
        const z = (PITCH.GOAL_H / 5) * i;
        ctx.beginPath();
        ctx.moveTo(sx(gx), sy(GOAL_Y0, z));
        ctx.lineTo(sx(gx + dir * depth), sy(GOAL_Y0 + dir * 0.2, z * 0.8));
        ctx.lineTo(sx(gx + dir * depth), sy(GOAL_Y1 + dir * 0.2, z * 0.8));
        ctx.lineTo(sx(gx), sy(GOAL_Y1, z));
        ctx.stroke();
      }
      return;
    }

    /* frame */
    ctx.fillStyle = "#f2f5ff";
    ctx.fillRect(x - postW / 2, topY0, postW, baseY0 - topY0);
    ctx.fillRect(x - postW / 2, topY1, postW, baseY1 - topY1);
    ctx.fillRect(x - postW / 2, Math.min(topY0, topY1) - postW / 2, 1, 1);
    ctx.beginPath();
    ctx.lineWidth = postW;
    ctx.strokeStyle = "#f2f5ff";
    ctx.moveTo(x, topY0);
    ctx.lineTo(x, topY1);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = Math.max(1, postW * 0.5);
    ctx.beginPath();
    ctx.moveTo(x, topY0);
    ctx.lineTo(xBack, sy(GOAL_Y0 + dir * 0.2, PITCH.GOAL_H * 0.72));
    ctx.moveTo(x, topY1);
    ctx.lineTo(xBack, sy(GOAL_Y1 + dir * 0.2, PITCH.GOAL_H * 0.72));
    ctx.stroke();
  }

  /* -------------------------------- players ------------------------------- */

  function drawPlayer(world, p, isControlled) {
    const team = world.teams[p.team];
    const kit = p.role === "GK" ? team.club.gkKit : team.club.kit;
    const look = p.data.look;
    const px = sx(p.x);
    const py = sy(p.y);
    const depth = 1 + (p.y - cam.y) * 0.0022;
    const s = cam.scale * depth;
    const tall = (look.height / 180) * s * VERT * 1.9;
    const wide = s * (0.3 + look.build * 0.13);

    /* shadow */
    ctx.fillStyle = "rgba(0,0,0,0.34)";
    ctx.beginPath();
    ctx.ellipse(px, py, wide * 1.15, wide * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    const speed = Math.hypot(p.vx, p.vy);
    const facing = p.vx >= 0 ? 1 : -1;
    const swing = Math.sin(p.anim * 2.6) * Math.min(1, speed / 5);
    const sliding = p.slideT > 0;
    const diving = p.role === "GK" && p.diveT > 0;

    ctx.save();
    ctx.translate(px, py);
    if (sliding) ctx.rotate(facing * 0.75);
    if (diving) ctx.rotate((p.diveDir || 1) * 0.95);

    const hipY = -tall * 0.46;
    const kneeSpread = swing * s * 0.4;
    /* upper legs (shorts) */
    ctx.lineCap = "round";
    ctx.strokeStyle = kit.shorts;
    ctx.lineWidth = Math.max(1.2, wide * 0.4);
    for (const dirLeg of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(dirLeg * wide * 0.28, hipY);
      ctx.lineTo(dirLeg * wide * 0.3 + kneeSpread * dirLeg * 0.5, hipY * 0.45);
      ctx.stroke();
    }
    /* lower legs (socks) */
    ctx.strokeStyle = kit.socks;
    ctx.lineWidth = Math.max(1, wide * 0.32);
    for (const dirLeg of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(dirLeg * wide * 0.3 + kneeSpread * dirLeg * 0.5, hipY * 0.45);
      ctx.lineTo(dirLeg * wide * 0.3 + kneeSpread * dirLeg, -tall * 0.04);
      ctx.stroke();
    }
    /* boots */
    ctx.fillStyle = look.boots;
    for (const dirLeg of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(dirLeg * wide * 0.3 + kneeSpread * dirLeg + facing * wide * 0.08, -tall * 0.02,
        wide * 0.32, wide * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    /* torso */
    const torsoTop = -tall * 0.92;
    const torsoBottom = hipY;
    const grad = ctx.createLinearGradient(0, torsoTop, 0, torsoBottom);
    grad.addColorStop(0, kit.shirt);
    grad.addColorStop(1, kit.shirtAlt);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-wide * 0.86, torsoBottom);
    ctx.lineTo(-wide, torsoTop + tall * 0.08);
    ctx.quadraticCurveTo(0, torsoTop - tall * 0.02, wide, torsoTop + tall * 0.08);
    ctx.lineTo(wide * 0.86, torsoBottom);
    ctx.closePath();
    ctx.fill();

    /* arms hang down beside the body and swing with the run */
    const armSwing = swing * s * 0.26;
    ctx.lineWidth = Math.max(1, wide * 0.28);
    ctx.strokeStyle = look.sleeves === "long" ? kit.shirt : look.skin;
    ctx.beginPath();
    ctx.moveTo(-wide * 0.9, torsoTop + tall * 0.12);
    ctx.lineTo(-wide * 1.16 - armSwing * 0.4, torsoBottom + tall * 0.02);
    ctx.moveTo(wide * 0.9, torsoTop + tall * 0.12);
    ctx.lineTo(wide * 1.16 + armSwing * 0.4, torsoBottom + tall * 0.02);
    ctx.stroke();
    if (look.sleeves === "long") {
      ctx.strokeStyle = look.skin;
      ctx.lineWidth = Math.max(1, wide * 0.24);
      ctx.beginPath();
      ctx.moveTo(-wide * 1.08 - armSwing * 0.3, torsoBottom - tall * 0.06);
      ctx.lineTo(-wide * 1.16 - armSwing * 0.4, torsoBottom + tall * 0.02);
      ctx.moveTo(wide * 1.08 + armSwing * 0.3, torsoBottom - tall * 0.06);
      ctx.lineTo(wide * 1.16 + armSwing * 0.4, torsoBottom + tall * 0.02);
      ctx.stroke();
    }

    /* shirt number, only when it can actually be read */
    if (s > 13) {
      ctx.fillStyle = kit.number;
      ctx.font = `700 ${Math.round(s * 0.42)}px "DM Sans", system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(p.data.number), 0, (torsoTop + torsoBottom) / 2);
    }

    /* head */
    const headR = wide * 0.52;
    const headY = torsoTop - headR * 0.9;
    ctx.fillStyle = look.skin;
    ctx.beginPath();
    ctx.arc(0, headY, headR, 0, Math.PI * 2);
    ctx.fill();
    if (look.beard) {
      ctx.fillStyle = look.hairColour;
      ctx.beginPath();
      ctx.arc(0, headY + headR * 0.3, headR * 0.74, 0.15, Math.PI - 0.15);
      ctx.fill();
    }
    ctx.save();
    ctx.translate(0, headY);
    drawHair(ctx, look.hair, look.hairColour, headR);
    ctx.restore();

    ctx.restore();

    /* selection ring for the player you are controlling */
    if (isControlled) {
      ctx.strokeStyle = "#f4b965";
      ctx.lineWidth = Math.max(1.5, s * 0.11);
      ctx.beginPath();
      ctx.ellipse(px, py, wide * 1.5, wide * 0.72, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#f4b965";
      ctx.beginPath();
      ctx.moveTo(px, py - tall * 1.55);
      ctx.lineTo(px - s * 0.3, py - tall * 1.85);
      ctx.lineTo(px + s * 0.3, py - tall * 1.85);
      ctx.closePath();
      ctx.fill();
    }
    if (p.stamina < 34 && p.on) {
      ctx.fillStyle = p.stamina < 20 ? "#ff4d5e" : "#ffb648";
      ctx.beginPath();
      ctx.arc(px + wide * 1.5, py - tall * 1.1, Math.max(1.4, s * 0.11), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawBall(world) {
    const b = world.ball;
    const px = sx(b.x);
    const groundY = sy(b.y);
    const py = sy(b.y, b.z);
    const r = Math.max(2.3, cam.scale * 0.22 * (1 + b.z * 0.05));

    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    ctx.ellipse(px, groundY, r * (1.1 - Math.min(0.5, b.z * 0.06)), r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#fdfdfd";
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#15161c";
    ctx.beginPath();
    ctx.arc(px - r * 0.22, py - r * 0.18, r * 0.34, 0, Math.PI * 2);
    ctx.fill();
  }

  /* --------------------------------- radar -------------------------------- */

  function drawRadar(world) {
    const rw = Math.min(160, w * 0.28);
    const rh = rw * (PITCH.W / PITCH.L);
    const x0 = w - rw - 12;
    const y0 = h - rh - 12;
    ctx.fillStyle = "rgba(6,8,14,0.62)";
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 1;
    ctx.fillRect(x0, y0, rw, rh);
    ctx.strokeRect(x0, y0, rw, rh);
    ctx.beginPath();
    ctx.moveTo(x0 + rw / 2, y0);
    ctx.lineTo(x0 + rw / 2, y0 + rh);
    ctx.stroke();

    world.players.forEach((p) => {
      if (!p.on) return;
      const px = x0 + (p.x / PITCH.L) * rw;
      const py = y0 + (p.y / PITCH.W) * rh;
      ctx.fillStyle = world.teams[p.team].club.kit.shirt;
      ctx.beginPath();
      ctx.arc(px, py, p === world.controlled ? 3 : 2, 0, Math.PI * 2);
      ctx.fill();
      if (p === world.controlled) {
        ctx.strokeStyle = "#f4b965";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(px, py, 4.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
    const b = world.ball;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(x0 + (b.x / PITCH.L) * rw, y0 + (b.y / PITCH.W) * rh, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  /* --------------------------------- draw --------------------------------- */

  function draw(world, dt, opts = {}) {
    follow(world, dt);
    ctx.fillStyle = "#05060b";
    ctx.fillRect(0, 0, w, h);

    drawStands();
    drawFloodlights();
    drawScoreboard(world);
    drawPitch();
    drawGoal(0, true);
    drawGoal(1, true);

    /* painter's algorithm: further up the pitch is drawn first */
    const actors = world.players.filter((p) => p.on).slice().sort((a, b) => a.y - b.y);
    const ballY = world.ball.y;
    let ballDrawn = false;
    actors.forEach((p) => {
      if (!ballDrawn && p.y > ballY) {
        drawBall(world);
        ballDrawn = true;
      }
      drawPlayer(world, p, p === world.controlled && world.teams[p.team].isUser);
    });
    if (!ballDrawn) drawBall(world);

    drawGoal(0, false);
    drawGoal(1, false);

    if (opts.radar !== false) drawRadar(world);
  }

  resize();
  return { draw, resize, cam };
}
