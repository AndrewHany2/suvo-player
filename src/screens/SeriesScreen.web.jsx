import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { YStack, XStack, Text, Input, ScrollView, Spinner } from "../ui/primitives";
import { colors, fonts, fontWeights, radii } from "../ui/tokens";
import StatePanel from "../ui/StatePanel";
import { emptyContentProps } from "../ui/emptyContentProps";
import { LABELS } from "../ui/labels";
import Icon from "../ui/Icon";
import Button from "../ui/Button";
import { useSearch } from "../context/AppContext";
import { useSeries } from "../domain/hooks/useSeries";
import { useTVNavigation } from "../hooks/useTVNavigation";
import { ss, useScale } from "../utils/scaleSize";
import SeriesDetail from "../components/SeriesDetail.web";
import TVPosterCard from "../components/TVPosterCard";
import { getShelfConfig } from "../presentation/virtualization/shelfConfig.js";

// ponytail: match Movies shelf card size — same source (ContentShelf.web uses this too)
const SHELF_CARD_W = getShelfConfig("web").posterWidth;
import VirtualGrid from "../presentation/components/VirtualGrid.web";
import { SkeletonPosterGrid, SkeletonLine, SkeletonShelfRow } from "../presentation/components/SkeletonPoster.web";
import { useCategoryGridNav } from "../hooks/useCategoryGridNav";
import DiscoverPills from "../presentation/components/DiscoverPills.web";
import { useShelfWindow } from "../presentation/virtualization/useShelfWindow.js";

// Caps the browse content width on ultrawide monitors (centered via margin auto).
const MAX_W = 1700;

