import { useState, useEffect, useCallback, useRef } from "react";
import { View } from "react-native";
import { YStack, XStack, Text, Input, ScrollView, Spinner } from "../ui/primitives";
import { colors, fonts, fontWeights } from "../ui/tokens";
import StatePanel from "../ui/StatePanel";
import Icon from "../ui/Icon";
import { useApp } from "../context/AppContext";
import { useContentService } from "../domain/hooks/useContentService";
import { useTVNavigation } from "../hooks/useTVNavigation";
import { ss, useScale } from "../utils/scaleSize";
import iptvApi from "../services/iptvApi";
import tmdbApi from "../services/tmdbApi";
import SeriesDetail from "../components/SeriesDetail.web";
import TVPosterCard from "../components/TVPosterCard";
import VirtualGrid from "../presentation/components/VirtualGrid.web";
import DiscoverPills from "../presentation/components/DiscoverPills.web";
import Hero from "../presentation/components/Hero.web";
import { selectHeroItem } from "../presentation/heroItem";

// Caps the browse content width on ultrawide monitors (centered via margin auto).
const MAX_W = 1700;
const SHELF_PAGE =
  typeof window !== "undefined"
    ? Math.ceil(window.innerWidth / ss(200)) + 2
    : 10;

async function prefetchTopRatedSeries() {
  try {
    const series = await iptvApi.getAllSeriesRobust();
    if (!series?.length) return null;
    if (!tmdbApi.hasKey) {
      return {
        streams: series,
        matched: [...series]
          .filter((s) => parseFloat(s.rating) > 0)
          .sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating)),
        hasTmdb: false,
        seenIds: new Set(),
        totalPages: 0,
        hasMore: false,
      };
    }
    const seenIds = new Set();
    const { matched, totalPages, hasMore } = await tmdbApi.matchTopRatedRange({
      type: "tv",
      iptvItems: series,
      idField: "series_id",
      fromPage: 1,
      toPage: 5,
      seenIds,
    });
    return {
      streams: series,
      matched,
      seenIds,
      totalPages,
      hasMore,
      hasTmdb: true,
    };
  } catch {
    return null;
  }
}


