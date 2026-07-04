import { useState } from "react";
import { Image, Alert, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { YStack, XStack, Text, ScrollView } from "../ui/primitives";
import { colors, fonts, fontWeights, overlay, radii } from "../ui/tokens";
import Icon from "../ui/Icon";
import StatePanel from "../ui/StatePanel";
import { useHistory } from "../domain/hooks/useHistory";
import { useTVNavigation } from "../hooks/useTVNavigation";
import MovieDetail from "../components/MovieDetail";
import SeriesDetail from "../components/SeriesDetail";

const FILL = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 };

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
    <YStack width={130} cursor="pointer" onPress={onPress} pressStyle={{ opacity: 0.8 }} hoverStyle={{ scale: 1.03 }} animation="quick">
      <YStack width={130} aspectRatio={2 / 3} borderRadius={radii.sm} backgroundColor={colors.surface} overflow="hidden" borderWidth={2} borderColor={focused ? colors.accent2 : colors.border}>
        {poster
          ? <Image source={{ uri: poster }} style={FILL} resizeMode="cover" />
          : <View style={[FILL, { backgroundColor: colors.surface }]} />}
        <YStack position="absolute" top={8} right={8} zIndex={4} backgroundColor={overlay} borderRadius={4} paddingHorizontal={5} paddingVertical={2}>
          <Text color={colors.muted} fontFamily={fonts.body} fontSize={9} fontWeight={fontWeights.bold} letterSpacing={0.5}>HD</Text>
        </YStack>
        <YStack position="absolute" top={8} left={8} zIndex={5} backgroundColor={overlay} borderRadius={12} width={22} height={22} justifyContent="center" alignItems="center" cursor="pointer" onPress={(e) => { e?.stopPropagation?.(); onRemove(); }} pressStyle={{ opacity: 0.7 }} hitSlop={11}>
          <Icon name="close" size={11} color={colors.text} />
        </YStack>
      </YStack>
      <Text color={colors.text} fontFamily={fonts.body} fontSize={12} fontWeight={fontWeights.medium} marginTop={8} lineHeight={16} numberOfLines={2}>{item.name}</Text>
      {epLabel && <Text color={colors.muted} fontFamily={fonts.body} fontSize={9} marginTop={4} letterSpacing={0.3}>{epLabel}</Text>}
    </YStack>
  );
}

/* ── Watch History Card ── */
function CWCard({ item, onPress, onRemove, focused }) {
  const progress = item.duration > 0 ? Math.min((item.currentTime / item.duration) * 100, 100) : 15;
  const timeLeft = formatTimeLeft(item.currentTime, item.duration);
  const epLabel = getEpLabel(item);
  const seasonBadge = item.seasonNum ? `S${item.seasonNum}` : null;
  const bg = item.cover || item.movie_image || item.stream_icon || null;
  const showTitle = item.seriesName || item.name;
  const epTitle = item.seriesName && item.name !== item.seriesName ? item.name : null;

  return (
    <YStack width={260} cursor="pointer" onPress={onPress} pressStyle={{ opacity: 0.85 }} hoverStyle={{ scale: 1.02 }} animation="quick">
      <YStack width={260} height={148} borderRadius={radii.sm} backgroundColor={colors.surface} overflow="hidden" borderWidth={2} borderColor={focused ? colors.accent2 : colors.border}>
        {bg
          ? <Image source={{ uri: bg }} style={FILL} resizeMode="cover" />
          : <View style={[FILL, { backgroundColor: colors.surface }]} />}
        <LinearGradient colors={["transparent", "rgba(0,0,0,0.75)"]} style={FILL} />
        {seasonBadge && (
          <YStack position="absolute" top={10} left={12} zIndex={4}>
            <Text color={colors.text} fontFamily={fonts.display} fontSize={13} fontWeight={fontWeights.bold}>{seasonBadge}</Text>
          </YStack>
        )}
        <YStack position="absolute" top={8} left={8} zIndex={5} backgroundColor={overlay} borderRadius={12} width={22} height={22} justifyContent="center" alignItems="center" cursor="pointer" onPress={(e) => { e?.stopPropagation?.(); onRemove(); }} pressStyle={{ opacity: 0.7 }} hitSlop={11}>
          <Icon name="close" size={11} color={colors.text} />
        </YStack>
        <YStack position="absolute" top={0} left={0} right={0} bottom={0} zIndex={3} justifyContent="center" alignItems="center">
          <Icon name="play" size={28} color={colors.text} />
        </YStack>
        {/* Progress bar — keep as RN Views for % string width compatibility */}
        <YStack position="absolute" left={0} right={0} bottom={0} zIndex={4} padding={10}>
          <View style={{ height: 3, borderRadius: 2, backgroundColor: colors.border, overflow: "hidden" }}>
            <View style={{ height: "100%", width: `${progress}%`, backgroundColor: colors.accent }} />
          </View>
        </YStack>
      </YStack>
      <YStack paddingTop={8} paddingHorizontal={2}>
        <Text color={colors.text} fontFamily={fonts.body} fontSize={12} fontWeight={fontWeights.medium} marginBottom={2} numberOfLines={1}>{showTitle}</Text>
        {(epLabel || epTitle) && (
          <Text color={colors.muted} fontFamily={fonts.body} fontSize={11} marginBottom={2} numberOfLines={1}>
            {[epLabel, epTitle].filter(Boolean).join(" · ")}
          </Text>
        )}
        {timeLeft && <Text color={colors.muted} fontFamily={fonts.body} fontSize={11}>{timeLeft}</Text>}
      </YStack>
    </YStack>
  );
}

