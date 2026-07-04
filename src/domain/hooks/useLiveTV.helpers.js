// Pure Live TV data-shaping helpers, split out from useLiveTV so they can be
// unit-tested under plain `node --test` without loading React/RN modules.

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
 * render ({ name, _lc, url, id, stream_id, logo }). `_lc` is the lowercased name
 * cached once so the search filter never re-lowercases per keystroke.
 * `buildUrl` is contentService.buildLiveUrl (injected so this stays pure).
 */
export function toFlatChannel(ch, buildUrl) {
  const streamId = ch.stream_id ?? ch.id;
  return {
    name: ch.name,
    _lc: (ch.name || "").toLowerCase(),
    url: buildUrl(streamId, "m3u8"),
    id: streamId,
    stream_id: streamId,
    logo: ch.stream_icon || ch.logo || null,
  };
}
