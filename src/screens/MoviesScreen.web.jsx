import { useState, useEffect, useRef } from "react";
import { YStack, XStack, Text, Input, ScrollView, Spinner } from "../ui/primitives";
import { useApp } from "../context/AppContext";
import { useMovies } from "../domain/hooks/useMovies";
import { useTVNavigation } from "../hooks/useTVNavigation";
import { ss, useScale } from "../utils/scaleSize";
import { colors } from "../ui/tokens";
import StatePanel from "../ui/StatePanel";
import Button from "../ui/Button";
import { getPlatformConfig, detectPlatform } from "../platform/configs/detectPlatform";
import ContentShelf from "../presentation/components/ContentShelf.web";
import PosterCard from "../presentation/components/PosterCard.web";
import DiscoverPills from "../presentation/components/DiscoverPills.web";
import Hero from "../presentation/components/Hero.web";
import { selectHeroItem } from "../presentation/heroItem";
import MovieDetail from "../components/MovieDetail.web";

const _cfg = getPlatformConfig(detectPlatform());
const GRID_PAGE = _cfg.performance.gridPageSize;

// Caps the browse content width on ultrawide monitors (centered via margin auto).
const MAX_W = 1700;

/* ─── Category Page (drill-in grid + web D-pad) ─── */
function CategoryPage({ name, items, onBack, onPlay, onLoadMore, hasRemote, loadingMore }) {
  const { searchQuery: search, setSearchQuery: setSearch } = useApp();
  const [displayCount, setDisplayCount] = useState(GRID_PAGE);
  const [focusedIdx, setFocusedIdx] = useState(0);
  const focusedIdxRef = useRef(0);
  const navHasFocusRef = useRef(false);
  const numColsRef = useRef(6);
  const gridContainerRef = useRef(null);
  const displayedRef = useRef(null);
  const onPlayRef = useRef(onPlay);
  const onBackRef = useRef(onBack);
  useEffect(() => { onPlayRef.current = onPlay; }, [onPlay]);
  useEffect(() => { onBackRef.current = onBack; }, [onBack]);

  const filtered = items
    ? (search.trim() ? items.filter((i) => i.name?.toLowerCase().includes(search.toLowerCase())) : items)
    : null;
  const displayed = filtered ? filtered.slice(0, displayCount) : null;
  displayedRef.current = displayed;
  const hasLocalMore = filtered && displayCount < filtered.length;
  const hasMore = hasLocalMore || hasRemote;

  useEffect(() => { setDisplayCount(GRID_PAGE); setFocusedIdx(0); focusedIdxRef.current = 0; }, [search]);

  useEffect(() => {
    const el = gridContainerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => { numColsRef.current = Math.max(1, Math.floor(el.offsetWidth / (ss(240) + ss(16)))); };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
      const list = displayedRef.current;
      if (!list?.length) return;
      const idx = focusedIdxRef.current;
      const numCols = numColsRef.current;
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
        const item = list[idx]; if (item) onPlayRef.current(item);
      } else if (e.key === "Escape" || e.keyCode === 27) {
        onBackRef.current();
      }
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.querySelector('[data-tv-focused="true"]')?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [focusedIdx]);

  const handleScroll = ({ nativeEvent: { layoutMeasurement, contentOffset, contentSize } }) => {
    if (contentSize.height - contentOffset.y - layoutMeasurement.height >= 800) return;
    if (hasLocalMore) setDisplayCount((c) => Math.min(c + GRID_PAGE, filtered.length));
    else if (hasRemote && !loadingMore && onLoadMore) onLoadMore();
  };

  return (
    <YStack flex={1} minHeight={0} backgroundColor={colors.bg}>
      <XStack alignItems="center" gap={ss(14)} paddingHorizontal={ss(48)} paddingVertical={ss(18)} borderBottomWidth={1} borderBottomColor={colors.border}>
        <Button variant="ghost" size="sm" icon="back" onPress={onBack}>Back</Button>
        <Text color={colors.text} fontSize={ss(22)} fontWeight="700">{name}</Text>
        {filtered != null && (
          <YStack backgroundColor="rgba(255,255,255,0.07)" borderRadius={ss(20)} paddingHorizontal={ss(10)} paddingVertical={ss(4)}>
            <Text color={colors.muted} fontSize={ss(12)} fontWeight="600">{filtered.length.toLocaleString()}</Text>
          </YStack>
        )}
        <Input
          flex={1} placeholder="Search titles..." placeholderTextColor={colors.faint}
          value={search} onChangeText={setSearch}
          backgroundColor={colors.surface2} color={colors.text} borderRadius={ss(10)}
          paddingHorizontal={ss(14)} paddingVertical={ss(10)} fontSize={ss(14)} borderWidth={1} borderColor={colors.border}
        />
      </XStack>
      {!displayed ? (
        <YStack flex={1} justifyContent="center" alignItems="center"><Spinner size="large" color={colors.accent} /></YStack>
      ) : (
        <ScrollView flex={1} minHeight={0} contentContainerStyle={{ paddingHorizontal: ss(96), paddingVertical: ss(32) }} onScroll={handleScroll} scrollEventThrottle={200}>
          <div ref={gridContainerRef} style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, ${ss(240)}px)`, gap: ss(16), justifyContent: "center", alignItems: "start" }}>
            {displayed.map((item, idx) => (
              <PosterCard key={item.stream_id != null ? String(item.stream_id) : `i${idx}`} item={item} onPress={onPlay} isFocused={idx === focusedIdx} width={ss(240)} />
            ))}
          </div>
          {(hasMore || loadingMore) && (
            <YStack alignItems="center" paddingVertical={ss(24)}><Spinner size="small" color={colors.accent} /></YStack>
          )}
        </ScrollView>
      )}
    </YStack>
  );
}

/* ─── Screen ─── */
export default function MoviesScreen({ navigation }) {
  const {
    loading, error, reload, activeUserId, shelves, discoverItems,
    handleShelfVisible, handleLoadMore, openCategory, closeCategory,
    categoryPage, isTopRatedCategory, topRatedHasMore, topRatedLoadingMore, handleTopRatedMore,
    selectedMovie, selectMovie, clearSelectedMovie, playVideoObject,
  } = useMovies({ navigation });

  useScale(); // re-render + recompute ss() on window resize

  const { focusedRow, focusedCol } = useTVNavigation({
    active: !categoryPage && !selectedMovie,
    rows: [{ items: discoverItems, onSelect: (i) => openCategory(discoverItems[i].id, discoverItems[i].label) }],
  });

  if (loading) {
    return <StatePanel mode="loading" title="Loading movies..." />;
  }

  if (error) {
    return (
      <StatePanel
        mode="error"
        title="Couldn't load movies"
        message="Check your connection and try again"
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
        title="No IPTV Account"
        message="Add your IPTV service from Settings"
        cta={() => navigation.navigate("Accounts")}
        ctaLabel="Add Account"
      />
    );
  }

  const heroItem = !categoryPage && !selectedMovie
    ? selectHeroItem(shelves.find((s) => s.items?.length)?.items)
    : null;

  return (
    <YStack flex={1} minHeight={0} backgroundColor={colors.bg} position="relative">
      <ScrollView flex={1} minHeight={0} contentContainerStyle={{ paddingBottom: ss(80) }}>
        <YStack maxWidth={MAX_W} width="100%" alignSelf="center">
        {heroItem && (
          <YStack paddingHorizontal={ss(48)} paddingTop={ss(24)}>
            <Hero item={heroItem} onPlay={() => selectMovie(heroItem)} onDetails={() => selectMovie(heroItem)} />
          </YStack>
        )}
        <YStack paddingHorizontal={ss(48)} paddingTop={ss(24)} paddingBottom={ss(4)}>
          <Text color={colors.text} fontSize={ss(22)} fontWeight="700" letterSpacing={-0.3} marginBottom={ss(12)}>Discover</Text>
          <DiscoverPills
            items={discoverItems}
            focusedCol={focusedRow === 0 ? focusedCol : -1}
            onSelect={(pill) => openCategory(pill.id, pill.label)}
          />
        </YStack>
        <YStack>
          {shelves.length > 0 ? (
            shelves.map((shelf) => (
              <ContentShelf
                key={shelf.id}
                title={shelf.name} count={shelf.totalCount} items={shelf.items}
                hasMore={shelf.hasMore} loadingMore={shelf.loadingMore} manual={false}
                onVisible={() => handleShelfVisible(shelf.id)}
                onPress={selectMovie}
                onTitlePress={() => openCategory(shelf.id, shelf.name)}
                onLoadMore={() => handleLoadMore(shelf.id)}
              />
            ))
          ) : (
            <StatePanel mode="empty" icon="film" title="No movies found" />
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
            onPlay={selectMovie}
            hasRemote={isTopRatedCategory && topRatedHasMore}
            loadingMore={isTopRatedCategory && topRatedLoadingMore}
            onLoadMore={isTopRatedCategory ? handleTopRatedMore : undefined}
          />
        </YStack>
      )}
      {selectedMovie && (
        <YStack position="absolute" top={0} left={0} right={0} bottom={0}>
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
