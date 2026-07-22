import { useState, useCallback } from "react";
import { View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatEpisodeLabel } from "../utils/formatEpisodeLabel";
import { LinearGradient } from "expo-linear-gradient";
import { YStack, Text, ScrollView } from "../ui/primitives";
import { colors, fonts, fontWeights, radii, zIndex, heroHeights } from "../ui/tokens";
import { ss } from "../utils/scaleSize";
import Icon from "../ui/Icon";
import StatePanel from "../ui/StatePanel";
import HeroNative from "../presentation/components/Hero.native";
import PosterCard from "../presentation/components/PosterCard.native";
import { LABELS } from "../ui/labels";
import { useApp } from "../context/AppContext";
import { useHistory } from "../domain/hooks/useHistory";
import { useDeferredRemove } from "../hooks/useDeferredRemove";
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
    return formatEpisodeLabel(item.seasonNum, item.episodeNum);
  return null;
};

/* ── Continue Watching Card ──
   Landscape 16:9 twin of the web/TV Continue-Watching card: shared radius
   (radii.card), 1px hairline border, gradient scrim, centered play glyph,
   progress bar. All dimensions flow through ss() to track the density ramp. */
const CW_W = 240;
function CWCard({ item, onPress, onRemove }) {
  const progress = item.duration > 0 ? Math.min((item.currentTime / item.duration) * 100, 100) : null;
  const timeLeft = formatTimeLeft(item.currentTime, item.duration);
  const epLabel = getEpLabel(item);
  const seasonBadge = item.seasonNum ? `S${item.seasonNum}` : null;
  const bg = item.cover || item.movie_image || item.stream_icon || null;
  const showTitle = item.seriesName || item.name;
  const epTitle = item.seriesName && item.name !== item.seriesName ? item.name : null;

  return (
    <YStack width={ss(CW_W)} cursor="pointer" onPress={onPress} pressStyle={{ opacity: 0.85 }} accessibilityRole="button" accessibilityLabel={`Play ${showTitle}`}>
      <YStack width={ss(CW_W)} height={ss(Math.round((CW_W * 9) / 16))} borderRadius={radii.card} backgroundColor={colors.surface} overflow="hidden" borderWidth={1} borderColor={colors.border}>
        {bg
          ? <Image source={bg} style={FILL} contentFit="cover" cachePolicy="memory-disk" recyclingKey={bg} transition={150} />
          : <View style={[FILL, { backgroundColor: colors.surface }]} />}
        <LinearGradient colors={["rgba(0,0,0,0.55)", "rgba(0,0,0,0.1)", "transparent"]} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={FILL} />
        {seasonBadge && (
          <YStack position="absolute" top={ss(10)} left={ss(12)} zIndex={4}>
            <Text color={colors.text} fontFamily={fonts.display} fontSize={ss(13)} fontWeight={fontWeights.bold}>{seasonBadge}</Text>
          </YStack>
        )}
        <YStack
          position="absolute" top={ss(8)} left={ss(8)} zIndex={5}
          backgroundColor="rgba(10,14,26,0.72)" borderRadius={ss(11)} width={ss(22)} height={ss(22)}
          justifyContent="center" alignItems="center" cursor="pointer"
          onPress={(e) => { e?.stopPropagation?.(); onRemove(); }} pressStyle={{ opacity: 0.7 }} hitSlop={11}
          accessibilityRole="button" accessibilityLabel={LABELS.removeFromMyList}
        >
          <Icon name="close" size={ss(11)} color={colors.text} />
        </YStack>
        <YStack position="absolute" top={0} left={0} right={0} bottom={0} zIndex={3} justifyContent="center" alignItems="center">
          <Icon name="play" size={ss(28)} color={colors.text} />
        </YStack>
        {progress !== null && (
          <YStack position="absolute" left={0} right={0} bottom={0} zIndex={4} padding={ss(10)}>
            <View style={{ height: ss(3), borderRadius: ss(2), backgroundColor: colors.border, overflow: "hidden" }}>
              <View style={{ height: "100%", width: `${progress}%`, backgroundColor: colors.accent }} />
            </View>
          </YStack>
        )}
      </YStack>
      <YStack paddingTop={ss(8)} paddingHorizontal={ss(2)}>
        <Text color={colors.text} fontFamily={fonts.body} fontSize={ss(13)} fontWeight={fontWeights.medium} marginBottom={ss(2)} numberOfLines={1}>{showTitle}</Text>
        {(epLabel || epTitle) && (
          <Text color={colors.textDim} fontFamily={fonts.body} fontSize={ss(11)} marginBottom={ss(2)} numberOfLines={1}>
            {[epLabel, epTitle].filter(Boolean).join(" · ")}
          </Text>
        )}
        {timeLeft && <Text color={colors.textDim} fontFamily={fonts.body} fontSize={ss(11)}>{timeLeft}</Text>}
      </YStack>
    </YStack>
  );
}

/* ── Section header ── */
function SectionTitle({ children }) {
  return (
    <Text color={colors.text} fontFamily={fonts.display} fontSize={ss(20)} fontWeight={fontWeights.bold} letterSpacing={-0.3} paddingHorizontal={ss(16)} marginBottom={ss(16)}>
      {children}
    </Text>
  );
}

