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
 * since fetch rejections don't carry a structured status.
 */
export function isAuthError(err) {
  const m = /status:\s*(\d+)/.exec(err?.message || "");
  return m ? m[1] === "401" || m[1] === "403" : false;
}
