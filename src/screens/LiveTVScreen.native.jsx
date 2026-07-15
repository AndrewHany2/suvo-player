import { useState, useEffect, useCallback, useRef, memo, useMemo } from "react";
import { FlatList, Modal, Alert, TouchableOpacity, RefreshControl } from "react-native";
import { Image } from "expo-image";
import { YStack, XStack, Text, Input } from "../ui/primitives";
import { colors, iconSizes, accentAlpha } from "../ui/tokens";
import StatePanel from "../ui/StatePanel";
import Button from "../ui/Button";
import Icon from "../ui/Icon";
import { useApp } from "../context/AppContext";
import { useLiveTV } from "../domain/hooks/useLiveTV";
import { filterCategoriesBySearch } from "../domain/hooks/useLiveTV.helpers";
import { isAuthError } from "../utils/authError";
import ContentShelf from "../presentation/components/ContentShelf.native";
import { isLowEndDevice } from "../utils/deviceTier";

// Low-end: drop the decorative progress bar + "now playing" label to shave a few
// views off every channel card (frozen at first read).
const LOW_END = isLowEndDevice();

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

  // Fetch EPG once per channel (keyed on sid); epg is only a "not yet loaded"
  // guard and fetchEpg is a stable prop, so neither belongs in the deps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (epg === undefined && fetchEpg) fetchEpg(sid); }, [sid]);

  const toggleFav = (e) => {
    e?.stopPropagation?.();
    if (inFav) removeFromMyList(`mylist_live_${sid}`);
    else addToMyList({ type: "live", streamId: sid, name: item.name, cover: item.logo || null, url: item.url });
  };

  return (
    <YStack
      width={160} backgroundColor={colors.surface2} borderWidth={1} borderColor={colors.border}
      borderRadius={10} padding={10} cursor="pointer"
      onPress={() => onPress(item)} pressStyle={{ opacity: 0.8 }} hoverStyle={{ borderColor: colors.accent }} animation="quick"
    >
      <XStack alignItems="center" gap={8} marginBottom={8}>
        {item.logo
          ? <Image source={item.logo} style={{ width: 28, height: 28, borderRadius: 5, backgroundColor: colors.bg }} contentFit="contain" cachePolicy="memory-disk" recyclingKey={item.logo} />
          : (
            <YStack width={28} height={28} borderRadius={5} backgroundColor={colors.surface} borderWidth={1} borderColor={colors.border} justifyContent="center" alignItems="center">
              <Text color={colors.accent} fontWeight="800" fontSize={10} letterSpacing={0.5}>{abbrev}</Text>
            </YStack>
          )}
        <Text color={colors.text} fontSize={12} fontWeight="600" flex={1} numberOfLines={1}>{item.name}</Text>
        {/* fav toggle — keep as RN TouchableOpacity for hitSlop support */}
        <TouchableOpacity onPress={toggleFav} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={{ color: inFav ? colors.accent : colors.faint, fontSize: 16, marginRight: 4 }}>{inFav ? "♥" : "♡"}</Text>
        </TouchableOpacity>
        <XStack alignItems="center" gap={4} backgroundColor={accentAlpha(0.15)} borderRadius={4} paddingHorizontal={6} paddingVertical={2} borderWidth={1} borderColor={accentAlpha(0.3)}>
          <YStack width={6} height={6} borderRadius={3} backgroundColor={colors.accent} />
          <Text color={colors.accent} fontSize={9} fontWeight="800" letterSpacing={0.5}>LIVE</Text>
        </XStack>
      </XStack>
      <Text color={colors.muted} fontSize={12} lineHeight={17} minHeight={34} numberOfLines={2}>{epg || " "}</Text>
      {!LOW_END && (
        <>
          <YStack height={3} backgroundColor={colors.border} borderRadius={2} marginTop={10}>
            <YStack width="35%" height="100%" backgroundColor={colors.accent} borderRadius={2} />
          </YStack>
          <Text color={colors.faint} fontSize={10} marginTop={7} letterSpacing={0.2}>Live · now playing</Text>
        </>
      )}
    </YStack>
  );
});

