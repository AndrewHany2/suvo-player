import { useRef, useEffect, useCallback, useState } from "react";
import { Image, View } from "react-native";
import { YStack, Text, ScrollView } from "../ui/primitives";
import { colors, fonts, fontWeights, overlay, heroHeights, zIndex } from "../ui/tokens";
import { formatEpisodeLabel } from "../utils/formatEpisodeLabel";
import Icon from "../ui/Icon";
import StatePanel from "../ui/StatePanel";
import HeroWeb from "../presentation/components/Hero.web";
import { LABELS } from "../ui/labels";
import { useApp } from "../context/AppContext";
import { useHistory } from "../domain/hooks/useHistory";
import { useDeferredRemove } from "../hooks/useDeferredRemove";
import { ss, useScale } from "../utils/scaleSize";
import MovieDetail from "../components/MovieDetail.web";
import SeriesDetail from "../components/SeriesDetail.web";

const FILL = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 };

// Caps the browse content width on ultrawide monitors (centered via margin auto).
const MAX_W = 1700;

function useDragScroll() {
  const railRef = useRef(null);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartLeft = useRef(0);
  const hasDragged = useRef(false);

  const attachRef = useCallback((el) => {
    railRef.current = el;
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
      // Only treat as a drag past a deliberate threshold — a few px of pointer
      // jitter during a click must NOT be eaten by the drag-to-scroll capture.
      if (Math.abs(dx) > 10) {
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
    el._cleanup = () => {
      el.removeEventListener("mousedown", onMouseDown);
      el.removeEventListener("click", onClickCapture, true);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  useEffect(() => () => railRef.current?._cleanup?.(), []);
  const scrollBy = (delta) => {
    const el = railRef.current;
    if (el) el.scrollLeft = Math.max(0, el.scrollLeft + delta);
  };
  return { railRef: attachRef, scrollBy };
}

const formatTimeLeft = (currentTime, duration) => {
  if (!duration || !currentTime) return null;
  const left = duration - currentTime;
  if (left <= 60) return null;
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
};

const getEpLabel = (item) => {
  if (item.type === "series" && item.seasonNum && item.episodeNum)
    return formatEpisodeLabel(item.seasonNum, item.episodeNum);
  return null;
};

/* ── Remove (×) affordance ──
   Visually a 22px scrim circle in the card corner, but the pressable spans a
   44×44 hit area (transparent padding around the circle) so a mis-tap is hard
   and the effective touch/pointer target clears the 44px floor. Announced to
   assistive tech as a "Remove" button and operable by keyboard. */
function RemoveButton({ onRemove }) {
  const handle = (e) => {
    e?.stopPropagation?.();
    onRemove();
  };
  return (
    <YStack
      position="absolute"
      top={0}
      left={0}
      zIndex={5}
      width={ss(44)}
      height={ss(44)}
      paddingTop={ss(8)}
      paddingLeft={ss(8)}
      cursor="pointer"
      onPress={handle}
      pressStyle={{ opacity: 0.7 }}
      role="button"
      aria-label="Remove"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handle(e);
        }
      }}
    >
      <View
        style={{
          width: ss(22),
          height: ss(22),
          borderRadius: ss(12),
          backgroundColor: overlay,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <Icon name="close" size={ss(11)} color={colors.text} />
      </View>
    </YStack>
  );
}

/* ── My List Poster Card ── */
function MyListCard({ item, onPress, onRemove }) {
  const poster = item.cover || item.movie_image || item.stream_icon || null;
  const epLabel = getEpLabel(item);

  return (
    <YStack
      width={ss(200)}
      flexShrink={0}
      cursor="pointer"
      onPress={onPress}
      pressStyle={{ opacity: 0.8 }}
      role="button"
      tabIndex={0}
      aria-label={item.name}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
          e.preventDefault();
          onPress?.();
        }
      }}
      {...{ className: "suvo-poster" }}
    >
      <YStack
        width={ss(200)}
        aspectRatio={2 / 3}
        borderRadius={ss(8)}
        backgroundColor={colors.surface}
        overflow="hidden"
        position="relative"
        borderWidth={1}
        borderColor={colors.border}
        {...{ className: "suvo-poster-box" }}
      >
        {poster ? (
          <Image source={{ uri: poster }} style={FILL} resizeMode="cover" />
        ) : (
          <View style={[FILL, { backgroundColor: colors.surface }]} />
        )}
        <RemoveButton onRemove={onRemove} />
      </YStack>
      <Text
        color={colors.text}
        fontFamily={fonts.body}
        fontSize={ss(13)}
        fontWeight={fontWeights.medium}
        marginTop={ss(8)}
        lineHeight={ss(17)}
        numberOfLines={2}
      >
        {item.name}
      </Text>
      {epLabel && (
        <Text
          color={colors.muted}
          fontFamily={fonts.body}
          fontSize={ss(10)}
          marginTop={ss(5)}
          letterSpacing={0.3}
        >
          {epLabel}
        </Text>
      )}
    </YStack>
  );
}

