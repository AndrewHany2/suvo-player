import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { YStack, XStack, Text, Input, ScrollView, Spinner } from "../ui/primitives";
import { useSearch } from "../context/AppContext";
import { useMovies } from "../domain/hooks/useMovies";
import { useTVNavigation } from "../hooks/useTVNavigation";
import { ss, useScale } from "../utils/scaleSize";
import { colors, fonts } from "../ui/tokens";
import StatePanel from "../ui/StatePanel";
import { emptyContentProps } from "../ui/emptyContentProps";
import { LABELS } from "../ui/labels";
import Button from "../ui/Button";
import ContentShelf from "../presentation/components/ContentShelf.web";
import PosterCard from "../presentation/components/PosterCard.web";
import { SkeletonPosterGrid } from "../presentation/components/SkeletonPoster.web";
import VirtualGrid from "../presentation/components/VirtualGrid.web";
import DiscoverPills from "../presentation/components/DiscoverPills.web";
import MovieDetail from "../components/MovieDetail.web";
import { useShelfWindow } from "../presentation/virtualization/useShelfWindow.js";
import { useCategoryGridNav } from "../hooks/useCategoryGridNav";
import { getShelfConfig } from "../presentation/virtualization/shelfConfig.js";

// Caps the browse content width on ultrawide monitors (centered via margin auto).
const MAX_W = 1700;

