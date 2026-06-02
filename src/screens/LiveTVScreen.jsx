import { useState, useEffect, useCallback, useRef, memo } from "react";
import { FlatList, Image, Modal, Alert, TouchableOpacity } from "react-native";
import { YStack, XStack, Text, Input, ScrollView, Spinner } from "tamagui";
import { useApp } from "../context/AppContext";
import iptvApi from "../services/iptvApi";

const decodeEpgTitle = (title) => { try { return atob(title); } catch { return title; } };
const getAbbrev = (name) => {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) return (words[0].slice(0, 2) + words[1].slice(0, 1)).toUpperCase();
  return name.slice(0, 3).toUpperCase();
};

/* ─── Live Channel Card ─── */
const ChannelCard = memo(({ item, epg, onPress, fetchEpg }) => {
  const { addToMyList, removeFromMyList, isInMyList } = useApp();
  const abbrev = getAbbrev(item.name);
  const sid = item.stream_id || item.id;
  const inFav = isInMyList("live", sid);

  useEffect(() => { if (epg === undefined && fetchEpg) fetchEpg(sid); }, [sid]);

  const toggleFav = (e) => {
    e?.stopPropagation?.();
    if (inFav) removeFromMyList(`mylist_live_${sid}`);
    else addToMyList({ type: "live", streamId: sid, name: item.name, cover: item.logo || null, url: item.url });
  };

  return (
    <YStack
      width={160} backgroundColor="#1a1a2e" borderWidth={1} borderColor="#2a2a4e"
      borderRadius={10} padding={10} cursor="pointer"
      onPress={() => onPress(item)} pressStyle={{ opacity: 0.8 }} hoverStyle={{ borderColor: "#e94560" }} animation="quick"
    >
      <XStack alignItems="center" gap={8} marginBottom={8}>
        {item.logo
          ? <Image source={{ uri: item.logo }} style={{ width: 28, height: 28, borderRadius: 5, backgroundColor: "#0f0f23" }} resizeMode="contain" />
          : (
            <YStack width={28} height={28} borderRadius={5} backgroundColor="#16213e" borderWidth={1} borderColor="#2a2a4e" justifyContent="center" alignItems="center">
              <Text color="#e94560" fontWeight="800" fontSize={10} letterSpacing={0.5}>{abbrev}</Text>
            </YStack>
          )}
        <Text color="#fff" fontSize={12} fontWeight="600" flex={1} numberOfLines={1}>{item.name}</Text>
        {/* fav toggle — keep as RN TouchableOpacity for hitSlop support */}
        <TouchableOpacity onPress={toggleFav} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={{ color: inFav ? "#e94560" : "#555", fontSize: 16, marginRight: 4 }}>{inFav ? "♥" : "♡"}</Text>
        </TouchableOpacity>
        <XStack alignItems="center" gap={4} backgroundColor="rgba(233,69,96,0.15)" borderRadius={4} paddingHorizontal={6} paddingVertical={2} borderWidth={1} borderColor="rgba(233,69,96,0.3)">
          <YStack width={6} height={6} borderRadius={3} backgroundColor="#e94560" />
          <Text color="#e94560" fontSize={9} fontWeight="800" letterSpacing={0.5}>LIVE</Text>
        </XStack>
      </XStack>
      <Text color="#bbb" fontSize={12} lineHeight={17} minHeight={34} numberOfLines={2}>{epg || " "}</Text>
      <YStack height={3} backgroundColor="#2a2a4e" borderRadius={2} marginTop={10}>
        <YStack width="35%" height="100%" backgroundColor="#e94560" borderRadius={2} />
      </YStack>
      <Text color="#666" fontSize={10} marginTop={7} letterSpacing={0.2}>Live · now playing</Text>
    </YStack>
  );
});

/* ─── Live Shelf ─── */
function LiveShelf({ cat, epgCache, fetchEpg, onPress }) {
  const channels = cat.channels;
  if (channels !== null && !channels.length) return null;
  return (
    <YStack paddingTop={8} paddingBottom={20}>
      <XStack alignItems="baseline" gap={10} paddingHorizontal={16} marginBottom={12}>
        <Text color="#fff" fontSize={18} fontWeight="700" letterSpacing={-0.2}>📺 {cat.name}</Text>
        {channels && <Text color="#555" fontSize={13} fontWeight="500">{channels.length}</Text>}
      </XStack>
      {channels === null ? (
        <YStack paddingHorizontal={16} paddingVertical={18}><Spinner size="small" color="#e94560" /></YStack>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
          {channels.map((item) => {
            const sid = item.stream_id || item.id;
            return <ChannelCard key={String(sid)} item={item} epg={epgCache[sid]} onPress={onPress} fetchEpg={fetchEpg} />;
          })}
        </ScrollView>
      )}
    </YStack>
  );
}

