// @ts-check
/**
 * Pure helpers for the picture-adjustment (brightness / contrast) preference.
 *
 * Web/TV only: both render a real <video> element (hls.js), so exposure is just
 * a CSS `filter` on that element. Native (expo-video) draws to a hardware
 * surface with no CSS-filter equivalent, so it doesn't use this module.
 *
 * Values are percentages (100 = unchanged). This module owns the range, the
 * discrete step ladder used by the TV D-pad menus, clamping, and the CSS-filter
 * string builder — kept pure and beside its test so usePlayer stays thin.
 */

/** Neutral picture — no adjustment. */
export const DEFAULT_VIDEO_ADJUST = { brightness: 100, contrast: 100 };

export const ADJUST_MIN = 50;
export const ADJUST_MAX = 150;
export const ADJUST_STEP = 5;

/**
 * Discrete levels offered in the TV settings menus (D-pad can't drive a
 * continuous slider comfortably). 100 is the neutral midpoint.
 * @type {number[]}
 */
export const ADJUST_LEVELS = [50, 75, 90, 100, 110, 125, 150];

/**
 * Clamp + round an adjustment value into [ADJUST_MIN, ADJUST_MAX]. Non-finite
 * input falls back to the neutral 100.
 * @param {unknown} n
 * @returns {number}
 */
export function clampAdjustValue(n) {
  // Guard null explicitly — Number(null) is 0 (finite), which would wrongly
  // clamp to ADJUST_MIN instead of the neutral fallback.
  if (n == null) return 100;
  const v = Number(n);
  if (!Number.isFinite(v)) return 100;
  return Math.min(ADJUST_MAX, Math.max(ADJUST_MIN, Math.round(v)));
}

/**
 * Normalise a (possibly partial / garbage) stored record into a full adjust
 * object with clamped values.
 * @param {unknown} raw
 * @returns {{ brightness: number, contrast: number }}
 */
export function normalizeAdjust(raw) {
  const r = raw && typeof raw === "object" ? /** @type {any} */ (raw) : {};
  return {
    brightness: clampAdjustValue(r.brightness ?? 100),
    contrast: clampAdjustValue(r.contrast ?? 100),
  };
}

/**
 * Build the CSS `filter` value for an adjust object. Returns "" when the
 * picture is neutral so callers can omit the filter entirely (no needless
 * compositing on the video element).
 * @param {{ brightness?: number, contrast?: number }} [adjust]
 * @returns {string}
 */
export function buildVideoFilter(adjust) {
  const { brightness, contrast } = normalizeAdjust(adjust);
  const parts = [];
  if (brightness !== 100) parts.push(`brightness(${brightness / 100})`);
  if (contrast !== 100) parts.push(`contrast(${contrast / 100})`);
  return parts.join(" ");
}
