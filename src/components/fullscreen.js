/* ------------------------------------------------------------------ *
 * Shared fullscreen helper for the games.
 *
 * Uses the Fullscreen API where a browser has it (standard or the
 * WebKit-prefixed form on iPad Safari). Where it is missing or refused
 * — iPhone Safari, some embedded browsers — the game falls back to a
 * "pseudo" fullscreen: the caller pins its element over the page with
 * CSS and this module locks page scrolling, so the experience is as
 * close as the platform allows without breaking the page.
 * ------------------------------------------------------------------ */

export function fullscreenElement() {
  if (typeof document === "undefined") return null;
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

export function fullscreenSupported(el) {
  return !!(el && (el.requestFullscreen || el.webkitRequestFullscreen));
}

export function requestFullscreen(el) {
  const fn = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!fn) return Promise.reject(new Error("fullscreen unsupported"));
  try {
    const r = fn.call(el, { navigationUI: "hide" });
    return r && typeof r.then === "function" ? r : Promise.resolve();
  } catch (err) {
    return Promise.reject(err);
  }
}

export function exitFullscreen() {
  const fn = document.exitFullscreen || document.webkitExitFullscreen;
  if (!fn) return Promise.resolve();
  try {
    const r = fn.call(document);
    return r && typeof r.then === "function" ? r : Promise.resolve();
  } catch (err) {
    return Promise.reject(err);
  }
}

/* Subscribe to both event spellings; returns an unsubscribe. */
export function onFullscreenChange(cb) {
  document.addEventListener("fullscreenchange", cb);
  document.addEventListener("webkitfullscreenchange", cb);
  return () => {
    document.removeEventListener("fullscreenchange", cb);
    document.removeEventListener("webkitfullscreenchange", cb);
  };
}

let lockCount = 0;
let savedOverflow = null;
let savedScroll = 0;

/* Lock page scrolling for pseudo fullscreen. Counted so two games
   toggling in one session cannot leave the page stuck. */
export function lockPageScroll() {
  if (typeof document === "undefined") return;
  if (lockCount === 0) {
    savedScroll = window.scrollY;
    savedOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    window.scrollTo(0, 0);
  }
  lockCount += 1;
}

export function unlockPageScroll() {
  if (typeof document === "undefined" || lockCount === 0) return;
  lockCount -= 1;
  if (lockCount === 0) {
    document.documentElement.style.overflow = savedOverflow || "";
    document.body.style.overscrollBehavior = "";
    window.scrollTo(0, savedScroll);
  }
}

/* One call that does the right thing for a game wrapper element.
   state: { real: boolean, pseudo: boolean }; returns the next state
   via the callbacks so React can store it. */
export function toggleGameFullscreen(el, state, setState) {
  if (!el) return;
  if (state.pseudo) {
    unlockPageScroll();
    setState({ real: false, pseudo: false });
    return;
  }
  if (fullscreenElement()) {
    exitFullscreen().catch(() => {});
    return;
  }
  if (fullscreenSupported(el)) {
    requestFullscreen(el).catch(() => {
      lockPageScroll();
      setState({ real: false, pseudo: true });
    });
    return;
  }
  lockPageScroll();
  setState({ real: false, pseudo: true });
}