/* ── Continue Watching Card ── */
function CWCard({ item, onPress, onRemove }) {
  // Only show a resume bar when we know the real duration. If duration is
  // unknown, render no bar rather than fabricate a fake fill (matches LiveCard).
  const progress =
    item.duration > 0
      ? Math.min((item.currentTime / item.duration) * 100, 100)
      : null;
  const timeLeft = formatTimeLeft(item.currentTime, item.duration);
  const epLabel = getEpLabel(item);
  const seasonBadge = item.seasonNum ? `S${item.seasonNum}` : null;
  const bg = item.cover || item.movie_image || item.stream_icon || null;
  const showTitle = item.seriesName || item.name;
  const epTitle =
    item.seriesName && item.name !== item.seriesName ? item.name : null;

  return (
    <YStack
      width={ss(320)}
      flexShrink={0}
      cursor="pointer"
      onPress={onPress}
      pressStyle={{ opacity: 0.85 }}
      role="button"
      tabIndex={0}
      aria-label={showTitle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
          e.preventDefault();
          onPress?.();
        }
      }}
      {...{ className: "suvo-cw-card" }}
    >
      <YStack
        width={ss(320)}
        height={ss(180)}
        borderRadius={ss(8)}
        backgroundColor={colors.surface}
        overflow="hidden"
        position="relative"
        borderWidth={1}
        borderColor={colors.border}
        {...{ className: "suvo-poster-box" }}
      >
        {bg ? (
          <Image source={{ uri: bg }} style={FILL} resizeMode="cover" />
        ) : (
          <View style={[FILL, { backgroundColor: colors.surface }]} />
        )}
        <View
          style={[
            FILL,
            {
              background:
                "linear-gradient(to top right, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.1) 60%, rgba(0,0,0,0) 100%)",
            },
          ]}
        />
        {seasonBadge && (
          <YStack position="absolute" top={ss(10)} left={ss(12)} zIndex={4}>
            <Text color={colors.text} fontFamily={fonts.display} fontSize={ss(13)} fontWeight={fontWeights.bold}>
              {seasonBadge}
            </Text>
          </YStack>
        )}
        <RemoveButton onRemove={onRemove} />
        <div className="suvo-cw-play">
          <Icon name="play" size={ss(28)} color={colors.text} />
        </div>
        {progress != null && (
          <YStack
            position="absolute"
            left={0}
            right={0}
            bottom={0}
            zIndex={4}
            paddingHorizontal={ss(12)}
            paddingBottom={ss(10)}
          >
            <View
              style={{ height: ss(3), borderRadius: ss(2), backgroundColor: colors.border, overflow: "hidden" }}
            >
              <View
                style={{
                  height: "100%",
                  width: `${progress}%`,
                  backgroundColor: colors.accent,
                }}
              />
            </View>
          </YStack>
        )}
      </YStack>
      <YStack paddingTop={ss(10)} paddingHorizontal={ss(2)}>
        <Text
          color={colors.text}
          fontFamily={fonts.body}
          fontSize={ss(13)}
          fontWeight={fontWeights.medium}
          marginBottom={ss(2)}
          numberOfLines={1}
        >
          {showTitle}
        </Text>
        {(epLabel || epTitle) && (
          <Text
            color={colors.muted}
            fontFamily={fonts.body}
            fontSize={ss(12)}
            marginBottom={ss(2)}
            numberOfLines={1}
          >
            {[epLabel, epTitle].filter(Boolean).join(" · ")}
          </Text>
        )}
        {timeLeft && (
          <Text color={colors.muted} fontFamily={fonts.body} fontSize={ss(12)}>
            {timeLeft}
          </Text>
        )}
      </YStack>
    </YStack>
  );
}

