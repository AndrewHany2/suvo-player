// Pure helpers for the `login` Edge Function's brute-force throttle. No I/O and
// no imports, so they run under BOTH the Deno edge runtime and node:test.
//
// Why this exists: `login` checks the password server-side, so GoTrue sees the
// function's egress IP — its per-IP brute-force limit can't protect an account.
// We re-establish throttling here against a Postgres fixed-window counter
// (hit_login_rate_limit).

// Fixed-window limits (seconds). IP mirrors GoTrue's stock 30 / 5 min per-IP so
// we don't regress legitimate shared-NAT users; the tighter per-email limit is
// the real protection — it survives IP rotation (spraying one account from many
// IPs still trips it).
export const IP_MAX = 30;
export const EMAIL_MAX = 10;
export const WINDOW_SECONDS = 300;

export const RATE_LIMITED_MESSAGE =
  "Too many sign-in attempts. Please wait a few minutes and try again.";

// Best-effort client IP. Supabase routes the real client IP in x-forwarded-for
// (comma-separated; leftmost = original client) with x-real-ip as a fallback.
// A hostile client can spoof it, but the per-email limit backstops a spoofed IP.
// `headers` is a Headers-like object exposing .get(name).
export function clientIpFromHeaders(headers) {
  const xff = headers?.get?.("x-forwarded-for") || "";
  const first = String(xff).split(",")[0].trim();
  if (first) return first;
  const real = String(headers?.get?.("x-real-ip") || "").trim();
  return real || "unknown";
}

// The keys to throttle a single attempt against. Namespaced so an IP and an
// email that happen to share a string can't collide on the same counter row.
export function loginRateLimitKeys(ip, email) {
  const normEmail = String(email ?? "").trim().toLowerCase();
  const normIp = String(ip ?? "").trim() || "unknown";
  return [
    { key: `ip:${normIp}`, max: IP_MAX, windowSeconds: WINDOW_SECONDS },
    { key: `email:${normEmail}`, max: EMAIL_MAX, windowSeconds: WINDOW_SECONDS },
  ];
}
