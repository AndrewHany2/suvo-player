import { useState, useEffect, memo } from "react";
import { Linking, View, Platform } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ss } from "../utils/scaleSize";
import { YStack, XStack, Text, ScrollView, Spinner } from "../ui/primitives";
import { colors, fonts } from "../ui/tokens";
import Icon from "../ui/Icon";
import Button from "../ui/Button";
import { LABELS } from "../ui/labels";
import { useApp, useWatchHistory } from "../context/AppContext";
import { contentService } from "../domain/services/ContentService";
import { resumePlaybackUrl } from "../playback/resumePlaybackUrl";
import DownloadButton from "../downloads/DownloadButton.jsx";
import { useDownloads } from "../downloads/useDownloads.jsx";
import { makeId } from "../downloads/downloadStore.js";

const FILL = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 };

// Midnight scrim matching MovieDetail.web (linear-gradient to colors.bg), so the
// detail hero reads with the same Aurora tone across web and native rather than
// a colder flat-black wash.
const GradientOverlay = memo(() => (
  <LinearGradient
    style={FILL}
    pointerEvents="none"
    colors={["rgba(10,14,26,0.15)", "rgba(10,14,26,0.6)", "#0A0E1A"]}
    locations={[0, 0.45, 1]}
  />
));

import { getTrailerWatchUrl as getTrailerUrl } from "../utils/youtubeTrailer";

