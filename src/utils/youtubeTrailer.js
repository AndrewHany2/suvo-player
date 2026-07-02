/**
 * Resolve a raw YouTube reference (an id, or a watch/youtu.be/embed URL) to a
 * playable URL, or null if it isn't a valid 11-char id.
 *
 * Two variants: native players want a `watch?v=` URL; web/TV embeds want the
 * privacy-friendly nocookie `embed/` URL.
 */
function resolve(t, base) {
  if (!t) return null;
  const m = t.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/);
  if (m) return `${base}${m[1]}`;
  const id = t.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(id)) return `${base}${id}`;
  return null;
}

export const getTrailerWatchUrl = (t) => resolve(t, "https://www.youtube.com/watch?v=");
export const getTrailerEmbedUrl = (t) => resolve(t, "https://www.youtube-nocookie.com/embed/");