/* ─── Shelf ─── */
function ShelfBase({
  catId,
  title,
  items,
  totalCount,
  hasMore,
  loadingMore,
  onVisible,
  onPress,
  onTitlePress,
  onLoadMore,
  manual,
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
    if (!el || typeof IntersectionObserver === "undefined") {
      onVisible(catId);
      return;
    }
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          obs.disconnect();
          onVisible(catId);
        }
      },
      { rootMargin: "300px 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [catId, items, onVisible, manual]);

  // Re-attach drag handlers once the shelf transitions from loading to loaded.
  const itemsLoaded = items !== null;
  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const onMouseDown = (e) => {
      isDragging.current = true;
      hasDragged.current = false;
      dragStartX.current = e.pageX;
      dragStartLeft.current = el.scrollLeft;
      el.style.cursor = "grabbing";
    };
    const onMouseMove = (e) => {
      if (!isDragging.current) return;
      const dx = e.pageX - dragStartX.current;
      // Only a deliberate drag (>10px) cancels the click; a few px of jitter
      // during a normal click must still register as a select.
      if (Math.abs(dx) > 10) {
        hasDragged.current = true;
        el.scrollLeft = dragStartLeft.current - dx;
      }
    };
    const onMouseUp = () => {
      isDragging.current = false;
      el.style.cursor = "grab";
    };
    const onClickCapture = (e) => {
      if (hasDragged.current) {
        hasDragged.current = false;
        e.stopPropagation();
        e.preventDefault();
      }
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

  if (items !== null && !items?.length) return null;

  const scrollBy = (delta) => {
    const el = railRef.current;
    if (el) el.scrollLeft = Math.max(0, el.scrollLeft + delta);
  };
  const handleScroll = (e) => {
    if (!hasMore || loadingMore) return;
    const { scrollLeft, scrollWidth, clientWidth } = e.target;
    if (scrollWidth - scrollLeft - clientWidth < 500) onLoadMore(catId);
  };

  return (
    <YStack paddingTop={ss(28)} paddingBottom={ss(8)} overflow="visible">
      <div ref={sentinelRef} style={{ height: 0 }} />
      <XStack
        alignItems="baseline"
        justifyContent="space-between"
        paddingHorizontal={ss(48)}
        marginBottom={ss(14)}
      >
        <XStack
          alignItems="center"
          gap={ss(4)}
          cursor="pointer"
          onPress={() => onTitlePress?.(catId, title)}
          pressStyle={{ opacity: 0.8 }}
          {...{ className: "suvo-shelf-title-btn" }}
        >
          <Text
            color={colors.text}
            fontFamily={fonts.display}
            fontSize={ss(22)}
            fontWeight={fontWeights.bold}
            letterSpacing={-0.3}
          >
            {title}
          </Text>
          <Icon name="chevron-right" size={ss(18)} color={colors.muted} />
        </XStack>
        {totalCount != null && (
          <Text color={colors.muted} fontSize={ss(13)} fontWeight={fontWeights.medium}>
            {totalCount}
          </Text>
        )}
      </XStack>
      {items === null ? (
        <YStack paddingHorizontal={ss(48)} paddingVertical={ss(18)}>
          <Spinner size="small" color={colors.accent} />
        </YStack>
      ) : (
        <div style={{ position: "relative" }} className="suvo-shelf-rail">
          <button className="suvo-shelf-nav" onClick={() => scrollBy(-800)} aria-label="Scroll left">
            <span style={{ display: "inline-block", transform: "rotate(180deg)" }}>
              <Icon name="chevron-right" size={ss(22)} color={colors.text} />
            </span>
          </button>
          <div
            ref={railRef}
            onScroll={handleScroll}
            onDragStart={(e) => e.preventDefault()}
            style={{
              display: "flex",
              overflowX: "auto",
              gap: ss(8),
              paddingLeft: ss(48),
              paddingRight: ss(48),
              // Vertical breathing room so the hover ring/glow isn't clipped
              // top/bottom by this scroller's overflow.
              paddingTop: ss(10),
              paddingBottom: ss(10),
              scrollbarWidth: "none",
              msOverflowStyle: "none",
              cursor: "grab",
              userSelect: "none",
            }}
          >
            {items.map((item) => (
              <TVPosterCard
                key={String(item.series_id)}
                item={item}
                onPress={onPress}
                width={ss(SHELF_CARD_W)}
              />
            ))}
            {loadingMore && (
              <YStack
                width={ss(SHELF_CARD_W)}
                aspectRatio={2 / 3}
                borderRadius={ss(8)}
                backgroundColor={colors.surface}
                borderWidth={1}
                borderColor={colors.border}
                justifyContent="center"
                alignItems="center"
              >
                <Spinner size="small" color={colors.accent} />
              </YStack>
            )}
          </div>
          <button
            className="suvo-shelf-nav right"
            onClick={() => scrollBy(800)}
            aria-label="Scroll right"
          >
            <Icon name="chevron-right" size={ss(22)} color={colors.text} />
          </button>
        </div>
      )}
    </YStack>
  );
}

// Memoized: Series renders every shelf unconditionally (no window), so without
// this a single shelf's items arriving would re-render all of them. Callers pass
// stable handlers (id flows back through the callback args), so memo skips the
// shelves that didn't change.
const Shelf = memo(ShelfBase);

/* ─── Category Page ─── */
function CategoryPage({
  name,
  items,
  onBack,
  onPress,
  onLoadMore,
  hasRemote,
  loadingMore,
}) {
  const { searchQuery: search, setSearchQuery: setSearch } = useSearch();
  const { filtered, focusedIdx, onColsChange } = useCategoryGridNav({ items, search, onSelect: onPress, onBack });

  const CARD_W = ss(240);
  const GAP = ss(12);
  // Poster is width×1.5; the title block below adds marginTop(8) + height(34).
  const EST_ROW_H = Math.round(CARD_W * 1.5) + 42;
  const onEndReached = hasRemote && !loadingMore && onLoadMore ? onLoadMore : undefined;

  return (
    <YStack flex={1} minHeight={0} backgroundColor={colors.bg}>
      <XStack
        alignItems="center"
        gap={ss(14)}
        paddingHorizontal={ss(48)}
        paddingVertical={ss(18)}
        borderBottomWidth={1}
        borderBottomColor={colors.border}
      >
        <Button variant="ghost" size="sm" icon="back" onPress={onBack}>Back</Button>
        <Text color={colors.text} fontFamily={fonts.display} fontSize={ss(22)} fontWeight={fontWeights.bold} role="heading" aria-level={2}>
          {name}
        </Text>
        {filtered != null && (
          <YStack
            backgroundColor={colors.surface2}
            borderRadius={ss(20)}
            paddingHorizontal={ss(10)}
            paddingVertical={ss(4)}
          >
            <Text color={colors.muted} fontSize={ss(12)} fontWeight="600">
              {filtered.length.toLocaleString()}
            </Text>
          </YStack>
        )}
        <Input
          flex={1}
          placeholder="Search titles..."
          placeholderTextColor={colors.muted}
          aria-label="Search titles"
          value={search}
          onChangeText={setSearch}
          backgroundColor={colors.surface2}
          color={colors.text}
          borderRadius={ss(10)}
          paddingHorizontal={ss(14)}
          paddingVertical={ss(10)}
          fontSize={ss(14)}
          borderWidth={1}
          borderColor={colors.border}
        />
      </XStack>
      {filtered ? (
        <YStack flex={1} minHeight={0}>
          <VirtualGrid
            items={filtered}
            itemWidth={CARD_W}
            gap={GAP}
            estRowHeight={EST_ROW_H}
            focusIndex={focusedIdx}
            paddingH={ss(96)}
            paddingV={ss(32)}
            onColsChange={onColsChange}
            onEndReached={onEndReached}
            footer={loadingMore ? (
              <YStack alignItems="center" paddingVertical={ss(24)}>
                <Spinner size="small" color={colors.accent} />
              </YStack>
            ) : null}
            renderItem={(item, idx) => (
              <TVPosterCard
                key={String(item.series_id)}
                item={item}
                onPress={onPress}
                isFocused={idx === focusedIdx}
                width={CARD_W}
              />
            )}
          />
        </YStack>
      ) : (
        <YStack flex={1} minHeight={0}>
          <SkeletonPosterGrid width={CARD_W} gap={GAP} paddingH={ss(96)} paddingV={ss(32)} />
        </YStack>
      )}
    </YStack>
  );
}

/* ─── Screen ─── */
export default function SeriesScreen({ navigation }) {
  const {
    loading, error, errorMessage, reload, activeUserId, shelves, discoverItems,
    handleShelfVisible, handleLoadMore, openCategory, closeCategory,
    categoryPage, isTopRatedCategory, topRatedHasMore, topRatedLoadingMore, handleTopRatedMore,
    selectedSeries, selectSeries, clearSelectedSeries, playVideoObject,
  } = useSeries({ navigation });

  useScale(); // re-render + recompute ss() on window resize

  // The visible shelf-row index (NOT raw scroll px). Storing the quantized row
  // means setState is a no-op — React bails on an equal value — until the
  // viewport crosses into a new row, instead of re-rendering the whole screen
  // ~60×/sec while scrolling. Mirrors MoviesScreen.web.
  const [vAnchor, setVAnchor] = useState(0);
  const scrollRef = useRef(null);
  const listRef = useRef(null);
  // Overlay wrappers — focus is moved into these when they open (see effects below).
  const categoryRef = useRef(null);
  const detailRef = useRef(null);

  const { focusedRow, focusedCol } = useTVNavigation({
    active: !categoryPage && !selectedSeries,
    rows: [{ items: discoverItems, onSelect: (i) => openCategory(discoverItems[i].id, discoverItems[i].label) }],
  });

  // Cached shelf-window geometry. viewportH/listTop used to be read live off the
  // DOM (scrollRef.clientHeight / listRef.offsetTop) during render — a layout
  // read on every scroll frame. Instead measure them in a layout effect + a
  // ResizeObserver and cache in state, so the render body touches no live layout.
  const [shelfMetrics, setShelfMetrics] = useState(() => ({
    viewportH: typeof window !== "undefined" ? window.innerHeight : 900,
    listTop: 0,
  }));
  useLayoutEffect(() => {
    const measure = () => {
      const viewportH = scrollRef.current?.clientHeight || (typeof window !== "undefined" ? window.innerHeight : 900);
      const listTop = listRef.current?.offsetTop || 0;
      setShelfMetrics((m) => (m.viewportH === viewportH && m.listTop === listTop ? m : { viewportH, listTop }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    if (scrollRef.current) ro.observe(scrollRef.current);
    if (listRef.current) ro.observe(listRef.current);
    return () => ro.disconnect();
  }, [shelves.length, loading, error, activeUserId]);

  // Vertical shelf window: mount only shelves near the viewport, with spacer
  // divs above/below preserving scroll geometry. listTop is the Discover
  // section's height (distance from scroll top to the first shelf). Called
  // unconditionally, before the early returns below, per Rules of Hooks.
  const vcfg = getShelfConfig("web");
  const rowStride = ss(vcfg.rowHeight);
  const { viewportH, listTop } = shelfMetrics;
  const rowsVisible = Math.max(1, Math.ceil(viewportH / rowStride));
  const vWin = useShelfWindow({
    anchor: vAnchor, total: shelves.length,
    viewportCount: rowsVisible, overscan: vcfg.vOverscan, stride: rowStride,
  });

  // Full-screen overlays (category grid, series detail) are modal: move focus
  // into the overlay when it opens and restore it to the previously-focused
  // element on close, mirroring the Add-Channel sheet on LiveTV.
  const categoryOpen = !!categoryPage;
  useEffect(() => {
    if (!categoryOpen || typeof document === "undefined") return;
    const prev = document.activeElement;
    categoryRef.current?.focus?.({ preventScroll: true });
    return () => { if (prev && typeof prev.focus === "function") prev.focus({ preventScroll: true }); };
  }, [categoryOpen]);

  const detailOpen = !!selectedSeries;
  useEffect(() => {
    if (!detailOpen || typeof document === "undefined") return;
    const prev = document.activeElement;
    detailRef.current?.focus?.({ preventScroll: true });
    return () => { if (prev && typeof prev.focus === "function") prev.focus({ preventScroll: true }); };
  }, [detailOpen]);

  if (loading) {
    // Skeleton browse (Discover heading + pill placeholders + poster rails)
    // instead of a lone centered spinner — same geometry as the real shelves
    // (ss(SHELF_CARD_W) cards, ss(48) inset) so content swaps in with no shift.
    return (
      <YStack flex={1} minHeight={0} backgroundColor={colors.bg}>
        <YStack maxWidth={MAX_W} width="100%" alignSelf="center">
          <YStack paddingHorizontal={ss(48)} paddingTop={ss(24)} paddingBottom={ss(4)}>
            <Text color={colors.text} fontFamily={fonts.display} fontSize={ss(22)} fontWeight="700" letterSpacing={-0.3} marginBottom={ss(12)} role="heading" aria-level={2}>Discover</Text>
            <XStack gap={ss(10)} flexWrap="wrap">
              {[96, 120, 104, 132, 88].map((w, i) => (
                <SkeletonLine key={i} width={ss(w)} height={ss(42)} radius={radii.pill} />
              ))}
            </XStack>
          </YStack>
          {[0, 1, 2].map((i) => (
            <SkeletonShelfRow key={i} cardWidth={ss(SHELF_CARD_W)} gap={ss(getShelfConfig("web").posterGap)} paddingH={ss(48)} />
          ))}
        </YStack>
      </YStack>
    );
  }

  if (error) {
    return (
      <StatePanel
        mode="error"
        title="Couldn't load series"
        message={errorMessage || "Check your connection or account and try again"}
        onRetry={reload}
        retryLabel="Retry"
      />
    );
  }

  if (!activeUserId) {
    return (
      <StatePanel
        mode="empty"
        icon="tv"
        title={LABELS.noAccountTitle}
        message={LABELS.noAccountBody}
        cta={() => navigation.navigate("Accounts")}
        ctaLabel={LABELS.noAccountCta}
      />
    );
  }

  return (
    <YStack flex={1} minHeight={0} backgroundColor={colors.bg} position="relative">
      <ScrollView
        ref={scrollRef}
        onScroll={(e) => setVAnchor(Math.max(0, Math.floor((e.nativeEvent.contentOffset.y - listTop) / rowStride)))}
        flex={1}
        minHeight={0}
        contentContainerStyle={{ paddingBottom: ss(80) }}
        style={{ pointerEvents: categoryPage || selectedSeries ? "none" : "auto" }}
      >
        <YStack
          maxWidth={MAX_W}
          width="100%"
          alignSelf="center"
          {...(categoryPage || selectedSeries ? { inert: "", "aria-hidden": true } : {})}
        >
        <YStack
          paddingHorizontal={ss(48)}
          paddingTop={ss(24)}
          paddingBottom={ss(4)}
        >
          <Text
            color={colors.text}
            fontFamily={fonts.display}
            fontSize={ss(22)}
            fontWeight="700"
            letterSpacing={-0.3}
            marginBottom={ss(12)}
            role="heading"
            aria-level={2}
          >
            Discover
          </Text>
          <DiscoverPills
            items={discoverItems}
            focusedCol={focusedRow === 0 ? focusedCol : -1}
            onSelect={(pill) => openCategory(pill.id, pill.label)}
          />
        </YStack>
        <YStack>
          {shelves.length > 0 ? (
            <div ref={listRef}>
              <div style={{ height: vWin.leadingPad }} />
              {shelves.slice(vWin.start, vWin.end).map((shelf) => (
                <div key={shelf.id} style={{ height: rowStride, overflow: "visible" }}>
                  <Shelf
                    catId={shelf.id}
                    title={shelf.name}
                    items={shelf.items}
                    totalCount={shelf.totalCount}
                    hasMore={shelf.hasMore}
                    loadingMore={shelf.loadingMore}
                    onVisible={handleShelfVisible}
                    onPress={selectSeries}
                    onTitlePress={openCategory}
                    onLoadMore={handleLoadMore}
                    manual={false}
                  />
                </div>
              ))}
              <div style={{ height: vWin.trailingPad }} />
            </div>
          ) : (
            <StatePanel mode="empty" {...emptyContentProps("series")} />
          )}
        </YStack>
        </YStack>
      </ScrollView>
      {categoryPage && (
        <YStack
          ref={categoryRef}
          position="absolute" top={0} left={0} right={0} bottom={0} zIndex={20}
          role="dialog" aria-modal="true" aria-label={categoryPage.name}
          tabIndex={-1}
          {...(selectedSeries ? { inert: "", "aria-hidden": true } : {})}
        >
          <CategoryPage
            name={categoryPage.name}
            items={categoryPage.items}
            onBack={closeCategory}
            onPress={selectSeries}
            hasRemote={isTopRatedCategory && topRatedHasMore}
            loadingMore={isTopRatedCategory && topRatedLoadingMore}
            onLoadMore={isTopRatedCategory ? handleTopRatedMore : undefined}
          />
        </YStack>
      )}
      {selectedSeries && (
        <YStack
          ref={detailRef}
          position="absolute" top={0} left={0} right={0} bottom={0} zIndex={20}
          role="dialog" aria-modal="true" aria-label={selectedSeries?.name || "Series details"}
          tabIndex={-1}
        >
          <SeriesDetail
            item={selectedSeries}
            onBack={clearSelectedSeries}
            onPlayEpisode={(videoObj) => { playVideoObject(videoObj); clearSelectedSeries(); }}
          />
        </YStack>
      )}
    </YStack>
  );
}
