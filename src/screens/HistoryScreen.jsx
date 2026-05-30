import { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Image, Alert,
  ActivityIndicator, SectionList,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useApp } from '../context/AppContext';
import iptvApi from '../services/iptvApi';

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

const getEpisodeNumber = (episode) => {
  let num = episode.episode_num;
  if (episode.title) {
    const m = episode.title.match(/S\d+E(\d+)/i) || episode.title.match(/E(\d+)/i);
    if (m?.[1]) num = m[1];
  }
  return num;
};

/* ── My List Poster Card (portrait 2:3) ── */
function MyListCard({ item, onPress, onRemove }) {
  const poster = item.cover || item.movie_image || item.stream_icon || null;
  const epLabel = getEpLabel(item);

  return (
    <TouchableOpacity style={styles.poster} onPress={onPress} activeOpacity={0.8}>
      {poster ? (
        <Image source={{ uri: poster }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
      ) : (
        <View style={[StyleSheet.absoluteFillObject, styles.posterNoBg]} />
      )}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.6)', 'rgba(0,0,0,0.9)']}
        style={StyleSheet.absoluteFillObject}
      />
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
      <View style={styles.posterBottom}>
        <View style={styles.accentBar} />
        <Text style={styles.posterTitle} numberOfLines={3}>{item.name?.toUpperCase()}</Text>
        {epLabel && <Text style={styles.posterMeta}>{epLabel}</Text>}
      </View>
    </TouchableOpacity>
  );
}