/* ── Screen ── */
export default function HistoryScreen({ navigation }) {
  const { activeUserId } = useApp();
  const { watchedHistory, removeFromWatchHistory, playLive, playVideoObject, myList, removeFromMyList } = useHistory({ navigation });
  const insets = useSafeAreaInsets();
  const [currentDetail, setCurrentDetail] = useState(null);

  const commit = useCallback((p) => {
    if (!p) return;
    if (p.kind === "mylist") removeFromMyList(p.id);
    else removeFromWatchHistory(p.id);
  }, [removeFromMyList, removeFromWatchHistory]);
  const { pending, requestRemove, undoRemove } = useDeferredRemove(commit);

  const openDetail = (item) => {
    if (item.type === "live") { playLive(item); return; }
    setCurrentDetail(item);
  };
  const closeDetail = () => setCurrentDetail(null);
  const handlePlay = (videoObj) => { playVideoObject(videoObj); setCurrentDetail(null); };

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

  if (currentDetail?.type === "movies") return <MovieDetail item={currentDetail} onBack={closeDetail} onPlay={handlePlay} />;
  if (currentDetail?.type === "series") return <SeriesDetail item={currentDetail} onBack={closeDetail} onPlayEpisode={handlePlay} />;

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

  // Hide the item awaiting a deferred removal so the shelf reflects the pending
  // state instantly while the store call is held back (see useDeferredRemove).
  const visibleMyList = pending?.kind === "mylist" ? myList.filter((i) => i.id !== pending.id) : myList;
  const visibleHistory = pending?.kind === "history" ? watchedHistory.filter((i) => i.id !== pending.id) : watchedHistory;

  // Cinematic entry point: feature the most recent Continue-Watching title (or,
  // failing that, the first My-List title) — mirrors the web Home hero.
  const featured = watchedHistory[0] || myList[0] || null;
  const featuredResume = watchedHistory.length > 0;
  const heroMeta = featured
    ? [getEpLabel(featured), featuredResume ? formatTimeLeft(featured.currentTime, featured.duration) : null].filter(Boolean).join(" · ") || null
    : null;

  return (
    <ScrollView flex={1} backgroundColor={colors.bg} contentContainerStyle={{ paddingTop: ss(24), paddingBottom: insets.bottom + ss(80) }} showsVerticalScrollIndicator={false}>
      {featured && (
        <HeroNative
          backdrop={featured.cover || featured.movie_image || featured.stream_icon || null}
          title={featured.seriesName || featured.name}
          meta={heroMeta}
          continuityLabel="Synced across your devices"
          primaryLabel={featuredResume ? "Resume" : "Play"}
          onPrimary={() => openDetail(featured)}
          secondaryLabel="Browse library"
          onSecondary={() => navigation.navigate("Movies")}
          height={heroHeights.native}
        />
      )}

      {visibleMyList.length > 0 && (
        <YStack paddingBottom={ss(40)}>
          <SectionTitle>{LABELS.myList}</SectionTitle>
          {/* Shared PosterCard (same card as Movies/Series/Live), with the
              deferred-undo remove affordance. Horizontal FlashList virtualizes. */}
          <FlashList
            horizontal
            data={visibleMyList}
            keyExtractor={(item, i) => String(item.id ?? i)}
            renderItem={({ item }) => (
              <PosterCard
                item={item}
                width={ss(120)}
                onPress={() => openDetail(item)}
                onRemove={() => requestRemove({ kind: "mylist", id: item.id, name: item.name })}
              />
            )}
            ItemSeparatorComponent={() => <View style={{ width: ss(12) }} />}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: ss(16) }}
          />
        </YStack>
      )}

      {visibleHistory.length > 0 && (
        <YStack paddingBottom={ss(40)}>
          <SectionTitle>{LABELS.continueWatching}</SectionTitle>
          <FlashList
            horizontal
            data={visibleHistory}
            keyExtractor={(item, i) => String(item.id ?? i)}
            renderItem={({ item }) => (
              <CWCard
                item={item}
                onPress={() => openDetail(item)}
                onRemove={() => requestRemove({ kind: "history", id: item.id, name: item.name })}
              />
            )}
            ItemSeparatorComponent={() => <View style={{ width: ss(12) }} />}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: ss(16) }}
          />
        </YStack>
      )}

      {pending && (
        <YStack
          position="absolute" left={0} right={0} bottom={insets.bottom + ss(16)} zIndex={zIndex.toast}
          alignItems="center" paddingHorizontal={ss(16)} pointerEvents="box-none"
        >
          <YStack
            accessibilityRole="alert"
            flexDirection="row" alignItems="center" gap={ss(8)}
            backgroundColor={colors.surface2} borderWidth={1} borderColor={colors.border} borderRadius={radii.md}
            paddingVertical={ss(10)} paddingLeft={ss(16)} paddingRight={ss(8)}
          >
            <Text color={colors.text} fontFamily={fonts.body} fontSize={ss(14)} numberOfLines={1}>Removed</Text>
            <YStack
              cursor="pointer" onPress={undoRemove} pressStyle={{ opacity: 0.7 }} hitSlop={8}
              paddingVertical={ss(6)} paddingHorizontal={ss(12)}
              accessibilityRole="button" accessibilityLabel="Undo remove"
            >
              <Text color={colors.accentText} fontFamily={fonts.body} fontSize={ss(14)} fontWeight={fontWeights.bold}>Undo</Text>
            </YStack>
          </YStack>
        </YStack>
      )}
    </ScrollView>
  );
}
