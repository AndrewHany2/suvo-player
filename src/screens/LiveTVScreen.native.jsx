import { useState, useEffect, useCallback, useRef, memo, useMemo, useSyncExternalStore, useDeferredValue } from "react";
import { FlatList, Modal, KeyboardAvoidingView, Platform, TouchableOpacity, RefreshControl, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { YStack, XStack, Text, Input } from "../ui/primitives";
import { colors, iconSizes, fonts, radii, zIndex } from "../ui/tokens";
import StatePanel from "../ui/StatePanel";
import { LABELS } from "../ui/labels";
import Button from "../ui/Button";
import Icon from "../ui/Icon";
import { useApp, useChannels } from "../context/AppContext";
import { useLiveTV } from "../domain/hooks/useLiveTV";
import { filterCategoriesBySearch } from "../domain/hooks/useLiveTV.helpers";
import { isAuthError } from "../utils/authError";
import { isConnectivityError } from "../utils/networkError.logic.js";
import { useIsOnline } from "../downloads/useIsOnline.js";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { ss } from "../utils/scaleSize";
import { posterShelfWidth } from "../utils/posterLayout";
import ContentShelf from "../presentation/components/ContentShelf.native";

// RN's <Modal> defaults supportedOrientations to ['portrait']; opening it while
// Live is landscape risks the UIKit SIGABRT the players guard against, so mirror
// the player modals' explicit orientation set.
const MODAL_ORIENTATIONS = ["portrait", "landscape"];

const getAbbrev = (name) => {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) return (words[0].slice(0, 2) + words[1].slice(0, 1)).toUpperCase();
  return name.slice(0, 3).toUpperCase();
};

/**
 * Per-screen EPG store: a stable external store (useSyncExternalStore) so a
 * channel's "now playing" title fetch re-renders only the one ChannelCard that
 * subscribed to it, instead of churning a screen-level `epgCache` state that
 * re-rendered the whole shelf tree once per fetch. The store identity is stable
 * for the screen's lifetime, so passing it through renderItem keeps that closure
 * stable and lets ContentShelf's memo bail. `get(sid)` is `undefined` until a
 * fetch starts, then `null` while loading, then the title (or "" on failure).
 */
function useEpgStore(fetchEpgTitle) {
  const fetchRef = useRef(fetchEpgTitle);
  fetchRef.current = fetchEpgTitle;
  const storeRef = useRef(null);
  if (storeRef.current === null) {
    const cache = new Map();
    const listeners = new Map();
    const notify = (sid) => { const s = listeners.get(sid); if (s) s.forEach((cb) => cb()); };
    storeRef.current = {
      get: (sid) => cache.get(sid),
      subscribe: (sid, cb) => {
        let s = listeners.get(sid);
        if (!s) { s = new Set(); listeners.set(sid, s); }
        s.add(cb);
        return () => { s.delete(cb); };
      },
      // Idempotent: guarded on cache.has so mounting/remounting a card never
      // re-fetches a channel already loaded (or in flight).
      fetch: (sid) => {
        if (cache.has(sid)) return;
        cache.set(sid, null);
        notify(sid);
        fetchRef.current(sid).then(
          (title) => { cache.set(sid, title); notify(sid); },
          () => { cache.set(sid, ""); notify(sid); },
        );
      },
      reset: () => {
        const sids = Array.from(cache.keys());
        cache.clear();
        sids.forEach(notify);
      },
    };
  }
  return storeRef.current;
}

