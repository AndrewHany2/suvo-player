import { useState, useEffect, useCallback, useRef, memo } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  ScrollView,
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
  try { return atob(title); } catch { return title; }
};

const getAbbrev = (name) => {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) return (words[0].slice(0, 2) + words[1].slice(0, 1)).toUpperCase();
  return name.slice(0, 3).toUpperCase();
};

/* ─── Live Channel Card ─── */
const ChannelCard = memo(({ item, epg, onPress, fetchEpg }) => {
  const abbrev = getAbbrev(item.name);
  const sid = item.stream_id || item.id;

  useEffect(() => {
    if (epg === undefined && fetchEpg) fetchEpg(sid);
  }, [sid]);

  return (
    <TouchableOpacity style={styles.card} onPress={() => onPress(item)} activeOpacity={0.8}>
      {/* Logo / abbrev */}
      <View style={styles.cardHead}>
        {item.logo ? (
          <Image source={{ uri: item.logo }} style={styles.cardLogo} resizeMode="contain" />
        ) : (
          <View style={styles.cardAbbrev}>
            <Text style={styles.cardAbbrevText}>{abbrev}</Text>
          </View>
        )}
        <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
        {/* LIVE badge */}
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE</Text>
        </View>
      </View>

      {/* EPG title */}
      <Text style={styles.cardEpg} numberOfLines={2}>{epg || ' '}</Text>

      {/* Progress bar */}
      <View style={styles.cardProgress}>
        <View style={styles.cardProgressBar} />
      </View>

      <Text style={styles.cardTime}>Live · now playing</Text>
    </TouchableOpacity>
  );
});

