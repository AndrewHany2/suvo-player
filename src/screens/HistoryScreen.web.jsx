import { useRef, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Image,
} from 'react-native';
import { useApp } from '../context/AppContext';

function useDragScroll() {
  const railRef = useRef(null);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartLeft = useRef(0);
  const hasDragged = useRef(false);

  const attachRef = useCallback((el) => {
    railRef.current = el;
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
    el._cleanup = () => {
      el.removeEventListener('mousedown', onMouseDown);
      el.removeEventListener('click', onClickCapture, true);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  useEffect(() => () => railRef.current?._cleanup?.(), []);

  const scrollBy = (delta) => {
    const el = railRef.current;
    if (el) el.scrollLeft = Math.max(0, el.scrollLeft + delta);
  };

  return { railRef: attachRef, scrollBy };
}

const formatTimeLeft = (currentTime, duration) => {
  if (!duration || !currentTime) return null;
  const left = duration - currentTime;
  if (left <= 60) return null;
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
};

const getEpLabel = (item) => {
  if (item.type === 'series' && item.seasonNum && item.episodeNum) {
    return `S${item.seasonNum} · E${String(item.episodeNum).padStart(2, '0')}`;
  }
  return null;
};

/* ── Continue Watching Card (landscape) ── */
function CWCard({ item, onPress }) {
  const progress = item.duration > 0 ? Math.min((item.currentTime / item.duration) * 100, 100) : 15;
  const timeLeft = formatTimeLeft(item.currentTime, item.duration);
  const epLabel = getEpLabel(item);
  const seasonBadge = item.seasonNum ? `S${item.seasonNum}` : null;
  const bg = item.cover || item.movie_image || item.stream_icon || null;
  const showTitle = item.seriesName || item.name;
  const epTitle = item.seriesName && item.name !== item.seriesName ? item.name : null;

  return (
    <TouchableOpacity style={styles.cwCard} onPress={onPress} {...({ className: 'lumen-cw-card' })}>
      {/* Landscape image box */}
      <View style={styles.cwInner}>
        {bg ? (
          <Image source={{ uri: bg }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
        ) : (
          <View style={[StyleSheet.absoluteFillObject, styles.cwNoBg]} />
        )}
        {/* Bottom-left gradient */}
        <View style={[StyleSheet.absoluteFillObject, { background: 'linear-gradient(to top right, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.1) 60%, rgba(0,0,0,0) 100%)' }]} />

        {seasonBadge && (
          <View style={styles.cwSeason}>
            <Text style={styles.cwSeasonText}>{seasonBadge}</Text>
          </View>
        )}

        {/* Play icon overlay — shown on hover via CSS */}
        <div className="lumen-cw-play">▶</div>

        <View style={styles.cwBottom}>
          <Text style={styles.cwTitle} numberOfLines={1}>{showTitle?.toUpperCase()}</Text>
          <View style={styles.cwBar}>
            <View style={[styles.cwBarFill, { width: `${progress}%` }]} />
          </View>
        </View>
      </View>

      {/* Info below card */}
      <View style={styles.cwMeta}>
        <Text style={styles.cwShowName} numberOfLines={1}>{showTitle}</Text>
        {(epLabel || epTitle) && (
          <Text style={styles.cwEpLine} numberOfLines={1}>
            {[epLabel, epTitle].filter(Boolean).join(' · ')}
          </Text>
        )}
        {timeLeft && <Text style={styles.cwTimeLeft}>{timeLeft}</Text>}
      </View>
    </TouchableOpacity>
  );
}

/* ── My List Poster Card (portrait) ── */
function MyListCard({ item, onPress, onRemove }) {
  const poster = item.cover || item.movie_image || item.stream_icon || null;
  const epLabel = getEpLabel(item);

  return (
    <TouchableOpacity style={styles.poster} onPress={onPress} {...({ className: 'lumen-poster' })}>
      {poster ? (
        <Image source={{ uri: poster }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
      ) : (
        <View style={[StyleSheet.absoluteFillObject, styles.posterNoBg]} />
      )}
      <View style={StyleSheet.absoluteFillObject} {...({ className: 'lumen-poster-gradient' })} />

      <View style={styles.hdBadge}><Text style={styles.hdText}>HD</Text></View>

      <TouchableOpacity
        style={styles.removeBtn}
        onPress={(e) => { e?.stopPropagation?.(); onRemove(); }}
      >
        <Text style={styles.removeBtnText}>✕</Text>
      </TouchableOpacity>

      <View style={styles.posterBottom}>
        <View style={styles.accentBar} />
        <Text style={styles.posterTitle} numberOfLines={3}>{item.name?.toUpperCase()}</Text>
        {epLabel && <Text style={styles.posterMeta}>{epLabel}</Text>}
      </View>
    </TouchableOpacity>
  );
}

export default function HistoryScreen({ navigation }) {
  const { watchHistory, removeFromWatchHistory, playVideo } = useApp();
  const myList$ = useDragScroll();
  const cw$ = useDragScroll();

  const handlePlay = (item) => {
    playVideo({ ...item, startTime: item.currentTime || 0 });
    navigation.navigate('VideoPlayer');
  };

  const myList = watchHistory.filter((item) => item.type !== 'live');
  const continueWatching = watchHistory.filter((item) => {
    if (item.type === 'live' || !item.currentTime || item.currentTime <= 0) return false;
    if (item.duration > 0) return item.currentTime / item.duration < 0.95;
    return true;
  });

  if (watchHistory.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyIcon}>🎬</Text>
        <Text style={styles.emptyTitle}>Your list is empty</Text>
        <Text style={styles.emptyHint}>Start watching to build your list</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scroll}>

      {/* My List */}
      {myList.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>My List</Text>
          <div style={{ position: 'relative' }} className="lumen-shelf-rail">
            <button className="lumen-shelf-nav" onClick={() => myList$.scrollBy(-800)}>‹</button>
            <div
              ref={myList$.railRef}
              style={{ display: 'flex', overflowX: 'auto', gap: 12, paddingLeft: 48, paddingRight: 48, scrollbarWidth: 'none', msOverflowStyle: 'none', cursor: 'grab' }}
            >
              {myList.map((item) => (
                <MyListCard
                  key={item.id}
                  item={item}
                  onPress={() => handlePlay(item)}
                  onRemove={() => removeFromWatchHistory(item.id)}
                />
              ))}
            </div>
            <button className="lumen-shelf-nav right" onClick={() => myList$.scrollBy(800)}>›</button>
          </div>
        </View>
      )}

      {/* Continue Watching */}
      {continueWatching.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitleInRow}>Continue Watching</Text>
            <TouchableOpacity onPress={() => {}}>
              <Text style={styles.seeAll}>See history ›</Text>
            </TouchableOpacity>
          </View>
          <div style={{ position: 'relative' }} className="lumen-shelf-rail">
            <button className="lumen-shelf-nav" onClick={() => cw$.scrollBy(-800)}>‹</button>
            <div
              ref={cw$.railRef}
              style={{ display: 'flex', overflowX: 'auto', gap: 12, paddingLeft: 48, paddingRight: 48, scrollbarWidth: 'none', msOverflowStyle: 'none', cursor: 'grab' }}
            >
              {continueWatching.map((item) => (
                <CWCard key={item.id} item={item} onPress={() => handlePlay(item)} />
              ))}
            </div>
            <button className="lumen-shelf-nav right" onClick={() => cw$.scrollBy(800)}>›</button>
          </div>
        </View>
      )}

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f0f23' },
  scroll: { paddingTop: 40, paddingBottom: 80 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f0f23', padding: 24 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 8 },
  emptyHint: { color: '#888', fontSize: 14, textAlign: 'center' },

  section: { paddingBottom: 48 },
  sectionRow: {
    flexDirection: 'row', alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 48, marginBottom: 20,
  },
  sectionTitle: {
    color: '#fff', fontSize: 26, fontWeight: '700', letterSpacing: -0.5,
    paddingHorizontal: 48, marginBottom: 20,
  },
  sectionTitleInRow: {
    color: '#fff', fontSize: 26, fontWeight: '700', letterSpacing: -0.5,
  },
  seeAll: { color: '#888', fontSize: 13 },
  shelfTrack: { paddingHorizontal: 48, gap: 12 },

  /* ── My List poster (portrait 2:3) ── */
  poster: {
    width: 200, aspectRatio: 2 / 3,
    borderRadius: 8, backgroundColor: '#16213e', overflow: 'hidden', flexShrink: 0,
  },
  posterNoBg: { backgroundColor: '#16213e' },
  hdBadge: {
    position: 'absolute', top: 8, right: 8, zIndex: 4,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2,
  },
  hdText: { color: '#ccc', fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  removeBtn: {
    position: 'absolute', top: 8, left: 8, zIndex: 5,
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 12,
    width: 22, height: 22, justifyContent: 'center', alignItems: 'center',
  },
  removeBtnText: { color: '#fff', fontSize: 9, fontWeight: '700' },
  posterBottom: { position: 'absolute', left: 12, right: 12, bottom: 14, zIndex: 4 },
  accentBar: { width: 24, height: 2, backgroundColor: '#e94560', borderRadius: 1, marginBottom: 8 },
  posterTitle: { color: '#fff', fontSize: 13, fontWeight: '800', letterSpacing: 0.4, lineHeight: 16 },
  posterMeta: { color: '#aaa', fontSize: 10, marginTop: 5, letterSpacing: 0.3 },

  /* ── Continue Watching card (landscape 16:9) ── */
  cwCard: { width: 320, flexShrink: 0 },
  cwInner: {
    width: 320, height: 180,
    borderRadius: 8, backgroundColor: '#16213e', overflow: 'hidden',
  },
  cwNoBg: { backgroundColor: '#16213e' },
  cwSeason: { position: 'absolute', top: 10, left: 12, zIndex: 4 },
  cwSeasonText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  cwBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 4, paddingHorizontal: 12 },
  cwTitle: { color: '#fff', fontSize: 13, fontWeight: '800', letterSpacing: 0.3, marginBottom: 6 },
  cwBar: { height: 3, backgroundColor: 'rgba(255,255,255,0.18)' },
  cwBarFill: { height: '100%', backgroundColor: '#e94560' },
  cwMeta: { paddingTop: 10, paddingHorizontal: 2 },
  cwShowName: { color: '#fff', fontSize: 13, fontWeight: '600', marginBottom: 2 },
  cwEpLine: { color: '#888', fontSize: 12, marginBottom: 2 },
  cwTimeLeft: { color: '#888', fontSize: 12 },
});
