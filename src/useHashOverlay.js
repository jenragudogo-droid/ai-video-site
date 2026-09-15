import { useCallback, useEffect, useRef, useState } from "react";
import { readHashRoute } from "./siteMedia.js";

/* ------------------------------------------------------------------ *
 * One full-screen overlay addressed by the URL: #play/castle-defender,
 * #watch/alien-visits-accra.
 *
 * Opening pushes a history entry, so a phone's back button closes the
 * game or video the way it closes an app screen instead of leaving the
 * site, and a shared link opens straight into it. `ids` must be a
 * stable array; `homeId` is the section to land on when an overlay
 * opened from a shared link is closed and there is no page behind it.
 * ------------------------------------------------------------------ */
export function useHashOverlay(prefix, ids, homeId) {
  const [id, setId] = useState(() => {
    if (typeof window === "undefined") return null;
    const v = readHashRoute(window.location.hash, prefix);
    return v && ids.includes(v) ? v : null;
  });
  const pushed = useRef(false);     // we added the history entry being shown
  const trigger = useRef(null);     // the button that opened it
  const landHome = useRef(false);   // closed from a shared link: show the section

  useEffect(() => {
    const sync = () => {
      const v = readHashRoute(window.location.hash, prefix);
      const next = v && ids.includes(v) ? v : null;
      if (!next) pushed.current = false;
      setId(next);
    };
    window.addEventListener("popstate", sync);
    window.addEventListener("hashchange", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("hashchange", sync);
    };
  }, [prefix, ids]);

  /* Runs after the overlay has unmounted and released the page, so
     focus and any scroll happen on the page as it was left. */
  useEffect(() => {
    if (id !== null) return;
    if (landHome.current) {
      landHome.current = false;
      document.getElementById(homeId)?.scrollIntoView();
    }
    const el = trigger.current;
    trigger.current = null;
    if (el && el.isConnected) el.focus({ preventScroll: true });
  }, [id, homeId]);

  const open = useCallback((next) => {
    if (!ids.includes(next)) return;
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.history.pushState({ overlay: prefix }, "", `#${prefix}/${next}`);
    pushed.current = true;
    setId(next);
  }, [prefix, ids]);

  const close = useCallback(() => {
    if (pushed.current && window.history.state && window.history.state.overlay === prefix) {
      window.history.back();          // popstate closes it
      return;
    }
    pushed.current = false;
    landHome.current = true;
    window.history.replaceState(null, "", `#${homeId}`);
    setId(null);
  }, [prefix, homeId]);

  return [id, open, close];
}
