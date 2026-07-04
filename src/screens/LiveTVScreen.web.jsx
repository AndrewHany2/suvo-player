import { useState, useEffect, useCallback, useRef, useMemo, memo } from "react";
import { Modal, Alert, TouchableOpacity } from "react-native";
import { YStack, XStack, Text, Input, ScrollView, Spinner } from "../ui/primitives";
import { colors, fonts, fontWeights, iconSizes } from "../ui/tokens";
import StatePanel from "../ui/StatePanel";
import Button from "../ui/Button";
import Icon from "../ui/Icon";
import { useApp } from "../context/AppContext";
import { useLiveTV } from "../domain/hooks/useLiveTV";
import { useModalKeyTrap } from "../hooks/useModalKeyTrap";
import { ss, useScale } from "../utils/scaleSize";
import ProxiedImage from "../components/ProxiedImage";

// Caps the browse content width so rows don't stretch edge-to-edge on ultrawide
// monitors. Centered via margin auto on the inner wrapper.
const MAX_W = 1700;

const getAbbrev = (name) => {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2)
    return (words[0].slice(0, 2) + words[1].slice(0, 1)).toUpperCase();
  return name.slice(0, 3).toUpperCase();
};

/* ─── Live Card ─── */
const LiveCard = memo(function LiveCard({ item, epg, onPress, fetchEpg }) {
  const { addToMyList, removeFromMyList, isInMyList } = useApp();
  const abbrev = getAbbrev(item.name);
  const sid = item.stream_id || item.id;
  const inFav = isInMyList("live", sid);

  // Fetch EPG once per channel (keyed on sid); epg is only a "not yet loaded"
  // guard and fetchEpg is a stable prop, so neither belongs in the deps.
  useEffect(() => {
    if (epg === undefined && fetchEpg) fetchEpg(sid);
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      backgroundColor={colors.surface2}
      borderWidth={1}
      borderColor={colors.border}
      borderRadius={ss(8)}
      padding={ss(14)}
      cursor="pointer"
      onPress={() => onPress(item)}
      pressStyle={{ opacity: 0.8 }}
      hoverStyle={{ borderColor: colors.accent }}
      animation="quick"
      // Real button semantics so keyboard/AT users can reach and fire the card.
      role="button"
      tabIndex={0}
      aria-label={item.name}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
          e.preventDefault();
          onPress(item);
        }
      }}
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
              backgroundColor: colors.bg,
            }}
            resizeMode="contain"
            fallbackColor={colors.surface}
            showPlaceholder={false}
          />
        ) : (
          <YStack
            width={ss(40)}
            height={ss(40)}
            borderRadius={ss(6)}
            backgroundColor={colors.surface}
            borderWidth={1}
            borderColor={colors.border}
            justifyContent="center"
            alignItems="center"
          >
            <Text
              color={colors.accent}
              fontWeight="800"
              fontSize={ss(12)}
              letterSpacing={0.5}
            >
              {abbrev}
            </Text>
          </YStack>
        )}
        <Text
          color={colors.text}
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
              color: inFav ? colors.accent : colors.faint,
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
        color={colors.muted}
        fontSize={ss(13)}
        lineHeight={ss(18)}
        minHeight={ss(36)}
        numberOfLines={2}
      >
        {epg || " "}
      </Text>
      <YStack
        height={ss(3)}
        backgroundColor={colors.border}
        borderRadius={ss(2)}
        marginTop={ss(10)}
      >
        <YStack
          width="35%"
          height="100%"
          backgroundColor={colors.accent}
          borderRadius={ss(2)}
        />
      </YStack>
      <Text
        color={colors.faint}
        fontSize={ss(11)}
        marginTop={ss(7)}
        letterSpacing={0.2}
      >
        Live · now playing
      </Text>
    </YStack>
  );
});

const SHELF_PAGE =
  typeof window !== "undefined"
    ? Math.ceil(window.innerWidth / ss(270)) + 2
    : 8;

