import { useEffect, useState } from "react";
import { FlatList } from "react-native";
import { YStack, XStack, Text } from "../ui/primitives";
import { useMovies } from "../domain/hooks/useMovies";
import { useDownloads } from "../downloads/useDownloads.jsx";
import { useIsOnline } from "../downloads/useIsOnline.js";
import ContentShelf from "../presentation/components/ContentShelf.native";
import CategoryGridPage from "../presentation/components/CategoryGridPage.native";
import MovieDetail from "../components/MovieDetail";
import { colors, accentAlpha } from "../ui/tokens";
import StatePanel from "../ui/StatePanel";
import { emptyContentProps } from "../ui/emptyContentProps";
import Icon from "../ui/Icon";
import { getShelfConfig } from "../presentation/virtualization/shelfConfig.js";

/* ─── Screen ─── */
export default function MoviesScreen({ navigation }) {
  const {
    loading, error, errorMessage, reload, activeUserId, shelves, discoverItems,
    handleShelfVisible, handleLoadMore, openCategory, closeCategory,
    categoryPage, isTopRatedCategory, topRatedHasMore, topRatedLoadingMore, handleTopRatedMore,
    selectedMovie, selectMovie, clearSelectedMovie, playVideoObject,
  } = useMovies({ navigation });

  const { items: downloads } = useDownloads();
  const online = useIsOnline();
  const [showDownloaded, setShowDownloaded] = useState(false);
  const downloadedMovies = downloads
    .filter((r) => r.kind === "movie")
    .map((r) => ({ stream_id: r.id, name: r.title, stream_icon: r.poster, __download: r }));

  // When the device goes offline, auto-surface downloads (the only playable content).
  useEffect(() => { if (!online) setShowDownloaded(true); }, [online]);

  const vcfg = getShelfConfig("native");

  if (loading) {
    return <StatePanel mode="loading" title="Loading movies..." />;
  }

  if (!activeUserId) {
    return (
      <StatePanel
        mode="empty"
        icon="film"
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
        title="Couldn't load movies"
        message={errorMessage || "Check your connection and try again."}
        onRetry={reload}
        retryLabel="Retry"
      />
    );
  }

  const listHeader = (
    <YStack>
      <YStack paddingHorizontal={16} paddingTop={20} paddingBottom={4}>
        <Text color={colors.text} fontSize={20} fontWeight="700" letterSpacing={-0.3} marginBottom={12}>Discover</Text>
        <XStack gap={10} flexWrap="wrap">
          {discoverItems.map((pill, idx) => (
            <XStack
              key={pill.id} alignItems="center" gap={8} paddingHorizontal={16} paddingVertical={10}
              backgroundColor={accentAlpha(0.08)} borderWidth={1}
              borderColor={accentAlpha(0.28)}
              borderRadius={999} cursor="pointer" onPress={() => openCategory(pill.id, pill.label)}
              pressStyle={{ opacity: 0.75 }} hoverStyle={{ borderColor: colors.accent }}
            >
              <Icon name={pill.id === "all" ? "film" : "star"} size={14} color={colors.muted} />
              <Text color={colors.text} fontSize={12} fontWeight="600">{pill.label}</Text>
              <Icon name="chevron-right" size={14} color={colors.accent} />
            </XStack>
          ))}
          <XStack
            alignItems="center" gap={8} paddingHorizontal={16} paddingVertical={10}
            backgroundColor={accentAlpha(0.08)} borderWidth={1} borderColor={accentAlpha(0.28)}
            borderRadius={999} onPress={() => setShowDownloaded(true)}
          >
            <Text color={colors.muted} fontSize={13} fontWeight="700">⬇</Text>
            <Text color={colors.text} fontSize={12} fontWeight="600">Downloaded</Text>
            {downloadedMovies.length > 0 && (
              <Text color={colors.accent} fontSize={12} fontWeight="700">{downloadedMovies.length}</Text>
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
            onPress={selectMovie}
            onTitlePress={openCategory}
            onLoadMore={handleLoadMore}
          />
        )}
        ListEmptyComponent={<StatePanel mode="empty" {...emptyContentProps("movies")} />}
        windowSize={5}
        maxToRenderPerBatch={3}
        initialNumToRender={2 + vcfg.vOverscan}
        removeClippedSubviews
      />
      {categoryPage && (
        <YStack position="absolute" top={0} left={0} right={0} bottom={0}>
          <CategoryGridPage
            name={categoryPage.name}
            items={categoryPage.items}
            keyField="stream_id"
            onBack={closeCategory}
            onSelect={selectMovie}
            hasRemote={isTopRatedCategory && topRatedHasMore}
            loadingMore={isTopRatedCategory && topRatedLoadingMore}
            onLoadMore={isTopRatedCategory ? handleTopRatedMore : undefined}
          />
        </YStack>
      )}
      {selectedMovie && (
        <YStack position="absolute" top={0} left={0} right={0} bottom={0}>
          <MovieDetail
            item={selectedMovie}
            onBack={clearSelectedMovie}
            onPlay={(videoObj) => { playVideoObject(videoObj); clearSelectedMovie(); }}
          />
        </YStack>
      )}
      {showDownloaded && (
        <YStack position="absolute" top={0} left={0} right={0} bottom={0}>
          <CategoryGridPage
            name="Downloaded"
            items={downloadedMovies}
            keyField="stream_id"
            onBack={() => setShowDownloaded(false)}
            onSelect={(it) => {
              const rec = it.__download;
              if (!rec) return selectMovie(it);
              // Play straight from the local file — no network needed.
              playVideoObject({ type: "movies", streamId: rec.id, name: rec.title, url: rec.localPath, cover: rec.poster, startTime: 0 });
              setShowDownloaded(false);
            }}
          />
        </YStack>
      )}
    </YStack>
  );
}