export default function MovieDetail({ item, onBack, onPlay }) {
  const { isInMyList, addToMyList, removeFromMyList, activeUserId } = useApp();
  const { watchHistory } = useWatchHistory();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState(null);

  const { byId } = useDownloads();
  const streamId = item.stream_id ?? item.streamId;
  const name = item.name;
  const cover = item.stream_icon || item.cover || item.movie_image || null;

  const historyEntry = watchHistory.find(
    (h) => h.type === "movies" && String(h.streamId) === String(streamId)
  );
  const resumeTime = historyEntry?.currentTime || 0;

  const inFav = isInMyList("movies", streamId);
  const toggleFav = () => {
    if (inFav) removeFromMyList(`mylist_movies_${streamId}`);
    else addToMyList({ type: "movies", streamId, name, cover });
  };

  useEffect(() => {
    setInfo(null);
    contentService.getMovieInfoRaw(streamId).then(setInfo).catch(() => setInfo({}));
  }, [streamId]);

  const isLoading = info === null;
  const data = info?.info || {};
  const backdrop = data.backdrop_path?.[0] || data.cover_big || cover;
  const year = (data.releasedate || data.release_date || "").slice(0, 4);
  const trailer = getTrailerUrl(data.youtube_trailer);

  // TV / keyboard navigation
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const handler = (e) => {
      if (e.key === "Escape" || e.keyCode === 27) onBack();
      else if ((e.key === "Enter" || e.keyCode === 13) && !isLoading) {
        handlePlay(resumeTime > 0 ? resumeTime : 0);
      }
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  // Re-bound on the state the handler branches on; handlePlay/onBack are stable
  // for the mount, so they're intentionally omitted to avoid listener churn.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeTime, isLoading]);

  const handlePlay = (startTime) => {
    // Play from the local file if this movie is downloaded (works offline);
    // otherwise stream from the remote URL.
    const rec = byId[makeId({ kind: "movie", streamId })];
    const url = rec?.status === "done"
      ? rec.localPath
      // Replay the URL captured in history (Continue Watching) when present;
      // only rebuild from the id for a fresh open — M3U ids drift per session.
      : resumePlaybackUrl(item, () =>
          contentService.buildMovieUrl(streamId, item.container_extension || "mp4"),
        );
    onPlay({ type: "movies", streamId, name, url, cover, startTime });
  };

  return (
    <ScrollView flex={1} backgroundColor={colors.bg} contentContainerStyle={{ paddingBottom: 80 }} showsVerticalScrollIndicator={false}>
      {/* Hero */}
      <YStack width="100%" height={ss(420)} position="relative">
        {backdrop
          ? <Image source={backdrop} style={FILL} contentFit="cover" cachePolicy="memory-disk" transition={150} />
          : <View style={[FILL, { backgroundColor: colors.surface }]} />}
        <GradientOverlay />

        <Button variant="ghost" size="sm" icon="back" onPress={onBack} style={{ position: "absolute", top: insets.top + 8, left: 16, zIndex: 10 }}>Back</Button>

        <YStack position="absolute" bottom={0} left={16} right={16} zIndex={5} paddingBottom={24}>
          <Text color={colors.text} fontFamily={fonts.display} fontSize={ss(26)} fontWeight="700" lineHeight={ss(32)} marginBottom={10} numberOfLines={2} ellipsizeMode="tail">{name}</Text>

          {isLoading ? (
            <Spinner color={colors.accent} marginVertical={12} />
          ) : (
            <XStack alignItems="center" gap={8} marginBottom={16} flexWrap="wrap">
              {year ? <YStack borderWidth={1} borderColor={colors.border} borderRadius={4} paddingHorizontal={8} paddingVertical={3}><Text color={colors.muted} fontSize={12}>{year}</Text></YStack> : null}
              {data.genre ? <YStack borderWidth={1} borderColor={colors.border} borderRadius={4} paddingHorizontal={8} paddingVertical={3}><Text color={colors.muted} fontSize={12}>{data.genre.split(",")[0].trim()}</Text></YStack> : null}
              {data.rating ? <XStack alignItems="center" gap={4}><Icon name="star" color={colors.rating} size={13} /><Text color={colors.rating} fontSize={13} fontWeight="600">{parseFloat(data.rating).toFixed(1)}</Text></XStack> : null}
              {data.age ? <YStack borderWidth={1} borderColor={colors.accent} borderRadius={4} paddingHorizontal={8} paddingVertical={3}><Text color={colors.accent} fontSize={12}>{data.age}</Text></YStack> : null}
            </XStack>
          )}

          <YStack gap={8}>
            {resumeTime > 0 ? (
              <XStack gap={8}>
                <Button variant="primary" size="sm" icon="play" onPress={() => handlePlay(resumeTime)} style={{ flex: 1, minHeight: 44 }}>Continue</Button>
                <Button variant="secondary" size="sm" icon="history" onPress={() => handlePlay(0)} style={{ flex: 1, minHeight: 44 }}>From Start</Button>
              </XStack>
            ) : (
              <Button variant="primary" size="sm" icon="play" onPress={() => handlePlay(0)} style={{ minHeight: 44 }}>Play Now</Button>
            )}
            <XStack gap={8}>
              {!isLoading && !!trailer && (
                <Button variant="secondary" size="sm" icon="film" onPress={() => Linking.openURL(trailer)} style={{ flex: 1, minHeight: 44 }}>Watch Trailer</Button>
              )}
              {activeUserId ? (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={inFav ? "check" : "plus"}
                  onPress={toggleFav}
                  style={{ flex: 1, minHeight: 44, ...(inFav ? { borderColor: colors.accent } : null) }}
                  accessibilityLabel={inFav ? LABELS.removeFromMyList : LABELS.addToMyList}
                >
                  {inFav ? LABELS.inMyList : LABELS.myList}
                </Button>
              ) : null}
            </XStack>
            <DownloadButton item={{ kind: "movie", streamId, title: name, poster: cover, ext: item.container_extension || "mp4" }} />
          </YStack>
        </YStack>
      </YStack>

      {/* Meta */}
      {(data.description || data.plot || data.overview || data.cast || data.director) ? (
        <YStack paddingHorizontal={16} paddingTop={20} gap={10}>
          {(data.description || data.plot || data.overview) ? (
            <Text color={colors.muted} fontSize={14} lineHeight={22} marginBottom={10}>
              {data.description || data.plot || data.overview}
            </Text>
          ) : null}
          {data.cast ? <Text color={colors.muted} fontSize={13} lineHeight={20}><Text color={colors.text} fontWeight="700">Cast  </Text>{data.cast}</Text> : null}
          {data.director ? <Text color={colors.muted} fontSize={13} lineHeight={20}><Text color={colors.text} fontWeight="700">Director  </Text>{data.director}</Text> : null}
        </YStack>
      ) : null}
    </ScrollView>
  );
}
