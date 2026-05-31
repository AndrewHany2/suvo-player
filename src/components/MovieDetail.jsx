import { useState, useEffect, memo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Image, ActivityIndicator, Linking,
} from 'react-native';
import { useApp } from '../context/AppContext';
import iptvApi from '../services/iptvApi';

const GradientOverlay = memo(({ style }) => (
  <View style={style} pointerEvents="none">
    <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, top: '45%', backgroundColor: 'rgba(0,0,0,0.82)' }} />
  </View>
));

const getTrailerUrl = (t) => {
  if (!t) return null;
  const m = t.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/);
  if (m) return `https://www.youtube.com/watch?v=${m[1]}`;
  if (/^[A-Za-z0-9_-]{11}$/.test(t.trim())) return `https://www.youtube.com/watch?v=${t.trim()}`;
  return null;
};

export default function MovieDetail({ item, onBack, onPlay }) {
  const { watchHistory, isInMyList, addToMyList, removeFromMyList } = useApp();
  const [info, setInfo] = useState(null);

  const streamId = item.stream_id ?? item.streamId;
  const name = item.name;
  const cover = item.stream_icon || item.cover || item.movie_image || null;

  const historyEntry = watchHistory.find(
    h => h.type === 'movies' && String(h.streamId) === String(streamId)
  );
  const resumeTime = historyEntry?.currentTime || 0;

  const inFav = isInMyList('movies', streamId);
  const toggleFav = () => {
    if (inFav) removeFromMyList(`mylist_movies_${streamId}`);
    else addToMyList({ type: 'movies', streamId, name, cover });
  };

  useEffect(() => {
    setInfo(null);
    iptvApi.getVODInfo(streamId).then(setInfo).catch(() => setInfo({}));
  }, [streamId]);

  const data = info?.info || {};
  const backdrop = data.backdrop_path?.[0] || data.cover_big || cover;
  const year = (data.releasedate || data.release_date || '').slice(0, 4);
  const trailer = getTrailerUrl(data.youtube_trailer);
  const isLoading = info === null;

  const handlePlay = (startTime) => {
    const url = iptvApi.buildStreamUrl('movie', streamId, item.container_extension || 'mp4');
    onPlay({ type: 'movies', streamId, name, url, cover, startTime });
  };

  return (
    <ScrollView style={S.root} contentContainerStyle={S.scroll} showsVerticalScrollIndicator={false}>
      <View style={S.hero}>
        {backdrop
          ? <Image source={{ uri: backdrop }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
          : <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#16213e' }]} />}
        <GradientOverlay style={StyleSheet.absoluteFillObject} />
        <TouchableOpacity style={S.backBtn} onPress={onBack} activeOpacity={0.8}>
          <Text style={S.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={S.heroBody}>
          <Text style={S.title}>{name}</Text>
          {isLoading
            ? <ActivityIndicator color="#e94560" style={{ marginVertical: 12 }} />
            : (
              <View style={S.chips}>
                {year ? <View style={S.chip}><Text style={S.chipText}>{year}</Text></View> : null}
                {data.genre ? <View style={S.chip}><Text style={S.chipText}>{data.genre.split(',')[0].trim()}</Text></View> : null}
                {data.rating ? <Text style={S.rating}>⭐ {parseFloat(data.rating).toFixed(1)}</Text> : null}
                {data.age ? <View style={[S.chip, { borderColor: '#e94560' }]}><Text style={[S.chipText, { color: '#e94560' }]}>{data.age}</Text></View> : null}
              </View>
            )}
          <View style={S.actions}>
            {resumeTime > 0 ? (
              <>
                <TouchableOpacity style={S.playBtn} onPress={() => handlePlay(resumeTime)} activeOpacity={0.8}>
                  <Text style={S.playBtnText}>▶  Continue</Text>
                </TouchableOpacity>
                <TouchableOpacity style={S.secondaryBtn} onPress={() => handlePlay(0)} activeOpacity={0.8}>
                  <Text style={S.secondaryBtnText}>↺  From Start</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity style={S.playBtn} onPress={() => handlePlay(0)} activeOpacity={0.8}>
                <Text style={S.playBtnText}>▶  Play Now</Text>
              </TouchableOpacity>
            )}
            {!isLoading && !!trailer && (
              <TouchableOpacity style={S.secondaryBtn} onPress={() => Linking.openURL(trailer)} activeOpacity={0.8}>
                <Text style={S.secondaryBtnText}>🎬  Trailer</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[S.secondaryBtn, inFav && S.favActive]} onPress={toggleFav} activeOpacity={0.8}>
              <Text style={S.secondaryBtnText}>{inFav ? '♥  Saved' : '♡  Favorites'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {(data.description || data.plot || data.overview || data.cast || data.director) ? (
        <View style={S.meta}>
          {(data.description || data.plot || data.overview) ? (
            <Text style={S.metaPlot}>{data.description || data.plot || data.overview}</Text>
          ) : null}
          {data.cast ? <Text style={S.metaRow}><Text style={S.metaLabel}>Cast  </Text>{data.cast}</Text> : null}
          {data.director ? <Text style={S.metaRow}><Text style={S.metaLabel}>Director  </Text>{data.director}</Text> : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

const S = StyleSheet.create({
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
  favActive: { borderColor: '#e94560', backgroundColor: 'rgba(233,69,96,0.15)' },
  meta: { paddingHorizontal: 16, paddingTop: 20, gap: 10 },
  metaPlot: { color: '#ccc', fontSize: 14, lineHeight: 22, marginBottom: 10 },
  metaRow: { color: '#aaa', fontSize: 13, lineHeight: 20 },
  metaLabel: { color: '#fff', fontWeight: '700' },
});
