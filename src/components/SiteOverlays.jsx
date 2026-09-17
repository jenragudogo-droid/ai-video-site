import { Suspense, useEffect, useRef } from "react";
import { parseVideoSource } from "../siteMedia.js";

/* ------------------------------------------------------------------ *
 * The two screens that open over the site: a game, and a video.
 *
 * Neither uses a CSS transform, because a transformed ancestor would
 * break a game's position:fixed fullscreen.
 * ------------------------------------------------------------------ */

/* The page behind must not scroll while either is open. This is a class
   on <html> rather than the games' own counted scroll lock: a game can
   go fullscreen and back inside the shell, and a game releases that lock
   twice on the way out, which would free the page with the shell still
   open. overflow:hidden also leaves the page exactly where it was, so
   closing lands you back on the card you came from. */
let holds = 0;
function holdPage() {
  holds += 1;
  document.documentElement.classList.add("siteOverlayOpen");
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds = Math.max(0, holds - 1);
    if (holds === 0) document.documentElement.classList.remove("siteOverlayOpen");
  };
}

export function GameShell({ game, onClose }) {
  const stage = useRef(null);

  useEffect(() => {
    const release = holdPage();
    /* Focus goes to the stage, not the Back button: every game takes
       Space and Enter from the window, and a focused Back button would
       turn "call the next wave" into "leave the game". */
    stage.current?.focus({ preventScroll: true });
    return release;
  }, []);

  const Game = game.Component;
  return (
    <div className="gameShell" role="dialog" aria-modal="true" aria-labelledby="game-shell-title">
      <div className="gameShellBar">
        <button type="button" className="gameShellBack" onClick={onClose} aria-label="Back to games">
          <span className="gameShellArrow" aria-hidden="true">‹</span>
          <span>Games</span>
        </button>
        <h2 className="gameShellTitle" id="game-shell-title">{game.title}</h2>
      </div>
      <div className="gameShellStage" ref={stage} tabIndex={-1}>
        <Suspense fallback={<div className="gameLoading">{game.loading}</div>}>
          <Game />
        </Suspense>
      </div>
    </div>
  );
}

export function VideoModal({ video, onClose }) {
  const closeButton = useRef(null);
  const media = parseVideoSource(video.src);
  /* Portrait videos get a portrait player: a Short inside a widescreen
     box is a thin strip, and on a phone that wasted most of the screen. */
  const [aspectW, aspectH] = video.aspect || [16, 9];

  useEffect(() => {
    const release = holdPage();
    closeButton.current?.focus({ preventScroll: true });
    /* Escape is safe here; the game shell leaves it to the games, which
       all use it to pause. */
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      release();
    };
  }, [onClose]);

  return (
    <div
      className="videoModal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="video-modal-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="videoModalPanel" style={{ "--videoW": aspectW, "--videoH": aspectH }}>
        <div className="videoModalHead">
          <div className="videoModalHeading">
            <span className="videoModalLabel">{video.label}</span>
            <h2 id="video-modal-title">{video.title}</h2>
          </div>
          <button ref={closeButton} type="button" className="videoModalClose" onClick={onClose} aria-label="Close video">
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div className="videoModalPlayer">
          {media.kind === "youtube" && (
            <iframe
              key={media.id}
              src={media.embed}
              title={`${video.title} video`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          )}
          {media.kind === "file" && (
            <video key={media.src} src={media.src} controls autoPlay playsInline preload="auto" />
          )}
          {(media.kind === "link" || media.kind === "none") && (
            <div className="videoModalFallback">
              <p>This video can’t be played here.</p>
              {media.href && <a href={media.href} target="_blank" rel="noreferrer">Open the video</a>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
