import { useState, useEffect, useRef } from "react";
import { Platform } from "react-native";

// Check if we're on a web platform (includes TV platforms like WebOS)
const isWeb = Platform.OS === "web";

// Initial D-pad focus index. Web/TV starts at 0 so the first cell is focused on
// mount (unchanged). Native touch (iOS/Android) starts at -1 so nothing is
// focused at rest — the hook attaches no key listeners there, so a resting 0/0
// would otherwise paint a permanent focus ring on the first card.
const INITIAL_FOCUS = isWeb ? 0 : -1;

/**
 * 2D remote-control navigation for LG TV (WebOS).
 *
 * Pass an array of rows, each with items + onSelect.
 * Arrow left/right moves within a row; up/down moves between rows.
 * When pressing UP at row 0, dispatches the custom event "tv-nav-focus"
 * so the top navigation bar can claim focus.
 *
 * NOTE: This hook only works on web/TV platforms. On mobile (iOS/Android),
 * it returns default values without setting up event listeners.
 *
 * @param {object} options
 * @param {{ items: any[], onSelect: (index, item) => void }[]} options.rows
 * @param {boolean} options.active  - Only listen while true.
 * @returns {{ focusedRow: number, focusedCol: number }}
 */
export function useTVNavigation({ rows, active = true }) {
  const [focusedRow, setFocusedRow] = useState(INITIAL_FOCUS);
  const [focusedCol, setFocusedCol] = useState(INITIAL_FOCUS);
  const ref = useRef({ row: INITIAL_FOCUS, col: INITIAL_FOCUS });
  const navHasFocusRef = useRef(false);

  useEffect(() => {
    ref.current = { row: INITIAL_FOCUS, col: INITIAL_FOCUS };
    setFocusedRow(INITIAL_FOCUS);
    setFocusedCol(INITIAL_FOCUS);
  }, [active]);

  // Pause when navbar claims focus; resume when navbar returns it
  useEffect(() => {
    if (!isWeb) return;

    const onNavFocus = () => {
      navHasFocusRef.current = true;
    };
    const onNavBlur = () => {
      navHasFocusRef.current = false;
    };
    globalThis.addEventListener("tv-nav-focus", onNavFocus);
    globalThis.addEventListener("tv-nav-blur", onNavBlur);
    return () => {
      globalThis.removeEventListener("tv-nav-focus", onNavFocus);
      globalThis.removeEventListener("tv-nav-blur", onNavBlur);
    };
  }, []);

  useEffect(() => {
    if (!isWeb) return;
    if (!active || !rows.length) return;

    const handleKey = (e) => {
      if (navHasFocusRef.current) return;

      // While a text field has focus, let the keys drive the caret instead of
      // moving the grid. Enter/Escape blurs the field, handing control back to
      // D-pad navigation at the same row.
      const ae = document.activeElement;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) {
        if (e.key === "Enter" || e.keyCode === 13 || e.key === "Escape" || e.keyCode === 27) {
          e.preventDefault();
          ae.blur();
        }
        return;
      }

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
        } else {
          // Already at the top row — hand focus up to the navbar
          globalThis.dispatchEvent(new CustomEvent("tv-nav-focus"));
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
