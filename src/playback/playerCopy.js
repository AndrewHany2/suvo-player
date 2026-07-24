/**
 * Shared player copy — one source of truth for the failure-state wording so the
 * most emotionally-charged moment (playback failed) reads with the same calm,
 * benefit-first brand voice on EVERY surface (web, TV, and both native engines).
 *
 * Previously only the web player headlined the calm sentence; TV and the two
 * native screens headlined the terse technical "Failed to load stream", which
 * contradicted the calm/reassuring positioning and gave a jarringly different
 * tone across devices. Route all four through these constants.
 *
 * Usage: StatePanel title={FATAL_TITLE} message={fatalCause({reason, httpStatus})};
 * render the raw engine/provider text (cleanRawError(message)) UNDERNEATH as
 * quiet muted secondary detail — never as the headline.
 */

export const FATAL_TITLE = "Can't play this stream";

/**
 * Friendly, plain-language cause line for the fatal panel. Prefers the parsed
 * HTTP status (so a provider's real rejection shows through, e.g. "HTTP 406"),
 * falling back to the classified reason. Shown as the panel message, with the
 * raw engine text (see {@link cleanRawError}) as quiet detail underneath.
 *
 * @param {{reason?: string, httpStatus?: number}} [info]
 * @returns {string}
 */
export function fatalCause(info = {}) {
  const { reason, httpStatus } = info;
  if (httpStatus === 404 || reason === "GONE") return "This stream is no longer available.";
  if (httpStatus === 401 || httpStatus === 403 || reason === "AUTH_EXPIRED") {
    return "The server rejected the connection.";
  }
  if (typeof httpStatus === "number" && httpStatus >= 500 && httpStatus <= 599) {
    return `The stream server had a problem (HTTP ${httpStatus}).`;
  }
  if (typeof httpStatus === "number" && httpStatus >= 400 && httpStatus <= 499) {
    return `The server refused this stream (HTTP ${httpStatus}).`;
  }
  return "The stream could not be played.";
}

/**
 * Tidy a raw engine/provider error message for display: strip the noisy
 * boilerplate prefixes engines wrap around the real text, and trim. Returns
 * undefined when nothing meaningful is left, so callers can skip the line.
 *
 * @param {string|undefined|null} message
 * @returns {string|undefined}
 */
export function cleanRawError(message) {
  if (typeof message !== "string") return undefined;
  const cleaned = message
    .replace(/^A playback exception has occurred:\s*/i, "")
    .replace(/^Source error\s*/i, "")
    .trim();
  return cleaned || undefined;
}
