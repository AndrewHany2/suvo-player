// @ts-check
// Pure helper for the hls.js loader `file://` fix. Kept as its own leaf module
// (no hls.js / DOM imports) so the base-URL rule is unit-testable under plain
// `node --test`.
//
// THE BUG IT FIXES: on the TV the app runs from a `file://` page. hls.js's
// `getResponseUrl` only falls back to the request URL when the response URL is
// `undefined`:
//
//     if (url === undefined || url.indexOf('data:') === 0) url = context.url;
//
// but webOS's older engine returns an *empty string* for `response.url` after a
// redirect (Xtream `/live/…/<id>.m3u8` commonly 302s to a different backend
// feed). An empty string passes that guard, so hls.js resolves the playlist's
// relative segment URLs against the `file://` document → unfetchable `file:///…`
// URLs → webOS refuses them → hls.js retries forever → black video + endless
// spinner with no fatal error. Providers whose playlists carry absolute http
// URLs are unaffected, which is why one account plays and another hangs.
//
// The fix: coerce an empty/relative response URL to the http request URL before
// hls.js reads it, so relative segments resolve against http, never `file://`.

/**
 * Effective base URL for resolving a playlist's relative child/segment URLs.
 * Prefer the real (post-redirect) response URL when the engine populates it;
 * fall back to the request URL when it is missing, empty, or itself a
 * non-absolute (scheme-less) value that would otherwise resolve against the
 * `file://` document.
 *
 * @param {unknown} responseUrl the loader's response URL (may be "" on webOS)
 * @param {unknown} requestUrl  the original request URL (absolute http[s])
 * @returns {string}
 */
export function effectiveResponseUrl(responseUrl, requestUrl) {
  const res = typeof responseUrl === 'string' ? responseUrl : '';
  const req = typeof requestUrl === 'string' ? requestUrl : '';
  // Absolute (has a scheme) → trust it as-is. Otherwise it can't be used as a
  // base without dragging in the file:// document origin, so use the request.
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(res) ? res : req;
}

export default effectiveResponseUrl;
