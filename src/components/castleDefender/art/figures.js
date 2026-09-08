/* ------------------------------------------------------------------ *
 * Castle Defender — the figure rig.
 *
 * Every soldier, archer, bandit and knight is the same jointed figure
 * dressed by a spec: body armour, helmet, shield, weapon, cape and
 * colours. A pose is a set of limb angles; animations are functions
 * from (animation, time) to a pose. Figures face +x and are mirrored
 * by the renderer to face left. All drawing is in world units with
 * the origin at the feet.
 *
 * Limb angles: 0 points straight down, positive swings forward (+x).
 * ------------------------------------------------------------------ */

import { PAL, shade, rgba } from "./palette.js";

const OUT = "rgba(28, 20, 12, 0.62)";
const RAD = Math.PI / 180;

/* --------------------------------- specs --------------------------------- */

const SKINS = [[PAL.skin, PAL.skinDark], [PAL.skin2, PAL.skin2Dark]];

export const FIGURES = {
  /* the realm */
  militia:    { body: "tunic", bodyColor: PAL.cloth, trim: PAL.clothDark, helmet: "kettle", helmetColor: PAL.mail, shield: "round", shieldColor: PAL.wood, boss: PAL.iron, weapon: "spear", legs: "#4a4a55", boots: PAL.leatherDark, h: 56 },
  manAtArms:  { body: "mail", bodyColor: PAL.mail, trim: PAL.red, helmet: "nasal", helmetColor: PAL.plateDark, shield: "kite", shieldColor: PAL.red, emblem: "cross", emblemColor: PAL.gold, weapon: "sword", legs: PAL.mailDark, boots: PAL.leatherDark, h: 58 },
  knight:     { body: "plate", bodyColor: PAL.plate, trim: PAL.gold, tabard: PAL.red, helmet: "bascinet", helmetColor: PAL.plate, shield: "heater", shieldColor: PAL.red, emblem: "cross", emblemColor: PAL.gold, weapon: "sword", legs: PAL.plateDark, boots: PAL.iron, h: 60 },
  royalGuard: { body: "plate", bodyColor: PAL.plateLight, trim: PAL.gold, tabard: PAL.gold, helmet: "greatHelm", helmetColor: PAL.plate, plume: PAL.red, shield: "heater", shieldColor: PAL.gold, emblem: "chevron", emblemColor: PAL.red, weapon: "sword", cape: PAL.red, legs: PAL.plateDark, boots: PAL.iron, h: 62 },
  reinforcement: { body: "tunic", bodyColor: PAL.leather, trim: PAL.leatherDark, helmet: "none", shield: "buckler", shieldColor: PAL.wood, boss: PAL.iron, weapon: "spear", legs: "#5a4a3a", boots: PAL.leatherDark, h: 55 },
  hero:       { body: "plate", bodyColor: PAL.plateLight, trim: PAL.gold, tabard: PAL.red, tabardTrim: PAL.gold, helmet: "bascinet", helmetColor: PAL.plateLight, plume: PAL.red, shield: "heater", shieldColor: PAL.red, emblem: "cross", emblemColor: PAL.gold, weapon: "longsword", cape: PAL.gold, legs: PAL.plate, boots: PAL.iron, scale: 1.12, h: 66 },
  bowman:     { body: "leather", bodyColor: PAL.leather, trim: PAL.leatherDark, hood: "#4f6b3a", helmet: "hood", shield: "none", weapon: "bow", quiver: true, legs: "#5a5a48", boots: PAL.leatherDark, h: 56 },

  /* the warband */
  bandit:     { body: "leather", bodyColor: "#6e4a2c", trim: PAL.blackDark, helmet: "hood", hood: PAL.black, shield: "buckler", shieldColor: PAL.rust, boss: PAL.iron, weapon: "axe", legs: "#3a3540", boots: "#1a1618", enemy: true, h: 56 },
  archer:     { body: "leather", bodyColor: "#454a58", trim: PAL.rust, helmet: "hood", hood: PAL.blackDark, shield: "none", weapon: "bow", quiver: true, legs: "#2e2a34", boots: "#1a1618", enemy: true, h: 56 },
  manAtArmsE: { body: "mail", bodyColor: PAL.ash, trim: PAL.rust, helmet: "kettle", helmetColor: PAL.black, shield: "round", shieldColor: PAL.rust, boss: PAL.iron, weapon: "sword", legs: PAL.blackDark, boots: "#111", enemy: true, h: 60 },
  shieldBearer: { body: "plate", bodyColor: PAL.warGrey, trim: PAL.rust, helmet: "greatHelm", helmetColor: PAL.black, shield: "tall", shieldColor: PAL.ash, emblem: "boss", emblemColor: PAL.rust, weapon: "mace", legs: PAL.blackDark, boots: "#111", enemy: true, h: 62 },
  crossbow:   { body: "leather", bodyColor: PAL.black, trim: PAL.rust, helmet: "kettle", helmetColor: PAL.black, shield: "none", weapon: "crossbow", legs: PAL.blackDark, boots: "#111", enemy: true, h: 57 },
  rider:      { body: "leather", bodyColor: "#5a3d28", trim: PAL.rust, helmet: "cap", helmetColor: PAL.blackDark, shield: "buckler", shieldColor: PAL.rust, boss: PAL.iron, weapon: "spear", legs: PAL.blackDark, boots: "#111", enemy: true, h: 56 },
  crew:       { body: "tunic", bodyColor: "#7a6a58", trim: PAL.blackDark, helmet: "none", shield: "none", weapon: "none", legs: PAL.blackDark, boots: "#111", enemy: true, h: 54 },

  /* Stage II riders (drawn on their horses) */
  scoutRider: { body: "leather", bodyColor: "#6e4a2c", trim: PAL.blackDark, helmet: "cap", helmetColor: PAL.blackDark, shield: "buckler", shieldColor: PAL.rust, boss: PAL.iron, weapon: "sword", legs: "#3a3540", boots: "#1a1618", enemy: true, h: 56 },
  knightRider: { body: "plate", bodyColor: "#4c4c58", trim: PAL.rust, tabard: PAL.blackDark, helmet: "greatHelm", helmetColor: PAL.black, shield: "kite", shieldColor: PAL.rust, emblem: "boss", emblemColor: PAL.iron, weapon: "lance", cape: null, legs: "#3a3a44", boots: "#1a1618", enemy: true, h: 60 },
  commanderRider: { body: "plate", bodyColor: "#2c2c34", trim: PAL.red, tabard: PAL.black, tabardTrim: PAL.red, helmet: "greatHelm", helmetColor: "#1c1c22", plume: PAL.red, shield: "heater", shieldColor: PAL.black, emblem: "chevron", emblemColor: PAL.red, weapon: "lance", cape: PAL.redDark, legs: "#2a2a32", boots: "#111", enemy: true, scale: 1.08, h: 64, banner: true },

  /* Stage III: the siege army */
  heavyInf:   { body: "plate", bodyColor: "#3a3a42", trim: PAL.rust, tabard: PAL.blackDark, helmet: "greatHelm", helmetColor: "#26262c", shield: "tall", shieldColor: "#2e2e34", emblem: "boss", emblemColor: PAL.iron, weapon: "mace", legs: "#2a2a30", boots: "#111", enemy: true, scale: 1.06, h: 64 },
  eliteGuard: { body: "plate", bodyColor: "#2a2a34", trim: PAL.red, tabard: PAL.red, tabardTrim: PAL.blackDark, helmet: "greatHelm", helmetColor: "#1c1c22", plume: PAL.red, shield: "heater", shieldColor: PAL.black, emblem: "chevron", emblemColor: PAL.red, weapon: "sword", cape: PAL.redDark, legs: "#2a2a32", boots: "#111", enemy: true, scale: 1.04, h: 64 },
  siegeEngineer: { body: "leather", bodyColor: "#6a5a48", trim: PAL.blackDark, helmet: "cap", helmetColor: PAL.leatherDark, shield: "none", weapon: "hammer", legs: PAL.blackDark, boots: "#111", enemy: true, h: 57, apron: true },
  fireArcher: { body: "leather", bodyColor: "#4a3a30", trim: PAL.rustLight, helmet: "hood", hood: "#3a2420", shield: "none", weapon: "bow", quiver: true, fire: true, legs: "#2e2a34", boots: "#1a1618", enemy: true, h: 58 },
  warCaptain: { body: "plate", bodyColor: "#3a3038", trim: PAL.gold, tabard: PAL.black, tabardTrim: PAL.rustLight, helmet: "bascinet", helmetColor: "#2a2630", plume: PAL.rustLight, shield: "kite", shieldColor: PAL.rust, emblem: "boss", emblemColor: PAL.gold, weapon: "axe", cape: PAL.blackDark, legs: "#2a2a32", boots: "#111", enemy: true, scale: 1.1, h: 66, banner: true },
  warlord:    { body: "plate", bodyColor: "#1e1c24", trim: PAL.red, tabard: "#120f14", tabardTrim: PAL.red, helmet: "greatHelm", helmetColor: "#111116", plume: PAL.redLight, horns: true, shield: "none", weapon: "greataxe", cape: PAL.redDark, legs: "#1c1c22", boots: "#0c0c0e", enemy: true, scale: 1.5, h: 96, banner: true, glow: PAL.redLight },
  heavyRider: { body: "plate", bodyColor: "#3a3a42", trim: PAL.rust, tabard: "#2a1a1a", helmet: "greatHelm", helmetColor: "#1c1c22", plume: PAL.rustLight, shield: "heater", shieldColor: PAL.blackDark, emblem: "boss", emblemColor: PAL.iron, weapon: "lance", cape: null, legs: "#2a2a32", boots: "#111", enemy: true, h: 60 },

  /* the realm's Royal Knights, drawn on their horses */
  royalRider: { body: "plate", bodyColor: PAL.plateLight, trim: PAL.gold, tabard: PAL.red, tabardTrim: PAL.gold, helmet: "greatHelm", helmetColor: PAL.plateLight, plume: PAL.gold, shield: "heater", shieldColor: PAL.red, emblem: "cross", emblemColor: PAL.gold, weapon: "lance", cape: PAL.red, legs: PAL.plate, boots: PAL.iron, h: 62 },

  /* the realm's pike drill */
  pikeMilitia:   { body: "tunic", bodyColor: PAL.cloth, trim: PAL.clothDark, helmet: "kettle", helmetColor: PAL.mail, shield: "buckler", shieldColor: PAL.wood, boss: PAL.iron, weapon: "pike", legs: "#4a4a55", boots: PAL.leatherDark, h: 56 },
  pikeManAtArms: { body: "mail", bodyColor: PAL.mail, trim: PAL.red, helmet: "nasal", helmetColor: PAL.plateDark, shield: "buckler", shieldColor: PAL.red, boss: PAL.gold, weapon: "pike", legs: PAL.mailDark, boots: PAL.leatherDark, h: 58 },
  pikeKnight:    { body: "plate", bodyColor: PAL.plate, trim: PAL.gold, tabard: PAL.red, helmet: "bascinet", helmetColor: PAL.plate, shield: "buckler", shieldColor: PAL.red, boss: PAL.gold, weapon: "pike", legs: PAL.plateDark, boots: PAL.iron, h: 60 },
  pikeRoyal:     { body: "plate", bodyColor: PAL.plateLight, trim: PAL.gold, tabard: PAL.gold, helmet: "greatHelm", helmetColor: PAL.plate, plume: PAL.red, shield: "buckler", shieldColor: PAL.gold, boss: PAL.red, weapon: "pike", cape: PAL.red, legs: PAL.plateDark, boots: PAL.iron, h: 62 },
};

