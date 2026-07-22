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
 * Usage: StatePanel title={FATAL_TITLE} message={FATAL_HEADLINE}; render the raw
 * engine reason (fatalDetail(reason) or the machine's fatalMessage) UNDERNEATH as
 * quiet muted secondary detail — never as the headline.
 */

export const FATAL_TITLE = "Can't play this stream";

export const FATAL_HEADLINE =
  "This stream won't play right now — it may be offline, or the connection dropped. Try again, or head back and pick something else.";

/**
 * Maps a recovery-machine fatal reason to a terse, human diagnostic line. Kept
 * here (not duplicated per screen) so the wording stays identical across engines.
 * @param {string|undefined} reason - e.g. "GONE" | "AUTH_EXPIRED"
 * @returns {string}
 */
export function fatalDetail(reason) {
  if (reason === "GONE") return "This stream is no longer available.";
  if (reason === "AUTH_EXPIRED") return "Stream unavailable. The server rejected the connection.";
  return "The stream could not be played.";
}
