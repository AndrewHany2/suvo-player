// Many "M3U" accounts are really an Xtream panel `get.php` playlist link
// (http://host:port/get.php?username=X&password=Y&type=m3u_plus). Such playlists
// embed short-lived, IP-bound per-stream tokens that expire — replaying them from
// the stored M3U later yields a 406. The link itself, however, carries the host +
// credentials, so we can talk to the Xtream API directly and build a fresh stream
// URL (and thus a fresh token) on every play. This parser extracts those creds.
//
// A tolerant regex is used rather than `new URL()` so it works without a URL
// polyfill on older TV/native JS engines (same reason as refererForUri).

/**
 * If `url` is an Xtream `get.php` / `player_api.php` link carrying username +
 * password, return the derived Xtream credentials; otherwise null (e.g. a plain
 * hosted `.m3u`/`.m3u8` file, which has no embedded credentials to derive).
 *
 * @param {string} url
 * @returns {{ host: string, username: string, password: string } | null}
 */
export function parseXtreamCredsFromUrl(url) {
  const clean = (url || "").trim();
  // Origin (scheme://host[:port]) + the Xtream playlist/api endpoint.
  const origin = /^(https?:\/\/[^/?#]+)/i.exec(clean);
  if (!origin) return null;
  if (!/\/(?:get|player_api)\.php\b/i.test(clean)) return null;

  const query = clean.slice(clean.indexOf("?") + 1);
  const username = matchParam(query, "username");
  const password = matchParam(query, "password");
  if (!username || !password) return null;

  return { host: origin[1], username, password };
}

/** Read a single query param value (URL-decoded), or "" if absent/empty. */
function matchParam(query, name) {
  const m = new RegExp(`(?:^|&)${name}=([^&]*)`, "i").exec(query);
  if (!m) return "";
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}
