import { useState, useEffect, useCallback } from "react";
import { FlatList, RefreshControl } from "react-native";
import { YStack, XStack, Text } from "../ui/primitives";
import { colors, fonts, fontWeights } from "../ui/tokens";
import StatePanel from "../ui/StatePanel";
import { emptyContentProps } from "../ui/emptyContentProps";
import Icon from "../ui/Icon";
import { useSeries } from "../domain/hooks/useSeries";
import { useDownloads } from "../downloads/useDownloads.jsx";
import { useIsOnline } from "../downloads/useIsOnline.js";
import SeriesDetail from "../components/SeriesDetail";
import ContentShelf from "../presentation/components/ContentShelf.native";
import CategoryGridPage from "../presentation/components/CategoryGridPage.native";

/* ─── Screen ─── */
export default function SeriesScreen({ navigation }) {
  const {
    loading, error, errorMessage, reload, activeUserId, shelves, discoverItems,
    handleShelfVisible, handleLoadMore, openCategory, closeCategory,
    categoryPage, isTopRatedCategory, topRatedHasMore, topRatedLoadingMore, handleTopRatedMore,
    selectedSeries, selectSeries, clearSelectedSeries, playVideoObject,
  } = useSeries({ navigation });

  const { items: downloads } = useDownloads();
  const online = useIsOnline();
  const [showDownloaded, setShowDownloaded] = useState(false);
  const downloadedEpisodes = downloads
    .filter((r) => r.kind === "episode")
    .map((r) => ({ stream_id: r.id, name: r.title, stream_icon: r.poster, __download: r }));

  // When the device goes offline, auto-surface downloads (the only playable content).
  useEffect(() => { if (!online) setShowDownloaded(true); }, [online]);

  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try { await reload(); } finally { setRefreshing(false); }
  };

  if (loading) {
    // Header + placeholder shelves read as the real screen filling in, rather
    // than a lone centered spinner (ContentShelf renders its skeleton rail when
    // items===null; `manual` keeps these placeholders from firing a load).
    return (
      <YStack flex={1} backgroundColor={colors.bg}>
        <YStack paddingHorizontal={16} paddingTop={20} paddingBottom={4}>
          <Text color={colors.text} fontFamily={fonts.display} fontSize={20} fontWeight={fontWeights.bold} letterSpacing={-0.3} marginBottom={12}>Discover</Text>
        </YStack>
        {[0, 1, 2].map((i) => (
          <ContentShelf key={i} id={`skeleton-${i}`} title="" items={null} manual hasMore={false} loadingMore={false} />
        ))}
      </YStack>
    );
  }

  if (!activeUserId) {
    return (
      <StatePanel
        mode="empty"
        icon="tv"
        title="No account"
        message='Tap "Accounts" to add your media service'
        cta={() => navigation.navigate("Accounts")}
        ctaLabel="Add Account"
      />
    );
  }

  if (error) {
    return (
      <StatePanel
        mode="error"
        title="Couldn't load series"
        message={errorMessage || "Check your connection and try again."}
        onRetry={reload}
        retryLabel="Retry"
      />
    );
  }

  const listHeader = (
    <YStack>
      <YStack paddingHorizontal={16} paddingTop={20} paddingBottom={4}>
        <Text color={colors.text} fontFamily={fonts.display} fontSize={20} fontWeight={fontWeights.bold} letterSpacing={-0.3} marginBottom={12}>Discover</Text>
        <XStack gap={10} flexWrap="wrap">
          {discoverItems.map((pill, idx) => (
            <XStack
              key={pill.id}
              alignItems="center" gap={8} paddingHorizontal={16} paddingVertical={10}
              backgroundColor={colors.surface2} borderWidth={1}
              borderColor={colors.border}
              borderRadius={999} cursor="pointer"
              onPress={() => openCategory(pill.id, pill.label)}
              accessibilityRole="button" accessibilityLabel={pill.label}
              pressStyle={{ opacity: 0.75 }} hoverStyle={{ borderColor: colors.accent2 }} animation="quick"
            >
              <Icon name={pill.id === "all" ? "tv" : "star"} size={16} color={colors.muted} />
              <Text color={colors.text} fontSize={12} fontWeight={fontWeights.medium}>{pill.label}</Text>
              <Icon name="chevron-right" size={16} color={colors.muted} />
            </XStack>
          ))}
          <XStack
            alignItems="center" gap={8} paddingHorizontal={16} paddingVertical={10}
            backgroundColor={colors.surface2} borderWidth={1} borderColor={colors.border}
            borderRadius={999} cursor="pointer" onPress={() => setShowDownloaded(true)}
            accessibilityRole="button" accessibilityLabel="Downloaded"
            pressStyle={{ opacity: 0.75 }} hoverStyle={{ borderColor: colors.accent2 }} animation="quick"
          >
            <Icon name="download" size={16} color={colors.muted} />
            <Text color={colors.text} fontSize={12} fontWeight={fontWeights.medium}>Downloaded</Text>
            {downloadedEpisodes.length > 0 && (
              <Text color={colors.muted} fontSize={12} fontWeight={fontWeights.bold}>{downloadedEpisodes.length}</Text>
            )}
          </XStack>
        </XStack>
      </YStack>
    </YStack>
  );

  return (
    <YStack flex={1} backgroundColor={colors.bg}>
      {!online && (
        <YStack paddingVertical={8} paddingHorizontal={16} backgroundColor={colors.surface2} borderBottomWidth={1} borderBottomColor={colors.border}>
          <Text color={colors.muted} fontSize={13} fontWeight="600">You're offline — showing your downloads.</Text>
        </YStack>
      )}
      <FlatList
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 80 }}
        showsVerticalScrollIndicator={false}
        data={shelves}
        keyExtractor={(item) => String(item.id)}
        ListHeaderComponent={listHeader}
        renderItem={({ item }) => (
          <ContentShelf
            id={item.id}
            title={item.name} count={item.totalCount} items={item.items}
            hasMore={item.hasMore} loadingMore={item.loadingMore} manual={item.manual}
            onVisible={handleShelfVisible}
            onPress={selectSeries}
            onTitlePress={openCategory}
            onLoadMore={handleLoadMore}
          />
        )}
        ListEmptyComponent={<StatePanel mode="empty" {...emptyContentProps("series")} />}
        windowSize={5} maxToRenderPerBatch={3} initialNumToRender={3} removeClippedSubviews
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.accent} colors={[colors.accent]} />}
      />
      {categoryPage && (
        <YStack position="absolute" top={0} left={0} right={0} bottom={0}>
          <CategoryGridPage
            name={categoryPage.name} items={categoryPage.items}
            keyField="series_id"
            onBack={closeCategory}
            onSelect={selectSeries}
            hasRemote={isTopRatedCategory && topRatedHasMore} loadingMore={isTopRatedCategory && topRatedLoadingMore}
            onLoadMore={isTopRatedCategory ? handleTopRatedMore : undefined}
          />
        </YStack>
      )}
      {selectedSeries && (
        <YStack position="absolute" top={0} left={0} right={0} bottom={0}>
          <SeriesDetail
            item={selectedSeries}
            onBack={clearSelectedSeries}
            onPlayEpisode={(videoObj) => { playVideoObject(videoObj); clearSelectedSeries(); }}
          />
        </YStack>
      )}
      {showDownloaded && (
        <YStack position="absolute" top={0} left={0} right={0} bottom={0}>
          <CategoryGridPage
            name="Downloaded"
            items={downloadedEpisodes}
            keyField="stream_id"
            onBack={() => setShowDownloaded(false)}
            onSelect={(it) => {
              const rec = it.__download;
              if (!rec) return;
              // Play straight from the local file — no network needed.
              playVideoObject({ type: "series", streamId: rec.id, seriesId: rec.seriesId, name: rec.title, url: rec.localPath, cover: rec.poster, seasonNum: rec.season, episodeNum: rec.episode, startTime: 0 });
              setShowDownloaded(false);
            }}
          />
        </YStack>
      )}
    </YStack>
  );
}
