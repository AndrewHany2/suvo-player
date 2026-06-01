import { useRef, useEffect, useCallback, useState } from "react";
import { Image, View } from "react-native";
import { YStack, Text, ScrollView } from "tamagui";
import { useApp } from "../context/AppContext";
import { useTVNavigation } from "../hooks/useTVNavigation";
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
    <YStack width={200} cursor="pointer" onPress={onPress} pressStyle={{ opacity: 0.8 }} hoverStyle={{ scale: 1.03 }} animation="quick" {...({ className: "lumen-poster" })}>
      <YStack width={200} aspectRatio={2 / 3} borderRadius={8} backgroundColor="#16213e" overflow="hidden" borderWidth={2} borderColor={focused ? "#e94560" : "transparent"}>
        {poster
          ? <Image source={{ uri: poster }} style={FILL} resizeMode="cover" />
          : <View style={[FILL, { backgroundColor: "#16213e" }]} />}
        <YStack position="absolute" top={8} right={8} zIndex={4} backgroundColor="rgba(0,0,0,0.65)" borderRadius={4} paddingHorizontal={5} paddingVertical={2}>
          <Text color="#ccc" fontSize={9} fontWeight="700" letterSpacing={0.5}>HD</Text>
        </YStack>
        <YStack position="absolute" top={8} left={8} zIndex={5} backgroundColor="rgba(0,0,0,0.6)" borderRadius={12} width={22} height={22} justifyContent="center" alignItems="center" cursor="pointer" onPress={(e) => { e?.stopPropagation?.(); onRemove(); }} pressStyle={{ opacity: 0.7 }}>
          <Text color="#fff" fontSize={9} fontWeight="700">✕</Text>
        </YStack>
      </YStack>
      <Text color="#fff" fontSize={13} fontWeight="600" marginTop={8} lineHeight={17} numberOfLines={2}>{item.name}</Text>
      {epLabel && <Text color="#aaa" fontSize={10} marginTop={5} letterSpacing={0.3}>{epLabel}</Text>}
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
    <YStack width={320} cursor="pointer" onPress={onPress} pressStyle={{ opacity: 0.85 }} hoverStyle={{ scale: 1.02 }} animation="quick" {...({ className: "lumen-cw-card" })}>
      <YStack width={320} height={180} borderRadius={8} backgroundColor="#16213e" overflow="hidden" borderWidth={2} borderColor={focused ? "#e94560" : "transparent"}>
        {bg
          ? <Image source={{ uri: bg }} style={FILL} resizeMode="cover" />
          : <View style={[FILL, { backgroundColor: "#16213e" }]} />}
        {/* CSS gradient — keep as raw View */}
        <View style={[FILL, { background: "linear-gradient(to top right, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.1) 60%, rgba(0,0,0,0) 100%)" }]} />
        {seasonBadge && (
          <YStack position="absolute" top={10} left={12} zIndex={4}>
            <Text color="#fff" fontSize={13} fontWeight="700">{seasonBadge}</Text>
          </YStack>
        )}
        <YStack position="absolute" top={8} left={8} zIndex={5} backgroundColor="rgba(0,0,0,0.6)" borderRadius={12} width={22} height={22} justifyContent="center" alignItems="center" cursor="pointer" onPress={(e) => { e?.stopPropagation?.(); onRemove(); }} pressStyle={{ opacity: 0.7 }}>
          <Text color="#fff" fontSize={9} fontWeight="700">✕</Text>
        </YStack>
        <div className="lumen-cw-play">▶</div>
        {/* Progress bar — keep as RN Views for % string width */}
        <YStack position="absolute" left={0} right={0} bottom={0} zIndex={4} paddingHorizontal={12}>
          <View style={{ height: 3, backgroundColor: "rgba(255,255,255,0.18)" }}>
            <View style={{ height: "100%", width: `${progress}%`, backgroundColor: "#e94560" }} />
          </View>
        </YStack>
      </YStack>
      <YStack paddingTop={10} paddingHorizontal={2}>
        <Text color="#fff" fontSize={13} fontWeight="600" marginBottom={2} numberOfLines={1}>{showTitle}</Text>
        {(epLabel || epTitle) && (
          <Text color="#888" fontSize={12} marginBottom={2} numberOfLines={1}>
            {[epLabel, epTitle].filter(Boolean).join(" · ")}
          </Text>
        )}
        {timeLeft && <Text color="#888" fontSize={12}>{timeLeft}</Text>}
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
      <YStack flex={1} justifyContent="center" alignItems="center" backgroundColor="#0f0f23" padding={24}>
        <Text fontSize={48} marginBottom={12}>🎬</Text>
        <Text color="#fff" fontSize={20} fontWeight="700" marginBottom={8}>Your list is empty</Text>
        <Text color="#888" fontSize={14} textAlign="center">Open a movie or series and tap ♡ Favorites to save it here</Text>
      </YStack>
    );
  }

  return (
    <ScrollView flex={1} backgroundColor="#0f0f23" contentContainerStyle={{ paddingTop: 40, paddingBottom: 80 }}>
      {myList.length > 0 && (
        <YStack paddingBottom={48}>
          <Text color="#fff" fontSize={26} fontWeight="700" letterSpacing={-0.5} paddingHorizontal={48} marginBottom={20}>Favorites</Text>
          <div style={{ position: "relative" }} className="lumen-shelf-rail">
            <button className="lumen-shelf-nav" onClick={() => fav$.scrollBy(-800)}>‹</button>
            <div ref={fav$.railRef} style={{ display: "flex", overflowX: "auto", gap: 12, paddingLeft: 48, paddingRight: 48, scrollbarWidth: "none", msOverflowStyle: "none", cursor: "grab" }}>
              {myList.map((item, idx) => (
                <MyListCard key={item.id} item={item} focused={focusedRow === myListRowIdx && focusedCol === idx} onPress={() => openDetail(item)} onRemove={() => removeFromMyList(item.id)} />
              ))}
            </div>
            <button className="lumen-shelf-nav right" onClick={() => fav$.scrollBy(800)}>›</button>
          </div>
        </YStack>
      )}

      {watchedHistory.length > 0 && (
        <YStack paddingBottom={48}>
          <Text color="#fff" fontSize={26} fontWeight="700" letterSpacing={-0.5} paddingHorizontal={48} marginBottom={20}>Watch History</Text>
          <div style={{ position: "relative" }} className="lumen-shelf-rail">
            <button className="lumen-shelf-nav" onClick={() => cw$.scrollBy(-800)}>‹</button>
            <div ref={cw$.railRef} style={{ display: "flex", overflowX: "auto", gap: 12, paddingLeft: 48, paddingRight: 48, scrollbarWidth: "none", msOverflowStyle: "none", cursor: "grab" }}>
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
