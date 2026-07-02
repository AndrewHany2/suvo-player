import { useEffect, useRef } from "react";
import { nextDisplay } from "./gridPage.js";

/**
 * Grow-on-scroll TV grid. Renders items.slice(0, display) in a plain CSS grid —
 * no virtualization windowing. The SCREEN owns `display` (its filtered arrays
 * are recomputed each render, so the cap can't live here); this component grows
 * it via onGrow as D-pad focus nears the rendered end and scrolls the focused
 * cell into view. `renderItem` gets the ABSOLUTE index, matching VirtualGridTV.
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
  const focusedRef = useRef(null);

  // Grow the rendered slice when focus reaches its end.
  useEffect(() => {
    const next = nextDisplay(focusIndex, display, cols, pageSize, items.length);
    if (next !== display) onGrow?.(next);
  }, [focusIndex, display, cols, pageSize, items.length, onGrow]);

  // Bring the focused cell into view (native — every rendered cell is real DOM).
  useEffect(() => {
    focusedRef.current?.scrollIntoView({ block: "nearest" });
  }, [focusIndex]);

  const shown = items.slice(0, display);

  return (
    <div
      className={`tv-paged-grid${className ? ` ${className}` : ""}`}
      style={{ overflowY: "auto", height: "100%", contain: "strict" }}
    >
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap }}>
        {shown.map((item, i) => (
          <div key={i} ref={i === focusIndex ? focusedRef : null}>
            {renderItem(item, i)}
          </div>
        ))}
      </div>
    </div>
  );
}
