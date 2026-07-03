export { computeWindow } from "../virtualization/windowMath.js";

// Pure windowing + focus math for the horizontal rails (ContentShelf.web) and
// the 2-D virtualized TV shelf list (VirtualShelves.tv). No DOM, no React —
// unit-tested in isolation.
//
// The core rule: the mount window is derived from the SCROLL position (which
// slots are actually on screen), never straight from the focused index. Anchor
// the window to `focus` directly and it slides ahead of the scroll, unmounting
// still-visible posters and leaving blank spacer gaps.

/**
 * Advance a 1-D "first visible slot" anchor using the scroll-into-view-at-edges
 * rule: the anchor only moves when `focus` would fall outside the visible page
 * [anchor, anchor + visible). Clamped so the final page never scrolls past the
 * end of the list.
 */
export function scrollAnchor(prevAnchor, focus, visible, count) {
  const maxAnchor = Math.max(0, count - visible);
  let a = Math.min(Math.max(0, Math.trunc(prevAnchor)), maxAnchor);
  if (focus < a) a = focus;
  else if (focus > a + visible - 1) a = focus - visible + 1;
  return Math.max(0, Math.min(a, maxAnchor));
}

/**
 * Half-open [start, end) range of slots to mount: the visible page
 * [anchor, anchor + visible) plus `overscan` slots kept mounted on each side,
 * rendered ahead of the scroll so travel in either direction reveals a ready
 * poster instead of a blank. Guarantees the whole visible page stays mounted.
 */
export function windowFromAnchor(anchor, count, visible, overscan = 3) {
  const a = Math.max(0, Math.trunc(anchor));
  const start = Math.max(0, a - overscan);
  const end = Math.min(count, a + visible + overscan);
  return { start, end };
}

/**
 * Which scroll-hint edges a horizontal rail should show, from its REAL scroll
 * geometry (measured px), NOT a floored visible-column estimate. The column
 * estimate `floor((width - insets) / stride)` undercounts the fractional card
 * that partially fits, so a `first + cols < count` heuristic stays true even
 * when the rail is scrolled flush to its end — leaving the last poster forever
 * under the right-edge fade. Measured geometry clears the hint exactly at the
 * end. `epsilon` absorbs sub-pixel/rounding slack in scrollLeft.
 */
export function railEdges({ scrollLeft, clientWidth, scrollWidth }, epsilon = 2) {
  const maxScroll = Math.max(0, scrollWidth - clientWidth);
  return {
    left: scrollLeft > epsilon,
    right: scrollLeft < maxScroll - epsilon,
  };
}

/** Clamp a (possibly remembered) column into the loaded range. */
export function clampCol(col, loadedCount) {
  if (loadedCount <= 0) return 0;
  if (col < 0) return 0;
  if (col > loadedCount - 1) return loadedCount - 1;
  return col;
}

/** True when focus is within threshold of the loaded end (trigger load-more). */
export function nearRailEnd(focusCol, loadedCount, threshold = 3) {
  if (loadedCount <= 0) return false;
  return focusCol >= loadedCount - threshold;
}
