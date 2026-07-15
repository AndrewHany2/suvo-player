// @ts-check
/**
 * PURE: resolve the stream URL to (re)play for a saved library entry.
 *
 * Prefer the URL captured when the entry was recorded; only rebuild it from the
 * entry's id via `rebuild` when none was captured.
 *
 * Why the captured URL wins: some sources (M3U playlists) key their stream URLs
 * by playlist array index (`stream_id = String(i)`), which is NOT stable across
 * sessions — providers reorder / add / remove entries, so a saved index later
 * resolves to a DIFFERENT stream, frequently a connection-limited live URL that
 * answers HTTP 409. Watch-history entries persist the exact URL they played, so
 * replaying it sidesteps the volatile id entirely. Entries that carry no url
 * (e.g. favorites) fall back to rebuilding.
 *
 * @param {{ url?: string|null } | null | undefined} entry
 * @param {() => string|null} rebuild - lazy fallback; only called when no url.
 * @returns {string|null}
 */
export function resumePlaybackUrl(entry, rebuild) {
  const captured = entry && entry.url;
  return typeof captured === "string" && captured ? captured : rebuild();
}

export default resumePlaybackUrl;
