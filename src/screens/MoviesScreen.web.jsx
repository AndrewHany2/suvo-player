import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, Image, TextInput,
} from 'react-native';
import { useApp } from '../context/AppContext';
import iptvApi from '../services/iptvApi';
import tmdbApi from '../services/tmdbApi';
import MovieDetail from '../components/MovieDetail.web';

/* ─── Poster Card ─── */
function PosterCard({ item, onPress }) {
  const poster = item.stream_icon || item.cover || item.movie_image || null;
  const ratingValue = item.tmdb_rating ?? item.rating;
  const ratingLabel = ratingValue != null && ratingValue !== ''
    ? (typeof ratingValue === 'number' ? ratingValue.toFixed(1) : ratingValue)
    : null;
  return (
    <TouchableOpacity
      style={styles.posterCard}
      onPress={() => onPress(item)}
      {...({ className: 'lumen-poster' })}
    >
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
}


const SHELF_PAGE = typeof window !== 'undefined' ? Math.ceil(window.innerWidth / 200) + 2 : 10;
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

/* ─── Shelf — lazy-loads when visible, parent drives pagination ─── */
function Shelf({ catId, title, items, totalCount, hasMore, loadingMore, onVisible, onPlay, onTitlePress, onLoadMore, manual, savedScrollX = 0, onScrollX }) {
  const sentinelRef = useRef(null);
  const railRef = useRef(null);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartLeft = useRef(0);
  const hasDragged = useRef(false);
  useEffect(() => {
    if (items !== null) return;
    if (manual) return;
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') { onVisible(catId); return; }
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { obs.disconnect(); onVisible(catId); } },
      { rootMargin: '300px 0px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [catId, items, onVisible, manual]);

  // Restore horizontal scroll when items load
  useEffect(() => {
    if (items !== null && savedScrollX > 0 && railRef.current) {
      requestAnimationFrame(() => { railRef.current.scrollLeft = savedScrollX; });
    }
  }, [items !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const onMouseDown = (e) => {
      isDragging.current = true;
      hasDragged.current = false;
      dragStartX.current = e.pageX;
      dragStartLeft.current = el.scrollLeft;
      el.style.cursor = 'grabbing';
    };
    const onMouseMove = (e) => {
      if (!isDragging.current) return;
      const dx = e.pageX - dragStartX.current;
      if (Math.abs(dx) > 4) { hasDragged.current = true; el.scrollLeft = dragStartLeft.current - dx; }
    };
    const onMouseUp = () => { isDragging.current = false; el.style.cursor = 'grab'; };
    const onClickCapture = (e) => {
      if (hasDragged.current) { hasDragged.current = false; e.stopPropagation(); e.preventDefault(); }
    };
    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('click', onClickCapture, true);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      el.removeEventListener('mousedown', onMouseDown);
      el.removeEventListener('click', onClickCapture, true);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [items !== null]);

  if (items !== null && !items?.length) return null;

  const scrollBy = (delta) => {
    const el = railRef.current;
    if (el) el.scrollLeft = Math.max(0, el.scrollLeft + delta);
  };

  const handleScroll = (e) => {
    onScrollX?.(e.target.scrollLeft);
    if (!hasMore || loadingMore) return;
    const { scrollLeft, scrollWidth, clientWidth } = e.target;
    if (scrollWidth - scrollLeft - clientWidth < 500) onLoadMore(catId);
  };

  return (
    <View style={styles.shelf}>
      <div ref={sentinelRef} style={{ height: 0 }} />
      <View style={styles.shelfHead}>
        <TouchableOpacity onPress={() => onTitlePress && onTitlePress(catId, title)} {...({ className: 'lumen-shelf-title-btn' })}>
          <Text style={styles.shelfTitle}>{title} <Text style={styles.shelfTitleArrow}>›</Text></Text>
        </TouchableOpacity>
        {totalCount != null && <Text style={styles.shelfCount}>{totalCount}</Text>}
      </View>
      {items === null ? (
        <View style={styles.shelfLoading}>
          <ActivityIndicator size="small" color="#e94560" />
        </View>
      ) : (
        <div style={{ position: 'relative' }} className="lumen-shelf-rail">
          <button className="lumen-shelf-nav" onClick={() => scrollBy(-800)}>‹</button>
          <div
            ref={railRef}
            onScroll={handleScroll}
            style={{ display: 'flex', overflowX: 'auto', gap: 8, paddingLeft: 48, paddingRight: 48, scrollbarWidth: 'none', msOverflowStyle: 'none', cursor: 'grab' }}
          >
            {items.map((item) => (
              <PosterCard key={String(item.stream_id)} item={item} onPress={onPlay} />
            ))}
            {loadingMore && (
              <View style={[styles.seeMoreCard, { justifyContent: 'center', alignItems: 'center' }]}>
                <ActivityIndicator size="small" color="#e94560" />
              </View>
            )}
          </div>
          <button className="lumen-shelf-nav right" onClick={() => scrollBy(800)}>›</button>
        </div>
      )}
    </View>
  );
}

/* ─── Category Page — paginates 40 items at a time, with search ─── */
function CategoryPage({ name, items, onBack, onPlay, onLoadMore, hasRemote, loadingMore, savedScrollY = 0, onScrollY }) {
  const [displayCount, setDisplayCount] = useState(GRID_PAGE);
  const [search, setSearch] = useState('');
  const scrollRef = useRef(null);

  const filtered = items
    ? (search.trim() ? items.filter((i) => i.name?.toLowerCase().includes(search.toLowerCase())) : items)
    : null;
  const displayed = filtered ? filtered.slice(0, displayCount) : null;
  const hasLocalMore = filtered && displayCount < filtered.length;
  const hasMore = hasLocalMore || hasRemote;

  useEffect(() => { setDisplayCount(GRID_PAGE); }, [search]);

  // Restore scroll when returning from a detail — multi-retry for web
  useEffect(() => {
    if (displayed && savedScrollY > 0) {
      const target = savedScrollY;
      scrollRef.current?.scrollTo({ y: target, animated: false });
      setTimeout(() => { scrollRef.current?.scrollTo({ y: target, animated: false }); }, 80);
      setTimeout(() => { scrollRef.current?.scrollTo({ y: target, animated: false }); }, 250);
    }
  }, [!!displayed]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleScroll = ({ nativeEvent: { layoutMeasurement, contentOffset, contentSize } }) => {
    onScrollY?.(contentOffset.y);
    if (contentSize.height - contentOffset.y - layoutMeasurement.height >= 800) return;
    if (hasLocalMore) {
      setDisplayCount((c) => Math.min(c + GRID_PAGE, filtered.length));
    } else if (hasRemote && !loadingMore && onLoadMore) {
      onLoadMore();
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.catHeader}>
        <TouchableOpacity style={styles.catBackBtn} onPress={onBack}>
          <Text style={styles.catBackText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.catPageTitle}>{name}</Text>
        {filtered != null && (
          <View style={styles.catCountBadge}>
            <Text style={styles.catCount}>{filtered.length.toLocaleString()}</Text>
          </View>
        )}
        <TextInput
          style={styles.catSearch}
          placeholder="Search titles..."
          placeholderTextColor="#555"
          value={search}
          onChangeText={setSearch}
        />
      </View>
      {!displayed ? (
        <View style={styles.center}><ActivityIndicator size="large" color="#e94560" /></View>
      ) : (
        <ScrollView ref={scrollRef} style={{ flex: 1, minHeight: 0 }} contentContainerStyle={styles.catGrid} onScroll={handleScroll} scrollEventThrottle={200}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 200px)', gap: 12, justifyContent: 'center' }}>
            {displayed.map((item) => (
              <PosterCard key={String(item.stream_id)} item={item} onPress={onPlay} />
            ))}
          </div>
          {(hasMore || loadingMore) && (
            <View style={{ alignItems: 'center', paddingVertical: 24 }}>
              <ActivityIndicator size="small" color="#e94560" />
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

/* ─── Screen ─── */
export default function MoviesScreen({ navigation }) {
  const { users, activeUserId, playVideo, watchHistory } = useApp();

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
  const scrollViewRef = useRef(null);
  const scrollYRef = useRef(0);
  const catScrollYRef = useRef(0);
  const shelfScrollsRef = useRef({});
  const hadOverlayRef = useRef(false);

  useEffect(() => { if (activeUserId) load(); }, [activeUserId]);

  // Restore scroll position when returning from a detail/category page
  useEffect(() => {
    const hasOverlay = !!(currentMovieDetail || currentCategory);
    if (hadOverlayRef.current && !hasOverlay && scrollYRef.current > 0) {
      const target = scrollYRef.current;
      // Multi-retry: web ScrollView content is immediate but layout needs a few frames
      scrollViewRef.current?.scrollTo({ y: target, animated: false });
      setTimeout(() => { scrollViewRef.current?.scrollTo({ y: target, animated: false }); }, 80);
      setTimeout(() => { scrollViewRef.current?.scrollTo({ y: target, animated: false }); }, 250);
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
        id: c.category_id, name: c.category_name, items: null, totalCount: null, hasMore: false, loadingMore: false,
      })));
      prefetchRef.current = { topRated: prefetchTopRated() };
    } catch (err) {
      console.error('Error loading movies:', err);
    } finally {
      setLoading(false);
    }
  };

  // Loads first page only into state; full result stays in iptvApi cache
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
        const streams = await iptvApi.getVODStreams(catId);
        all = streams || [];
      }
      const firstPage = all.slice(0, SHELF_PAGE);
      setShelves((prev) => prev.map((s) => s.id === catId
        ? { ...s, items: firstPage, totalCount: all.length, hasMore: all.length > SHELF_PAGE }
        : s
      ));
    } catch {
      setShelves((prev) => prev.map((s) => s.id === catId ? { ...s, items: [], totalCount: 0, hasMore: false } : s));
    }
  }, []);

  // Re-calls API (instant cache hit) or uses shuffled ref to append next page
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

  // Fetches all items for the category grid (cache hit after shelf loaded)
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

  // Kick off background fetch of the next page range; results land in cursor.prefetch.
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
      // Roll the buffer forward
      if (result.hasMore) kickoffPrefetch(cursor);
    } finally {
      setTopRatedLoadingMore(false);
    }
  }, [topRatedLoadingMore]);

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
    <ScrollView
      ref={scrollViewRef}
      style={styles.root}
      contentContainerStyle={styles.scroll}
      onScroll={(e) => { scrollYRef.current = e.nativeEvent.contentOffset.y; }}
      scrollEventThrottle={200}
    >
      <View style={styles.discoverSection}>
        <Text style={styles.discoverTitle}>Discover</Text>
        <View style={styles.discoverRow}>
          <TouchableOpacity
            style={styles.discoverPill}
            onPress={() => handleTitlePress('all', 'All Movies')}
            {...({ className: 'lumen-load-cta' })}
          >
            <Text style={styles.discoverIcon}>🎬</Text>
            <Text style={styles.discoverLabel}>All Movies</Text>
            <Text style={styles.discoverArrow}>→</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.discoverPill}
            onPress={() => handleTitlePress('top_rated', 'Top Rated')}
            {...({ className: 'lumen-load-cta' })}
          >
            <Text style={styles.discoverIcon}>⭐</Text>
            <Text style={styles.discoverLabel}>Top Rated</Text>
            <Text style={styles.discoverArrow}>→</Text>
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.pageBody}>
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
              onPlay={handleMoviePress}
              onTitlePress={handleTitlePress}
              onLoadMore={handleLoadMore}
              manual={false}
              savedScrollX={shelfScrollsRef.current[shelf.id] || 0}
              onScrollX={(x) => { shelfScrollsRef.current[shelf.id] = x; }}
            />
          ))
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No movies found</Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f0f23' },
  scroll: { paddingBottom: 80 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f0f23', padding: 24 },
  loadingText: { color: '#aaa', marginTop: 12, fontSize: 14 },

  /* ── Hero ── */
  hero: { width: '100%', height: 480, backgroundColor: '#1a1a2e', overflow: 'hidden', position: 'relative' },
  heroBody: { position: 'absolute', bottom: 140, left: 48, maxWidth: 580, zIndex: 2 },
  heroTagline: {
    color: '#e94560', fontSize: 12, fontWeight: '700',
    letterSpacing: 3, textTransform: 'uppercase', marginBottom: 12,
  },
  heroTitle: {
    color: '#fff', fontSize: 56, fontWeight: '900',
    lineHeight: 62, letterSpacing: -1.5, marginBottom: 14,
  },
  heroMeta: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  heroRating: { color: '#ffd700', fontSize: 13, fontWeight: '600' },
  chip: { borderWidth: 1, borderColor: '#2a2a4e', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  chipText: { color: '#aaa', fontSize: 11 },
  heroDesc: { color: '#ccc', fontSize: 15, lineHeight: 22, marginBottom: 22, maxWidth: 480 },
  heroActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  btnPlay: {
    backgroundColor: '#fff', paddingHorizontal: 26, paddingVertical: 12,
    borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  btnPlayText: { color: '#000', fontSize: 15, fontWeight: '700' },
  btnInfo: {
    backgroundColor: 'rgba(40,40,60,0.70)', paddingHorizontal: 22, paddingVertical: 12,
    borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  btnInfoText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  btnAdd: {
    width: 44, height: 44, borderRadius: 22,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.5)',
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center', alignItems: 'center',
  },
  btnAddText: { color: '#fff', fontSize: 18 },

  /* ── Page body ── */
  pageBody: { paddingTop: 0 },
  catHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 48, paddingVertical: 18,
    borderBottomWidth: 1, borderBottomColor: '#2a2a4e',
  },
  catBackBtn: { paddingVertical: 8, paddingHorizontal: 14, backgroundColor: '#1a1a2e', borderRadius: 8, flexShrink: 0 },
  catBackText: { color: '#e94560', fontSize: 14, fontWeight: '600' },
  catPageTitle: { color: '#fff', fontSize: 22, fontWeight: '700', flexShrink: 0 },
  catCountBadge: { backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, flexShrink: 0 },
  catCount: { color: '#888', fontSize: 12, fontWeight: '600' },
  catGrid: { paddingHorizontal: 48, paddingVertical: 32 },
  catSearchRow: { paddingHorizontal: 48, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1e1e38' },
  catSearch: { flex: 1, backgroundColor: '#1a1a2e', color: '#fff', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, borderWidth: 1, borderColor: '#2a2a4e', minWidth: 0 },
  shelfTitleArrow: { color: '#e94560', fontSize: 18 },

  /* ── Shelf ── */
  shelf: { paddingTop: 28, paddingBottom: 8, overflow: 'visible' },
  shelfLoading: { paddingHorizontal: 48, paddingVertical: 18 },
  // Discover row
  discoverSection: { paddingHorizontal: 48, paddingTop: 24, paddingBottom: 4 },
  discoverTitle: { color: '#fff', fontSize: 22, fontWeight: '700', letterSpacing: -0.3, marginBottom: 12 },
  discoverRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  discoverPill: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 18, paddingVertical: 11,
    backgroundColor: 'rgba(233, 69, 96, 0.08)',
    borderWidth: 1, borderColor: 'rgba(233, 69, 96, 0.28)',
    borderRadius: 999,
  },
  discoverIcon: { fontSize: 16 },
  discoverLabel: { color: '#fff', fontSize: 13, fontWeight: '600', letterSpacing: 0.1 },
  discoverArrow: { color: '#e94560', fontSize: 16, fontWeight: '700', marginLeft: 2 },
  shelfHead: {
    flexDirection: 'row', alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 48, marginBottom: 14,
  },
  shelfTitle: { color: '#fff', fontSize: 22, fontWeight: '700', letterSpacing: -0.3 },
  shelfCount: { color: '#555', fontSize: 13, fontWeight: '500' },
  shelfTrack: { paddingHorizontal: 48, gap: 8 },
  seeMoreCard: {
    width: 200, aspectRatio: 2 / 3, borderRadius: 8,
    backgroundColor: '#16213e', borderWidth: 1, borderColor: '#2a2a4e',
    justifyContent: 'center', alignItems: 'center',
  },
  seeMoreCount: { color: '#e94560', fontSize: 28, fontWeight: '800' },
  seeMoreLabel: { color: '#888', fontSize: 12, marginTop: 4 },

  /* ── Poster card ── */
  posterCard: { width: 200, flexShrink: 0 },
  poster: {
    width: 200,
    aspectRatio: 2 / 3,
    borderRadius: 8,
    backgroundColor: '#16213e',
    overflow: 'hidden',
    position: 'relative',
  },
  posterLabel: {
    color: '#fff', fontSize: 13, fontWeight: '600',
    marginTop: 10, lineHeight: 17,
  },
  posterNoBg: { backgroundColor: '#16213e' },
  hdBadge: {
    position: 'absolute', top: 8, right: 8, zIndex: 4,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2,
  },
  hdText: { color: '#ccc', fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  ratingBadge: {
    position: 'absolute', top: 8, left: 8, zIndex: 4,
    backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 4,
    paddingHorizontal: 5, paddingVertical: 2,
  },
  ratingBadgeText: { color: '#ffd700', fontSize: 9, fontWeight: '700' },
  posterBottom: {
    position: 'absolute', left: 12, right: 12, bottom: 14, zIndex: 4,
  },
  accentBar: { width: 24, height: 2, backgroundColor: '#e94560', borderRadius: 1, marginBottom: 8 },
  posterTitle: {
    color: '#fff', fontSize: 13, fontWeight: '800',
    letterSpacing: 0.4, lineHeight: 16,
  },
  posterMeta: { color: '#aaa', fontSize: 10, marginTop: 5, letterSpacing: 0.3 },

  /* ── Empty ── */
  emptyState: { padding: 60, alignItems: 'center' },
  emptyText: { color: '#666', fontSize: 15 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { color: '#fff', fontSize: 18, fontWeight: '600', marginBottom: 8 },
  emptyHint: { color: '#888', fontSize: 14, textAlign: 'center', marginBottom: 20 },
  addBtn: { backgroundColor: '#e94560', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  addBtnText: { color: '#fff', fontWeight: '600' },
});