/* --------------------------------- poses --------------------------------- */

const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);

function basePose() {
  return {
    bob: 0, lean: 0, headTilt: 0,
    legN: { hip: 0, knee: 0 }, legF: { hip: 0, knee: 0 },
    armW: { sh: -20, el: -20 }, armS: { sh: 25, el: 30 },      // weapon arm (far), shield arm (near)
    weaponRot: 0, bowDraw: 0, shieldUp: 0, fall: 0, alpha: 1, crouch: 0,
  };
}

/* anim: idle | walk | attack | shoot | dead | stun | charge | push | hit
   t: seconds (walk/idle) or 0..1 phase (attack/shoot/dead)              */
export function figurePose(anim, t, opts = {}) {
  const p = basePose();
  const isBow = opts.bow;
  switch (anim) {
    case "walk": {
      const c = Math.sin(t * Math.PI * 2);
      const s2 = Math.sin(t * Math.PI * 2 + Math.PI);
      p.legN.hip = c * 34; p.legN.knee = Math.max(0, -c) * 40 + 4;
      p.legF.hip = s2 * 34; p.legF.knee = Math.max(0, -s2) * 40 + 4;
      p.bob = -Math.abs(Math.cos(t * Math.PI * 2)) * 1.6;
      p.lean = 6;
      p.armW.sh = -25 + s2 * 18; p.armS.sh = 28 + c * 12;
      if (isBow) { p.armW.sh = 30; p.armS.sh = 20; }
      break;
    }
    case "charge": {
      const c = Math.sin(t * Math.PI * 2);
      const s2 = -c;
      p.legN.hip = c * 50; p.legN.knee = Math.max(0, -c) * 60 + 6;
      p.legF.hip = s2 * 50; p.legF.knee = Math.max(0, -s2) * 60 + 6;
      p.bob = -Math.abs(Math.cos(t * Math.PI * 2)) * 2.5;
      p.lean = 26;
      p.armW.sh = 95; p.armW.el = 10; p.weaponRot = -80;
      p.armS.sh = 60; p.shieldUp = 1;
      break;
    }
    case "attack": {
      /* t: 0..1 over the cooldown; the blow lands at 1 */
      if (t < 0.55) { p.armW.sh = lerp(30, -60, ease(t / 0.55)); p.armW.el = -20; p.lean = lerp(14, -4, t / 0.55); }
      else if (t < 0.85) { const k = ease((t - 0.55) / 0.3); p.armW.sh = lerp(-60, -150, k); p.armW.el = lerp(-20, -40, k); p.lean = lerp(-4, -10, k); }
      else { const k = ease((t - 0.85) / 0.15); p.armW.sh = lerp(-150, 60, k); p.armW.el = lerp(-40, 10, k); p.lean = lerp(-10, 18, k); }
      p.armS.sh = 40; p.armS.el = 40; p.shieldUp = 0.6;
      p.legN.hip = 22; p.legN.knee = 14; p.legF.hip = -18; p.legF.knee = 4;
      break;
    }
    case "shoot": {
      p.armW.sh = 85; p.armW.el = 0;                  // bow arm straight out
      const draw = t < 0.2 ? 0 : t < 0.8 ? ease((t - 0.2) / 0.6) : 1 - ease((t - 0.8) / 0.2);
      p.bowDraw = draw;
      p.armS.sh = lerp(85, 40, draw); p.armS.el = lerp(0, -110, draw);
      p.legN.hip = 16; p.legF.hip = -14; p.lean = 4;
      break;
    }
    case "push": {
      const c = Math.sin(t * Math.PI * 2);
      p.legN.hip = c * 28 + 10; p.legN.knee = Math.max(0, -c) * 30 + 10;
      p.legF.hip = -c * 28 + 10; p.legF.knee = Math.max(0, c) * 30 + 10;
      p.lean = 38; p.armW.sh = 110; p.armW.el = -10; p.armS.sh = 105; p.armS.el = -10;
      p.bob = -Math.abs(Math.cos(t * Math.PI * 2)) * 1.2;
      break;
    }
    case "dead": {
      p.fall = ease(Math.min(1, t * 1.6));
      p.alpha = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
      p.armW.sh = -40 + p.fall * 60; p.armS.sh = 20 + p.fall * 40;
      p.legN.hip = 10 * p.fall; p.legF.hip = -8 * p.fall; p.legN.knee = 20 * p.fall;
      break;
    }
    case "stun": {
      p.bob = Math.sin(t * 9) * 1.2; p.lean = -8 + Math.sin(t * 7) * 6; p.headTilt = Math.sin(t * 11) * 14;
      p.armW.sh = -10; p.armS.sh = 10; p.legN.hip = 8; p.legF.hip = -8; p.legN.knee = 10; p.legF.knee = 10;
      break;
    }
    case "brace": {
      /* feet set wide, pike levelled at the horse, shield up */
      p.legN.hip = 34; p.legN.knee = 30; p.legF.hip = -26; p.legF.knee = 10;
      p.lean = 16; p.bob = 2;
      p.armW.sh = 96; p.armW.el = -6; p.weaponRot = -100;
      p.armS.sh = 55; p.armS.el = 30; p.shieldUp = 0.8;
      break;
    }
    case "ride": {
      /* seated on a horse: legs hang forward, weapon carried level */
      const c = Math.sin(t * Math.PI * 2);
      p.legN.hip = 34; p.legN.knee = 46; p.legF.hip = 34; p.legF.knee = 46;
      p.bob = -Math.abs(c) * 1.2; p.lean = 8;
      p.armW.sh = 70; p.armW.el = -10; p.weaponRot = -60;
      p.armS.sh = 30; p.armS.el = 40;
      break;
    }
    case "rideCharge": {
      const c = Math.sin(t * Math.PI * 2);
      p.legN.hip = 40; p.legN.knee = 40; p.legF.hip = 40; p.legF.knee = 40;
      p.bob = -Math.abs(c) * 2; p.lean = 24;
      p.armW.sh = 92; p.armW.el = 0; p.weaponRot = -92;
      p.armS.sh = 60; p.armS.el = 30; p.shieldUp = 1;
      break;
    }
    case "rideRear": {
      p.legN.hip = 40; p.legN.knee = 40; p.legF.hip = 40; p.legF.knee = 40;
      p.lean = -16; p.bob = -3;
      p.armW.sh = 40; p.armW.el = -40; p.weaponRot = -30;
      p.armS.sh = 20; p.armS.el = 30;
      break;
    }
    case "idle":
    default: {
      p.bob = Math.sin(t * 2.2) * 0.7;
      p.armW.sh = -18 + Math.sin(t * 2.2) * 2; p.armS.sh = 22;
      if (isBow) { p.armW.sh = 35; p.armS.sh = 18; }
      p.legN.hip = 6; p.legF.hip = -6;
      break;
    }
  }
  return p;
}

