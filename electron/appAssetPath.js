const path = require("path");

// net::ERR_FILE_NOT_FOUND — returned to the protocol callback when a request
// resolves outside the served root. Kept as a named constant so the intent
// ("pretend it isn't there") is obvious at the call site.
const ERR_FILE_NOT_FOUND = -6;

/**
 * Resolve an `app://` request URL to an absolute file path INSIDE `distPath`,
 * refusing anything that escapes it.
 *
 * `app://` is a privileged standard scheme, so the URL parser already normalizes
 * dot-segments in the pathname — but this is the process's file server, so it
 * gets an explicit containment check regardless (defense in depth): a crafted or
 * percent-encoded path must never read arbitrary disk. Returns `{ path }` for an
 * allowed asset or `{ error }` (a net error code) for an escape attempt.
 *
 * @param {string} distPath  absolute path to the built-assets root
 * @param {string} requestUrl  the full app:// request URL
 * @returns {{ path: string } | { error: number }}
 */
function resolveAppAssetPath(distPath, requestUrl) {
  let pathname;
  try {
    ({ pathname } = new URL(requestUrl));
  } catch {
    return { error: ERR_FILE_NOT_FOUND };
  }

  // decodeURIComponent so assets with encoded chars (spaces, unicode) resolve;
  // strip leading slashes so path.join treats it as relative to distPath.
  let rel;
  try {
    rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  } catch {
    // Malformed percent-encoding (e.g. a lone "%") — treat as not found.
    return { error: ERR_FILE_NOT_FOUND };
  }

  const resolved = path.normalize(path.join(distPath, rel));
  // Containment: the resolved path must sit under distPath + separator. Appending
  // the separator prevents a sibling like `dist-secrets/` from matching `dist`.
  const root = path.normalize(distPath) + path.sep;
  if (!resolved.startsWith(root)) {
    return { error: ERR_FILE_NOT_FOUND };
  }
  return { path: resolved };
}

module.exports = { resolveAppAssetPath, ERR_FILE_NOT_FOUND };
