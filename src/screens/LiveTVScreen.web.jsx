import { useState, useEffect, useCallback, useRef } from "react";
import { Modal, Alert, TouchableOpacity } from "react-native";
import { YStack, XStack, Text, Input, ScrollView, Spinner } from "tamagui";
import { useApp } from "../context/AppContext";
import { ss } from "../utils/scaleSize";
import iptvApi from "../services/iptvApi";
import ProxiedImage from "../components/ProxiedImage";

const decodeEpgTitle = (title) => {
  try {
    return atob(title);
  } catch {
    return title;
  }
};
const getAbbrev = (name) => {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2)
    return (words[0].slice(0, 2) + words[1].slice(0, 1)).toUpperCase();
  return name.slice(0, 3).toUpperCase();
};

/* ─── Live Card ─── */
function LiveCard({ item, epg, onPress, fetchEpg }) {
  const { addToMyList, removeFromMyList, isInMyList } = useApp();
  const abbrev = getAbbrev(item.name);
  const sid = item.stream_id || item.id;
  const inFav = isInMyList("live", sid);

  useEffect(() => {
    if (epg === undefined && fetchEpg) fetchEpg(sid);
  }, [sid]);

  const toggleFav = (e) => {
    e?.stopPropagation?.();
    if (inFav) removeFromMyList(`mylist_live_${sid}`);
    else
      addToMyList({
        type: "live",
        streamId: sid,
        name: item.name,
        cover: item.logo || null,
        url: item.url,
      });
  };

  return (
    <YStack
      width={ss(270)}
      backgroundColor="#1a1a2e"
      borderWidth={1}
      borderColor="#2a2a4e"
      borderRadius={ss(8)}
      padding={ss(14)}
      cursor="pointer"
      onPress={() => onPress(item)}
      pressStyle={{ opacity: 0.8 }}
      hoverStyle={{ borderColor: "#e94560" }}
      animation="quick"
      {...{ className: "lumen-live-card" }}
    >
      <XStack alignItems="center" gap={ss(10)} marginBottom={ss(10)}>
        {item.logo ? (
          <ProxiedImage
            source={{ uri: item.logo }}
            style={{
              width: ss(40),
              height: ss(40),
              borderRadius: ss(6),
              backgroundColor: "#0f0f23",
            }}
            resizeMode="contain"
            fallbackColor="#16213e"
            showPlaceholder={false}
          />
        ) : (
          <YStack
            width={ss(40)}
            height={ss(40)}
            borderRadius={ss(6)}
            backgroundColor="#16213e"
            borderWidth={1}
            borderColor="#2a2a4e"
            justifyContent="center"
            alignItems="center"
          >
            <Text
              color="#e94560"
              fontWeight="800"
              fontSize={ss(12)}
              letterSpacing={0.5}
            >
              {abbrev}
            </Text>
          </YStack>
        )}
        <Text
          color="#fff"
          fontSize={ss(13)}
          fontWeight="600"
          flex={1}
          letterSpacing={0.1}
          numberOfLines={1}
        >
          {item.name}
        </Text>
        <TouchableOpacity
          onPress={toggleFav}
          {...{ onClick: (e) => e.stopPropagation() }}
        >
          <Text
            style={{
              color: inFav ? "#e94560" : "#555",
              fontSize: ss(16),
              marginRight: ss(6),
            }}
          >
            {inFav ? "♥" : "♡"}
          </Text>
        </TouchableOpacity>
        <span className="lumen-live-dot">LIVE</span>
      </XStack>
      <Text
        color="#bbb"
        fontSize={ss(13)}
        lineHeight={ss(18)}
        minHeight={ss(36)}
        numberOfLines={2}
      >
        {epg || " "}
      </Text>
      <YStack
        height={ss(3)}
        backgroundColor="#2a2a4e"
        borderRadius={ss(2)}
        marginTop={ss(10)}
      >
        <YStack
          width="35%"
          height="100%"
          backgroundColor="#e94560"
          borderRadius={ss(2)}
        />
      </YStack>
      <Text
        color="#666"
        fontSize={ss(11)}
        marginTop={ss(7)}
        letterSpacing={0.2}
      >
        Live · now playing
      </Text>
    </YStack>
  );
}

const SHELF_PAGE =
  typeof window !== "undefined"
    ? Math.ceil(window.innerWidth / ss(270)) + 2
    : 8;