/* --------------------------------- draw --------------------------------- */

function limb(ctx, x, y, a1, l1, a2, l2, w, color, dark) {
  const kx = x + Math.sin(a1 * RAD) * l1;
  const ky = y + Math.cos(a1 * RAD) * l1;
  const ex = kx + Math.sin((a1 + a2) * RAD) * l2;
  const ey = ky + Math.cos((a1 + a2) * RAD) * l2;
  ctx.lineCap = "round";
  ctx.strokeStyle = OUT; ctx.lineWidth = w + 2.2;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(kx, ky); ctx.lineTo(ex, ey); ctx.stroke();
  ctx.strokeStyle = color; ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(kx, ky); ctx.lineTo(ex, ey); ctx.stroke();
  if (dark) {
    ctx.strokeStyle = dark; ctx.lineWidth = w * 0.45;
    ctx.beginPath(); ctx.moveTo(x + 1, y); ctx.lineTo(kx + 1, ky); ctx.lineTo(ex + 1, ey); ctx.stroke();
  }
  return { kx, ky, ex, ey };
}

function outlined(ctx, fill, path, lw = 1.3) {
  ctx.beginPath(); path();
  ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = OUT; ctx.lineWidth = lw; ctx.stroke();
}

function drawWeapon(ctx, kind, x, y, angle) {
  /* held at (x, y): the hand. angle is the arm's absolute angle; the
     weapon continues along the forearm. */
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle * RAD);
  /* along the forearm direction = +y (down) in this frame */
  const metal = PAL.plateLight;
  switch (kind) {
    case "sword":
    case "longsword": {
      const L = kind === "longsword" ? 30 : 24;
      outlined(ctx, PAL.woodDark, () => ctx.rect(-1.6, -4, 3.2, 9));                   // grip
      outlined(ctx, PAL.gold, () => ctx.rect(-6, 4, 12, 2.4));                           // crossguard
      outlined(ctx, metal, () => { ctx.moveTo(-2.4, 6); ctx.lineTo(2.4, 6); ctx.lineTo(1.2, 6 + L); ctx.lineTo(-1.2, 6 + L); ctx.closePath(); });
      ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(-0.6, 8); ctx.lineTo(-0.3, 4 + L); ctx.stroke();
      outlined(ctx, PAL.gold, () => ctx.arc(0, -4.5, 2.2, 0, Math.PI * 2));             // pommel
      break;
    }
    case "spear": {
      outlined(ctx, PAL.wood, () => ctx.rect(-1.3, -18, 2.6, 46));
      outlined(ctx, metal, () => { ctx.moveTo(-3, 28); ctx.lineTo(3, 28); ctx.lineTo(0, 40); ctx.closePath(); });
      break;
    }
    case "pike": {
      outlined(ctx, PAL.wood, () => ctx.rect(-1.4, -14, 2.8, 62));
      outlined(ctx, PAL.iron, () => ctx.rect(-2.2, 40, 4.4, 4));
      outlined(ctx, metal, () => { ctx.moveTo(-3.2, 44); ctx.lineTo(3.2, 44); ctx.lineTo(0, 60); ctx.closePath(); });
      break;
    }
    case "lance": {
      outlined(ctx, PAL.woodLight, () => { ctx.moveTo(-2.4, -12); ctx.lineTo(2.4, -12); ctx.lineTo(1.2, 66); ctx.lineTo(-1.2, 66); ctx.closePath(); });
      outlined(ctx, PAL.iron, () => ctx.arc(0, -4, 4, 0, Math.PI * 2), 1);            // vamplate
      outlined(ctx, metal, () => { ctx.moveTo(-2.2, 62); ctx.lineTo(2.2, 62); ctx.lineTo(0, 74); ctx.closePath(); });
      /* pennon */
      outlined(ctx, PAL.rust, () => { ctx.moveTo(1, 46); ctx.lineTo(12, 50); ctx.lineTo(1, 58); ctx.closePath(); }, 1);
      break;
    }
    case "hammer": {
      ctx.strokeStyle = PAL.woodDark; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -22); ctx.stroke();
      outlined(ctx, PAL.iron, () => ctx.rect(-7, -28, 14, 8), 1.1);
      break;
    }
    case "greataxe": {
      ctx.strokeStyle = PAL.woodDark; ctx.lineWidth = 3.6; ctx.beginPath(); ctx.moveTo(0, 4); ctx.lineTo(0, -40); ctx.stroke();
      outlined(ctx, PAL.iron, () => { ctx.moveTo(0, -38); ctx.quadraticCurveTo(18, -44, 16, -22); ctx.quadraticCurveTo(10, -26, 0, -24); ctx.closePath(); }, 1.3);
      outlined(ctx, PAL.iron, () => { ctx.moveTo(0, -38); ctx.quadraticCurveTo(-18, -44, -16, -22); ctx.quadraticCurveTo(-10, -26, 0, -24); ctx.closePath(); }, 1.3);
      ctx.strokeStyle = PAL.ironLight; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(4, -36); ctx.quadraticCurveTo(14, -40, 13, -26); ctx.stroke();
      break;
    }
    case "axe": {
      outlined(ctx, PAL.wood, () => ctx.rect(-1.5, -6, 3, 28));
      outlined(ctx, PAL.ironLight, () => { ctx.moveTo(0, 12); ctx.quadraticCurveTo(12, 8, 12, 20); ctx.quadraticCurveTo(8, 24, 0, 22); ctx.closePath(); });
      break;
    }
    case "mace": {
      outlined(ctx, PAL.woodDark, () => ctx.rect(-1.5, -6, 3, 24));
      outlined(ctx, PAL.iron, () => ctx.arc(0, 21, 5, 0, Math.PI * 2));
      ctx.fillStyle = PAL.ironLight;
      for (let i = 0; i < 6; i += 1) { const a = i * Math.PI / 3; ctx.beginPath(); ctx.arc(Math.cos(a) * 5, 21 + Math.sin(a) * 5, 1.6, 0, Math.PI * 2); ctx.fill(); }
      break;
    }
    case "club": {
      outlined(ctx, PAL.woodDark, () => { ctx.moveTo(-1.5, -5); ctx.lineTo(1.5, -5); ctx.lineTo(4, 20); ctx.lineTo(-4, 20); ctx.closePath(); });
      break;
    }
    case "crossbow": {
      outlined(ctx, PAL.wood, () => ctx.rect(-1.8, -4, 3.6, 22));
      outlined(ctx, PAL.iron, () => { ctx.moveTo(-12, 12); ctx.quadraticCurveTo(0, 6, 12, 12); ctx.lineTo(12, 14); ctx.quadraticCurveTo(0, 9, -12, 14); ctx.closePath(); });
      ctx.strokeStyle = PAL.bone; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(-12, 13); ctx.lineTo(12, 13); ctx.stroke();
      break;
    }
    default: break;
  }
  ctx.restore();
}

