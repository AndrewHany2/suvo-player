// Poster URL resolution + cache-warming for TV shelves.
//
// TV browsers (webOS/Tizen) only start fetching an <img> when its card mounts,
// so every newly-revealed poster flashes blank while it downloads + decodes.
// prefetchImage() kicks off that work BEFORE the card mounts, and the bounded
// ring holds Image refs so already-decoded posters aren't evicted on scroll-back
// (browser memory cache keeps them → remount paints instantly).

/** cover-first (Home/Series art), falling through to Movies catalog icons. */
export const posterUrl = (item) =>
  item?.cover || item?.stream_icon || item?.movie_image || null;

const seen = new Set();
const ring = [];
const MAX = 120; // ~a few screens of posters; caps memory on the TV floor

export function prefetchImage(url) {
  if (!url || seen.has(url)) return;
  seen.add(url);
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  ring.push({ url, img });
  if (ring.length > MAX) seen.delete(ring.shift().url);
}
