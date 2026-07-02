import { useState, useRef, useEffect, useCallback } from "react";
import { scrollAnchor, windowFromAnchor, focusedRailWindow, clampCol, nearRailEnd } from "./shelfWindow.js";
import HeroTV from "./Hero.tv.jsx";
import { useTVInput } from "../../hooks/useTVInput";
import { colors, fonts, fontWeights } from "../../ui/tokens";
import { ss } from "../../utils/scaleSize";

const SHELF_OVERSCAN = 1;    // shelves kept mounted above/below the visible page
const H_OVERSCAN = 3;        // posters kept mounted ahead of the scroll on each side (focused rail)
const IDLE_OVERSCAN = 3;     // keep the same lead in idle rails so no shelf blanks at its edge
const ROW_HEIGHT = 320;      // px per shelf row (title + poster + padding)
const CARD_W = 200;          // px poster width (matches tvConfig.ui.cardWidth)
const CARD_GAP = 8;
const STRIDE = CARD_W + CARD_GAP;
const PAD = 48;              // rail horizontal inset (design px)
const HERO_H = 300;          // Hero.tv billboard height (design px), lives inside the scroll box
const HERO_DEBOUNCE_MS = 150;

const loadedLen = (s) => (Array.isArray(s?.items) ? s.items.length : 0);

/**
 * 2-D virtualized, D-pad-driven shelf list for TV Movies/Series.
 *
 * Bounds mounted posters on BOTH axes so worst-case decoded-image count stays
 * bounded regardless of catalog size or scroll depth (the requirement for the
 * webOS 3-4 / Tizen 2016-18 floor).
 *
 * The mount window is derived from the SCROLL position (which rows/posters are
 * actually on screen), never straight from the focused index — anchoring to
 * focus makes the window slide ahead of the scroll, unmounting still-visible
 * posters and dropping blank spacer padding in their place.
 *
 * Horizontal scroll uses the focused card's REAL DOM position (offsetLeft) for
 * scroll-into-view and reads the window anchor back from the rail's real
 * scrollLeft. This is robust to the exact poster/viewport geometry (gaps, insets,
 * responsive scaling), so the first poster never blanks and the LAST poster lands
 * flush at the end of the rail instead of leaving dead space.
 */