/* ─── Category Page (drill-in grid + web D-pad) ─── */
function CategoryPage({ name, items, onBack, onPlay, onLoadMore, hasRemote, loadingMore }) {
  const { searchQuery: search, setSearchQuery: setSearch } = useSearch();
  const { filtered, focusedIdx, onColsChange } = useCategoryGridNav({ items, search, onSelect: onPlay, onBack });

  const CARD_W = ss(240);
  const GAP = ss(16);
  // Poster is width×1.5; the title block below adds marginTop(8) + height(34).
  const EST_ROW_H = Math.round(CARD_W * 1.5) + 42;
  const onEndReached = hasRemote && !loadingMore && onLoadMore ? onLoadMore : undefined;

  return (
    <YStack flex={1} minHeight={0} backgroundColor={colors.bg}>
      <XStack alignItems="center" gap={ss(14)} paddingHorizontal={ss(48)} paddingVertical={ss(18)} borderBottomWidth={1} borderBottomColor={colors.border}>
        <Button variant="ghost" size="sm" icon="back" onPress={onBack}>Back</Button>
        <Text color={colors.text} fontFamily={fonts.display} fontSize={ss(22)} fontWeight="700" role="heading" aria-level={2}>{name}</Text>
        {filtered != null && (
          <YStack backgroundColor={colors.surface2} borderRadius={ss(20)} paddingHorizontal={ss(10)} paddingVertical={ss(4)}>
            <Text color={colors.muted} fontSize={ss(12)} fontWeight="600">{filtered.length.toLocaleString()}</Text>
          </YStack>
        )}
        <Input
          flex={1} placeholder="Search titles..." placeholderTextColor={colors.muted} aria-label="Search titles"
          value={search} onChangeText={setSearch}
          backgroundColor={colors.surface2} color={colors.text} borderRadius={ss(10)}
          paddingHorizontal={ss(14)} paddingVertical={ss(10)} fontSize={ss(14)} borderWidth={1} borderColor={colors.border}
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
              <YStack alignItems="center" paddingVertical={ss(24)}><Spinner size="small" color={colors.accent} /></YStack>
            ) : null}
            renderItem={(item, idx) => (
              <PosterCard key={item.stream_id != null ? String(item.stream_id) : `i${idx}`} item={item} onPress={onPlay} isFocused={idx === focusedIdx} width={CARD_W} />
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
export default function MoviesScreen({ navigation }) {
  const {
    loading, error, errorMessage, reload, activeUserId, shelves, discoverItems,
    handleShelfVisible, handleLoadMore, openCategory, closeCategory,
    categoryPage, isTopRatedCategory, topRatedHasMore, topRatedLoadingMore, handleTopRatedMore,
    selectedMovie, selectMovie, clearSelectedMovie, playVideoObject,
  } = useMovies({ navigation });

  useScale(); // re-render + recompute ss() on window resize

  // The visible shelf-row index (NOT raw scroll px). Storing the quantized row
  // means setState is a no-op — React bails on an equal value — until the
  // viewport crosses into a new row, instead of re-rendering the whole screen
  // ~60×/sec while scrolling. Mirrors ContentShelf.web's firstVisible.
  const [vAnchor, setVAnchor] = useState(0);
  const scrollRef = useRef(null);
  const listRef = useRef(null);
  // Overlay wrappers — focus is moved into these when they open (see effects below).
  const categoryRef = useRef(null);
  const detailRef = useRef(null);

  const { focusedRow, focusedCol } = useTVNavigation({
    active: !categoryPage && !selectedMovie,
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

  // Full-screen overlays (category grid, movie detail) are modal: move focus
  // into the overlay when it opens and restore it to the previously-focused
  // element on close, mirroring the Add-Channel sheet on LiveTV.
  const categoryOpen = !!categoryPage;
  useEffect(() => {
    if (!categoryOpen || typeof document === "undefined") return;
    const prev = document.activeElement;
    categoryRef.current?.focus?.({ preventScroll: true });
    return () => { if (prev && typeof prev.focus === "function") prev.focus({ preventScroll: true }); };
  }, [categoryOpen]);

  const detailOpen = !!selectedMovie;
  useEffect(() => {
    if (!detailOpen || typeof document === "undefined") return;
    const prev = document.activeElement;
    detailRef.current?.focus?.({ preventScroll: true });
    return () => { if (prev && typeof prev.focus === "function") prev.focus({ preventScroll: true }); };
  }, [detailOpen]);

  if (loading) {
    return <StatePanel mode="loading" title="Loading movies..." />;
  }

  if (error) {
    return (
      <StatePanel
        mode="error"
        title="Couldn't load movies"
        message={errorMessage || "Check your connection and try again"}
        onRetry={reload}
        retryLabel="Retry"
      />
    );
  }

  if (!activeUserId) {
    return (
      <StatePanel
        mode="empty"
        icon="film"
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
        flex={1} minHeight={0} contentContainerStyle={{ paddingBottom: ss(80) }}
      >
        <YStack
          maxWidth={MAX_W}
          width="100%"
          alignSelf="center"
          {...(categoryPage || selectedMovie ? { inert: "", "aria-hidden": true } : {})}
        >
        <YStack paddingHorizontal={ss(48)} paddingTop={ss(24)} paddingBottom={ss(4)}>
          <Text color={colors.text} fontFamily={fonts.display} fontSize={ss(22)} fontWeight="700" letterSpacing={-0.3} marginBottom={ss(12)} role="heading" aria-level={2}>Discover</Text>
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
                  <ContentShelf
                    id={shelf.id}
                    title={shelf.name} count={shelf.totalCount} items={shelf.items}
                    hasMore={shelf.hasMore} loadingMore={shelf.loadingMore} manual={false}
                    onVisible={handleShelfVisible}
                    onPress={selectMovie}
                    onTitlePress={openCategory}
                    onLoadMore={handleLoadMore}
                  />
                </div>
              ))}
              <div style={{ height: vWin.trailingPad }} />
            </div>
          ) : (
            <StatePanel mode="empty" {...emptyContentProps("movies")} />
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
          {...(selectedMovie ? { inert: "", "aria-hidden": true } : {})}
        >
          <CategoryPage
            name={categoryPage.name}
            items={categoryPage.items}
            onBack={closeCategory}
            onPlay={selectMovie}
            hasRemote={isTopRatedCategory && topRatedHasMore}
            loadingMore={isTopRatedCategory && topRatedLoadingMore}
            onLoadMore={isTopRatedCategory ? handleTopRatedMore : undefined}
          />
        </YStack>
      )}
      {selectedMovie && (
        <YStack
          ref={detailRef}
          position="absolute" top={0} left={0} right={0} bottom={0} zIndex={20}
          role="dialog" aria-modal="true" aria-label={selectedMovie?.name || "Movie details"}
          tabIndex={-1}
        >
          <MovieDetail
            item={selectedMovie}
            onBack={clearSelectedMovie}
            onPlay={(videoObj) => { playVideoObject(videoObj); clearSelectedMovie(); }}
          />
        </YStack>
      )}
    </YStack>
  );
}