function drawBow(ctx, x, y, angle, draw, enemy) {
  /* bow held in the far hand, string drawn by `draw` (0..1) */
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle * RAD);
  const R = 18;
  ctx.strokeStyle = OUT; ctx.lineWidth = 3.4;
  ctx.beginPath(); ctx.arc(0, 0, R, -Math.PI / 2 - 0.35, Math.PI / 2 + 0.35); ctx.stroke();
  ctx.strokeStyle = enemy ? PAL.blackLight : PAL.woodLight; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, R, -Math.PI / 2 - 0.35, Math.PI / 2 + 0.35); ctx.stroke();
  /* the arc bows toward +x (forward); the string sits at -x side */
  const sx = -R * 0.34;
  const pull = -draw * 11;
  ctx.strokeStyle = PAL.bone; ctx.lineWidth = 0.9;
  ctx.beginPath(); ctx.moveTo(sx, -R * 0.94); ctx.lineTo(sx + pull, 0); ctx.lineTo(sx, R * 0.94); ctx.stroke();
  if (draw > 0.05) {
    ctx.strokeStyle = PAL.arrow; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(sx + pull, 0); ctx.lineTo(sx + pull + 26, 0); ctx.stroke();
    ctx.fillStyle = PAL.arrowHead; ctx.beginPath(); ctx.moveTo(sx + pull + 26, -1.6); ctx.lineTo(sx + pull + 30, 0); ctx.lineTo(sx + pull + 26, 1.6); ctx.fill();
  }
  ctx.restore();
}

function drawShield(ctx, spec, x, y, up) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((-8 + up * -10) * RAD);
  const c = spec.shieldColor;
  const dark = shade(c, -0.35);
  switch (spec.shield) {
    case "round":
      outlined(ctx, c, () => ctx.arc(0, 0, 10, 0, Math.PI * 2), 1.5);
      ctx.fillStyle = rgba("#000000", 0.14); ctx.beginPath(); ctx.arc(2, 2, 10, -Math.PI * 0.35, Math.PI * 0.65); ctx.fill();
      ctx.strokeStyle = dark; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.stroke();
      outlined(ctx, spec.boss || PAL.iron, () => ctx.arc(0, 0, 3, 0, Math.PI * 2), 1);
      break;
    case "buckler":
      outlined(ctx, c, () => ctx.arc(0, 0, 6.5, 0, Math.PI * 2), 1.3);
      outlined(ctx, spec.boss || PAL.iron, () => ctx.arc(0, 0, 2.2, 0, Math.PI * 2), 1);
      break;
    case "kite":
      outlined(ctx, c, () => { ctx.moveTo(0, -12); ctx.quadraticCurveTo(10, -10, 9, 2); ctx.quadraticCurveTo(7, 14, 0, 22); ctx.quadraticCurveTo(-7, 14, -9, 2); ctx.quadraticCurveTo(-10, -10, 0, -12); }, 1.5);
      ctx.fillStyle = rgba("#000000", 0.14); ctx.beginPath(); ctx.moveTo(0, -12); ctx.quadraticCurveTo(10, -10, 9, 2); ctx.quadraticCurveTo(7, 14, 0, 22); ctx.lineTo(0, -12); ctx.fill();
      emblem(ctx, spec, 0, 3, 0.8);
      break;
    case "heater":
      outlined(ctx, c, () => { ctx.moveTo(-10, -11); ctx.lineTo(10, -11); ctx.lineTo(10, 2); ctx.quadraticCurveTo(10, 14, 0, 19); ctx.quadraticCurveTo(-10, 14, -10, 2); ctx.closePath(); }, 1.5);
      ctx.fillStyle = rgba("#000000", 0.14); ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(10, -11); ctx.lineTo(10, 2); ctx.quadraticCurveTo(10, 14, 0, 19); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = spec.emblemColor || PAL.gold; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-8, -9); ctx.lineTo(8, -9); ctx.lineTo(8, 2); ctx.quadraticCurveTo(8, 12, 0, 16.5); ctx.quadraticCurveTo(-8, 12, -8, 2); ctx.closePath(); ctx.stroke();
      emblem(ctx, spec, 0, 2, 0.9);
      break;
    case "tall":
      outlined(ctx, c, () => { ctx.moveTo(-9, -18); ctx.lineTo(9, -18); ctx.lineTo(9, 16); ctx.quadraticCurveTo(9, 22, 0, 24); ctx.quadraticCurveTo(-9, 22, -9, 16); ctx.closePath(); }, 1.6);
      ctx.fillStyle = rgba("#000000", 0.16); ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(9, -18); ctx.lineTo(9, 16); ctx.quadraticCurveTo(9, 22, 0, 24); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = dark; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-9, -6); ctx.lineTo(9, -6); ctx.moveTo(-9, 8); ctx.lineTo(9, 8); ctx.stroke();
      outlined(ctx, spec.emblemColor || PAL.iron, () => ctx.arc(0, 1, 3.5, 0, Math.PI * 2), 1);
      break;
    default: break;
  }
  ctx.restore();
}

