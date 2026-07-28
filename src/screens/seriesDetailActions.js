// @ts-check
/**
 * PURE: action-button type ordering for the TV series detail.
 *
 * Shared by the Continue-Watching detail (HistoryScreen.tv) and the Series-tab
 * detail (SeriesScreen.tv) so the render (which builds the button array) and the
 * D-pad handlers (which map the focused index back to an action) never drift when
 * a button is added or removed.
 *
 * "episodes" (the "Browse Episodes" affordance) is ALWAYS present — it's the
 * discoverable entry point into the season/episode browser, matching the
 * Electron/native SeriesDetail. "continue" only appears when there's watch
 * history to resume. When there's no history, "episodes" is the first (primary)
 * action.
 *
 * @param {boolean} hasHistory - true when a resume position exists for the series
 * @returns {("continue"|"episodes"|"fav")[]} ordered action types, left→right
 */
export function seriesActionTypes(hasHistory) {
  return hasHistory ? ["continue", "episodes", "fav"] : ["episodes", "fav"];
}

/**
 * PURE: the ordered list of season numbers (as strings) to show for a series.
 *
 * Derived from the KEYS of `info.episodes` — the seasons that actually have
 * episodes — matching the web/native SeriesDetail (`Object.keys(episodes)`).
 * This avoids the old `season_number || id` fallback that collapsed a Specials
 * season (`season_number: 0`, falsy) into its huge internal id (e.g. "309556"),
 * and guarantees every season chip maps to real episodes.
 *
 * Falls back to `info.seasons` only when `episodes` is absent/empty, using `??`
 * (not `||`) so a legitimate season 0 is preserved rather than replaced by id.
 *
 * @param {{ episodes?: Object, seasons?: Object[]|Object }} info
 * @returns {string[]} season numbers, ascending
 */
export function seasonList(info) {
  const byNum = (a, b) => Number(a) - Number(b);
  const epKeys = Object.keys(info?.episodes || {});
  if (epKeys.length) return epKeys.sort(byNum);
  const rawSeasons = info?.seasons;
  if (Array.isArray(rawSeasons))
    return rawSeasons.map((s) => String(s.season_number ?? s.id)).sort(byNum);
  return Object.keys(rawSeasons || {}).sort(byNum);
}