// Max per-category channel fetches in flight at once. Shelves become "visible"
// (within the observer's 300px margin) faster than they load, so without a cap
// they all fire together and the provider rate-limits us into 403/503. A small
// FIFO queue drains them a few at a time, so the shelves already on screen load
// first and later ones follow as capacity frees up.
const SHELF_FETCH_CONCURRENCY = 3;
// Transient failures (esp. 503 under load) are retried a couple of times before
// the shelf is treated as genuinely empty, so a blip doesn't hide a category.
const SHELF_FETCH_RETRIES = 2;

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

  // Re-attach drag handlers once the shelf transitions from loading to loaded.
  const channelsLoaded = channels !== null;
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
  }, [channelsLoaded]);

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
        alignItems="center"
        gap={ss(10)}
        paddingHorizontal={ss(48)}
        marginBottom={ss(14)}
      >
        <Icon name="tv" size={ss(iconSizes.md)} color={colors.accent2} />
        <Text
          color={colors.text}
          fontFamily={fonts.display}
          fontSize={ss(22)}
          fontWeight={fontWeights.bold}
          letterSpacing={-0.2}
        >
          {cat.name}
        </Text>
        {channels && (
          <Text color={colors.faint} fontSize={ss(13)} fontWeight={fontWeights.medium}>
            {channels.length}
          </Text>
        )}
      </XStack>
      {displayed === null ? (
        <YStack paddingHorizontal={ss(48)} paddingVertical={ss(18)}>
          <Spinner size="small" color={colors.accent} />
        </YStack>
      ) : (
        <div style={{ position: "relative" }} className="lumen-shelf-rail">
          <button
            className="lumen-shelf-nav"
            onClick={() => scrollBy(-800)}
            aria-label="Scroll left"
          >
            <span style={{ display: "inline-flex", transform: "rotate(180deg)" }}>
              <Icon name="chevron-right" size={ss(iconSizes.lg)} color={colors.text} />
            </span>
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
            aria-label="Scroll right"
          >
            <Icon name="chevron-right" size={ss(iconSizes.lg)} color={colors.text} />
          </button>
        </div>
      )}
    </YStack>
  );
}