/* ── Continue Watching Card (landscape ~16:9) ── */
function CWCard({ item, onPress }) {
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
        <View style={styles.cwPlayOverlay}>
          <Text style={styles.cwPlayIcon}>▶</Text>
        </View>
        <View style={styles.cwBottom}>
          <Text style={styles.cwTitle} numberOfLines={1}>{showTitle?.toUpperCase()}</Text>
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

/* ── Shared Detail Hero ── */
function DetailHero({ backdrop, title, infoLoading, chips, actions, onBack }) {
  return (
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
        <Text style={detailStyles.title}>{title}</Text>
        {infoLoading ? (
          <ActivityIndicator color="#e94560" style={{ marginVertical: 12 }} />
        ) : (
          chips && <View style={detailStyles.chips}>{chips}</View>
        )}
        <View style={detailStyles.actions}>{actions}</View>
      </View>
    </View>
  );
}

/* ── Movie Details Page ── */
function MovieDetailPage({ historyItem, info, onBack, onPlay }) {
  const data = info?.info || {};
  const backdrop = data.backdrop_path?.[0] || data.cover_big || historyItem.cover || null;
  const year = (data.releasedate || data.release_date || '').slice(0, 4);
  const resumeTime = historyItem.currentTime || 0;

  const chips = (
    <>
      {year ? <View style={detailStyles.chip}><Text style={detailStyles.chipText}>{year}</Text></View> : null}
      {data.genre ? <View style={detailStyles.chip}><Text style={detailStyles.chipText}>{data.genre.split(',')[0].trim()}</Text></View> : null}
      {data.rating ? <Text style={detailStyles.rating}>⭐ {parseFloat(data.rating).toFixed(1)}</Text> : null}
    </>
  );

  const actions = (
    <>
      {resumeTime > 0 && (
        <TouchableOpacity style={detailStyles.playBtn} onPress={() => onPlay(resumeTime)}>
          <Text style={detailStyles.playBtnText}>▶  Continue</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity
        style={resumeTime > 0 ? detailStyles.secondaryBtn : detailStyles.playBtn}
        onPress={() => onPlay(0)}
      >
        <Text style={resumeTime > 0 ? detailStyles.secondaryBtnText : detailStyles.playBtnText}>
          {resumeTime > 0 ? '↺  From Start' : '▶  Play Now'}
        </Text>
      </TouchableOpacity>
    </>
  );

  return (
    <ScrollView style={detailStyles.root} contentContainerStyle={detailStyles.scroll} showsVerticalScrollIndicator={false}>
      <DetailHero
        backdrop={backdrop}
        title={historyItem.name}
        infoLoading={info === null}
        chips={chips}
        actions={actions}
        onBack={onBack}
      />
      {(data.description || data.plot || data.overview || data.cast || data.director) ? (
        <View style={detailStyles.meta}>
          {(data.description || data.plot || data.overview) ? (
            <Text style={detailStyles.metaPlot}>{data.description || data.plot || data.overview}</Text>
          ) : null}
          {data.cast ? <Text style={detailStyles.metaRow}><Text style={detailStyles.metaLabel}>Cast  </Text>{data.cast}</Text> : null}
          {data.director ? <Text style={detailStyles.metaRow}><Text style={detailStyles.metaLabel}>Director  </Text>{data.director}</Text> : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

/* ── Series Details Page ── */
function SeriesDetailPage({ historyItem, info, seriesSeasons, infoLoading, onBack, onContinue, onBrowseEpisodes }) {
  const data = info || {};
  const backdrop = data.backdrop_path?.[0] || data.cover || historyItem.cover || null;
  const year = (data.release_date || data.releasedate || '').slice(0, 4);
  const showTitle = historyItem.seriesName || historyItem.name;
  const epLabel = historyItem.seasonNum
    ? ` S${historyItem.seasonNum}E${String(historyItem.episodeNum).padStart(2, '0')}`
    : '';

  const chips = (
    <>
      {year ? <View style={detailStyles.chip}><Text style={detailStyles.chipText}>{year}</Text></View> : null}
      {data.genre ? <View style={detailStyles.chip}><Text style={detailStyles.chipText}>{data.genre.split(',')[0].trim()}</Text></View> : null}
      {data.rating ? <Text style={detailStyles.rating}>⭐ {parseFloat(data.rating).toFixed(1)}</Text> : null}
    </>
  );

  const actions = (
    <>
      <TouchableOpacity style={detailStyles.playBtn} onPress={onContinue}>
        <Text style={detailStyles.playBtnText}>▶  Continue{epLabel}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={detailStyles.secondaryBtn} onPress={onBrowseEpisodes}>
        <Text style={detailStyles.secondaryBtnText}>☰  Episodes</Text>
      </TouchableOpacity>
    </>
  );

  return (
    <ScrollView style={detailStyles.root} contentContainerStyle={detailStyles.scroll} showsVerticalScrollIndicator={false}>
      <DetailHero
        backdrop={backdrop}
        title={showTitle}
        infoLoading={infoLoading}
        chips={chips}
        actions={actions}
        onBack={onBack}
      />
      {(data.plot || data.description || data.overview || data.cast || data.director) ? (
        <View style={detailStyles.meta}>
          {(data.plot || data.description || data.overview) ? (
            <Text style={detailStyles.metaPlot}>{data.plot || data.description || data.overview}</Text>
          ) : null}
          {data.cast ? <Text style={detailStyles.metaRow}><Text style={detailStyles.metaLabel}>Cast  </Text>{data.cast}</Text> : null}
          {data.director ? <Text style={detailStyles.metaRow}><Text style={detailStyles.metaLabel}>Director  </Text>{data.director}</Text> : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

/* ── Episode List Page ── */
function EpisodeListPage({ seriesName, seriesSeasons, onBack, onEpisodePress }) {
  const seasonSections = Object.keys(seriesSeasons)
    .sort((a, b) => parseInt(a) - parseInt(b))
    .map((seasonNum) => ({
      title: `Season ${seasonNum}`,
      seasonNum,
      data: seriesSeasons[seasonNum] || [],
    }));

  return (
    <View style={detailStyles.root}>
      <View style={detailStyles.epHeader}>
        <TouchableOpacity style={detailStyles.epBackBtn} onPress={onBack}>
          <Text style={detailStyles.epBackText}>← Back</Text>
        </TouchableOpacity>
        <Text style={detailStyles.epSeriesTitle} numberOfLines={1}>{seriesName}</Text>
      </View>
      <SectionList
        sections={seasonSections}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={detailStyles.epList}
        renderSectionHeader={({ section: { title } }) => (
          <View style={detailStyles.seasonHeader}>
            <Text style={detailStyles.seasonTitle}>{title}</Text>
          </View>
        )}
        renderItem={({ item, section }) => (
          <TouchableOpacity
            style={detailStyles.episodeRow}
            onPress={() => onEpisodePress(item, section.seasonNum)}
          >
            <View style={detailStyles.epBadge}>
              <Text style={detailStyles.epNum}>E{getEpisodeNumber(item)}</Text>
            </View>
            <View style={detailStyles.epInfo}>
              <Text style={detailStyles.epTitle} numberOfLines={1}>{item.title || 'Untitled'}</Text>
              {item.info?.duration && <Text style={detailStyles.epDuration}>{item.info.duration}</Text>}
            </View>
            <Text style={detailStyles.playIcon}>▶</Text>
          </TouchableOpacity>
        )}
        showsVerticalScrollIndicator={false}
      />
    </View>
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
  title: { color: '#fff', fontSize: 26, fontWeight: '900', letterSpacing: -0.5, marginBottom: 10 },
  chips: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' },
  chip: { borderWidth: 1, borderColor: '#3a3a5e', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { color: '#aaa', fontSize: 12 },
  rating: { color: '#ffd700', fontSize: 13, fontWeight: '600' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  playBtn: { backgroundColor: '#fff', paddingHorizontal: 22, paddingVertical: 12, borderRadius: 8 },
  playBtnText: { color: '#000', fontSize: 14, fontWeight: '700' },
  secondaryBtn: {
    backgroundColor: 'rgba(40,40,60,0.85)', paddingHorizontal: 18, paddingVertical: 12,
    borderRadius: 8, borderWidth: 1, borderColor: '#3a3a5e',
  },
  secondaryBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  meta: { paddingHorizontal: 16, paddingTop: 20, gap: 10 },
  metaPlot: { color: '#ccc', fontSize: 14, lineHeight: 22, marginBottom: 10 },
  metaRow: { color: '#aaa', fontSize: 13, lineHeight: 20 },
  metaLabel: { color: '#fff', fontWeight: '700' },
  // Episode list
  epHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#2a2a4e',
  },
  epBackBtn: { paddingVertical: 8, paddingHorizontal: 12, backgroundColor: '#1a1a2e', borderRadius: 8 },
  epBackText: { color: '#e94560', fontSize: 14, fontWeight: '600' },
  epSeriesTitle: { color: '#fff', fontSize: 18, fontWeight: '700', flex: 1 },
  epList: { paddingHorizontal: 16, paddingVertical: 12, paddingBottom: 80 },
  seasonHeader: {
    backgroundColor: '#16213e', paddingHorizontal: 14, paddingVertical: 10,
    marginBottom: 6, marginTop: 12, borderRadius: 8,
  },
  seasonTitle: { color: '#e94560', fontSize: 15, fontWeight: '700' },
  episodeRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1a1a2e', borderRadius: 10, padding: 12, marginBottom: 6,
    borderWidth: 1, borderColor: '#2a2a4e',
  },
  epBadge: {
    backgroundColor: '#e94560', borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 4, marginRight: 12,
  },
  epNum: { color: '#fff', fontSize: 12, fontWeight: '700' },
  epInfo: { flex: 1 },
  epTitle: { color: '#fff', fontSize: 14 },
  epDuration: { color: '#888', fontSize: 12, marginTop: 2 },
  playIcon: { color: '#e94560', fontSize: 16 },
});

/* ── Screen ── */
export default function HistoryScreen({ navigation }) {
  const { watchHistory, removeFromWatchHistory, playVideo } = useApp();

  // currentDetail: { historyItem, type: 'movie'|'series', info, seriesSeasons, infoLoading }
  const [currentDetail, setCurrentDetail] = useState(null);
  const [showEpisodes, setShowEpisodes] = useState(false);

  const handleRemove = (item) => {
    Alert.alert('Remove from History', `Remove "${item.name}" from history?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeFromWatchHistory(item.id) },
    ]);
  };

  const openDetail = async (historyItem) => {
    if (historyItem.type === 'movies') {
      setCurrentDetail({ historyItem, type: 'movie', info: null, seriesSeasons: {}, infoLoading: true });
      setShowEpisodes(false);
      try {
        const info = await iptvApi.getVODInfo(historyItem.streamId);
        setCurrentDetail((prev) => prev ? { ...prev, info, infoLoading: false } : null);
      } catch {
        setCurrentDetail((prev) => prev ? { ...prev, info: {}, infoLoading: false } : null);
      }
    } else if (historyItem.type === 'series') {
      const seriesId = historyItem.seriesId;
      setCurrentDetail({ historyItem, type: 'series', info: null, seriesSeasons: {}, infoLoading: true });
      setShowEpisodes(false);
      try {
        const result = await iptvApi.getSeriesInfo(seriesId);
        setCurrentDetail((prev) => prev ? {
          ...prev,
          info: result.info || {},
          seriesSeasons: result.episodes || {},
          infoLoading: false,
        } : null);
      } catch {
        setCurrentDetail((prev) => prev ? { ...prev, info: {}, infoLoading: false } : null);
      }
    } else {
      // Live TV — play directly
      playVideo({ ...historyItem, startTime: 0 });
      navigation.navigate('VideoPlayer');
    }
  };

  /* ── Detail views ── */
  if (currentDetail && currentDetail.type === 'movie') {
    return (
      <MovieDetailPage
        historyItem={currentDetail.historyItem}
        info={currentDetail.infoLoading ? null : currentDetail.info}
        onBack={() => setCurrentDetail(null)}
        onPlay={(startTime) => {
          const item = currentDetail.historyItem;
          const url = item.url || iptvApi.buildStreamUrl('movie', item.streamId, 'mp4');
          playVideo({ ...item, url, startTime });
          navigation.navigate('VideoPlayer');
          setCurrentDetail(null);
        }}
      />
    );
  }

  if (currentDetail && currentDetail.type === 'series') {
    if (showEpisodes) {
      return (
        <EpisodeListPage
          seriesName={currentDetail.historyItem.seriesName || currentDetail.historyItem.name}
          seriesSeasons={currentDetail.seriesSeasons}
          onBack={() => setShowEpisodes(false)}
          onEpisodePress={(episode, seasonNum) => {
            const item = currentDetail.historyItem;
            const epNum = getEpisodeNumber(episode);
            const url = iptvApi.buildStreamUrl('series', episode.id, episode.container_extension || 'mp4');
            const name = `${item.seriesName || item.name} — S${String(seasonNum).padStart(2, '0')}E${String(epNum).padStart(2, '0')}`;
            playVideo({
              type: 'series', streamId: episode.id, seriesId: item.seriesId,
              seriesName: item.seriesName || item.name, name, url, cover: item.cover,
              seasonNum, episodeNum: epNum, seriesSeasons: currentDetail.seriesSeasons,
            });
            navigation.navigate('VideoPlayer');
            setCurrentDetail(null);
            setShowEpisodes(false);
          }}
        />
      );
    }

    return (
      <SeriesDetailPage
        historyItem={currentDetail.historyItem}
        info={currentDetail.info}
        seriesSeasons={currentDetail.seriesSeasons}
        infoLoading={currentDetail.infoLoading}
        onBack={() => setCurrentDetail(null)}
        onContinue={() => {
          const item = currentDetail.historyItem;
          const url = item.url || iptvApi.buildStreamUrl('series', item.streamId, 'mp4');
          playVideo({ ...item, url, startTime: item.currentTime || 0 });
          navigation.navigate('VideoPlayer');
          setCurrentDetail(null);
        }}
        onBrowseEpisodes={() => setShowEpisodes(true)}
      />
    );
  }

  /* ── My List & Continue Watching ── */
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
    <ScrollView style={styles.root} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      {/* My List */}
      {myList.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>My List</Text>
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
                onRemove={() => handleRemove(item)}
              />
            ))}
          </ScrollView>
        </View>
      )}

      {/* Continue Watching */}
      {continueWatching.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitleInRow}>Continue Watching</Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.shelfTrack}
          >
            {continueWatching.map((item) => (
              <CWCard key={item.id} item={item} onPress={() => {
                playVideo({ ...item, startTime: item.currentTime || 0 });
                navigation.navigate('VideoPlayer');
              }} />
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
  sectionRow: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
    paddingHorizontal: 16, marginBottom: 16,
  },
  sectionTitle: {
    color: '#fff', fontSize: 22, fontWeight: '700', letterSpacing: -0.3,
    paddingHorizontal: 16, marginBottom: 16,
  },
  sectionTitleInRow: { color: '#fff', fontSize: 22, fontWeight: '700', letterSpacing: -0.3 },
  shelfTrack: { paddingHorizontal: 16, gap: 12 },

  /* ── My List poster (portrait 2:3) ── */
  poster: {
    width: 130, aspectRatio: 2 / 3,
    borderRadius: 8, backgroundColor: '#16213e', overflow: 'hidden', flexShrink: 0,
  },
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
  posterBottom: { position: 'absolute', left: 10, right: 10, bottom: 12, zIndex: 4 },
  accentBar: { width: 20, height: 2, backgroundColor: '#e94560', borderRadius: 1, marginBottom: 6 },
  posterTitle: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.3, lineHeight: 13 },
  posterMeta: { color: '#aaa', fontSize: 9, marginTop: 4, letterSpacing: 0.3 },

  /* ── Continue Watching card (landscape ~16:9) ── */
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
  cwTitle: { color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 0.3, marginBottom: 6 },
  cwBar: { height: 3, backgroundColor: 'rgba(255,255,255,0.18)' },
  cwBarFill: { height: '100%', backgroundColor: '#e94560' },
  cwMeta: { paddingTop: 8, paddingHorizontal: 2 },
  cwShowName: { color: '#fff', fontSize: 12, fontWeight: '600', marginBottom: 2 },
  cwEpLine: { color: '#888', fontSize: 11, marginBottom: 2 },
  cwTimeLeft: { color: '#888', fontSize: 11 },
});
