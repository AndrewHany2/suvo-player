import { useState, useEffect, useLayoutEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  SectionList,
} from 'react-native';
import { useApp } from '../context/AppContext';
import iptvApi from '../services/iptvApi';

export default function SeriesScreen({ navigation }) {
  const { users, activeUserId, isLoading, setIsLoading, playVideo } = useApp();

  const [view, setView] = useState('categories'); // 'categories' | 'items' | 'episodes'
  const [categories, setCategories] = useState([]);
  const [seriesList, setSeriesList] = useState([]);
  const [currentSeries, setCurrentSeries] = useState(null);
  const [seriesSeasons, setSeriesSeasons] = useState({});
  const [searchQuery, setSearchQuery] = useState('');

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity onPress={() => navigation.navigate('Accounts')} style={{ marginRight: 12 }}>
          <Text style={{ color: '#e94560', fontSize: 14, fontWeight: '600' }}>📡 Accounts</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

  useEffect(() => {
    if (activeUserId) loadCategories();
  }, [activeUserId]);

  const loadCategories = async () => {
    const user = users.find((u) => u.id === activeUserId);
    if (!user) return;
    setIsLoading(true);
    try {
      iptvApi.setCredentials(user.host, user.username, user.password);
      const data = await iptvApi.getSeriesCategories();
      setCategories([{ category_id: '', category_name: 'All' }, ...(data || [])]);
    } catch (err) {
      console.error('Error loading series categories:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCategoryPress = async (category) => {
    setIsLoading(true);
    setSearchQuery('');
    try {
      const data = await iptvApi.getSeries(category.category_id || undefined);
      setSeriesList(data || []);
      setView('items');
    } catch (err) {
      console.error('Error loading series:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSeriesPress = async (item) => {
    setIsLoading(true);
    setSearchQuery('');
    try {
      const info = await iptvApi.getSeriesInfo(item.series_id);
      setSeriesSeasons(info.episodes || {});
      setCurrentSeries({ id: item.series_id, name: item.name });
      setView('episodes');
    } catch (err) {
      console.error('Error loading episodes:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const getEpisodeNumber = (episode) => {
    let episodeNum = episode.episode_num;
    if (episode.title) {
      const match =
        episode.title.match(/S\d+E(\d+)/i) || episode.title.match(/E(\d+)/i);
      if (match && match[1]) episodeNum = match[1];
    }
    return episodeNum;
  };

  const handleEpisodePress = (episode, seasonNum) => {
    const streamUrl = iptvApi.buildStreamUrl('series', episode.id, episode.container_extension || 'mp4');
    const episodeNum = getEpisodeNumber(episode);
    const episodeName = `${currentSeries.name} - S${String(seasonNum).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')}`;

    const video = {
      type: 'series',
      streamId: episode.id,
      seriesId: currentSeries.id,
      seriesName: currentSeries.name,
      name: episodeName,
      url: streamUrl,
      seasonNum: seasonNum,
      episodeNum: episodeNum,
      seriesSeasons: seriesSeasons,
    };
    playVideo(video);
    navigation.navigate('VideoPlayer');
  };

  const handleBack = () => {
    if (view === 'episodes') {
      setView('items');
      setCurrentSeries(null);
      setSeriesSeasons({});
    } else {
      setView('categories');
      setSeriesList([]);
    }
    setSearchQuery('');
  };

  const seasonSections = Object.keys(seriesSeasons)
    .sort((a, b) => parseInt(a) - parseInt(b))
    .map((seasonNum) => ({
      title: `Season ${seasonNum}`,
      seasonNum,
      data: seriesSeasons[seasonNum] || [],
    }));

  const filteredCategories = categories.filter((c) =>
    c.category_name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const filteredSeries = seriesList.filter((s) =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#e94560" />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  if (!activeUserId) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyIcon}>🎭</Text>
        <Text style={styles.emptyTitle}>No IPTV Account</Text>
        <Text style={styles.emptyHint}>Tap "Accounts" to add your IPTV service</Text>
        <TouchableOpacity style={styles.addBtn} onPress={() => navigation.navigate('Accounts')}>
          <Text style={styles.addBtnText}>Add Account</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {view !== 'episodes' && (
        <TextInput
          style={styles.search}
          placeholder={`🔍 Search...`}
          placeholderTextColor="#666"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      )}

      {view !== 'categories' && (
        <TouchableOpacity style={styles.backBtn} onPress={handleBack}>
          <Text style={styles.backBtnText}>
            ← {view === 'episodes' ? `Back to ${currentSeries?.name}` : 'Back to Categories'}
          </Text>
        </TouchableOpacity>
      )}

      {view === 'episodes' && currentSeries && (
        <Text style={styles.seriesTitle}>{currentSeries.name}</Text>
      )}

      {view === 'categories' && (
        <FlatList
          data={filteredCategories}
          keyExtractor={(item) => item.category_id}
          numColumns={2}
          contentContainerStyle={styles.grid}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.categoryCard} onPress={() => handleCategoryPress(item)}>
              <Text style={styles.categoryIcon}>🎭</Text>
              <Text style={styles.categoryName} numberOfLines={2}>{item.category_name}</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No categories found</Text>
            </View>
          }
        />
      )}

      {view === 'items' && (
        <FlatList
          data={filteredSeries}
          keyExtractor={(item) => String(item.series_id)}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.seriesRow} onPress={() => handleSeriesPress(item)}>
              <Text style={styles.seriesIcon}>🎭</Text>
              <View style={styles.seriesInfo}>
                <Text style={styles.seriesName} numberOfLines={1}>{item.name}</Text>
                {item.rating && <Text style={styles.seriesRating}>⭐ {item.rating}</Text>}
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No series found</Text>
            </View>
          }
        />
      )}

      {view === 'episodes' && (
        <SectionList
          sections={seasonSections}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          renderSectionHeader={({ section: { title } }) => (
            <View style={styles.seasonHeader}>
              <Text style={styles.seasonTitle}>{title}</Text>
            </View>
          )}
          renderItem={({ item, section }) => (
            <TouchableOpacity
              style={styles.episodeRow}
              onPress={() => handleEpisodePress(item, section.seasonNum)}
            >
              <View style={styles.episodeNumBadge}>
                <Text style={styles.episodeNum}>E{getEpisodeNumber(item)}</Text>
              </View>
              <View style={styles.episodeInfo}>
                <Text style={styles.episodeTitle} numberOfLines={1}>
                  {item.title || 'Untitled'}
                </Text>
                {item.info?.duration && (
                  <Text style={styles.episodeDuration}>{item.info.duration}</Text>
                )}
              </View>
              <Text style={styles.playIcon}>▶</Text>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f23' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f0f23' },
  loadingText: { color: '#aaa', marginTop: 12 },
  search: {
    backgroundColor: '#1a1a2e',
    color: '#fff',
    margin: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#333',
  },
  backBtn: { paddingHorizontal: 16, paddingBottom: 8 },
  backBtnText: { color: '#e94560', fontSize: 14, fontWeight: '600' },
  seriesTitle: { color: '#fff', fontSize: 18, fontWeight: '700', paddingHorizontal: 16, paddingBottom: 8 },
  grid: { paddingHorizontal: 8, paddingBottom: 20 },
  categoryCard: {
    flex: 1,
    margin: 6,
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2a2a4e',
  },
  categoryIcon: { fontSize: 28, marginBottom: 8 },
  categoryName: { color: '#fff', fontSize: 13, textAlign: 'center', fontWeight: '500' },
  list: { paddingHorizontal: 12, paddingBottom: 20 },
  seriesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#2a2a4e',
  },
  seriesIcon: { fontSize: 22, marginRight: 12 },
  seriesInfo: { flex: 1 },
  seriesName: { color: '#fff', fontSize: 15, fontWeight: '500' },
  seriesRating: { color: '#ffd700', fontSize: 12, marginTop: 2 },
  chevron: { color: '#888', fontSize: 22 },
  seasonHeader: {
    backgroundColor: '#16213e',
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 4,
    borderRadius: 8,
  },
  seasonTitle: { color: '#e94560', fontSize: 15, fontWeight: '700' },
  episodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#2a2a4e',
  },
  episodeNumBadge: {
    backgroundColor: '#e94560',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 12,
  },
  episodeNum: { color: '#fff', fontSize: 12, fontWeight: '700' },
  episodeInfo: { flex: 1 },
  episodeTitle: { color: '#fff', fontSize: 14 },
  episodeDuration: { color: '#888', fontSize: 12, marginTop: 2 },
  playIcon: { color: '#e94560', fontSize: 16 },
  emptyState: { padding: 40, alignItems: 'center' },
  emptyText: { color: '#666', fontSize: 15 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { color: '#fff', fontSize: 18, fontWeight: '600', marginBottom: 8 },
  emptyHint: { color: '#888', fontSize: 14, textAlign: 'center', marginBottom: 20 },
  addBtn: {
    backgroundColor: '#e94560',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  addBtnText: { color: '#fff', fontWeight: '600' },
});