export default function LiveTVScreen({ navigation }) {
  const {
    loading,
    error,
    reload: loadChannels,
    activeUserId,
    categories: baseCategories,
    getFlatChannels,
    fetchEpgTitle,
    playChannel,
  } = useLiveTV({ navigation });
  // Locally-injected synthetic categories (currently just "Custom" for user-added
  // channels); the hook owns the provider category list, so custom entries live
  // here and are merged into the rendered list below.
  const [customCats, setCustomCats] = useState([]);
  const categories = useMemo(
    () => (customCats.length ? [...baseCategories, ...customCats] : baseCategories),
    [customCats, baseCategories],
  );
  const {
    setChannels,
    saveChannels,
    searchQuery,
    setSearchQuery,
  } = useApp();
  const [channelsByCategory, setChannelsByCategory] = useState({});
  const [epgCache, setEpgCache] = useState({});
  const [showAddChannel, setShowAddChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [newStreamUrl, setNewStreamUrl] = useState("");
  // Add-Channel sheet remote focus ring (TV): 0=name, 1=url, 2=Cancel, 3=Add.
  const [sheetFocus, setSheetFocus] = useState(0);
  const sheetFocusRef = useRef(0);
  const nameInputRef = useRef(null);
  const urlInputRef = useRef(null);
  const setSheetF = (i) => { sheetFocusRef.current = i; setSheetFocus(i); };
  const loadedRef = useRef(new Set());
  // Bounded FIFO queue for per-category channel fetches. `queueRef` holds
  // {catId, attempts} waiting for a slot; `activeRef` counts in-flight requests.
  const queueRef = useRef([]);
  const activeRef = useRef(0);
  // Re-render this screen (and recompute ss()) when the window resizes.
  useScale();
  // While the Add-Channel sheet is open, the remote drives ONLY the sheet: it
  // owns its own focus ring (name → url → Cancel/Add) and shields the shelves
  // behind it. Directional nav is TV-only; web/desktop keeps mouse + Esc-closes.
  const isTV = typeof globalThis !== "undefined" && globalThis.__TV__ === true;
  useModalKeyTrap(showAddChannel, {
    onBack: () => setShowAddChannel(false),
    ...(isTV
      ? {
          onUp: () => {
            const i = sheetFocusRef.current;
            if (i === 1) setSheetF(0);
            else if (i >= 2) setSheetF(1);
          },
          onDown: () => {
            const i = sheetFocusRef.current;
            if (i === 0) setSheetF(1);
            else if (i === 1) setSheetF(2);
          },
          onLeft: () => { if (sheetFocusRef.current === 3) setSheetF(2); },
          onRight: () => { if (sheetFocusRef.current === 2) setSheetF(3); },
          onEnter: () => {
            const i = sheetFocusRef.current;
            if (i === 0) nameInputRef.current?.focus();
            else if (i === 1) urlInputRef.current?.focus();
            else if (i === 2) setShowAddChannel(false);
            else handleAddChannel();
          },
        }
      : {}),
  });
  // Reset the ring to the first field each time the sheet opens.
  useEffect(() => { if (showAddChannel) setSheetF(0); }, [showAddChannel]);
  // Debounced lowercase search term — keeps the filter off the keystroke path.
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const q = searchQuery.trim().toLowerCase();
    const t = setTimeout(() => setDebouncedQuery(q), 200);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const fetchEpg = useCallback(async (streamId) => {
    setEpgCache((prev) => {
      if (prev[streamId] !== undefined) return prev;
      return { ...prev, [streamId]: null };
    });
    try {
      const title = await fetchEpgTitle(streamId);
      setEpgCache((prev) => ({ ...prev, [streamId]: title }));
    } catch {
      setEpgCache((prev) => ({ ...prev, [streamId]: "" }));
    }
  }, [fetchEpgTitle]);

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
      _lc: newChannelName.trim().toLowerCase(),
      url: newStreamUrl.trim(),
      id: Date.now().toString(),
      stream_id: Date.now().toString(),
      logo: null,
    };
    setChannelsByCategory((prev) => ({
      ...prev,
      Custom: [...(prev.Custom || []), ch],
    }));
    setCustomCats((prev) =>
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

  // Categories load is owned by useLiveTV (its own activeUserId effect). Here we
  // just reset the screen-local shelf state (EPG cache, per-category channels,
  // and the fetch queue) whenever the active account changes.
  useEffect(() => {
    setEpgCache({});
    setChannelsByCategory({});
    setCustomCats([]);
    loadedRef.current.clear();
    queueRef.current = [];
    activeRef.current = 0;
  }, [activeUserId]);

  // Fetch one category's channels. On failure, re-queue (up to SHELF_FETCH_RETRIES)
  // so a transient 503 under load doesn't permanently hide the shelf; only after
  // the retries are exhausted is it marked empty.
  const fetchShelf = useCallback(async (catId, attempts) => {
    try {
      // useLiveTV returns the flat card shape ({name,_lc,url,id,stream_id,logo})
      // and caches the fetch, so a re-visit is instant.
      const formatted = await getFlatChannels(catId);
      setChannelsByCategory((prev) => ({ ...prev, [catId]: formatted }));
      setChannels((prev) => [...prev, ...formatted]);
    } catch {
      if (attempts < SHELF_FETCH_RETRIES) {
        queueRef.current.push({ catId, attempts: attempts + 1 });
      } else {
        setChannelsByCategory((prev) => ({ ...prev, [catId]: [] }));
      }
    }
  }, [setChannels, getFlatChannels]);

  // Drain the queue up to SHELF_FETCH_CONCURRENCY in flight. Each completing
  // fetch pumps again, so slots free up in FIFO order — the shelves that became
  // visible first (already on screen) load ahead of ones scrolled past later.
  const pumpQueue = useCallback(() => {
    while (activeRef.current < SHELF_FETCH_CONCURRENCY && queueRef.current.length) {
      const { catId, attempts } = queueRef.current.shift();
      activeRef.current += 1;
      fetchShelf(catId, attempts).finally(() => {
        activeRef.current -= 1;
        pumpQueue();
      });
    }
  }, [fetchShelf]);

  const handleShelfVisible = useCallback((catId) => {
    if (loadedRef.current.has(catId)) return;
    loadedRef.current.add(catId);
    queueRef.current.push({ catId, attempts: 0 });
    pumpQueue();
  }, [pumpQueue]);

  const handleChannelPress = playChannel;

  // Derived shelves. Memoized on [categories, channelsByCategory, debouncedQuery]
  // so a keystroke that doesn't change the (debounced) query is a no-op, and the
  // filter reuses the names lowercased once at load (item._lc).
  const displayCategories = useMemo(
    () =>
      debouncedQuery
        ? categories
            .map((cat) => ({
              ...cat,
              channels: (channelsByCategory[cat.id] || []).filter((ch) =>
                (ch._lc ?? ch.name.toLowerCase()).includes(debouncedQuery),
              ),
            }))
            .filter((cat) => cat.channels.length > 0)
        : categories.map((cat) => ({
            ...cat,
            channels: channelsByCategory[cat.id] ?? null,
          })),
    [categories, channelsByCategory, debouncedQuery],
  );

  if (loading) {
    return <StatePanel mode="loading" title="Loading channels..." />;
  }

  if (error) {
    return (
      <StatePanel
        mode="error"
        icon="tv"
        title="Couldn't load channels"
        message="Check your connection or IPTV account and try again"
        onRetry={loadChannels}
      />
    );
  }

  if (!activeUserId) {
    return (
      <StatePanel
        mode="empty"
        icon="tv"
        title="No IPTV Account"
        message='Tap "Accounts" to add your IPTV service'
        cta={() => navigation.navigate("Accounts")}
        ctaLabel="Add Account"
      />
    );
  }

  return (
    <ScrollView
      flex={1}
      backgroundColor={colors.bg}
      contentContainerStyle={{ paddingBottom: ss(60) }}
    >
      <YStack
        maxWidth={MAX_W}
        width="100%"
        alignSelf="center"
        {...(showAddChannel ? { inert: "", "aria-hidden": true } : {})}
      >
      <XStack
        alignItems="center"
        paddingHorizontal={ss(48)}
        paddingVertical={ss(20)}
        gap={ss(10)}
      >
        <XStack
          flex={1}
          alignItems="center"
          gap={ss(8)}
          backgroundColor={colors.surface2}
          borderRadius={ss(10)}
          paddingHorizontal={ss(14)}
          borderWidth={1}
          borderColor={colors.border}
        >
          <Icon name="search" size={ss(iconSizes.sm)} color={colors.muted} />
          <Input
            flex={1}
            placeholder="Search channels..."
            placeholderTextColor={colors.faint}
            value={searchQuery}
            onChangeText={setSearchQuery}
            backgroundColor="transparent"
            color={colors.text}
            paddingVertical={ss(10)}
            fontSize={ss(14)}
          />
        </XStack>
        <Button variant="primary" icon="plus" onPress={() => setShowAddChannel(true)}>
          Add
        </Button>
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
          <Text color={colors.faint} fontSize={ss(15)}>
            No channels found
          </Text>
        </YStack>
      )}
      </YStack>

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
              backgroundColor: colors.surface2,
              borderTopLeftRadius: ss(20),
              borderTopRightRadius: ss(20),
              padding: ss(24),
              borderTopWidth: 1,
              borderColor: colors.border,
            }}
            activeOpacity={1}
          >
            <Text
              color={colors.text}
              fontSize={ss(17)}
              fontWeight="700"
              marginBottom={ss(16)}
            >
              Add Custom Channel
            </Text>
            <Input
              ref={nameInputRef}
              placeholder="Channel name"
              placeholderTextColor={colors.faint}
              value={newChannelName}
              onChangeText={setNewChannelName}
              backgroundColor={colors.bg}
              color={colors.text}
              borderRadius={ss(10)}
              paddingHorizontal={ss(14)}
              paddingVertical={ss(12)}
              fontSize={ss(14)}
              borderWidth={isTV && sheetFocus === 0 ? 2 : 1}
              borderColor={isTV && sheetFocus === 0 ? colors.accent2 : colors.border}
              marginBottom={ss(12)}
            />
            <Input
              ref={urlInputRef}
              placeholder="Stream URL (http://... or rtmp://...)"
              placeholderTextColor={colors.faint}
              value={newStreamUrl}
              onChangeText={setNewStreamUrl}
              autoCapitalize="none"
              backgroundColor={colors.bg}
              color={colors.text}
              borderRadius={ss(10)}
              paddingHorizontal={ss(14)}
              paddingVertical={ss(12)}
              fontSize={ss(14)}
              borderWidth={isTV && sheetFocus === 1 ? 2 : 1}
              borderColor={isTV && sheetFocus === 1 ? colors.accent2 : colors.border}
              marginBottom={ss(12)}
            />
            <Text color={colors.faint} fontSize={ss(12)} marginBottom={ss(20)}>
              Supported: HLS (.m3u8), DASH (.mpd), direct video
            </Text>
            <XStack gap={ss(12)}>
              <Button
                variant="secondary"
                onPress={() => setShowAddChannel(false)}
                isFocused={isTV && sheetFocus === 2}
                style={{ flex: 1 }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onPress={handleAddChannel}
                isFocused={isTV && sheetFocus === 3}
                style={{ flex: 1 }}
              >
                Add Channel
              </Button>
            </XStack>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </ScrollView>
  );
}
