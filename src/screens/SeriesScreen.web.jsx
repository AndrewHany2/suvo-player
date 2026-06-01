import { useState, useEffect, useCallback, useRef } from "react";
import { Image, View } from "react-native";
import { YStack, XStack, Text, Input, ScrollView, Spinner } from "tamagui";
import { useApp } from "../context/AppContext";
import { useTVNavigation } from "../hooks/useTVNavigation";
import iptvApi from "../services/iptvApi";
import tmdbApi from "../services/tmdbApi";
import SeriesDetail from "../components/SeriesDetail.web";

const FILL = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 };
const SHELF_PAGE = typeof window !== "undefined" ? Math.ceil(window.innerWidth / 200) + 2 : 10;
const GRID_PAGE = 40;

async function prefetchTopRatedSeries() {
  try {
    const series = await iptvApi.getAllSeriesRobust();
    if (!series?.length) return null;
    if (!tmdbApi.hasKey) {
      return {
        streams: series,
        matched: [...series].filter((s) => parseFloat(s.rating) > 0).sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating)),
        hasTmdb: false, seenIds: new Set(), totalPages: 0, hasMore: false,
      };
    }
    const seenIds = new Set();
    const { matched, totalPages, hasMore } = await tmdbApi.matchTopRatedRange({
      type: "tv", iptvItems: series, idField: "series_id", fromPage: 1, toPage: 5, seenIds,
    });
    return { streams: series, matched, seenIds, totalPages, hasMore, hasTmdb: true };
  } catch { return null; }
}

/* ─── Poster Card ─── */
function PosterCard({ item, onPress }) {
  const poster = item.cover || item.backdrop_path || item.stream_icon || null;
  const ratingValue = item.tmdb_rating ?? item.rating;
  const ratingLabel = ratingValue != null && ratingValue !== ""
    ? (typeof ratingValue === "number" ? ratingValue.toFixed(1) : ratingValue)
    : null;
  return (
    <YStack width={200} cursor="pointer" onPress={() => onPress(item)} pressStyle={{ opacity: 0.8 }} hoverStyle={{ scale: 1.03 }} animation="quick" {...({ className: "lumen-poster", "data-item-id": String(item.series_id) })}>
      <YStack width={200} aspectRatio={2 / 3} borderRadius={8} backgroundColor="#16213e" overflow="hidden" position="relative">
        {poster
          ? <Image source={{ uri: poster }} style={FILL} resizeMode="cover" />
          : <View style={[FILL, { backgroundColor: "#16213e" }]} />}
        <YStack position="absolute" top={8} right={8} zIndex={4} backgroundColor="rgba(0,0,0,0.65)" borderRadius={4} paddingHorizontal={5} paddingVertical={2}>
          <Text color="#ccc" fontSize={9} fontWeight="700" letterSpacing={0.5}>HD</Text>
        </YStack>
        {ratingLabel && (
          <YStack position="absolute" top={8} left={8} zIndex={4} backgroundColor="rgba(0,0,0,0.7)" borderRadius={4} paddingHorizontal={5} paddingVertical={2}>
            <Text color="#ffd700" fontSize={9} fontWeight="700">⭐ {ratingLabel}</Text>
          </YStack>
        )}
      </YStack>
      <Text color="#fff" fontSize={13} fontWeight="600" marginTop={10} lineHeight={17} numberOfLines={2}>{item.name}</Text>
    </YStack>
  );
}

