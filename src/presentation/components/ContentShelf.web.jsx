import { useEffect, useRef } from "react";
import { ss } from "../../utils/scaleSize";
import { Spinner } from "../../ui/primitives";
import PosterCard from "./PosterCard.web";

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
      if (Math.abs(dx) > 4) { hasDragged.current = true; el.scrollLeft = dragStartLeft.current - dx; }
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
  }, [items !== null]);

  if (items !== null && !items.length) return null;

  const scrollBy = (delta) => { const el = railRef.current; if (el) el.scrollLeft = Math.max(0, el.scrollLeft + delta); };
  const handleScroll = (e) => {
    if (!hasMore || loadingMore) return;
    const { scrollLeft, scrollWidth, clientWidth } = e.target;
    if (scrollWidth - scrollLeft - clientWidth < 500) onLoadMore?.();
  };

  return (
    <div style={{ paddingTop: ss(28), paddingBottom: ss(8) }}>
      <div ref={sentinelRef} style={{ height: 0 }} />
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", paddingLeft: ss(48), paddingRight: ss(48), marginBottom: ss(14) }}>
        <div className="lumen-shelf-title-btn" style={{ cursor: "pointer" }} onClick={() => onTitlePress?.()}>
          <span style={{ color: "#EAF0FF", fontSize: ss(22), fontWeight: 700, letterSpacing: -0.3, fontFamily: 'SpaceGrotesk, Inter, -apple-system, sans-serif' }}>
            {title} <span style={{ color: "#22D3EE", fontSize: ss(18) }}>›</span>
          </span>
        </div>
        {count != null && <span style={{ color: "#555", fontSize: ss(13), fontWeight: 500 }}>{count}</span>}
      </div>
      {items === null ? (
        <div style={{ paddingLeft: ss(48), paddingRight: ss(48), paddingTop: ss(18), paddingBottom: ss(18) }}>
          <Spinner size="small" color="#6C5CE7" />
        </div>
      ) : (
        <div style={{ position: "relative" }} className="lumen-shelf-rail">
          <button className="lumen-shelf-nav" onClick={() => scrollBy(-800)}>‹</button>
          <div
            ref={railRef}
            onScroll={handleScroll}
            onDragStart={(e) => e.preventDefault()}
            style={{ display: "flex", overflowX: "auto", gap: ss(8), paddingLeft: ss(48), paddingRight: ss(48), scrollbarWidth: "none", msOverflowStyle: "none", cursor: "grab", userSelect: "none" }}
          >
            {items.map((item) => (renderItem
              ? renderItem(item)
              : <PosterCard key={String(item.stream_id ?? item.id)} item={item} onPress={onPress} width={ss(200)} />))}
            {loadingMore && (
              <div style={{ width: ss(200), aspectRatio: "2/3", borderRadius: ss(8), backgroundColor: "#141A2E", border: "1px solid #28324E", display: "flex", justifyContent: "center", alignItems: "center" }}>
                <Spinner size="small" color="#6C5CE7" />
              </div>
            )}
          </div>
          <button className="lumen-shelf-nav right" onClick={() => scrollBy(800)}>›</button>
        </div>
      )}
    </div>
  );
}
