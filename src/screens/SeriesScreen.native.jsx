import { useState, useEffect, useCallback } from "react";
import { FlatList, RefreshControl, useWindowDimensions } from "react-native";
import { YStack, XStack, Text, Input, Spinner } from "../ui/primitives";
import { colors, fonts, fontWeights } from "../ui/tokens";
import StatePanel from "../ui/StatePanel";
import { emptyContentProps } from "../ui/emptyContentProps";
import Icon from "../ui/Icon";
import { useSeries } from "../domain/hooks/useSeries";
import { useDownloads } from "../downloads/useDownloads.jsx";
import { useTVNavigation } from "../hooks/useTVNavigation";
import SeriesDetail from "../components/SeriesDetail";
import ContentShelf from "../presentation/components/ContentShelf.native";
import PosterCard from "../presentation/components/PosterCard.native";
import { posterGrid, GRID_TARGET_W } from "../utils/posterLayout";

const GRID_PAGE = 40;
const GRID_OUTER = 16; // equal left/right screen margin
const GRID_GAP = 12; // gap between posters (columns and rows)

/* ─── Category Page ─── */
function CategoryPage({ name, items, onBack, onPress, onLoadMore, hasRemote, loadingMore }) {
  const [displayCount, setDisplayCount] = useState(GRID_PAGE);
  const [search, setSearch] = useState("");
  const { width: winW } = useWindowDimensions();
  // Column count is DERIVED from the screen width (Electron's density model):
  // ~3 across on a phone, more on a tablet, posters sized to fill the row.
  const { cols, cardW } = posterGrid(winW - GRID_OUTER * 2, { target: GRID_TARGET_W, gap: GRID_GAP });
  const filtered = items ? (search.trim() ? items.filter((i) => i.name?.toLowerCase().includes(search.toLowerCase())) : items) : null;
  const displayed = filtered ? filtered.slice(0, displayCount) : null;
  const hasLocalMore = filtered && displayCount < filtered.length;
  const hasMore = hasLocalMore || hasRemote;
  useEffect(() => { setDisplayCount(GRID_PAGE); }, [search]);

  return (
    <YStack flex={1} backgroundColor={colors.bg}>
      <XStack alignItems="center" gap={12} paddingHorizontal={16} paddingTop={16} paddingBottom={10} borderBottomWidth={1} borderBottomColor={colors.border}>
        <XStack alignItems="center" gap={8} paddingVertical={8} paddingHorizontal={12} backgroundColor={colors.surface2} borderRadius={8} cursor="pointer" onPress={onBack} pressStyle={{ opacity: 0.8 }}>
          <Icon name="back" size={16} color={colors.accent} />
          <Text color={colors.accent} fontSize={14} fontWeight={fontWeights.medium}>Back</Text>
        </XStack>
        <Text color={colors.text} fontFamily={fonts.display} fontSize={18} fontWeight={fontWeights.bold} flex={1} numberOfLines={1}>{name}</Text>
        {filtered != null && (
          <YStack backgroundColor="rgba(255,255,255,0.07)" borderRadius={20} paddingHorizontal={10} paddingVertical={4}>
            <Text color={colors.muted} fontSize={12} fontWeight="600">{filtered.length.toLocaleString()}</Text>
          </YStack>
        )}
      </XStack>
      <Input margin={12} placeholder="Search titles..." placeholderTextColor="#555" value={search} onChangeText={setSearch} backgroundColor={colors.surface2} color={colors.text} borderRadius={10} paddingHorizontal={14} paddingVertical={10} fontSize={14} borderWidth={1} borderColor={colors.border} />
      {!displayed ? (
        <YStack flex={1} justifyContent="center" alignItems="center"><Spinner size="large" color={colors.accent} /></YStack>
      ) : (
        <FlatList
          key={`grid-${cols}`}
          style={{ flex: 1 }}
          data={displayed}
          keyExtractor={(item) => String(item.series_id)}
          numColumns={cols}
          contentContainerStyle={{ paddingHorizontal: GRID_OUTER, paddingVertical: 12 }}
          columnWrapperStyle={{ gap: GRID_GAP, marginBottom: GRID_GAP }}
          renderItem={({ item }) => <PosterCard item={item} onPress={onPress} width={cardW} />}
          onEndReached={() => { if (hasLocalMore) setDisplayCount((c) => Math.min(c + GRID_PAGE, filtered.length)); else if (hasRemote && !loadingMore && onLoadMore) onLoadMore(); }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={(hasMore || loadingMore) ? <YStack alignItems="center" paddingVertical={20}><Spinner size="small" color={colors.accent} /></YStack> : null}
          showsVerticalScrollIndicator={false}
        />
      )}
    </YStack>
  );
}

/* ─── Screen ─── */
export default function SeriesScreen({ navigation }) {
  const {
    loading, error, reload, activeUserId, shelves, discoverItems,
    handleShelfVisible, handleLoadMore, openCategory, closeCategory,
    categoryPage, isTopRatedCategory, topRatedHasMore, topRatedLoadingMore, handleTopRatedMore,
    selectedSeries, selectSeries, clearSelectedSeries, playVideoObject,
  } = useSeries({ navigation });

  const { items: downloads } = useDownloads();
  const [showDownloaded, setShowDownloaded] = useState(false);
  const downloadedEpisodes = downloads
    .filter((r) => r.kind === "episode")
    .map((r) => ({ stream_id: r.id, name: r.title, stream_icon: r.poster, __download: r }));

  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try { await reload(); } finally { setRefreshing(false); }
  };

  const { focusedRow, focusedCol } = useTVNavigation({
    active: !categoryPage && !selectedSeries,
    rows: [{ items: discoverItems, onSelect: (i) => openCategory(discoverItems[i].id, discoverItems[i].label) }],
  });

  if (loading) {
    return <StatePanel mode="loading" title="Loading series..." />;
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
        message="Check your connection and try again."
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
              backgroundColor="rgba(108, 92, 231,0.08)" borderWidth={1}
              borderColor={focusedRow === 0 && focusedCol === idx ? colors.accent2 : "rgba(108, 92, 231,0.28)"}
              borderRadius={999} cursor="pointer"
              onPress={() => openCategory(pill.id, pill.label)}
              pressStyle={{ opacity: 0.75 }} hoverStyle={{ borderColor: colors.accent }} animation="quick"
              scale={focusedRow === 0 && focusedCol === idx ? 1.05 : 1}
            >
              <Icon name={pill.id === "all" ? "tv" : "star"} size={16} color={colors.accent2} />
              <Text color={colors.text} fontSize={12} fontWeight={fontWeights.medium}>{pill.label}</Text>
              <Icon name="chevron-right" size={16} color={colors.accent} />
            </XStack>
          ))}
          <XStack
            alignItems="center" gap={8} paddingHorizontal={16} paddingVertical={10}
            backgroundColor="rgba(108, 92, 231,0.08)" borderWidth={1} borderColor="rgba(108, 92, 231,0.28)"
            borderRadius={999} cursor="pointer" onPress={() => setShowDownloaded(true)}
            pressStyle={{ opacity: 0.75 }} hoverStyle={{ borderColor: colors.accent }} animation="quick"
          >
            <Text color={colors.accent2} fontSize={13} fontWeight={fontWeights.bold}>⬇</Text>
            <Text color={colors.text} fontSize={12} fontWeight={fontWeights.medium}>Downloaded</Text>
            {downloadedEpisodes.length > 0 && (
              <Text color={colors.accent} fontSize={12} fontWeight={fontWeights.bold}>{downloadedEpisodes.length}</Text>
            )}
          </XStack>
        </XStack>
      </YStack>
    </YStack>
  );

  return (
    <YStack flex={1} backgroundColor={colors.bg}>
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
          <CategoryPage
            name={categoryPage.name} items={categoryPage.items}
            onBack={closeCategory}
            onPress={selectSeries}
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
          <CategoryPage
            name="Downloaded"
            items={downloadedEpisodes}
            onBack={() => setShowDownloaded(false)}
            onPress={(it) => {
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
