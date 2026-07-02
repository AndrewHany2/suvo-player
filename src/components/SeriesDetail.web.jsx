import { useState, useEffect } from "react";
import { View, SectionList } from "react-native";
import { YStack, XStack, Text, ScrollView, Spinner } from "../ui/primitives";
import { colors } from "../ui/tokens";
import { useApp } from "../context/AppContext";
import { ss, useScale } from "../utils/scaleSize";
import iptvApi from "../services/iptvApi";
import ProxiedImage from "./ProxiedImage";
import { usePlatform } from "../platform";
import { useModalKeyTrap } from "../hooks/useModalKeyTrap";
import Icon from "../ui/Icon";

const FILL = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 };

// Caps the detail content width on ultrawide monitors (centered via margin auto).
const MAX_W = 1700;

import { getTrailerEmbedUrl as getTrailerUrl } from "../utils/youtubeTrailer";

const getEpisodeNumber = (ep) => {
  let num = ep.episode_num;
  if (ep.title) {
    const m = ep.title.match(/S\d+E(\d+)/i) || ep.title.match(/E(\d+)/i);
    if (m?.[1]) num = m[1];
  }
  return num;
};

export default function SeriesDetail({ item, onBack, onPlayEpisode }) {
  const { isTV } = usePlatform();
  useScale(); // re-render + recompute ss() on window resize
  const { watchHistory, isInMyList, addToMyList, removeFromMyList } = useApp();
  const [info, setInfo] = useState(null);
  const [episodes, setEpisodes] = useState({});
  const [showEpisodes, setShowEpisodes] = useState(false);
  const [showTrailer, setShowTrailer] = useState(false);

  const seriesId = item.seriesId ?? item.id ?? item.series_id;
  const seriesName = item.seriesName || item.name;
  const cover = item.cover || item.stream_icon || item.movie_image || null;

  const historyEntry = watchHistory.find(
    (h) => h.type === "series" && String(h.seriesId) === String(seriesId),
  );

  const inFav = isInMyList("series", seriesId);
  const toggleFav = () => {
    if (inFav) removeFromMyList(`mylist_series_${seriesId}`);
    else
      addToMyList({
        type: "series",
        streamId: seriesId,
        seriesId,
        name: seriesName,
        cover,
      });
  };

  useEffect(() => {
    setInfo(null);
    setEpisodes({});
    setShowEpisodes(false);
    setShowTrailer(false);
    iptvApi
      .getSeriesInfo(seriesId)
      .then((result) => {
        setInfo(result.info || {});
        setEpisodes(result.episodes || {});
      })
      .catch(() => setInfo({}));
  }, [seriesId]);

  const isLoading = info === null;

  // TV / keyboard navigation
  useModalKeyTrap(true, {
    onBack: () => {
      if (showEpisodes) setShowEpisodes(false);
      else onBack();
    },
    onEnter: () => {
      if (showEpisodes || isLoading) return;
      if (historyEntry) handleContinue();
      else setShowEpisodes(true);
    },
  });
  const data = info || {};
  const rawBp = data.backdrop_path;
  let backdropFromApi = null;
  if (Array.isArray(rawBp)) backdropFromApi = rawBp[0];
  else if (typeof rawBp === "string") backdropFromApi = rawBp;
  const backdrop = cover || backdropFromApi || data.cover;
  const year = (data.release_date || data.releasedate || "").slice(0, 4);
  const trailer = getTrailerUrl(data.youtube_trailer);

  const handleEpisodePress = (ep, seasonNum) => {
    const epNum = getEpisodeNumber(ep);
    const url = iptvApi.buildStreamUrl(
      "series",
      ep.id,
      ep.container_extension || "mp4",
    );
    const epHistory = watchHistory.find(
      (h) => h.type === "series" && String(h.streamId) === String(ep.id),
    );
    onPlayEpisode({
      type: "series",
      streamId: ep.id,
      seriesId,
      seriesName,
      name: `${seriesName} — S${String(seasonNum).padStart(2, "0")}E${String(epNum).padStart(2, "0")}`,
      url,
      cover,
      seasonNum,
      episodeNum: epNum,
      seriesSeasons: episodes,
      startTime: epHistory?.currentTime || 0,
    });
  };

  const handleContinue = () => {
    const url =
      historyEntry.url ||
      iptvApi.buildStreamUrl("series", historyEntry.streamId, "mp4");
    onPlayEpisode({
      ...historyEntry,
      url,
      startTime: historyEntry.currentTime || 0,
    });
  };

  // ── Episodes view ─────────────────────────────────────────────────────────
  if (showEpisodes) {
    const sections = Object.keys(episodes)
      .sort((a, b) => parseInt(a) - parseInt(b))
      .map((num) => ({
        title: `Season ${num}`,
        seasonNum: num,
        data: episodes[num] || [],
      }));

    // TV-specific sizing for episode list — passed through ss() (reflows on resize).
    const epBackSize = ss(isTV ? 20 : 14);
    const epTitleSize = ss(isTV ? 28 : 20);
    const epHeaderSize = ss(isTV ? 22 : 15);
    const epNumSize = ss(isTV ? 18 : 12);
    const epNameSize = ss(isTV ? 20 : 14);
    const epDurationSize = ss(isTV ? 16 : 12);
    const epDescSize = ss(isTV ? 18 : 13);
    const epPadH = ss(isTV ? 80 : 48);

    return (
      <YStack flex={1} backgroundColor={colors.bg}>
        <XStack
          alignItems="center"
          gap={ss(isTV ? 20 : 14)}
          paddingHorizontal={epPadH}
          paddingVertical={ss(isTV ? 28 : 18)}
          borderBottomWidth={isTV ? 2 : 1}
          borderBottomColor={colors.border}
        >
          <YStack
            paddingVertical={ss(isTV ? 12 : 8)}
            paddingHorizontal={ss(isTV ? 20 : 14)}
            backgroundColor={colors.surface2}
            borderRadius={ss(isTV ? 12 : 8)}
            cursor="pointer"
            onPress={() => setShowEpisodes(false)}
            pressStyle={{ opacity: 0.8 }}
          >
            <XStack alignItems="center" gap={ss(isTV ? 8 : 6)}>
              <Icon name="back" color={colors.accent} size={epBackSize} />
              <Text
                color={colors.accent}
                fontSize={epBackSize}
                fontWeight={isTV ? "700" : "600"}
              >
                Back
              </Text>
            </XStack>
          </YStack>
          <Text
            color={colors.text}
            fontSize={epTitleSize}
            fontWeight="700"
            flex={1}
            numberOfLines={1}
          >
            {seriesName}
          </Text>
        </XStack>
        <SectionList
          sections={sections}
          keyExtractor={(ep) => String(ep.id)}
          contentContainerStyle={{
            paddingHorizontal: epPadH,
            paddingVertical: ss(isTV ? 24 : 12),
            paddingBottom: ss(80),
          }}
          renderSectionHeader={({ section: { title } }) => (
            <YStack
              backgroundColor={colors.surface}
              paddingHorizontal={ss(isTV ? 20 : 14)}
              paddingVertical={ss(isTV ? 16 : 10)}
              marginBottom={ss(isTV ? 12 : 6)}
              marginTop={ss(isTV ? 20 : 12)}
              borderRadius={ss(isTV ? 12 : 8)}
            >
              <Text color={colors.accent} fontSize={epHeaderSize} fontWeight="700">
                {title}
              </Text>
            </YStack>
          )}
          renderItem={({ item: ep, section }) => (
            <YStack
              backgroundColor={colors.surface2}
              borderRadius={ss(isTV ? 14 : 10)}
              padding={ss(isTV ? 20 : 12)}
              marginBottom={ss(isTV ? 12 : 6)}
              borderWidth={isTV ? 2 : 1}
              borderColor={colors.border}
              cursor="pointer"
              onPress={() => handleEpisodePress(ep, section.seasonNum)}
              pressStyle={{ opacity: 0.8 }}
              hoverStyle={{ borderColor: colors.accent }}
              animation="quick"
            >
              <XStack
                alignItems="center"
                marginBottom={isTV && ep.info?.plot ? 12 : 0}
              >
                <YStack
                  backgroundColor={colors.accent}
                  borderRadius={ss(isTV ? 10 : 6)}
                  paddingHorizontal={ss(isTV ? 14 : 8)}
                  paddingVertical={ss(isTV ? 8 : 4)}
                  marginRight={ss(isTV ? 16 : 12)}
                >
                  <Text color={colors.text} fontSize={epNumSize} fontWeight="700">
                    E{getEpisodeNumber(ep)}
                  </Text>
                </YStack>
                <YStack flex={1}>
                  <Text
                    color={colors.text}
                    fontSize={epNameSize}
                    fontWeight={isTV ? "700" : "600"}
                    numberOfLines={1}
                  >
                    {ep.title || "Untitled"}
                  </Text>
                  {!!ep.info?.duration && (
                    <Text
                      color={colors.muted}
                      fontSize={epDurationSize}
                      marginTop={ss(isTV ? 6 : 2)}
                    >
                      {ep.info.duration}
                    </Text>
                  )}
                </YStack>
                <Text
                  color={colors.accent}
                  fontSize={ss(isTV ? 24 : 16)}
                  marginLeft={ss(isTV ? 16 : 8)}
                >
                  ▶
                </Text>
              </XStack>
              {isTV && ep.info?.plot && (
                <Text
                  color={colors.muted}
                  fontSize={epDescSize}
                  lineHeight={ss(isTV ? 28 : 20)}
                  numberOfLines={2}
                  marginTop={ss(8)}
                >
                  {ep.info.plot}
                </Text>
              )}
            </YStack>
          )}
        />
      </YStack>
    );
  }

  // TV-specific sizing — authored at the 1920×1080 reference and passed through
  // ss() so it scales (and reflows on web resize via useScale above).
  const heroHeight = ss(isTV ? 700 : 520);
  const titleSize = ss(isTV ? 56 : 40);
  const backSize = ss(isTV ? 22 : 14);
  const metaSize = ss(isTV ? 18 : 12);
  const ratingSize = ss(isTV ? 20 : 13);
  const buttonTextSize = ss(isTV ? 22 : 15);
  const buttonPadH = ss(isTV ? 40 : 28);
  const buttonPadV = ss(isTV ? 20 : 13);
  const descSize = ss(isTV ? 24 : 15);
  const descLineHeight = ss(isTV ? 38 : 24);
  const castSize = ss(isTV ? 20 : 14);
  const castLineHeight = ss(isTV ? 32 : 20);
  const sectionPadH = ss(isTV ? 80 : 48);

  // ── Hero / detail view ────────────────────────────────────────────────────
  return (
    <ScrollView
      flex={1}
      backgroundColor={colors.bg}
      contentContainerStyle={{ paddingBottom: ss(80) }}
    >
      <YStack
        width="100%"
        height={heroHeight}
        position="relative"
        overflow="hidden"
      >
        <ProxiedImage
          source={{ uri: backdrop }}
          style={FILL}
          resizeMode="cover"
          fallbackColor={colors.surface}
        />
        {/* CSS gradient — keep as raw View; Tamagui doesn't forward the `background` CSS prop */}
        <View
          style={[
            FILL,
            {
              background:
                "linear-gradient(to top, #0A0E1A 0%, rgba(10, 14, 26,0.6) 55%, rgba(10, 14, 26,0.15) 100%)",
            },
          ]}
        />

        <YStack
          position="absolute"
          top={ss(isTV ? 40 : 20)}
          left={sectionPadH}
          zIndex={10}
          paddingVertical={ss(isTV ? 14 : 8)}
          paddingHorizontal={ss(isTV ? 24 : 14)}
          backgroundColor="rgba(0,0,0,0.55)"
          borderRadius={ss(isTV ? 12 : 8)}
          cursor="pointer"
          onPress={onBack}
          pressStyle={{ opacity: 0.8 }}
        >
          <XStack alignItems="center" gap={ss(isTV ? 8 : 6)}>
            <Icon name="back" color={colors.accent} size={backSize} />
            <Text
              color={colors.accent}
              fontSize={backSize}
              fontWeight={isTV ? "700" : "600"}
            >
              Back
            </Text>
          </XStack>
        </YStack>

        <YStack
          position="absolute"
          bottom={0}
          left={sectionPadH}
          right={sectionPadH}
          zIndex={5}
          paddingBottom={ss(isTV ? 60 : 40)}
        >
          <Text
            color={colors.text}
            fontSize={titleSize}
            fontWeight="900"
            letterSpacing={isTV ? -1.5 : -1}
            marginBottom={ss(isTV ? 20 : 12)}
          >
            {seriesName}
          </Text>

          {isLoading ? (
            <Spinner color={colors.accent} marginVertical={ss(12)} />
          ) : (
            <XStack
              alignItems="center"
              gap={ss(8)}
              marginBottom={ss(14)}
              flexWrap="wrap"
            >
              {year ? (
                <YStack
                  borderWidth={isTV ? 2 : 1}
                  borderColor={colors.border}
                  borderRadius={ss(isTV ? 8 : 4)}
                  paddingHorizontal={ss(isTV ? 14 : 8)}
                  paddingVertical={ss(isTV ? 8 : 3)}
                >
                  <Text
                    color={colors.muted}
                    fontSize={metaSize}
                    fontWeight={isTV ? "600" : "400"}
                  >
                    {year}
                  </Text>
                </YStack>
              ) : null}
              {data.genre ? (
                <YStack
                  borderWidth={isTV ? 2 : 1}
                  borderColor={colors.border}
                  borderRadius={ss(isTV ? 8 : 4)}
                  paddingHorizontal={ss(isTV ? 14 : 8)}
                  paddingVertical={ss(isTV ? 8 : 3)}
                >
                  <Text
                    color={colors.muted}
                    fontSize={metaSize}
                    fontWeight={isTV ? "600" : "400"}
                  >
                    {data.genre.split(",")[0].trim()}
                  </Text>
                </YStack>
              ) : null}
              {data.rating ? (
                <XStack alignItems="center" gap={ss(isTV ? 6 : 4)}>
                  <Icon name="star" color={colors.rating} size={ratingSize} />
                  <Text
                    color={colors.rating}
                    fontSize={ratingSize}
                    fontWeight={isTV ? "700" : "600"}
                  >
                    {Number.parseFloat(data.rating).toFixed(1)}
                  </Text>
                </XStack>
              ) : null}
            </XStack>
          )}

          <XStack alignItems="center" gap={ss(12)} flexWrap="wrap">
            {historyEntry && (
              <YStack
                backgroundColor="#fff"
                paddingHorizontal={buttonPadH}
                paddingVertical={buttonPadV}
                borderRadius={ss(isTV ? 12 : 8)}
                cursor="pointer"
                onPress={handleContinue}
                pressStyle={{ opacity: 0.85 }}
                hoverStyle={{ opacity: 0.9 }}
                animation="quick"
              >
                <Text color="#000" fontSize={buttonTextSize} fontWeight="700">
                  {"▶  Continue"}
                  {historyEntry.seasonNum
                    ? ` S${historyEntry.seasonNum}E${String(historyEntry.episodeNum).padStart(2, "0")}`
                    : ""}
                </Text>
              </YStack>
            )}
            <YStack
              backgroundColor={historyEntry ? "rgba(40,40,60,0.85)" : "#fff"}
              paddingHorizontal={historyEntry ? ss(isTV ? 36 : 22) : buttonPadH}
              paddingVertical={buttonPadV}
              borderRadius={ss(isTV ? 12 : 8)}
              borderWidth={historyEntry ? (isTV ? 2 : 1) : 0}
              borderColor={colors.border}
              cursor="pointer"
              onPress={() => setShowEpisodes(true)}
              pressStyle={{ opacity: 0.8 }}
              hoverStyle={{ borderColor: "#fff" }}
              animation="quick"
            >
              <Text
                color={historyEntry ? colors.text : "#000"}
                fontSize={buttonTextSize}
                fontWeight={historyEntry ? "600" : "700"}
              >
                ☰ Browse Episodes
              </Text>
            </YStack>
            {!isLoading && !!trailer && (
              <YStack
                backgroundColor="rgba(40,40,60,0.85)"
                paddingHorizontal={ss(isTV ? 36 : 22)}
                paddingVertical={buttonPadV}
                borderRadius={ss(isTV ? 12 : 8)}
                borderWidth={isTV ? 2 : 1}
                borderColor={colors.border}
                cursor="pointer"
                onPress={() => setShowTrailer((v) => !v)}
                pressStyle={{ opacity: 0.8 }}
                hoverStyle={{ borderColor: "#fff" }}
                animation="quick"
              >
                <XStack alignItems="center" gap={ss(isTV ? 10 : 7)}>
                  {showTrailer
                    ? <Icon name="close" color={colors.text} size={buttonTextSize} />
                    : <Icon name="film" color={colors.muted} size={buttonTextSize} />}
                  <Text color={colors.text} fontSize={buttonTextSize} fontWeight="600">
                    {showTrailer ? "Close Trailer" : "Watch Trailer"}
                  </Text>
                </XStack>
              </YStack>
            )}
            <YStack
              backgroundColor={
                inFav ? "rgba(108, 92, 231,0.15)" : "rgba(40,40,60,0.85)"
              }
              paddingHorizontal={ss(isTV ? 36 : 22)}
              paddingVertical={buttonPadV}
              borderRadius={ss(isTV ? 12 : 8)}
              borderWidth={isTV ? 2 : 1}
              borderColor={inFav ? colors.accent : colors.border}
              cursor="pointer"
              onPress={toggleFav}
              pressStyle={{ opacity: 0.8 }}
              hoverStyle={{ borderColor: colors.accent }}
              animation="quick"
            >
              <Text color={colors.text} fontSize={buttonTextSize} fontWeight="600">
                {inFav ? "♥  Saved" : "♡  Add to Favorites"}
              </Text>
            </YStack>
          </XStack>
        </YStack>
      </YStack>

      {showTrailer && !!trailer && (
        <YStack
          paddingHorizontal={sectionPadH}
          paddingTop={ss(isTV ? 32 : 8)}
          paddingBottom={ss(isTV ? 40 : 24)}
        >
          <iframe
            title={`${seriesName} trailer`}
            src={`${trailer}?autoplay=1&rel=0&modestbranding=1`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            style={{
              width: "100%",
              height: ss(isTV ? 600 : 420),
              border: "none",
              borderRadius: ss(isTV ? 16 : 8),
              backgroundColor: "#000",
            }}
          />
        </YStack>
      )}

      {(data.plot ||
        data.description ||
        data.overview ||
        data.cast ||
        data.director) && (
        <YStack
          paddingHorizontal={sectionPadH}
          paddingTop={ss(isTV ? 40 : 24)}
          gap={ss(isTV ? 20 : 10)}
          maxWidth={MAX_W}
          width="100%"
          alignSelf="center"
        >
          {(data.plot || data.description || data.overview) && (
            <Text
              color={colors.muted}
              fontSize={descSize}
              lineHeight={descLineHeight}
              marginBottom={ss(isTV ? 20 : 12)}
              maxWidth="70ch"
            >
              {data.plot || data.description || data.overview}
            </Text>
          )}
          {data.cast && (
            <Text color={colors.muted} fontSize={castSize} lineHeight={castLineHeight} maxWidth="70ch">
              <Text color={colors.text} fontWeight="700" fontSize={ss(isTV ? 22 : 14)}>
                Cast:{" "}
              </Text>
              {data.cast}
            </Text>
          )}
          {data.director && (
            <Text color={colors.muted} fontSize={castSize} lineHeight={castLineHeight} maxWidth="70ch">
              <Text color={colors.text} fontWeight="700" fontSize={ss(isTV ? 22 : 14)}>
                Director:{" "}
              </Text>
              {data.director}
            </Text>
          )}
        </YStack>
      )}
    </ScrollView>
  );
}
