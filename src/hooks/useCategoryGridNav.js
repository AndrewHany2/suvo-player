import { useState, useEffect, useRef, useCallback } from "react";

import { normalizeSearch } from "../utils/normalizeSearch.js";

// True while a text field owns focus, so the grid's global keydown handler can
// bow out and let the search box receive its own keystrokes.
function isTextInputFocused() {
  const el = document.activeElement;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

/**
 * Web CategoryPage keyboard/D-pad navigation, shared by the Movies and Series
 * drill-in grids (their copies were line-for-line identical). Owns the focus
 * cursor over the search-filtered list and mirrors VirtualGrid's column count
 * for row math. Filters `items` by `search` (case-insensitive name match) and
 * returns the filtered list so the screen renders the same array the cursor
 * roams.
 *
 * Behavior: nothing is focused at rest (mouse users get hover only); the first
 * arrow key brings the cursor onto the first card; ArrowUp from the top row
 * hands focus back to the top-nav via a "tv-nav-focus" event; Enter selects,
 * Escape backs out. Keys are ignored while a text input (the search box) or the
 * top-nav owns focus.
 *
 * @param {object} p
 * @param {Array|null} p.items    the category's items (null while loading)
 * @param {string} p.search       current search query
 * @param {(item:object)=>void} p.onSelect  invoked on Enter / activate
 * @param {()=>void} p.onBack     invoked on Escape
 * @returns {{ filtered: Array|null, focusedIdx: number, onColsChange: (cols:number)=>void }}
 */
export function useCategoryGridNav({ items, search, onSelect, onBack }) {
  // Start with NOTHING focused so the grid has no resting D-nav selection on
  // desktop — mouse users get hover only. The first arrow key brings the
  // keyboard cursor in (see the idx < 0 guard in the keydown handler).
  const [focusedIdx, setFocusedIdx] = useState(-1);
  const focusedIdxRef = useRef(-1);
  const navHasFocusRef = useRef(false);
  // Column count is owned by VirtualGrid (derived from container width) and
  // mirrored here so the D-pad handler's up/down row math stays correct.
  const numColsRef = useRef(6);
  const filteredRef = useRef(null);
  const onSelectRef = useRef(onSelect);
  const onBackRef = useRef(onBack);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { onBackRef.current = onBack; }, [onBack]);

  const q = normalizeSearch(search);
  const filtered = items
    ? (q ? items.filter((i) => normalizeSearch(i.name).includes(q)) : items)
    : null;
  filteredRef.current = filtered;

  useEffect(() => { setFocusedIdx(-1); focusedIdxRef.current = -1; }, [search]);

  useEffect(() => {
    const onNavFocus = () => { navHasFocusRef.current = true; };
    const onNavBlur = () => { navHasFocusRef.current = false; };
    globalThis.addEventListener("tv-nav-focus", onNavFocus);
    globalThis.addEventListener("tv-nav-blur", onNavBlur);
    return () => {
      globalThis.removeEventListener("tv-nav-focus", onNavFocus);
      globalThis.removeEventListener("tv-nav-blur", onNavBlur);
    };
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (navHasFocusRef.current) return;
      // Don't hijack keys while a text field is focused — otherwise typing in
      // the "Search titles…" box moves the poster cursor, Enter plays a poster,
      // and Escape exits the page. Let the input handle its own keystrokes.
      if (isTextInputFocused()) return;
      // Focus roams the FULL filtered list — VirtualGrid keeps the focused row
      // mounted and scrolled into view even when it's outside the window.
      const list = filteredRef.current;
      if (!list?.length) return;
      const idx = focusedIdxRef.current;
      const numCols = numColsRef.current;
      // Nothing focused yet (resting desktop state): the first arrow key just
      // brings the cursor onto the first card rather than moving from it.
      if (idx < 0 && (e.keyCode >= 37 && e.keyCode <= 40)) {
        e.preventDefault(); focusedIdxRef.current = 0; setFocusedIdx(0); return;
      }
      if (e.key === "ArrowRight" || e.keyCode === 39) {
        e.preventDefault(); const next = Math.min(idx + 1, list.length - 1); focusedIdxRef.current = next; setFocusedIdx(next);
      } else if (e.key === "ArrowLeft" || e.keyCode === 37) {
        e.preventDefault(); const prev = Math.max(idx - 1, 0); focusedIdxRef.current = prev; setFocusedIdx(prev);
      } else if (e.key === "ArrowDown" || e.keyCode === 40) {
        e.preventDefault(); const next = Math.min(idx + numCols, list.length - 1); focusedIdxRef.current = next; setFocusedIdx(next);
      } else if (e.key === "ArrowUp" || e.keyCode === 38) {
        e.preventDefault();
        if (idx >= numCols) { const prev = idx - numCols; focusedIdxRef.current = prev; setFocusedIdx(prev); }
        else globalThis.dispatchEvent(new CustomEvent("tv-nav-focus"));
      } else if (e.key === "Enter" || e.keyCode === 13) {
        const item = list[idx]; if (item) onSelectRef.current(item);
      } else if (e.key === "Escape" || e.keyCode === 27) {
        onBackRef.current();
      }
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  }, []);

  const onColsChange = useCallback((c) => { numColsRef.current = c; }, []);

  return { filtered, focusedIdx, onColsChange };
}
