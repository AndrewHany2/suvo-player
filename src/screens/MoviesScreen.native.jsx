import { useEffect, useState } from "react";
import { FlatList, useWindowDimensions } from "react-native";
import { YStack, XStack, Text, Input, Spinner } from "../ui/primitives";
import { useMovies } from "../domain/hooks/useMovies";
import { useTVNavigation } from "../hooks/useTVNavigation";
import ContentShelf from "../presentation/components/ContentShelf.native";
import PosterCard from "../presentation/components/PosterCard.native";
import Hero from "../presentation/components/Hero.native";
import { selectHeroItem } from "../presentation/heroItem";
import MovieDetail from "../components/MovieDetail";
import { colors, accentAlpha } from "../ui/tokens";
import StatePanel from "../ui/StatePanel";
import Button from "../ui/Button";
import Icon from "../ui/Icon";

const GRID_PAGE = 40;
const GRID_COLS = 3;
const GRID_OUTER = 16; // equal left/right screen margin
const GRID_GAP = 12; // gap between posters (columns and rows)

/* ─── Category Page (drill-in grid) ─── */
function CategoryPage({ name, items, onBack, onPlay, onLoadMore, hasRemote, loadingMore }) {
  const [displayCount, setDisplayCount] = useState(GRID_PAGE);
  const [search, setSearch] = useState("");
  const { width: winW } = useWindowDimensions();
  // Responsive card width so GRID_COLS fit with equal outer margins + gaps.
  const cardW = Math.floor((winW - GRID_OUTER * 2 - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS);

  const filtered = items
    ? (search.trim() ? items.filter((i) => i.name?.toLowerCase().includes(search.toLowerCase())) : items)
    : null;
  const displayed = filtered ? filtered.slice(0, displayCount) : null;
  const hasLocalMore = filtered && displayCount < filtered.length;
  const hasMore = hasLocalMore || hasRemote;

  useEffect(() => { setDisplayCount(GRID_PAGE); }, [search]);

  return (
    <YStack flex={1} backgroundColor={colors.bg}>
      <XStack alignItems="center" gap={12} paddingHorizontal={16} paddingTop={16} paddingBottom={10} borderBottomWidth={1} borderBottomColor={colors.border}>
        <Button variant="ghost" size="sm" icon="back" onPress={onBack}>Back</Button>
        <Text color={colors.text} fontSize={18} fontWeight="700" flex={1} numberOfLines={1}>{name}</Text>
        {filtered != null && (
          <YStack backgroundColor="rgba(255,255,255,0.07)" borderRadius={20} paddingHorizontal={10} paddingVertical={4}>
            <Text color={colors.muted} fontSize={12} fontWeight="600">{filtered.length.toLocaleString()}</Text>
          </YStack>
        )}
      </XStack>
      <Input
        margin={12} placeholder="Search titles..." placeholderTextColor={colors.faint}
        value={search} onChangeText={setSearch}
        backgroundColor={colors.surface2} color={colors.text} borderRadius={10}
        paddingHorizontal={14} paddingVertical={10} fontSize={14} borderWidth={1} borderColor={colors.border}
      />
      {!displayed ? (
        <YStack flex={1} justifyContent="center" alignItems="center"><Spinner size="large" color={colors.accent} /></YStack>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={displayed}
          keyExtractor={(item) => String(item.stream_id)}
          numColumns={GRID_COLS}
          contentContainerStyle={{ paddingHorizontal: GRID_OUTER, paddingVertical: 12 }}
          columnWrapperStyle={{ gap: GRID_GAP, marginBottom: GRID_GAP }}
          renderItem={({ item }) => <PosterCard item={item} onPress={onPlay} width={cardW} />}
          onEndReached={() => {
            if (hasLocalMore) setDisplayCount((c) => Math.min(c + GRID_PAGE, filtered.length));
            else if (hasRemote && !loadingMore && onLoadMore) onLoadMore();
          }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={(hasMore || loadingMore)
            ? <YStack alignItems="center" paddingVertical={20}><Spinner size="small" color={colors.accent} /></YStack>
            : null}
          showsVerticalScrollIndicator={false}
        />
      )}
    </YStack>
  );
}

/* ─── Screen ─── */
export default function MoviesScreen({ navigation }) {
  const {
    loading, error, reload, activeUserId, shelves, discoverItems,
    handleShelfVisible, handleLoadMore, openCategory, closeCategory,
    categoryPage, isTopRatedCategory, topRatedHasMore, topRatedLoadingMore, handleTopRatedMore,
    selectedMovie, selectMovie, clearSelectedMovie, playVideoObject,
  } = useMovies({ navigation });

  const { focusedRow, focusedCol } = useTVNavigation({
    active: !categoryPage && !selectedMovie,
    rows: [{ items: discoverItems, onSelect: (i) => openCategory(discoverItems[i].id, discoverItems[i].label) }],
  });

  if (loading) {
    return <StatePanel mode="loading" title="Loading movies..." />;
  }

  if (error) {
    return (
      <StatePanel
        mode="error"
        title="Couldn't load movies"
        message="Check your connection and try again"
        onRetry={reload}
        retryLabel="Retry"
      />
    );
  }

  if (!activeUserId) {
    return (
      <StatePanel
        mode="empty"
        icon="film"
        title="No IPTV Account"
        message='Tap "Accounts" to add your IPTV service'
        cta={() => navigation.navigate("Accounts")}
        ctaLabel="Add Account"
      />
    );
  }

  const heroItem = !categoryPage && !selectedMovie
    ? selectHeroItem(shelves.find((s) => s.items?.length)?.items)
    : null;

  const listHeader = (
    <YStack>
      {heroItem && (
        <YStack paddingHorizontal={16} paddingTop={16}>
          <Hero item={heroItem} onPlay={() => selectMovie(heroItem)} onDetails={() => selectMovie(heroItem)} />
        </YStack>
      )}
      <YStack paddingHorizontal={16} paddingTop={20} paddingBottom={4}>
        <Text color={colors.text} fontSize={20} fontWeight="700" letterSpacing={-0.3} marginBottom={12}>Discover</Text>
        <XStack gap={10} flexWrap="wrap">
          {discoverItems.map((pill, idx) => (
            <XStack
              key={pill.id} alignItems="center" gap={8} paddingHorizontal={16} paddingVertical={10}
              backgroundColor={accentAlpha(0.08)} borderWidth={1}
              borderColor={focusedRow === 0 && focusedCol === idx ? colors.accent2 : accentAlpha(0.28)}
              borderRadius={999} onPress={() => openCategory(pill.id, pill.label)}
            >
              <Icon name={pill.id === "all" ? "film" : "star"} size={14} color={colors.muted} />
              <Text color={colors.text} fontSize={12} fontWeight="600">{pill.label}</Text>
              <Icon name="chevron-right" size={14} color={colors.accent} />
            </XStack>
          ))}
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
            title={item.name} count={item.totalCount} items={item.items}
            hasMore={item.hasMore} loadingMore={item.loadingMore} manual={item.manual}
            onVisible={() => handleShelfVisible(item.id)}
            onPress={selectMovie}
            onTitlePress={() => openCategory(item.id, item.name)}
            onLoadMore={() => handleLoadMore(item.id)}
          />
        )}
        ListEmptyComponent={<StatePanel mode="empty" icon="film" title="No movies found" />}
        windowSize={5}
        maxToRenderPerBatch={3}
        initialNumToRender={3}
        removeClippedSubviews
      />
      {categoryPage && (
        <YStack position="absolute" top={0} left={0} right={0} bottom={0}>
          <CategoryPage
            name={categoryPage.name}
            items={categoryPage.items}
            onBack={closeCategory}
            onPlay={selectMovie}
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
    </YStack>
  );
}