function emblem(ctx, spec, x, y, k) {
  const c = spec.emblemColor || PAL.gold;
  ctx.fillStyle = c;
  if (spec.emblem === "cross") {
    ctx.fillRect(x - 1.4 * k, y - 8 * k, 2.8 * k, 16 * k);
    ctx.fillRect(x - 6 * k, y - 3.5 * k, 12 * k, 2.8 * k);
  } else if (spec.emblem === "chevron") {
    ctx.beginPath(); ctx.moveTo(x - 7 * k, y + 5 * k); ctx.lineTo(x, y - 4 * k); ctx.lineTo(x + 7 * k, y + 5 * k); ctx.lineTo(x + 7 * k, y + 1 * k); ctx.lineTo(x, y - 8 * k); ctx.lineTo(x - 7 * k, y + 1 * k); ctx.closePath(); ctx.fill();
  }
}

function drawHead(ctx, spec, x, y, tilt, skin) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt * RAD);
  const [sk, skD] = skin;
  /* neck */
  ctx.strokeStyle = OUT; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(0, 6); ctx.lineTo(0, 2); ctx.stroke();
  ctx.strokeStyle = skD; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(0, 6); ctx.lineTo(0, 2); ctx.stroke();
  /* face */
  outlined(ctx, sk, () => ctx.arc(0, 0, 8, 0, Math.PI * 2), 1.3);
  ctx.fillStyle = rgba("#000000", 0.12); ctx.beginPath(); ctx.arc(0, 0, 8, -Math.PI * 0.5, Math.PI * 0.5); ctx.fill();
  /* eye and brow */
  ctx.fillStyle = "#2a1c12"; ctx.beginPath(); ctx.arc(3.6, -0.4, 1.2, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = rgba("#2a1c12", 0.7); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(1.5, -3.2); ctx.lineTo(5.6, -2.6); ctx.stroke();
  const hc = spec.helmetColor || PAL.plate;
  switch (spec.helmet) {
    case "kettle":
      outlined(ctx, hc, () => { ctx.moveTo(-8, -4); ctx.quadraticCurveTo(0, -16, 8, -4); ctx.closePath(); }, 1.3);
      outlined(ctx, shade(hc, -0.15), () => ctx.ellipse(0, -4, 11, 2.6, 0, 0, Math.PI * 2), 1.2);
      break;
    case "nasal":
      outlined(ctx, hc, () => { ctx.moveTo(-7.4, -2); ctx.quadraticCurveTo(0, -17, 7.4, -2); ctx.closePath(); }, 1.3);
      ctx.fillStyle = shade(hc, -0.3); ctx.fillRect(3.6, -3, 2, 7);
      ctx.fillStyle = PAL.mail; ctx.beginPath(); ctx.moveTo(-7.4, -2); ctx.lineTo(-7.8, 8); ctx.lineTo(-2, 9); ctx.lineTo(-1, 2); ctx.closePath(); ctx.fill();
      break;
    case "bascinet":
      outlined(ctx, hc, () => { ctx.moveTo(-7.6, 0); ctx.quadraticCurveTo(-2, -18, 3, -13); ctx.quadraticCurveTo(8, -9, 7.6, 0); ctx.closePath(); }, 1.3);
      ctx.strokeStyle = shade(hc, -0.35); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-6, 0.5); ctx.lineTo(7, 0.5); ctx.stroke();
      ctx.fillStyle = PAL.mail; ctx.beginPath(); ctx.moveTo(-7.6, 0); ctx.lineTo(-8, 9); ctx.lineTo(-1, 9.5); ctx.lineTo(-1, 3); ctx.closePath(); ctx.fill();
      if (spec.plume) plume(ctx, spec.plume, -2, -14);
      break;
    case "greatHelm":
      outlined(ctx, hc, () => { ctx.moveTo(-8, -10); ctx.lineTo(8, -10); ctx.lineTo(8, 8); ctx.lineTo(-8, 8); ctx.closePath(); }, 1.4);
      ctx.fillStyle = rgba("#000000", 0.16); ctx.fillRect(1, -10, 7, 18);
      ctx.fillStyle = "#15120f"; ctx.fillRect(-6, -2, 13, 1.8); ctx.fillRect(1.5, -2, 1.6, 8);
      ctx.strokeStyle = shade(hc, 0.3); ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(-8, -10); ctx.lineTo(8, -10); ctx.stroke();
      if (spec.plume) plume(ctx, spec.plume, -1, -12);
      break;
    case "cap":
      outlined(ctx, hc, () => { ctx.moveTo(-7.6, -2); ctx.quadraticCurveTo(0, -14, 7.6, -2); ctx.closePath(); }, 1.3);
      break;
    case "hood":
      outlined(ctx, spec.hood || PAL.black, () => { ctx.moveTo(-9, 6); ctx.quadraticCurveTo(-10, -12, 0, -11); ctx.quadraticCurveTo(9, -10, 6, -1); ctx.quadraticCurveTo(3, 5, 5, 8); ctx.lineTo(-9, 8); ctx.closePath(); }, 1.3);
      ctx.fillStyle = rgba("#000000", 0.25); ctx.beginPath(); ctx.moveTo(-1, -8); ctx.quadraticCurveTo(6, -8, 5, 0); ctx.quadraticCurveTo(2, 3, -2, 0); ctx.closePath(); ctx.fill();
      break;
    case "coif":
      outlined(ctx, PAL.mail, () => { ctx.moveTo(-8, 8); ctx.quadraticCurveTo(-9, -12, 0, -10); ctx.quadraticCurveTo(8, -9, 5, -3); ctx.lineTo(4, 8); ctx.closePath(); }, 1.3);
      break;
    default:
      outlined(ctx, spec.hairColor || PAL.hair, () => { ctx.moveTo(-7.4, -1); ctx.quadraticCurveTo(-6, -11, 1, -9.5); ctx.quadraticCurveTo(8, -8, 6.5, -2); ctx.quadraticCurveTo(2, -6, -3, -3); ctx.closePath(); }, 1.2);
      break;
  }
  ctx.restore();
}

