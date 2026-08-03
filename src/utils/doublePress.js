/**
 * True when a keypress at `now` (ms) is the SECOND of a double-press — i.e. a
 * prior press happened within `windowMs`. `lastTime` of 0/null/undefined means
 * there was no qualifying prior press. Callers must exclude auto-repeat (held
 * key) events before feeding timestamps in, or a held key reads as many doubles.
 *
 * Used by the TV grids for "double-press UP → jump focus to the top" (there's no
 * pointer to tap a floating button with on a 10-foot remote).
 *
 * @param {number} now current timestamp in ms
 * @param {number|null|undefined} lastTime timestamp of the previous qualifying press
 * @param {number} [windowMs] max gap that still counts as a double-press
 * @returns {boolean}
 */
export function isDoublePress(now, lastTime, windowMs = 400) {
  return !!lastTime && now - lastTime <= windowMs;
}
