// Pure Live TV data-shaping helpers, split out from useLiveTV so they can be
// unit-tested under plain `node --test` without loading React/RN modules.

import { normalizeSearch } from "../../utils/normalizeSearch.js";

const decodeEpgTitle = (title) => {
  try {
    return atob(title);
  } catch {
    return title;
  }
};

/**
 * Pull the "now playing" programme title out of a getShortEpg response.
 * Provider titles are base64; a missing/empty listing yields "".
 */
export function epgNowTitle(data) {
  const listing = data?.epg_listings?.[0];
  return listing ? decodeEpgTitle(listing.title) : "";
}

/**
 * Flatten a normalized channel into the flat card shape the web/native shelves
 * render ({ name, _lc, url, id, stream_id, logo }). `_lc` is the search-
 * normalized name cached once so the filter never re-normalizes per keystroke.
 * `buildUrl` is contentService.buildLiveUrl (injected so this stays pure).
 */
export function toFlatChannel(ch, buildUrl) {
  const streamId = ch.stream_id ?? ch.id;
  return {
    name: ch.name,
    _lc: normalizeSearch(ch.name),
    url: buildUrl(streamId, "m3u8"),
    id: streamId,
    stream_id: streamId,
    logo: ch.stream_icon || ch.logo || null,
  };
}

/**
 * Build the display shelves for the Live TV screen, matching a search query
 * against BOTH category names and channel names:
 *
 * - Empty query → every category, channels untouched (loaded array or `null`
 *   while still lazy-loading).
 * - Category name matches → the WHOLE category is kept (full channel list, or
 *   `null` if not loaded yet so the shelf can lazy-load and reveal everything).
 * - Otherwise → only the channels whose name matches are kept, and categories
 *   left with no matching channels are dropped.
 *
 * `channelsFor(cat)` returns that category's channel array, or a nullish value
 * while its channels are still loading. Kept pure (no React/RN) so the two
 * LiveTV screen variants share one tested implementation.
 */
export function filterCategoriesBySearch(categories, query, channelsFor) {
  const q = normalizeSearch(query);
  if (!q) {
    return categories.map((cat) => ({ ...cat, channels: channelsFor(cat) ?? null }));
  }
  const out = [];
  for (const cat of categories) {
    if (normalizeSearch(cat.name).includes(q)) {
      // Preserve `null` so an unloaded name-matched shelf still lazy-loads.
      out.push({ ...cat, channels: channelsFor(cat) ?? null });
      continue;
    }
    const matched = (channelsFor(cat) || []).filter((ch) =>
      (ch._lc ?? normalizeSearch(ch.name)).includes(q),
    );
    if (matched.length) out.push({ ...cat, channels: matched });
  }
  return out;
}
