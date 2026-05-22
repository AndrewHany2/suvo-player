import { useState, useEffect, useLayoutEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useApp } from '../context/AppContext';
import iptvApi from '../services/iptvApi';

export default function MoviesScreen({ navigation }) {
  const { users, activeUserId, isLoading, setIsLoading, playVideo } = useApp();

  const [view, setView] = useState('categories');
  const [categories, setCategories] = useState([]);
  const [movies, setMovies] = useState([]);
  const [currentCategory, setCurrentCategory] = useState(null);
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
      const data = await iptvApi.getVODCategories();
      setCategories([{ category_id: '', category_name: 'All' }, ...(data || [])]);
    } catch (err) {
      console.error('Error loading movie categories:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCategoryPress = async (category) => {
    setCurrentCategory(category);
    setIsLoading(true);
    setSearchQuery('');
    try {
      const data = await iptvApi.getVODStreams(category.category_id || undefined);
      setMovies(data || []);
      setView('items');
    } catch (err) {
      console.error('Error loading movies:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleMoviePress = (item) => {
    const streamUrl = iptvApi.buildStreamUrl('movie', item.stream_id, item.container_extension || 'mp4');
    const video = {
      type: 'movies',
      streamId: item.stream_id,
      name: item.name,
      url: streamUrl,
    };
    playVideo(video);
    navigation.navigate('VideoPlayer');
  };

  const handleBack = () => {
    setView('categories');
    setMovies([]);
    setCurrentCategory(null);
    setSearchQuery('');
  };

  const filteredCategories = categories.filter((c) =>
    c.category_name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const filteredMovies = movies.filter((m) =>
    m.name.toLowerCase().includes(searchQuery.toLowerCase())
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
        <Text style={styles.emptyIcon}>🎬</Text>
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
      <TextInput
        style={styles.search}
        placeholder={`🔍 Search ${view === 'categories' ? 'categories' : currentCategory?.category_name}...`}
        placeholderTextColor="#666"
        value={searchQuery}
        onChangeText={setSearchQuery}
      />

      {view === 'items' && (
        <TouchableOpacity style={styles.backBtn} onPress={handleBack}>
          <Text style={styles.backBtnText}>← Back to Categories</Text>
        </TouchableOpacity>
      )}

      {view === 'categories' ? (
        <FlatList
          data={filteredCategories}
          keyExtractor={(item) => item.category_id}
          numColumns={2}
          contentContainerStyle={styles.grid}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.categoryCard} onPress={() => handleCategoryPress(item)}>
              <Text style={styles.categoryIcon}>🎬</Text>
              <Text style={styles.categoryName} numberOfLines={2}>{item.category_name}</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No categories found</Text>
            </View>
          }
        />
      ) : (
        <FlatList
          data={filteredMovies}
          keyExtractor={(item) => String(item.stream_id)}
          numColumns={2}
          contentContainerStyle={styles.grid}
          renderItem={({ item }) => {
            const poster = item.stream_icon || item.cover || item.movie_image || null;
            return (
              <TouchableOpacity style={styles.movieCard} onPress={() => handleMoviePress(item)}>
                {poster ? (
                  <Image source={{ uri: poster }} style={styles.moviePoster} resizeMode="cover" />
                ) : (
                  <View style={styles.moviePosterPlaceholder}>
                    <Text style={{ fontSize: 32 }}>🎬</Text>
                  </View>
                )}
                <Text style={styles.movieName} numberOfLines={2}>{item.name}</Text>
                {item.rating && (
                  <Text style={styles.movieRating}>⭐ {item.rating}</Text>
                )}
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No movies found</Text>
            </View>
          }
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
  movieCard: {
    flex: 1,
    margin: 6,
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#2a2a4e',
  },
  moviePoster: { width: '100%', aspectRatio: 2 / 3 },
  moviePosterPlaceholder: {
    width: '100%',
    aspectRatio: 2 / 3,
    backgroundColor: '#0f0f23',
    justifyContent: 'center',
    alignItems: 'center',
  },
  movieName: { color: '#fff', fontSize: 12, padding: 8, fontWeight: '500' },
  movieRating: { color: '#ffd700', fontSize: 11, paddingHorizontal: 8, paddingBottom: 8 },
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
