// @ts-check
/**
 * PURE watch-history entry helpers — no React, no AsyncStorage.
 *
 * Split out from AppContext so the progress-preservation logic can be unit
 * tested with bare `node --test`. AppContext imports these at its single
 * history write chokepoint.
 */

/**
 * PURE: resolve the `currentTime`/`duration` for a (re-)added history entry.
 *
 * Opening a title re-adds it to history (to bump `watchedAt` / move it to the
 * top of "continue watching"). Those opens carry `currentTime: startTime || 0`,
 * which is `0` for a normal open. Without this helper, re-adding an already
 * watched title would overwrite its saved resume position with `0` — and, since
 * that write stamps a fresh `watchedAt` and syncs to Supabase, the zeroed entry
 * would win the most-recent-wins merge and destroy the resume point.
 *
 * So we only take the incoming position when it is a real (> 0) value;
 * otherwise we preserve whatever the previous entry already had.
 *
 * @param {Object|null|undefined} prevEntry - Existing history entry, if any.
 * @param {Object} item - Incoming (normalized) item being added.
 * @returns {{ currentTime: number, duration: number }}
 */
export function resolveProgressFields(prevEntry, item) {
  return {
    currentTime: Number(item?.currentTime) || Number(prevEntry?.currentTime) || 0,
    duration: Number(item?.duration) || Number(prevEntry?.duration) || 0,
  };
}
