import { useState, useEffect, useLayoutEffect, useCallback, memo } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
  Modal,
  Alert,
} from 'react-native';
import { useApp } from '../context/AppContext';
import iptvApi from '../services/iptvApi';

const decodeEpgTitle = (title) => {
  try {
    return atob(title);
  } catch {
    return title;
  }
};

const ChannelRow = memo(({ item, epgCache, fetchEpg, onPress }) => {
  useEffect(() => {
    const sid = item.stream_id || item.id;
    if (epgCache[sid] === undefined) fetchEpg(sid);
  }, [item.stream_id, item.id]);

  const sid = item.stream_id || item.id;
  const epg = epgCache[sid];

  return (
    <TouchableOpacity style={styles.channelRow} onPress={() => onPress(item)}>
      {item.logo ? (
        <Image source={{ uri: item.logo }} style={styles.channelLogo} />
      ) : (
        <View style={styles.channelLogoPlaceholder}>
          <Text style={{ fontSize: 20 }}>📺</Text>
        </View>
      )}
      <View style={styles.channelInfo}>
        <Text style={styles.channelName} numberOfLines={1}>{item.name}</Text>
        {epg ? (
          <Text style={styles.channelEpg} numberOfLines={1}>▶ {epg}</Text>
        ) : null}
      </View>
      <Text style={styles.playIcon}>▶</Text>
    </TouchableOpacity>
  );
});

export default function LiveTVScreen({ navigation }) {
  const { users, activeUserId, channels, setChannels, saveChannels, isLoading, setIsLoading, playVideo } =
    useApp();

  const [items, setItems] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [epgCache, setEpgCache] = useState({});
  const [showAddChannel, setShowAddChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [newStreamUrl, setNewStreamUrl] = useState('');

  const fetchEpg = useCallback(async (streamId) => {
    setEpgCache((prev) => {
      if (prev[streamId] !== undefined) return prev;
      return { ...prev, [streamId]: null };
    });
    try {
      const data = await iptvApi.getShortEpg(streamId, 1);
      const listing = data?.epg_listings?.[0];
      const title = listing ? decodeEpgTitle(listing.title) : '';
      setEpgCache((prev) => ({ ...prev, [streamId]: title }));
    } catch {
      setEpgCache((prev) => ({ ...prev, [streamId]: '' }));
    }
  }, []);

  const handleAddChannel = () => {
    if (!newChannelName.trim() || !newStreamUrl.trim()) {
      Alert.alert('Missing Fields', 'Please enter both a channel name and stream URL.');
      return;
    }
    const newChannel = {
      name: newChannelName.trim(),
      url: newStreamUrl.trim(),
      id: Date.now().toString(),
      stream_id: Date.now().toString(),
      category: 'Custom',
      type: 'live',
      logo: null,
    };
    const updated = [...channels, newChannel];
    setChannels(updated);
    saveChannels();
    setNewChannelName('');
    setNewStreamUrl('');
    setShowAddChannel(false);
    Alert.alert('Channel Added', `"${newChannel.name}" added to Custom category.`);
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={{ flexDirection: 'row', gap: 8, marginRight: 12 }}>
          <TouchableOpacity onPress={() => setShowAddChannel(true)}>
            <Text style={{ color: '#e94560', fontSize: 22, fontWeight: '700' }}>+</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('Accounts')}>
            <Text style={{ color: '#e94560', fontSize: 14, fontWeight: '600' }}>📡 Accounts</Text>
          </TouchableOpacity>
        </View>
      ),
    });
  }, [navigation, channels]);

  useEffect(() => {
    setEpgCache({});
    if (activeUserId) loadCategories();
  }, [activeUserId]);

  const loadCategories = async () => {
    const user = users.find((u) => u.id === activeUserId);
    if (!user) return;

    setIsLoading(true);
    try {
      iptvApi.setCredentials(user.host, user.username, user.password);
      const channelsData = await iptvApi.getLiveStreams();
      const formatted = channelsData.map((ch) => ({
        name: ch.name,
        url: iptvApi.buildStreamUrl('live', ch.stream_id, 'm3u8'),
        id: ch.stream_id,
        stream_id: ch.stream_id,
        category: ch.category_name || 'Uncategorized',
        logo: ch.stream_icon || null,
      }));
      setChannels(formatted);

      // Show all channels directly, skip categories
      setItems(formatted);
    } catch (err) {
      console.error('Error loading channels:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleChannelPress = (item) => {
    const video = {
      type: 'live',
      streamId: item.stream_id || item.id,
      name: item.name,
      url: item.url,
    };
    playVideo(video);
    navigation.navigate('VideoPlayer');
  };

  const filteredItems = items.filter((i) =>
    i.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#e94560" />
        <Text style={styles.loadingText}>Loading channels...</Text>
      </View>
    );
  }

  if (!activeUserId) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyIcon}>📡</Text>
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
        placeholder="🔍 Search channels..."
        placeholderTextColor="#666"
        value={searchQuery}
        onChangeText={setSearchQuery}
      />

      <FlatList
        data={filteredItems}
        keyExtractor={(item) => String(item.id || item.stream_id)}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <ChannelRow
            item={item}
            epgCache={epgCache}
            fetchEpg={fetchEpg}
            onPress={handleChannelPress}
          />
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No channels found</Text>
          </View>
        }
      />

      {/* Add Custom Channel Modal */}
      <Modal
        visible={showAddChannel}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAddChannel(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowAddChannel(false)}
        >
          <TouchableOpacity style={styles.modalBox} activeOpacity={1}>
            <Text style={styles.modalTitle}>Add Custom Channel</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Channel name"
              placeholderTextColor="#666"
              value={newChannelName}
              onChangeText={setNewChannelName}
            />
            <TextInput
              style={styles.modalInput}
              placeholder="Stream URL (http://... or rtmp://...)"
              placeholderTextColor="#666"
              value={newStreamUrl}
              onChangeText={setNewStreamUrl}
              autoCapitalize="none"
              keyboardType="url"
            />
            <Text style={styles.modalHint}>Supported: HLS (.m3u8), DASH (.mpd), direct video</Text>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowAddChannel(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalAddBtn} onPress={handleAddChannel}>
                <Text style={styles.modalAddText}>Add Channel</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
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
  categoryCount: { color: '#888', fontSize: 11, marginTop: 4 },
  list: { paddingHorizontal: 12, paddingBottom: 20 },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#2a2a4e',
  },
  channelLogo: { width: 40, height: 40, borderRadius: 6, marginRight: 12 },
  channelLogoPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 6,
    backgroundColor: '#0f0f23',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  channelInfo: { flex: 1, justifyContent: 'center' },
  channelName: { color: '#fff', fontSize: 15 },
  channelEpg: { color: '#888', fontSize: 12, marginTop: 2 },
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
  // Add channel modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalBox: {
    backgroundColor: '#1a1a2e',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    borderTopWidth: 1,
    borderColor: '#2a2a4e',
  },
  modalTitle: { color: '#fff', fontSize: 17, fontWeight: '700', marginBottom: 16 },
  modalInput: {
    backgroundColor: '#0f0f23',
    color: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#333',
    marginBottom: 12,
  },
  modalHint: { color: '#666', fontSize: 12, marginBottom: 20 },
  modalActions: { flexDirection: 'row', gap: 12 },
  modalCancelBtn: {
    flex: 1,
    backgroundColor: '#2a2a4e',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  modalCancelText: { color: '#aaa', fontWeight: '600' },
  modalAddBtn: {
    flex: 1,
    backgroundColor: '#e94560',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  modalAddText: { color: '#fff', fontWeight: '700' },
});
