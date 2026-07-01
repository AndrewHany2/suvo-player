import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";

const BUFFER_ROWS = 2; // rows above/below the viewport to keep mounted

/**
 * Virtual-scrolling grid for web/desktop screens.
 *
 * Web sibling of VirtualGrid.tv. Only mounts the items in the visible viewport
 * ± BUFFER_ROWS, so a 2,000-title category no longer pins 2,000 poster cards in
 * the DOM (the old CategoryPage grew an append-only slice(0, displayCount) that
 * never released nodes). The grid IS the scroller.
 *
 * Web-specific vs the TV version:
 *  - Columns are DERIVED from the container width (matching the old
 *    `repeat(auto-fill, itemWidth)` behaviour) rather than a fixed `cols` prop,
 *    and reported back via `onColsChange` so the screen's D-pad key handler can
 *    keep doing its up/down row math.
 *  - Row height is MEASURED from the first rendered card (cards have an explicit
 *    height, so one measurement is exact) with `estRowHeight` as the pre-measure
 *    fallback — avoids scroll drift from a hand-computed constant across ss()
 *    scaling.
 *
 * D-pad compatible: the screen drives a single absolute `focusIndex`. When it
 * changes we extend the mounted window to include the focused row and scroll it
 * into view, so the focused card is always mounted/visible even after a jump.
 * `renderItem` receives the ABSOLUTE index so `i === focus` styling is unchanged.
 *
 * @param {object}   props
 * @param {any[]}    props.items          - Flat array of all (already filtered) items.
 * @param {number}   props.itemWidth      - Fixed cell width in px (already ss-scaled).
 * @param {number}   props.gap            - Gap between cells in px (already ss-scaled).
 * @param {number}   props.estRowHeight   - Row-height estimate used until measured.
 * @param {Function} props.renderItem     - (item, absoluteIndex) => React node.
 * @param {number}   [props.focusIndex]   - Absolute index of the D-pad focused item.
 * @param {Function} [props.onColsChange] - Called with the derived column count.
 * @param {Function} [props.onEndReached] - Called when scrolled/focused near the end.
 * @param {number}   [props.paddingH]     - Horizontal content padding in px.
 * @param {number}   [props.paddingV]     - Vertical content padding in px.
 * @param {React.ReactNode} [props.footer] - Rendered below the grid (e.g. a spinner).
 * @param {string}   [props.className]
 */
export default function VirtualGridWeb({
  items,
  itemWidth,
  gap = 16,
  estRowHeight = 360,
  renderItem,
  focusIndex = 0,
  onColsChange,
  onEndReached,
  paddingH = 0,
  paddingV = 0,
  footer = null,
  className = "",
}) {
  const containerRef = useRef(null);
  const gridRef = useRef(null);
  // Edge-trigger latch for onEndReached: fire once when the end first comes
  // into view, re-arm only after we move away (or totalRows grows on append).
  // Prevents a burst of per-scroll-frame calls from racing the parent's
  // async loadingMore guard into duplicate fetches.
  const atEndRef = useRef(false);
  const [cols, setCols] = useState(1);
  const [rowHeight, setRowHeight] = useState(estRowHeight);
  const [range, setRange] = useState({ start: 0, end: BUFFER_ROWS * 2 + 4 });

  const totalRows = Math.ceil(items.length / cols);
  const rowWithGap = rowHeight + gap;

  // ── Columns: derived from the inner content width (width − 2·paddingH) ──────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const inner = el.clientWidth - paddingH * 2;
      // Same formula the old grid used: how many (itemWidth + gap) blocks fit.
      const next = Math.max(1, Math.floor((inner + gap) / (itemWidth + gap)));
      setCols((prev) => (prev === next ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [itemWidth, gap, paddingH]);

  useEffect(() => { onColsChange?.(cols); }, [cols, onColsChange]);

  // ── Measure the real card height from the first rendered cell ───────────────
  useLayoutEffect(() => {
    const cell = gridRef.current?.firstElementChild;
    if (!cell) return;
    const h = cell.offsetHeight;
    if (h > 0) setRowHeight((prev) => (Math.abs(prev - h) <= 1 ? prev : h));
  }, [cols, itemWidth, items.length]);

  // Fire onEndReached once per end-approach (edge-, not level-triggered).
  const fireEndReached = useCallback(() => {
    if (atEndRef.current) return;
    atEndRef.current = true;
    onEndReached?.();
  }, [onEndReached]);

  // ── Visible range from scroll position ──────────────────────────────────────
  const recalc = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { scrollTop, clientHeight } = el;
    const stride = rowHeight + gap;
    // The grid is pushed down by paddingV, so subtract it before mapping the
    // scroll offset → row index (clamped at 0).
    const top = Math.max(0, scrollTop - paddingV);
    const startRow = Math.max(0, Math.floor(top / stride) - BUFFER_ROWS);
    const endRow = Math.min(
      totalRows,
      Math.ceil((top + clientHeight) / stride) + BUFFER_ROWS,
    );
    setRange((prev) =>
      prev.start === startRow && prev.end === endRow ? prev : { start: startRow, end: endRow },
    );
    // Re-arm once we move away from the end (or totalRows grew after a page
    // append pushed the end further down), then fire again on the next approach.
    if (endRow >= totalRows - 1) fireEndReached();
    else atEndRef.current = false;
  }, [rowHeight, gap, paddingV, totalRows, fireEndReached]);

  useEffect(() => { recalc(); }, [items.length, cols, rowHeight, recalc]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("scroll", recalc, { passive: true });
    return () => el.removeEventListener("scroll", recalc);
  }, [recalc]);

  // ── D-pad focus: keep the focused row mounted + in view ─────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const stride = rowHeight + gap;
    const focusRow = Math.floor(focusIndex / cols);
    setRange((prev) => {
      const start = Math.min(prev.start, Math.max(0, focusRow - BUFFER_ROWS));
      const end = Math.max(prev.end, Math.min(totalRows, focusRow + BUFFER_ROWS + 1));
      return prev.start === start && prev.end === end ? prev : { start, end };
    });
    // A row's true top includes the wrapper's paddingV. Instant (not smooth)
    // so rapid arrow presses don't queue animations.
    const rowTop = paddingV + focusRow * stride;
    const rowBottom = rowTop + rowHeight;
    if (rowTop < el.scrollTop) el.scrollTop = rowTop;
    else if (rowBottom > el.scrollTop + el.clientHeight)
      el.scrollTop = rowBottom - el.clientHeight;
    if (focusRow >= totalRows - 2) fireEndReached();
  }, [focusIndex, cols, rowHeight, gap, paddingV, totalRows, fireEndReached]);

  const paddingTopRows = range.start * rowWithGap;
  const paddingBottomRows = Math.max(0, totalRows - range.end) * rowWithGap;
  const visibleItems = items.slice(range.start * cols, range.end * cols);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ overflowY: "auto", overflowX: "hidden", height: "100%", contain: "strict" }}
    >
      <div style={{ paddingLeft: paddingH, paddingRight: paddingH, paddingTop: paddingV, paddingBottom: paddingV }}>
        <div style={{ paddingTop: paddingTopRows, paddingBottom: paddingBottomRows }}>
          <div
            ref={gridRef}
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${cols}, ${itemWidth}px)`,
              gap,
              justifyContent: "center",
              alignItems: "start",
            }}
          >
            {visibleItems.map((item, i) => renderItem(item, range.start * cols + i))}
          </div>
        </div>
        {footer}
      </div>
    </div>
  );
}