/* ─── Live Shelf — one per category ─── */
function LiveShelf({ cat, epgCache, fetchEpg, onPress }) {
  const channels = cat.channels;

  if (channels !== null && !channels.length) return null;

  return (
    <View style={styles.shelf}>
      <View style={styles.shelfTitleRow}>
        <Text style={styles.shelfTitle}>📺 {cat.name}</Text>
        {channels && <Text style={styles.shelfCount}>{channels.length}</Text>}
      </View>

      {channels === null ? (
        <View style={styles.shelfLoading}>
          <ActivityIndicator size="small" color="#e94560" />
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.shelfTrack}
        >
          {channels.map((item) => {
            const sid = item.stream_id || item.id;
            return (
              <ChannelCard
                key={String(sid)}
                item={item}
                epg={epgCache[sid]}
                onPress={onPress}
                fetchEpg={fetchEpg}
              />
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

export default function LiveTVScreen({ navigation }) {
  const { users, activeUserId, channels, setChannels, saveChannels, playVideo } = useApp();

  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState([]);
  const [channelsByCategory, setChannelsByCategory] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [epgCache, setEpgCache] = useState({});
  const [showAddChannel, setShowAddChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [newStreamUrl, setNewStreamUrl] = useState('');
  const loadedRef = useRef(new Set());

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
    const ch = {
      name: newChannelName.trim(), url: newStreamUrl.trim(),
      id: Date.now().toString(), stream_id: Date.now().toString(),
      logo: null,
    };
    setChannelsByCategory((prev) => ({ ...prev, Custom: [...(prev.Custom || []), ch] }));
    setCategories((prev) =>
      prev.some((c) => c.id === 'Custom') ? prev : [...prev, { id: 'Custom', name: 'Custom' }]
    );
    setChannels((prev) => [...prev, ch]);
    saveChannels();
    setNewChannelName(''); setNewStreamUrl('');
    setShowAddChannel(false);
    Alert.alert('Channel Added', `"${ch.name}" added to Custom category.`);
  };

  useEffect(() => {
    setEpgCache({});
    if (activeUserId) loadChannels();
  }, [activeUserId]);

  const loadChannelCategory = useCallback(async (catId) => {
    if (loadedRef.current.has(catId)) return;
    loadedRef.current.add(catId);
    try {
      const data = await iptvApi.getLiveStreamsByCategory(catId);
      const formatted = (data || []).map((ch) => ({
        name: ch.name,
        url: iptvApi.buildStreamUrl('live', ch.stream_id, 'm3u8'),
        id: ch.stream_id, stream_id: ch.stream_id,
        logo: ch.stream_icon || null,
      }));
      setChannelsByCategory((prev) => ({ ...prev, [catId]: formatted }));
      setChannels((prev) => {
        const existingIds = new Set(prev.map((c) => String(c.stream_id)));
        return [...prev, ...formatted.filter((c) => !existingIds.has(String(c.stream_id)))];
      });
    } catch {
      setChannelsByCategory((prev) => ({ ...prev, [catId]: [] }));
    }
  }, []);

  const loadChannels = async () => {
    const user = users.find((u) => u.id === activeUserId);
    if (!user) return;
    setLoading(true);
    loadedRef.current.clear();
    setCategories([]);
    setChannelsByCategory({});
    try {
      iptvApi.setCredentials(user.host, user.username, user.password);
      const cats = await iptvApi.getLiveCategories();
      if (!cats?.length) { setLoading(false); return; }
      const catList = cats.map((c) => ({ id: c.category_id, name: c.category_name }));
      setCategories(catList);
      // Pre-load first few shelves immediately
      catList.slice(0, 3).forEach((c) => loadChannelCategory(c.id));
    } catch (err) {
      console.error('Error loading channels:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleChannelPress = (item) => {
    playVideo({ type: 'live', streamId: item.stream_id || item.id, name: item.name, url: item.url });
    navigation.navigate('VideoPlayer');
  };

  // Build display categories with search filtering
  const displayCategories = searchQuery
    ? categories
        .map((cat) => {
          const chs = (channelsByCategory[cat.id] || []).filter((ch) =>
            ch.name.toLowerCase().includes(searchQuery.toLowerCase())
          );
          return { ...cat, channels: chs };
        })
        .filter((cat) => cat.channels.length > 0)
    : categories.map((cat) => ({
        ...cat,
        channels: channelsByCategory[cat.id] ?? null,
      }));

  if (loading) {
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
    <View style={styles.root}>
      {/* Search + add */}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.search}
          placeholder="🔍 Search channels..."
          placeholderTextColor="#666"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        <TouchableOpacity style={styles.addBtn2} onPress={() => setShowAddChannel(true)}>
          <Text style={styles.addBtn2Text}>+ Add</Text>
        </TouchableOpacity>
      </View>

      {/* Category shelves */}
      <FlatList
        data={displayCategories}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item, index }) => (
          <LiveShelf
            cat={item}
            epgCache={epgCache}
            fetchEpg={fetchEpg}
            onPress={handleChannelPress}
          />
        )}
        onViewableItemsChanged={({ viewableItems }) => {
          viewableItems.forEach(({ item }) => {
            if (channelsByCategory[item.id] === undefined) {
              loadChannelCategory(item.id);
            }
          });
        }}
        viewabilityConfig={{ itemVisiblePercentThreshold: 10 }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No channels found</Text>
          </View>
        }
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
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
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowAddChannel(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={handleAddChannel}>
                <Text style={styles.confirmText}>Add Channel</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f0f23' },
  scroll: { paddingBottom: 60 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f0f23', padding: 24 },
  loadingText: { color: '#aaa', marginTop: 12, fontSize: 14 },

  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14, gap: 10,
  },
  search: {
    flex: 1, backgroundColor: '#1a1a2e', color: '#fff',
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 10, fontSize: 14, borderWidth: 1, borderColor: '#333',
  },
  addBtn2: {
    backgroundColor: '#e94560', borderRadius: 10,
    paddingHorizontal: 16, paddingVertical: 10,
  },
  addBtn2Text: { color: '#fff', fontSize: 14, fontWeight: '700' },

  /* ── Shelf ── */
  shelf: { paddingTop: 8, paddingBottom: 20 },
  shelfLoading: { paddingHorizontal: 16, paddingVertical: 18 },
  shelfTitleRow: {
    flexDirection: 'row', alignItems: 'baseline', gap: 10,
    paddingHorizontal: 16, marginBottom: 12,
  },
  shelfTitle: { color: '#fff', fontSize: 18, fontWeight: '700', letterSpacing: -0.2 },
  shelfCount: { color: '#555', fontSize: 13, fontWeight: '500' },
  shelfTrack: { paddingHorizontal: 16, gap: 8 },

  /* ── Live card ── */
  card: {
    width: 240,
    backgroundColor: '#1a1a2e',
    borderWidth: 1, borderColor: '#2a2a4e',
    borderRadius: 10, padding: 14, flexShrink: 0,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  cardLogo: { width: 36, height: 36, borderRadius: 6, backgroundColor: '#0f0f23' },
  cardAbbrev: {
    width: 36, height: 36, borderRadius: 6,
    backgroundColor: '#16213e', borderWidth: 1, borderColor: '#2a2a4e',
    justifyContent: 'center', alignItems: 'center', flexShrink: 0,
  },
  cardAbbrevText: { color: '#e94560', fontWeight: '800', fontSize: 11, letterSpacing: 0.5 },
  cardName: { flex: 1, color: '#fff', fontSize: 13, fontWeight: '600' },
  liveBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(233,69,96,0.15)',
    borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 1, borderColor: 'rgba(233,69,96,0.3)',
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#e94560' },
  liveText: { color: '#e94560', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  cardEpg: { color: '#bbb', fontSize: 12, lineHeight: 17, minHeight: 34 },
  cardProgress: { height: 3, backgroundColor: '#2a2a4e', borderRadius: 2, marginTop: 10 },
  cardProgressBar: { width: '35%', height: '100%', backgroundColor: '#e94560', borderRadius: 2 },
  cardTime: { color: '#666', fontSize: 10, marginTop: 7, letterSpacing: 0.2 },

  /* ── Empty ── */
  emptyState: { padding: 60, alignItems: 'center' },
  emptyText: { color: '#666', fontSize: 15 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { color: '#fff', fontSize: 18, fontWeight: '600', marginBottom: 8 },
  emptyHint: { color: '#888', fontSize: 14, textAlign: 'center', marginBottom: 20 },
  addBtn: { backgroundColor: '#e94560', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  addBtnText: { color: '#fff', fontWeight: '600' },

  /* ── Modal ── */
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalBox: {
    backgroundColor: '#1a1a2e', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, borderTopWidth: 1, borderColor: '#2a2a4e',
  },
  modalTitle: { color: '#fff', fontSize: 17, fontWeight: '700', marginBottom: 16 },
  modalInput: {
    backgroundColor: '#0f0f23', color: '#fff', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 14,
    borderWidth: 1, borderColor: '#333', marginBottom: 12,
  },
  modalHint: { color: '#666', fontSize: 12, marginBottom: 20 },
  modalActions: { flexDirection: 'row', gap: 12 },
  cancelBtn: { flex: 1, backgroundColor: '#2a2a4e', paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  cancelText: { color: '#aaa', fontWeight: '600' },
  confirmBtn: { flex: 1, backgroundColor: '#e94560', paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  confirmText: { color: '#fff', fontWeight: '700' },
});
