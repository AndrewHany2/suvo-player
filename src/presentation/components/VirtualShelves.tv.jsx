import { useState, useRef, useEffect, useCallback } from "react";
import { scrollAnchor, windowFromAnchor, clampCol, nearRailEnd, railEdges } from "./shelfWindow.js";
import HeroTV from "./Hero.tv.jsx";
import Icon from "../../ui/Icon";
import { useTVInput } from "../../hooks/useTVInput";
import { colors, fonts, fontWeights } from "../../ui/tokens";
import { ss } from "../../utils/scaleSize";
import { posterUrl, prefetchImage } from "../../utils/imagePrefetch";

const SHELF_OVERSCAN = 1;    // shelves kept mounted above/below the visible page
const H_OVERSCAN = 3;        // posters kept mounted ahead of the scroll on each side (focused rail)
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
export function VirtualShelvesTV({ shelves, onShelfVisible, onLoadMore, onSelect, onSeeAll, renderCard, showHero = true, onUpAtTop, onBack }) {
  // Hero billboard is optional (Home reuses this shelf without one). When off,
  // its height drops out of the anchor-rows measurement and the scroll offset.
  const heroH = showHero ? HERO_H : 0;
  const containerRef = useRef(null);
  const railRefs = useRef({});        // shelfId -> rail DOM node
  const focusedCardRef = useRef(null); // DOM node of the currently focused card
  const colMemory = useRef({});       // shelfId -> remembered column
  const railScrollLeft = useRef({}); // shelfId -> last scrollLeft, restored when an idle rail remounts
  const [focus, setFocus] = useState({ shelf: 0, col: 0, shelfAnchor: 0 });
  const [heroItem, setHeroItem] = useState(null);
  // shelfId -> { left, right }: which scroll-hint edges to show, derived from the
  // rail's REAL scroll geometry so the "more →" fade clears exactly at the end
  // (the floored dims.cols estimate kept it on, hiding the last poster).
  const [railEdge, setRailEdge] = useState({});

  // Viewport-derived counts. `cols`/`windowRows` size the mount window; `anchorRows`
  // (rows visible below the hero) drives when the vertical scroll advances so the
  // focused row is always brought into view.
  const [dims, setDims] = useState({ cols: 8, windowRows: 3, anchorRows: 2 });
  const dimsRef = useRef(dims);

  const shelfCount = shelves.length;

  // Keep focus in range when the shelves prop mutates — Home's Favorites/History
  // rails shrink as items are removed, and a stale focus would point past the end.
  useEffect(() => {
    setFocus((prev) => {
      const shelf = Math.min(prev.shelf, Math.max(0, shelfCount - 1));
      const col = clampCol(prev.col, loadedLen(shelves[shelf]));
      return shelf === prev.shelf && col === prev.col ? prev : { ...prev, shelf, col };
    });
  }, [shelfCount, shelves]);

  useEffect(() => {
    const measure = () => {
      const el = containerRef.current;
      if (!el) return;
      const cw = el.clientWidth || 0;
      const ch = el.clientHeight || 0;
      // ceil, not floor: count the partially-visible card at the right edge too,
      // so the mount window reaches it (+overscan) and a short rail mounts fully
      // up front instead of leaving the last poster as a blank spacer.
      const cols = Math.max(1, Math.ceil((cw - 2 * ss(PAD)) / STRIDE));
      const windowRows = Math.max(1, Math.ceil(ch / ROW_HEIGHT));
      const anchorRows = Math.max(1, Math.floor((ch - ss(heroH)) / ROW_HEIGHT));
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

  // ── Warm poster caches ahead of the mount window ──
  // TV browsers only fetch an <img> when its card mounts, so revealed posters
  // flash blank while they download. Prefetch the posters just ahead of the
  // cursor in the focused rail and the leading posters of rows entering the
  // vertical window, so cards mount already-decoded and paint instantly.
  useEffect(() => {
    const ahead = dims.cols + H_OVERSCAN;
    const s = shelves[focus.shelf];
    if (Array.isArray(s?.items)) {
      for (let c = focus.col; c < Math.min(s.items.length, focus.col + ahead); c++)
        prefetchImage(posterUrl(s.items[c]));
    }
    for (let r = vWin.start; r < vWin.end; r++) {
      const row = shelves[r];
      if (!Array.isArray(row?.items)) continue;
      for (let c = 0; c < Math.min(row.items.length, dims.cols + H_OVERSCAN); c++)
        prefetchImage(posterUrl(row.items[c]));
    }
  }, [focus.shelf, focus.col, vWin.start, vWin.end, shelves, dims.cols]);

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
    if (el) el.scrollTop = focus.shelfAnchor <= 0 ? 0 : ss(heroH) + focus.shelfAnchor * ROW_HEIGHT;

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
      node.scrollLeft = railScrollLeft.current[id] ?? 0;
    }
  }, [focus, shelves, dims]);

  // Track chevron hint edges + raw scrollLeft from a rail's real geometry. No
  // window anchoring — rails mount all their loaded items now.
  const onRailScroll = useCallback((id) => (e) => {
    const t = e.currentTarget;
    railScrollLeft.current[id] = t.scrollLeft;
    const edges = railEdges({ scrollLeft: t.scrollLeft, clientWidth: t.clientWidth, scrollWidth: t.scrollWidth });
    setRailEdge((m) => (m[id] && m[id].left === edges.left && m[id].right === edges.right ? m : { ...m, [id]: edges }));
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
      // Up on the top shelf yields to the caller (e.g. focus the navbar) when a
      // handler is supplied, instead of clamping in place.
      if (dShelf < 0 && prev.shelf === 0 && onUpAtTop) { onUpAtTop(); return prev; }
      // vertical move: remember current rail's col, restore destination's
      if (cur) colMemory.current[cur.id] = prev.col;
      const nextShelf = Math.max(0, Math.min(shelfCount - 1, prev.shelf + dShelf));
      const dest = shelves[nextShelf];
      const col = clampCol(colMemory.current[dest?.id] ?? 0, loadedLen(dest));
      const shelfAnchor = scrollAnchor(prev.shelfAnchor, nextShelf, dimsRef.current.anchorRows, shelfCount);
      return { shelf: nextShelf, col, shelfAnchor };
    });
  }, [shelves, shelfCount, onLoadMore, onUpAtTop]);

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
    ...(onBack ? { back: () => onBack() } : {}),
  }, { yieldToNav: true }), [register, move, shelves, focus, onSelect, onBack]);

  const paddingTop = vWin.start * ROW_HEIGHT;
  const paddingBottom = Math.max(0, (shelfCount - vWin.end)) * ROW_HEIGHT;

  return (
    <div ref={containerRef} className="tvl-shelves-screen"
      style={{ overflowY: "auto", height: "100%", contain: "strict" }}>
      {showHero && <HeroTV item={heroItem} />}
      <div style={{ paddingTop, paddingBottom }}>
        {shelves.slice(vWin.start, vWin.end).map((shelf, i) => {
          const shelfIdx = vWin.start + i;
          const isFocusedShelf = shelfIdx === focus.shelf;
          const items = Array.isArray(shelf.items) ? shelf.items : [];
          // Scroll-hint chevrons: driven by the rail's REAL scroll geometry once
          // it has scrolled (railEdge). Before the first scroll event, fall back
          // to a coarse estimate (at start; overflow if more items than fit).
          const edge = railEdge[shelf.id];
          const moreLeft = edge ? edge.left : false;
          const moreRight = edge ? edge.right : items.length > dims.cols;
          const wrapCls = ["tvl-shelf-rowwrap", moreLeft && "more-left", moreRight && "more-right"]
            .filter(Boolean).join(" ");
          return (
            <div key={shelf.id} style={{ height: ROW_HEIGHT, contain: "layout style paint" }}>
              <div className={onSeeAll ? "tvl-shelf-title-btn" : undefined}
                onClick={onSeeAll ? () => onSeeAll(shelf.id, shelf.name) : undefined}
                style={{ display: "flex", alignItems: "center", gap: ss(4),
                  padding: `${ss(10)}px ${ss(48)}px`, color: colors.text,
                  fontFamily: fonts.display, fontWeight: fontWeights.bold, fontSize: ss(22) }}>
                {shelf.name}
              </div>
              <div className={wrapCls}>
              <div ref={(n) => { railRefs.current[shelf.id] = n; }} className="tv-shelf-rail"
                onScroll={onRailScroll(shelf.id)}
                style={{ display: "flex", overflowX: "auto", overflowY: "hidden", gap: CARD_GAP,
                  paddingLeft: ss(48), paddingRight: ss(48), scrollbarWidth: "none" }}>
                {items.map((item, col) => {
                  const isFocused = isFocusedShelf && col === focus.col;
                  // Key by absolute column, NOT by stream_id/id: IPTV catalogs can
                  // carry duplicate stream_ids, and a duplicate key makes React drop
                  // one card. Column index is unique within a rail and stable
                  // (items only ever append).
                  return (
                    <div key={col}
                      ref={isFocused ? focusedCardRef : null}
                      style={{ flex: `0 0 ${CARD_W}px` }}>
                      {renderCard(item, isFocused)}
                    </div>
                  );
                })}
              </div>
              <span className="tvl-shelf-chev tvl-shelf-chev--left" aria-hidden="true">
                <Icon name="chevron-right" size={26} color="#fff" />
              </span>
              <span className="tvl-shelf-chev tvl-shelf-chev--right" aria-hidden="true">
                <Icon name="chevron-right" size={26} color="#fff" />
              </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
