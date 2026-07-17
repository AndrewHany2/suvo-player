import { CONNECTIVITY_MESSAGE, errorStatus, isConnectivityError } from "./networkError.logic.js";

/**
 * True for provider auth/access failures (HTTP 401/403).
 *
 * Xtream providers gate access at the account level, so a 401/403 on one
 * category request means every other category request will fail the same way.
 * That's the "if one fails, they all fail" signal the shelf/channel loaders use
 * to trip a circuit breaker — surface the error once and stop, instead of
 * fanning out hundreds of doomed requests (which also risks the provider
 * rate-limiting or banning the account).
 *
 * Errors are matched on the message iptvApi throws (`HTTP error! status: N`),
 * since fetch rejections don't carry a structured status. Provider error-envelope
 * rejections (a 200 whose body is `{error, status}`, e.g. an expired account) DO
 * carry a numeric `.status`, so we check that first.
 */
export function isAuthError(err) {
  if (err?.status === 401 || err?.status === 403) return true;
  const m = /status:\s*(\d+)/.exec(err?.message || "");
  return m ? m[1] === "401" || m[1] === "403" : false;
}

/**
 * A user-facing reason string for a load failure, or null to let the screen use
 * its generic "check your connection" copy.
 *
 * Prefers the provider's own human message (e.g. "Your subscription has expired",
 * carried on `err.userMessage` for error-envelope responses). Falls back to a
 * generic account message for a bare 401/403 with no body text. Returns null for
 * everything else (network/timeout/5xx) so those keep the connection-generic copy.
 */
export function authErrorMessage(err) {
  const provider = err?.userMessage;
  if (typeof provider === "string" && provider.trim()) return provider.trim();
  if (isAuthError(err)) return "This account may have expired or been disabled. Please check with your provider.";
  return null;
}

/**
 * A user-facing reason for ANY load failure — always a non-empty string.
 *
 * Unlike authErrorMessage (which returns null for non-auth errors so the screen
 * shows generic copy), this folds the REAL provider message and HTTP/status code
 * into the text so failures are diagnosable: a connection problem reads as a
 * connection problem, and a provider/account problem shows what the provider
 * actually said. Used by the content hooks' error panels.
 */
export function describeError(err) {
  const status = errorStatus(err);
  const httpSuffix = status ? ` (HTTP ${status})` : "";
  const statusSuffix = status ? ` (status ${status})` : "";

  // Provider error-envelope (a 200 whose body was { error, status }): the server
  // was reachable and told us something — prefer its own words.
  const provider = err?.userMessage;
  if (typeof provider === "string" && provider.trim()) {
    return `${provider.trim()}${statusSuffix}`;
  }

  // Auth / expired account.
  if (isAuthError(err)) {
    return `This account may have expired or been disabled. Please check with your provider.${statusSuffix}`;
  }

  // Reachability: network down / timeout / gateway 5xx (521, etc).
  if (isConnectivityError(err)) {
    return `${CONNECTIVITY_MESSAGE}${httpSuffix}`;
  }

  // Anything else the provider returned — surface the real detail. Collapse
  // iptvApi's own "HTTP error! status: N" string into clean copy; keep other
  // provider text (e.g. a "Non-JSON response…: Blocked" snippet) verbatim.
  const raw = (err?.message || "").trim();
  if (!raw || /^HTTP error! status:/i.test(raw)) return `The provider returned an error${httpSuffix || "."}`;
  return `The provider returned an error${httpSuffix}: ${raw}`;
}