/* ─── Live Shelf ─── */
function LiveShelf({ cat, onVisible, epgCache, fetchEpg, onPress }) {
  const sentinelRef = useRef(null);
  const railRef = useRef(null);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartLeft = useRef(0);
  const hasDragged = useRef(false);
  const channels = cat.channels;
  const [displayCount, setDisplayCount] = useState(SHELF_PAGE);

  useEffect(() => {
    setDisplayCount(SHELF_PAGE);
  }, [cat.id]);

  useEffect(() => {
    if (channels !== null) return;
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      onVisible(cat.id);
      return;
    }
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          obs.disconnect();
          onVisible(cat.id);
        }
      },
      { rootMargin: "300px 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [cat.id, channels, onVisible]);

  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const onMouseDown = (e) => {
      isDragging.current = true;
      hasDragged.current = false;
      dragStartX.current = e.pageX;
      dragStartLeft.current = el.scrollLeft;
      el.style.cursor = "grabbing";
    };
    const onMouseMove = (e) => {
      if (!isDragging.current) return;
      const dx = e.pageX - dragStartX.current;
      if (Math.abs(dx) > 4) {
        hasDragged.current = true;
        el.scrollLeft = dragStartLeft.current - dx;
      }
    };
    const onMouseUp = () => {
      isDragging.current = false;
      el.style.cursor = "grab";
    };
    const onClickCapture = (e) => {
      if (hasDragged.current) {
        hasDragged.current = false;
        e.stopPropagation();
        e.preventDefault();
      }
    };
    el.addEventListener("mousedown", onMouseDown);
    el.addEventListener("click", onClickCapture, true);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      el.removeEventListener("mousedown", onMouseDown);
      el.removeEventListener("click", onClickCapture, true);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [channels !== null]);

  if (channels !== null && !channels.length) return null;

  const displayed = channels ? channels.slice(0, displayCount) : null;
  const scrollBy = (delta) => {
    const el = railRef.current;
    if (el) el.scrollLeft = Math.max(0, el.scrollLeft + delta);
  };
  const handleScroll = (e) => {
    if (!channels || displayCount >= channels.length) return;
    const { scrollLeft, scrollWidth, clientWidth } = e.target;
    if (scrollWidth - scrollLeft - clientWidth < 600)
      setDisplayCount((c) => Math.min(c + SHELF_PAGE, channels.length));
  };

  return (
    <YStack paddingTop={ss(28)} paddingBottom={ss(20)} overflow="visible">
      <div ref={sentinelRef} style={{ height: 0 }} />
      <XStack
        alignItems="baseline"
        gap={ss(10)}
        paddingHorizontal={ss(48)}
        marginBottom={ss(14)}
      >
        <Text
          color="#fff"
          fontSize={ss(22)}
          fontWeight="700"
          letterSpacing={-0.2}
        >
          📺 {cat.name}
        </Text>
        {channels && (
          <Text color="#555" fontSize={ss(13)} fontWeight="500">
            {channels.length}
          </Text>
        )}
      </XStack>
      {displayed === null ? (
        <YStack paddingHorizontal={ss(48)} paddingVertical={ss(18)}>
          <Spinner size="small" color="#e94560" />
        </YStack>
      ) : (
        <div style={{ position: "relative" }} className="lumen-shelf-rail">
          <button className="lumen-shelf-nav" onClick={() => scrollBy(-800)}>
            ‹
          </button>
          <div
            ref={railRef}
            onScroll={handleScroll}
            style={{
              display: "flex",
              overflowX: "auto",
              gap: ss(8),
              paddingLeft: ss(48),
              paddingRight: ss(48),
              scrollbarWidth: "none",
              msOverflowStyle: "none",
              cursor: "grab",
            }}
          >
            {displayed.map((item) => {
              const sid = item.stream_id || item.id;
              return (
                <LiveCard
                  key={String(sid)}
                  item={item}
                  epg={epgCache[sid]}
                  onPress={onPress}
                  fetchEpg={fetchEpg}
                />
              );
            })}
          </div>
          <button
            className="lumen-shelf-nav right"
            onClick={() => scrollBy(800)}
          >
            ›
          </button>
        </div>
      )}
    </YStack>
  );
}