function plume(ctx, color, x, y) {
  ctx.strokeStyle = OUT; ctx.lineWidth = 4.2;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x - 8, y - 6, x - 14, y + 4); ctx.stroke();
  ctx.strokeStyle = color; ctx.lineWidth = 2.6;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x - 8, y - 6, x - 14, y + 4); ctx.stroke();
}

function drawTorso(ctx, spec, lean) {
  /* hips at (0,-30) → shoulders at (0,-49), leaned forward */
  ctx.save();
  ctx.translate(0, -27);
  ctx.rotate(-lean * RAD);
  const c = spec.bodyColor;
  const wide = spec.body === "plate" ? 13 : spec.body === "mail" ? 12 : 11;
  outlined(ctx, c, () => { ctx.moveTo(-wide + 2, 1); ctx.lineTo(wide - 2, 1); ctx.lineTo(wide, -20); ctx.lineTo(-wide, -20); ctx.closePath(); }, 1.4);
  /* shaded right side */
  ctx.fillStyle = rgba("#000000", 0.14); ctx.beginPath(); ctx.moveTo(0, 1); ctx.lineTo(wide - 2, 1); ctx.lineTo(wide, -20); ctx.lineTo(0, -20); ctx.closePath(); ctx.fill();
  if (spec.body === "mail") {
    ctx.fillStyle = rgba("#000000", 0.22);
    for (let yy = -18; yy < 0; yy += 3) for (let xx = -wide + 2; xx < wide - 1; xx += 3) { ctx.beginPath(); ctx.arc(xx + ((yy / 3) % 2 ? 1.5 : 0), yy, 0.7, 0, Math.PI * 2); ctx.fill(); }
  }
  if (spec.body === "plate") {
    ctx.strokeStyle = rgba("#ffffff", 0.55); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-wide + 2, -18); ctx.lineTo(-2, -18); ctx.stroke();
    ctx.strokeStyle = shade(c, -0.3); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-wide + 1, -9); ctx.lineTo(wide - 1, -9); ctx.stroke();
  }
  if (spec.tabard) {
    outlined(ctx, spec.tabard, () => { ctx.moveTo(-6.5, 4); ctx.lineTo(6.5, 4); ctx.lineTo(6.5, -18); ctx.lineTo(-6.5, -18); ctx.closePath(); }, 1.1);
    ctx.fillStyle = rgba("#000000", 0.14); ctx.fillRect(0, -18, 6.5, 22);
    if (spec.tabardTrim) { ctx.strokeStyle = spec.tabardTrim; ctx.lineWidth = 1; ctx.strokeRect(-5.5, -17, 11, 20); }
    ctx.fillStyle = spec.trim; ctx.fillRect(-1.2, -16, 2.4, 7); ctx.fillRect(-3.5, -14, 7, 2.2);
  }
  if (spec.body === "leather") {
    ctx.strokeStyle = shade(c, -0.35); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-wide + 2, -13); ctx.lineTo(wide - 2, -13); ctx.moveTo(-wide + 2, -6); ctx.lineTo(wide - 2, -6); ctx.stroke();
    ctx.fillStyle = rgba("#000000", 0.18); ctx.beginPath(); ctx.moveTo(-3, -20); ctx.lineTo(3, -20); ctx.lineTo(1.5, -12); ctx.lineTo(-1.5, -12); ctx.closePath(); ctx.fill();
  }
  /* belt */
  ctx.fillStyle = PAL.leatherDark; ctx.fillRect(-wide + 2, -3, wide * 2 - 4, 2.8);
  ctx.fillStyle = spec.enemy ? PAL.iron : PAL.gold; ctx.fillRect(-1.6, -3.4, 3.2, 3.4);
  /* shoulders / pauldrons */
  if (spec.body === "plate") {
    outlined(ctx, c, () => ctx.arc(-wide + 1, -18, 5, 0, Math.PI * 2), 1.1);
    outlined(ctx, c, () => ctx.arc(wide - 1, -18, 5, 0, Math.PI * 2), 1.1);
  }
  ctx.restore();
}

function drawCape(ctx, color, lean, sway) {
  ctx.save();
  ctx.translate(0, -27);
  ctx.rotate(-lean * RAD);
  outlined(ctx, color, () => {
    ctx.moveTo(-10, -19); ctx.lineTo(8, -19);
    ctx.quadraticCurveTo(2, -4, -4 + sway, 14);
    ctx.quadraticCurveTo(-12 + sway, 14, -16 + sway * 0.5, 4);
    ctx.closePath();
  }, 1.3);
  ctx.fillStyle = rgba("#000000", 0.18);
  ctx.beginPath(); ctx.moveTo(-2, -18); ctx.lineTo(7, -18); ctx.quadraticCurveTo(2, -4, -4 + sway, 14); ctx.lineTo(-6, 0); ctx.closePath(); ctx.fill();
  ctx.restore();
}

/* Draws one figure with the feet at (0, 0), facing +x. `variant`
   picks the skin tone. */
