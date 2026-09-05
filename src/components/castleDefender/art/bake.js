/* ------------------------------------------------------------------ *
 * Castle Defender — sprite baking.
 *
 * Every figure, tower and prop is vector art drawn with canvas path
 * calls. Drawing that every frame for a hundred figures would be far
 * too slow on a phone, so each (thing, pose, frame) is drawn ONCE into
 * an offscreen canvas at the current world scale and blitted with
 * drawImage from then on. The cache is keyed by a string and cleared
 * whenever the scale changes (resize, rotation, fullscreen).
 * ------------------------------------------------------------------ */

export function createSpriteCache() {
  let scale = 1;
  let map = new Map();
  let bytes = 0;

  const makeCanvas = (w, h) => {
    if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  };

  return {
    get scale() { return scale; },
    setScale(v) {
      const s = Math.max(0.25, Math.min(4, v));
      if (Math.abs(s - scale) < 0.02) return false;
      scale = s;
      map = new Map();
      bytes = 0;
      return true;
    },
    /* `draw(ctx)` paints in world units with the origin at the sprite's
       anchor; the box is [-ax, -ay, w - ax, h - ay] in world units. */
    get(key, w, h, ax, ay, draw) {
      let sp = map.get(key);
      if (sp) return sp;
      const pw = Math.max(1, Math.ceil(w * scale));
      const ph = Math.max(1, Math.ceil(h * scale));
      const canvas = makeCanvas(pw, ph);
      const ctx = canvas.getContext("2d");
      ctx.setTransform(scale, 0, 0, scale, ax * scale, ay * scale);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      draw(ctx);
      sp = { canvas, w, h, ax, ay, pw, ph };
      map.set(key, sp);
      bytes += pw * ph * 4;
      return sp;
    },
    /* draw a cached sprite with its anchor at world (x, y) on a context
       whose transform already maps world → screen */
    blit(ctx, sp, x, y, flip = false, alpha = 1) {
      if (alpha <= 0) return;
      if (alpha < 1) ctx.globalAlpha = alpha;
      if (flip) {
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(-1, 1);
        ctx.drawImage(sp.canvas, -sp.ax, -sp.ay, sp.w, sp.h);
        ctx.restore();
      } else {
        ctx.drawImage(sp.canvas, x - sp.ax, y - sp.ay, sp.w, sp.h);
      }
      if (alpha < 1) ctx.globalAlpha = 1;
    },
    stats() { return { sprites: map.size, mb: (bytes / 1048576).toFixed(1) }; },
    clear() { map = new Map(); bytes = 0; },
  };
}
