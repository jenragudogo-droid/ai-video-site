/* Browser test harness for Castle Defender (dev only). Load in the page with
   `await import("/test/castle-browser-harness.js"); await window.__setup();`
   Replaces requestAnimationFrame with a captured callback so frames can be
   driven synchronously (window.__pump(n)), posts canvas screenshots to a
   local receiver (window.__shot(name)), taps the battlefield in world
   coordinates (window.__tap(x, y)) and runs a scripted commander
   (window.__advance(seconds, opts)). */
window.__castleNoAutoPause = true;
window.__realRaf = window.__realRaf || window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = (f) => { window.__rafCb = f; return 1; };
window.__now = performance.now();
window.__pump = (n, step = 33) => { for (let i = 0; i < n; i++) { const cb = window.__rafCb; window.__rafCb = null; window.__now += step; if (cb) cb(window.__now); } return n; };
window.__shot = async (name) => { const cv = document.querySelector('.cdCanvas'); const tmp = document.createElement('canvas'); tmp.width = Math.min(cv.width, 1600); tmp.height = Math.round(cv.height * tmp.width / cv.width); const ctx = tmp.getContext('2d'); ctx.drawImage(cv, 0, 0, tmp.width, tmp.height); const res = await fetch('http://127.0.0.1:5299/shot?name=' + name, { method: 'POST', body: tmp.toDataURL('image/jpeg', 0.88) }); return res.text(); };
window.__tap = (wx, wy, right = false) => { const r = window.__castle.renderer.current; const sp = r.toScreen(wx, wy); const rect = document.querySelector('.cd').getBoundingClientRect(); const gl = document.querySelector('.cdGestures'); if (!gl) return false; const init = { clientX: rect.left + sp.x, clientY: rect.top + sp.y, pointerId: 1, bubbles: true, button: right ? 2 : 0 }; if (right) { gl.dispatchEvent(new MouseEvent('contextmenu', init)); return true; } gl.dispatchEvent(new PointerEvent('pointerdown', init)); gl.dispatchEvent(new PointerEvent('pointerup', init)); return true; };
window.__setup = async () => {
  const E = await import('/src/components/castleDefender/engine/engine.js');
  const T = await import('/src/components/castleDefender/data/towers.js');
  window.__E = E;
  window.__advance = (sec, opts = {}) => {
    const g = window.__castle.game.current;
    const plan = opts.plan || [[0,'archer'],[1,'archer'],[2,'barracks'],[4,'ballista'],[3,'archer'],[5,'catapult'],[6,'archer'],[7,'ballista'],[8,'archer']];
    const steps = Math.round(sec * 60);
    for (let i = 0; i < steps; i++) {
      if (g.phase !== 'playing') break;
      if (opts.until && opts.until(g)) break;
      if (!opts.noBuild) {
        let acted = false;
        for (const [plot, type] of plan) { if (!g.towers[plot] && E.canBuild(g, plot, type)) { E.buildTower(g, plot, type); acted = true; break; } }
        if (!acted && g.gold > 140) { let best = -1, bc = 1e9; g.towers.forEach((t, i) => { if (!t || t.level >= 4) return; const c = T.TOWERS[t.type].upgrades[t.level - 1]; if (c < bc && c <= g.gold) { bc = c; best = i; } }); if (best >= 0) E.upgradeTower(g, best); }
        const h = g.hero; const near = g.enemies.filter(e => e.state !== 'dead' && Math.hypot(e.x - h.x, e.y - h.y) < 200);
        if (near.length >= 3 && h.chargeCd <= 0 && !h.charge) E.heroCharge(g, near[0].x, near[0].y);
        if (h.state === 'idle' && !h.moveTarget && near.length === 0 && g.enemies.length) { const far = g.enemies.reduce((a, e) => e.progress > a.progress ? e : a, g.enemies[0]); if (far.progress > 0.55) E.moveHero(g, far.x, far.y); }
        if (g.abilities.volley <= 0 && g.enemies.length >= 4) { const e = g.enemies[0]; E.castVolley(g, e.x, e.y); }
        if (g.abilities.reinforce <= 0 && g.enemies.some(e => e.progress > 0.85)) { const e = g.enemies.find(x => x.progress > 0.85); E.castReinforce(g, e.x, e.y); }
        if (g.castleHp < 14 && g.gold > 200) E.repairCastle(g);
        if (opts.early !== false && g.waveState === 'countdown' && g.wave >= 1 && g.countdown < g.countdownMax - 3 && g.enemies.length === 0) E.callWave(g);
      }
      E.stepGame(g, 1 / 60);
    }
    return { t: g.t, wave: g.wave, ws: g.waveState, enemies: g.enemies.length, gold: g.gold, castle: g.castleHp, phase: g.phase, towers: g.towers.map(t => t && (t.type + t.level)) };
  };
  return 'harness ready';
};
