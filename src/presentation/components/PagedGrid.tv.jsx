import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { nextDisplay } from "./gridPage.js";
import { computeWindow } from "../virtualization/windowMath.js";
import { posterUrl, prefetchImage } from "../../utils/imagePrefetch";

const BUFFER_ROWS = 2; // rows above/below the viewport kept mounted (overscan)
const PREFETCH_ROWS = 2; // rows past the window whose posters we warm ahead

/**
 * Focus-anchored windowed TV grid. Renders a fixed `cols` CSS grid but mounts
 * only the rows around D-pad focus (focusRow ± BUFFER), with sized spacer divs
 * standing in for the skipped rows so scroll geometry stays exact. This replaces
 * the old grow-only `items.slice(0, display)` that mounted every revealed poster
 * and never released nodes — the webOS scroll-freeze profile the shelves already
 * solved (mirrors VirtualGrid.web's windowing).
 *
 * `renderItem` still receives the ABSOLUTE index (unchanged contract). The
 * screen keeps owning `display`/`onGrow`; we still advance it (harmless, keeps
 * gridPage.js's grow math in play) but the mount set is the focus window, not
 * `display`, so nodes are bounded regardless of how far focus has travelled.
 */
export function PagedGridTV({
  items,
  cols,
  gap = 8,
  focusIndex = 0,
  pageSize,
  display,
  onGrow,
  renderItem,
  className = "",
}) {
  const containerRef = useRef(null);
  const gridRef = useRef(null);
  const focusedRef = useRef(null);
  const [rowHeight, setRowHeight] = useState(0);

  const total = items.length;
  const totalRows = Math.ceil(total / cols);
  const focusRow = Math.floor(focusIndex / cols);

  // Advance the screen-owned display cap as focus nears its end (unchanged
  // behaviour — keeps gridPage.js's nextDisplay in the loop). The mount window
  // below is independent of this; it's anchored on focus.
  useEffect(() => {
    const next = nextDisplay(focusIndex, display, cols, pageSize, total);
    if (next !== display) onGrow?.(next);
  }, [focusIndex, display, cols, pageSize, total, onGrow]);

  // Measure a real row height from the first rendered cell (cards have an
  // explicit height, so one measurement is exact). Used to size the spacer divs
  // and to derive how many rows fit the viewport.
  useLayoutEffect(() => {
    const cell = gridRef.current?.firstElementChild;
    if (!cell) return;
    const h = cell.offsetHeight;
    if (h > 0) setRowHeight((prev) => (Math.abs(prev - h) <= 1 ? prev : h));
  }, [cols, total, rowHeight]);

  // Visible-row count from the container height (fallback to a small page until
  // measured). Feeds computeWindow's viewportCount so the window covers the page.
  const stride = (rowHeight || 0) + gap;
  const viewportRows = (() => {
    const ch = containerRef.current?.clientHeight || 0;
    if (!ch || !stride) return 4;
    return Math.max(1, Math.ceil(ch / stride));
  })();

  const win = computeWindow({
    anchor: focusRow,
    total: totalRows,
    viewportCount: viewportRows,
    overscan: BUFFER_ROWS,
  });

  // Bring the focused cell into view (every rendered cell is real DOM).
  useEffect(() => {
    focusedRef.current?.scrollIntoView({ block: "nearest" });
  }, [focusIndex]);

  // Warm poster caches for the next PREFETCH_ROWS past the window, so revealed
  // rows mount already-decoded instead of flashing blank (mirrors VirtualShelves).
  useEffect(() => {
    const from = win.end * cols;
    const to = Math.min(total, (win.end + PREFETCH_ROWS) * cols);
    for (let i = from; i < to; i++) prefetchImage(posterUrl(items[i]));
  }, [win.end, cols, total, items]);

  const startIndex = win.start * cols;
  const endIndex = Math.min(total, win.end * cols);
  const shown = items.slice(startIndex, endIndex);
  const leadRows = win.start;
  const trailRows = Math.max(0, totalRows - win.end);

  return (
    <div
      ref={containerRef}
      className={`tv-paged-grid${className ? ` ${className}` : ""}`}
      style={{ overflowY: "auto", height: "100%", contain: "strict" }}
    >
      {/* Top spacer stands in for the rows above the window. */}
      {leadRows > 0 && rowHeight > 0 && (
        <div style={{ height: leadRows * stride }} />
      )}
      <div
        ref={gridRef}
        style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap }}
      >
        {shown.map((item, i) => {
          const absIndex = startIndex + i;
          return (
            <div key={absIndex} ref={absIndex === focusIndex ? focusedRef : null}>
              {renderItem(item, absIndex)}
            </div>
          );
        })}
      </div>
      {/* Bottom spacer stands in for the rows below the window. */}
      {trailRows > 0 && rowHeight > 0 && (
        <div style={{ height: trailRows * stride }} />
      )}
    </div>
  );
}
