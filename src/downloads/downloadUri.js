export const DEFAULT_EXT = 'mp4';

/**
 * Build the remote stream URL to download for `item`.
 *
 * `source` is the active ContentService (whose `.api` is the live Xtream or M3U
 * backend, swapped per account in configure()) — or, for tests, a raw api. We
 * resolve `.api` HERE, at download time, not when the provider mounts, so an
 * M3U account downloads from its playlist URL instead of a stale Xtream URL
 * built from whichever credentials iptvApi last held.
 */
export function remoteUrlFor(source, item) {
  const api = source?.api ?? source;
  const ext = item.ext || DEFAULT_EXT;
  if (item.kind === 'movie') return api.buildStreamUrl('movie', item.streamId, ext);
  return api.buildStreamUrl('series', item.episodeStreamId, ext);
}

export function localPathFor(id, ext, dir) {
  const safe = String(id).replace(/:/g, '_');
  return `${dir}downloads/${safe}.${ext || DEFAULT_EXT}`;
}

/**
 * Re-derive a download's local file URI against the CURRENT documentDirectory.
 *
 * The download filename is a pure function of (id, ext) — see localPathFor — so
 * the only variable in a stored localPath is the directory prefix. On iOS that
 * prefix is the app container (`.../Application/<UUID>/Documents/`), whose UUID
 * changes on every reinstall, OS update, and dev rebuild; a persisted absolute
 * path therefore goes stale and points into a dead container. Never trust the
 * stored prefix: rebuild the path from the live documentDirectory at read time.
 *
 * Returns null when documentDirectory is falsy (e.g. web, where there is no
 * local file store), so callers fall back to streaming.
 *
 * @param {{id:string, ext?:string}} rec
 * @param {string|undefined|null} documentDirectory
 * @returns {string|null}
 */
export function currentLocalUri(rec, documentDirectory) {
  if (!documentDirectory || !rec) return null;
  return localPathFor(rec.id, rec.ext, documentDirectory);
}

/**
 * Return a new records map with every record's localPath re-derived against the
 * current documentDirectory (see currentLocalUri). No-op (returns the input) when
 * documentDirectory is falsy. Does not mutate the input map or its records.
 *
 * @param {Record<string, {id:string, ext?:string, localPath?:string}>} map
 * @param {string|undefined|null} documentDirectory
 */
export function normalizeLocalPaths(map, documentDirectory) {
  if (!documentDirectory || !map) return map;
  const out = {};
  for (const [id, rec] of Object.entries(map)) {
    out[id] = { ...rec, localPath: currentLocalUri(rec, documentDirectory) };
  }
  return out;
}
