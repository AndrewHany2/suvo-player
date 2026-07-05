import { useEffect, useRef, useState } from "react";
import { ss } from "../../utils/scaleSize";
import { useShelfWindow } from "../virtualization/useShelfWindow.js";
import { getShelfConfig } from "../virtualization/shelfConfig.js";
import { Spinner } from "../../ui/primitives";
import { colors, fonts, fontWeights, radii } from "../../ui/tokens";
import Icon from "../../ui/Icon";
import PosterCard from "./PosterCard.web";
import SkeletonPoster from "./SkeletonPoster.web";

import { isTV } from "../../utils/isTV";

/**
 * Horizontal content rail — web/desktop (raw DOM, no Tamagui). Lazy-loads on
 * IntersectionObserver, drag-to-scroll, prev/next buttons, paginate near end.
 * On TV the shelf model isn't used (TV screens render grids), so this targets
 * the desktop/web experience.
 */
export default function ContentShelf({
  title, count, items, hasMore, loadingMore, manual,
  onVisible, onPress, onTitlePress, onLoadMore, renderItem,
}) {
  const sentinelRef = useRef(null);
  const railRef = useRef(null);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartLeft = useRef(0);
  const hasDragged = useRef(false);

  // Horizontal virtualization: mount only a window of cards around the scroll
  // position so a deeply-scrolled rail can't mount hundreds of posters. Desktop
  // has headroom, so this is a safety optimization; behavior is unchanged.
  const cfg = getShelfConfig("web");
  const CARD_W = ss(cfg.posterWidth), CARD_GAP = ss(cfg.posterGap);
  const viewportCount = 10;
  const [firstVisible, setFirstVisible] = useState(0);

  // Mount the visible page anchored to the scroll position, plus overscan on
  // each side (rendered ahead of the scroll). Anchoring to firstVisible — not a
  // focused index — guarantees the leftmost on-screen card is always mounted, so
  // scrolling never leaves a blank gap at the edge. Shelves now hold the full
  // array (hasMore is always false), so the window covers everything. Called
  // unconditionally at the top level (before any early return) per Rules of Hooks.
  const stride = CARD_W + CARD_GAP;
  const { start, end, leadingPad, trailingPad } = useShelfWindow({
    anchor: firstVisible, total: items ? items.length : 0,
    viewportCount, overscan: cfg.hOverscan, stride,
  });

  useEffect(() => {
    if (items !== null || manual) return;
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") { onVisible?.(); return; }
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { obs.disconnect(); onVisible?.(); }
    }, { rootMargin: "300px 0px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [items, onVisible, manual]);

  // Re-attach drag handlers once the shelf transitions from loading to loaded.
  const itemsLoaded = items !== null;
  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const onMouseDown = (e) => {
      isDragging.current = true; hasDragged.current = false;
      dragStartX.current = e.pageX; dragStartLeft.current = el.scrollLeft;
      el.style.cursor = "grabbing";
    };
    const onMouseMove = (e) => {
      if (!isDragging.current) return;
      const dx = e.pageX - dragStartX.current;
      // Only a deliberate drag (>10px) cancels the click; a few px of jitter
      // during a normal click must still register as a select.
      if (Math.abs(dx) > 10) { hasDragged.current = true; el.scrollLeft = dragStartLeft.current - dx; }
    };
    const onMouseUp = () => { isDragging.current = false; el.style.cursor = "grab"; };
    const onClickCapture = (e) => {
      if (hasDragged.current) { hasDragged.current = false; e.stopPropagation(); e.preventDefault(); }
    };
    el.addEventListener("mousedown", onMouseDown);
    el.addEventListener("click", onClickCapture, true);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      el.removeEventListener("mousedown", onMouseDown);
      el.removeEventListener("click", onClickCapture, true);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [itemsLoaded]);

  if (items !== null && !items.length) return null;

  const scrollBy = (delta) => { const el = railRef.current; if (el) el.scrollLeft = Math.max(0, el.scrollLeft + delta); };
  const handleScroll = (e) => {
    const { scrollLeft } = e.target;
    setFirstVisible(Math.floor(scrollLeft / (CARD_W + CARD_GAP)));
  };

  return (
    <div style={{ paddingTop: ss(28), paddingBottom: ss(8) }}>
      <div ref={sentinelRef} style={{ height: 0 }} />
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", paddingLeft: ss(48), paddingRight: ss(48), marginBottom: ss(14) }}>
        <div className="lumen-shelf-title-btn" style={{ display: "flex", alignItems: "center", gap: ss(4), cursor: "pointer" }} onClick={() => onTitlePress?.()}>
          <span style={{ color: colors.text, fontSize: ss(22), fontWeight: fontWeights.bold, letterSpacing: -0.3, fontFamily: fonts.display }}>
            {title}
          </span>
          <Icon name="chevron-right" size={ss(18)} color={colors.accent2} />
        </div>
        {count != null && <span style={{ color: colors.faint, fontSize: ss(13), fontWeight: fontWeights.medium }}>{count}</span>}
      </div>
      {items === null ? (
        // Skeleton rail: a row of poster-shaped placeholders that reserves the
        // real posters' footprint, clipped to the viewport. overflow:hidden drops
        // the ones past the right edge so we don't need to measure the count.
        <div style={{ display: "flex", gap: ss(8), paddingLeft: ss(48), paddingRight: ss(48), paddingTop: ss(10), paddingBottom: ss(10), overflow: "hidden" }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} style={{ flex: `0 0 ${CARD_W}px` }}>
              <SkeletonPoster width={CARD_W} />
            </div>
          ))}
        </div>
      ) : (
        <div style={{ position: "relative" }} className="lumen-shelf-rail">
          {!isTV() && (
            <>
              <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: ss(48), zIndex: 3, pointerEvents: "none", background: `linear-gradient(to right, ${colors.bg}, transparent)` }} />
              <div style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: ss(48), zIndex: 3, pointerEvents: "none", background: `linear-gradient(to left, ${colors.bg}, transparent)` }} />
            </>
          )}
          <button className="lumen-shelf-nav" onClick={() => scrollBy(-800)} aria-label="Scroll left">
            <Icon name="chevron-right" size={ss(28)} color={colors.text} style={{ transform: "rotate(180deg)" }} />
          </button>
          <div
            ref={railRef}
            onScroll={handleScroll}
            onDragStart={(e) => e.preventDefault()}
            style={{ display: "flex", overflowX: "auto", gap: ss(8), paddingLeft: ss(48), paddingRight: ss(48), paddingTop: ss(10), paddingBottom: ss(10), scrollbarWidth: "none", msOverflowStyle: "none", cursor: "grab", userSelect: "none" }}
          >
            <div style={{ flex: `0 0 ${leadingPad}px` }} />
            {items.slice(start, end).map((item) => (renderItem
              ? renderItem(item)
              : <PosterCard key={String(item.stream_id ?? item.id)} item={item} onPress={onPress} width={CARD_W} />))}
            <div style={{ flex: `0 0 ${trailingPad}px` }} />
            {loadingMore && (
              <div style={{ width: CARD_W, aspectRatio: "2/3", borderRadius: radii.sm, backgroundColor: colors.surface, border: `1px solid ${colors.border}`, display: "flex", justifyContent: "center", alignItems: "center" }}>
                <Spinner size="small" color={colors.accent} />
              </div>
            )}
          </div>
          <button className="lumen-shelf-nav right" onClick={() => scrollBy(800)} aria-label="Scroll right">
            <Icon name="chevron-right" size={ss(28)} color={colors.text} />
          </button>
        </div>
      )}
    </div>
  );
}
