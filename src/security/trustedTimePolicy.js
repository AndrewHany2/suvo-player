// Pure, I/O-free decision core for the build-time deadline check — the first
// part of the security/ three-part shape (policy -> wrapper -> hook), mirroring
// integrityPolicy -> deviceIntegrity -> useDeviceIntegrity. Everything here is
// synchronous and node:test-able; the async fetch/storage lives in the wrapper
// (trustedTime.js).
//
// The threat it defends against: a device clock the user controls. We never
// trust the local clock to decide the deadline — we anchor on a network time
// source and a persisted high-water-mark (HWM) that only ever moves forward
// from a *trusted* reading, so rolling the device clock back can't buy time.

// A reading is "plausible" only inside a sane calendar window — this rejects an
// epoch-0 / 1970 default, a garbage parse, and an absurd far-future value. The
// bounds are exclusive so the exact boundary instants don't slip through.
const MIN_MS = Date.UTC(2020, 0, 1);
const MAX_MS = Date.UTC(2100, 0, 1);

export function isPlausibleEpochMs(ms) {
  return Number.isFinite(ms) && ms > MIN_MS && ms < MAX_MS;
}

// The HTTP `Date` response header is always an RFC 9110 IMF-fixdate in GMT
// (e.g. "Wed, 22 Jul 2026 00:00:00 GMT"), which Date.parse handles directly.
// Returns epoch ms, or null when absent / unparseable / implausible.
export function parseHttpDate(headerValue) {
  if (headerValue == null) return null;
  const ms = Date.parse(String(headerValue));
  return isPlausibleEpochMs(ms) ? ms : null;
}

// Cloudflare's /cdn-cgi/trace body is a set of `key=value` lines including
// `ts=<unix-seconds>` with a fractional part (e.g. "ts=1753142400.5"). Pull it
// out and convert to ms. Returns null when absent / implausible.
export function parseCloudflareTraceTs(bodyText) {
  if (bodyText == null) return null;
  const m = /(?:^|[\n&])ts=([0-9]+(?:\.[0-9]+)?)/.exec(String(bodyText));
  if (!m) return null;
  const ms = Math.round(Number(m[1]) * 1000);
  return isPlausibleEpochMs(ms) ? ms : null;
}

/**
 * The whole deadline decision, as a pure function.
 *
 * @param {object} p
 * @param {number} p.nowMs           the (untrusted) device clock, `Date.now()`
 * @param {number|null} p.networkMs  a trusted network time, or null when offline
 * @param {number|null} p.hwmMs      the persisted high-water-mark, or null if none yet
 * @param {number} p.expiryMs        the baked-in deadline
 * @param {"open"|"closed"} [p.offlinePolicy]  behavior when unverifiable (default "open" = fail open)
 * @param {number} [p.skewToleranceMs]         rollback slack (default 5 min)
 * @param {boolean} [p.everBootstrapped]  has the app EVER recorded a trusted
 *   reading (HWM or first-seen)? Default true so existing callers are
 *   unaffected. When false AND offline, we fail CLOSED: a fresh install that has
 *   never verified time must not get unlimited offline grace from launch #1
 *   (the cheapest demo bypass — block the two time hosts before first run).
 * @returns {{ expired:boolean, trusted:boolean, rollbackDetected:boolean,
 *             effectiveMs:number, monotonicMs:number, newHwmMs:number, reason:string }}
 */
export function evaluateExpiry({
  nowMs,
  networkMs,
  hwmMs,
  expiryMs,
  offlinePolicy = "open",
  skewToleranceMs = 5 * 60 * 1000,
  everBootstrapped = true,
}) {
  // A finite networkMs is the only thing we trust; null/NaN => offline.
  const trusted = Number.isFinite(networkMs);
  const effectiveMs = trusted ? networkMs : nowMs;

  const hasHwm = Number.isFinite(hwmMs);
  // Monotonic floor: the clock can never appear earlier than the furthest point
  // we've already seen, so time only moves forward from the app's perspective.
  const monotonicMs = Math.max(effectiveMs, hasHwm ? hwmMs : -Infinity);
  // A clock reading meaningfully below the HWM is tamper evidence (a rollback),
  // not benign NTP jitter — the skew tolerance absorbs the latter.
  const rollbackDetected = hasHwm && effectiveMs < hwmMs - skewToleranceMs;

  // Base decision: has the monotonic floor reached the deadline?
  let expired = monotonicMs >= expiryMs;
  let reason;
  if (trusted) {
    reason = expired ? "past" : "ok";
  } else if (rollbackDetected) {
    expired = true; // fail CLOSED on tamper evidence
    reason = "rollback";
  } else if (!everBootstrapped) {
    expired = true; // fail CLOSED: offline and never once verified time
    reason = "offline-unbootstrapped";
  } else if (offlinePolicy !== "open") {
    expired = true; // fail CLOSED when policy forbids running unverified
    reason = "offline-closed";
  } else {
    // Benign offline: fail OPEN — but the floor check above still stands, so a
    // deadline already crossed by a trusted reading (or the honest device clock)
    // keeps it locked.
    reason = expired ? "past-offline" : "offline";
  }

  // The HWM advances ONLY from a trusted reading — never from the device clock —
  // so an accidentally- (or maliciously-) future device clock can't permanently
  // poison the stored floor.
  const newHwmMs = trusted
    ? Math.max(hasHwm ? hwmMs : 0, networkMs)
    : hasHwm
      ? hwmMs
      : 0;

  return { expired, trusted, rollbackDetected, effectiveMs, monotonicMs, newHwmMs, reason };
}
