import { useState, useEffect, memo } from "react";
import { Linking, View, SectionList, Platform } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { YStack, XStack, Text, ScrollView, Spinner } from "../ui/primitives";
import { colors } from "../ui/tokens";
import { useApp, useWatchHistory } from "../context/AppContext";
import { contentService } from "../domain/services/ContentService";
import Icon from "../ui/Icon";
import DownloadButton from "../downloads/DownloadButton.jsx";
import { useDownloads } from "../downloads/useDownloads.jsx";
import { makeId } from "../downloads/downloadStore.js";

const FILL = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 };

const GradientOverlay = memo(() => (
  <View style={FILL} pointerEvents="none">
    <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, top: "45%", backgroundColor: "rgba(0,0,0,0.82)" }} />
  </View>
));

import { getTrailerWatchUrl as getTrailerUrl } from "../utils/youtubeTrailer";

const getEpisodeNumber = (ep) => {
  let num = ep.episode_num;
  if (ep.title) {
    const m = ep.title.match(/S\d+E(\d+)/i) || ep.title.match(/E(\d+)/i);
    if (m?.[1]) num = m[1];
  }
  return num;
};

export default function SeriesDetail({ item, onBack, onPlayEpisode }) {
  const { isInMyList, addToMyList, removeFromMyList, activeUserId } = useApp();
  const { watchHistory } = useWatchHistory();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState(null);
  const [episodes, setEpisodes] = useState({});
  const [showEpisodes, setShowEpisodes] = useState(false);

  const { byId } = useDownloads();
  const seriesId = item.seriesId ?? item.id ?? item.series_id;
  const seriesName = item.seriesName || item.name;
  const cover = item.cover || null;

  const historyEntry = watchHistory.find(
    (h) => h.type === "series" && String(h.seriesId) === String(seriesId)
  );

  const inFav = isInMyList("series", seriesId);
  const toggleFav = () => {
    if (inFav) removeFromMyList(`mylist_series_${seriesId}`);
    else addToMyList({ type: "series", streamId: seriesId, seriesId, name: seriesName, cover });
  };

  useEffect(() => {
    setInfo(null);
    setEpisodes({});
    setShowEpisodes(false);
    contentService.getSeriesInfoRaw(seriesId)
      .then((result) => { setInfo(result.info || {}); setEpisodes(result.episodes || {}); })
      .catch(() => setInfo({}));
  }, [seriesId]);

  const isLoading = info === null;
  const data = info || {};
  const backdrop = data.backdrop_path?.[0] || data.cover || cover;
  const year = (data.release_date || data.releasedate || "").slice(0, 4);

  // TV / keyboard navigation
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const handler = (e) => {
      if (e.key === "Escape" || e.keyCode === 27) {
        if (showEpisodes) setShowEpisodes(false);
        else onBack();
      } else if ((e.key === "Enter" || e.keyCode === 13) && !showEpisodes && !isLoading) {
        if (historyEntry) handleContinue();
        else setShowEpisodes(true);
      }
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  // Re-bound on the state the handler branches on; handleContinue/onBack are
  // stable for the mount, so they're intentionally omitted to avoid churn.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showEpisodes, isLoading, historyEntry]);
  const trailer = getTrailerUrl(data.youtube_trailer);

  const handleEpisodePress = (ep, seasonNum) => {
    const epNum = getEpisodeNumber(ep);
    // Play from the local file if this episode is downloaded (works offline).
    const rec = byId[makeId({ kind: "episode", seriesId, season: seasonNum, episode: epNum })];
    const url = rec?.status === "done"
      ? rec.localPath
      : contentService.buildEpisodeUrl(ep.id, ep.container_extension || "mp4");
    onPlayEpisode({
      type: "series", streamId: ep.id, seriesId, seriesName,
      name: `${seriesName} — S${String(seasonNum).padStart(2, "0")}E${String(epNum).padStart(2, "0")}`,
      url, cover, seasonNum, episodeNum: epNum, seriesSeasons: episodes, startTime: 0,
    });
  };

  const handleContinue = () => {
    // Prefer the local file when this episode is downloaded (works offline);
    // otherwise the saved remote URL, then a freshly-built one.
    const rec = byId[makeId({ kind: "episode", seriesId, season: historyEntry.seasonNum, episode: historyEntry.episodeNum })];
    const url = rec?.status === "done"
      ? rec.localPath
      : (historyEntry.url || contentService.buildEpisodeUrl(historyEntry.streamId, "mp4"));
    onPlayEpisode({ ...historyEntry, url, startTime: historyEntry.currentTime || 0 });
  };

  // ── Episodes view ─────────────────────────────────────────────────────────
  if (showEpisodes) {
    const sections = Object.keys(episodes)
      .sort((a, b) => parseInt(a) - parseInt(b))
      .map((num) => ({ title: `Season ${num}`, seasonNum: num, data: episodes[num] || [] }));

    return (
      <YStack flex={1} backgroundColor={colors.bg}>
        <XStack alignItems="center" gap={14} paddingHorizontal={16} paddingTop={insets.top + 16} paddingBottom={14} borderBottomWidth={1} borderBottomColor={colors.border}>
          <YStack paddingVertical={8} paddingHorizontal={12} backgroundColor={colors.surface2} borderRadius={8} cursor="pointer" onPress={() => setShowEpisodes(false)} pressStyle={{ opacity: 0.8 }}>
            <XStack alignItems="center" gap={6}>
              <Icon name="back" color={colors.accent} size={14} />
              <Text color={colors.accent} fontSize={14} fontWeight="600">Back</Text>
            </XStack>
          </YStack>
          <Text color={colors.text} fontSize={18} fontWeight="700" flex={1} numberOfLines={1}>{seriesName}</Text>
        </XStack>
        <SectionList
          sections={sections}
          keyExtractor={(ep) => String(ep.id)}
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12, paddingBottom: 80 }}
          showsVerticalScrollIndicator={false}
          renderSectionHeader={({ section: { title } }) => (
            <YStack backgroundColor={colors.surface} paddingHorizontal={14} paddingVertical={10} marginBottom={6} marginTop={12} borderRadius={8}>
              <Text color={colors.accent} fontSize={15} fontWeight="700">{title}</Text>
            </YStack>
          )}
          renderItem={({ item: ep, section }) => (
            <XStack alignItems="center" backgroundColor={colors.surface2} borderRadius={10} padding={12} marginBottom={6} borderWidth={1} borderColor={colors.border} cursor="pointer" onPress={() => handleEpisodePress(ep, section.seasonNum)} pressStyle={{ opacity: 0.8 }} hoverStyle={{ borderColor: colors.accent }} animation="quick">
              <YStack backgroundColor={colors.accent} borderRadius={6} paddingHorizontal={8} paddingVertical={4} marginRight={12}>
                <Text color={colors.text} fontSize={12} fontWeight="700">E{getEpisodeNumber(ep)}</Text>
              </YStack>
              <YStack flex={1}>
                <Text color={colors.text} fontSize={14} numberOfLines={1}>{ep.title || "Untitled"}</Text>
                {!!ep.info?.duration && <Text color={colors.muted} fontSize={12} marginTop={2}>{ep.info.duration}</Text>}
              </YStack>
              <DownloadButton
                item={{
                  kind: "episode",
                  seriesId,
                  season: section.seasonNum,
                  episode: getEpisodeNumber(ep),
                  episodeStreamId: ep.id,
                  title: ep.title || `S${section.seasonNum}E${getEpisodeNumber(ep)}`,
                  ext: ep.container_extension || "mp4",
                }}
              />
              <Text color={colors.accent} fontSize={16}>▶</Text>
            </XStack>
          )}
        />
      </YStack>
    );
  }

  // ── Hero / detail view ────────────────────────────────────────────────────
  return (
    <ScrollView flex={1} backgroundColor={colors.bg} contentContainerStyle={{ paddingBottom: 80 }} showsVerticalScrollIndicator={false}>
      <YStack width="100%" height={420} position="relative">
        {backdrop
          ? <Image source={backdrop} style={FILL} contentFit="cover" cachePolicy="memory-disk" transition={150} />
          : <View style={[FILL, { backgroundColor: colors.surface }]} />}
        <GradientOverlay />

        <YStack position="absolute" top={50} left={16} zIndex={10} paddingVertical={8} paddingHorizontal={14} backgroundColor="rgba(0,0,0,0.55)" borderRadius={8} cursor="pointer" onPress={onBack} pressStyle={{ opacity: 0.8 }}>
          <XStack alignItems="center" gap={6}>
            <Icon name="back" color={colors.accent} size={14} />
            <Text color={colors.accent} fontSize={14} fontWeight="600">Back</Text>
          </XStack>
        </YStack>

        <YStack position="absolute" bottom={0} left={16} right={16} zIndex={5} paddingBottom={24}>
          <Text color={colors.text} fontSize={26} fontWeight="900" lineHeight={32} marginBottom={10} numberOfLines={2} ellipsizeMode="tail">{seriesName}</Text>

          {isLoading ? (
            <Spinner color={colors.accent} marginVertical={12} />
          ) : (
            <XStack alignItems="center" gap={8} marginBottom={16} flexWrap="wrap">
              {year ? <YStack borderWidth={1} borderColor={colors.border} borderRadius={4} paddingHorizontal={8} paddingVertical={3}><Text color={colors.muted} fontSize={12}>{year}</Text></YStack> : null}
              {data.genre ? <YStack borderWidth={1} borderColor={colors.border} borderRadius={4} paddingHorizontal={8} paddingVertical={3}><Text color={colors.muted} fontSize={12}>{data.genre.split(",")[0].trim()}</Text></YStack> : null}
              {data.rating ? (
                <XStack alignItems="center" gap={4}>
                  <Icon name="star" color={colors.rating} size={13} />
                  <Text color={colors.rating} fontSize={13} fontWeight="600">{Number.parseFloat(data.rating).toFixed(1)}</Text>
                </XStack>
              ) : null}
            </XStack>
          )}

          <YStack gap={8}>
            {historyEntry && (
              <YStack backgroundColor="#fff" paddingHorizontal={20} minHeight={36} alignItems="center" justifyContent="center" borderRadius={8} cursor="pointer" onPress={handleContinue} pressStyle={{ opacity: 0.85 }} hoverStyle={{ opacity: 0.9 }} animation="quick">
                <Text color="#000" fontSize={13} fontWeight="700">
                  {"▶  Continue"}
                  {historyEntry.seasonNum ? ` S${historyEntry.seasonNum}E${String(historyEntry.episodeNum).padStart(2, "0")}` : ""}
                </Text>
              </YStack>
            )}
            <YStack
              backgroundColor={historyEntry ? "rgba(40,40,60,0.85)" : "#fff"}
              paddingHorizontal={20}
              minHeight={36}
              alignItems="center"
              justifyContent="center"
              borderRadius={8}
              borderWidth={historyEntry ? 1 : 0}
              borderColor={colors.border}
              cursor="pointer"
              onPress={() => setShowEpisodes(true)}
              pressStyle={{ opacity: 0.8 }}
              hoverStyle={{ borderColor: colors.text }}
              animation="quick"
            >
              <Text color={historyEntry ? colors.text : "#000"} fontSize={13} fontWeight={historyEntry ? "600" : "700"}>☰  Browse Episodes</Text>
            </YStack>
            <XStack gap={8}>
              {!isLoading && !!trailer && (
                <YStack flex={1} backgroundColor="rgba(40,40,60,0.85)" minHeight={36} alignItems="center" justifyContent="center" borderRadius={8} borderWidth={1} borderColor={colors.border} cursor="pointer" onPress={() => Linking.openURL(trailer)} pressStyle={{ opacity: 0.8 }} hoverStyle={{ borderColor: colors.text }} animation="quick">
                  <XStack alignItems="center" gap={7}>
                    <Icon name="film" color={colors.muted} size={15} />
                    <Text color={colors.text} fontSize={13} fontWeight="600">Trailer</Text>
                  </XStack>
                </YStack>
              )}
              {activeUserId ? (
                <YStack
                  flex={1}
                  backgroundColor={inFav ? "rgba(108, 92, 231,0.15)" : "rgba(40,40,60,0.85)"}
                  minHeight={36}
                  alignItems="center"
                  justifyContent="center"
                  borderRadius={8}
                  borderWidth={1}
                  borderColor={inFav ? colors.accent : colors.border}
                  cursor="pointer"
                  onPress={toggleFav}
                  pressStyle={{ opacity: 0.8 }}
                  hoverStyle={{ borderColor: colors.accent }}
                  animation="quick"
                >
                  <Text color={colors.text} fontSize={13} fontWeight="600">{inFav ? "♥  Saved" : "♡  Favorites"}</Text>
                </YStack>
              ) : null}
            </XStack>
          </YStack>
        </YStack>
      </YStack>

      {(data.plot || data.description || data.overview || data.cast || data.director) ? (
        <YStack paddingHorizontal={16} paddingTop={20} gap={10}>
          {(data.plot || data.description || data.overview) ? (
            <Text color={colors.muted} fontSize={14} lineHeight={22} marginBottom={10}>
              {data.plot || data.description || data.overview}
            </Text>
          ) : null}
          {data.cast ? <Text color={colors.muted} fontSize={13} lineHeight={20}><Text color={colors.text} fontWeight="700">Cast  </Text>{data.cast}</Text> : null}
          {data.director ? <Text color={colors.muted} fontSize={13} lineHeight={20}><Text color={colors.text} fontWeight="700">Director  </Text>{data.director}</Text> : null}
        </YStack>
      ) : null}
    </ScrollView>
  );
}
