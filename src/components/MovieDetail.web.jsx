import { useState, useEffect } from "react";
import { View } from "react-native";
import { YStack, XStack, Text, ScrollView, Spinner } from "../ui/primitives";
import { colors } from "../ui/tokens";
import { useApp, useWatchHistory } from "../context/AppContext";
import { ss, useScale } from "../utils/scaleSize";
import { contentService } from "../domain/services/ContentService";
import ProxiedImage from "./ProxiedImage";
import { usePlatform } from "../platform";
import { useModalKeyTrap } from "../hooks/useModalKeyTrap";
import Icon from "../ui/Icon";

const FILL = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 };

// Caps the detail content width on ultrawide monitors (centered via margin auto).
const MAX_W = 1700;

import { getTrailerEmbedUrl as getTrailerUrl } from "../utils/youtubeTrailer";

export default function MovieDetail({ item, onBack, onPlay }) {
  const { isTV } = usePlatform();
  useScale(); // re-render + recompute ss() on window resize
  const { isInMyList, addToMyList, removeFromMyList } = useApp();
  const { watchHistory } = useWatchHistory();
  const [info, setInfo] = useState(null);
  const [showTrailer, setShowTrailer] = useState(false);

  const streamId = item.stream_id ?? item.streamId;
  const name = item.name;
  const cover = item.stream_icon || item.cover || item.movie_image || null;

  const historyEntry = watchHistory.find(
    (h) => h.type === "movies" && String(h.streamId) === String(streamId),
  );
  const resumeTime = historyEntry?.currentTime || 0;

  const inFav = isInMyList("movies", streamId);
  const toggleFav = () => {
    if (inFav) removeFromMyList(`mylist_movies_${streamId}`);
    else addToMyList({ type: "movies", streamId, name, cover });
  };

  useEffect(() => {
    setInfo(null);
    setShowTrailer(false);
    contentService
      .getMovieInfoRaw(streamId)
      .then(setInfo)
      .catch(() => setInfo({}));
  }, [streamId]);

  // TV / keyboard navigation
  const isLoading = info === null;
  const data = info?.info || {};
  const rawBp = data.backdrop_path;
  let backdropFromApi = null;
  if (Array.isArray(rawBp)) backdropFromApi = rawBp[0];
  else if (typeof rawBp === "string") backdropFromApi = rawBp;
  const backdrop = cover || backdropFromApi || data.cover_big;
  const year = (data.releasedate || data.release_date || "").slice(0, 4);
  const trailer = getTrailerUrl(data.youtube_trailer);

  useModalKeyTrap(true, {
    onBack,
    onEnter: () => {
      if (!isLoading) handlePlay(resumeTime > 0 ? resumeTime : 0);
    },
  });

  const handlePlay = (startTime) => {
    const url = contentService.buildMovieUrl(streamId, item.container_extension || "mp4");
    onPlay({ type: "movies", streamId, name, url, cover, startTime });
  };

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

  return (
    <ScrollView
      flex={1}
      backgroundColor={colors.bg}
      contentContainerStyle={{ paddingBottom: ss(80) }}
    >
      {/* Hero */}
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
        {/* CSS gradient — keep as raw View since Tamagui doesn't forward the `background` CSS prop */}
        <View
          style={[
            FILL,
            {
              background: `linear-gradient(to top, ${colors.bg} 0%, rgba(10, 14, 26,0.6) 55%, rgba(10, 14, 26,0.15) 100%)`,
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
          <XStack alignItems="center" gap={ss(6)}>
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
            {name}
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
                <XStack alignItems="center" gap={ss(4)}>
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
              {data.age ? (
                <YStack
                  borderWidth={isTV ? 2 : 1}
                  borderColor={colors.accent}
                  borderRadius={ss(isTV ? 8 : 4)}
                  paddingHorizontal={ss(isTV ? 14 : 8)}
                  paddingVertical={ss(isTV ? 8 : 3)}
                >
                  <Text
                    color={colors.accent}
                    fontSize={metaSize}
                    fontWeight={isTV ? "700" : "400"}
                  >
                    {data.age}
                  </Text>
                </YStack>
              ) : null}
            </XStack>
          )}

          <XStack alignItems="center" gap={ss(12)} flexWrap="wrap">
            {resumeTime > 0 ? (
              <>
                <YStack
                  backgroundColor="#fff"
                  paddingHorizontal={buttonPadH}
                  paddingVertical={buttonPadV}
                  borderRadius={ss(isTV ? 12 : 8)}
                  cursor="pointer"
                  onPress={() => handlePlay(resumeTime)}
                  pressStyle={{ opacity: 0.85 }}
                  hoverStyle={{ opacity: 0.9 }}
                  animation="quick"
                >
                  <Text color="#000" fontSize={buttonTextSize} fontWeight="700">
                    ▶ Continue
                  </Text>
                </YStack>
                <YStack
                  backgroundColor="rgba(40,40,60,0.85)"
                  paddingHorizontal={ss(isTV ? 36 : 22)}
                  paddingVertical={buttonPadV}
                  borderRadius={ss(isTV ? 12 : 8)}
                  borderWidth={isTV ? 2 : 1}
                  borderColor={colors.border}
                  cursor="pointer"
                  onPress={() => handlePlay(0)}
                  pressStyle={{ opacity: 0.8 }}
                  hoverStyle={{ borderColor: "#fff" }}
                  animation="quick"
                >
                  <Text color={colors.text} fontSize={buttonTextSize} fontWeight="600">
                    ↺ From Start
                  </Text>
                </YStack>
              </>
            ) : (
              <YStack
                backgroundColor="#fff"
                paddingHorizontal={buttonPadH}
                paddingVertical={buttonPadV}
                borderRadius={ss(isTV ? 12 : 8)}
                cursor="pointer"
                onPress={() => handlePlay(0)}
                pressStyle={{ opacity: 0.85 }}
                hoverStyle={{ opacity: 0.9 }}
                animation="quick"
              >
                <Text color="#000" fontSize={buttonTextSize} fontWeight="700">
                  ▶ Play Now
                </Text>
              </YStack>
            )}
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
                <XStack alignItems="center" gap={ss(8)}>
                  <Icon
                    name={showTrailer ? "close" : "film"}
                    color={showTrailer ? colors.text : colors.muted}
                    size={buttonTextSize}
                  />
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

      {/* Trailer iframe */}
      {showTrailer && !!trailer && (
        <YStack
          paddingHorizontal={sectionPadH}
          paddingTop={ss(isTV ? 32 : 8)}
          paddingBottom={ss(isTV ? 40 : 24)}
        >
          <iframe
            title={`${name} trailer`}
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

      {/* Meta */}
      {(data.description ||
        data.plot ||
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
          {(data.description || data.plot || data.overview) && (
            <YStack
              backgroundColor={isTV ? "rgba(26,26,46,0.6)" : "transparent"}
              padding={ss(isTV ? 24 : 0)}
              borderRadius={ss(isTV ? 12 : 0)}
              borderLeftWidth={isTV ? 4 : 0}
              borderLeftColor={isTV ? colors.accent : "transparent"}
            >
              <Text
                color={isTV ? "#e0e0e0" : colors.muted}
                fontSize={descSize}
                lineHeight={descLineHeight}
                marginBottom={ss(isTV ? 20 : 12)}
                fontWeight={isTV ? "500" : "400"}
                maxWidth="70ch"
              >
                {data.description || data.plot || data.overview}
              </Text>
            </YStack>
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
