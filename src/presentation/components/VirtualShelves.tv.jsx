import { useState, useRef, useEffect, useCallback } from "react";
import {
  scrollAnchor,
  windowFromAnchor,
  computeWindow,
  clampCol,
  railEdges,
} from "./shelfWindow.js";
import { getShelfConfig } from "../virtualization/shelfConfig.js";
import HeroTV from "./Hero.tv.jsx";
import DiscoverPills from "./DiscoverPills.web";
import { enterTopFromShelves, zoneMove, zoneActivate } from "./heroZone.js";
import Icon from "../../ui/Icon";
import { useTVInput } from "../../hooks/useTVInput";
import { colors, fonts, fontWeights } from "../../ui/tokens";
import { ss, useScale } from "../../utils/scaleSize";
import { posterUrl, prefetchImage } from "../../utils/imagePrefetch";

const SHELF_OVERSCAN = 8; // shelves kept mounted above/below the visible page
// Design px (authored at the 1920 reference); ss() scales them for the pinned
// 1280 TV viewport that the browser upscales ×1.5 — matching web proportions.
const POSTER_W = 340; // design px — sized so ~5 posters show per rail in one view
const CARD_GAP_D = 8; // design px gap — matches ContentShelf.web
const PAD_D = 48; // design px rail horizontal inset
const TITLE_H_D = 34; // design px poster title block (PosterCard.web: 2-line clamp)
// Row = header + poster (width×1.5) + title + breathing room, all in design px.
const ROW_HEIGHT_D = 40 + Math.round(POSTER_W * 1.5) + TITLE_H_D + 28;
const HERO_H = 900; // Hero.web billboard height falls out of tokens.heroHeights.tv; this
// constant is used only as the fallback when the rails-top can't be measured.

const PAD = PAD_D; // kept as design px; call sites wrap it in ss(PAD)
const HERO_DEBOUNCE_MS = 150;

const loadedLen = (s) => (Array.isArray(s?.items) ? s.items.length : 0);

/**
 * D-pad-driven shelf list for TV Movies/Series.
 *
 * Both axes are windowed, and both windows are anchored ONLY on the deterministic
 * D-pad focus index (never on an async scrollLeft/scrollTop read). On TV the
 * scroll position is DERIVED FROM focus (the Apply-scroll effect sets
 * scrollTop/scrollLeft from focus), so a focus-anchored window cannot slide ahead
 * of the real scroll — the focused card/row is inside the window by construction.
 * This is the structural fix for the 2026-07-02 blank-poster bug, which came from
 * windowing driven by scroll reads that lagged/led the real scroll.
 *
 * VERTICAL axis: `fetchWin` (via windowFromAnchor, anchored on focus.shelfAnchor
 * which the move handler maintains edge-based via scrollAnchor) gates BOTH render
 * and fetch/prefetch. Only rows in the window mount; top/bottom spacer divs sized
 * from ROW_HEIGHT stand in for the skipped rows so scroll geometry stays exact.
 *
 * HORIZONTAL axis: each rendered rail windows its FULL loaded array. The per-rail
 * anchor comes from the column focus (live focus.col on the focused rail, the
 * remembered column on idle rails) through scrollAnchor, then computeWindow adds
 * overscan. Left/right flex spacers sized from STRIDE stand in for the off-window
 * posters. Horizontal scroll-into-view uses the focused card's REAL DOM position
 * (offsetLeft) — a read used only to position the scroll, never to size the
 * window. Chevron hints read the rail's real scroll geometry (railEdges).
 */