export function drawFigure(ctx, spec, pose, variant = 0) {
  const skin = SKINS[variant % SKINS.length];
  const sc = spec.scale || 1;
  ctx.save();
  ctx.scale(sc * 1.08, sc * 1.08);
  if (pose.fall > 0) {
    /* fall backwards (away from the facing direction) about the feet */
    ctx.rotate(pose.fall * 82 * RAD);
    ctx.translate(0, pose.fall * 4);
  }
  ctx.globalAlpha *= pose.alpha;
  ctx.translate(0, pose.bob);
  const hipY = -27;
  const hipsX = 0;
  const leanRad = -pose.lean * RAD;
  /* shoulder positions after torso lean (rotate about the hips) */
  const shx = hipsX + Math.sin(-leanRad) * 20 * -1;
  const shy = hipY + Math.cos(leanRad) * -20;
  const farSh = { x: shx - 7, y: shy + 1 };
  const nearSh = { x: shx + 7, y: shy + 1 };
  const legW = 6.6;
  const armW = 5.4;
  const isBow = spec.weapon === "bow";

  if (spec.cape) drawCape(ctx, spec.cape, pose.lean, Math.sin(pose.bob * 3) * 2);

  /* far leg */
  limb(ctx, hipsX - 3.5, hipY, pose.legF.hip, 13.5, pose.legF.knee, 13.5, legW, spec.legs, shade(spec.legs, -0.25));
  /* far arm with weapon (drawn behind the torso) */
  if (isBow) {
    const a = limb(ctx, farSh.x, farSh.y, pose.armW.sh, 11, pose.armW.el, 11, armW, spec.bodyColor === PAL.black ? PAL.blackLight : spec.bodyColor);
    drawBow(ctx, a.ex, a.ey, pose.armW.sh + pose.armW.el, pose.bowDraw, spec.enemy);
    /* hand */
    ctx.fillStyle = skin[0]; ctx.beginPath(); ctx.arc(a.ex, a.ey, 2.4, 0, Math.PI * 2); ctx.fill();
  } else {
    const a = limb(ctx, farSh.x, farSh.y, pose.armW.sh, 11, pose.armW.el, 11, armW, spec.body === "plate" ? spec.bodyColor : shade(spec.bodyColor, -0.1));
    ctx.fillStyle = skin[0]; ctx.beginPath(); ctx.arc(a.ex, a.ey, 2.6, 0, Math.PI * 2); ctx.fill();
    if (spec.weapon !== "none") drawWeapon(ctx, spec.weapon, a.ex, a.ey, pose.armW.sh + pose.armW.el + pose.weaponRot);
  }
  /* torso */
  drawTorso(ctx, spec, pose.lean);
  if (spec.quiver) {
    ctx.save(); ctx.translate(shx - 8, shy + 4); ctx.rotate(-0.5);
    outlined(ctx, PAL.leatherDark, () => ctx.rect(-2.5, -12, 5, 18), 1.1);
    ctx.strokeStyle = PAL.arrow; ctx.lineWidth = 1; for (let i = -1; i <= 1; i += 1) { ctx.beginPath(); ctx.moveTo(i * 1.5, -12); ctx.lineTo(i * 1.5, -19); ctx.stroke(); }
    ctx.restore();
  }
  /* near leg */
  limb(ctx, hipsX + 3.5, hipY, pose.legN.hip, 13.5, pose.legN.knee, 13.5, legW, spec.legs, shade(spec.legs, -0.25));
  /* boots */
  ctx.fillStyle = spec.boots;
  for (const L of [pose.legF, pose.legN]) {
    const kx = Math.sin(L.hip * RAD) * 13.5; const ky = hipY + Math.cos(L.hip * RAD) * 13.5;
    const ex = kx + Math.sin((L.hip + L.knee) * RAD) * 13.5; const ey = ky + Math.cos((L.hip + L.knee) * RAD) * 13.5;
    ctx.beginPath(); ctx.ellipse(ex + 2.5, ey, 6, 3, 0, 0, Math.PI * 2); ctx.fill();
  }
  /* head */
  drawHead(ctx, spec, shx + 0.5, shy - 10, pose.headTilt - pose.lean * 0.3, skin);
  /* near arm with shield (or the bow-string hand) */
  if (isBow) {
    const a = limb(ctx, nearSh.x, nearSh.y, pose.armS.sh, 11, pose.armS.el, 11, armW, spec.bodyColor === PAL.black ? PAL.blackLight : spec.bodyColor);
    ctx.fillStyle = skin[0]; ctx.beginPath(); ctx.arc(a.ex, a.ey, 2.4, 0, Math.PI * 2); ctx.fill();
  } else {
    const a = limb(ctx, nearSh.x, nearSh.y, pose.armS.sh, 11, pose.armS.el, 11, armW, spec.body === "plate" ? spec.bodyColor : shade(spec.bodyColor, -0.1));
    ctx.fillStyle = skin[0]; ctx.beginPath(); ctx.arc(a.ex, a.ey, 2.6, 0, Math.PI * 2); ctx.fill();
    if (spec.shield !== "none") drawShield(ctx, spec, a.ex + 2, a.ey - 2, pose.shieldUp);
  }
  ctx.restore();
}

/* ------------------------------ the horse ------------------------------ */

export function drawHorse(ctx, t, color, opts = {}) {
  /* feet at y=0, facing +x. `t` is the cycle phase. opts: gallop (charge
     stride), rear (0..1 rearing up), barding colour, plume, size */
  const dark = shade(color, -0.3);
  const gallop = !!opts.gallop;
  const rear = opts.rear || 0;
  const c = Math.sin(t * Math.PI * 2);
  const c2 = Math.sin(t * Math.PI * 2 + Math.PI * 0.5);
  const bob = gallop ? -Math.abs(c) * 3.5 : -Math.abs(c) * 2;
  const stride = gallop ? 1.6 : 1;
  const bard = opts.barding || null;
  ctx.save();
  ctx.scale(opts.size || 1, opts.size || 1);
  if (rear > 0) { ctx.translate(-14 * rear, 0); ctx.rotate(-0.55 * rear); }
  ctx.translate(0, bob);
  const leg = (x, y, a1, a2) => {
    const kx = x + Math.sin(a1 * RAD) * 12; const ky = y + Math.cos(a1 * RAD) * 12;
    const ex = kx + Math.sin((a1 + a2) * RAD) * 13; const ey = ky + Math.cos((a1 + a2) * RAD) * 13;
    ctx.strokeStyle = OUT; ctx.lineWidth = 7.6; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(kx, ky); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.strokeStyle = dark; ctx.lineWidth = 5.4; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(kx, ky); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.strokeStyle = rgba("#ffffff", 0.14); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x - 1, y); ctx.lineTo(kx - 1, ky); ctx.stroke();
    ctx.fillStyle = "#1a1512"; ctx.beginPath(); ctx.ellipse(ex + 1, ey, 4, 2.4, 0, 0, Math.PI * 2); ctx.fill();
  };
  const frontLift = rear * 70;
  /* far legs */
  leg(-16, -25, -c * 30 * stride - 5, Math.max(0, c) * 40);
  leg(16, -25, c * 32 * stride + 5 + frontLift, Math.max(0, -c) * 30);
  /* tail */
  ctx.strokeStyle = OUT; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(-26, -34); ctx.quadraticCurveTo(-36 - (gallop ? 8 : 0), -30 + c * 3, -34 - (gallop ? 10 : 0), -14 + (gallop ? -8 : 0)); ctx.stroke();
  ctx.strokeStyle = "#1e1a17"; ctx.lineWidth = 3.4; ctx.beginPath(); ctx.moveTo(-26, -34); ctx.quadraticCurveTo(-36 - (gallop ? 8 : 0), -30 + c * 3, -34 - (gallop ? 10 : 0), -14 + (gallop ? -8 : 0)); ctx.stroke();
  /* body */
  outlined(ctx, color, () => ctx.ellipse(0, -32, 27, 12, 0, 0, Math.PI * 2), 1.8);
  ctx.fillStyle = rgba("#000000", 0.16); ctx.beginPath(); ctx.ellipse(0, -30, 27, 12, 0, 0, Math.PI); ctx.fill();
  ctx.fillStyle = rgba("#ffffff", 0.14); ctx.beginPath(); ctx.ellipse(-4, -37, 16, 4, 0, 0, Math.PI * 2); ctx.fill();
  if (!bard && opts.cloth) {
    /* saddle cloth with a fringed edge */
    outlined(ctx, opts.cloth, () => { ctx.moveTo(-14, -42); ctx.lineTo(10, -42); ctx.lineTo(12, -24); ctx.lineTo(-16, -24); ctx.closePath(); }, 1.2);
    ctx.fillStyle = rgba("#000000", 0.14); ctx.fillRect(-2, -42, 14, 18);
    ctx.strokeStyle = PAL.gold; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-15, -26); ctx.lineTo(11, -26); ctx.stroke();
  }
  if (bard) {
    /* caparison over the back and flanks, trimmed */
    outlined(ctx, bard, () => { ctx.moveTo(-24, -40); ctx.quadraticCurveTo(0, -46, 22, -40); ctx.lineTo(24, -20); ctx.quadraticCurveTo(0, -16, -24, -20); ctx.closePath(); }, 1.3);
    ctx.fillStyle = rgba("#000000", 0.16); ctx.beginPath(); ctx.moveTo(0, -44); ctx.lineTo(22, -40); ctx.lineTo(24, -20); ctx.lineTo(0, -17); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = opts.trim || PAL.gold; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-23, -22); ctx.quadraticCurveTo(0, -18, 23, -22); ctx.stroke();
    for (let i = -18; i <= 18; i += 9) { ctx.fillStyle = opts.trim || PAL.gold; ctx.beginPath(); ctx.moveTo(i - 3, -21); ctx.lineTo(i, -16); ctx.lineTo(i + 3, -21); ctx.fill(); }
  }
  /* neck + head */
  outlined(ctx, color, () => { ctx.moveTo(16, -40); ctx.lineTo(32, -58); ctx.lineTo(40, -52); ctx.lineTo(26, -30); ctx.closePath(); }, 1.4);
  if (bard) { outlined(ctx, bard, () => { ctx.moveTo(18, -42); ctx.lineTo(31, -56); ctx.lineTo(36, -52); ctx.lineTo(26, -34); ctx.closePath(); }, 1); }
  outlined(ctx, color, () => { ctx.moveTo(30, -60); ctx.lineTo(46, -56); ctx.lineTo(48, -48); ctx.lineTo(36, -46); ctx.closePath(); }, 1.4);
  if (bard) {
    /* chamfron */
    outlined(ctx, opts.chamfron || PAL.iron, () => { ctx.moveTo(31, -60); ctx.lineTo(44, -57); ctx.lineTo(45, -52); ctx.lineTo(34, -53); ctx.closePath(); }, 1);
  }
  ctx.fillStyle = "#1a1512"; ctx.beginPath(); ctx.arc(39, -55, 1.3, 0, Math.PI * 2); ctx.fill();
  /* mane */
  ctx.strokeStyle = "#1e1a17"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(18, -42); ctx.quadraticCurveTo(26, -52, 33, -60); ctx.stroke();
  ctx.fillStyle = dark; ctx.beginPath(); ctx.moveTo(32, -60); ctx.lineTo(34, -66); ctx.lineTo(37, -60); ctx.fill();
  if (opts.plume) plume(ctx, opts.plume, 33, -64);
  /* saddle */
  outlined(ctx, opts.saddle || PAL.leatherDark, () => ctx.ellipse(-2, -42, 10, 4, 0, 0, Math.PI * 2), 1.2);
  ctx.strokeStyle = opts.saddle || PAL.leatherDark; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-2, -40); ctx.lineTo(-2, -24); ctx.stroke();
  /* near legs */
  leg(-12, -25, c2 * 30 * stride - 5, Math.max(0, -c2) * 40);
  leg(20, -25, -c2 * 32 * stride + 5 + frontLift, Math.max(0, c2) * 30);
  /* reins */
  ctx.strokeStyle = PAL.leatherDark; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(4, -46); ctx.quadraticCurveTo(24, -40, 44, -50); ctx.stroke();
  ctx.restore();
}