export default function LiveTVScreen({ navigation }) {
  const {
    users,
    activeUserId,
    channels,
    setChannels,
    saveChannels,
    playVideo,
  } = useApp();
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
    setEpgCache((prev) => {
      if (prev[streamId] !== undefined) return prev;
      return { ...prev, [streamId]: null };
    });
    try {
      const data = await iptvApi.getShortEpg(streamId, 1);
      const listing = data?.epg_listings?.[0];
      const title = listing ? decodeEpgTitle(listing.title) : "";
      setEpgCache((prev) => ({ ...prev, [streamId]: title }));
    } catch {
      setEpgCache((prev) => ({ ...prev, [streamId]: "" }));
    }
  }, []);

  const handleAddChannel = () => {
    if (!newChannelName.trim() || !newStreamUrl.trim()) {
      Alert.alert(
        "Missing Fields",
        "Please enter both a channel name and stream URL.",
      );
      return;
    }
    const ch = {
      name: newChannelName.trim(),
      url: newStreamUrl.trim(),
      id: Date.now().toString(),
      stream_id: Date.now().toString(),
      logo: null,
    };
    setChannelsByCategory((prev) => ({
      ...prev,
      Custom: [...(prev.Custom || []), ch],
    }));
    setCategories((prev) =>
      prev.some((c) => c.id === "Custom")
        ? prev
        : [...prev, { id: "Custom", name: "Custom" }],
    );
    setChannels((prev) => [...prev, ch]);
    saveChannels();
    setNewChannelName("");
    setNewStreamUrl("");
    setShowAddChannel(false);
    Alert.alert("Channel Added", `"${ch.name}" added to Custom category.`);
  };

  useEffect(() => {
    setEpgCache({});
    if (activeUserId) loadChannels();
  }, [activeUserId]);

  const handleShelfVisible = useCallback(async (catId) => {
    if (loadedRef.current.has(catId)) return;
    loadedRef.current.add(catId);
    try {
      const data = await iptvApi.getLiveStreamsByCategory(catId);
      const formatted = (data || []).map((ch) => ({
        name: ch.name,
        url: iptvApi.buildStreamUrl("live", ch.stream_id, "m3u8"),
        id: ch.stream_id,
        stream_id: ch.stream_id,
        logo: ch.stream_icon || null,
      }));
      setChannelsByCategory((prev) => ({ ...prev, [catId]: formatted }));
      setChannels((prev) => [...prev, ...formatted]);
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
      if (!cats?.length) {
        setLoading(false);
        return;
      }
      setCategories(
        cats.map((c) => ({ id: c.category_id, name: c.category_name })),
      );
    } catch (err) {
      console.error("Error loading channels:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleChannelPress = (item) => {
    playVideo({
      type: "live",
      streamId: item.stream_id || item.id,
      name: item.name,
      url: item.url,
    });
    navigation.navigate("VideoPlayer");
  };

  const displayCategories = searchQuery
    ? categories
        .map((cat) => ({
          ...cat,
          channels: (channelsByCategory[cat.id] || []).filter((ch) =>
            ch.name.toLowerCase().includes(searchQuery.toLowerCase()),
          ),
        }))
        .filter((cat) => cat.channels.length > 0)
    : categories.map((cat) => ({
        ...cat,
        channels: channelsByCategory[cat.id] ?? null,
      }));

  if (loading) {
    return (
      <YStack
        flex={1}
        justifyContent="center"
        alignItems="center"
        backgroundColor="#0f0f23"
        padding={ss(24)}
      >
        <Spinner size="large" color="#e94560" />
        <Text color="#aaa" marginTop={ss(12)} fontSize={ss(14)}>
          Loading channels...
        </Text>
      </YStack>
    );
  }

  if (!activeUserId) {
    return (
      <YStack
        flex={1}
        justifyContent="center"
        alignItems="center"
        backgroundColor="#0f0f23"
        padding={ss(24)}
      >
        <Text fontSize={ss(48)} marginBottom={ss(12)}>
          📡
        </Text>
        <Text
          color="#fff"
          fontSize={ss(18)}
          fontWeight="600"
          marginBottom={ss(8)}
        >
          No IPTV Account
        </Text>
        <Text
          color="#888"
          fontSize={ss(14)}
          textAlign="center"
          marginBottom={ss(20)}
        >
          Tap "Accounts" to add your IPTV service
        </Text>
        <YStack
          backgroundColor="#e94560"
          paddingHorizontal={ss(24)}
          paddingVertical={ss(12)}
          borderRadius={ss(10)}
          cursor="pointer"
          onPress={() => navigation.navigate("Accounts")}
          pressStyle={{ opacity: 0.9 }}
        >
          <Text color="#fff" fontWeight="600">
            Add Account
          </Text>
        </YStack>
      </YStack>
    );
  }

  return (
    <ScrollView
      flex={1}
      backgroundColor="#0f0f23"
      contentContainerStyle={{ paddingBottom: ss(60) }}
    >
      <XStack
        alignItems="center"
        paddingHorizontal={ss(48)}
        paddingVertical={ss(20)}
        gap={ss(10)}
      >
        <Input
          flex={1}
          placeholder="🔍 Search channels..."
          placeholderTextColor="#666"
          value={searchQuery}
          onChangeText={setSearchQuery}
          backgroundColor="#1a1a2e"
          color="#fff"
          paddingHorizontal={ss(14)}
          paddingVertical={ss(10)}
          borderRadius={ss(10)}
          fontSize={ss(14)}
          borderWidth={1}
          borderColor="#333"
        />
        <YStack
          backgroundColor="#e94560"
          borderRadius={ss(10)}
          paddingHorizontal={ss(16)}
          paddingVertical={ss(10)}
          cursor="pointer"
          onPress={() => setShowAddChannel(true)}
          pressStyle={{ opacity: 0.9 }}
        >
          <Text color="#fff" fontSize={ss(14)} fontWeight="700">
            + Add
          </Text>
        </YStack>
      </XStack>

      {displayCategories.length > 0 ? (
        displayCategories.map((cat) => (
          <LiveShelf
            key={cat.id}
            cat={cat}
            onVisible={handleShelfVisible}
            epgCache={epgCache}
            fetchEpg={fetchEpg}
            onPress={handleChannelPress}
          />
        ))
      ) : (
        <YStack padding={ss(60)} alignItems="center">
          <Text color="#666" fontSize={ss(15)}>
            No channels found
          </Text>
        </YStack>
      )}

      <Modal
        visible={showAddChannel}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAddChannel(false)}
      >
        <TouchableOpacity
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.6)",
            justifyContent: "flex-end",
          }}
          activeOpacity={1}
          onPress={() => setShowAddChannel(false)}
        >
          <TouchableOpacity
            style={{
              backgroundColor: "#1a1a2e",
              borderTopLeftRadius: ss(20),
              borderTopRightRadius: ss(20),
              padding: ss(24),
              borderTopWidth: 1,
              borderColor: "#2a2a4e",
            }}
            activeOpacity={1}
          >
            <Text
              color="#fff"
              fontSize={ss(17)}
              fontWeight="700"
              marginBottom={ss(16)}
            >
              Add Custom Channel
            </Text>
            <Input
              placeholder="Channel name"
              placeholderTextColor="#666"
              value={newChannelName}
              onChangeText={setNewChannelName}
              backgroundColor="#0f0f23"
              color="#fff"
              borderRadius={ss(10)}
              paddingHorizontal={ss(14)}
              paddingVertical={ss(12)}
              fontSize={ss(14)}
              borderWidth={1}
              borderColor="#333"
              marginBottom={ss(12)}
            />
            <Input
              placeholder="Stream URL (http://... or rtmp://...)"
              placeholderTextColor="#666"
              value={newStreamUrl}
              onChangeText={setNewStreamUrl}
              autoCapitalize="none"
              backgroundColor="#0f0f23"
              color="#fff"
              borderRadius={ss(10)}
              paddingHorizontal={ss(14)}
              paddingVertical={ss(12)}
              fontSize={ss(14)}
              borderWidth={1}
              borderColor="#333"
              marginBottom={ss(12)}
            />
            <Text color="#666" fontSize={ss(12)} marginBottom={ss(20)}>
              Supported: HLS (.m3u8), DASH (.mpd), direct video
            </Text>
            <XStack gap={ss(12)}>
              <YStack
                flex={1}
                backgroundColor="#2a2a4e"
                paddingVertical={ss(14)}
                borderRadius={ss(10)}
                alignItems="center"
                cursor="pointer"
                onPress={() => setShowAddChannel(false)}
                pressStyle={{ opacity: 0.8 }}
              >
                <Text color="#aaa" fontWeight="600">
                  Cancel
                </Text>
              </YStack>
              <YStack
                flex={1}
                backgroundColor="#e94560"
                paddingVertical={ss(14)}
                borderRadius={ss(10)}
                alignItems="center"
                cursor="pointer"
                onPress={handleAddChannel}
                pressStyle={{ opacity: 0.9 }}
              >
                <Text color="#fff" fontWeight="700">
                  Add Channel
                </Text>
              </YStack>
            </XStack>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </ScrollView>
  );
}
