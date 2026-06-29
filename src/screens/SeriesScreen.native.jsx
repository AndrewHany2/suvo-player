import { useState, useEffect, useCallback, useRef, memo } from "react";
import { FlatList, Image, RefreshControl } from "react-native";
import { YStack, XStack, Text, Input, ScrollView, Spinner } from "../ui/primitives";
import { colors } from "../ui/tokens";
import { useApp } from "../context/AppContext";
import { useTVNavigation } from "../hooks/useTVNavigation";
import iptvApi from "../services/iptvApi";
import tmdbApi from "../services/tmdbApi";
import SeriesDetail from "../components/SeriesDetail";

const FILL = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 };
const SHELF_PAGE = 12;
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
const PosterCard = memo(function PosterCard({ item, onPress }) {
  const poster = item.cover || item.backdrop_path || item.stream_icon || null;
  const ratingValue = item.tmdb_rating ?? item.rating;
  const ratingLabel = ratingValue != null && ratingValue !== ""
    ? (typeof ratingValue === "number" ? ratingValue.toFixed(1) : ratingValue)
    : null;
  return (
    <YStack width={130} cursor="pointer" onPress={() => onPress(item)} pressStyle={{ opacity: 0.8 }} hoverStyle={{ scale: 1.03 }} animation="quick">
      <YStack width={130} aspectRatio={2 / 3} borderRadius={8} backgroundColor={colors.surface} overflow="hidden" position="relative">
        {poster
          ? <Image source={{ uri: poster }} style={FILL} resizeMode="cover" />
          : <YStack style={FILL} backgroundColor={colors.surface} />}
        <YStack position="absolute" top={8} right={8} zIndex={4} backgroundColor="rgba(0,0,0,0.65)" borderRadius={4} paddingHorizontal={5} paddingVertical={2}>
          <Text color={colors.muted} fontSize={9} fontWeight="700" letterSpacing={0.5}>HD</Text>
        </YStack>
        {ratingLabel && (
          <YStack position="absolute" top={8} left={8} zIndex={4} backgroundColor="rgba(0,0,0,0.7)" borderRadius={4} paddingHorizontal={5} paddingVertical={2}>
            <Text color={colors.rating} fontSize={9} fontWeight="700">⭐ {ratingLabel}</Text>
          </YStack>
        )}
      </YStack>
      <Text color={colors.text} fontSize={12} fontWeight="600" marginTop={8} lineHeight={16} numberOfLines={2}>{item.name}</Text>
    </YStack>
  );
});