/* ------------------------------ the ram ------------------------------ */

export function drawRam(ctx, t, opts = {}) {
  /* facing +x, ground at y=0, 4 crew push it along; t drives wheels and the crew */
  const wheel = (x, y, r) => {
    outlined(ctx, PAL.woodDark, () => ctx.arc(x, y, r, 0, Math.PI * 2), 1.5);
    ctx.strokeStyle = PAL.wood; ctx.lineWidth = 2.2;
    for (let i = 0; i < 4; i += 1) { const a = t * Math.PI * 2 + i * Math.PI / 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * (r - 1.5), y + Math.sin(a) * (r - 1.5)); ctx.stroke(); }
    ctx.strokeStyle = PAL.iron; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, r - 0.8, 0, Math.PI * 2); ctx.stroke();
  };
  /* far wheels */
  wheel(-30, -8, 9); wheel(28, -8, 9);
  /* frame posts */
  ctx.fillStyle = PAL.wood;
  for (const px of [-36, -12, 12, 36]) {
    outlined(ctx, PAL.wood, () => ctx.rect(px - 2.5, -46, 5, 40), 1.2);
  }
  /* the ram beam, slung under the roof */
  outlined(ctx, PAL.woodLight, () => ctx.rect(-44, -30, 92, 9), 1.4);
  ctx.fillStyle = rgba("#000000", 0.14); ctx.fillRect(-44, -25, 92, 4);
  for (const px of [-30, -6, 18]) { ctx.strokeStyle = PAL.iron; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(px, -30); ctx.lineTo(px, -21); ctx.stroke(); }
  /* iron head */
  outlined(ctx, PAL.iron, () => { ctx.moveTo(46, -33); ctx.lineTo(60, -30); ctx.lineTo(62, -25.5); ctx.lineTo(60, -21); ctx.lineTo(46, -18); ctx.closePath(); }, 1.5);
  ctx.strokeStyle = PAL.ironLight; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(47, -32); ctx.lineTo(59, -29.5); ctx.stroke();
  ctx.fillStyle = PAL.ironLight; for (const px of [50, 56]) { ctx.beginPath(); ctx.arc(px, -25.5, 1.3, 0, Math.PI * 2); ctx.fill(); }
  /* ropes */
  ctx.strokeStyle = PAL.bone; ctx.lineWidth = 1.2;
  for (const px of [-30, -6, 18]) { ctx.beginPath(); ctx.moveTo(px, -46); ctx.lineTo(px, -30); ctx.stroke(); }
  /* roof of planks (hides + planks) */
  outlined(ctx, PAL.woodDark, () => { ctx.moveTo(-46, -46); ctx.lineTo(0, -66); ctx.lineTo(46, -46); ctx.closePath(); }, 1.5);
  outlined(ctx, PAL.leather, () => { ctx.moveTo(-46, -46); ctx.lineTo(0, -66); ctx.lineTo(46, -46); ctx.lineTo(46, -42); ctx.lineTo(-46, -42); ctx.closePath(); }, 1.2);
  ctx.fillStyle = rgba("#000000", 0.16); ctx.beginPath(); ctx.moveTo(0, -66); ctx.lineTo(46, -46); ctx.lineTo(46, -42); ctx.lineTo(0, -62); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = PAL.woodDark; ctx.lineWidth = 1;
  for (let i = 1; i < 5; i += 1) { ctx.beginPath(); ctx.moveTo(-46 + i * 9, -46 + i * 3.9); ctx.lineTo(-46 + i * 9, -42 + i * 3.9 - 3.9); ctx.stroke(); }
  /* crew pushing (two visible on the near side) */
  const pose = figurePose("push", t);
  for (const px of [-40, 4]) {
    ctx.save(); ctx.translate(px, 2); ctx.scale(0.86, 0.86);
    drawFigure(ctx, FIGURES.crew, pose, px < 0 ? 1 : 0);
    ctx.restore();
  }
  /* near wheels */
  wheel(-30, -6, 10); wheel(28, -6, 10);
  /* torn banner on top */
  if (opts.banner !== false) {
    ctx.strokeStyle = PAL.woodDark; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -66); ctx.lineTo(0, -84); ctx.stroke();
    outlined(ctx, PAL.blackDark, () => { ctx.moveTo(0, -84); ctx.lineTo(-16, -80); ctx.lineTo(-12, -74); ctx.lineTo(-18, -70); ctx.lineTo(0, -70); ctx.closePath(); }, 1.1);
  }
}

export function figureSpec(unit) {
  return FIGURES[unit] || FIGURES.militia;
}
