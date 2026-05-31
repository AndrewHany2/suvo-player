import { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Image, ActivityIndicator, SectionList,
} from 'react-native';
import { useApp } from '../context/AppContext';
import iptvApi from '../services/iptvApi';

const getTrailerUrl = (t) => {
  if (!t) return null;
  const m = t.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/);
  if (m) return `https://www.youtube-nocookie.com/embed/${m[1]}`;
  if (/^[A-Za-z0-9_-]{11}$/.test(t.trim())) return `https://www.youtube-nocookie.com/embed/${t.trim()}`;
  return null;
};

const getEpisodeNumber = (ep) => {
  let num = ep.episode_num;
  if (ep.title) {
    const m = ep.title.match(/S\d+E(\d+)/i) || ep.title.match(/E(\d+)/i);
    if (m?.[1]) num = m[1];
  }
  return num;
};

export default function SeriesDetail({ item, onBack, onPlayEpisode }) {
  const { watchHistory, isInMyList, addToMyList, removeFromMyList } = useApp();
  const [info, setInfo] = useState(null);
  const [episodes, setEpisodes] = useState({});
  const [showEpisodes, setShowEpisodes] = useState(false);
  const [showTrailer, setShowTrailer] = useState(false);

  const seriesId = item.seriesId ?? item.id ?? item.series_id;
  const seriesName = item.seriesName || item.name;
  const cover = item.cover || null;

  const historyEntry = watchHistory.find(
    h => h.type === 'series' && String(h.seriesId) === String(seriesId)
  );

  const inFav = isInMyList('series', seriesId);
  const toggleFav = () => {
    if (inFav) removeFromMyList(`mylist_series_${seriesId}`);
    else addToMyList({ type: 'series', streamId: seriesId, seriesId, name: seriesName, cover });
  };

  useEffect(() => {
    setInfo(null);
    setEpisodes({});
    setShowEpisodes(false);
    setShowTrailer(false);
    iptvApi.getSeriesInfo(seriesId)
      .then(result => { setInfo(result.info || {}); setEpisodes(result.episodes || {}); })
      .catch(() => setInfo({}));
  }, [seriesId]);

  const isLoading = info === null;
  const data = info || {};
  const backdrop = data.backdrop_path?.[0] || data.cover || cover;
  const year = (data.release_date || data.releasedate || '').slice(0, 4);
  const trailer = getTrailerUrl(data.youtube_trailer);

  const handleEpisodePress = (ep, seasonNum) => {
    const epNum = getEpisodeNumber(ep);
    const url = iptvApi.buildStreamUrl('series', ep.id, ep.container_extension || 'mp4');
    onPlayEpisode({
      type: 'series',
      streamId: ep.id,
      seriesId,
      seriesName,
      name: `${seriesName} — S${String(seasonNum).padStart(2, '0')}E${String(epNum).padStart(2, '0')}`,
      url,
      cover,
      seasonNum,
      episodeNum: epNum,
      seriesSeasons: episodes,
      startTime: 0,
    });
  };

  const handleContinue = () => {
    const url = historyEntry.url || iptvApi.buildStreamUrl('series', historyEntry.streamId, 'mp4');
    onPlayEpisode({ ...historyEntry, url, startTime: historyEntry.currentTime || 0 });
  };

  if (showEpisodes) {
    const sections = Object.keys(episodes)
      .sort((a, b) => parseInt(a) - parseInt(b))
      .map(num => ({ title: `Season ${num}`, seasonNum: num, data: episodes[num] || [] }));

    return (
      <View style={S.root}>
        <View style={S.epHeader}>
          <TouchableOpacity style={S.epBackBtn} onPress={() => setShowEpisodes(false)}>
            <Text style={S.epBackText}>← Back</Text>
          </TouchableOpacity>
          <Text style={S.epTitle} numberOfLines={1}>{seriesName}</Text>
        </View>
        <SectionList
          sections={sections}
          keyExtractor={ep => String(ep.id)}
          contentContainerStyle={{ paddingHorizontal: 48, paddingVertical: 12, paddingBottom: 80 }}
          renderSectionHeader={({ section: { title } }) => (
            <View style={S.seasonHeader}><Text style={S.seasonTitle}>{title}</Text></View>
          )}
          renderItem={({ item: ep, section }) => (
            <TouchableOpacity style={S.episodeRow} onPress={() => handleEpisodePress(ep, section.seasonNum)}>
              <View style={S.epBadge}><Text style={S.epNum}>E{getEpisodeNumber(ep)}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={S.epName} numberOfLines={1}>{ep.title || 'Untitled'}</Text>
                {ep.info?.duration && <Text style={S.epDur}>{ep.info.duration}</Text>}
              </View>
              <Text style={{ color: '#e94560', fontSize: 16 }}>▶</Text>
            </TouchableOpacity>
          )}
        />
      </View>
    );
  }

  return (
    <ScrollView style={S.root} contentContainerStyle={S.scroll}>
      <View style={S.hero}>
        {backdrop
          ? <Image source={{ uri: backdrop }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
          : <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#16213e' }]} />}
        <View style={[StyleSheet.absoluteFillObject, { background: 'linear-gradient(to top, #0f0f23 0%, rgba(15,15,35,0.6) 55%, rgba(15,15,35,0.15) 100%)' }]} />
        <TouchableOpacity style={S.backBtn} onPress={onBack}>
          <Text style={S.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={S.heroBody}>
          <Text style={S.title}>{seriesName}</Text>
          {isLoading
            ? <ActivityIndicator color="#e94560" style={{ marginVertical: 12 }} />
            : (
              <View style={S.chips}>
                {year ? <View style={S.chip}><Text style={S.chipText}>{year}</Text></View> : null}
                {data.genre ? <View style={S.chip}><Text style={S.chipText}>{data.genre.split(',')[0].trim()}</Text></View> : null}
                {data.rating ? <Text style={S.rating}>⭐ {parseFloat(data.rating).toFixed(1)}</Text> : null}
              </View>
            )}
          <View style={S.actions}>
            {historyEntry && (
              <TouchableOpacity style={S.playBtn} onPress={handleContinue}>
                <Text style={S.playBtnText}>
                  {'▶  Continue'}
                  {historyEntry.seasonNum ? ` S${historyEntry.seasonNum}E${String(historyEntry.episodeNum).padStart(2, '0')}` : ''}
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={historyEntry ? S.secondaryBtn : S.playBtn} onPress={() => setShowEpisodes(true)}>
              <Text style={historyEntry ? S.secondaryBtnText : S.playBtnText}>☰  Browse Episodes</Text>
            </TouchableOpacity>
            {!isLoading && trailer && (
              <TouchableOpacity style={S.secondaryBtn} onPress={() => setShowTrailer(v => !v)}>
                <Text style={S.secondaryBtnText}>{showTrailer ? '✕  Close' : '🎬  Trailer'}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[S.secondaryBtn, inFav && S.favActive]} onPress={toggleFav}>
              <Text style={S.secondaryBtnText}>{inFav ? '♥  Saved' : '♡  Favorites'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {showTrailer && trailer && (
        <View style={S.trailerWrap}>
          <iframe
            src={`${trailer}?autoplay=1`}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            style={{ width: '100%', height: 420, border: 'none', borderRadius: 8 }}
          />
        </View>
      )}

      {(data.plot || data.description || data.overview || data.cast || data.director) && (
        <View style={S.meta}>
          {(data.plot || data.description || data.overview) && (
            <Text style={S.metaPlot}>{data.plot || data.description || data.overview}</Text>
          )}
          {data.cast && <Text style={S.metaRow}><Text style={S.metaLabel}>Cast  </Text>{data.cast}</Text>}
          {data.director && <Text style={S.metaRow}><Text style={S.metaLabel}>Director  </Text>{data.director}</Text>}
        </View>
      )}
    </ScrollView>
  );
}

const S = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f0f23' },
  scroll: { paddingBottom: 80 },
  hero: { width: '100%', height: 520, position: 'relative' },
  backBtn: { position: 'absolute', top: 20, left: 48, zIndex: 10, paddingVertical: 8, paddingHorizontal: 14, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 8 },
  backText: { color: '#e94560', fontSize: 14, fontWeight: '600' },
  heroBody: { position: 'absolute', bottom: 0, left: 48, right: 48, zIndex: 5, paddingBottom: 40 },
  title: { color: '#fff', fontSize: 40, fontWeight: '900', letterSpacing: -1, marginBottom: 12 },
  chips: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' },
  chip: { borderWidth: 1, borderColor: '#3a3a5e', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { color: '#aaa', fontSize: 12 },
  rating: { color: '#ffd700', fontSize: 13, fontWeight: '600' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  playBtn: { backgroundColor: '#fff', paddingHorizontal: 28, paddingVertical: 13, borderRadius: 8 },
  playBtnText: { color: '#000', fontSize: 15, fontWeight: '700' },
  secondaryBtn: { backgroundColor: 'rgba(40,40,60,0.85)', paddingHorizontal: 22, paddingVertical: 13, borderRadius: 8, borderWidth: 1, borderColor: '#3a3a5e' },
  secondaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  favActive: { borderColor: '#e94560', backgroundColor: 'rgba(233,69,96,0.15)' },
  trailerWrap: { paddingHorizontal: 48, paddingTop: 8, paddingBottom: 24 },
  meta: { paddingHorizontal: 48, paddingTop: 24, gap: 10 },
  metaPlot: { color: '#ccc', fontSize: 15, lineHeight: 24, marginBottom: 12 },
  metaRow: { color: '#aaa', fontSize: 14, lineHeight: 20 },
  metaLabel: { color: '#fff', fontWeight: '700' },
  epHeader: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 48, paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: '#2a2a4e' },
  epBackBtn: { paddingVertical: 8, paddingHorizontal: 14, backgroundColor: '#1a1a2e', borderRadius: 8 },
  epBackText: { color: '#e94560', fontSize: 14, fontWeight: '600' },
  epTitle: { color: '#fff', fontSize: 20, fontWeight: '700', flex: 1 },
  seasonHeader: { backgroundColor: '#16213e', paddingHorizontal: 14, paddingVertical: 10, marginBottom: 6, marginTop: 12, borderRadius: 8 },
  seasonTitle: { color: '#e94560', fontSize: 15, fontWeight: '700' },
  episodeRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a2e', borderRadius: 10, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: '#2a2a4e' },
  epBadge: { backgroundColor: '#e94560', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, marginRight: 12 },
  epNum: { color: '#fff', fontSize: 12, fontWeight: '700' },
  epName: { color: '#fff', fontSize: 14 },
  epDur: { color: '#888', fontSize: 12, marginTop: 2 },
});
