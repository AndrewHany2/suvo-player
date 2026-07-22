import { useState, useEffect } from "react";
import { View, SectionList } from "react-native";
import { YStack, XStack, Text, ScrollView } from "../ui/primitives";
import { colors, fonts, playerScrim, radii } from "../ui/tokens";
import SkeletonBox from "../presentation/components/SkeletonBox";
import { useApp, useWatchHistory } from "../context/AppContext";
import { ss, useScale } from "../utils/scaleSize";
import { contentService } from "../domain/services/ContentService";
import ProxiedImage from "./ProxiedImage";
import { usePlatform } from "../platform";
import { useModalKeyTrap } from "../hooks/useModalKeyTrap";
import Icon from "../ui/Icon";
import Button from "../ui/Button";
import { LABELS } from "../ui/labels";

const FILL = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 };

// Caps the detail content width on ultrawide monitors (centered via margin auto).
const MAX_W = 1700;

import { getTrailerEmbedUrl as getTrailerUrl } from "../utils/youtubeTrailer";

// Single shared back affordance for detail heroes that sit over a backdrop:
// one rgba scrim pill with the `back` glyph. Movie and Series render it
// identically.
function BackPill({ isTV, onBack, sectionPadH, size }) {
  return (
    <YStack
      position="absolute"
      top={ss(isTV ? 40 : 20)}
      left={sectionPadH}
      zIndex={10}
      paddingVertical={ss(isTV ? 14 : 8)}
      paddingHorizontal={ss(isTV ? 24 : 14)}
      backgroundColor={playerScrim.panel}
      borderRadius={ss(isTV ? 12 : 8)}
      cursor="pointer"
      onPress={onBack}
      pressStyle={{ opacity: 0.8 }}
      // Desktop keyboard access (WCAG 2.1.1): focusable control with
      // Enter/Space activation, matching the episode rows' pattern.
      role="button"
      tabIndex={0}
      aria-label="Back"
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
          e.preventDefault();
          onBack();
        }
      }}
    >
      <XStack alignItems="center" gap={ss(isTV ? 8 : 6)}>
        <Icon name="back" color={colors.accent} size={size} />
        <Text
          color={colors.accentText}
          fontSize={size}
          fontWeight={isTV ? "700" : "600"}
        >
          Back
        </Text>
      </XStack>
    </YStack>
  );
}

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
  const { isInMyList, addToMyList, removeFromMyList, activeUserId } = useApp();
  const { watchHistory } = useWatchHistory();
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
    contentService
      .getSeriesInfoRaw(seriesId)
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
    const url = contentService.buildEpisodeUrl(ep.id, ep.container_extension || "mp4");
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
      contentService.buildEpisodeUrl(historyEntry.streamId, "mp4");
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
      <YStack flex={1} minHeight={0} backgroundColor={colors.bg}>
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
            // Desktop keyboard access (WCAG 2.1.1): focusable control with
            // Enter/Space activation, matching the episode rows' pattern.
            role="button"
            tabIndex={0}
            aria-label="Back"
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
                e.preventDefault();
                setShowEpisodes(false);
              }
            }}
          >
            <XStack alignItems="center" gap={ss(isTV ? 8 : 6)}>
              <Icon name="back" color={colors.accent} size={epBackSize} />
              <Text
                color={colors.accentText}
                fontSize={epBackSize}
                fontWeight={isTV ? "700" : "600"}
              >
                Back
              </Text>
            </XStack>
          </YStack>
          <Text
            color={colors.text}
            fontFamily={fonts.display}
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
          style={{ flex: 1, minHeight: 0 }}
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
              <Text color={colors.accentText} fontSize={epHeaderSize} fontWeight="700">
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
              // hoverStyle is dropped by the web primitives here, so the real
              // hover/focus border is drawn by the `.suvo-episode-row` CSS rule
              // (cyan accent2, per Single-Light). Kept for native parity.
              hoverStyle={{ borderColor: colors.accent2 }}
              animation="quick"
              // Desktop keyboard access (WCAG 2.1.1): focusable control with
              // Enter/Space activation; the cyan focus ring comes from the CSS rule.
              role="button"
              tabIndex={0}
              aria-label={ep.title || "Episode"}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
                  e.preventDefault();
                  handleEpisodePress(ep, section.seasonNum);
                }
              }}
              {...{ className: "suvo-episode-row" }}
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
                  <Text color={colors.textStrong} fontSize={epNumSize} fontWeight="700">
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
                      color={colors.textDim}
                      fontSize={epDurationSize}
                      marginTop={ss(isTV ? 6 : 2)}
                    >
                      {ep.info.duration}
                    </Text>
                  )}
                </YStack>
                <YStack marginLeft={ss(isTV ? 16 : 8)}>
                  <Icon name="play" color={colors.muted} size={ss(isTV ? 24 : 16)} />
                </YStack>
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
              background: `linear-gradient(to top, ${colors.bg} 0%, rgba(10, 14, 26,0.6) 55%, rgba(10, 14, 26,0.15) 100%)`,
            },
          ]}
        />

        <BackPill
          isTV={isTV}
          onBack={onBack}
          sectionPadH={sectionPadH}
          size={backSize}
        />

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
            fontFamily={fonts.display}
            fontSize={titleSize}
            fontWeight="700"
            letterSpacing={isTV ? -1.5 : -1}
            marginBottom={ss(isTV ? 20 : 12)}
          >
            {seriesName}
          </Text>

          {isLoading ? (
            // Chip-row skeleton (year / rating / seasons) instead of a spinner,
            // so the meta row holds its shape until enrichment lands.
            <XStack gap={ss(8)} marginVertical={ss(12)} aria-hidden>
              {[70, 54, 92].map((w, i) => (
                <SkeletonBox key={i} width={ss(w)} height={ss(28)} radius={radii.sm} />
              ))}
            </XStack>
          ) : (
            <XStack
              alignItems="center"
              gap={ss(8)}
              marginBottom={ss(14)}
              flexWrap="wrap"
            >
              {year ? (
                <YStack
                  // Opaque scrim fill: the meta text is muted steel and sits over
                  // arbitrary photographic backdrop art (before/behind the hero
                  // gradient), so a solid dark chip guarantees AA contrast
                  // regardless of what's underneath.
                  backgroundColor={colors.surface}
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
                  backgroundColor={colors.surface}
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
              <Button
                variant="primary"
                size={isTV ? "lg" : "md"}
                icon="play"
                onPress={handleContinue}
              >
                {historyEntry.seasonNum
                  ? `Continue S${historyEntry.seasonNum}E${String(historyEntry.episodeNum).padStart(2, "0")}`
                  : "Continue"}
              </Button>
            )}
            <Button
              variant={historyEntry ? "secondary" : "primary"}
              size={isTV ? "lg" : "md"}
              icon="series"
              onPress={() => setShowEpisodes(true)}
            >
              Browse Episodes
            </Button>
            {!isLoading && !!trailer && (
              <Button
                variant="secondary"
                size={isTV ? "lg" : "md"}
                icon={showTrailer ? "close" : "film"}
                onPress={() => setShowTrailer((v) => !v)}
              >
                {showTrailer ? "Close Trailer" : "Watch Trailer"}
              </Button>
            )}
            {activeUserId ? (
              <Button
                variant="secondary"
                size={isTV ? "lg" : "md"}
                icon={inFav ? "check" : "plus"}
                onPress={toggleFav}
                style={inFav ? { borderColor: colors.accent } : undefined}
              >
                {inFav ? LABELS.inMyList : LABELS.myList}
              </Button>
            ) : null}
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
            src={`${trailer}?autoplay=1&mute=1&rel=0&modestbranding=1`}
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
