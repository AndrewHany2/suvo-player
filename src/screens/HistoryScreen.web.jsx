import { useRef, useEffect, useCallback, useState } from "react";
import { Image, View } from "react-native";
import { YStack, Text, ScrollView } from "tamagui";
import { useApp } from "../context/AppContext";
import { useTVNavigation } from "../hooks/useTVNavigation";
import { ss } from "../utils/scaleSize";
import MovieDetail from "../components/MovieDetail.web";
import SeriesDetail from "../components/SeriesDetail.web";

const FILL = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 };

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
      isDragging.current = true; hasDragged.current = false;
      dragStartX.current = e.pageX; dragStartLeft.current = el.scrollLeft;
      el.style.cursor = "grabbing";
    };
    const onMouseMove = (e) => {
      if (!isDragging.current) return;
      const dx = e.pageX - dragStartX.current;
      if (Math.abs(dx) > 4) { hasDragged.current = true; el.scrollLeft = dragStartLeft.current - dx; }
    };
    const onMouseUp = () => { isDragging.current = false; el.style.cursor = "grab"; };
    const onClickCapture = (e) => {
      if (hasDragged.current) { hasDragged.current = false; e.stopPropagation(); e.preventDefault(); }
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
function MyListCard({ item, onPress, onRemove, focused }) {
  const poster = item.cover || item.movie_image || item.stream_icon || null;
  const epLabel = getEpLabel(item);

  return (
    <YStack width={ss(200)} flexShrink={0} cursor="pointer" onPress={onPress} pressStyle={{ opacity: 0.8 }} hoverStyle={{ scale: 1.03 }} animation="quick" {...({ className: "lumen-poster" })}>
      <YStack width={ss(200)} aspectRatio={2 / 3} borderRadius={ss(8)} backgroundColor="#16213e" overflow="hidden" position="relative" borderWidth={2} borderColor={focused ? "#e94560" : "transparent"}>
        {poster
          ? <Image source={{ uri: poster }} style={FILL} resizeMode="cover" />
          : <View style={[FILL, { backgroundColor: "#16213e" }]} />}
        <YStack position="absolute" top={ss(8)} right={ss(8)} zIndex={4} backgroundColor="rgba(0,0,0,0.65)" borderRadius={ss(4)} paddingHorizontal={ss(5)} paddingVertical={ss(2)}>
          <Text color="#ccc" fontSize={ss(9)} fontWeight="700" letterSpacing={0.5}>HD</Text>
        </YStack>
        <YStack position="absolute" top={ss(8)} left={ss(8)} zIndex={5} backgroundColor="rgba(0,0,0,0.6)" borderRadius={ss(12)} width={ss(22)} height={ss(22)} justifyContent="center" alignItems="center" cursor="pointer" onPress={(e) => { e?.stopPropagation?.(); onRemove(); }} pressStyle={{ opacity: 0.7 }}>
          <Text color="#fff" fontSize={ss(9)} fontWeight="700">✕</Text>
        </YStack>
      </YStack>
      <Text color="#fff" fontSize={ss(13)} fontWeight="600" marginTop={ss(8)} lineHeight={ss(17)} numberOfLines={2}>{item.name}</Text>
      {epLabel && <Text color="#aaa" fontSize={ss(10)} marginTop={ss(5)} letterSpacing={0.3}>{epLabel}</Text>}
    </YStack>
  );
}

/* ── Continue Watching Card ── */
function CWCard({ item, onPress, onRemove, focused }) {
  const progress = item.duration > 0 ? Math.min((item.currentTime / item.duration) * 100, 100) : 15;
  const timeLeft = formatTimeLeft(item.currentTime, item.duration);
  const epLabel = getEpLabel(item);
  const seasonBadge = item.seasonNum ? `S${item.seasonNum}` : null;
  const bg = item.cover || item.movie_image || item.stream_icon || null;
  const showTitle = item.seriesName || item.name;
  const epTitle = item.seriesName && item.name !== item.seriesName ? item.name : null;

  return (
    <YStack width={ss(320)} flexShrink={0} cursor="pointer" onPress={onPress} pressStyle={{ opacity: 0.85 }} hoverStyle={{ scale: 1.02 }} animation="quick" {...({ className: "lumen-cw-card" })}>
      <YStack width={ss(320)} height={ss(180)} borderRadius={ss(8)} backgroundColor="#16213e" overflow="hidden" position="relative" borderWidth={2} borderColor={focused ? "#e94560" : "transparent"}>
        {bg
          ? <Image source={{ uri: bg }} style={FILL} resizeMode="cover" />
          : <View style={[FILL, { backgroundColor: "#16213e" }]} />}
        <View style={[FILL, { background: "linear-gradient(to top right, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.1) 60%, rgba(0,0,0,0) 100%)" }]} />
        {seasonBadge && (
          <YStack position="absolute" top={ss(10)} left={ss(12)} zIndex={4}>
            <Text color="#fff" fontSize={ss(13)} fontWeight="700">{seasonBadge}</Text>
          </YStack>
        )}
        <YStack position="absolute" top={ss(8)} left={ss(8)} zIndex={5} backgroundColor="rgba(0,0,0,0.6)" borderRadius={ss(12)} width={ss(22)} height={ss(22)} justifyContent="center" alignItems="center" cursor="pointer" onPress={(e) => { e?.stopPropagation?.(); onRemove(); }} pressStyle={{ opacity: 0.7 }}>
          <Text color="#fff" fontSize={ss(9)} fontWeight="700">✕</Text>
        </YStack>
        <div className="lumen-cw-play">▶</div>
        <YStack position="absolute" left={0} right={0} bottom={0} zIndex={4} paddingHorizontal={ss(12)}>
          <View style={{ height: ss(3), backgroundColor: "rgba(255,255,255,0.18)" }}>
            <View style={{ height: "100%", width: `${progress}%`, backgroundColor: "#e94560" }} />
          </View>
        </YStack>
      </YStack>
      <YStack paddingTop={ss(10)} paddingHorizontal={ss(2)}>
        <Text color="#fff" fontSize={ss(13)} fontWeight="600" marginBottom={ss(2)} numberOfLines={1}>{showTitle}</Text>
        {(epLabel || epTitle) && (
          <Text color="#888" fontSize={ss(12)} marginBottom={ss(2)} numberOfLines={1}>
            {[epLabel, epTitle].filter(Boolean).join(" · ")}
          </Text>
        )}
        {timeLeft && <Text color="#888" fontSize={ss(12)}>{timeLeft}</Text>}
      </YStack>
    </YStack>
  );
}

export default function HistoryScreen({ navigation }) {
  const { watchHistory, removeFromWatchHistory, playVideo, myList, removeFromMyList } = useApp();
  const fav$ = useDragScroll();
  const cw$ = useDragScroll();
  const [currentDetail, setCurrentDetail] = useState(null);

  const openDetail = (item) => {
    if (item.type === "live") { playVideo({ ...item, startTime: 0 }); navigation.navigate("VideoPlayer"); return; }
    setCurrentDetail(item);
  };
  const closeDetail = () => setCurrentDetail(null);
  const handlePlay = (videoObj) => { playVideo(videoObj); navigation.navigate("VideoPlayer"); setCurrentDetail(null); };

  const watchedHistory = watchHistory.filter((item) => item.type !== "live");

  const tvRows = [
    ...(myList.length > 0 ? [{ items: myList, onSelect: (i) => openDetail(myList[i]) }] : []),
    ...(watchedHistory.length > 0 ? [{ items: watchedHistory, onSelect: (i) => openDetail(watchedHistory[i]) }] : []),
  ];
  const myListRowIdx = myList.length > 0 ? 0 : -1;
  const historyRowIdx = watchedHistory.length > 0 ? (myList.length > 0 ? 1 : 0) : -1;
  const { focusedRow, focusedCol } = useTVNavigation({ active: !currentDetail, rows: tvRows });

  if (currentDetail?.type === "movies") return <MovieDetail item={currentDetail} onBack={closeDetail} onPlay={handlePlay} />;
  if (currentDetail?.type === "series") return <SeriesDetail item={currentDetail} onBack={closeDetail} onPlayEpisode={handlePlay} />;

  if (myList.length === 0 && watchedHistory.length === 0) {
    return (
      <YStack flex={1} justifyContent="center" alignItems="center" backgroundColor="#0f0f23" padding={ss(24)}>
        <Text fontSize={ss(48)} marginBottom={ss(12)}>🎬</Text>
        <Text color="#fff" fontSize={ss(20)} fontWeight="700" marginBottom={ss(8)}>Your list is empty</Text>
        <Text color="#888" fontSize={ss(14)} textAlign="center">Open a movie or series and tap ♡ Favorites to save it here</Text>
      </YStack>
    );
  }

  return (
    <ScrollView flex={1} backgroundColor="#0f0f23" contentContainerStyle={{ paddingTop: ss(40), paddingBottom: ss(80) }}>
      {myList.length > 0 && (
        <YStack paddingBottom={ss(48)}>
          <Text color="#fff" fontSize={ss(26)} fontWeight="700" letterSpacing={-0.5} paddingHorizontal={ss(48)} marginBottom={ss(20)}>Favorites</Text>
          <div style={{ position: "relative" }} className="lumen-shelf-rail">
            <button className="lumen-shelf-nav" onClick={() => fav$.scrollBy(-800)}>‹</button>
            <div ref={fav$.railRef} style={{ display: "flex", overflowX: "auto", gap: ss(12), paddingLeft: ss(48), paddingRight: ss(48), scrollbarWidth: "none", msOverflowStyle: "none", cursor: "grab" }}>
              {myList.map((item, idx) => (
                <MyListCard key={item.id} item={item} focused={focusedRow === myListRowIdx && focusedCol === idx} onPress={() => openDetail(item)} onRemove={() => removeFromMyList(item.id)} />
              ))}
            </div>
            <button className="lumen-shelf-nav right" onClick={() => fav$.scrollBy(800)}>›</button>
          </div>
        </YStack>
      )}

      {watchedHistory.length > 0 && (
        <YStack paddingBottom={ss(48)}>
          <Text color="#fff" fontSize={ss(26)} fontWeight="700" letterSpacing={-0.5} paddingHorizontal={ss(48)} marginBottom={ss(20)}>Watch History</Text>
          <div style={{ position: "relative" }} className="lumen-shelf-rail">
            <button className="lumen-shelf-nav" onClick={() => cw$.scrollBy(-800)}>‹</button>
            <div ref={cw$.railRef} style={{ display: "flex", overflowX: "auto", gap: ss(12), paddingLeft: ss(48), paddingRight: ss(48), scrollbarWidth: "none", msOverflowStyle: "none", cursor: "grab" }}>
              {watchedHistory.map((item, idx) => (
                <CWCard key={item.id} item={item} focused={focusedRow === historyRowIdx && focusedCol === idx} onPress={() => openDetail(item)} onRemove={() => removeFromWatchHistory(item.id)} />
              ))}
            </div>
            <button className="lumen-shelf-nav right" onClick={() => cw$.scrollBy(800)}>›</button>
          </div>
        </YStack>
      )}
    </ScrollView>
  );
}
