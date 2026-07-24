import { useState, useEffect, useCallback, useRef, useMemo, memo, useSyncExternalStore } from "react";
import { Modal, TouchableOpacity } from "react-native";
import { YStack, XStack, Text, Input, ScrollView } from "../ui/primitives";
import { colors, fonts, fontWeights, iconSizes, radii } from "../ui/tokens";
import StatePanel from "../ui/StatePanel";
import Button from "../ui/Button";
import Icon from "../ui/Icon";
import { LABELS } from "../ui/labels";
import { ensureSkeletonKeyframes, SkeletonLine } from "../presentation/components/SkeletonPoster.web";
import { useApp, useChannels, useSearch } from "../context/AppContext";
import { useLiveTV } from "../domain/hooks/useLiveTV";
import { filterCategoriesBySearch } from "../domain/hooks/useLiveTV.helpers";
import { normalizeSearch } from "../utils/normalizeSearch.js";
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

/**
 * Per-screen EPG store: a stable external store (useSyncExternalStore) so a
 * channel's "now playing" title fetch re-renders only the one LiveCard that
 * subscribed to it, instead of churning a screen-level `epgCache` state that
 * re-rendered every mounted shelf once per fetch. The store identity is stable
 * for the screen's lifetime, so passing it through the shelves keeps their
 * props stable and lets memo(LiveShelf) bail. `get(sid)` is `undefined` until a
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

/* ─── Live Card ─── */
const LiveCard = memo(function LiveCard({ item, epgStore, onPress }) {
  const { addToMyList, removeFromMyList, isInMyList } = useApp();
  const abbrev = getAbbrev(item.name);
  const sid = item.stream_id || item.id;
  const inFav = isInMyList("live", sid);

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
      borderRadius={radii.sm}
      padding={ss(14)}
      position="relative"
      // Non-interactive container: the primary click target is a stretched
      // overlay below, and the favourite star is a separate button — so no
      // interactive element nests inside another.
      {...{ className: "suvo-live-card" }}
    >
      {/* Primary click target: a stretched overlay that makes the whole card
          keyboard-reachable and clickable, as a SIBLING of the star button.
          The star raises itself above this layer (zIndex) to stay pressable. */}
      <YStack
        position="absolute"
        top={0}
        left={0}
        right={0}
        bottom={0}
        cursor="pointer"
        onPress={() => onPress(item)}
        pressStyle={{ opacity: 0.6 }}
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
      />
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
        {/* Visually a 20px star, but the pressable spans a 44×44 hit area
            (transparent padding around the glyph) so the effective touch/pointer
            target clears the 44px floor. Negative margins keep row layout
            unchanged. */}
        <TouchableOpacity
          onPress={toggleFav}
          aria-label={inFav ? LABELS.removeFromMyList : LABELS.addToMyList}
          style={{
            width: Math.max(44, ss(44)),
            height: Math.max(44, ss(44)),
            marginVertical: ss(-12),
            marginLeft: ss(-10),
            alignItems: "center",
            justifyContent: "center",
            // Rise above the stretched primary-target overlay so the star
            // stays pressable (the overlay is an absolute sibling).
            position: "relative",
            zIndex: 1,
          }}
          {...{ onClick: (e) => e.stopPropagation() }}
        >
          <Icon
            name="star"
            size={ss(iconSizes.md)}
            color={inFav ? colors.accent : colors.muted}
          />
        </TouchableOpacity>
        {/* Label color overridden to AA-safe textDim on the surface2 card; the
            .suvo-live-dot CSS default (muted #7A86A8) fails AA at 10px. The
            success-green LIVE dot (::before) is untouched. */}
        <span className="suvo-live-dot" style={{ color: colors.textDim }}>LIVE</span>
      </XStack>
      {/* EPG "now playing" title, shown only when the provider returned real
          text. No program timing data exists, so we don't render a fake
          progress bar or a filler caption — an empty line is omitted entirely. */}
      {typeof epg === "string" && epg.trim() ? (
        <Text
          color={colors.textDim}
          fontSize={ss(13)}
          lineHeight={ss(18)}
          minHeight={ss(36)}
          numberOfLines={2}
        >
          {epg}
        </Text>
      ) : null}
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

/* ─── Live Shelf skeleton ─── */
// Loading placeholder that matches the live-card geometry (width 270, short
// card) so the shelf reserves the right footprint and swaps in with no layout
// shift — the same skeleton vocabulary as the poster rails, instead of a lone
// spinner. Reuses the shared sweep keyframes from SkeletonPoster.web.
function LiveShelfSkeleton() {
  ensureSkeletonKeyframes();
  return (
    <div
      aria-hidden="true"
      style={{
        display: "flex",
        gap: ss(8),
        paddingLeft: ss(48),
        paddingRight: ss(48),
        paddingTop: ss(10),
        paddingBottom: ss(10),
        overflow: "hidden",
      }}
    >
      {Array.from({ length: SHELF_PAGE }).map((_, i) => (
        <div
          key={i}
          style={{
            width: ss(270),
            height: ss(72),
            flexShrink: 0,
            borderRadius: ss(8),
            backgroundColor: colors.surface2,
            border: `1px solid ${colors.border}`,
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              background: `linear-gradient(100deg, transparent 20%, ${colors.surface} 50%, transparent 80%)`,
              animation: "_skel_sweep 1.4s ease-in-out infinite",
              willChange: "transform",
            }}
          />
        </div>
      ))}
    </div>
  );
}

/* ─── Live browse skeleton (initial load) ─── */
// The full-screen initial-load placeholder: a search-bar stand-in over a few
// title-line + live-rail rows, matching the real screen's chrome so content
// swaps in with no layout shift — the skeleton vocabulary the register asks for
// instead of a lone centered spinner.
function LiveBrowseSkeleton() {
  return (
    <YStack flex={1} backgroundColor={colors.bg} aria-hidden>
      <YStack maxWidth={MAX_W} width="100%" alignSelf="center">
        <XStack alignItems="center" paddingHorizontal={ss(48)} paddingVertical={ss(20)} gap={ss(10)}>
          <YStack flex={1}>
            <SkeletonLine width="100%" height={ss(44)} radius={radii.card} />
          </YStack>
          <SkeletonLine width={ss(96)} height={ss(44)} radius={radii.card} />
        </XStack>
        {[0, 1, 2].map((i) => (
          <YStack key={i} paddingTop={ss(18)}>
            <YStack paddingHorizontal={ss(48)} paddingBottom={ss(10)}>
              <SkeletonLine width={ss(200)} height={ss(20)} />
            </YStack>
            <LiveShelfSkeleton />
          </YStack>
        ))}
      </YStack>
    </YStack>
  );
}

/* ─── Live Shelf ─── */
// Memoized (like Movies/Series' ContentShelf) and threaded only the stable
// `epgStore` — not the whole EPG cache — so one channel's title fetch re-renders
// just its own subscribed LiveCard, never sibling shelves.
const LiveShelf = memo(function LiveShelf({ cat, onVisible, epgStore, onPress }) {
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
        <Icon name="tv" size={ss(iconSizes.md)} color={colors.muted} />
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
          <Text color={colors.muted} fontSize={ss(13)} fontWeight={fontWeights.medium}>
            {channels.length}
          </Text>
        )}
      </XStack>
      {displayed === null ? (
        <LiveShelfSkeleton />
      ) : (
        <div style={{ position: "relative" }} className="suvo-shelf-rail">
          <button
            className="suvo-shelf-nav"
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
              // overflow-x:auto clips the vertical axis too, cropping the cards'
              // hover glow top/bottom. Pad the scroll box so the glow has room to
              // paint, then cancel it with an equal negative margin so row layout
              // is unchanged.
              paddingTop: ss(20),
              paddingBottom: ss(20),
              marginTop: ss(-20),
              marginBottom: ss(-20),
              scrollbarWidth: "none",
              msOverflowStyle: "none",
              cursor: "grab",
            }}
          >
            {displayed.map((item) => (
              <LiveCard
                key={String(item.stream_id || item.id)}
                item={item}
                epgStore={epgStore}
                onPress={onPress}
              />
            ))}
          </div>
          <button
            className="suvo-shelf-nav right"
            onClick={() => scrollBy(800)}
            aria-label="Scroll right"
          >
            <Icon name="chevron-right" size={ss(iconSizes.lg)} color={colors.text} />
          </button>
        </div>
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
  // Locally-injected synthetic categories (currently just "Custom" for user-added
  // channels); the hook owns the provider category list, so custom entries live
  // here and are merged into the rendered list below.
  const [customCats, setCustomCats] = useState([]);
  const categories = useMemo(
    () => (customCats.length ? [...baseCategories, ...customCats] : baseCategories),
    [customCats, baseCategories],
  );
  const { setChannels } = useChannels();
  const { searchQuery, setSearchQuery } = useSearch();
  const [channelsByCategory, setChannelsByCategory] = useState({});
  // EPG lives in a stable external store (not screen state) so a title fetch
  // re-renders only the one subscribed LiveCard, never the shelf tree.
  const epgStore = useEpgStore(fetchEpgTitle);
  const [showAddChannel, setShowAddChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [newStreamUrl, setNewStreamUrl] = useState("");
  // Inline validation message for the Add-Channel sheet (empty fields / bad URL).
  const [addError, setAddError] = useState("");
  // Inline success confirmation on the Add-Channel sheet (replaces the raw OS
  // alert). Auto-dismisses after a beat so the dark-theater UI stays calm.
  const [addSuccess, setAddSuccess] = useState("");
  const successTimerRef = useRef(null);
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
  // Reset the ring to the first field (and clear any stale error) each time the
  // sheet opens.
  useEffect(() => { if (showAddChannel) { setSheetF(0); setAddError(""); setAddSuccess(""); } }, [showAddChannel]);
  // Clear the pending success-banner timer if the screen unmounts.
  useEffect(() => () => clearTimeout(successTimerRef.current), []);
  // Debounced normalized search term — keeps the filter off the keystroke path.
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const q = normalizeSearch(searchQuery);
    const t = setTimeout(() => setDebouncedQuery(q), 200);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const handleAddChannel = () => {
    const name = newChannelName.trim();
    const url = newStreamUrl.trim();
    setAddSuccess("");
    // Inline validation — Alert.alert is a no-op on web/Electron/TV, so an
    // empty or malformed submit would otherwise silently do nothing.
    if (!name || !url) {
      setAddError("Enter both a channel name and a stream URL.");
      return;
    }
    // Basic format guard: playable custom streams must be an http(s) URL.
    if (!/^https?:\/\/\S+$/i.test(url)) {
      setAddError("Stream URL must start with http:// or https://");
      return;
    }
    setAddError("");
    const ch = {
      name,
      _lc: normalizeSearch(name),
      url,
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
    setNewChannelName("");
    setNewStreamUrl("");
    // Keep the sheet open and confirm inline (react-native-web's Alert is a
    // no-op on web/TV anyway) — a brief success banner that fades on its own,
    // mirroring the inline error banner. Lets the user add more channels.
    setAddSuccess(`"${ch.name}" added to your Custom category.`);
    clearTimeout(successTimerRef.current);
    successTimerRef.current = setTimeout(() => setAddSuccess(""), 3500);
  };

  // Categories load is owned by useLiveTV (its own activeUserId effect). Here we
  // just reset the screen-local shelf state (EPG cache, per-category channels,
  // and the fetch queue) whenever the active account changes.
  useEffect(() => {
    epgStore.reset();
    setChannelsByCategory({});
    setCustomCats([]);
    loadedRef.current.clear();
    queueRef.current = [];
    activeRef.current = 0;
  }, [activeUserId, epgStore]);

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

  // While a search is active, eagerly load every category's channels so the
  // channel-name match spans ALL categories, not just the ones scrolled into
  // view. handleShelfVisible dedupes via loadedRef and the bounded queue caps
  // concurrency, so this is safe to call for every category each keystroke.
  useEffect(() => {
    if (!debouncedQuery) return;
    categories.forEach((cat) => handleShelfVisible(cat.id));
  }, [debouncedQuery, categories, handleShelfVisible]);

  // Derived shelves. Memoized on [categories, channelsByCategory, debouncedQuery]
  // so a keystroke that doesn't change the (debounced) query is a no-op, and the
  // filter reuses the names search-normalized once at load (item._lc).
  const displayCategories = useMemo(
    () =>
      filterCategoriesBySearch(
        categories,
        debouncedQuery,
        (cat) => channelsByCategory[cat.id],
      ),
    [categories, channelsByCategory, debouncedQuery],
  );

  if (loading) {
    return <LiveBrowseSkeleton />;
  }

  if (error) {
    return (
      <StatePanel
        mode="error"
        icon="tv"
        title="Couldn't load channels"
        message={errorMessage || "Check your connection or account and try again"}
        onRetry={loadChannels}
      />
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
            placeholderTextColor={colors.muted}
            aria-label="Search channels"
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
            epgStore={epgStore}
            onPress={handleChannelPress}
          />
        ))
      ) : (
        <YStack padding={ss(60)} alignItems="center">
          <Text color={colors.muted} fontSize={ss(15)}>
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
              borderTopLeftRadius: radii.lg,
              borderTopRightRadius: radii.lg,
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
              placeholderTextColor={colors.muted}
              aria-label="Channel name"
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
              placeholder="Stream URL (https://...)"
              placeholderTextColor={colors.muted}
              aria-label="Stream URL"
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
            <Text color={colors.textDim} fontSize={ss(12)} marginBottom={ss(20)}>
              Supported: HLS (.m3u8), DASH (.mpd), direct video
            </Text>
            {!!addError && (
              <XStack
                alignItems="center"
                gap={ss(8)}
                marginBottom={ss(16)}
                paddingVertical={ss(10)}
                paddingHorizontal={ss(12)}
                borderRadius={ss(10)}
                borderWidth={1}
                borderColor={colors.danger}
                backgroundColor={colors.surface}
              >
                <Icon name="warning" size={ss(iconSizes.sm)} color={colors.danger} />
                <Text color={colors.danger} fontSize={ss(13)} flex={1}>
                  {addError}
                </Text>
              </XStack>
            )}
            {!!addSuccess && (
              <XStack
                alignItems="center"
                gap={ss(8)}
                marginBottom={ss(16)}
                paddingVertical={ss(10)}
                paddingHorizontal={ss(12)}
                borderRadius={ss(10)}
                borderWidth={1}
                borderColor={colors.success}
                backgroundColor={colors.surface}
              >
                <Icon name="check" size={ss(iconSizes.sm)} color={colors.success} />
                <Text color={colors.success} fontSize={ss(13)} flex={1}>
                  {addSuccess}
                </Text>
              </XStack>
            )}
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