/* ─── Shelf ─── */
function Shelf({ shelf, onVisible, onPress, onTitlePress, onLoadMore }) {
  const hasLoaded = useRef(false);
  const handleLayout = useCallback(() => {
    if (!hasLoaded.current && shelf.items === null && !shelf.manual) {
      hasLoaded.current = true;
      onVisible(shelf.id);
    }
  }, [shelf.id, shelf.items, shelf.manual, onVisible]);

  if (shelf.items !== null && !shelf.items.length) return null;

  return (
    <YStack paddingTop={20} paddingBottom={8} onLayout={handleLayout}>
      <XStack alignItems="baseline" justifyContent="space-between" paddingHorizontal={16} marginBottom={14}>
        <YStack cursor="pointer" onPress={() => onTitlePress?.(shelf.id, shelf.name)} pressStyle={{ opacity: 0.8 }}>
          <Text color={colors.text} fontSize={20} fontWeight="700" letterSpacing={-0.3}>
            {shelf.name} <Text color={colors.accent} fontSize={16}>›</Text>
          </Text>
        </YStack>
        {shelf.totalCount != null && <Text color="#555" fontSize={13} fontWeight="500">{shelf.totalCount}</Text>}
      </XStack>
      {shelf.items === null ? (
        <YStack paddingHorizontal={16} paddingVertical={18}><Spinner size="small" color={colors.accent} /></YStack>
      ) : (
        <ScrollView
          horizontal showsHorizontalScrollIndicator={false} removeClippedSubviews
          contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
          onScroll={(e) => {
            if (!shelf.hasMore || shelf.loadingMore) return;
            const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
            if (contentSize.width - contentOffset.x - layoutMeasurement.width < 400) onLoadMore(shelf.id);
          }}
          scrollEventThrottle={200}
        >
          {shelf.items.map((item) => <PosterCard key={String(item.series_id)} item={item} onPress={onPress} />)}
          {shelf.loadingMore && <YStack width={60} justifyContent="center" alignItems="center"><Spinner size="small" color={colors.accent} /></YStack>}
        </ScrollView>
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

  return (
    <YStack flex={1} backgroundColor={colors.bg}>
      <XStack alignItems="center" gap={12} paddingHorizontal={16} paddingTop={16} paddingBottom={10} borderBottomWidth={1} borderBottomColor={colors.border}>
        <YStack paddingVertical={8} paddingHorizontal={12} backgroundColor={colors.surface2} borderRadius={8} cursor="pointer" onPress={onBack} pressStyle={{ opacity: 0.8 }}>
          <Text color={colors.accent} fontSize={14} fontWeight="600">← Back</Text>
        </YStack>
        <Text color={colors.text} fontSize={18} fontWeight="700" flex={1} numberOfLines={1}>{name}</Text>
        {filtered != null && (
          <YStack backgroundColor="rgba(255,255,255,0.07)" borderRadius={20} paddingHorizontal={10} paddingVertical={4}>
            <Text color={colors.muted} fontSize={12} fontWeight="600">{filtered.length.toLocaleString()}</Text>
          </YStack>
        )}
      </XStack>
      <Input margin={12} placeholder="Search titles..." placeholderTextColor="#555" value={search} onChangeText={setSearch} backgroundColor={colors.surface2} color={colors.text} borderRadius={10} paddingHorizontal={14} paddingVertical={10} fontSize={14} borderWidth={1} borderColor={colors.border} />
      {!displayed ? (
        <YStack flex={1} justifyContent="center" alignItems="center"><Spinner size="large" color={colors.accent} /></YStack>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={displayed}
          keyExtractor={(item) => String(item.series_id)}
          numColumns={3}
          contentContainerStyle={{ paddingHorizontal: 10, paddingVertical: 12 }}
          renderItem={({ item }) => <PosterCard item={item} onPress={onPress} />}
          onEndReached={() => { if (hasLocalMore) setDisplayCount((c) => Math.min(c + GRID_PAGE, filtered.length)); else if (hasRemote && !loadingMore && onLoadMore) onLoadMore(); }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={(hasMore || loadingMore) ? <YStack alignItems="center" paddingVertical={20}><Spinner size="small" color={colors.accent} /></YStack> : null}
          showsVerticalScrollIndicator={false}
        />
      )}
    </YStack>
  );
}

/* ─── Screen ─── */
export default function SeriesScreen({ navigation }) {
  const { users, activeUserId, playVideo } = useApp();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
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
    setLoading(true); setError(false);
    loadedRef.current.clear(); allShuffledRef.current = []; topRatedRef.current = []; prefetchRef.current = { topRated: null }; setShelves([]);
    try {
      iptvApi.setCredentials(user.host, user.username, user.password);
      const cats = await iptvApi.getSeriesCategories();
      if (!cats?.length) { setLoading(false); return; }
      setShelves(cats.map((c) => ({ id: c.category_id, name: c.category_name, items: null, totalCount: null, hasMore: false, loadingMore: false, manual: false })));
      prefetchRef.current = { topRated: prefetchTopRatedSeries() };
    } catch (err) { console.error("Error loading series:", err); setError(true); } finally { setLoading(false); }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
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
      } else { all = await iptvApi.getSeries(catId); }
      const firstPage = (all || []).slice(0, SHELF_PAGE);
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
      <YStack flex={1} justifyContent="center" alignItems="center" backgroundColor={colors.bg} padding={24}>
        <Spinner size="large" color={colors.accent} />
        <Text color={colors.muted} marginTop={12} fontSize={14}>Loading series...</Text>
      </YStack>
    );
  }

  if (!activeUserId) {
    return (
      <YStack flex={1} justifyContent="center" alignItems="center" backgroundColor={colors.bg} padding={24}>
        <Text fontSize={48} marginBottom={12}>📺</Text>
        <Text color={colors.text} fontSize={18} fontWeight="600" marginBottom={8}>No IPTV Account</Text>
        <Text color={colors.muted} fontSize={14} textAlign="center" marginBottom={20}>Tap "Accounts" to add your IPTV service</Text>
        <YStack backgroundColor={colors.accent} paddingHorizontal={24} paddingVertical={12} borderRadius={10} cursor="pointer" onPress={() => navigation.navigate("Accounts")} pressStyle={{ opacity: 0.9 }}>
          <Text color={colors.text} fontWeight="600">Add Account</Text>
        </YStack>
      </YStack>
    );
  }

  if (error) {
    return (
      <YStack flex={1} justifyContent="center" alignItems="center" backgroundColor={colors.bg} padding={24}>
        <Text fontSize={48} marginBottom={12}>⚠️</Text>
        <Text color={colors.danger} fontSize={18} fontWeight="600" marginBottom={8}>Couldn't load series</Text>
        <Text color={colors.muted} fontSize={14} textAlign="center" marginBottom={20}>Check your connection and try again.</Text>
        <YStack backgroundColor={colors.accent} paddingHorizontal={24} paddingVertical={12} borderRadius={10} cursor="pointer" onPress={load} pressStyle={{ opacity: 0.9 }}>
          <Text color={colors.text} fontWeight="600">Retry</Text>
        </YStack>
      </YStack>
    );
  }

  const isTopRated = currentCategory?.catId === "top_rated";
  const listHeader = (
    <YStack paddingHorizontal={16} paddingTop={20} paddingBottom={4}>
      <Text color={colors.text} fontSize={20} fontWeight="700" letterSpacing={-0.3} marginBottom={12}>Discover</Text>
      <XStack gap={10} flexWrap="wrap">
        {discoverItems.map((pill, idx) => (
          <XStack
            key={pill.id}
            alignItems="center" gap={8} paddingHorizontal={16} paddingVertical={10}
            backgroundColor="rgba(108, 92, 231,0.08)" borderWidth={1}
            borderColor={focusedRow === 0 && focusedCol === idx ? colors.accent2 : "rgba(108, 92, 231,0.28)"}
            borderRadius={999} cursor="pointer"
            onPress={() => handleTitlePress(pill.id, pill.label)}
            pressStyle={{ opacity: 0.75 }} hoverStyle={{ borderColor: colors.accent }} animation="quick"
            scale={focusedRow === 0 && focusedCol === idx ? 1.05 : 1}
          >
            <Text fontSize={14}>{pill.id === "all" ? "📺" : "⭐"}</Text>
            <Text color={colors.text} fontSize={12} fontWeight="600">{pill.label}</Text>
            <Text color={colors.accent} fontSize={14} fontWeight="700">→</Text>
          </XStack>
        ))}
      </XStack>
    </YStack>
  );

  return (
    <YStack flex={1} backgroundColor={colors.bg}>
      <FlatList
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 80 }}
        showsVerticalScrollIndicator={false}
        data={shelves}
        keyExtractor={(item) => String(item.id)}
        ListHeaderComponent={listHeader}
        renderItem={({ item }) => (
          <Shelf shelf={item} onVisible={handleShelfVisible} onPress={handleSeriesPress} onTitlePress={handleTitlePress} onLoadMore={handleLoadMore} />
        )}
        ListEmptyComponent={<YStack padding={60} alignItems="center"><Text color="#666" fontSize={15}>No series found</Text></YStack>}
        windowSize={5} maxToRenderPerBatch={3} initialNumToRender={3} removeClippedSubviews
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.accent} colors={[colors.accent]} />}
      />
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
