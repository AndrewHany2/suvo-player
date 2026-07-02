// Pure grow-on-scroll math for the paged TV grids (PagedGrid.tv). No DOM, no
// React — unit-tested in isolation, mirroring shelfWindow.js.
//
// The grid renders items.slice(0, display). As D-pad focus nears the rendered
// end, `display` grows by one page so the next rows exist before the user
// reaches them. Bounded by how far the user actually scrolls, never the full
// list; the screen resets `display` to `pageSize` on every filter/category
// change.

/**
 * Next display cap given the focused index. Grows by `pageSize` when `focusIndex`
 * is within `cols` of the current `display` (i.e. focus reached the last rendered
 * row), clamped to `total`. Otherwise returns `display` unchanged. Result is
 * always in [0, total] and never below `min(display, total)`.
 */
export function nextDisplay(focusIndex, display, cols, pageSize, total) {
  const capped = Math.min(display, total);
  if (focusIndex >= display - cols) return Math.min(display + pageSize, total);
  return capped;
}
