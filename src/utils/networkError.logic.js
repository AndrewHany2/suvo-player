// Pure, client-free classification for "can't reach the server" failures, so the
// login path and every content screen can tell a reachability fault apart from a
// real error (auth / provider) and show honest copy. Kept as a .logic.js
// (CommonJS) so it's unit-testable under `node --test` and requireable from
// loginResult.logic.js (which is also CommonJS).

// Shown when the failure is pure connectivity (no useful provider detail).
const CONNECTIVITY_MESSAGE =
  "Can't reach the server. Check your internet connection and try again.";

// Cloudflare origin-unreachable family (520–524, incl. the 521 that started this)
// plus the classic gateway 5xx set. A response in this range means the edge
// couldn't reach the origin — i.e. a reachability problem, not a real answer.
const GATEWAY_STATUSES = new Set([502, 503, 504, 520, 521, 522, 523, 524]);

// Extract a numeric HTTP/provider status from the shapes errors take here:
//  - `.status`         — provider error-envelope rejections set this
//  - `.context.status` — supabase FunctionsHttpError carries the Response here
//  - "status: N" text  — what iptvApi throws ("HTTP error! status: 521")
function errorStatus(err) {
  if (!err) return null;
  if (Number.isFinite(err.status)) return err.status;
  const ctx = err.context && err.context.status;
  if (Number.isFinite(ctx)) return ctx;
  const m = /status:\s*(\d+)/i.exec(err.message || "");
  return m ? Number(m[1]) : null;
}

// True when the failure means the server was unreachable (network down, DNS,
// timeout, connection reset, or a gateway 5xx like 521) rather than a response
// the server chose to send. A provider error-envelope (a 200 whose body is an
// error) means the server WAS reachable, so it is never connectivity.
function isConnectivityError(err) {
  if (!err || err.providerError) return false;
  const name = err.name || "";
  if (name === "FunctionsFetchError" || name === "FunctionsRelayError") return true;
  const status = errorStatus(err);
  if (status && GATEWAY_STATUSES.has(status)) return true;
  const msg = (err.message || "").toLowerCase();
  if (/failed to fetch|network request failed|networkerror|load failed|fetch failed/.test(msg)) return true;
  if (name === "AbortError") return true;
  if (/timed out|timeout|etimedout|econnrefused|econnreset|enotfound|network error/.test(msg)) return true;
  return false;
}

module.exports = { CONNECTIVITY_MESSAGE, GATEWAY_STATUSES, errorStatus, isConnectivityError };
