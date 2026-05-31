import { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Image, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useApp } from '../context/AppContext';
import MovieDetail from '../components/MovieDetail';
import SeriesDetail from '../components/SeriesDetail';

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

/* ── My List Poster Card (portrait 2:3) ── */
function MyListCard({ item, onPress, onRemove }) {
  const poster = item.cover || item.movie_image || item.stream_icon || null;
  const epLabel = getEpLabel(item);

  return (
    <TouchableOpacity style={styles.posterCard} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.poster}>
        {poster ? (
          <Image source={{ uri: poster }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
        ) : (
          <View style={[StyleSheet.absoluteFillObject, styles.posterNoBg]} />
        )}
        <View style={styles.hdBadge}>
          <Text style={styles.hdText}>HD</Text>
        </View>
        <TouchableOpacity
          style={styles.removeBtn}
          onPress={onRemove}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Text style={styles.removeBtnText}>✕</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.posterLabel} numberOfLines={2}>{item.name}</Text>
      {epLabel && <Text style={styles.posterMeta}>{epLabel}</Text>}
    </TouchableOpacity>
  );
}

/* ── Watch History Card (landscape ~16:9) ── */
function CWCard({ item, onPress, onRemove }) {
  const progress = item.duration > 0 ? Math.min((item.currentTime / item.duration) * 100, 100) : 15;
  const timeLeft = formatTimeLeft(item.currentTime, item.duration);
  const epLabel = getEpLabel(item);
  const seasonBadge = item.seasonNum ? `S${item.seasonNum}` : null;
  const bg = item.cover || item.movie_image || item.stream_icon || null;
  const showTitle = item.seriesName || item.name;
  const epTitle = item.seriesName && item.name !== item.seriesName ? item.name : null;

  return (
    <TouchableOpacity style={styles.cwCard} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.cwInner}>
        {bg ? (
          <Image source={{ uri: bg }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
        ) : (
          <View style={[StyleSheet.absoluteFillObject, styles.cwNoBg]} />
        )}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.75)']}
          style={StyleSheet.absoluteFillObject}
        />
        {seasonBadge && (
          <View style={styles.cwSeason}>
            <Text style={styles.cwSeasonText}>{seasonBadge}</Text>
          </View>
        )}
        <TouchableOpacity
          style={styles.removeBtn}
          onPress={onRemove}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Text style={styles.removeBtnText}>✕</Text>
        </TouchableOpacity>
        <View style={styles.cwPlayOverlay}>
          <Text style={styles.cwPlayIcon}>▶</Text>
        </View>
        <View style={styles.cwBottom}>
          <View style={styles.cwBar}>
            <View style={[styles.cwBarFill, { width: `${progress}%` }]} />
          </View>
        </View>
      </View>
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

/* ── Screen ── */
export default function HistoryScreen({ navigation }) {
  const { watchHistory, removeFromWatchHistory, playVideo, myList, removeFromMyList } = useApp();
  const [currentDetail, setCurrentDetail] = useState(null);

  const openDetail = (item) => {
    if (item.type === 'live') {
      playVideo({ ...item, startTime: 0 });
      navigation.navigate('VideoPlayer');
      return;
    }
    setCurrentDetail(item);
  };

  const closeDetail = () => setCurrentDetail(null);
  const handlePlay = (videoObj) => {
    playVideo(videoObj);
    navigation.navigate('VideoPlayer');
    setCurrentDetail(null);
  };

  const confirmRemove = (item) => {
    Alert.alert('Remove from History', `Remove "${item.name}" from history?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeFromWatchHistory(item.id) },
    ]);
  };

  if (currentDetail?.type === 'movies') {
    return <MovieDetail item={currentDetail} onBack={closeDetail} onPlay={handlePlay} />;
  }

  if (currentDetail?.type === 'series') {
    return <SeriesDetail item={currentDetail} onBack={closeDetail} onPlayEpisode={handlePlay} />;
  }

  const watchedHistory = watchHistory.filter((item) => item.type !== 'live');

  if (myList.length === 0 && watchedHistory.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyIcon}>🎬</Text>
        <Text style={styles.emptyTitle}>Your list is empty</Text>
        <Text style={styles.emptyHint}>Open a movie and tap ♡ Favorites to save it here</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      {/* Favorites */}
      {myList.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Favorites</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.shelfTrack}
          >
            {myList.map((item) => (
              <MyListCard
                key={item.id}
                item={item}
                onPress={() => openDetail(item)}
                onRemove={() => removeFromMyList(item.id)}
              />
            ))}
          </ScrollView>
        </View>
      )}

      {/* Watch History */}
      {watchedHistory.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Watch History</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.shelfTrack}
          >
            {watchedHistory.map((item) => (
              <CWCard
                key={item.id}
                item={item}
                onPress={() => openDetail(item)}
                onRemove={() => confirmRemove(item)}
              />
            ))}
          </ScrollView>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f0f23' },
  scroll: { paddingTop: 24, paddingBottom: 80 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f0f23', padding: 24 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 8 },
  emptyHint: { color: '#888', fontSize: 14, textAlign: 'center' },

  section: { paddingBottom: 40 },
  sectionTitle: {
    color: '#fff', fontSize: 22, fontWeight: '700', letterSpacing: -0.3,
    paddingHorizontal: 16, marginBottom: 16,
  },
  shelfTrack: { paddingHorizontal: 16, gap: 12 },

  /* ── My List poster (portrait 2:3) ── */
  posterCard: { width: 130, flexShrink: 0 },
  poster: {
    width: 130, aspectRatio: 2 / 3,
    borderRadius: 8, backgroundColor: '#16213e', overflow: 'hidden',
  },
  posterLabel: { color: '#fff', fontSize: 12, fontWeight: '600', marginTop: 8, lineHeight: 16 },
  posterNoBg: { backgroundColor: '#16213e' },
  hdBadge: {
    position: 'absolute', top: 8, right: 8, zIndex: 4,
    backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 4,
    paddingHorizontal: 5, paddingVertical: 2,
  },
  hdText: { color: '#ccc', fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  removeBtn: {
    position: 'absolute', top: 8, left: 8, zIndex: 5,
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 12,
    width: 22, height: 22, justifyContent: 'center', alignItems: 'center',
  },
  removeBtnText: { color: '#fff', fontSize: 9, fontWeight: '700' },
  posterMeta: { color: '#aaa', fontSize: 9, marginTop: 4, letterSpacing: 0.3 },

  /* ── Watch History card (landscape ~16:9) ── */
  cwCard: { width: 260, flexShrink: 0 },
  cwInner: {
    width: 260, height: 148,
    borderRadius: 8, backgroundColor: '#16213e', overflow: 'hidden',
  },
  cwNoBg: { backgroundColor: '#16213e' },
  cwSeason: { position: 'absolute', top: 10, left: 12, zIndex: 4 },
  cwSeasonText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  cwPlayOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center', alignItems: 'center', zIndex: 3,
  },
  cwPlayIcon: { color: 'rgba(255,255,255,0.75)', fontSize: 28 },
  cwBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 4, padding: 10 },
  cwBar: { height: 3, backgroundColor: 'rgba(255,255,255,0.18)' },
  cwBarFill: { height: '100%', backgroundColor: '#e94560' },
  cwMeta: { paddingTop: 8, paddingHorizontal: 2 },
  cwShowName: { color: '#fff', fontSize: 12, fontWeight: '600', marginBottom: 2 },
  cwEpLine: { color: '#888', fontSize: 11, marginBottom: 2 },
  cwTimeLeft: { color: '#888', fontSize: 11 },
});
