// Defense-in-depth scrub for admin_audit `meta`. The admin function's call sites
// already avoid logging secrets, but a future edit could accidentally pass a
// password / token / IPTV-line credential into audit(). This strips any such key
// (recursively) before the row is written, so admin_audit can never carry a
// secret regardless of caller mistakes. No I/O and no imports → runs under BOTH
// the Deno edge runtime and node:test.

// Substrings matched against each key after lowercasing and removing
// non-alphanumerics — so "API_KEY", "access_token", "password_hash" all match.
const FORBIDDEN = ["password", "passwd", "pwd", "secret", "token", "apikey", "authorization", "credential"];

function isForbiddenKey(key) {
  const norm = String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
  return FORBIDDEN.some((f) => norm.includes(f));
}

/**
 * Return a copy of `meta` with any secret-bearing keys removed (recursively).
 * Non-objects (null / undefined / primitives) are returned unchanged.
 * @param {unknown} meta
 * @returns {unknown}
 */
export function scrubAuditMeta(meta) {
  if (meta === null || typeof meta !== "object") return meta;
  if (Array.isArray(meta)) return meta.map(scrubAuditMeta);
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    if (isForbiddenKey(k)) continue;
    out[k] = scrubAuditMeta(v);
  }
  return out;
}
