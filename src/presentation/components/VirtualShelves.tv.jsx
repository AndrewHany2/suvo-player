import { useState, useRef, useEffect, useCallback } from "react";
import { shelfWindow, railWindow, clampCol, nearRailEnd } from "./shelfWindow.js";
import HeroTV from "./Hero.tv.jsx";
import { useTVInput } from "../../hooks/useTVInput";
import { colors, fonts, fontWeights } from "../../ui/tokens";
import { ss } from "../../utils/scaleSize";

const SHELF_BUFFER = 1;      // rails above/below focus kept mounted
const VISIBLE_COLS = 6;      // posters visible per rail
const H_BUFFER = 2;          // posters left/right of focus kept mounted
const ROW_HEIGHT = 320;      // px per shelf row (title + poster + padding)
const CARD_W = 200;          // px poster width (matches tvConfig.ui.cardWidth)
const CARD_GAP = 8;
const HERO_DEBOUNCE_MS = 150;

const loadedLen = (s) => (Array.isArray(s?.items) ? s.items.length : 0);

/**
 * 2-D virtualized, D-pad-driven shelf list for TV Movies/Series.
 *
 * Bounds mounted posters on BOTH axes so worst-case decoded-image count stays
 * near ~45 regardless of catalog size or scroll depth (the requirement for the
 * webOS 3-4 / Tizen 2016-18 floor): only shelves in the vertical window mount,
 * and within each mounted rail only a horizontal window of posters mounts.
 * Off-window shelves become fixed-height spacer padding; off-window posters
 * become left/right spacer flex boxes so scroll geometry stays correct.
 */
export function VirtualShelvesTV({ shelves, onShelfVisible, onLoadMore, onSelect, onSeeAll, renderCard }) {
  const containerRef = useRef(null);
  const railRefs = useRef({}); // shelfId -> rail DOM node
  const colMemory = useRef({}); // shelfId -> remembered column
  const [focus, setFocus] = useState({ shelf: 0, col: 0 });
  const [heroItem, setHeroItem] = useState(null);

  const shelfCount = shelves.length;
  const win = shelfWindow(focus.shelf, shelfCount, SHELF_BUFFER);

  // ── Lazy-load shelves entering the vertical window (replaces IntersectionObserver) ──
  useEffect(() => {
    for (let i = win.start; i < win.end; i++) {
      const s = shelves[i];
      if (s && s.items === null) onShelfVisible?.(s.id);
    }
  }, [win.start, win.end, shelves, onShelfVisible]);

  // ── Debounced hero swap on focus change ──
  useEffect(() => {
    const s = shelves[focus.shelf];
    const item = s && Array.isArray(s.items) ? s.items[clampCol(focus.col, loadedLen(s))] : null;
    const t = setTimeout(() => setHeroItem(item || null), HERO_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [focus.shelf, focus.col, shelves]);

  // ── Scroll focused row into view (vertical) + focused card into view (horizontal) ──
  useEffect(() => {
    const el = containerRef.current;
    if (el) {
      const rowTop = focus.shelf * ROW_HEIGHT;
      const rowBottom = rowTop + ROW_HEIGHT;
      if (rowTop < el.scrollTop) el.scrollTop = rowTop;
      else if (rowBottom > el.scrollTop + el.clientHeight) el.scrollTop = rowBottom - el.clientHeight;
    }
    const rail = railRefs.current[shelves[focus.shelf]?.id];
    if (rail) {
      const cardLeft = focus.col * (CARD_W + CARD_GAP);
      const cardRight = cardLeft + CARD_W;
      if (cardLeft < rail.scrollLeft) rail.scrollLeft = cardLeft;
      else if (cardRight > rail.scrollLeft + rail.clientWidth) rail.scrollLeft = cardRight - rail.clientWidth;
    }
  }, [focus, shelves]);

  // ── D-pad ──
  const move = useCallback((dShelf, dCol) => {
    setFocus((prev) => {
      const cur = shelves[prev.shelf];
      if (dCol !== 0) {
        const len = loadedLen(cur);
        const nextCol = clampCol(prev.col + dCol, len);
        colMemory.current[cur?.id] = nextCol;
        if (dCol > 0 && cur?.hasMore && nearRailEnd(nextCol, len)) onLoadMore?.(cur.id);
        return { shelf: prev.shelf, col: nextCol };
      }
      // vertical move: remember current col, restore destination's remembered col
      if (cur) colMemory.current[cur.id] = prev.col;
      const nextShelf = Math.max(0, Math.min(shelfCount - 1, prev.shelf + dShelf));
      const dest = shelves[nextShelf];
      const remembered = colMemory.current[dest?.id] ?? 0;
      return { shelf: nextShelf, col: clampCol(remembered, loadedLen(dest)) };
    });
  }, [shelves, shelfCount, onLoadMore]);

  const { register } = useTVInput();
  useEffect(() => register({
    left: () => move(0, -1),
    right: () => move(0, 1),
    up: () => move(-1, 0),
    down: () => move(1, 0),
    enter: () => {
      const s = shelves[focus.shelf];
      const item = s && Array.isArray(s.items) ? s.items[clampCol(focus.col, loadedLen(s))] : null;
      if (item) onSelect?.(item);
    },
  }, { yieldToNav: true }), [register, move, shelves, focus, onSelect]);

  const paddingTop = win.start * ROW_HEIGHT;
  const paddingBottom = Math.max(0, (shelfCount - win.end)) * ROW_HEIGHT;

  return (
    <div ref={containerRef} className="tvl-shelves-screen"
      style={{ overflowY: "auto", height: "100%", contain: "strict" }}>
      <HeroTV item={heroItem} />
      <div style={{ paddingTop, paddingBottom }}>
        {shelves.slice(win.start, win.end).map((shelf, i) => {
          const shelfIdx = win.start + i;
          const isFocusedShelf = shelfIdx === focus.shelf;
          const items = Array.isArray(shelf.items) ? shelf.items : [];
          const rw = railWindow(focus.col, items.length, VISIBLE_COLS, H_BUFFER, isFocusedShelf);
          const leftPad = rw.start * (CARD_W + CARD_GAP);
          const rightPad = Math.max(0, (items.length - rw.end)) * (CARD_W + CARD_GAP);
          return (
            <div key={shelf.id} style={{ height: ROW_HEIGHT, contain: "layout style paint" }}>
              <div className="tvl-shelf-title-btn"
                onClick={() => onSeeAll?.(shelf.id, shelf.name)}
                style={{ display: "flex", alignItems: "center", gap: ss(4),
                  padding: `${ss(10)}px ${ss(48)}px`, color: colors.text,
                  fontFamily: fonts.display, fontWeight: fontWeights.bold, fontSize: ss(22) }}>
                {shelf.name}
              </div>
              <div ref={(n) => { railRefs.current[shelf.id] = n; }} className="tv-shelf-rail"
                style={{ display: "flex", overflowX: "hidden", gap: CARD_GAP,
                  paddingLeft: ss(48), paddingRight: ss(48) }}>
                <div style={{ flex: `0 0 ${leftPad}px` }} />
                {items.slice(rw.start, rw.end).map((item, j) => {
                  const col = rw.start + j;
                  const isFocused = isFocusedShelf && col === focus.col;
                  return (
                    <div key={String(item.stream_id ?? item.id ?? col)} style={{ flex: `0 0 ${CARD_W}px` }}>
                      {renderCard(item, isFocused)}
                    </div>
                  );
                })}
                <div style={{ flex: `0 0 ${rightPad}px` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