export default function LiveTVScreen({ navigation }) {
  const { users, activeUserId, channels, setChannels, saveChannels, playVideo } = useApp();
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState([]);
  const [channelsByCategory, setChannelsByCategory] = useState({});
  const [searchQuery, setSearchQuery] = useState("");
  const [epgCache, setEpgCache] = useState({});
  const [showAddChannel, setShowAddChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [newStreamUrl, setNewStreamUrl] = useState("");
  const loadedRef = useRef(new Set());

  const fetchEpg = useCallback(async (streamId) => {
    setEpgCache((prev) => { if (prev[streamId] !== undefined) return prev; return { ...prev, [streamId]: null }; });
    try {
      const data = await iptvApi.getShortEpg(streamId, 1);
      const listing = data?.epg_listings?.[0];
      const title = listing ? decodeEpgTitle(listing.title) : "";
      setEpgCache((prev) => ({ ...prev, [streamId]: title }));
    } catch { setEpgCache((prev) => ({ ...prev, [streamId]: "" })); }
  }, []);

  const handleAddChannel = () => {
    if (!newChannelName.trim() || !newStreamUrl.trim()) {
      Alert.alert("Missing Fields", "Please enter both a channel name and stream URL.");
      return;
    }
    const ch = { name: newChannelName.trim(), url: newStreamUrl.trim(), id: Date.now().toString(), stream_id: Date.now().toString(), logo: null };
    setChannelsByCategory((prev) => ({ ...prev, Custom: [...(prev.Custom || []), ch] }));
    setCategories((prev) => prev.some((c) => c.id === "Custom") ? prev : [...prev, { id: "Custom", name: "Custom" }]);
    setChannels((prev) => [...prev, ch]);
    saveChannels();
    setNewChannelName(""); setNewStreamUrl(""); setShowAddChannel(false);
    Alert.alert("Channel Added", `"${ch.name}" added to Custom category.`);
  };

  useEffect(() => { setEpgCache({}); if (activeUserId) loadChannels(); }, [activeUserId]);

  const loadChannelCategory = useCallback(async (catId) => {
    if (loadedRef.current.has(catId)) return;
    loadedRef.current.add(catId);
    try {
      const data = await iptvApi.getLiveStreamsByCategory(catId);
      const formatted = (data || []).map((ch) => ({ name: ch.name, url: iptvApi.buildStreamUrl("live", ch.stream_id, "m3u8"), id: ch.stream_id, stream_id: ch.stream_id, logo: ch.stream_icon || null }));
      setChannelsByCategory((prev) => ({ ...prev, [catId]: formatted }));
      setChannels((prev) => { const existingIds = new Set(prev.map((c) => String(c.stream_id))); return [...prev, ...formatted.filter((c) => !existingIds.has(String(c.stream_id)))]; });
    } catch { setChannelsByCategory((prev) => ({ ...prev, [catId]: [] })); }
  }, []);

  const loadChannels = async () => {
    const user = users.find((u) => u.id === activeUserId);
    if (!user) return;
    setLoading(true); loadedRef.current.clear(); setCategories([]); setChannelsByCategory({});
    try {
      iptvApi.setCredentials(user.host, user.username, user.password);
      const cats = await iptvApi.getLiveCategories();
      if (!cats?.length) { setLoading(false); return; }
      const catList = cats.map((c) => ({ id: c.category_id, name: c.category_name }));
      setCategories(catList);
      catList.slice(0, 3).forEach((c) => loadChannelCategory(c.id));
    } catch (err) { console.error("Error loading channels:", err); } finally { setLoading(false); }
  };

  const handleChannelPress = (item) => {
    playVideo({ type: "live", streamId: item.stream_id || item.id, name: item.name, url: item.url });
    navigation.navigate("VideoPlayer");
  };

  const displayCategories = searchQuery
    ? categories.map((cat) => ({ ...cat, channels: (channelsByCategory[cat.id] || []).filter((ch) => ch.name.toLowerCase().includes(searchQuery.toLowerCase())) })).filter((cat) => cat.channels.length > 0)
    : categories.map((cat) => ({ ...cat, channels: channelsByCategory[cat.id] ?? null }));

  if (loading) {
    return (
      <YStack flex={1} justifyContent="center" alignItems="center" backgroundColor="#0f0f23" padding={24}>
        <Spinner size="large" color="#e94560" />
        <Text color="#aaa" marginTop={12} fontSize={14}>Loading channels...</Text>
      </YStack>
    );
  }

  if (!activeUserId) {
    return (
      <YStack flex={1} justifyContent="center" alignItems="center" backgroundColor="#0f0f23" padding={24}>
        <Text fontSize={48} marginBottom={12}>📡</Text>
        <Text color="#fff" fontSize={18} fontWeight="600" marginBottom={8}>No IPTV Account</Text>
        <Text color="#888" fontSize={14} textAlign="center" marginBottom={20}>Tap "Accounts" to add your IPTV service</Text>
        <YStack backgroundColor="#e94560" paddingHorizontal={24} paddingVertical={12} borderRadius={10} cursor="pointer" onPress={() => navigation.navigate("Accounts")} pressStyle={{ opacity: 0.9 }}>
          <Text color="#fff" fontWeight="600">Add Account</Text>
        </YStack>
      </YStack>
    );
  }

  return (
    <YStack flex={1} backgroundColor="#0f0f23">
      <XStack alignItems="center" paddingHorizontal={16} paddingVertical={14} gap={10}>
        <Input flex={1} placeholder="🔍 Search channels..." placeholderTextColor="#666" value={searchQuery} onChangeText={setSearchQuery} backgroundColor="#1a1a2e" color="#fff" paddingHorizontal={14} paddingVertical={10} borderRadius={10} fontSize={14} borderWidth={1} borderColor="#333" />
        <YStack backgroundColor="#e94560" borderRadius={10} paddingHorizontal={16} paddingVertical={10} cursor="pointer" onPress={() => setShowAddChannel(true)} pressStyle={{ opacity: 0.9 }}>
          <Text color="#fff" fontSize={14} fontWeight="700">+ Add</Text>
        </YStack>
      </XStack>

      <FlatList
        data={displayCategories}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <LiveShelf cat={item} epgCache={epgCache} fetchEpg={fetchEpg} onPress={handleChannelPress} />
        )}
        onViewableItemsChanged={({ viewableItems }) => {
          viewableItems.forEach(({ item }) => { if (channelsByCategory[item.id] === undefined) loadChannelCategory(item.id); });
        }}
        viewabilityConfig={{ itemVisiblePercentThreshold: 10 }}
        ListEmptyComponent={<YStack padding={60} alignItems="center"><Text color="#666" fontSize={15}>No channels found</Text></YStack>}
        contentContainerStyle={{ paddingBottom: 60 }}
        showsVerticalScrollIndicator={false}
      />

      <Modal visible={showAddChannel} transparent animationType="slide" onRequestClose={() => setShowAddChannel(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }} activeOpacity={1} onPress={() => setShowAddChannel(false)}>
          <TouchableOpacity style={{ backgroundColor: "#1a1a2e", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, borderTopWidth: 1, borderColor: "#2a2a4e" }} activeOpacity={1}>
            <Text color="#fff" fontSize={17} fontWeight="700" marginBottom={16}>Add Custom Channel</Text>
            <Input placeholder="Channel name" placeholderTextColor="#666" value={newChannelName} onChangeText={setNewChannelName} backgroundColor="#0f0f23" color="#fff" borderRadius={10} paddingHorizontal={14} paddingVertical={12} fontSize={14} borderWidth={1} borderColor="#333" marginBottom={12} />
            <Input placeholder="Stream URL (http://... or rtmp://...)" placeholderTextColor="#666" value={newStreamUrl} onChangeText={setNewStreamUrl} autoCapitalize="none" keyboardType="url" backgroundColor="#0f0f23" color="#fff" borderRadius={10} paddingHorizontal={14} paddingVertical={12} fontSize={14} borderWidth={1} borderColor="#333" marginBottom={12} />
            <Text color="#666" fontSize={12} marginBottom={20}>Supported: HLS (.m3u8), DASH (.mpd), direct video</Text>
            <XStack gap={12}>
              <YStack flex={1} backgroundColor="#2a2a4e" paddingVertical={14} borderRadius={10} alignItems="center" cursor="pointer" onPress={() => setShowAddChannel(false)} pressStyle={{ opacity: 0.8 }}>
                <Text color="#aaa" fontWeight="600">Cancel</Text>
              </YStack>
              <YStack flex={1} backgroundColor="#e94560" paddingVertical={14} borderRadius={10} alignItems="center" cursor="pointer" onPress={handleAddChannel} pressStyle={{ opacity: 0.9 }}>
                <Text color="#fff" fontWeight="700">Add Channel</Text>
              </YStack>
            </XStack>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </YStack>
  );
}
