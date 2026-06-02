import { useState, useEffect } from "react";
import { View } from "react-native";
import { YStack, XStack, Text, ScrollView, Spinner } from "tamagui";
import { useApp } from "../context/AppContext";
import iptvApi from "../services/iptvApi";
import ProxiedImage from "./ProxiedImage";

const FILL = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 };

const getTrailerUrl = (t) => {
  if (!t) return null;
  const m = t.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/);
  if (m) return `https://www.youtube-nocookie.com/embed/${m[1]}`;
  if (/^[A-Za-z0-9_-]{11}$/.test(t.trim()))
    return `https://www.youtube-nocookie.com/embed/${t.trim()}`;
  return null;
};

export default function MovieDetail({ item, onBack, onPlay }) {
  const { watchHistory, isInMyList, addToMyList, removeFromMyList } = useApp();
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
    iptvApi
      .getVODInfo(streamId)
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

  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape" || e.keyCode === 27) onBack();
      else if ((e.key === "Enter" || e.keyCode === 13) && !isLoading) {
        handlePlay(resumeTime > 0 ? resumeTime : 0);
      }
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  }, [resumeTime, isLoading]);

  const handlePlay = (startTime) => {
    const url = iptvApi.buildStreamUrl(
      "movie",
      streamId,
      item.container_extension || "mp4",
    );
    onPlay({ type: "movies", streamId, name, url, cover, startTime });
  };

  return (
    <ScrollView
      flex={1}
      backgroundColor="#0f0f23"
      contentContainerStyle={{ paddingBottom: 80 }}
    >
      {/* Hero */}
      <YStack width="100%" height={520} position="relative" overflow="hidden">
        <ProxiedImage
          source={{ uri: backdrop }}
          style={FILL}
          resizeMode="cover"
          fallbackColor="#16213e"
        />
        {/* CSS gradient — keep as raw View since Tamagui doesn't forward the `background` CSS prop */}
        <View
          style={[
            FILL,
            {
              background:
                "linear-gradient(to top, #0f0f23 0%, rgba(15,15,35,0.6) 55%, rgba(15,15,35,0.15) 100%)",
            },
          ]}
        />

        <YStack
          position="absolute"
          top={20}
          left={48}
          zIndex={10}
          paddingVertical={8}
          paddingHorizontal={14}
          backgroundColor="rgba(0,0,0,0.55)"
          borderRadius={8}
          cursor="pointer"
          onPress={onBack}
          pressStyle={{ opacity: 0.8 }}
        >
          <Text color="#e94560" fontSize={14} fontWeight="600">
            ← Back
          </Text>
        </YStack>

        <YStack
          position="absolute"
          bottom={0}
          left={48}
          right={48}
          zIndex={5}
          paddingBottom={40}
        >
          <Text
            color="#fff"
            fontSize={40}
            fontWeight="900"
            letterSpacing={-1}
            marginBottom={12}
          >
            {name}
          </Text>

          {isLoading ? (
            <Spinner color="#e94560" marginVertical={12} />
          ) : (
            <XStack
              alignItems="center"
              gap={8}
              marginBottom={14}
              flexWrap="wrap"
            >
              {year ? (
                <YStack
                  borderWidth={1}
                  borderColor="#3a3a5e"
                  borderRadius={4}
                  paddingHorizontal={8}
                  paddingVertical={3}
                >
                  <Text color="#aaa" fontSize={12}>
                    {year}
                  </Text>
                </YStack>
              ) : null}
              {data.genre ? (
                <YStack
                  borderWidth={1}
                  borderColor="#3a3a5e"
                  borderRadius={4}
                  paddingHorizontal={8}
                  paddingVertical={3}
                >
                  <Text color="#aaa" fontSize={12}>
                    {data.genre.split(",")[0].trim()}
                  </Text>
                </YStack>
              ) : null}
              {data.rating ? (
                <Text color="#ffd700" fontSize={13} fontWeight="600">
                  ⭐ {Number.parseFloat(data.rating).toFixed(1)}
                </Text>
              ) : null}
              {data.age ? (
                <YStack
                  borderWidth={1}
                  borderColor="#e94560"
                  borderRadius={4}
                  paddingHorizontal={8}
                  paddingVertical={3}
                >
                  <Text color="#e94560" fontSize={12}>
                    {data.age}
                  </Text>
                </YStack>
              ) : null}
            </XStack>
          )}

          <XStack alignItems="center" gap={12} flexWrap="wrap">
            {resumeTime > 0 ? (
              <>
                <YStack
                  backgroundColor="#fff"
                  paddingHorizontal={28}
                  paddingVertical={13}
                  borderRadius={8}
                  cursor="pointer"
                  onPress={() => handlePlay(resumeTime)}
                  pressStyle={{ opacity: 0.85 }}
                  hoverStyle={{ opacity: 0.9 }}
                  animation="quick"
                >
                  <Text color="#000" fontSize={15} fontWeight="700">
                    ▶ Continue
                  </Text>
                </YStack>
                <YStack
                  backgroundColor="rgba(40,40,60,0.85)"
                  paddingHorizontal={22}
                  paddingVertical={13}
                  borderRadius={8}
                  borderWidth={1}
                  borderColor="#3a3a5e"
                  cursor="pointer"
                  onPress={() => handlePlay(0)}
                  pressStyle={{ opacity: 0.8 }}
                  hoverStyle={{ borderColor: "#fff" }}
                  animation="quick"
                >
                  <Text color="#fff" fontSize={15} fontWeight="600">
                    ↺ From Start
                  </Text>
                </YStack>
              </>
            ) : (
              <YStack
                backgroundColor="#fff"
                paddingHorizontal={28}
                paddingVertical={13}
                borderRadius={8}
                cursor="pointer"
                onPress={() => handlePlay(0)}
                pressStyle={{ opacity: 0.85 }}
                hoverStyle={{ opacity: 0.9 }}
                animation="quick"
              >
                <Text color="#000" fontSize={15} fontWeight="700">
                  ▶ Play Now
                </Text>
              </YStack>
            )}
            {!isLoading && !!trailer && (
              <YStack
                backgroundColor="rgba(40,40,60,0.85)"
                paddingHorizontal={22}
                paddingVertical={13}
                borderRadius={8}
                borderWidth={1}
                borderColor="#3a3a5e"
                cursor="pointer"
                onPress={() => setShowTrailer((v) => !v)}
                pressStyle={{ opacity: 0.8 }}
                hoverStyle={{ borderColor: "#fff" }}
                animation="quick"
              >
                <Text color="#fff" fontSize={15} fontWeight="600">
                  {showTrailer ? "✕  Close" : "🎬  Trailer"}
                </Text>
              </YStack>
            )}
            <YStack
              backgroundColor={
                inFav ? "rgba(233,69,96,0.15)" : "rgba(40,40,60,0.85)"
              }
              paddingHorizontal={22}
              paddingVertical={13}
              borderRadius={8}
              borderWidth={1}
              borderColor={inFav ? "#e94560" : "#3a3a5e"}
              cursor="pointer"
              onPress={toggleFav}
              pressStyle={{ opacity: 0.8 }}
              hoverStyle={{ borderColor: "#e94560" }}
              animation="quick"
            >
              <Text color="#fff" fontSize={15} fontWeight="600">
                {inFav ? "♥  Saved" : "♡  Favorites"}
              </Text>
            </YStack>
          </XStack>
        </YStack>
      </YStack>

      {/* Trailer iframe */}
      {showTrailer && !!trailer && (
        <YStack paddingHorizontal={48} paddingTop={8} paddingBottom={24}>
          <iframe
            title={`${name} trailer`}
            src={`${trailer}?autoplay=1`}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            style={{
              width: "100%",
              height: 420,
              border: "none",
              borderRadius: 8,
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
        <YStack paddingHorizontal={48} paddingTop={24} gap={10}>
          {(data.description || data.plot || data.overview) && (
            <Text color="#ccc" fontSize={15} lineHeight={24} marginBottom={12}>
              {data.description || data.plot || data.overview}
            </Text>
          )}
          {data.cast && (
            <Text color="#aaa" fontSize={14} lineHeight={20}>
              <Text color="#fff" fontWeight="700">
                Cast{" "}
              </Text>
              {data.cast}
            </Text>
          )}
          {data.director && (
            <Text color="#aaa" fontSize={14} lineHeight={20}>
              <Text color="#fff" fontWeight="700">
                Director{" "}
              </Text>
              {data.director}
            </Text>
          )}
        </YStack>
      )}
    </ScrollView>
  );
}