/* ─── Live Channel Card ─── */
const ChannelCard = memo(({ item, width, epgStore, onPress, inFav, addToMyList, removeFromMyList }) => {
  const abbrev = getAbbrev(item.name);
  const sid = item.stream_id || item.id;

  // Subscribe only to THIS channel's EPG slice, so a neighbouring channel's
  // title landing doesn't re-render this card.
  const subscribe = useCallback((cb) => epgStore.subscribe(sid, cb), [epgStore, sid]);
  const getSnapshot = useCallback(() => epgStore.get(sid), [epgStore, sid]);
  const epg = useSyncExternalStore(subscribe, getSnapshot);

  // Fetch once per channel; store.fetch self-guards, so this is safe to run on
  // every mount/sid change without a "not yet loaded" flag.
  useEffect(() => { epgStore.fetch(sid); }, [epgStore, sid]);

  const toggleFav = (e) => {
    e?.stopPropagation?.();
    if (inFav) removeFromMyList(`mylist_live_${sid}`);
    else addToMyList({ type: "live", streamId: sid, name: item.name, cover: item.logo || null, url: item.url });
  };

  return (
    <YStack
      width={width} backgroundColor={colors.surface2} borderWidth={1} borderColor={colors.border}
      borderRadius={10} padding={10} cursor="pointer"
      onPress={() => onPress(item)} pressStyle={{ opacity: 0.8 }} hoverStyle={{ borderColor: colors.accent }} animation="quick"
      accessibilityRole="button" accessibilityLabel={`Play ${item.name}`}
    >
      <XStack alignItems="center" gap={8} marginBottom={8}>
        {item.logo
          ? <Image source={item.logo} style={{ width: 28, height: 28, borderRadius: 5, backgroundColor: colors.bg }} contentFit="contain" cachePolicy="memory-disk" recyclingKey={item.logo} />
          : (
            <YStack width={28} height={28} borderRadius={5} backgroundColor={colors.surface} borderWidth={1} borderColor={colors.border} justifyContent="center" alignItems="center">
              <Text color={colors.accentText} fontWeight="800" fontSize={10} letterSpacing={0.5}>{abbrev}</Text>
            </YStack>
          )}
        <Text color={colors.text} fontSize={12} fontWeight="600" flex={1} numberOfLines={1}>{item.name}</Text>
        {/* favorite toggle — Icon star (indigo/active vs muted/rest); keep as RN
            TouchableOpacity for hitSlop support */}
        <TouchableOpacity
          onPress={toggleFav}
          hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
          style={{ marginRight: 4 }}
          accessibilityRole="button"
          accessibilityLabel={inFav ? `Remove ${item.name} from My List` : `Add ${item.name} to My List`}
          accessibilityState={{ selected: inFav }}
        >
          <Icon name="star" size={iconSizes.sm} color={inFav ? colors.accent : colors.muted} />
        </TouchableOpacity>
        <XStack alignItems="center" gap={4} backgroundColor={colors.surface2} borderRadius={4} paddingHorizontal={6} paddingVertical={2} borderWidth={1} borderColor={colors.border}>
          <YStack width={6} height={6} borderRadius={3} backgroundColor={colors.accent} />
          <Text color={colors.accentText} fontSize={9} fontWeight="800" letterSpacing={0.5}>LIVE</Text>
        </XStack>
      </XStack>
      {epg ? <Text color={colors.muted} fontSize={12} lineHeight={17} numberOfLines={2}>{epg}</Text> : null}
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
  const { myList, isInMyList, addToMyList, removeFromMyList } = useApp();
  const { setChannels } = useChannels();
  const epgStore = useEpgStore(fetchEpgTitle);
  const online = useIsOnline();
  const reducedMotion = useReducedMotion();
  // Derive the channel card width from the screen (like ContentShelf's
  // posterShelfWidth) so Live shelves gain width/columns on tablets instead of
  // pinning to a fixed 160. Kept in sync with the ContentShelf itemWidth + gap
  // and the loading skeleton below.
  const { width: winW } = useWindowDimensions();
  const channelCardWidth = useMemo(
    () => posterShelfWidth(winW - ss(16) * 2, { target: 160, gap: ss(8) }),
    [winW],
  );
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
  const [showAddChannel, setShowAddChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [newStreamUrl, setNewStreamUrl] = useState("");
  const [addError, setAddError] = useState(null);
  // Categories whose channel fetch failed → render a retry rail instead of a
  // silently-empty shelf (distinct from a genuinely empty category).
  const [failedCats, setFailedCats] = useState({});
  // Transient success toast (mirrors History's inline Undo toast pattern).
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);
  const loadedRef = useRef(new Set());

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2600);
  }, []);
  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  const handleAddChannel = () => {
    const nm = newChannelName.trim();
    const url = newStreamUrl.trim();
    if (!nm || !url) {
      setAddError("Enter both a channel name and stream URL.");
      return;
    }
    // Require a real URL scheme so a bare host / typo doesn't get saved as a
    // channel that can never play.
    if (!/^(https?|rtmp):\/\//i.test(url)) {
      setAddError("Enter a valid stream URL starting with http://, https:// or rtmp://.");
      return;
    }
    const ch = { name: nm, url, id: Date.now().toString(), stream_id: Date.now().toString(), logo: null };
    setChannelsByCategory((prev) => ({ ...prev, Custom: [...(prev.Custom || []), ch] }));
    setCustomCats((prev) => prev.some((c) => c.id === "Custom") ? prev : [...prev, { id: "Custom", name: "Custom" }]);
    setChannels((prev) => [...prev, ch]);
    setNewChannelName(""); setNewStreamUrl(""); setAddError(null); setShowAddChannel(false);
    showToast(`"${ch.name}" added to Custom.`);
  };

  // Categories load is owned by useLiveTV; reset screen-local shelf state when
  // the active account changes.
  useEffect(() => {
    epgStore.reset();
    setChannelsByCategory({});
    setCustomCats([]);
    setFailedCats({});
    loadedRef.current.clear();
  }, [activeUserId, epgStore]);

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
      setFailedCats((prev) => (prev[catId] ? { ...prev, [catId]: false } : prev));
      setChannels((prev) => { const existingIds = new Set(prev.map((c) => String(c.stream_id))); return [...prev, ...formatted.filter((c) => !existingIds.has(String(c.stream_id)))]; });
    } catch (err) {
      // Auth failures (401/403) are account-level: useLiveTV trips its breaker
      // and surfaces the error panel, so don't add per-category log noise here.
      // Isolated failures flag the category so its rail shows a retry affordance
      // instead of silently vanishing.
      if (!isAuthError(err) && !isConnectivityError(err)) {
        console.warn(`LiveTV: channels for "${catId}" failed to load`, err);
      }
      setChannelsByCategory((prev) => ({ ...prev, [catId]: [] }));
      setFailedCats((prev) => ({ ...prev, [catId]: true }));
    }
  }, [setChannels, getFlatChannels]);

  // Retry a failed category: clear the load guard + failure flag, then re-fetch.
  const retryCategory = useCallback((catId) => {
    loadedRef.current.delete(catId);
    setFailedCats((prev) => (prev[catId] ? { ...prev, [catId]: false } : prev));
    loadChannelCategory(catId);
  }, [loadChannelCategory]);

  // Eagerly warm the first few shelves once the hook delivers categories
  // (the FlatList's onViewableItemsChanged loads the rest as they scroll in).
  useEffect(() => {
    baseCategories.slice(0, 3).forEach((c) => loadChannelCategory(c.id));
  }, [baseCategories, loadChannelCategory]);

  const handleRefresh = async () => {
    setRefreshing(true);
    loadedRef.current.clear();
    setChannelsByCategory({});
    setFailedCats({});
    try { await loadChannels(); } finally { setRefreshing(false); }
  };

  const handleChannelPress = playChannel;

  // Stable per-channel renderer for ContentShelf. Kept referentially stable
  // (all closed-over values are stable useCallbacks / the stable epgStore) so
  // ContentShelf's React.memo can bail — only `myList` bumps its identity, so a
  // favorite toggle re-renders the cards (to flip the star) but a category load
  // or an EPG fetch does not. inFav is computed here (isInMyList reads a ref)
  // rather than inside the card, so the card no longer subscribes to the whole
  // AppContext (which changes on every setChannels).
  const renderChannel = useCallback(
    (channel) => {
      const csid = channel.stream_id || channel.id;
      return (
        <ChannelCard
          item={channel}
          width={channelCardWidth}
          epgStore={epgStore}
          onPress={handleChannelPress}
          inFav={isInMyList("live", csid)}
          addToMyList={addToMyList}
          removeFromMyList={removeFromMyList}
        />
      );
    },
    // myList is an intentional dep: it forces a new renderer (and thus a star
    // refresh) when favorites change, since isInMyList reads a stable ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [epgStore, handleChannelPress, isInMyList, addToMyList, removeFromMyList, myList, channelCardWidth],
  );

  // Debounce the query that drives the eager fan-out load: a single keystroke
  // in a burst no longer fires a fetch for EVERY category. loadChannelCategory
  // still dedupes via loadedRef, so this only warms categories once search
  // settles (250ms idle).
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 250);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // While a search is active, eagerly load every category's channels so the
  // channel-name match spans ALL categories, not just the ones scrolled into
  // view. loadChannelCategory dedupes via loadedRef, so this fires each
  // category's fetch at most once.
  useEffect(() => {
    if (!debouncedQuery) return;
    categories.forEach((cat) => loadChannelCategory(cat.id));
  }, [debouncedQuery, categories, loadChannelCategory]);

  // filterCategoriesBySearch scans O(total channels) with an active query, so
  // memoize it (React 19 useDeferredValue keeps typing responsive by letting
  // the expensive filter lag a keystroke behind the input).
  const deferredQuery = useDeferredValue(searchQuery);
  const displayCategories = useMemo(
    () => filterCategoriesBySearch(categories, deferredQuery, (cat) => channelsByCategory[cat.id]),
    [categories, deferredQuery, channelsByCategory],
  );

  if (loading) {
    // Skeleton rails (a header spacer + a few placeholder shelves) read as the
    // real screen filling in, rather than a lone centered spinner.
    return (
      <YStack flex={1} backgroundColor={colors.bg}>
        <YStack paddingHorizontal={16} paddingVertical={14}>
          <YStack height={44} backgroundColor={colors.surface2} borderRadius={10} borderWidth={1} borderColor={colors.border} />
        </YStack>
        {[0, 1, 2].map((i) => (
          <ContentShelf key={i} id={`skeleton-${i}`} title="" items={null} manual hasMore={false} loadingMore={false} itemWidth={channelCardWidth} gap={ss(8)} />
        ))}
      </YStack>
    );
  }

  if (!activeUserId) {
    return (
      <StatePanel
        mode="empty"
        icon="tv"
        title={LABELS.noAccountTitle}
        message={LABELS.noAccountBody}
        cta={() => navigation.navigate("Accounts")}
        ctaLabel={LABELS.noAccountCta}
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
      {!online && (
        <YStack paddingVertical={8} paddingHorizontal={16} backgroundColor={colors.surface2} borderBottomWidth={1} borderBottomColor={colors.border}>
          <Text color={colors.muted} fontSize={13} fontWeight="600">You're offline — live channels need a connection.</Text>
        </YStack>
      )}
      <XStack alignItems="center" paddingHorizontal={16} paddingVertical={14} gap={10}>
        <XStack flex={1} alignItems="center" gap={8} backgroundColor={colors.surface2} borderRadius={10} paddingHorizontal={14} borderWidth={1} borderColor={colors.border}>
          <Icon name="search" size={iconSizes.sm} color={colors.muted} />
          <Input flex={1} placeholder="Search channels..." placeholderTextColor={colors.muted} value={searchQuery} onChangeText={setSearchQuery} backgroundColor="transparent" color={colors.text} paddingVertical={10} fontSize={14} />
        </XStack>
        <Button variant="primary" icon="plus" onPress={() => { setAddError(null); setShowAddChannel(true); }}>Add</Button>
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
            error={!!failedCats[cat.id]}
            onRetry={retryCategory}
            leadingIcon="tv"
            itemWidth={channelCardWidth} gap={ss(8)}
            onVisible={loadChannelCategory}
            onPress={handleChannelPress}
            renderItem={renderChannel}
          />
        )}
        ListEmptyComponent={<YStack padding={60} alignItems="center"><Text color={colors.muted} fontSize={15}>No channels found</Text></YStack>}
        contentContainerStyle={{ paddingBottom: 60 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.accent} colors={[colors.accent]} />}
      />

      <Modal visible={showAddChannel} transparent animationType={reducedMotion ? "none" : "slide"} supportedOrientations={MODAL_ORIENTATIONS} onRequestClose={() => setShowAddChannel(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
          <TouchableOpacity style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }} activeOpacity={1} accessible={false} onPress={() => setShowAddChannel(false)}>
            <TouchableOpacity style={{ backgroundColor: colors.surface2, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, borderTopWidth: 1, borderColor: colors.border }} activeOpacity={1} accessible={false} accessibilityViewIsModal>
              <Text color={colors.text} fontSize={17} fontWeight="700" marginBottom={16}>Add Custom Channel</Text>
              <Input placeholder="Channel name" placeholderTextColor={colors.muted} value={newChannelName} onChangeText={(t) => { setNewChannelName(t); if (addError) setAddError(null); }} backgroundColor={colors.bg} color={colors.text} borderRadius={10} paddingHorizontal={14} paddingVertical={12} fontSize={14} borderWidth={1} borderColor={colors.border} marginBottom={12} />
              <Input placeholder="Stream URL (http://... or rtmp://...)" placeholderTextColor={colors.muted} value={newStreamUrl} onChangeText={(t) => { setNewStreamUrl(t); if (addError) setAddError(null); }} autoCapitalize="none" keyboardType="url" backgroundColor={colors.bg} color={colors.text} borderRadius={10} paddingHorizontal={14} paddingVertical={12} fontSize={14} borderWidth={1} borderColor={colors.border} marginBottom={12} />
              <Text color={colors.textDim} fontSize={12} marginBottom={addError ? 8 : 20}>Supported: HLS (.m3u8), DASH (.mpd), direct video</Text>
              {addError && <Text color={colors.danger} fontSize={13} fontWeight="600" marginBottom={16}>{addError}</Text>}
              <XStack gap={12}>
                <Button variant="secondary" onPress={() => setShowAddChannel(false)} style={{ flex: 1 }}>Cancel</Button>
                <Button variant="primary" onPress={handleAddChannel} style={{ flex: 1 }}>Add Channel</Button>
              </XStack>
            </TouchableOpacity>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>

      {toast && (
        <YStack
          position="absolute" left={0} right={0} bottom={24} zIndex={zIndex.toast}
          alignItems="center" paddingHorizontal={16} pointerEvents="none"
        >
          <YStack
            accessibilityRole="alert"
            backgroundColor={colors.surface2} borderWidth={1} borderColor={colors.border} borderRadius={radii.md}
            paddingVertical={10} paddingHorizontal={16}
          >
            <Text color={colors.text} fontFamily={fonts.body} fontSize={14} numberOfLines={1}>{toast}</Text>
          </YStack>
        </YStack>
      )}
    </YStack>
  );
}
