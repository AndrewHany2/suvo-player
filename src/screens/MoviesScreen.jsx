import { useState, useEffect, useCallback, useRef } from 'react';
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
  SectionList,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useApp } from '../context/AppContext';
import iptvApi from '../services/iptvApi';

const SHELF_PAGE = 12;
const GRID_PAGE = 40;

const formatTimeLeft = (cur, dur) => {
  if (!dur || !cur) return null;
  const left = dur - cur;
  if (left <= 60) return null;
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
};

/* ─── Poster Card ─── */
function PosterCard({ item, onPress }) {
  const poster = item.stream_icon || item.cover || item.movie_image || null;
  return (
    <TouchableOpacity style={styles.poster} onPress={() => onPress(item)} activeOpacity={0.8}>
      {poster ? (
        <Image source={{ uri: poster }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
      ) : (
        <View style={[StyleSheet.absoluteFillObject, styles.posterNoBg]} />
      )}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.6)', 'rgba(0,0,0,0.9)']}
        style={[StyleSheet.absoluteFillObject, { justifyContent: 'flex-end' }]}
      />
      <View style={styles.hdBadge}>
        <Text style={styles.hdText}>HD</Text>
      </View>
      <View style={styles.posterBottom}>
        <View style={styles.accentBar} />
        <Text style={styles.posterTitle} numberOfLines={3}>{item.name?.toUpperCase()}</Text>
        {item.rating ? <Text style={styles.posterMeta}>⭐ {item.rating}</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

/* ─── Continue Watching Card ─── */
function CWCard({ item, onPress }) {
  const progress = item.duration > 0 ? Math.min((item.currentTime / item.duration) * 100, 100) : 15;
  const timeLeft = formatTimeLeft(item.currentTime, item.duration);
  const bg = item.cover || item.movie_image || item.stream_icon || null;

  return (
    <TouchableOpacity style={cwStyles.card} onPress={onPress} activeOpacity={0.85}>
      <View style={cwStyles.inner}>
        {bg ? (
          <Image source={{ uri: bg }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
        ) : (
          <View style={[StyleSheet.absoluteFillObject, cwStyles.noBg]} />
        )}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.75)']}
          style={StyleSheet.absoluteFillObject}
        />
        <View style={cwStyles.playOverlay}>
          <Text style={cwStyles.playIcon}>▶</Text>
        </View>
        <View style={cwStyles.bottom}>
          <Text style={cwStyles.title} numberOfLines={1}>{item.name?.toUpperCase()}</Text>
          <View style={cwStyles.bar}>
            <View style={[cwStyles.barFill, { width: `${progress}%` }]} />
          </View>
        </View>
      </View>
      <View style={cwStyles.meta}>
        <Text style={cwStyles.name} numberOfLines={1}>{item.name}</Text>
        {timeLeft && <Text style={cwStyles.timeLeft}>{timeLeft}</Text>}
      </View>
    </TouchableOpacity>
  );
}

const cwStyles = StyleSheet.create({
  card: { width: 260, flexShrink: 0 },
  inner: { width: 260, height: 150, borderRadius: 8, backgroundColor: '#16213e', overflow: 'hidden' },
  noBg: { backgroundColor: '#16213e' },
  playOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center', alignItems: 'center', zIndex: 3,
  },
  playIcon: { color: 'rgba(255,255,255,0.75)', fontSize: 28 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 4, padding: 10 },
  title: { color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 0.3, marginBottom: 6 },
  bar: { height: 3, backgroundColor: 'rgba(255,255,255,0.2)' },
  barFill: { height: '100%', backgroundColor: '#e94560' },
  meta: { paddingTop: 8, paddingHorizontal: 2 },
  name: { color: '#fff', fontSize: 12, fontWeight: '600', marginBottom: 2 },
  timeLeft: { color: '#888', fontSize: 11 },
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
          {shelf.manual ? (
            <TouchableOpacity
              style={styles.loadAllBtn}
              onPress={() => onTitlePress && onTitlePress(shelf.id, shelf.name)}
            >
              <Text style={styles.loadAllBtnText}>Load All</Text>
            </TouchableOpacity>
          ) : (
            <ActivityIndicator size="small" color="#e94560" />
          )}
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.shelfTrack}
          onScroll={(e) => {
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

/* ─── Movie Details Page ─── */
function DetailsPage({ item, info, onBack, onPlay, resumeTime = 0 }) {
  const data = info?.info || {};
  const backdrop = data.backdrop_path?.[0] || data.cover_big || item.stream_icon || item.cover || item.movie_image || null;
  const year = (data.releasedate || data.release_date || '').slice(0, 4);
  const isLoading = info === null;

  return (
    <ScrollView style={detailStyles.root} contentContainerStyle={detailStyles.scroll} showsVerticalScrollIndicator={false}>
      {/* Hero */}
      <View style={detailStyles.hero}>
        {backdrop ? (
          <Image source={{ uri: backdrop }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
        ) : (
          <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#16213e' }]} />
        )}
        <LinearGradient
          colors={['rgba(15,15,35,0.15)', 'rgba(15,15,35,0.65)', '#0f0f23']}
          style={StyleSheet.absoluteFillObject}
        />
        <TouchableOpacity style={detailStyles.backBtn} onPress={onBack}>
          <Text style={detailStyles.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={detailStyles.heroBody}>
          <Text style={detailStyles.title}>{item.name}</Text>
          {isLoading ? (
            <ActivityIndicator color="#e94560" style={{ marginVertical: 12 }} />
          ) : (
            <View style={detailStyles.chips}>
              {year ? <View style={detailStyles.chip}><Text style={detailStyles.chipText}>{year}</Text></View> : null}
              {data.genre ? <View style={detailStyles.chip}><Text style={detailStyles.chipText}>{data.genre.split(',')[0].trim()}</Text></View> : null}
              {data.rating ? <Text style={detailStyles.rating}>⭐ {parseFloat(data.rating).toFixed(1)}</Text> : null}
              {data.age ? <View style={[detailStyles.chip, { borderColor: '#e94560' }]}><Text style={[detailStyles.chipText, { color: '#e94560' }]}>{data.age}</Text></View> : null}
            </View>
          )}
          <View style={detailStyles.actions}>
            {resumeTime > 0 ? (
              <>
                <TouchableOpacity style={detailStyles.playBtn} onPress={() => onPlay(resumeTime)}>
                  <Text style={detailStyles.playBtnText}>▶  Continue</Text>
                </TouchableOpacity>
                <TouchableOpacity style={detailStyles.secondaryBtn} onPress={() => onPlay(0)}>
                  <Text style={detailStyles.secondaryBtnText}>↺  From Start</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity style={detailStyles.playBtn} onPress={() => onPlay(0)}>
                <Text style={detailStyles.playBtnText}>▶  Play Now</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>

      {/* Plot / cast */}
      {(data.description || data.plot || data.overview || data.cast || data.director) ? (
        <View style={detailStyles.meta}>
          {(data.description || data.plot || data.overview) ? (
            <Text style={detailStyles.metaPlot}>{data.description || data.plot || data.overview}</Text>
          ) : null}
          {data.cast ? (
            <Text style={detailStyles.metaRow}><Text style={detailStyles.metaLabel}>Cast  </Text>{data.cast}</Text>
          ) : null}
          {data.director ? (
            <Text style={detailStyles.metaRow}><Text style={detailStyles.metaLabel}>Director  </Text>{data.director}</Text>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

const detailStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f0f23' },
  scroll: { paddingBottom: 80 },
  hero: { width: '100%', height: 420, position: 'relative' },
  backBtn: {
    position: 'absolute', top: 50, left: 16, zIndex: 10,
    paddingVertical: 8, paddingHorizontal: 14,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 8,
  },
  backText: { color: '#e94560', fontSize: 14, fontWeight: '600' },
  heroBody: { position: 'absolute', bottom: 0, left: 16, right: 16, zIndex: 5, paddingBottom: 24 },
  title: { color: '#fff', fontSize: 28, fontWeight: '900', letterSpacing: -0.5, marginBottom: 10 },
  chips: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' },
  chip: { borderWidth: 1, borderColor: '#3a3a5e', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { color: '#aaa', fontSize: 12 },
  rating: { color: '#ffd700', fontSize: 13, fontWeight: '600' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  playBtn: { backgroundColor: '#fff', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  playBtnText: { color: '#000', fontSize: 15, fontWeight: '700' },
  secondaryBtn: {
    backgroundColor: 'rgba(40,40,60,0.85)', paddingHorizontal: 20, paddingVertical: 12,
    borderRadius: 8, borderWidth: 1, borderColor: '#3a3a5e',
  },
  secondaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  meta: { paddingHorizontal: 16, paddingTop: 20, gap: 10 },
  metaPlot: { color: '#ccc', fontSize: 14, lineHeight: 22, marginBottom: 10 },
  metaRow: { color: '#aaa', fontSize: 13, lineHeight: 20 },
  metaLabel: { color: '#fff', fontWeight: '700' },
});

/* ─── Category Page ─── */
function CategoryPage({ name, items, onBack, onPlay }) {
  const [displayCount, setDisplayCount] = useState(GRID_PAGE);
  const [search, setSearch] = useState('');

  const filtered = items
    ? (search.trim() ? items.filter((i) => i.name?.toLowerCase().includes(search.toLowerCase())) : items)
    : null;
  const displayed = filtered ? filtered.slice(0, displayCount) : null;
  const hasMore = filtered && displayCount < filtered.length;

  useEffect(() => { setDisplayCount(GRID_PAGE); }, [search]);

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
          data={displayed}
          keyExtractor={(item) => String(item.stream_id)}
          numColumns={3}
          contentContainerStyle={styles.catGrid}
          renderItem={({ item }) => <PosterCard item={item} onPress={onPlay} />}
          onEndReached={() => {
            if (hasMore) setDisplayCount((c) => Math.min(c + GRID_PAGE, filtered.length));
          }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            hasMore ? (
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
  const { users, activeUserId, playVideo, watchHistory } = useApp();

  const [loading, setLoading] = useState(false);
  const [shelves, setShelves] = useState([]);
  const [currentCategory, setCurrentCategory] = useState(null);
  const [categoryItems, setCategoryItems] = useState(null);
  const [currentMovieDetail, setCurrentMovieDetail] = useState(null);
  const loadedRef = useRef(new Set());
  const allShuffledRef = useRef([]);

  useEffect(() => { if (activeUserId) load(); }, [activeUserId]);

  const load = async () => {
    const user = users.find((u) => u.id === activeUserId);
    if (!user) return;
    setLoading(true);
    loadedRef.current.clear();
    setShelves([]);
    try {
      iptvApi.setCredentials(user.host, user.username, user.password);
      const cats = await iptvApi.getVODCategories();
      if (!cats?.length) { setLoading(false); return; }
      setShelves([
        { id: 'all', name: 'All', items: null, totalCount: null, hasMore: false, loadingMore: false, manual: true },
        ...cats.map((c) => ({ id: c.category_id, name: c.category_name, items: null, totalCount: null, hasMore: false, loadingMore: false, manual: false })),
      ]);
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
        const streams = await iptvApi.getAllVODStreams();
        all = [...(streams || [])].sort(() => Math.random() - 0.5);
        allShuffledRef.current = all;
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
      const all = catId === 'all' ? allShuffledRef.current : await iptvApi.getVODStreams(catId);
      setShelves((prev) => prev.map((s) => {
        if (s.id !== catId) return s;
        const nextItems = (all || []).slice(0, (s.items?.length || 0) + SHELF_PAGE);
        return { ...s, items: nextItems, hasMore: nextItems.length < (all?.length || 0), loadingMore: false };
      }));
    } catch {
      setShelves((prev) => prev.map((s) => s.id === catId ? { ...s, loadingMore: false } : s));
    }
  }, []);

  const handleMoviePress = async (item) => {
    setCurrentMovieDetail({ item, info: null });
    try {
      const info = await iptvApi.getVODInfo(item.stream_id);
      setCurrentMovieDetail({ item, info });
    } catch {
      setCurrentMovieDetail({ item, info: {} });
    }
  };

  const handlePlay = (item, startTime = 0) => {
    const url = iptvApi.buildStreamUrl('movie', item.stream_id, item.container_extension || 'mp4');
    playVideo({ type: 'movies', streamId: item.stream_id, name: item.name, url, cover: item.stream_icon || item.cover || item.movie_image, startTime });
    navigation.navigate('VideoPlayer');
  };

  const handleTitlePress = async (catId, name) => {
    setCurrentCategory({ catId, name });
    setCategoryItems(null);
    try {
      let all;
      if (catId === 'all') {
        if (!allShuffledRef.current.length) {
          const streams = await iptvApi.getAllVODStreams();
          allShuffledRef.current = [...(streams || [])].sort(() => Math.random() - 0.5);
        }
        all = allShuffledRef.current;
      } else {
        all = await iptvApi.getVODStreams(catId);
        if (!loadedRef.current.has(catId)) handleShelfVisible(catId);
      }
      setCategoryItems(all || []);
    } catch {
      setCategoryItems([]);
    }
  };

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

  if (currentMovieDetail) {
    return (
      <DetailsPage
        item={currentMovieDetail.item}
        info={currentMovieDetail.info}
        resumeTime={currentMovieDetail.resumeTime || 0}
        onBack={() => setCurrentMovieDetail(null)}
        onPlay={(startTime) => {
          handlePlay(currentMovieDetail.item, startTime);
          setCurrentMovieDetail(null);
        }}
      />
    );
  }

  if (currentCategory) {
    return (
      <CategoryPage
        name={currentCategory.name}
        items={categoryItems}
        onBack={() => { setCurrentCategory(null); setCategoryItems(null); }}
        onPlay={handleMoviePress}
      />
    );
  }

  /* ── Continue watching ── */
  const continueWatching = watchHistory.filter((item) =>
    item.type === 'movies' && item.currentTime > 0 &&
    (item.duration <= 0 || item.currentTime / item.duration < 0.95)
  );

  const handleCWPress = async (cwItem) => {
    const item = { stream_id: cwItem.streamId, name: cwItem.name, stream_icon: cwItem.cover, cover: cwItem.cover, movie_image: cwItem.cover };
    setCurrentMovieDetail({ item, info: null, resumeTime: cwItem.currentTime || 0 });
    try {
      const info = await iptvApi.getVODInfo(cwItem.streamId);
      setCurrentMovieDetail({ item, info, resumeTime: cwItem.currentTime || 0 });
    } catch {
      setCurrentMovieDetail({ item, info: {}, resumeTime: cwItem.currentTime || 0 });
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      {/* Continue Watching */}
      {continueWatching.length > 0 && (
        <View style={styles.cwSection}>
          <View style={styles.cwHeader}>
            <Text style={styles.cwSectionTitle}>Continue Watching</Text>
            <TouchableOpacity onPress={() => navigation.navigate('mylist')}>
              <Text style={styles.seeHistory}>See history ›</Text>
            </TouchableOpacity>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cwTrack}>
            {continueWatching.map((item) => (
              <CWCard key={item.id} item={item} onPress={() => handleCWPress(item)} />
            ))}
          </ScrollView>
        </View>
      )}

      {/* Category shelves */}
      <View style={styles.pageBody}>
        {shelves.length > 0 ? (
          shelves.map((shelf) => (
            <Shelf
              key={shelf.id}
              shelf={shelf}
              onVisible={handleShelfVisible}
              onPress={handleMoviePress}
              onTitlePress={handleTitlePress}
              onLoadMore={handleLoadMore}
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

  /* ── Continue Watching ── */
  cwSection: { paddingTop: 20, paddingBottom: 8 },
  cwHeader: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
    paddingHorizontal: 16, marginBottom: 14,
  },
  cwSectionTitle: { color: '#fff', fontSize: 20, fontWeight: '700', letterSpacing: -0.3 },
  seeHistory: { color: '#888', fontSize: 13 },
  cwTrack: { paddingHorizontal: 16, gap: 12 },

  /* ── Page body ── */
  pageBody: { paddingTop: 8 },

  /* ── Shelf ── */
  shelf: { paddingTop: 20, paddingBottom: 8 },
  shelfLoading: { paddingHorizontal: 16, paddingVertical: 18 },
  loadAllBtn: { alignSelf: 'flex-start', backgroundColor: '#e94560', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, marginLeft: 16 },
  loadAllBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
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
  poster: {
    width: 130, aspectRatio: 2 / 3,
    borderRadius: 8, backgroundColor: '#16213e',
    overflow: 'hidden', flexShrink: 0,
  },
  posterNoBg: { backgroundColor: '#16213e' },
  hdBadge: {
    position: 'absolute', top: 8, right: 8, zIndex: 4,
    backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 4,
    paddingHorizontal: 5, paddingVertical: 2,
  },
  hdText: { color: '#ccc', fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
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
