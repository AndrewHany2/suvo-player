// Async wrapper around the pure trusted-time policy (trustedTimePolicy.js).
// Third part of the security/ three-part shape (policy -> wrapper -> hook),
// mirroring integrityPolicy -> deviceIntegrity -> useDeviceIntegrity.
//
// It fetches an independent, network-sourced clock reading (so a device with a
// hand-set/rolled-back clock can't fool the deadline check), feeds it to the
// pure `evaluateExpiry` decision, and persists the advancing high-water-mark so
// the monotonic floor survives across launches. Storage keys are deliberately
// generic (Hermes preserves the string table in cleartext, so no telltale
// literals live in the shipped bundle).
import AsyncStorage from '../utils/storage';
import { demoExpiryMs } from '../config/demoExpiry';
import {
  isPlausibleEpochMs,
  parseHttpDate,
  parseCloudflareTraceTs,
  evaluateExpiry,
} from './trustedTimePolicy';

// TMDB coordinates, mirrored from src/services/tmdbApi.js (those consts are
// module-local there, not exported). The API key gates the primary provider:
// no key => skip TMDB and fall through to Cloudflare.
const TMDB_BASE = 'https://api.themoviedb.org/3';
const API_KEY = process.env.EXPO_PUBLIC_TMDB_API_KEY || null;

// Generic storage keys (see file header on why these avoid descriptive words).
const HWM_KEY = 'iptv_t_hwm'; // high-water-mark epoch ms, stored as a string
const SEEN_KEY = 'iptv_t_seen'; // first trusted observation, diagnostics only

// One GET wrapped in the timeout discipline copied from iptvApi.js `_fetchOnce`
// (~lines 300-376): an AbortController plus a setTimeout that BOTH aborts the
// request AND rejects on its own, raced via Promise.race. Some React Native
// fetch engines don't reject a hung request when its AbortController fires, so
// relying on abort alone lets a stalled provider hang forever; racing against
// the timer guarantees settlement. `read` receives the resolved Response and
// returns the parsed ms (or null) — for providers that read the body, that read
// is inside the raced request so a slow body also honors the deadline.
async function raceFetch(url, read, { timeoutMs, signal }) {
  const controller = new AbortController();
  let timedOut = false;
  let timer;
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    const request = (async () => {
      // no-store + a cache-bust query param so a caching layer (or a stale SW
      // on web/Electron) can never hand back an old response with an old Date.
      const res = await globalThis.fetch(url, { method: 'GET', cache: 'no-store', signal: controller.signal });
      return read(res);
    })();
    // Swallow a late rejection from the losing branch so a request that rejects
    // just after the deadline won't surface as an unhandled rejection.
    request.catch(() => {});
    return await Promise.race([request, deadline]);
  } catch (e) {
    if (timedOut) throw new Error(`Request timed out after ${timeoutMs}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

// Provider 1 (primary): TMDB. Already integrated app-wide; it sets
// `access-control-expose-headers: *` so the Date header is readable on
// web/Electron/TV as well as native.
async function fetchTmdbTimeMs(nonce, opts) {
  if (!API_KEY) return null; // no key => skip, let the fallback handle it
  const url = `${TMDB_BASE}/configuration?api_key=${API_KEY}&_cb=${nonce}`;
  return raceFetch(url, (res) => parseHttpDate(res.headers.get('date')), opts);
}

// Provider 2 (fallback): Cloudflare's key-free trace endpoint. Independent
// operator; `access-control-allow-origin: *` so the body is readable everywhere.
async function fetchCloudflareTimeMs(nonce, opts) {
  const url = `https://cloudflare.com/cdn-cgi/trace?_cb=${nonce}`;
  return raceFetch(url, async (res) => parseCloudflareTraceTs(await res.text()), opts);
}

// Try providers in order; return the first plausible ms, or null if all fail
// (all failing == treat as offline, which evaluateExpiry handles per policy).
export async function fetchNetworkTimeMs({ timeoutMs = 4000, signal } = {}) {
  const providers = [fetchTmdbTimeMs, fetchCloudflareTimeMs];
  for (const provider of providers) {
    if (signal?.aborted) break;
    const nonce = Date.now(); // runtime nonce is fine; not a build-time literal
    try {
      const ms = await provider(nonce, { timeoutMs, signal });
      if (isPlausibleEpochMs(ms)) return ms;
    } catch {
      // timeout / network / parse failure — fall through to the next provider
    }
  }
  return null;
}

async function readHwmMs() {
  try {
    const raw = await AsyncStorage.getItem(HWM_KEY);
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

// Persist the advancing high-water-mark and (once) the first trusted reading.
// The HWM is written ONLY when it strictly advances to a plausible epoch, so an
// offline pass (newHwmMs === prior hwm) and a null/0 seed never trigger a write.
async function persistObservation({ hwmMs, networkMs, result }) {
  try {
    if (isPlausibleEpochMs(result.newHwmMs) && result.newHwmMs > (hwmMs ?? -Infinity)) {
      await AsyncStorage.setItem(HWM_KEY, String(result.newHwmMs));
    }
    if (result.trusted && isPlausibleEpochMs(networkMs)) {
      const seen = await AsyncStorage.getItem(SEEN_KEY);
      if (seen == null) await AsyncStorage.setItem(SEEN_KEY, String(networkMs));
    }
  } catch {
    // Diagnostics/persistence is best-effort; never let a storage error throw.
  }
}

// The full runtime decision: read the stored floor, get a trusted network clock
// (or null when offline), run the pure policy, persist the advanced floor, and
// hand the caller only what it needs to gate on.
export async function isDemoExpired({
  offlinePolicy = 'open',
  skewToleranceMs = 5 * 60 * 1000,
  timeoutMs = 4000,
  signal,
} = {}) {
  const expiryMs = demoExpiryMs();
  // Not a time-limited build => feature off. Short-circuit with NO network call.
  if (expiryMs == null) return { expired: false, trusted: false, rollbackDetected: false, reason: 'off' };

  const hwmMs = await readHwmMs();
  const networkMs = await fetchNetworkTimeMs({ timeoutMs, signal });
  const result = evaluateExpiry({
    nowMs: Date.now(),
    networkMs,
    hwmMs,
    expiryMs,
    offlinePolicy,
    skewToleranceMs,
  });
  await persistObservation({ hwmMs, networkMs, result });
  return {
    expired: result.expired,
    trusted: result.trusted,
    rollbackDetected: result.rollbackDetected,
    reason: result.reason,
  };
}
