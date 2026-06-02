import { useState, useEffect, memo } from "react";
import { Image, Linking, View, SectionList } from "react-native";
import { YStack, XStack, Text, ScrollView, Spinner } from "tamagui";
import { useApp } from "../context/AppContext";
import iptvApi from "../services/iptvApi";

const FILL = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 };

const GradientOverlay = memo(() => (
  <View style={FILL} pointerEvents="none">
    <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, top: "45%", backgroundColor: "rgba(0,0,0,0.82)" }} />
  </View>
));

const getTrailerUrl = (t) => {
  if (!t) return null;
  const m = t.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/);
  if (m) return `https://www.youtube.com/watch?v=${m[1]}`;
  if (/^[A-Za-z0-9_-]{11}$/.test(t.trim())) return `https://www.youtube.com/watch?v=${t.trim()}`;
  return null;
};

const getEpisodeNumber = (ep) => {
  let num = ep.episode_num;
  if (ep.title) {
    const m = ep.title.match(/S\d+E(\d+)/i) || ep.title.match(/E(\d+)/i);
    if (m?.[1]) num = m[1];
  }
  return num;
};

export default function SeriesDetail({ item, onBack, onPlayEpisode }) {
  const { watchHistory, isInMyList, addToMyList, removeFromMyList } = useApp();
  const [info, setInfo] = useState(null);
  const [episodes, setEpisodes] = useState({});
  const [showEpisodes, setShowEpisodes] = useState(false);

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
    iptvApi.getSeriesInfo(seriesId)
      .then((result) => { setInfo(result.info || {}); setEpisodes(result.episodes || {}); })
      .catch(() => setInfo({}));
  }, [seriesId]);

  const isLoading = info === null;
  const data = info || {};
  const backdrop = data.backdrop_path?.[0] || data.cover || cover;
  const year = (data.release_date || data.releasedate || "").slice(0, 4);

  // TV / keyboard navigation
  useEffect(() => {
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
  }, [showEpisodes, isLoading, historyEntry]);
  const trailer = getTrailerUrl(data.youtube_trailer);

  const handleEpisodePress = (ep, seasonNum) => {
    const epNum = getEpisodeNumber(ep);
    const url = iptvApi.buildStreamUrl("series", ep.id, ep.container_extension || "mp4");
    onPlayEpisode({
      type: "series", streamId: ep.id, seriesId, seriesName,
      name: `${seriesName} — S${String(seasonNum).padStart(2, "0")}E${String(epNum).padStart(2, "0")}`,
      url, cover, seasonNum, episodeNum: epNum, seriesSeasons: episodes, startTime: 0,
    });
  };

  const handleContinue = () => {
    const url = historyEntry.url || iptvApi.buildStreamUrl("series", historyEntry.streamId, "mp4");
    onPlayEpisode({ ...historyEntry, url, startTime: historyEntry.currentTime || 0 });
  };

  // ── Episodes view ─────────────────────────────────────────────────────────
  if (showEpisodes) {
    const sections = Object.keys(episodes)
      .sort((a, b) => parseInt(a) - parseInt(b))
      .map((num) => ({ title: `Season ${num}`, seasonNum: num, data: episodes[num] || [] }));

    return (
      <YStack flex={1} backgroundColor="#0f0f23">
        <XStack alignItems="center" gap={14} paddingHorizontal={16} paddingTop={16} paddingBottom={14} borderBottomWidth={1} borderBottomColor="#2a2a4e">
          <YStack paddingVertical={8} paddingHorizontal={12} backgroundColor="#1a1a2e" borderRadius={8} cursor="pointer" onPress={() => setShowEpisodes(false)} pressStyle={{ opacity: 0.8 }}>
            <Text color="#e94560" fontSize={14} fontWeight="600">← Back</Text>
          </YStack>
          <Text color="#fff" fontSize={18} fontWeight="700" flex={1} numberOfLines={1}>{seriesName}</Text>
        </XStack>
        <SectionList
          sections={sections}
          keyExtractor={(ep) => String(ep.id)}
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12, paddingBottom: 80 }}
          showsVerticalScrollIndicator={false}
          renderSectionHeader={({ section: { title } }) => (
            <YStack backgroundColor="#16213e" paddingHorizontal={14} paddingVertical={10} marginBottom={6} marginTop={12} borderRadius={8}>
              <Text color="#e94560" fontSize={15} fontWeight="700">{title}</Text>
            </YStack>
          )}
          renderItem={({ item: ep, section }) => (
            <XStack alignItems="center" backgroundColor="#1a1a2e" borderRadius={10} padding={12} marginBottom={6} borderWidth={1} borderColor="#2a2a4e" cursor="pointer" onPress={() => handleEpisodePress(ep, section.seasonNum)} pressStyle={{ opacity: 0.8 }} hoverStyle={{ borderColor: "#e94560" }} animation="quick">
              <YStack backgroundColor="#e94560" borderRadius={6} paddingHorizontal={8} paddingVertical={4} marginRight={12}>
                <Text color="#fff" fontSize={12} fontWeight="700">E{getEpisodeNumber(ep)}</Text>
              </YStack>
              <YStack flex={1}>
                <Text color="#fff" fontSize={14} numberOfLines={1}>{ep.title || "Untitled"}</Text>
                {!!ep.info?.duration && <Text color="#888" fontSize={12} marginTop={2}>{ep.info.duration}</Text>}
              </YStack>
              <Text color="#e94560" fontSize={16}>▶</Text>
            </XStack>
          )}
        />
      </YStack>
    );
  }

  // ── Hero / detail view ────────────────────────────────────────────────────
  return (
    <ScrollView flex={1} backgroundColor="#0f0f23" contentContainerStyle={{ paddingBottom: 80 }} showsVerticalScrollIndicator={false}>
      <YStack width="100%" height={420} position="relative">
        {backdrop
          ? <Image source={{ uri: backdrop }} style={FILL} resizeMode="cover" />
          : <View style={[FILL, { backgroundColor: "#16213e" }]} />}
        <GradientOverlay />

        <YStack position="absolute" top={50} left={16} zIndex={10} paddingVertical={8} paddingHorizontal={14} backgroundColor="rgba(0,0,0,0.55)" borderRadius={8} cursor="pointer" onPress={onBack} pressStyle={{ opacity: 0.8 }}>
          <Text color="#e94560" fontSize={14} fontWeight="600">← Back</Text>
        </YStack>

        <YStack position="absolute" bottom={0} left={16} right={16} zIndex={5} paddingBottom={24}>
          <Text color="#fff" fontSize={28} fontWeight="900" letterSpacing={-0.5} marginBottom={10}>{seriesName}</Text>

          {isLoading ? (
            <Spinner color="#e94560" marginVertical={12} />
          ) : (
            <XStack alignItems="center" gap={8} marginBottom={16} flexWrap="wrap">
              {year ? <YStack borderWidth={1} borderColor="#3a3a5e" borderRadius={4} paddingHorizontal={8} paddingVertical={3}><Text color="#aaa" fontSize={12}>{year}</Text></YStack> : null}
              {data.genre ? <YStack borderWidth={1} borderColor="#3a3a5e" borderRadius={4} paddingHorizontal={8} paddingVertical={3}><Text color="#aaa" fontSize={12}>{data.genre.split(",")[0].trim()}</Text></YStack> : null}
              {data.rating ? <Text color="#ffd700" fontSize={13} fontWeight="600">⭐ {Number.parseFloat(data.rating).toFixed(1)}</Text> : null}
            </XStack>
          )}

          <XStack alignItems="center" gap={10} flexWrap="wrap">
            {historyEntry && (
              <YStack backgroundColor="#fff" paddingHorizontal={24} paddingVertical={12} borderRadius={8} cursor="pointer" onPress={handleContinue} pressStyle={{ opacity: 0.85 }} hoverStyle={{ opacity: 0.9 }} animation="quick">
                <Text color="#000" fontSize={15} fontWeight="700">
                  {"▶  Continue"}
                  {historyEntry.seasonNum ? ` S${historyEntry.seasonNum}E${String(historyEntry.episodeNum).padStart(2, "0")}` : ""}
                </Text>
              </YStack>
            )}
            <YStack
              backgroundColor={historyEntry ? "rgba(40,40,60,0.85)" : "#fff"}
              paddingHorizontal={historyEntry ? 20 : 24}
              paddingVertical={12}
              borderRadius={8}
              borderWidth={historyEntry ? 1 : 0}
              borderColor="#3a3a5e"
              cursor="pointer"
              onPress={() => setShowEpisodes(true)}
              pressStyle={{ opacity: 0.8 }}
              hoverStyle={{ borderColor: "#fff" }}
              animation="quick"
            >
              <Text color={historyEntry ? "#fff" : "#000"} fontSize={15} fontWeight={historyEntry ? "600" : "700"}>☰  Browse Episodes</Text>
            </YStack>
            {!isLoading && !!trailer && (
              <YStack backgroundColor="rgba(40,40,60,0.85)" paddingHorizontal={20} paddingVertical={12} borderRadius={8} borderWidth={1} borderColor="#3a3a5e" cursor="pointer" onPress={() => Linking.openURL(trailer)} pressStyle={{ opacity: 0.8 }} hoverStyle={{ borderColor: "#fff" }} animation="quick">
                <Text color="#fff" fontSize={15} fontWeight="600">🎬  Trailer</Text>
              </YStack>
            )}
            <YStack
              backgroundColor={inFav ? "rgba(233,69,96,0.15)" : "rgba(40,40,60,0.85)"}
              paddingHorizontal={20}
              paddingVertical={12}
              borderRadius={8}
              borderWidth={1}
              borderColor={inFav ? "#e94560" : "#3a3a5e"}
              cursor="pointer"
              onPress={toggleFav}
              pressStyle={{ opacity: 0.8 }}
              hoverStyle={{ borderColor: "#e94560" }}
              animation="quick"
            >
              <Text color="#fff" fontSize={15} fontWeight="600">{inFav ? "♥  Saved" : "♡  Favorites"}</Text>
            </YStack>
          </XStack>
        </YStack>
      </YStack>

      {(data.plot || data.description || data.overview || data.cast || data.director) ? (
        <YStack paddingHorizontal={16} paddingTop={20} gap={10}>
          {(data.plot || data.description || data.overview) ? (
            <Text color="#ccc" fontSize={14} lineHeight={22} marginBottom={10}>
              {data.plot || data.description || data.overview}
            </Text>
          ) : null}
          {data.cast ? <Text color="#aaa" fontSize={13} lineHeight={20}><Text color="#fff" fontWeight="700">Cast  </Text>{data.cast}</Text> : null}
          {data.director ? <Text color="#aaa" fontSize={13} lineHeight={20}><Text color="#fff" fontWeight="700">Director  </Text>{data.director}</Text> : null}
        </YStack>
      ) : null}
    </ScrollView>
  );
}
