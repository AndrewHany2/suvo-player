/**
 * Pure geometry + release-hold helpers for the native seek bar. Deliberately
 * free of any React Native import so they run under `node --test` (mirrors
 * utils/doublePress.js). The bar wires these into its responder handlers.
 */

/**
 * Map a screen-absolute touch X to a 0..1 fraction of the bar.
 *
 * We use `pageX` (not the responder event's `locationX`): `locationX` is
 * measured relative to whichever child View is under the finger — the thumb,
 * the played bar, the track — so it flips reference frames mid-drag and the
 * scrub position jitters. `pageX` minus the bar's measured window-left is
 * stable regardless of which child the finger is over.
 *
 * @param {number} pageX screen-absolute touch X
 * @param {number} left   bar's window-left (from measureInWindow)
 * @param {number} width  bar's measured width
 * @returns {number} clamped 0..1
 */
export function fractionFromX(pageX, left, width) {
  if (!(width > 0)) return 0;
  return Math.max(0, Math.min(1, (pageX - left) / width));
}

/**
 * Fraction → seconds, clamped to [0, durationSec].
 * @param {number} frac 0..1
 * @param {number} durationSec
 */
export function secondsFromFraction(frac, durationSec) {
  if (!(durationSec > 0)) return 0;
  return Math.max(0, Math.min(durationSec, frac * durationSec));
}

/**
 * After a seek is committed the bar keeps SHOWING the scrubbed target until the
 * engine actually reports a position near it. Otherwise `shown` reverts to the
 * stale pre-seek `positionSec` for a beat and the bar snaps backwards (reads as
 * "jumped to the start") before the real position arrives.
 *
 * @param {number} positionSec  the engine's current reported position
 * @param {number} targetSec    the committed seek target
 * @param {number} [toleranceSec=1.5]
 * @returns {boolean} true once the position has caught up to the target
 */
export function positionReached(positionSec, targetSec, toleranceSec = 1.5) {
  return Math.abs(positionSec - targetSec) <= toleranceSec;
}