/* ─── Shelf ─── */
function Shelf({ catId, title, items, totalCount, hasMore, loadingMore, onVisible, onPress, onTitlePress, onLoadMore, manual }) {
  const sentinelRef = useRef(null);
  const railRef = useRef(null);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartLeft = useRef(0);
  const hasDragged = useRef(false);

  useEffect(() => {
    if (items !== null || manual) return;
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") { onVisible(catId); return; }
    const obs = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { obs.disconnect(); onVisible(catId); } }, { rootMargin: "300px 0px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [catId, items, onVisible, manual]);

  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const onMouseDown = (e) => { isDragging.current = true; hasDragged.current = false; dragStartX.current = e.pageX; dragStartLeft.current = el.scrollLeft; el.style.cursor = "grabbing"; };
    const onMouseMove = (e) => { if (!isDragging.current) return; const dx = e.pageX - dragStartX.current; if (Math.abs(dx) > 4) { hasDragged.current = true; el.scrollLeft = dragStartLeft.current - dx; } };
    const onMouseUp = () => { isDragging.current = false; el.style.cursor = "grab"; };
    const onClickCapture = (e) => { if (hasDragged.current) { hasDragged.current = false; e.stopPropagation(); e.preventDefault(); } };
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

  const scrollBy = (delta) => { const el = railRef.current; if (el) el.scrollLeft = Math.max(0, el.scrollLeft + delta); };
  const handleScroll = (e) => {
    if (!hasMore || loadingMore) return;
    const { scrollLeft, scrollWidth, clientWidth } = e.target;
    if (scrollWidth - scrollLeft - clientWidth < 500) onLoadMore(catId);
  };

  return (
    <YStack paddingTop={28} paddingBottom={8} overflow="visible">
      <div ref={sentinelRef} style={{ height: 0 }} />
      <XStack alignItems="baseline" justifyContent="space-between" paddingHorizontal={48} marginBottom={14}>
        <YStack cursor="pointer" onPress={() => onTitlePress?.(catId, title)} pressStyle={{ opacity: 0.8 }} {...({ className: "lumen-shelf-title-btn" })}>
          <Text color="#fff" fontSize={22} fontWeight="700" letterSpacing={-0.3}>{title} <Text color="#e94560" fontSize={18}>›</Text></Text>
        </YStack>
        {totalCount != null && <Text color="#555" fontSize={13} fontWeight="500">{totalCount}</Text>}
      </XStack>
      {items === null ? (
        <YStack paddingHorizontal={48} paddingVertical={18}><Spinner size="small" color="#e94560" /></YStack>
      ) : (
        <div style={{ position: "relative" }} className="lumen-shelf-rail">
          <button className="lumen-shelf-nav" onClick={() => scrollBy(-800)}>‹</button>
          <div ref={railRef} onScroll={handleScroll} style={{ display: "flex", overflowX: "auto", gap: 8, paddingLeft: 48, paddingRight: 48, scrollbarWidth: "none", msOverflowStyle: "none", cursor: "grab" }}>
            {items.map((item) => <PosterCard key={String(item.series_id)} item={item} onPress={onPress} />)}
            {loadingMore && (
              <YStack width={200} aspectRatio={2 / 3} borderRadius={8} backgroundColor="#16213e" borderWidth={1} borderColor="#2a2a4e" justifyContent="center" alignItems="center">
                <Spinner size="small" color="#e94560" />
              </YStack>
            )}
          </div>
          <button className="lumen-shelf-nav right" onClick={() => scrollBy(800)}>›</button>
        </div>
      )}
    </YStack>
  );
}

/* ─── Category Page ─── */
function CategoryPage({ name, items, onBack, onPress, onLoadMore, hasRemote, loadingMore }) {
  const [displayCount, setDisplayCount] = useState(GRID_PAGE);
  const [search, setSearch] = useState("");
  const filtered = items ? (search.trim() ? items.filter((i) => i.name?.toLowerCase().includes(search.toLowerCase())) : items) : null;
  const displayed = filtered ? filtered.slice(0, displayCount) : null;
  const hasLocalMore = filtered && displayCount < filtered.length;
  const hasMore = hasLocalMore || hasRemote;
  useEffect(() => { setDisplayCount(GRID_PAGE); }, [search]);

  const handleScroll = ({ nativeEvent: { layoutMeasurement, contentOffset, contentSize } }) => {
    if (contentSize.height - contentOffset.y - layoutMeasurement.height >= 800) return;
    if (hasLocalMore) setDisplayCount((c) => Math.min(c + GRID_PAGE, filtered.length));
    else if (hasRemote && !loadingMore && onLoadMore) onLoadMore();
  };

  return (
    <YStack flex={1} backgroundColor="#0f0f23">
      <XStack alignItems="center" gap={14} paddingHorizontal={48} paddingVertical={18} borderBottomWidth={1} borderBottomColor="#2a2a4e">
        <YStack paddingVertical={8} paddingHorizontal={14} backgroundColor="#1a1a2e" borderRadius={8} cursor="pointer" onPress={onBack} pressStyle={{ opacity: 0.8 }}>
          <Text color="#e94560" fontSize={14} fontWeight="600">← Back</Text>
        </YStack>
        <Text color="#fff" fontSize={22} fontWeight="700">{name}</Text>
        {filtered != null && (
          <YStack backgroundColor="rgba(255,255,255,0.07)" borderRadius={20} paddingHorizontal={10} paddingVertical={4}>
            <Text color="#888" fontSize={12} fontWeight="600">{filtered.length.toLocaleString()}</Text>
          </YStack>
        )}
        <Input flex={1} placeholder="Search titles..." placeholderTextColor="#555" value={search} onChangeText={setSearch} backgroundColor="#1a1a2e" color="#fff" borderRadius={10} paddingHorizontal={14} paddingVertical={10} fontSize={14} borderWidth={1} borderColor="#2a2a4e" />
      </XStack>
      {!displayed ? (
        <YStack flex={1} justifyContent="center" alignItems="center"><Spinner size="large" color="#e94560" /></YStack>
      ) : (
        <ScrollView flex={1} minHeight={0} contentContainerStyle={{ paddingHorizontal: 48, paddingVertical: 32 }} onScroll={handleScroll} scrollEventThrottle={200}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, 200px)", gap: 12, justifyContent: "center" }}>
            {displayed.map((item) => <PosterCard key={String(item.series_id)} item={item} onPress={onPress} />)}
          </div>
          {(hasMore || loadingMore) && <YStack alignItems="center" paddingVertical={24}><Spinner size="small" color="#e94560" /></YStack>}
        </ScrollView>
      )}
    </YStack>
  );
}

/* ─── Screen ─── */
export default function SeriesScreen({ navigation }) {
  const { users, activeUserId, playVideo } = useApp();
  const [loading, setLoading] = useState(false);
  const [shelves, setShelves] = useState([]);
  const [currentCategory, setCurrentCategory] = useState(null);
  const [categoryItems, setCategoryItems] = useState(null);
  const [currentSeries, setCurrentSeries] = useState(null);
  const loadedRef = useRef(new Set());
  const allShuffledRef = useRef([]);
  const topRatedRef = useRef([]);
  const prefetchRef = useRef({ topRated: null });
  const topRatedCursorRef = useRef(null);
  const [topRatedLoadingMore, setTopRatedLoadingMore] = useState(false);
  const [topRatedHasMore, setTopRatedHasMore] = useState(false);

  useEffect(() => { if (activeUserId) load(); }, [activeUserId]);

  const load = async () => {
    const user = users.find((u) => u.id === activeUserId);
    if (!user) return;
    setLoading(true);
    loadedRef.current.clear(); allShuffledRef.current = []; topRatedRef.current = []; prefetchRef.current = { topRated: null }; setShelves([]);
    try {
      iptvApi.setCredentials(user.host, user.username, user.password);
      const cats = await iptvApi.getSeriesCategories();
      if (!cats?.length) { setLoading(false); return; }
      setShelves(cats.map((c) => ({ id: c.category_id, name: c.category_name, items: null, totalCount: null, hasMore: false, loadingMore: false })));
      prefetchRef.current = { topRated: prefetchTopRatedSeries() };
    } catch (err) { console.error("Error loading series:", err); } finally { setLoading(false); }
  };

  const handleShelfVisible = useCallback(async (catId) => {
    if (loadedRef.current.has(catId)) return;
    loadedRef.current.add(catId);
    try {
      let all;
      if (catId === "all") {
        const prefetched = prefetchRef.current.topRated ? await prefetchRef.current.topRated : null;
        const series = prefetched?.streams || await iptvApi.getAllSeriesRobust();
        all = [...(series || [])].sort(() => Math.random() - 0.5);
        allShuffledRef.current = all;
      } else if (catId === "top_rated") {
        const series = await iptvApi.getAllSeriesRobust();
        if (tmdbApi.hasKey) all = await tmdbApi.matchSeries(series || []);
        if (!all?.length) all = [...(series || [])].filter((s) => parseFloat(s.rating) > 0).sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating));
        topRatedRef.current = all;
      } else { const series = await iptvApi.getSeries(catId); all = series || []; }
      const firstPage = all.slice(0, SHELF_PAGE);
      setShelves((prev) => prev.map((s) => s.id === catId ? { ...s, items: firstPage, totalCount: all.length, hasMore: all.length > SHELF_PAGE } : s));
    } catch { setShelves((prev) => prev.map((s) => s.id === catId ? { ...s, items: [], totalCount: 0, hasMore: false } : s)); }
  }, []);

  const handleLoadMore = useCallback(async (catId) => {
    setShelves((prev) => prev.map((s) => s.id === catId ? { ...s, loadingMore: true } : s));
    try {
      const all = catId === "all" ? allShuffledRef.current : catId === "top_rated" ? topRatedRef.current : await iptvApi.getSeries(catId);
      setShelves((prev) => prev.map((s) => { if (s.id !== catId) return s; const nextItems = (all || []).slice(0, (s.items?.length || 0) + SHELF_PAGE); return { ...s, items: nextItems, hasMore: nextItems.length < (all?.length || 0), loadingMore: false }; }));
    } catch { setShelves((prev) => prev.map((s) => s.id === catId ? { ...s, loadingMore: false } : s)); }
  }, []);

  const handleSeriesPress = (item) => setCurrentSeries(item);

  const handleTitlePress = async (catId, name) => {
    setCurrentCategory({ catId, name }); setCategoryItems(null);
    try {
      let all;
      if (catId === "all") {
        if (!allShuffledRef.current.length) {
          const prefetched = prefetchRef.current.topRated ? await prefetchRef.current.topRated : null;
          const series = prefetched?.streams || await iptvApi.getAllSeriesRobust();
          allShuffledRef.current = [...(series || [])].sort(() => Math.random() - 0.5);
        }
        all = allShuffledRef.current;
      } else if (catId === "top_rated") {
        const prefetched = prefetchRef.current.topRated ? await prefetchRef.current.topRated : null;
        if (prefetched?.hasTmdb) {
          const { streams, matched, seenIds, totalPages, hasMore } = prefetched;
          topRatedCursorRef.current = { streams, type: "tv", idField: "series_id", page: 5, totalPages, seenIds, prefetch: null, prefetchTo: 0 };
          setTopRatedHasMore(hasMore);
          all = matched.length ? matched : [...streams].filter((s) => parseFloat(s.rating) > 0).sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating));
          if (!matched.length) setTopRatedHasMore(false); else if (hasMore) kickoffPrefetch(topRatedCursorRef.current);
        } else if (prefetched) { all = prefetched.matched; setTopRatedHasMore(false); }
        else {
          const series = await iptvApi.getAllSeriesRobust();
          if (tmdbApi.hasKey) {
            const seenIds = new Set();
            const { matched, totalPages, hasMore } = await tmdbApi.matchTopRatedRange({ type: "tv", iptvItems: series || [], idField: "series_id", fromPage: 1, toPage: 5, seenIds });
            topRatedCursorRef.current = { streams: series || [], type: "tv", idField: "series_id", page: 5, totalPages, seenIds, prefetch: null, prefetchTo: 0 };
            setTopRatedHasMore(hasMore); all = matched;
            if (!all.length) { all = [...(series || [])].filter((s) => parseFloat(s.rating) > 0).sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating)); setTopRatedHasMore(false); }
            else if (hasMore) kickoffPrefetch(topRatedCursorRef.current);
          } else { all = [...(series || [])].filter((s) => parseFloat(s.rating) > 0).sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating)); setTopRatedHasMore(false); }
        }
      } else { all = await iptvApi.getSeries(catId); if (!loadedRef.current.has(catId)) handleShelfVisible(catId); }
      setCategoryItems(all || []);
    } catch { setCategoryItems([]); }
  };

  const kickoffPrefetch = (cursor) => {
    if (!cursor || cursor.prefetch) return;
    const fromPage = cursor.page + 1; const toPage = Math.min(cursor.page + 5, cursor.totalPages || Infinity);
    if (fromPage > toPage) return;
    cursor.prefetchTo = toPage;
    cursor.prefetch = tmdbApi.matchTopRatedRange({ type: cursor.type, iptvItems: cursor.streams, idField: cursor.idField, fromPage, toPage, seenIds: cursor.seenIds }).catch(() => null);
  };

  const handleTopRatedMore = useCallback(async () => {
    const cursor = topRatedCursorRef.current;
    if (!cursor || topRatedLoadingMore) return;
    if (cursor.page >= cursor.totalPages && !cursor.prefetch) { setTopRatedHasMore(false); return; }
    setTopRatedLoadingMore(true);
    try {
      let result;
      if (cursor.prefetch) { result = await cursor.prefetch; cursor.page = cursor.prefetchTo; cursor.prefetch = null; }
      else {
        const fromPage = cursor.page + 1; const toPage = Math.min(cursor.page + 5, cursor.totalPages);
        result = await tmdbApi.matchTopRatedRange({ type: cursor.type, iptvItems: cursor.streams, idField: cursor.idField, fromPage, toPage, seenIds: cursor.seenIds });
        cursor.page = toPage;
      }
      if (!result) return;
      cursor.totalPages = result.totalPages; setTopRatedHasMore(result.hasMore);
      if (result.matched.length) setCategoryItems((prev) => [...(prev || []), ...result.matched]);
      if (result.hasMore) kickoffPrefetch(cursor);
    } finally { setTopRatedLoadingMore(false); }
  }, [topRatedLoadingMore]);

  const discoverItems = [
    { id: "all", label: "All Series" },
    { id: "top_rated", label: "Top Rated" },
  ];
  const { focusedRow, focusedCol } = useTVNavigation({
    active: !currentCategory && !currentSeries,
    rows: [{ items: discoverItems, onSelect: (i) => handleTitlePress(discoverItems[i].id, discoverItems[i].label) }],
  });

  if (loading) {
    return (
      <YStack flex={1} justifyContent="center" alignItems="center" backgroundColor="#0f0f23" padding={24}>
        <Spinner size="large" color="#e94560" />
        <Text color="#aaa" marginTop={12} fontSize={14}>Loading series...</Text>
      </YStack>
    );
  }

  if (!activeUserId) {
    return (
      <YStack flex={1} justifyContent="center" alignItems="center" backgroundColor="#0f0f23" padding={24}>
        <Text fontSize={48} marginBottom={12}>📺</Text>
        <Text color="#fff" fontSize={18} fontWeight="600" marginBottom={8}>No IPTV Account</Text>
        <Text color="#888" fontSize={14} textAlign="center" marginBottom={20}>Add your IPTV service from Settings</Text>
        <YStack backgroundColor="#e94560" paddingHorizontal={24} paddingVertical={12} borderRadius={10} cursor="pointer" onPress={() => navigation.navigate("Accounts")} pressStyle={{ opacity: 0.9 }}>
          <Text color="#fff" fontWeight="600">Add Account</Text>
        </YStack>
      </YStack>
    );
  }

  const isTopRated = currentCategory?.catId === "top_rated";

  return (
    <YStack flex={1} backgroundColor="#0f0f23">
      <ScrollView flex={1} contentContainerStyle={{ paddingBottom: 80 }}>
        <YStack paddingHorizontal={48} paddingTop={24} paddingBottom={4}>
          <Text color="#fff" fontSize={22} fontWeight="700" letterSpacing={-0.3} marginBottom={12}>Discover</Text>
          <XStack gap={10} flexWrap="wrap">
            {discoverItems.map((pill, idx) => (
              <XStack
                key={pill.id}
                alignItems="center" gap={10} paddingHorizontal={18} paddingVertical={11}
                backgroundColor="rgba(233,69,96,0.08)" borderWidth={1}
                borderColor={focusedRow === 0 && focusedCol === idx ? "#e94560" : "rgba(233,69,96,0.28)"}
                borderRadius={999} cursor="pointer"
                onPress={() => handleTitlePress(pill.id, pill.label)}
                pressStyle={{ opacity: 0.75 }} hoverStyle={{ borderColor: "#e94560" }} animation="quick"
                scale={focusedRow === 0 && focusedCol === idx ? 1.05 : 1}
                {...({ className: "lumen-load-cta" })}
              >
                <Text fontSize={16}>{pill.id === "all" ? "📺" : "⭐"}</Text>
                <Text color="#fff" fontSize={13} fontWeight="600" letterSpacing={0.1}>{pill.label}</Text>
                <Text color="#e94560" fontSize={16} fontWeight="700">→</Text>
              </XStack>
            ))}
          </XStack>
        </YStack>
        <YStack>
          {shelves.length > 0 ? (
            shelves.map((shelf) => (
              <Shelf
                key={shelf.id} catId={shelf.id} title={shelf.name} items={shelf.items}
                totalCount={shelf.totalCount} hasMore={shelf.hasMore} loadingMore={shelf.loadingMore}
                onVisible={handleShelfVisible} onPress={handleSeriesPress} onTitlePress={handleTitlePress}
                onLoadMore={handleLoadMore} manual={false}
              />
            ))
          ) : (
            <YStack padding={60} alignItems="center"><Text color="#666" fontSize={15}>No series found</Text></YStack>
          )}
        </YStack>
      </ScrollView>
      {currentCategory && (
        <YStack position="absolute" top={0} left={0} right={0} bottom={0}>
          <CategoryPage
            name={currentCategory.name} items={categoryItems}
            onBack={() => { setCurrentCategory(null); setCategoryItems(null); topRatedCursorRef.current = null; setTopRatedHasMore(false); setTopRatedLoadingMore(false); }}
            onPress={handleSeriesPress}
            hasRemote={isTopRated && topRatedHasMore} loadingMore={isTopRated && topRatedLoadingMore}
            onLoadMore={isTopRated ? handleTopRatedMore : undefined}
          />
        </YStack>
      )}
      {currentSeries && (
        <YStack position="absolute" top={0} left={0} right={0} bottom={0}>
          <SeriesDetail
            item={currentSeries}
            onBack={() => setCurrentSeries(null)}
            onPlayEpisode={(videoObj) => { playVideo(videoObj); navigation.navigate("VideoPlayer"); setCurrentSeries(null); }}
          />
        </YStack>
      )}
    </YStack>
  );
}
