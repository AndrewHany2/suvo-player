// Pure grouping helpers for the History feature. Kept in a standalone,
// dependency-free module (like context/historyProgress.js) so it can be unit
// tested under node:test without pulling in React / AppContext / RN.

/**
 * Split the raw watch-history list into the sublists the screens render.
 * Live entries never belong in "Continue Watching" / "Watch History" (they have
 * no resume position), so they're filtered out; recency order is preserved.
 * @param {Array<{type?: string}>|null|undefined} history
 * @returns {{ watched: Array }}
 */
export function splitHistory(history) {
  const list = Array.isArray(history) ? history : [];
  return { watched: list.filter((item) => item.type !== "live") };
}
