import { memo, useEffect, useRef } from "react";
import { YStack, XStack, Text, Input, ScrollView, Spinner } from "../ui/primitives";
import { colors, fonts, fontWeights } from "../ui/tokens";
import StatePanel from "../ui/StatePanel";
import { emptyContentProps } from "../ui/emptyContentProps";
import Icon from "../ui/Icon";
import { useApp } from "../context/AppContext";
import { useSeries } from "../domain/hooks/useSeries";
import { useTVNavigation } from "../hooks/useTVNavigation";
import { ss, useScale } from "../utils/scaleSize";
import SeriesDetail from "../components/SeriesDetail.web";
import TVPosterCard from "../components/TVPosterCard";
import { getShelfConfig } from "../presentation/virtualization/shelfConfig.js";

// ponytail: match Movies shelf card size — same source (ContentShelf.web uses this too)
const SHELF_CARD_W = getShelfConfig("web").posterWidth;
import VirtualGrid from "../presentation/components/VirtualGrid.web";
import { useCategoryGridNav } from "../hooks/useCategoryGridNav";
import DiscoverPills from "../presentation/components/DiscoverPills.web";

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
          <Icon name="chevron-right" size={ss(18)} color={colors.accent} />
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
  const { searchQuery: search, setSearchQuery: setSearch } = useApp();
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
        <XStack
          alignItems="center"
          gap={ss(8)}
          paddingVertical={ss(8)}
          paddingHorizontal={ss(14)}
          backgroundColor={colors.surface2}
          borderRadius={ss(8)}
          cursor="pointer"
          onPress={onBack}
          pressStyle={{ opacity: 0.8 }}
        >
          <Icon name="back" size={ss(16)} color={colors.accent} />
          <Text color={colors.accent} fontSize={ss(14)} fontWeight={fontWeights.medium}>
            Back
          </Text>
        </XStack>
        <Text color={colors.text} fontFamily={fonts.display} fontSize={ss(22)} fontWeight={fontWeights.bold}>
          {name}
        </Text>
        {filtered != null && (
          <YStack
            backgroundColor="rgba(255,255,255,0.07)"
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
          placeholderTextColor="#555"
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
        <YStack flex={1} justifyContent="center" alignItems="center">
          <Spinner size="large" color={colors.accent} />
        </YStack>
      )}
    </YStack>
  );
}

/* ─── Screen ─── */
export default function SeriesScreen({ navigation }) {
  const {
    loading, error, reload, activeUserId, shelves, discoverItems,
    handleShelfVisible, handleLoadMore, openCategory, closeCategory,
    categoryPage, isTopRatedCategory, topRatedHasMore, topRatedLoadingMore, handleTopRatedMore,
    selectedSeries, selectSeries, clearSelectedSeries, playVideoObject,
  } = useSeries({ navigation });

  useScale(); // re-render + recompute ss() on window resize

  const { focusedRow, focusedCol } = useTVNavigation({
    active: !categoryPage && !selectedSeries,
    rows: [{ items: discoverItems, onSelect: (i) => openCategory(discoverItems[i].id, discoverItems[i].label) }],
  });

  if (loading) {
    return <StatePanel mode="loading" title="Loading series..." />;
  }

  if (error) {
    return (
      <StatePanel
        mode="error"
        title="Couldn't load series"
        message="Check your connection or account and try again"
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
        title="No account"
        message="Add your media service from Settings"
        cta={() => navigation.navigate("Accounts")}
        ctaLabel="Add Account"
      />
    );
  }

  return (
    <YStack flex={1} minHeight={0} backgroundColor={colors.bg} position="relative">
      <ScrollView
        flex={1}
        minHeight={0}
        contentContainerStyle={{ paddingBottom: ss(80) }}
        style={{ pointerEvents: categoryPage || selectedSeries ? "none" : "auto" }}
      >
        <YStack maxWidth={MAX_W} width="100%" alignSelf="center">
        <YStack
          paddingHorizontal={ss(48)}
          paddingTop={ss(24)}
          paddingBottom={ss(4)}
        >
          <Text
            color={colors.text}
            fontSize={ss(22)}
            fontWeight="700"
            letterSpacing={-0.3}
            marginBottom={ss(12)}
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
            shelves.map((shelf) => (
              <Shelf
                key={shelf.id}
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
            ))
          ) : (
            <StatePanel mode="empty" {...emptyContentProps("series")} />
          )}
        </YStack>
        </YStack>
      </ScrollView>
      {categoryPage && (
        <YStack position="absolute" top={0} left={0} right={0} bottom={0}>
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
        <YStack position="absolute" top={0} left={0} right={0} bottom={0}>
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