export function VirtualShelvesTV({ shelves, onShelfVisible, onLoadMore, onSelect, onSeeAll, renderCard }) {
  const containerRef = useRef(null);
  const railRefs = useRef({});        // shelfId -> rail DOM node
  const focusedCardRef = useRef(null); // DOM node of the currently focused card
  const colMemory = useRef({});       // shelfId -> remembered column
  const [focus, setFocus] = useState({ shelf: 0, col: 0, shelfAnchor: 0 });
  const [heroItem, setHeroItem] = useState(null);
  // shelfId -> index of the first poster currently visible in that rail, read
  // back from the rail's real scrollLeft. Drives the horizontal mount window.
  const [railFirst, setRailFirst] = useState({});
  const railFirstRef = useRef(railFirst);
  railFirstRef.current = railFirst;

  // Viewport-derived counts. `cols`/`windowRows` size the mount window; `anchorRows`
  // (rows visible below the hero) drives when the vertical scroll advances so the
  // focused row is always brought into view.
  const [dims, setDims] = useState({ cols: 8, windowRows: 3, anchorRows: 2 });
  const dimsRef = useRef(dims);

  const shelfCount = shelves.length;

  useEffect(() => {
    const measure = () => {
      const el = containerRef.current;
      if (!el) return;
      const cw = el.clientWidth || 0;
      const ch = el.clientHeight || 0;
      const cols = Math.max(1, Math.floor((cw - 2 * ss(PAD)) / STRIDE));
      const windowRows = Math.max(1, Math.ceil(ch / ROW_HEIGHT));
      const anchorRows = Math.max(1, Math.floor((ch - ss(HERO_H)) / ROW_HEIGHT));
      const next = { cols, windowRows, anchorRows };
      dimsRef.current = next;
      setDims(next);
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (ro && containerRef.current) ro.observe(containerRef.current);
    globalThis.addEventListener?.("resize", measure);
    return () => { ro?.disconnect(); globalThis.removeEventListener?.("resize", measure); };
  }, []);

  const vWin = windowFromAnchor(focus.shelfAnchor, shelfCount, dims.windowRows, SHELF_OVERSCAN);

  // ── Lazy-load shelves entering the vertical window (replaces IntersectionObserver) ──
  useEffect(() => {
    for (let i = vWin.start; i < vWin.end; i++) {
      const s = shelves[i];
      if (s && s.items === null) onShelfVisible?.(s.id);
    }
  }, [vWin.start, vWin.end, shelves, onShelfVisible]);

  // ── Debounced hero swap on focus change ──
  useEffect(() => {
    const s = shelves[focus.shelf];
    const item = s && Array.isArray(s.items) ? s.items[clampCol(focus.col, loadedLen(s))] : null;
    const t = setTimeout(() => setHeroItem(item || null), HERO_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [focus.shelf, focus.col, shelves]);

  // ── Apply scroll (vertical container + focused rail) from the current focus ──
  useEffect(() => {
    const el = containerRef.current;
    // Vertical: bring the focused row's top to the viewport (accounting for the
    // Hero, which lives inside the scroll box above the rows).
    if (el) el.scrollTop = focus.shelfAnchor <= 0 ? 0 : ss(HERO_H) + focus.shelfAnchor * ROW_HEIGHT;

    const focusedId = shelves[focus.shelf]?.id;
    const rail = railRefs.current[focusedId];
    const card = focusedCardRef.current;
    if (rail && card) {
      // Horizontal scroll-into-view using the card's REAL geometry. At the end of
      // the rail `right + pad - clientWidth` is clamped by the browser to the max
      // scroll, so the last poster lands flush with no trailing dead space.
      const pad = ss(PAD);
      const left = card.offsetLeft;
      const right = left + card.offsetWidth;
      if (left - pad < rail.scrollLeft) rail.scrollLeft = Math.max(0, left - pad);
      else if (right + pad > rail.scrollLeft + rail.clientWidth) rail.scrollLeft = right + pad - rail.clientWidth;
    }
    // Idle rails may have just remounted (scrollLeft reset to 0) — restore them to
    // their remembered first-visible poster so their window and scroll agree.
    for (const [id, node] of Object.entries(railRefs.current)) {
      if (!node || id === focusedId) continue;
      node.scrollLeft = (railFirstRef.current[id] ?? 0) * STRIDE;
    }
  }, [focus, shelves, dims]);

  // Read the window anchor back from a rail's real scrollLeft as it scrolls.
  const onRailScroll = useCallback((id) => (e) => {
    const first = Math.max(0, Math.round(e.currentTarget.scrollLeft / STRIDE));
    setRailFirst((m) => (m[id] === first ? m : { ...m, [id]: first }));
  }, []);

  // ── D-pad ──
  const move = useCallback((dShelf, dCol) => {
    setFocus((prev) => {
      const cur = shelves[prev.shelf];
      if (dCol !== 0) {
        const len = loadedLen(cur);
        const nextCol = clampCol(prev.col + dCol, len);
        if (cur) colMemory.current[cur.id] = nextCol;
        if (dCol > 0 && cur?.hasMore && nearRailEnd(nextCol, len)) onLoadMore?.(cur.id);
        return { ...prev, col: nextCol };
      }
      // vertical move: remember current rail's col, restore destination's
      if (cur) colMemory.current[cur.id] = prev.col;
      const nextShelf = Math.max(0, Math.min(shelfCount - 1, prev.shelf + dShelf));
      const dest = shelves[nextShelf];
      const col = clampCol(colMemory.current[dest?.id] ?? 0, loadedLen(dest));
      const shelfAnchor = scrollAnchor(prev.shelfAnchor, nextShelf, dimsRef.current.anchorRows, shelfCount);
      return { shelf: nextShelf, col, shelfAnchor };
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

  const paddingTop = vWin.start * ROW_HEIGHT;
  const paddingBottom = Math.max(0, (shelfCount - vWin.end)) * ROW_HEIGHT;

  return (
    <div ref={containerRef} className="tvl-shelves-screen"
      style={{ overflowY: "auto", height: "100%", contain: "strict" }}>
      <HeroTV item={heroItem} />
      <div style={{ paddingTop, paddingBottom }}>
        {shelves.slice(vWin.start, vWin.end).map((shelf, i) => {
          const shelfIdx = vWin.start + i;
          const isFocusedShelf = shelfIdx === focus.shelf;
          const items = Array.isArray(shelf.items) ? shelf.items : [];
          const first = railFirst[shelf.id] ?? 0;
          const rw = isFocusedShelf
            ? focusedRailWindow(first, focus.col, items.length, dims.cols, H_OVERSCAN)
            : windowFromAnchor(first, items.length, dims.cols, IDLE_OVERSCAN);
          const leftPad = rw.start * STRIDE;
          const rightPad = Math.max(0, (items.length - rw.end)) * STRIDE;
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
                onScroll={onRailScroll(shelf.id)}
                style={{ display: "flex", overflowX: "hidden", gap: CARD_GAP,
                  paddingLeft: ss(48), paddingRight: ss(48) }}>
                <div style={{ flex: `0 0 ${leftPad}px` }} />
                {items.slice(rw.start, rw.end).map((item, j) => {
                  const col = rw.start + j;
                  const isFocused = isFocusedShelf && col === focus.col;
                  // Key by absolute column, NOT by stream_id/id: IPTV catalogs can
                  // carry duplicate stream_ids, and a duplicate key makes React drop
                  // one card (e.g. the last poster of the shelf). Column index is
                  // unique within a rail and stable (items only ever append).
                  return (
                    <div key={col}
                      ref={isFocused ? focusedCardRef : null}
                      style={{ flex: `0 0 ${CARD_W}px` }}>
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