export default function LiveTVScreen({ navigation }) {
  const {
    loading,
    error,
    errorMessage,
    reload: loadChannels,
    activeUserId,
    categories: baseCategories,
    getFlatChannels,
    fetchEpgTitle,
    playChannel,
  } = useLiveTV({ navigation });
  const { setChannels, saveChannels } = useApp();
  const [refreshing, setRefreshing] = useState(false);
  // Locally-injected synthetic categories (currently just "Custom" for
  // user-added channels); the hook owns the provider category list.
  const [customCats, setCustomCats] = useState([]);
  const categories = useMemo(
    () => (customCats.length ? [...baseCategories, ...customCats] : baseCategories),
    [baseCategories, customCats],
  );
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
      const title = await fetchEpgTitle(streamId);
      setEpgCache((prev) => ({ ...prev, [streamId]: title }));
    } catch { setEpgCache((prev) => ({ ...prev, [streamId]: "" })); }
  }, [fetchEpgTitle]);

  const handleAddChannel = () => {
    if (!newChannelName.trim() || !newStreamUrl.trim()) {
      Alert.alert("Missing Fields", "Please enter both a channel name and stream URL.");
      return;
    }
    const ch = { name: newChannelName.trim(), url: newStreamUrl.trim(), id: Date.now().toString(), stream_id: Date.now().toString(), logo: null };
    setChannelsByCategory((prev) => ({ ...prev, Custom: [...(prev.Custom || []), ch] }));
    setCustomCats((prev) => prev.some((c) => c.id === "Custom") ? prev : [...prev, { id: "Custom", name: "Custom" }]);
    setChannels((prev) => [...prev, ch]);
    saveChannels();
    setNewChannelName(""); setNewStreamUrl(""); setShowAddChannel(false);
    Alert.alert("Channel Added", `"${ch.name}" added to Custom category.`);
  };

  // Categories load is owned by useLiveTV; reset screen-local shelf state when
  // the active account changes.
  useEffect(() => {
    setEpgCache({});
    setChannelsByCategory({});
    setCustomCats([]);
    loadedRef.current.clear();
  }, [activeUserId]);

  const loadChannelCategory = useCallback(async (catId) => {
    if (loadedRef.current.has(catId)) return;
    // Mark loaded BEFORE the await — the no-loop guard. A category whose fetch
    // fails below stays in loadedRef, so it is never re-fetched on its own; it
    // reloads only on account switch / pull-to-refresh (which clears the set).
    loadedRef.current.add(catId);
    try {
      // useLiveTV returns the flat card shape and caches the fetch.
      const formatted = await getFlatChannels(catId);
      setChannelsByCategory((prev) => ({ ...prev, [catId]: formatted }));
      setChannels((prev) => { const existingIds = new Set(prev.map((c) => String(c.stream_id))); return [...prev, ...formatted.filter((c) => !existingIds.has(String(c.stream_id)))]; });
    } catch (err) {
      // Auth failures (401/403) are account-level: useLiveTV trips its breaker
      // and surfaces the error panel, so don't add per-category log noise here.
      // Isolated failures just hide this category's rail (no retry, no loop).
      if (!isAuthError(err)) {
        console.warn(`LiveTV: channels for "${catId}" failed to load`, err);
      }
      setChannelsByCategory((prev) => ({ ...prev, [catId]: [] }));
    }
  }, [setChannels, getFlatChannels]);

  // Eagerly warm the first few shelves once the hook delivers categories
  // (the FlatList's onViewableItemsChanged loads the rest as they scroll in).
  useEffect(() => {
    baseCategories.slice(0, 3).forEach((c) => loadChannelCategory(c.id));
  }, [baseCategories, loadChannelCategory]);

  const handleRefresh = async () => {
    setRefreshing(true);
    loadedRef.current.clear();
    setChannelsByCategory({});
    try { await loadChannels(); } finally { setRefreshing(false); }
  };

  const handleChannelPress = playChannel;

  // While a search is active, eagerly load every category's channels so the
  // channel-name match spans ALL categories, not just the ones scrolled into
  // view. loadChannelCategory dedupes via loadedRef, so this fires each
  // category's fetch at most once.
  useEffect(() => {
    if (!searchQuery) return;
    categories.forEach((cat) => loadChannelCategory(cat.id));
  }, [searchQuery, categories, loadChannelCategory]);

  const displayCategories = filterCategoriesBySearch(
    categories,
    searchQuery,
    (cat) => channelsByCategory[cat.id],
  );

  if (loading) {
    return <StatePanel mode="loading" title="Loading channels..." />;
  }

  if (!activeUserId) {
    return (
      <StatePanel
        mode="empty"
        icon="tv"
        title="No account"
        message='Tap "Accounts" to add your media service'
        cta={() => navigation.navigate("Accounts")}
        ctaLabel="Add Account"
      />
    );
  }

  if (error) {
    return (
      <StatePanel
        mode="error"
        title="Couldn't load channels"
        message={errorMessage || "Check your connection and try again."}
        onRetry={loadChannels}
        retryLabel="Retry"
      />
    );
  }

  return (
    <YStack flex={1} backgroundColor={colors.bg}>
      <XStack alignItems="center" paddingHorizontal={16} paddingVertical={14} gap={10}>
        <XStack flex={1} alignItems="center" gap={8} backgroundColor={colors.surface2} borderRadius={10} paddingHorizontal={14} borderWidth={1} borderColor={colors.border}>
          <Icon name="search" size={iconSizes.sm} color={colors.muted} />
          <Input flex={1} placeholder="Search channels..." placeholderTextColor={colors.faint} value={searchQuery} onChangeText={setSearchQuery} backgroundColor="transparent" color={colors.text} paddingVertical={10} fontSize={14} />
        </XStack>
        <Button variant="primary" icon="plus" onPress={() => setShowAddChannel(true)}>Add</Button>
      </XStack>

      <FlatList
        data={displayCategories}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item: cat }) => (
          <ContentShelf
            id={cat.id}
            title={cat.name}
            count={cat.channels?.length ?? null}
            items={cat.channels}
            hasMore={false} loadingMore={false} manual={false}
            leadingIcon="tv"
            itemWidth={160} gap={8}
            onVisible={loadChannelCategory}
            onPress={handleChannelPress}
            renderItem={(channel) => (
              <ChannelCard
                item={channel}
                epg={epgCache[channel.stream_id || channel.id]}
                onPress={handleChannelPress}
                fetchEpg={fetchEpg}
              />
            )}
          />
        )}
        ListEmptyComponent={<YStack padding={60} alignItems="center"><Text color={colors.faint} fontSize={15}>No channels found</Text></YStack>}
        contentContainerStyle={{ paddingBottom: 60 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.accent} colors={[colors.accent]} />}
      />

      <Modal visible={showAddChannel} transparent animationType="slide" onRequestClose={() => setShowAddChannel(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }} activeOpacity={1} onPress={() => setShowAddChannel(false)}>
          <TouchableOpacity style={{ backgroundColor: colors.surface2, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, borderTopWidth: 1, borderColor: colors.border }} activeOpacity={1}>
            <Text color={colors.text} fontSize={17} fontWeight="700" marginBottom={16}>Add Custom Channel</Text>
            <Input placeholder="Channel name" placeholderTextColor={colors.faint} value={newChannelName} onChangeText={setNewChannelName} backgroundColor={colors.bg} color={colors.text} borderRadius={10} paddingHorizontal={14} paddingVertical={12} fontSize={14} borderWidth={1} borderColor={colors.border} marginBottom={12} />
            <Input placeholder="Stream URL (http://... or rtmp://...)" placeholderTextColor={colors.faint} value={newStreamUrl} onChangeText={setNewStreamUrl} autoCapitalize="none" keyboardType="url" backgroundColor={colors.bg} color={colors.text} borderRadius={10} paddingHorizontal={14} paddingVertical={12} fontSize={14} borderWidth={1} borderColor={colors.border} marginBottom={12} />
            <Text color={colors.faint} fontSize={12} marginBottom={20}>Supported: HLS (.m3u8), DASH (.mpd), direct video</Text>
            <XStack gap={12}>
              <Button variant="secondary" onPress={() => setShowAddChannel(false)} style={{ flex: 1 }}>Cancel</Button>
              <Button variant="primary" onPress={handleAddChannel} style={{ flex: 1 }}>Add Channel</Button>
            </XStack>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </YStack>
  );
}
