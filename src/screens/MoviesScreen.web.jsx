import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, Image,
} from 'react-native';
import { useApp } from '../context/AppContext';
import iptvApi from '../services/iptvApi';

/* ─── Poster Card ─── */
function PosterCard({ item, onPress }) {
  const poster = item.stream_icon || item.cover || item.movie_image || null;
  return (
    <TouchableOpacity
      style={styles.poster}
      onPress={() => onPress(item)}
      {...({ className: 'lumen-poster' })}
    >
      {poster ? (
        <Image source={{ uri: poster }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
      ) : (
        <View style={[StyleSheet.absoluteFillObject, styles.posterNoBg]} />
      )}

      {/* Gradient overlay — bottom to top */}
      <View
        style={[StyleSheet.absoluteFillObject]}
        {...({ className: 'lumen-poster-gradient' })}
      />

      {/* HD badge */}
      <View style={styles.hdBadge}>
        <Text style={styles.hdText}>HD</Text>
      </View>

      {/* Title block — always visible */}
      <View style={styles.posterBottom}>
        <View style={styles.accentBar} />
        <Text style={styles.posterTitle} numberOfLines={3}>{item.name?.toUpperCase()}</Text>
        {item.rating ? (
          <Text style={styles.posterMeta}>⭐ {item.rating}</Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

/* ─── Hero Banner ─── */
function Hero({ item, onPlay }) {
  if (!item) return null;
  const bg = item.movie_image || item.cover || item.stream_icon || null;
  const desc = item.plot || item.description || null;
  return (
    <View style={styles.hero} {...({ className: 'lumen-hero' })}>
      {bg && <Image source={{ uri: bg }} style={[StyleSheet.absoluteFillObject, { objectFit: 'cover', objectPosition: 'center top' }]} resizeMode="cover" />}
      <View style={StyleSheet.absoluteFillObject} {...({ className: 'lumen-hero-overlay' })} />

      <View style={styles.heroBody}>
        <Text style={styles.heroTagline}>MOVIES</Text>
        <Text style={styles.heroTitle} numberOfLines={2}>{item.name}</Text>

        <View style={styles.heroMeta}>
          {item.rating ? <Text style={styles.heroRating}>⭐ {item.rating}</Text> : null}
          {item.year ? <View style={styles.chip}><Text style={styles.chipText}>{item.year}</Text></View> : null}
          {item.rating_5based ? <View style={styles.chip}><Text style={styles.chipText}>{Number(item.rating_5based).toFixed(1)} / 5</Text></View> : null}
        </View>

        {desc ? <Text style={styles.heroDesc} numberOfLines={3}>{desc}</Text> : null}

        <View style={styles.heroActions}>
          <TouchableOpacity style={styles.btnPlay} onPress={() => onPlay(item)} {...({ className: 'lumen-btn-play' })}>
            <Text style={styles.btnPlayText}>▶  Play</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnInfo} {...({ className: 'lumen-btn-info' })}>
            <Text style={styles.btnInfoText}>ⓘ  More Info</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnAdd} {...({ className: 'lumen-btn-add' })}>
            <Text style={styles.btnAddText}>+</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const SHELF_PAGE = typeof window !== 'undefined' ? Math.ceil(window.innerWidth / 200) + 2 : 10;

/* ─── Shelf — lazy-loads when visible, renders more as user scrolls right ─── */
function Shelf({ catId, title, items, onVisible, onPlay, onTitlePress }) {
  const sentinelRef = useRef(null);
  const railRef = useRef(null);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartLeft = useRef(0);
  const hasDragged = useRef(false);
  const [displayCount, setDisplayCount] = useState(SHELF_PAGE);

  useEffect(() => { setDisplayCount(SHELF_PAGE); }, [catId]);

  useEffect(() => {
    if (items !== null) return;
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') { onVisible(catId); return; }
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { obs.disconnect(); onVisible(catId); } },
      { rootMargin: '300px 0px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [catId, items, onVisible]);

  if (items !== null && !items?.length) return null;

  const displayed = items ? items.slice(0, displayCount) : null;

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
  }, [displayed !== null]); // re-runs when rail mounts after data loads

  const scrollBy = (delta) => {
    const el = railRef.current;
    if (el) el.scrollLeft = Math.max(0, el.scrollLeft + delta);
  };

  const handleScroll = (e) => {
    if (!items || displayCount >= items.length) return;
    const { scrollLeft, scrollWidth, clientWidth } = e.target;
    if (scrollWidth - scrollLeft - clientWidth < 500) {
      setDisplayCount((c) => Math.min(c + SHELF_PAGE, items.length));
    }
  };

  return (
    <View style={styles.shelf}>
      <div ref={sentinelRef} style={{ height: 0 }} />
      <View style={styles.shelfHead}>
        <TouchableOpacity onPress={() => onTitlePress && onTitlePress(catId, title)} {...({ className: 'lumen-shelf-title-btn' })}>
          <Text style={styles.shelfTitle}>{title} <Text style={styles.shelfTitleArrow}>›</Text></Text>
        </TouchableOpacity>
        {items && <Text style={styles.shelfCount}>{items.length}</Text>}
      </View>
      {displayed === null ? (
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
            {displayed.map((item) => (
              <PosterCard key={String(item.stream_id)} item={item} onPress={onPlay} />
            ))}
          </div>
          <button className="lumen-shelf-nav right" onClick={() => scrollBy(800)}>›</button>
        </div>
      )}
    </View>
  );
}

/* ─── Category Page ─── */
function CategoryPage({ name, items, onBack, onPlay }) {
  return (
    <View style={styles.root}>
      <View style={styles.catHeader}>
        <TouchableOpacity style={styles.catBackBtn} onPress={onBack}>
          <Text style={styles.catBackText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.catPageTitle}>{name}</Text>
        {items && <Text style={styles.catCount}>{items.length} titles</Text>}
      </View>
      {!items ? (
        <View style={styles.center}><ActivityIndicator size="large" color="#e94560" /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.catGrid}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 200px)', gap: 12, justifyContent: 'center' }}>
            {items.map((item) => (
              <PosterCard key={String(item.stream_id)} item={item} onPress={onPlay} />
            ))}
          </div>
        </ScrollView>
      )}
    </View>
  );
}

/* ─── Screen ─── */
export default function MoviesScreen({ navigation }) {
  const { users, activeUserId, playVideo } = useApp();

  const [loading, setLoading] = useState(false);
  const [shelves, setShelves] = useState([]);
  const [heroItem, setHeroItem] = useState(null);
  const [currentCategory, setCurrentCategory] = useState(null);
  const loadedRef = useRef(new Set());

  useEffect(() => { if (activeUserId) load(); }, [activeUserId]);

  const load = async () => {
    const user = users.find((u) => u.id === activeUserId);
    if (!user) return;
    setLoading(true);
    loadedRef.current.clear();
    setShelves([]);
    setHeroItem(null);
    try {
      iptvApi.setCredentials(user.host, user.username, user.password);
      const cats = await iptvApi.getVODCategories();
      if (!cats?.length) { setLoading(false); return; }
      setShelves(cats.map((c) => ({ id: c.category_id, name: c.category_name, items: null })));
    } catch (err) {
      console.error('Error loading movies:', err);
    } finally {
      setLoading(false);
    }
  };

  // Called by each Shelf when it enters the viewport
  const handleShelfVisible = useCallback(async (catId) => {
    if (loadedRef.current.has(catId)) return;
    loadedRef.current.add(catId);
    try {
      const streams = await iptvApi.getVODStreams(catId);
      setShelves((prev) => prev.map((s) => s.id === catId ? { ...s, items: streams || [] } : s));
      setHeroItem((prev) => prev || (streams || []).find((m) => m.movie_image || m.cover || m.stream_icon) || null);
    } catch {
      setShelves((prev) => prev.map((s) => s.id === catId ? { ...s, items: [] } : s));
    }
  }, []);

  const handlePlay = (item) => {
    const url = iptvApi.buildStreamUrl('movie', item.stream_id, item.container_extension || 'mp4');
    playVideo({ type: 'movies', streamId: item.stream_id, name: item.name, url });
    navigation.navigate('VideoPlayer');
  };

  const handleTitlePress = (catId, name) => {
    handleShelfVisible(catId);
    setCurrentCategory({ catId, name });
  };


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

  if (currentCategory) {
    const shelf = shelves.find((s) => s.id === currentCategory.catId);
    return (
      <CategoryPage
        name={currentCategory.name}
        items={shelf?.items ?? null}
        onBack={() => setCurrentCategory(null)}
        onPlay={handlePlay}
      />
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scroll}>
      <Hero item={heroItem} onPlay={handlePlay} />
      <View style={styles.pageBody}>
        {shelves.length > 0 ? (
          shelves.map((shelf) => (
            <Shelf key={shelf.id} catId={shelf.id} title={shelf.name} items={shelf.items} onVisible={handleShelfVisible} onPlay={handlePlay} onTitlePress={handleTitlePress} />
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
  pageBody: { paddingTop: 20 },
  catHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 16,
    paddingHorizontal: 48, paddingVertical: 20,
    borderBottomWidth: 1, borderBottomColor: '#2a2a4e',
  },
  catBackBtn: { paddingVertical: 8, paddingHorizontal: 14, backgroundColor: '#1a1a2e', borderRadius: 8 },
  catBackText: { color: '#e94560', fontSize: 14, fontWeight: '600' },
  catPageTitle: { color: '#fff', fontSize: 22, fontWeight: '700', flex: 1 },
  catCount: { color: '#555', fontSize: 13 },
  catGrid: { paddingHorizontal: 48, paddingVertical: 32 },
  shelfTitleArrow: { color: '#e94560', fontSize: 18 },

  /* ── Shelf ── */
  shelf: { paddingTop: 28, paddingBottom: 8, overflow: 'visible' },
  shelfLoading: { paddingHorizontal: 48, paddingVertical: 18 },
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
  poster: {
    width: 200,
    aspectRatio: 2 / 3,
    borderRadius: 8,
    backgroundColor: '#16213e',
    overflow: 'hidden',
    flexShrink: 0,
  },
  posterNoBg: { backgroundColor: '#16213e' },
  hdBadge: {
    position: 'absolute', top: 8, right: 8, zIndex: 4,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2,
  },
  hdText: { color: '#ccc', fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
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