export function VirtualShelvesTV({
  shelves,
  onShelfVisible,
  onLoadMore,
  onSelect,
  onSeeAll,
  renderCard,
  showHero = true,
  onUpAtTop,
  onBack,
  renderHero,
  discoverItems,
  onPill,
  onHeroPlay,
  onHeroDetails,
  featuredItem,
}) {
  // Hero billboard is optional (Home reuses this shelf without one). When off,
  // its height drops out of the anchor-rows measurement and the scroll offset.
  const heroH = showHero ? HERO_H : 0;

  // Scaled (px) layout values used at render time. Computed HERE (not at module
  // scope) so they track the live SCALE: on a webOS cold start the app window is
  // sized AFTER the bundle runs, so a module-load ss() would freeze at scale 1.
  // useScale() subscribes this component to SCALE corrections and re-renders it,
  // and ss() reads the corrected SCALE on that re-render. See scaleSize.js.
  const scale = useScale();
  const cfg = getShelfConfig("tv"); // hOverscan for the horizontal rail window
  const CARD_W = ss(POSTER_W);
  const CARD_GAP = ss(CARD_GAP_D);
  const STRIDE = CARD_W + CARD_GAP;
  const ROW_HEIGHT = ss(ROW_HEIGHT_D);
  const containerRef = useRef(null);
  const railRefs = useRef({}); // shelfId -> rail DOM node
  const focusedCardRef = useRef(null); // DOM node of the currently focused card
  const colMemory = useRef({}); // shelfId -> remembered column
  const railAnchorRef = useRef({}); // shelfId -> per-rail horizontal window anchor (hysteresis)
  const railScrollLeft = useRef({}); // shelfId -> last scrollLeft, kept in sync from onRailScroll
  const [focus, setFocus] = useState({ shelf: 0, col: 0, shelfAnchor: 0 });
  // Focus zones ABOVE the shelves (Hero buttons, Discover pills). zone:"shelves"
  // means focus is in the rails (handled by `focus`/`move`). Prop-gated: Home
  // passes neither renderHero-interactivity nor discoverItems, so both zones are
  // disabled and Up-at-top yields to the navbar exactly as before.
  const [topFocus, setTopFocus] = useState({
    zone: "shelves",
    heroBtn: 0,
    pillCol: 0,
  });
  const railsRef = useRef(null); // wraps the shelf rows; offsetTop = hero+pills height
  const [heroItem, setHeroItem] = useState(null);
  // shelfId -> { left, right }: which scroll-hint edges to show, derived from the
  // rail's REAL scroll geometry so the "more →" fade clears exactly at the end
  // (the floored dims.cols estimate kept it on, hiding the last poster).
  const [railEdge, setRailEdge] = useState({});

  // Viewport-derived counts. `cols`/`windowRows` size the fetch/prefetch range; `anchorRows`
  // (rows visible below the hero) drives when the vertical scroll advances so the
  // focused row is always brought into view.
  const [dims, setDims] = useState({ cols: 8, windowRows: 3, anchorRows: 2 });
  const dimsRef = useRef(dims);

  const shelfCount = shelves.length;

  const heroInteractive = !!renderHero && (!!onHeroPlay || !!onHeroDetails);
  const pills = Array.isArray(discoverItems) ? discoverItems : [];
  const zoneCfg = {
    hasHero: showHero && heroInteractive,
    hasPills: pills.length > 0,
    pillCount: pills.length,
  };

  // Keep focus in range when the shelves prop mutates — Home's Favorites/History
  // rails shrink as items are removed, and a stale focus would point past the end.
  useEffect(() => {
    setFocus((prev) => {
      const shelf = Math.min(prev.shelf, Math.max(0, shelfCount - 1));
      const col = clampCol(prev.col, loadedLen(shelves[shelf]));
      return shelf === prev.shelf && col === prev.col
        ? prev
        : { ...prev, shelf, col };
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
      const railsTop = railsRef.current?.offsetTop ?? ss(heroH);
      const anchorRows = Math.max(1, Math.floor((ch - railsTop) / ROW_HEIGHT));
      const next = { cols, windowRows, anchorRows };
      dimsRef.current = next;
      setDims(next);
    };
    measure();
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(measure)
        : null;
    if (ro && containerRef.current) ro.observe(containerRef.current);
    globalThis.addEventListener?.("resize", measure);
    return () => {
      ro?.disconnect();
      globalThis.removeEventListener?.("resize", measure);
    };
    // `scale` in deps: measure() reads STRIDE/ROW_HEIGHT from the render scope, so
    // re-run it when the scale corrects (webOS cold start) to recompute cols/rows.
  }, [scale]);

  // Visible-row range around the current focus. On TV the vertical scroll is
  // derived from focus (see the Apply-scroll effect), so this tracks where the
  // user is. It gates BOTH render and fetch/prefetch: the render below mounts
  // only shelves.slice(fetchWin.start, fetchWin.end) between top/bottom spacers.
  // Because focus.shelfAnchor is maintained edge-based (scrollAnchor in `move`),
  // the window is focus-anchored and cannot slide ahead of the derived scroll.
  const fetchWin = windowFromAnchor(
    focus.shelfAnchor,
    shelfCount,
    dims.windowRows,
    SHELF_OVERSCAN,
  );

  // ── Lazy-load shelves entering the fetch range (replaces IntersectionObserver) ──
  useEffect(() => {
    for (let i = fetchWin.start; i < fetchWin.end; i++) {
      const s = shelves[i];
      if (s && s.items === null) onShelfVisible?.(s.id);
    }
  }, [fetchWin.start, fetchWin.end, shelves, onShelfVisible]);

  // ── Raw vertical scroll (wheel/trackpad) also loads categories in view ──
  // The remote path advances `focus` (which drives fetchWin above); a raw scroll
  // bypasses focus, so without this a user scrolling down past the focused row
  // would reveal rows that never fetch their items. Derive the visible row range
  // from scrollTop and lazy-load anything in it (onShelfVisible is idempotent —
  // the screen guards against re-fetching an already-loaded shelf).
  const onContainerScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const railsTop = railsRef.current?.offsetTop ?? ss(heroH);
    const rowH = ss(ROW_HEIGHT_D) || 1;
    const topRow = Math.floor(Math.max(0, el.scrollTop - railsTop) / rowH);
    const start = Math.max(0, topRow - SHELF_OVERSCAN);
    const end = Math.min(
      shelves.length,
      topRow + dimsRef.current.windowRows + SHELF_OVERSCAN,
    );
    for (let i = start; i < end; i++) {
      const s = shelves[i];
      if (s && s.items === null) onShelfVisible?.(s.id);
    }
  }, [shelves, heroH, onShelfVisible]);

  // ── Warm poster caches ahead of the fetch range ──
  // TV browsers only fetch an <img> when its card mounts, so revealed posters
  // flash blank while they download. Prefetch the posters just ahead of the
  // cursor in the focused rail and the leading posters of rows near the
  // viewport, so cards mount already-decoded and paint instantly.
  useEffect(() => {
    const ahead = dims.cols + cfg.hOverscan;
    const s = shelves[focus.shelf];
    if (Array.isArray(s?.items)) {
      for (
        let c = focus.col;
        c < Math.min(s.items.length, focus.col + ahead);
        c++
      )
        prefetchImage(posterUrl(s.items[c]));
    }
    for (let r = fetchWin.start; r < fetchWin.end; r++) {
      const row = shelves[r];
      if (!Array.isArray(row?.items)) continue;
      for (
        let c = 0;
        c < Math.min(row.items.length, dims.cols + cfg.hOverscan);
        c++
      )
        prefetchImage(posterUrl(row.items[c]));
    }
  }, [
    focus.shelf,
    focus.col,
    fetchWin.start,
    fetchWin.end,
    shelves,
    dims.cols,
  ]);

  // ── Hero item ──
  // When the screen supplies a `featuredItem` (the TV "featured billboard": a
  // fixed random title), the hero pins to it and does NOT follow focus. Only
  // when no featuredItem is provided does the legacy behaviour apply — the hero
  // debounce-swaps to whatever poster is currently focused.
  useEffect(() => {
    if (featuredItem !== undefined) {
      setHeroItem(featuredItem || null);
      return;
    }
    const s = shelves[focus.shelf];
    const item =
      s && Array.isArray(s.items)
        ? s.items[clampCol(focus.col, loadedLen(s))]
        : null;
    const t = setTimeout(() => setHeroItem(item || null), HERO_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [featuredItem, focus.shelf, focus.col, shelves]);

  // ── Apply scroll (vertical container + focused rail) from the current focus ──
  useEffect(() => {
    const el = containerRef.current;
    // Vertical: bring the focused row's top to the viewport (accounting for the
    // Hero, which lives inside the scroll box above the rows).
    // Rails start below the hero + pills; measure their real top so the scroll
    // offset is correct regardless of whether pills are shown.
    const railsTop = railsRef.current?.offsetTop ?? ss(heroH);
    if (el)
      el.scrollTop =
        focus.shelfAnchor <= 0 ? 0 : railsTop + focus.shelfAnchor * ROW_HEIGHT;

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
      if (left - pad < rail.scrollLeft)
        rail.scrollLeft = Math.max(0, left - pad);
      else if (right + pad > rail.scrollLeft + rail.clientWidth)
        rail.scrollLeft = right + pad - rail.clientWidth;
    }
    // Idle (non-focused) rails: reassert their remembered scrollLeft. Rows no
    // longer unmount, so this is normally a redundant idempotent write; kept as a
    // cheap safety net in case a rail's node scroll was reset externally.
    for (const [id, node] of Object.entries(railRefs.current)) {
      if (!node || id === focusedId) continue;
      node.scrollLeft = railScrollLeft.current[id] ?? 0;
    }
    // `scale` in deps: this effect's vertical scroll math uses ROW_HEIGHT, so a
    // scale correction must re-run it with the corrected value. It already tracks
    // `dims` (which changes when measure re-runs), but `scale` makes it explicit
    // and independent of ResizeObserver timing.
  }, [focus, shelves, dims, scale]);

  // Track chevron hint edges + raw scrollLeft from a rail's real geometry. This
  // is UI/edge-hint state ONLY — it never feeds the mount window (that is
  // focus-anchored via scrollAnchor). scrollLeft is also used to restore idle
  // rails in the Apply-scroll effect.
  const onRailScroll = useCallback(
    (id) => (e) => {
      const t = e.currentTarget;
      railScrollLeft.current[id] = t.scrollLeft;
      const edges = railEdges({
        scrollLeft: t.scrollLeft,
        clientWidth: t.clientWidth,
        scrollWidth: t.scrollWidth,
      });
      setRailEdge((m) =>
        m[id] && m[id].left === edges.left && m[id].right === edges.right
          ? m
          : { ...m, [id]: edges },
      );
    },
    [],
  );

  // ── D-pad ──
  const move = useCallback(
    (dShelf, dCol) => {
      setFocus((prev) => {
        const cur = shelves[prev.shelf];
        if (dCol !== 0) {
          const len = loadedLen(cur);
          const nextCol = clampCol(prev.col + dCol, len);
          if (cur) colMemory.current[cur.id] = nextCol;
          // Load-more intentionally disabled: the rail renders a focus-anchored
          // window over the FULL loaded array (see the rail map below), and
          // Task 4 makes hasMore false, so there is nothing to page in.
          return { ...prev, col: nextCol };
        }
        // Up on the top shelf yields to the caller (e.g. focus the navbar) when a
        // handler is supplied, instead of clamping in place.
        if (dShelf < 0 && prev.shelf === 0 && onUpAtTop) {
          onUpAtTop();
          return prev;
        }
        // vertical move: remember current rail's col, restore destination's
        if (cur) colMemory.current[cur.id] = prev.col;
        const nextShelf = Math.max(
          0,
          Math.min(shelfCount - 1, prev.shelf + dShelf),
        );
        const dest = shelves[nextShelf];
        const col = clampCol(colMemory.current[dest?.id] ?? 0, loadedLen(dest));
        const shelfAnchor = scrollAnchor(
          prev.shelfAnchor,
          nextShelf,
          dimsRef.current.anchorRows,
          shelfCount,
        );
        return { shelf: nextShelf, col, shelfAnchor };
      });
    },
    [shelves, shelfCount, onLoadMore, onUpAtTop],
  );

  const { register } = useTVInput();

  // Apply a hero/pills-zone move; handle the escape actions (navbar / shelves).
  const applyZoneMove = useCallback(
    (dir) => {
      const res = zoneMove(topFocus, dir, zoneCfg);
      if (res.action === "toNavbar") {
        setTopFocus({
          zone: "shelves",
          heroBtn: topFocus.heroBtn,
          pillCol: topFocus.pillCol,
        });
        onUpAtTop?.();
        return;
      }
      if (res.action === "toShelves") {
        setTopFocus({ ...res.state, zone: "shelves" });
        return;
      }
      setTopFocus(res.state);
    },
    [topFocus, zoneCfg, onUpAtTop],
  );

  useEffect(
    () =>
      register(
        {
          left: () =>
            topFocus.zone !== "shelves" ? applyZoneMove("left") : move(0, -1),
          right: () =>
            topFocus.zone !== "shelves" ? applyZoneMove("right") : move(0, 1),
          up: () => {
            if (topFocus.zone !== "shelves") return applyZoneMove("up");
            // At the top shelf, climb into the top zones if any exist.
            if (focus.shelf === 0) {
              const z = enterTopFromShelves(zoneCfg);
              if (z) return setTopFocus((t) => ({ ...t, zone: z }));
              if (onUpAtTop) return onUpAtTop();
            }
            move(-1, 0);
          },
          down: () =>
            topFocus.zone !== "shelves" ? applyZoneMove("down") : move(1, 0),
          enter: () => {
            if (topFocus.zone !== "shelves") {
              const what = zoneActivate(topFocus);
              if (what === "play") onHeroPlay?.(heroItem);
              else if (what === "details") onHeroDetails?.(heroItem);
              else if (what === "pill") onPill?.(pills[topFocus.pillCol]);
              return;
            }
            const s = shelves[focus.shelf];
            const item =
              s && Array.isArray(s.items)
                ? s.items[clampCol(focus.col, loadedLen(s))]
                : null;
            if (item) onSelect?.(item);
          },
          ...(onBack ? { back: () => onBack() } : {}),
        },
        { yieldToNav: true },
      ),
    [
      register,
      move,
      shelves,
      focus,
      onSelect,
      onBack,
      topFocus,
      applyZoneMove,
      zoneCfg,
      onUpAtTop,
      onHeroPlay,
      onHeroDetails,
      onPill,
      pills,
      heroItem,
    ],
  );

  return (
    <div
      ref={containerRef}
      className="tvl-shelves-screen"
      onScroll={onContainerScroll}
      style={{ overflowY: "auto", height: "100%", contain: "strict" }}
    >
      {showHero &&
        (renderHero ? (
          renderHero(heroItem, {
            focusedButton:
              topFocus.zone === "hero"
                ? topFocus.heroBtn === 0
                  ? "play"
                  : "details"
                : null,
          })
        ) : (
          <HeroTV item={heroItem} height={HERO_H} />
        ))}
      {zoneCfg.hasPills && (
        <div style={{ padding: `${ss(36)}px ${ss(PAD)}px ${ss(20)}px` }}>
          <DiscoverPills
            items={pills}
            focusedCol={topFocus.zone === "pills" ? topFocus.pillCol : -1}
            onSelect={(pill) => onPill?.(pill)}
          />
        </div>
      )}
      <div ref={railsRef}>
        {/* Top spacer stands in for the shelves skipped above the window, so
            railsRef.offsetTop and scrollTop = railsTop + shelfAnchor*ROW_HEIGHT
            stay exact. */}
        <div style={{ height: fetchWin.start * ROW_HEIGHT }} />
        {shelves.slice(fetchWin.start, fetchWin.end).map((shelf, i) => {
          const shelfIdx = fetchWin.start + i;
          const isFocusedShelf = shelfIdx === focus.shelf;
          // Horizontal window over the FULL loaded array (no 8-cap). Anchor comes
          // from FOCUS via scrollAnchor — the focused rail follows live focus.col,
          // idle rails use their remembered column — never from a scroll read.
          const full = Array.isArray(shelf.items) ? shelf.items : [];
          const railFocusCol = isFocusedShelf
            ? focus.col
            : colMemory.current[shelf.id] ?? 0;
          const prevA = railAnchorRef.current[shelf.id] ?? 0;
          // scrollAnchor only moves the anchor when focus would leave the visible
          // page [anchor, anchor+cols), so the window can't slide ahead of focus.
          const railAnchor = scrollAnchor(
            prevA,
            clampCol(railFocusCol, full.length),
            dims.cols,
            full.length,
          );
          // Memoize hysteresis. scrollAnchor is idempotent and side-effect-free on
          // its inputs, so writing the ref during render is safe (no tearing).
          railAnchorRef.current[shelf.id] = railAnchor;
          const w = computeWindow({
            anchor: railAnchor,
            total: full.length,
            viewportCount: dims.cols,
            overscan: cfg.hOverscan,
          });
          const winItems = full.slice(w.start, w.end);
          // INVARIANT: the focused card must be mounted. scrollAnchor keeps
          // focus.col in [railAnchor, railAnchor+cols) and computeWindow pads by
          // overscan, so focus.col ∈ [w.start, w.end). Dev guard catches a future
          // regression that would unmount the focused card (the 2026-07-02 bug).
          if (
            isFocusedShelf &&
            full.length &&
            !(focus.col >= w.start && focus.col < w.end)
          ) {
            // eslint-disable-next-line no-console
            console.warn(
              `[VirtualShelvesTV] focused col ${focus.col} outside window [${w.start},${w.end}) — would unmount focused card`,
            );
          }
          // Scroll-hint chevrons: driven by the rail's REAL scroll geometry once
          // it has scrolled (railEdge). Before the first scroll event, fall back
          // to a coarse estimate (at start; overflow if more items than fit).
          const edge = railEdge[shelf.id];
          const moreLeft = edge ? edge.left : false;
          const moreRight = edge ? edge.right : full.length > dims.cols;
          const wrapCls = [
            "tvl-shelf-rowwrap",
            moreLeft && "more-left",
            moreRight && "more-right",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <div
              key={shelf.id}
              style={{ height: ROW_HEIGHT, contain: "layout style paint" }}
            >
              <div
                className={onSeeAll ? "tvl-shelf-title-btn" : undefined}
                onClick={
                  onSeeAll ? () => onSeeAll(shelf.id, shelf.name) : undefined
                }
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: ss(6),
                  padding: `${ss(28)}px ${ss(PAD)}px ${ss(10)}px`,
                  color: colors.text,
                  fontFamily: fonts.display,
                  fontWeight: fontWeights.bold,
                  fontSize: ss(22),
                }}
              >
                <span>{shelf.name}</span>
                <Icon
                  name="chevron-right"
                  size={ss(22)}
                  color={colors.accent2}
                />
                {full.length > 0 && (
                  <span
                    style={{
                      marginLeft: ss(6),
                      color: colors.faint,
                      fontFamily: fonts.body,
                      fontWeight: fontWeights.medium,
                      fontSize: ss(13),
                    }}
                  >
                    {full.length}
                  </span>
                )}
              </div>
              <div className={wrapCls}>
                <div
                  ref={(n) => {
                    railRefs.current[shelf.id] = n;
                  }}
                  className="tv-shelf-rail"
                  onScroll={onRailScroll(shelf.id)}
                  style={{
                    display: "flex",
                    overflowX: "auto",
                    overflowY: "hidden",
                    gap: CARD_GAP,
                    paddingLeft: ss(PAD),
                    paddingRight: ss(PAD),
                    scrollbarWidth: "none",
                  }}
                >
                  {/* Left spacer stands in for the off-window posters before the
                      window. Cards render at STRIDE (CARD_W + gap), so the spacer
                      must be sized in STRIDE — NOT cfg.posterWidth — to keep the
                      rail's scroll geometry and focusedCardRef.offsetLeft exact. */}
                  <div style={{ flex: `0 0 ${w.leadingCount * STRIDE}px` }} />
                  {winItems.map((item, i) => {
                    const realCol = w.start + i; // absolute column index
                    const isFocused = isFocusedShelf && realCol === focus.col;
                    // Key by absolute column, NOT by stream_id/id: IPTV catalogs can
                    // carry duplicate stream_ids, and a duplicate key makes React drop
                    // one card. Column index is unique within a rail and stable
                    // (items only ever append).
                    return (
                      <div
                        key={realCol}
                        ref={isFocused ? focusedCardRef : null}
                        style={{ flex: `0 0 ${CARD_W}px` }}
                      >
                        {renderCard(item, isFocused, CARD_W)}
                      </div>
                    );
                  })}
                  <div style={{ flex: `0 0 ${w.trailingCount * STRIDE}px` }} />
                </div>
                <span
                  className="tvl-shelf-chev tvl-shelf-chev--left"
                  aria-hidden="true"
                >
                  <Icon name="chevron-right" size={26} color="#fff" />
                </span>
                <span
                  className="tvl-shelf-chev tvl-shelf-chev--right"
                  aria-hidden="true"
                >
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