export default function HistoryScreen({ navigation }) {
  const { activeUserId } = useApp();
  const {
    watchedHistory,
    removeFromWatchHistory,
    playLive,
    playVideoObject,
    myList,
    removeFromMyList,
  } = useHistory({ navigation });
  useScale(); // re-render + recompute ss() on window resize
  const fav$ = useDragScroll();
  const cw$ = useDragScroll();
  const [currentDetail, setCurrentDetail] = useState(null);

  // Deferred, undoable removal (shared with native via useDeferredRemove): a
  // remove doesn't hit the store immediately — with cross-device sync a mis-tap
  // would delete a resume position everywhere. The item is optimistically
  // hidden, a "Removed · Undo" snackbar shows, and the store call only commits
  // once the timer elapses (~5s). Undo cancels it.
  const commit = useCallback((p) => {
    if (!p) return;
    if (p.kind === "mylist") removeFromMyList(p.id);
    else removeFromWatchHistory(p.id);
  }, [removeFromMyList, removeFromWatchHistory]);
  const { pending, requestRemove, undoRemove } = useDeferredRemove(commit);

  const openDetail = (item) => {
    if (item.type === "live") {
      playLive(item);
      return;
    }
    // Transform history item to match detail screen expectations
    const detailItem = {
      ...item,
      stream_id: item.streamId,
      series_id: item.seriesId,
      movie_image: item.cover,
      stream_icon: item.cover,
    };
    setCurrentDetail(detailItem);
  };
  const closeDetail = () => setCurrentDetail(null);
  const handlePlay = (videoObj) => {
    playVideoObject(videoObj);
    setCurrentDetail(null);
  };

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

  if (currentDetail?.type === "movies")
    return (
      <MovieDetail
        item={currentDetail}
        onBack={closeDetail}
        onPlay={handlePlay}
      />
    );
  if (currentDetail?.type === "series")
    return (
      <SeriesDetail
        item={currentDetail}
        onBack={closeDetail}
        onPlayEpisode={handlePlay}
      />
    );

  if (myList.length === 0 && watchedHistory.length === 0) {
    return (
      <StatePanel
        mode="empty"
        icon="film"
        title={LABELS.emptyTitle}
        message={LABELS.emptyBody}
        cta={() => navigation.navigate("Movies")}
        ctaLabel={LABELS.emptyCta}
      />
    );
  }

  // Feature the most recent Continue-Watching title (or, failing that, the first
  // My-List title) as the cinematic entry point at the top of Home. Reaching this
  // point means at least one of the two lists is non-empty, so `featured` is set.
  const featured = watchedHistory[0] || myList[0] || null;
  const featuredResume = watchedHistory.length > 0;
  const heroTitle = featured ? featured.seriesName || featured.name : "";
  const heroBackdrop = featured
    ? featured.cover || featured.movie_image || featured.stream_icon || null
    : null;
  const heroMeta = featured
    ? [
        getEpLabel(featured),
        featuredResume
          ? formatTimeLeft(featured.currentTime, featured.duration)
          : null,
      ]
        .filter(Boolean)
        .join(" · ") || null
    : null;

  // Hide the item awaiting a deferred removal so the shelf reflects the pending
  // state instantly, while the store call is still held back (see requestRemove).
  const visibleMyList =
    pending?.kind === "mylist"
      ? myList.filter((i) => i.id !== pending.id)
      : myList;
  const visibleHistory =
    pending?.kind === "history"
      ? watchedHistory.filter((i) => i.id !== pending.id)
      : watchedHistory;

  return (
    <ScrollView
      flex={1}
      backgroundColor={colors.bg}
      contentContainerStyle={{ paddingTop: ss(40), paddingBottom: ss(80) }}
    >
      <YStack maxWidth={MAX_W} width="100%" alignSelf="center">
      {featured && (
        <HeroWeb
          backdrop={heroBackdrop}
          title={heroTitle}
          meta={heroMeta}
          continuityLabel="Synced across your devices"
          primaryLabel={featuredResume ? "Resume" : "Play"}
          onPrimary={() => openDetail(featured)}
          secondaryLabel="Browse library"
          onSecondary={() => navigation.navigate("Movies")}
          height={heroHeights.web}
        />
      )}
      {visibleMyList.length > 0 && (
        <YStack paddingBottom={ss(48)}>
          {/* Home shows the full My List inline here, so there's no see-all
              destination — no chevron affordance to avoid implying navigation
              that isn't wired. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: ss(6),
              paddingLeft: ss(48),
              paddingRight: ss(48),
              marginBottom: ss(20),
            }}
          >
            <Text
              color={colors.text}
              fontFamily={fonts.display}
              fontSize={ss(26)}
              fontWeight={fontWeights.bold}
              letterSpacing={-0.5}
            >
              {LABELS.myList}
            </Text>
          </div>
          <div style={{ position: "relative" }} className="suvo-shelf-rail">
            <button
              className="suvo-shelf-nav"
              onClick={() => fav$.scrollBy(-800)}
              aria-label="Scroll left"
            >
              <Icon name="back" size={ss(22)} color={colors.text} />
            </button>
            <div
              ref={fav$.railRef}
              style={{
                display: "flex",
                overflowX: "auto",
                gap: ss(12),
                paddingLeft: ss(48),
                paddingRight: ss(48),
                // Vertical breathing room so the hover ring/glow on a card isn't
                // clipped at the top/bottom by this scroller's overflow.
                paddingTop: ss(10),
                paddingBottom: ss(10),
                scrollbarWidth: "none",
                msOverflowStyle: "none",
                cursor: "grab",
              }}
            >
              {visibleMyList.map((item) => (
                <MyListCard
                  key={item.id}
                  item={item}
                  onPress={() => openDetail(item)}
                  onRemove={() => requestRemove({ kind: "mylist", id: item.id, name: item.name })}
                />
              ))}
            </div>
            <button
              className="suvo-shelf-nav right"
              onClick={() => fav$.scrollBy(800)}
              aria-label="Scroll right"
            >
              <Icon name="chevron-right" size={ss(22)} color={colors.text} />
            </button>
          </div>
        </YStack>
      )}

      {visibleHistory.length > 0 && (
        <YStack paddingBottom={ss(48)}>
          {/* Full list shown inline — no see-all chevron (see My List note). */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: ss(6),
              paddingLeft: ss(48),
              paddingRight: ss(48),
              marginBottom: ss(20),
            }}
          >
            <Text
              color={colors.text}
              fontFamily={fonts.display}
              fontSize={ss(26)}
              fontWeight={fontWeights.bold}
              letterSpacing={-0.5}
            >
              {LABELS.continueWatching}
            </Text>
          </div>
          <div style={{ position: "relative" }} className="suvo-shelf-rail">
            <button
              className="suvo-shelf-nav"
              onClick={() => cw$.scrollBy(-800)}
              aria-label="Scroll left"
            >
              <Icon name="back" size={ss(22)} color={colors.text} />
            </button>
            <div
              ref={cw$.railRef}
              style={{
                display: "flex",
                overflowX: "auto",
                gap: ss(12),
                paddingLeft: ss(48),
                paddingRight: ss(48),
                // Vertical breathing room so the hover ring/glow on a card isn't
                // clipped at the top/bottom by this scroller's overflow.
                paddingTop: ss(10),
                paddingBottom: ss(10),
                scrollbarWidth: "none",
                msOverflowStyle: "none",
                cursor: "grab",
              }}
            >
              {visibleHistory.map((item) => (
                <CWCard
                  key={item.id}
                  item={item}
                  onPress={() => openDetail(item)}
                  onRemove={() => requestRemove({ kind: "history", id: item.id, name: item.name })}
                />
              ))}
            </div>
            <button
              className="suvo-shelf-nav right"
              onClick={() => cw$.scrollBy(800)}
              aria-label="Scroll right"
            >
              <Icon name="chevron-right" size={ss(22)} color={colors.text} />
            </button>
          </div>
        </YStack>
      )}
      </YStack>
      {pending && (
        // Full-width, click-through row; only the pill itself is interactive.
        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: ss(32),
            zIndex: zIndex.toast,
            display: "flex",
            justifyContent: "center",
            paddingLeft: ss(16),
            paddingRight: ss(16),
            pointerEvents: "none",
          }}
        >
          <div
            role="status"
            aria-live="polite"
            style={{
              pointerEvents: "auto",
              display: "flex",
              alignItems: "center",
              gap: ss(8),
              maxWidth: "90vw",
              backgroundColor: colors.surface2,
              border: `1px solid ${colors.border}`,
              borderRadius: ss(12),
              paddingTop: ss(10),
              paddingBottom: ss(10),
              paddingLeft: ss(16),
              paddingRight: ss(8),
            }}
          >
            <Text
              color={colors.text}
              fontFamily={fonts.body}
              fontSize={ss(14)}
              numberOfLines={1}
            >
              Removed
            </Text>
            <button
              type="button"
              onClick={undoRemove}
              aria-label="Undo remove"
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                paddingTop: ss(6),
                paddingBottom: ss(6),
                paddingLeft: ss(12),
                paddingRight: ss(12),
                color: colors.accentText,
                fontFamily: fonts.body,
                fontSize: ss(14),
                fontWeight: fontWeights.bold,
              }}
            >
              Undo
            </button>
          </div>
        </div>
      )}
    </ScrollView>
  );
}