/* ─── Shelf ─── */
function Shelf({
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
  }, [items !== null]);

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
          {...{ className: "lumen-shelf-title-btn" }}
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
        <div style={{ position: "relative" }} className="lumen-shelf-rail">
          <button className="lumen-shelf-nav" onClick={() => scrollBy(-800)} aria-label="Scroll left">
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
              />
            ))}
            {loadingMore && (
              <YStack
                width={ss(200)}
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
            className="lumen-shelf-nav right"
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
  const [focusedIdx, setFocusedIdx] = useState(0);
  const focusedIdxRef = useRef(0);
  const navHasFocusRef = useRef(false);
  // Column count is owned by VirtualGrid (derived from container width) and
  // mirrored here so the D-pad handler's up/down row math stays correct.
  const numColsRef = useRef(6);
  const filteredRef = useRef(null);
  const onPressRef = useRef(onPress);
  const onBackRef = useRef(onBack);
  useEffect(() => {
    onPressRef.current = onPress;
  }, [onPress]);
  useEffect(() => {
    onBackRef.current = onBack;
  }, [onBack]);

  const filtered = items
    ? search.trim()
      ? items.filter((i) =>
          i.name?.toLowerCase().includes(search.toLowerCase()),
        )
      : items
    : null;
  filteredRef.current = filtered;

  useEffect(() => {
    setFocusedIdx(0);
    focusedIdxRef.current = 0;
  }, [search]);

  useEffect(() => {
    const onNavFocus = () => {
      navHasFocusRef.current = true;
    };
    const onNavBlur = () => {
      navHasFocusRef.current = false;
    };
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
      // Focus roams the FULL filtered list — VirtualGrid keeps the focused row
      // mounted and scrolled into view even when it's outside the window.
      const list = filteredRef.current;
      if (!list?.length) return;
      const idx = focusedIdxRef.current;
      const numCols = numColsRef.current;
      if (e.key === "ArrowRight" || e.keyCode === 39) {
        e.preventDefault();
        const next = Math.min(idx + 1, list.length - 1);
        focusedIdxRef.current = next;
        setFocusedIdx(next);
      } else if (e.key === "ArrowLeft" || e.keyCode === 37) {
        e.preventDefault();
        const prev = Math.max(idx - 1, 0);
        focusedIdxRef.current = prev;
        setFocusedIdx(prev);
      } else if (e.key === "ArrowDown" || e.keyCode === 40) {
        e.preventDefault();
        const next = Math.min(idx + numCols, list.length - 1);
        focusedIdxRef.current = next;
        setFocusedIdx(next);
      } else if (e.key === "ArrowUp" || e.keyCode === 38) {
        e.preventDefault();
        if (idx >= numCols) {
          const prev = idx - numCols;
          focusedIdxRef.current = prev;
          setFocusedIdx(prev);
        } else {
          globalThis.dispatchEvent(new CustomEvent("tv-nav-focus"));
        }
      } else if (e.key === "Enter" || e.keyCode === 13) {
        const item = list[idx];
        if (item) onPressRef.current(item);
      } else if (e.key === "Escape" || e.keyCode === 27) {
        onBackRef.current();
      }
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  }, []);

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
            onColsChange={(c) => { numColsRef.current = c; }}
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
  const { activeUser, activeUserId } = useContentService();
  const { playVideo } = useApp();
  useScale(); // re-render + recompute ss() on window resize
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [shelves, setShelves] = useState([]);
  const [currentCategory, setCurrentCategory] = useState(null);
  const [categoryItems, setCategoryItems] = useState(null);
  const [currentSeries, setCurrentSeries] = useState(null);
  const loadedRef = useRef(new Set());
  const allShuffledRef = useRef([]);
  const topRatedRef = useRef([]);
  const prefetchRef = useRef({ topRated: null });
  const topRatedCursorRef = useRef(null);
  // Synchronous re-entrancy lock — set before the first await so a burst of
  // onEndReached calls in the same tick can't each pass the (async) state guard.
  const topRatedInFlightRef = useRef(false);
  const [topRatedLoadingMore, setTopRatedLoadingMore] = useState(false);
  const [topRatedHasMore, setTopRatedHasMore] = useState(false);

  useEffect(() => {
    if (activeUserId) load();
  }, [activeUserId]);

  const load = async () => {
    if (!activeUser) return;
    setLoading(true);
    setError(false);
    loadedRef.current.clear();
    allShuffledRef.current = [];
    topRatedRef.current = [];
    prefetchRef.current = { topRated: null };
    setShelves([]);
    try {
      const cats = await iptvApi.getSeriesCategories();
      if (!cats?.length) {
        setLoading(false);
        return;
      }
      setShelves(
        cats.map((c) => ({
          id: c.category_id,
          name: c.category_name,
          items: null,
          totalCount: null,
          hasMore: false,
          loadingMore: false,
        })),
      );
      prefetchRef.current = { topRated: prefetchTopRatedSeries() };
    } catch (err) {
      console.error("Error loading series:", err);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const handleShelfVisible = useCallback(async (catId) => {
    if (loadedRef.current.has(catId)) return;
    loadedRef.current.add(catId);
    try {
      let all;
      if (catId === "all") {
        const prefetched = prefetchRef.current.topRated
          ? await prefetchRef.current.topRated
          : null;
        const series =
          prefetched?.streams || (await iptvApi.getAllSeriesRobust());
        all = [...(series || [])].sort(() => Math.random() - 0.5);
        allShuffledRef.current = all;
      } else if (catId === "top_rated") {
        const series = await iptvApi.getAllSeriesRobust();
        if (tmdbApi.hasKey) all = await tmdbApi.matchSeries(series || []);
        if (!all?.length)
          all = [...(series || [])]
            .filter((s) => parseFloat(s.rating) > 0)
            .sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating));
        topRatedRef.current = all;
      } else {
        const series = await iptvApi.getSeries(catId);
        all = series || [];
      }
      const firstPage = all.slice(0, SHELF_PAGE);
      setShelves((prev) =>
        prev.map((s) =>
          s.id === catId
            ? {
                ...s,
                items: firstPage,
                totalCount: all.length,
                hasMore: all.length > SHELF_PAGE,
              }
            : s,
        ),
      );
    } catch {
      setShelves((prev) =>
        prev.map((s) =>
          s.id === catId
            ? { ...s, items: [], totalCount: 0, hasMore: false }
            : s,
        ),
      );
    }
  }, []);

  const handleLoadMore = useCallback(async (catId) => {
    setShelves((prev) =>
      prev.map((s) => (s.id === catId ? { ...s, loadingMore: true } : s)),
    );
    try {
      const all =
        catId === "all"
          ? allShuffledRef.current
          : catId === "top_rated"
            ? topRatedRef.current
            : await iptvApi.getSeries(catId);
      setShelves((prev) =>
        prev.map((s) => {
          if (s.id !== catId) return s;
          const nextItems = (all || []).slice(
            0,
            (s.items?.length || 0) + SHELF_PAGE,
          );
          return {
            ...s,
            items: nextItems,
            hasMore: nextItems.length < (all?.length || 0),
            loadingMore: false,
          };
        }),
      );
    } catch {
      setShelves((prev) =>
        prev.map((s) => (s.id === catId ? { ...s, loadingMore: false } : s)),
      );
    }
  }, []);

  const handleSeriesPress = (item) => setCurrentSeries(item);

  const handleTitlePress = async (catId, name) => {
    setCurrentCategory({ catId, name });
    setCategoryItems(null);
    try {
      let all;
      if (catId === "all") {
        if (!allShuffledRef.current.length) {
          const prefetched = prefetchRef.current.topRated
            ? await prefetchRef.current.topRated
            : null;
          const series =
            prefetched?.streams || (await iptvApi.getAllSeriesRobust());
          allShuffledRef.current = [...(series || [])].sort(
            () => Math.random() - 0.5,
          );
        }
        all = allShuffledRef.current;
      } else if (catId === "top_rated") {
        const prefetched = prefetchRef.current.topRated
          ? await prefetchRef.current.topRated
          : null;
        if (prefetched?.hasTmdb) {
          const { streams, matched, seenIds, totalPages, hasMore } = prefetched;
          topRatedCursorRef.current = {
            streams,
            type: "tv",
            idField: "series_id",
            page: 5,
            totalPages,
            seenIds,
            prefetch: null,
            prefetchTo: 0,
          };
          setTopRatedHasMore(hasMore);
          all = matched.length
            ? matched
            : [...streams]
                .filter((s) => parseFloat(s.rating) > 0)
                .sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating));
          if (!matched.length) setTopRatedHasMore(false);
          else if (hasMore) kickoffPrefetch(topRatedCursorRef.current);
        } else if (prefetched) {
          all = prefetched.matched;
          setTopRatedHasMore(false);
        } else {
          const series = await iptvApi.getAllSeriesRobust();
          if (tmdbApi.hasKey) {
            const seenIds = new Set();
            const { matched, totalPages, hasMore } =
              await tmdbApi.matchTopRatedRange({
                type: "tv",
                iptvItems: series || [],
                idField: "series_id",
                fromPage: 1,
                toPage: 5,
                seenIds,
              });
            topRatedCursorRef.current = {
              streams: series || [],
              type: "tv",
              idField: "series_id",
              page: 5,
              totalPages,
              seenIds,
              prefetch: null,
              prefetchTo: 0,
            };
            setTopRatedHasMore(hasMore);
            all = matched;
            if (!all.length) {
              all = [...(series || [])]
                .filter((s) => parseFloat(s.rating) > 0)
                .sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating));
              setTopRatedHasMore(false);
            } else if (hasMore) kickoffPrefetch(topRatedCursorRef.current);
          } else {
            all = [...(series || [])]
              .filter((s) => parseFloat(s.rating) > 0)
              .sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating));
            setTopRatedHasMore(false);
          }
        }
      } else {
        all = await iptvApi.getSeries(catId);
        if (!loadedRef.current.has(catId)) handleShelfVisible(catId);
      }
      setCategoryItems(all || []);
    } catch {
      setCategoryItems([]);
    }
  };

  const kickoffPrefetch = (cursor) => {
    if (!cursor || cursor.prefetch) return;
    const fromPage = cursor.page + 1;
    const toPage = Math.min(cursor.page + 5, cursor.totalPages || Infinity);
    if (fromPage > toPage) return;
    cursor.prefetchTo = toPage;
    cursor.prefetch = tmdbApi
      .matchTopRatedRange({
        type: cursor.type,
        iptvItems: cursor.streams,
        idField: cursor.idField,
        fromPage,
        toPage,
        seenIds: cursor.seenIds,
      })
      .catch(() => null);
  };

  const handleTopRatedMore = useCallback(async () => {
    const cursor = topRatedCursorRef.current;
    if (!cursor || topRatedInFlightRef.current) return;
    if (cursor.page >= cursor.totalPages && !cursor.prefetch) {
      setTopRatedHasMore(false);
      return;
    }
    topRatedInFlightRef.current = true;
    setTopRatedLoadingMore(true);
    try {
      let result;
      if (cursor.prefetch) {
        result = await cursor.prefetch;
        cursor.page = cursor.prefetchTo;
        cursor.prefetch = null;
      } else {
        const fromPage = cursor.page + 1;
        const toPage = Math.min(cursor.page + 5, cursor.totalPages);
        result = await tmdbApi.matchTopRatedRange({
          type: cursor.type,
          iptvItems: cursor.streams,
          idField: cursor.idField,
          fromPage,
          toPage,
          seenIds: cursor.seenIds,
        });
        cursor.page = toPage;
      }
      if (!result) return;
      cursor.totalPages = result.totalPages;
      setTopRatedHasMore(result.hasMore);
      if (result.matched.length)
        setCategoryItems((prev) => [...(prev || []), ...result.matched]);
      if (result.hasMore) kickoffPrefetch(cursor);
    } finally {
      setTopRatedLoadingMore(false);
      topRatedInFlightRef.current = false;
    }
  }, []);

  const discoverItems = [
    { id: "all", label: "All Series" },
    { id: "top_rated", label: "Top Rated" },
  ];
  const { focusedRow, focusedCol } = useTVNavigation({
    active: !currentCategory && !currentSeries,
    rows: [
      {
        items: discoverItems,
        onSelect: (i) =>
          handleTitlePress(discoverItems[i].id, discoverItems[i].label),
      },
    ],
  });

  if (loading) {
    return <StatePanel mode="loading" title="Loading series..." />;
  }

  if (error) {
    return (
      <StatePanel
        mode="error"
        title="Couldn't load series"
        message="Check your connection or IPTV account and try again"
        onRetry={load}
        retryLabel="Retry"
      />
    );
  }

  if (!activeUserId) {
    return (
      <StatePanel
        mode="empty"
        icon="tv"
        title="No IPTV Account"
        message="Add your IPTV service from Settings"
        cta={() => navigation.navigate("Accounts")}
        ctaLabel="Add Account"
      />
    );
  }

  const isTopRated = currentCategory?.catId === "top_rated";
  // Hero featured item — picked over the first populated shelf's real titles
  // (not the Discover pills). Only shown on the browse view (no overlay).
  const heroShelf = shelves.find((s) => s.items?.length);
  const heroItem = heroShelf ? selectHeroItem(heroShelf.items) : null;

  return (
    <YStack flex={1} minHeight={0} backgroundColor={colors.bg} position="relative">
      <ScrollView flex={1} minHeight={0} contentContainerStyle={{ paddingBottom: ss(80) }}>
        <YStack maxWidth={MAX_W} width="100%" alignSelf="center">
        {heroItem && (
          <YStack paddingHorizontal={ss(48)} paddingTop={ss(24)}>
            <Hero
              item={heroItem}
              onPlay={() => handleSeriesPress(heroItem)}
              onDetails={() => handleSeriesPress(heroItem)}
            />
          </YStack>
        )}
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
            onSelect={(pill) => handleTitlePress(pill.id, pill.label)}
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
                onPress={handleSeriesPress}
                onTitlePress={handleTitlePress}
                onLoadMore={handleLoadMore}
                manual={false}
              />
            ))
          ) : (
            <StatePanel
              mode="empty"
              icon="tv"
              title="No series found"
              message="We couldn't find any series for this account."
            />
          )}
        </YStack>
        </YStack>
      </ScrollView>
      {currentCategory && (
        <YStack position="absolute" top={0} left={0} right={0} bottom={0}>
          <CategoryPage
            name={currentCategory.name}
            items={categoryItems}
            onBack={() => {
              setCurrentCategory(null);
              setCategoryItems(null);
              topRatedCursorRef.current = null;
              setTopRatedHasMore(false);
              setTopRatedLoadingMore(false);
            }}
            onPress={handleSeriesPress}
            hasRemote={isTopRated && topRatedHasMore}
            loadingMore={isTopRated && topRatedLoadingMore}
            onLoadMore={isTopRated ? handleTopRatedMore : undefined}
          />
        </YStack>
      )}
      {currentSeries && (
        <YStack position="absolute" top={0} left={0} right={0} bottom={0}>
          <SeriesDetail
            item={currentSeries}
            onBack={() => setCurrentSeries(null)}
            onPlayEpisode={(videoObj) => {
              playVideo(videoObj);
              navigation.navigate("VideoPlayer");
              setCurrentSeries(null);
            }}
          />
        </YStack>
      )}
    </YStack>
  );
}
