import { useRef, useEffect, useCallback, useState } from "react";
import { Image, View } from "react-native";
import { YStack, Text, ScrollView } from "../ui/primitives";
import { colors, fonts, fontWeights, overlay, radii } from "../ui/tokens";
import Icon from "../ui/Icon";
import StatePanel from "../ui/StatePanel";
import { useHistory } from "../domain/hooks/useHistory";
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
    return `S${item.seasonNum} · E${String(item.episodeNum).padStart(2, "0")}`;
  return null;
};

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
        <YStack
          position="absolute"
          top={ss(8)}
          right={ss(8)}
          zIndex={4}
          backgroundColor={overlay}
          borderRadius={ss(4)}
          paddingHorizontal={ss(5)}
          paddingVertical={ss(2)}
        >
          <Text
            color={colors.muted}
            fontFamily={fonts.body}
            fontSize={ss(9)}
            fontWeight={fontWeights.bold}
            letterSpacing={0.5}
          >
            HD
          </Text>
        </YStack>
        <YStack
          position="absolute"
          top={ss(8)}
          left={ss(8)}
          zIndex={5}
          backgroundColor={overlay}
          borderRadius={ss(12)}
          width={ss(22)}
          height={ss(22)}
          justifyContent="center"
          alignItems="center"
          cursor="pointer"
          onPress={(e) => {
            e?.stopPropagation?.();
            onRemove();
          }}
          pressStyle={{ opacity: 0.7 }}
        >
          <Icon name="close" size={ss(11)} color={colors.text} />
        </YStack>
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
  const progress =
    item.duration > 0
      ? Math.min((item.currentTime / item.duration) * 100, 100)
      : 15;
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
        <YStack
          position="absolute"
          top={ss(8)}
          left={ss(8)}
          zIndex={5}
          backgroundColor={overlay}
          borderRadius={ss(12)}
          width={ss(22)}
          height={ss(22)}
          justifyContent="center"
          alignItems="center"
          cursor="pointer"
          onPress={(e) => {
            e?.stopPropagation?.();
            onRemove();
          }}
          pressStyle={{ opacity: 0.7 }}
        >
          <Icon name="close" size={ss(11)} color={colors.text} />
        </YStack>
        <div className="suvo-cw-play">
          <Icon name="play" size={ss(28)} color={colors.text} />
        </div>
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
        title="Nothing here yet"
        message="Start watching something and it will appear here"
      />
    );
  }

  return (
    <ScrollView
      flex={1}
      backgroundColor={colors.bg}
      contentContainerStyle={{ paddingTop: ss(40), paddingBottom: ss(80) }}
    >
      <YStack maxWidth={MAX_W} width="100%" alignSelf="center">
      {myList.length > 0 && (
        <YStack paddingBottom={ss(48)}>
          <Text
            color={colors.text}
            fontFamily={fonts.display}
            fontSize={ss(26)}
            fontWeight={fontWeights.bold}
            letterSpacing={-0.5}
            paddingHorizontal={ss(48)}
            marginBottom={ss(20)}
          >
            My List
          </Text>
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
              {myList.map((item, idx) => (
                <MyListCard
                  key={item.id}
                  item={item}
                  onPress={() => openDetail(item)}
                  onRemove={() => removeFromMyList(item.id)}
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

      {watchedHistory.length > 0 && (
        <YStack paddingBottom={ss(48)}>
          <Text
            color={colors.text}
            fontFamily={fonts.display}
            fontSize={ss(26)}
            fontWeight={fontWeights.bold}
            letterSpacing={-0.5}
            paddingHorizontal={ss(48)}
            marginBottom={ss(20)}
          >
            Continue Watching
          </Text>
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
              {watchedHistory.map((item, idx) => (
                <CWCard
                  key={item.id}
                  item={item}
                  onPress={() => openDetail(item)}
                  onRemove={() => removeFromWatchHistory(item.id)}
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
    </ScrollView>
  );
}