/* ── Screen ── */
export default function HistoryScreen({ navigation }) {
  const { watchedHistory, removeFromWatchHistory, playLive, playVideoObject, myList, removeFromMyList } = useHistory({ navigation });
  const insets = useSafeAreaInsets();
  const [currentDetail, setCurrentDetail] = useState(null);

  const openDetail = (item) => {
    if (item.type === "live") { playLive(item); return; }
    setCurrentDetail(item);
  };
  const closeDetail = () => setCurrentDetail(null);
  const handlePlay = (videoObj) => { playVideoObject(videoObj); setCurrentDetail(null); };
  const confirmRemove = (item) => {
    Alert.alert("Remove from History", `Remove "${item.name}" from history?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => removeFromWatchHistory(item.id) },
    ]);
  };

  // Build TV navigation rows dynamically
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
      <StatePanel
        mode="empty"
        icon="film"
        title="Your list is empty"
        message="Open a movie and add it to Favorites to save it here"
      />
    );
  }

  return (
    <ScrollView flex={1} backgroundColor={colors.bg} contentContainerStyle={{ paddingTop: 24, paddingBottom: insets.bottom + 80 }} showsVerticalScrollIndicator={false}>
      {myList.length > 0 && (
        <YStack paddingBottom={40}>
          <Text color={colors.text} fontFamily={fonts.display} fontSize={22} fontWeight={fontWeights.bold} letterSpacing={-0.3} paddingHorizontal={16} marginBottom={16}>Favorites</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}>
            {myList.map((item, idx) => (
              <MyListCard
                key={item.id}
                item={item}
                focused={focusedRow === myListRowIdx && focusedCol === idx}
                onPress={() => openDetail(item)}
                onRemove={() => removeFromMyList(item.id)}
              />
            ))}
          </ScrollView>
        </YStack>
      )}

      {watchedHistory.length > 0 && (
        <YStack paddingBottom={40}>
          <Text color={colors.text} fontFamily={fonts.display} fontSize={22} fontWeight={fontWeights.bold} letterSpacing={-0.3} paddingHorizontal={16} marginBottom={16}>Watch History</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}>
            {watchedHistory.map((item, idx) => (
              <CWCard
                key={item.id}
                item={item}
                focused={focusedRow === historyRowIdx && focusedCol === idx}
                onPress={() => openDetail(item)}
                onRemove={() => confirmRemove(item)}
              />
            ))}
          </ScrollView>
        </YStack>
      )}
    </ScrollView>
  );
}
