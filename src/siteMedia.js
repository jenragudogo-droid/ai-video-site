/* ------------------------------------------------------------------ *
 * Helpers for the site's video previews and overlay routes.
 *
 * No React in here, so node can test them directly. A card's video may
 * be any YouTube URL (embed, watch, youtu.be, shorts, live) or a hosted
 * file; everything else is treated as a plain link rather than a
 * player that silently fails.
 * ------------------------------------------------------------------ */

const YOUTUBE_HOST = /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/i;
const YOUTUBE_ID = /^[\w-]{6,20}$/;
const VIDEO_FILE = /\.(mp4|m4v|webm|mov|ogv)$/i;

/* "90", "1m30s" or "1h2m3s" as seconds; anything else as no offset */
function toSeconds(value) {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Number(value);
  const m = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m) return 0;
  return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
}

/* What kind of player a card's `src` needs:
   { kind: "youtube", id, embed, poster, href }
   { kind: "file", src }
   { kind: "link", href }   // a URL we cannot embed
   { kind: "none" }         // nothing to play yet */
export function parseVideoSource(src) {
  if (!src || typeof src !== "string") return { kind: "none" };
  let url;
  try {
    url = new URL(src, "https://kianimationstudio.com/");
  } catch {
    return { kind: "none" };
  }
  const host = url.hostname.replace(/^(www|m)\./i, "");
  if (YOUTUBE_HOST.test(host)) {
    const parts = url.pathname.split("/").filter(Boolean);
    let id = null;
    if (/youtu\.be$/i.test(host)) id = parts[0];
    else if (["embed", "shorts", "live", "v"].includes(parts[0])) id = parts[1];
    else if (parts[0] === "watch") id = url.searchParams.get("v");
    if (!id || !YOUTUBE_ID.test(id)) return { kind: "link", href: url.href };
    /* Built from the id rather than passed through, so share-tracking
       parameters are dropped and autoplay is always asked for: the
       player only ever opens because someone pressed play. */
    const params = new URLSearchParams({ autoplay: "1", playsinline: "1", rel: "0" });
    const start = toSeconds(url.searchParams.get("start") || url.searchParams.get("t"));
    if (start) params.set("start", String(start));
    return {
      kind: "youtube",
      id,
      embed: `https://www.youtube.com/embed/${id}?${params}`,
      poster: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      href: `https://www.youtube.com/watch?v=${id}`,
    };
  }
  if (VIDEO_FILE.test(url.pathname)) return { kind: "file", src };
  return { kind: "link", href: url.href };
}

/* "#play/castle-defender" read with prefix "play" gives "castle-defender" */
export function readHashRoute(hash, prefix) {
  if (!hash) return null;
  const m = hash.match(/^#([\w-]+)\/([\w-]+)$/);
  return m && m[1] === prefix ? m[2] : null;
}
