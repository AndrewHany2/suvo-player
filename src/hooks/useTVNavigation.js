import { useState, useEffect, useRef } from "react";

/**
 * 2D remote-control navigation for LG TV (WebOS).
 *
 * Pass an array of rows, each with items + onSelect.
 * Arrow left/right moves within a row; up/down moves between rows.
 *
 * @param {object} options
 * @param {{ items: any[], onSelect: (index, item) => void }[]} options.rows
 * @param {boolean} options.active  - Only listen while true (e.g. current view is active).
 * @returns {{ focusedRow: number, focusedCol: number }}
 */
export function useTVNavigation({ rows, active = true }) {
  const [focusedRow, setFocusedRow] = useState(0);
  const [focusedCol, setFocusedCol] = useState(0);
  const ref = useRef({ row: 0, col: 0 });

  // Reset when view becomes active or rows change
  useEffect(() => {
    ref.current = { row: 0, col: 0 };
    setFocusedRow(0);
    setFocusedCol(0);
  }, [active]);

  useEffect(() => {
    if (!active || !rows.length) return;

    const handleKey = (e) => {
      const { row, col } = ref.current;
      const currentItems = rows[row]?.items ?? [];

      if (e.key === "ArrowRight" || e.keyCode === 39) {
        e.preventDefault();
        const next = Math.min(col + 1, currentItems.length - 1);
        ref.current.col = next;
        setFocusedCol(next);
      } else if (e.key === "ArrowLeft" || e.keyCode === 37) {
        e.preventDefault();
        const prev = Math.max(col - 1, 0);
        ref.current.col = prev;
        setFocusedCol(prev);
      } else if (e.key === "ArrowDown" || e.keyCode === 40) {
        e.preventDefault();
        if (row < rows.length - 1) {
          const nextRow = row + 1;
          // Keep column position but clamp to new row's length
          const nextCol = Math.min(col, (rows[nextRow]?.items.length ?? 1) - 1);
          ref.current = { row: nextRow, col: nextCol };
          setFocusedRow(nextRow);
          setFocusedCol(nextCol);
        }
      } else if (e.key === "ArrowUp" || e.keyCode === 38) {
        e.preventDefault();
        if (row > 0) {
          const prevRow = row - 1;
          const prevCol = Math.min(col, (rows[prevRow]?.items.length ?? 1) - 1);
          ref.current = { row: prevRow, col: prevCol };
          setFocusedRow(prevRow);
          setFocusedCol(prevCol);
        }
      } else if (e.key === "Enter" || e.keyCode === 13) {
        rows[row]?.onSelect?.(col, currentItems[col]);
      }
    };

    globalThis.addEventListener("keydown", handleKey);
    return () => globalThis.removeEventListener("keydown", handleKey);
  }, [active, rows]);

  return { focusedRow, focusedCol };
}
