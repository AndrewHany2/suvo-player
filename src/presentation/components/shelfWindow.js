// Pure windowing + focus math for VirtualShelves.tv (and ContentShelf.web
// horizontal virtualization). No DOM, no React — unit-tested in isolation.

/** Half-open [start,end) range of shelf indices to mount. */
export function shelfWindow(focusShelf, shelfCount, buffer = 1) {
  const start = Math.max(0, focusShelf - buffer);
  const end = Math.min(shelfCount, focusShelf + buffer + 1);
  return { start, end };
}

/** Half-open [start,end) range of poster indices to mount in one rail. */
export function railWindow(focusCol, loadedCount, visibleCols, hBuffer = 2, isFocused = false) {
  if (!isFocused) {
    return { start: 0, end: Math.min(loadedCount, visibleCols) };
  }
  const start = Math.max(0, focusCol - hBuffer);
  const end = Math.min(loadedCount, focusCol + visibleCols + hBuffer);
  return { start, end };
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
