import { useState, useEffect, useCallback, useRef, memo } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useApp } from '../context/AppContext';
import iptvApi from '../services/iptvApi';
import tmdbApi from '../services/tmdbApi';
import MovieDetail from '../components/MovieDetail';

const SHELF_PAGE = 12;
const GRID_PAGE = 40;

async function prefetchTopRated() {
  try {
    const streams = await iptvApi.getAllVODStreamsRobust();
    if (!streams?.length) return null;
    if (!tmdbApi.hasKey) {
      return {
        streams,
        matched: [...streams].filter(s => parseFloat(s.rating) > 0)
          .sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating)),
        hasTmdb: false, seenIds: new Set(), totalPages: 0, hasMore: false,
      };
    }
    const seenIds = new Set();
    const { matched, totalPages, hasMore } = await tmdbApi.matchTopRatedRange({
      type: 'movie', iptvItems: streams, idField: 'stream_id', fromPage: 1, toPage: 5, seenIds,
    });
    return { streams, matched, seenIds, totalPages, hasMore, hasTmdb: true };
  } catch { return null; }
}

/* ─── Poster Card ─── */
const PosterCard = memo(function PosterCard({ item, onPress }) {
  const poster = item.stream_icon || item.cover || item.movie_image || null;
  const ratingValue = item.tmdb_rating ?? item.rating;
  const ratingLabel = ratingValue != null && ratingValue !== ''
    ? (typeof ratingValue === 'number' ? ratingValue.toFixed(1) : ratingValue)
    : null;
  return (
    <TouchableOpacity style={styles.posterCard} onPress={() => onPress(item)} activeOpacity={0.8}>
      <View style={styles.poster}>
        {poster ? (
          <Image source={{ uri: poster }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
        ) : (
          <View style={[StyleSheet.absoluteFillObject, styles.posterNoBg]} />
        )}
        <View style={styles.hdBadge}>
          <Text style={styles.hdText}>HD</Text>
        </View>
        {ratingLabel ? (
          <View style={styles.ratingBadge}>
            <Text style={styles.ratingBadgeText}>⭐ {ratingLabel}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.posterLabel} numberOfLines={2}>{item.name}</Text>
    </TouchableOpacity>
  );
});

/* ─── Shelf ─── */
function Shelf({ shelf, onVisible, onPress, onTitlePress, onLoadMore, savedScrollX = 0, onScrollX }) {
  const hasLoaded = useRef(false);
  const railRef = useRef(null);

  const handleLayout = useCallback(() => {
    if (!hasLoaded.current && shelf.items === null && !shelf.manual) {
      hasLoaded.current = true;
      onVisible(shelf.id);
    }
  }, [shelf.id, shelf.items, shelf.manual, onVisible]);

  // Restore horizontal scroll position when items load
  useEffect(() => {
    if (shelf.items !== null && savedScrollX > 0) {
      requestAnimationFrame(() => {
        railRef.current?.scrollTo({ x: savedScrollX, animated: false });
      });
    }
  }, [shelf.items !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  if (shelf.items !== null && !shelf.items.length) return null;

  return (
    <View style={styles.shelf} onLayout={handleLayout}>
      <View style={styles.shelfHead}>
        <TouchableOpacity onPress={() => onTitlePress && onTitlePress(shelf.id, shelf.name)}>
          <Text style={styles.shelfTitle}>
            {shelf.name} <Text style={styles.shelfArrow}>›</Text>
          </Text>
        </TouchableOpacity>
        {shelf.totalCount != null && <Text style={styles.shelfCount}>{shelf.totalCount}</Text>}
      </View>

      {shelf.items === null ? (
        <View style={styles.shelfLoading}>
          <ActivityIndicator size="small" color="#e94560" />
        </View>
      ) : (
        <ScrollView
          ref={railRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          removeClippedSubviews
          contentContainerStyle={styles.shelfTrack}
          onScroll={(e) => {
            onScrollX?.(e.nativeEvent.contentOffset.x);
            if (!shelf.hasMore || shelf.loadingMore) return;
            const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
            if (contentSize.width - contentOffset.x - layoutMeasurement.width < 400) {
              onLoadMore(shelf.id);
            }
          }}
          scrollEventThrottle={200}
        >
          {shelf.items.map((item) => (
            <PosterCard key={String(item.stream_id)} item={item} onPress={onPress} />
          ))}
          {shelf.loadingMore && (
            <View style={styles.loadMoreSpinner}>
              <ActivityIndicator size="small" color="#e94560" />
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

/* ─── Category Page ─── */
function CategoryPage({ name, items, onBack, onPlay, onLoadMore, hasRemote, loadingMore, savedScrollY = 0, onScrollY }) {
  const [displayCount, setDisplayCount] = useState(GRID_PAGE);
  const [search, setSearch] = useState('');
  const listRef = useRef(null);
  const pendingCatScrollRef = useRef(0);

  const filtered = items
    ? (search.trim() ? items.filter((i) => i.name?.toLowerCase().includes(search.toLowerCase())) : items)
    : null;
  const displayed = filtered ? filtered.slice(0, displayCount) : null;
  const hasLocalMore = filtered && displayCount < filtered.length;
  const hasMore = hasLocalMore || hasRemote;

  useEffect(() => { setDisplayCount(GRID_PAGE); }, [search]);

  // Set pending scroll target when items first appear
  useEffect(() => {
    if (displayed && savedScrollY > 0) {
      pendingCatScrollRef.current = savedScrollY;
      listRef.current?.scrollToOffset({ offset: savedScrollY, animated: false });
    }
  }, [!!displayed]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={styles.root}>
      <View style={styles.catHeader}>
        <TouchableOpacity style={styles.catBackBtn} onPress={onBack}>
          <Text style={styles.catBackText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.catPageTitle} numberOfLines={1}>{name}</Text>
        {filtered != null && (
          <View style={styles.catCountBadge}>
            <Text style={styles.catCount}>{filtered.length.toLocaleString()}</Text>
          </View>
        )}
      </View>
      <TextInput
        style={styles.catSearch}
        placeholder="Search titles..."
        placeholderTextColor="#555"
        value={search}
        onChangeText={setSearch}
      />
      {!displayed ? (
        <View style={styles.center}><ActivityIndicator size="large" color="#e94560" /></View>
      ) : (
        <FlatList
          ref={listRef}
          style={{ flex: 1 }}
          data={displayed}
          keyExtractor={(item) => String(item.stream_id)}
          numColumns={3}
          contentContainerStyle={styles.catGrid}
          onScroll={(e) => {
            const y = e.nativeEvent.contentOffset.y;
            onScrollY?.(y);
            if (pendingCatScrollRef.current > 0 && y >= pendingCatScrollRef.current - 5) {
              pendingCatScrollRef.current = 0;
            }
          }}
          scrollEventThrottle={100}
          onContentSizeChange={() => {
            if (pendingCatScrollRef.current > 0) {
              listRef.current?.scrollToOffset({ offset: pendingCatScrollRef.current, animated: false });
            }
          }}
          renderItem={({ item }) => <PosterCard item={item} onPress={onPlay} />}
          onEndReached={() => {
            if (hasLocalMore) {
              setDisplayCount((c) => Math.min(c + GRID_PAGE, filtered.length));
            } else if (hasRemote && !loadingMore && onLoadMore) {
              onLoadMore();
            }
          }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            (hasMore || loadingMore) ? (
              <View style={{ alignItems: 'center', paddingVertical: 20 }}>
                <ActivityIndicator size="small" color="#e94560" />
              </View>
            ) : null
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

/* ─── Screen ─── */
export default function MoviesScreen({ navigation }) {
  const { users, activeUserId, playVideo } = useApp();

  const [loading, setLoading] = useState(false);
  const [shelves, setShelves] = useState([]);
  const [currentCategory, setCurrentCategory] = useState(null);
  const [categoryItems, setCategoryItems] = useState(null);
  const [currentMovieDetail, setCurrentMovieDetail] = useState(null);
  const loadedRef = useRef(new Set());
  const allShuffledRef = useRef([]);
  const topRatedRef = useRef([]);
  const prefetchRef = useRef({ topRated: null });
  const topRatedCursorRef = useRef(null);
  const [topRatedLoadingMore, setTopRatedLoadingMore] = useState(false);
  const [topRatedHasMore, setTopRatedHasMore] = useState(false);
  const flatListRef = useRef(null);
  const scrollYRef = useRef(0);
  const catScrollYRef = useRef(0);
  const pendingScrollRef = useRef(0);
  const shelfScrollsRef = useRef({});
  const hadOverlayRef = useRef(false);

  useEffect(() => { if (activeUserId) load(); }, [activeUserId]);

  // When returning from detail/category, store the target so onContentSizeChange can restore it
  useEffect(() => {
    const hasOverlay = !!(currentMovieDetail || currentCategory);
    if (hadOverlayRef.current && !hasOverlay && scrollYRef.current > 0) {
      pendingScrollRef.current = scrollYRef.current;
      // immediate attempt in case content is already rendered
      flatListRef.current?.scrollToOffset({ offset: scrollYRef.current, animated: false });
    }
    if (hadOverlayRef.current && !currentCategory) catScrollYRef.current = 0;
    hadOverlayRef.current = hasOverlay;
  }, [currentMovieDetail, currentCategory]);

  const load = async () => {
    const user = users.find((u) => u.id === activeUserId);
    if (!user) return;
    setLoading(true);
    loadedRef.current.clear();
    allShuffledRef.current = [];
    topRatedRef.current = [];
    prefetchRef.current = { topRated: null };
    setShelves([]);
    try {
      iptvApi.setCredentials(user.host, user.username, user.password);
      const cats = await iptvApi.getVODCategories();
      if (!cats?.length) { setLoading(false); return; }
      setShelves(cats.map((c) => ({
        id: c.category_id, name: c.category_name, items: null, totalCount: null, hasMore: false, loadingMore: false, manual: false,
      })));
      prefetchRef.current = { topRated: prefetchTopRated() };
    } catch (err) {
      console.error('Error loading movies:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleShelfVisible = useCallback(async (catId) => {
    if (loadedRef.current.has(catId)) return;
    loadedRef.current.add(catId);
    try {
      let all;
      if (catId === 'all') {
        const prefetched = prefetchRef.current.topRated ? await prefetchRef.current.topRated : null;
        const streams = prefetched?.streams || await iptvApi.getAllVODStreamsRobust();
        all = [...(streams || [])].sort(() => Math.random() - 0.5);
        allShuffledRef.current = all;
      } else if (catId === 'top_rated') {
        const streams = await iptvApi.getAllVODStreamsRobust();
        if (tmdbApi.hasKey) all = await tmdbApi.matchMovies(streams || []);
        if (!all?.length) {
          all = [...(streams || [])].filter(s => parseFloat(s.rating) > 0).sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating));
        }
        topRatedRef.current = all;
      } else {
        all = await iptvApi.getVODStreams(catId);
      }
      const firstPage = (all || []).slice(0, SHELF_PAGE);
      setShelves((prev) => prev.map((s) => s.id === catId
        ? { ...s, items: firstPage, totalCount: all.length, hasMore: all.length > SHELF_PAGE }
        : s
      ));
    } catch {
      setShelves((prev) => prev.map((s) => s.id === catId ? { ...s, items: [], totalCount: 0, hasMore: false } : s));
    }
  }, []);

  const handleLoadMore = useCallback(async (catId) => {
    setShelves((prev) => prev.map((s) => s.id === catId ? { ...s, loadingMore: true } : s));
    try {
      const all = catId === 'all' ? allShuffledRef.current
        : catId === 'top_rated' ? topRatedRef.current
        : await iptvApi.getVODStreams(catId);
      setShelves((prev) => prev.map((s) => {
        if (s.id !== catId) return s;
        const nextItems = (all || []).slice(0, (s.items?.length || 0) + SHELF_PAGE);
        return { ...s, items: nextItems, hasMore: nextItems.length < (all?.length || 0), loadingMore: false };
      }));
    } catch {
      setShelves((prev) => prev.map((s) => s.id === catId ? { ...s, loadingMore: false } : s));
    }
  }, []);

  const handleMoviePress = (item) => setCurrentMovieDetail(item);

  const handleTitlePress = async (catId, name) => {
    setCurrentCategory({ catId, name });
    setCategoryItems(null);
    try {
      let all;
      if (catId === 'all') {
        if (!allShuffledRef.current.length) {
          const prefetched = prefetchRef.current.topRated ? await prefetchRef.current.topRated : null;
          const streams = prefetched?.streams || await iptvApi.getAllVODStreamsRobust();
          allShuffledRef.current = [...(streams || [])].sort(() => Math.random() - 0.5);
        }
        all = allShuffledRef.current;
      } else if (catId === 'top_rated') {
        const prefetched = prefetchRef.current.topRated
          ? await prefetchRef.current.topRated
          : null;
        if (prefetched?.hasTmdb) {
          const { streams, matched, seenIds, totalPages, hasMore } = prefetched;
          topRatedCursorRef.current = { streams, type: 'movie', idField: 'stream_id', page: 5, totalPages, seenIds, prefetch: null, prefetchTo: 0 };
          setTopRatedHasMore(hasMore);
          all = matched.length ? matched
            : [...streams].filter(s => parseFloat(s.rating) > 0).sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating));
          if (!matched.length) setTopRatedHasMore(false);
          else if (hasMore) kickoffPrefetch(topRatedCursorRef.current);
        } else if (prefetched) {
          all = prefetched.matched;
          setTopRatedHasMore(false);
        } else {
          const streams = await iptvApi.getAllVODStreamsRobust();
          if (tmdbApi.hasKey) {
            const seenIds = new Set();
            const { matched, totalPages, hasMore } = await tmdbApi.matchTopRatedRange({
              type: 'movie', iptvItems: streams || [], idField: 'stream_id',
              fromPage: 1, toPage: 5, seenIds,
            });
            topRatedCursorRef.current = { streams: streams || [], type: 'movie', idField: 'stream_id', page: 5, totalPages, seenIds, prefetch: null, prefetchTo: 0 };
            setTopRatedHasMore(hasMore);
            all = matched;
            if (!all.length) {
              all = [...(streams || [])].filter(s => parseFloat(s.rating) > 0).sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating));
              setTopRatedHasMore(false);
            } else if (hasMore) {
              kickoffPrefetch(topRatedCursorRef.current);
            }
          } else {
            all = [...(streams || [])].filter(s => parseFloat(s.rating) > 0).sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating));
            setTopRatedHasMore(false);
          }
        }
      } else {
        all = await iptvApi.getVODStreams(catId);
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
    cursor.prefetch = tmdbApi.matchTopRatedRange({
      type: cursor.type, iptvItems: cursor.streams, idField: cursor.idField,
      fromPage, toPage, seenIds: cursor.seenIds,
    }).catch(() => null);
  };

  const handleTopRatedMore = useCallback(async () => {
    const cursor = topRatedCursorRef.current;
    if (!cursor || topRatedLoadingMore) return;
    if (cursor.page >= cursor.totalPages && !cursor.prefetch) { setTopRatedHasMore(false); return; }
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
          type: cursor.type, iptvItems: cursor.streams, idField: cursor.idField,
          fromPage, toPage, seenIds: cursor.seenIds,
        });
        cursor.page = toPage;
      }
      if (!result) return;
      cursor.totalPages = result.totalPages;
      setTopRatedHasMore(result.hasMore);
      if (result.matched.length) setCategoryItems((prev) => [...(prev || []), ...result.matched]);
      if (result.hasMore) kickoffPrefetch(cursor);
    } finally {
      setTopRatedLoadingMore(false);
    }
  }, [topRatedLoadingMore]);

  /* ── Guards ── */
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#e94560" />
        <Text style={styles.loadingText}>Loading movies...</Text>
      </View>
    );
  }

  if (!activeUserId) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyIcon}>🎬</Text>
        <Text style={styles.emptyTitle}>No IPTV Account</Text>
        <Text style={styles.emptyHint}>Tap "Accounts" to add your IPTV service</Text>
        <TouchableOpacity style={styles.addBtn} onPress={() => navigation.navigate('Accounts')}>
          <Text style={styles.addBtnText}>Add Account</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const listHeader = (
    <>
      <View style={styles.discoverSection}>
        <Text style={styles.discoverTitle}>Discover</Text>
        <View style={styles.discoverRow}>
          <TouchableOpacity
            style={styles.discoverPill}
            activeOpacity={0.75}
            onPress={() => handleTitlePress('all', 'All Movies')}
          >
            <Text style={styles.discoverIcon}>🎬</Text>
            <Text style={styles.discoverLabel}>All Movies</Text>
            <Text style={styles.discoverArrow}>→</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.discoverPill}
            activeOpacity={0.75}
            onPress={() => handleTitlePress('top_rated', 'Top Rated')}
          >
            <Text style={styles.discoverIcon}>⭐</Text>
            <Text style={styles.discoverLabel}>Top Rated</Text>
            <Text style={styles.discoverArrow}>→</Text>
          </TouchableOpacity>
        </View>
      </View>
    </>
  );

  if (currentMovieDetail) {
    return (
      <MovieDetail
        item={currentMovieDetail}
        onBack={() => setCurrentMovieDetail(null)}
        onPlay={(videoObj) => { playVideo(videoObj); navigation.navigate('VideoPlayer'); setCurrentMovieDetail(null); }}
      />
    );
  }

  if (currentCategory) {
    const isTopRated = currentCategory.catId === 'top_rated';
    return (
      <CategoryPage
        name={currentCategory.name}
        items={categoryItems}
        onBack={() => {
          setCurrentCategory(null); setCategoryItems(null);
          topRatedCursorRef.current = null;
          setTopRatedHasMore(false); setTopRatedLoadingMore(false);
        }}
        onPlay={handleMoviePress}
        hasRemote={isTopRated && topRatedHasMore}
        loadingMore={isTopRated && topRatedLoadingMore}
        onLoadMore={isTopRated ? handleTopRatedMore : undefined}
        savedScrollY={catScrollYRef.current}
        onScrollY={(y) => { catScrollYRef.current = y; }}
      />
    );
  }

  return (
    <FlatList
      ref={flatListRef}
      style={styles.root}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
      onScroll={(e) => { scrollYRef.current = e.nativeEvent.contentOffset.y; }}
      scrollEventThrottle={100}
      onContentSizeChange={() => {
        if (pendingScrollRef.current > 0) {
          flatListRef.current?.scrollToOffset({ offset: pendingScrollRef.current, animated: false });
        }
      }}
      onMomentumScrollEnd={() => { pendingScrollRef.current = 0; }}
      onScrollEndDrag={() => { pendingScrollRef.current = 0; }}
      data={shelves}
      keyExtractor={(item) => String(item.id)}
      ListHeaderComponent={listHeader}
      renderItem={({ item }) => (
        <Shelf
          shelf={item}
          onVisible={handleShelfVisible}
          onPress={handleMoviePress}
          onTitlePress={handleTitlePress}
          onLoadMore={handleLoadMore}
          savedScrollX={shelfScrollsRef.current[item.id] || 0}
          onScrollX={(x) => { shelfScrollsRef.current[item.id] = x; }}
        />
      )}
      ListEmptyComponent={
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No movies found</Text>
        </View>
      }
      windowSize={5}
      maxToRenderPerBatch={3}
      initialNumToRender={3}
      removeClippedSubviews
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f0f23' },
  scroll: { paddingBottom: 80 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f0f23', padding: 24 },
  loadingText: { color: '#aaa', marginTop: 12, fontSize: 14 },

  /* ── Page body ── */
  pageBody: { paddingTop: 8 },

  /* ── Shelf ── */
  shelf: { paddingTop: 20, paddingBottom: 8 },
  shelfLoading: { paddingHorizontal: 16, paddingVertical: 18 },
  // Discover row
  discoverSection: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 4 },
  discoverTitle: { color: '#fff', fontSize: 20, fontWeight: '700', letterSpacing: -0.3, marginBottom: 12 },
  discoverRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  discoverPill: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: 'rgba(233, 69, 96, 0.08)',
    borderWidth: 1, borderColor: 'rgba(233, 69, 96, 0.28)',
    borderRadius: 999,
  },
  discoverIcon: { fontSize: 14 },
  discoverLabel: { color: '#fff', fontSize: 12, fontWeight: '600' },
  discoverArrow: { color: '#e94560', fontSize: 14, fontWeight: '700', marginLeft: 2 },
  shelfHead: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
    paddingHorizontal: 16, marginBottom: 14,
  },
  shelfTitle: { color: '#fff', fontSize: 20, fontWeight: '700', letterSpacing: -0.3 },
  shelfArrow: { color: '#e94560', fontSize: 16 },
  shelfCount: { color: '#555', fontSize: 13, fontWeight: '500' },
  shelfTrack: { paddingHorizontal: 16, gap: 10 },
  loadMoreSpinner: { width: 60, justifyContent: 'center', alignItems: 'center' },

  /* ── Poster card ── */
  posterCard: { width: 130, flexShrink: 0 },
  poster: {
    width: 130, aspectRatio: 2 / 3,
    borderRadius: 8, backgroundColor: '#16213e',
    overflow: 'hidden', position: 'relative',
  },
  posterLabel: { color: '#fff', fontSize: 12, fontWeight: '600', marginTop: 8, lineHeight: 16 },
  posterNoBg: { backgroundColor: '#16213e' },
  hdBadge: {
    position: 'absolute', top: 8, right: 8, zIndex: 4,
    backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 4,
    paddingHorizontal: 5, paddingVertical: 2,
  },
  hdText: { color: '#ccc', fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  ratingBadge: {
    position: 'absolute', top: 8, left: 8, zIndex: 4,
    backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 4,
    paddingHorizontal: 5, paddingVertical: 2,
  },
  ratingBadgeText: { color: '#ffd700', fontSize: 9, fontWeight: '700' },
  posterBottom: { position: 'absolute', left: 10, right: 10, bottom: 12, zIndex: 4 },
  accentBar: { width: 20, height: 2, backgroundColor: '#e94560', borderRadius: 1, marginBottom: 6 },
  posterTitle: { color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 0.3, lineHeight: 14 },
  posterMeta: { color: '#aaa', fontSize: 9, marginTop: 4, letterSpacing: 0.3 },

  /* ── Category page ── */
  catHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: '#2a2a4e',
  },
  catBackBtn: { paddingVertical: 8, paddingHorizontal: 12, backgroundColor: '#1a1a2e', borderRadius: 8, flexShrink: 0 },
  catBackText: { color: '#e94560', fontSize: 14, fontWeight: '600' },
  catPageTitle: { color: '#fff', fontSize: 18, fontWeight: '700', flex: 1 },
  catCountBadge: { backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  catCount: { color: '#888', fontSize: 12, fontWeight: '600' },
  catSearch: {
    margin: 12, backgroundColor: '#1a1a2e', color: '#fff',
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 14, borderWidth: 1, borderColor: '#2a2a4e',
  },
  catGrid: { paddingHorizontal: 10, paddingVertical: 12 },

  /* ── Empty ── */
  emptyState: { padding: 60, alignItems: 'center' },
  emptyText: { color: '#666', fontSize: 15 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { color: '#fff', fontSize: 18, fontWeight: '600', marginBottom: 8 },
  emptyHint: { color: '#888', fontSize: 14, textAlign: 'center', marginBottom: 20 },
  addBtn: { backgroundColor: '#e94560', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  addBtnText: { color: '#fff', fontWeight: '600' },
});
