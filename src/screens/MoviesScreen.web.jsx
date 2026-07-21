import { useState, useRef } from "react";
import { YStack, XStack, Text, Input, ScrollView, Spinner } from "../ui/primitives";
import { useApp } from "../context/AppContext";
import { useMovies } from "../domain/hooks/useMovies";
import { useTVNavigation } from "../hooks/useTVNavigation";
import { ss, useScale } from "../utils/scaleSize";
import { colors, fonts } from "../ui/tokens";
import StatePanel from "../ui/StatePanel";
import { emptyContentProps } from "../ui/emptyContentProps";
import Button from "../ui/Button";
import ContentShelf from "../presentation/components/ContentShelf.web";
import PosterCard from "../presentation/components/PosterCard.web";
import VirtualGrid from "../presentation/components/VirtualGrid.web";
import DiscoverPills from "../presentation/components/DiscoverPills.web";
import MovieDetail from "../components/MovieDetail.web";
import { useShelfWindow } from "../presentation/virtualization/useShelfWindow.js";
import { useCategoryGridNav } from "../hooks/useCategoryGridNav";
import { getShelfConfig } from "../presentation/virtualization/shelfConfig.js";

// Caps the browse content width on ultrawide monitors (centered via margin auto).
const MAX_W = 1700;

/* ─── Category Page (drill-in grid + web D-pad) ─── */
function CategoryPage({ name, items, onBack, onPlay, onLoadMore, hasRemote, loadingMore }) {
  const { searchQuery: search, setSearchQuery: setSearch } = useApp();
  const { filtered, focusedIdx, onColsChange } = useCategoryGridNav({ items, search, onSelect: onPlay, onBack });

  const CARD_W = ss(240);
  const GAP = ss(16);
  // Poster is width×1.5; the title block below adds marginTop(8) + height(34).
  const EST_ROW_H = Math.round(CARD_W * 1.5) + 42;
  const onEndReached = hasRemote && !loadingMore && onLoadMore ? onLoadMore : undefined;

  return (
    <YStack flex={1} minHeight={0} backgroundColor={colors.bg}>
      <XStack alignItems="center" gap={ss(14)} paddingHorizontal={ss(48)} paddingVertical={ss(18)} borderBottomWidth={1} borderBottomColor={colors.border}>
        <Button variant="ghost" size="sm" icon="back" onPress={onBack}>Back</Button>
        <Text color={colors.text} fontSize={ss(22)} fontWeight="700">{name}</Text>
        {filtered != null && (
          <YStack backgroundColor="rgba(255,255,255,0.07)" borderRadius={ss(20)} paddingHorizontal={ss(10)} paddingVertical={ss(4)}>
            <Text color={colors.muted} fontSize={ss(12)} fontWeight="600">{filtered.length.toLocaleString()}</Text>
          </YStack>
        )}
        <Input
          flex={1} placeholder="Search titles..." placeholderTextColor={colors.faint}
          value={search} onChangeText={setSearch}
          backgroundColor={colors.surface2} color={colors.text} borderRadius={ss(10)}
          paddingHorizontal={ss(14)} paddingVertical={ss(10)} fontSize={ss(14)} borderWidth={1} borderColor={colors.border}
        />
      </XStack>
      {filtered ? (
        <YStack flex={1} minHeight={0}>
          <VirtualGrid
            items={filtered}
            itemWidth={CARD_W}
            gap={GAP}
            estRowHeight={EST_ROW_H}
            focusIndex={focusedIdx}
            paddingH={ss(96)}
            paddingV={ss(32)}
            onColsChange={onColsChange}
            onEndReached={onEndReached}
            footer={loadingMore ? (
              <YStack alignItems="center" paddingVertical={ss(24)}><Spinner size="small" color={colors.accent} /></YStack>
            ) : null}
            renderItem={(item, idx) => (
              <PosterCard key={item.stream_id != null ? String(item.stream_id) : `i${idx}`} item={item} onPress={onPlay} isFocused={idx === focusedIdx} width={CARD_W} />
            )}
          />
        </YStack>
      ) : (
        <YStack flex={1} justifyContent="center" alignItems="center"><Spinner size="large" color={colors.accent} /></YStack>
      )}
    </YStack>
  );
}

/* ─── Screen ─── */
export default function MoviesScreen({ navigation }) {
  const {
    loading, error, errorMessage, reload, activeUserId, shelves, discoverItems,
    handleShelfVisible, handleLoadMore, openCategory, closeCategory,
    categoryPage, isTopRatedCategory, topRatedHasMore, topRatedLoadingMore, handleTopRatedMore,
    selectedMovie, selectMovie, clearSelectedMovie, playVideoObject,
  } = useMovies({ navigation });

  useScale(); // re-render + recompute ss() on window resize

  // The visible shelf-row index (NOT raw scroll px). Storing the quantized row
  // means setState is a no-op — React bails on an equal value — until the
  // viewport crosses into a new row, instead of re-rendering the whole screen
  // ~60×/sec while scrolling. Mirrors ContentShelf.web's firstVisible.
  const [vAnchor, setVAnchor] = useState(0);
  const scrollRef = useRef(null);
  const listRef = useRef(null);

  const { focusedRow, focusedCol } = useTVNavigation({
    active: !categoryPage && !selectedMovie,
    rows: [{ items: discoverItems, onSelect: (i) => openCategory(discoverItems[i].id, discoverItems[i].label) }],
  });

  // Vertical shelf window: mount only shelves near the viewport, with spacer
  // divs above/below preserving scroll geometry. listTop is the Discover
  // section's height (distance from scroll top to the first shelf), measured off
  // the wrapper's offsetTop. Called unconditionally, before the early returns
  // below, per Rules of Hooks.
  const vcfg = getShelfConfig("web");
  const rowStride = ss(vcfg.rowHeight);
  const viewportH = scrollRef.current?.clientHeight || (typeof window !== "undefined" ? window.innerHeight : 900);
  const listTop = listRef.current?.offsetTop || 0;
  const rowsVisible = Math.max(1, Math.ceil(viewportH / rowStride));
  const vWin = useShelfWindow({
    anchor: vAnchor, total: shelves.length,
    viewportCount: rowsVisible, overscan: vcfg.vOverscan, stride: rowStride,
  });

  if (loading) {
    return <StatePanel mode="loading" title="Loading movies..." />;
  }

  if (error) {
    return (
      <StatePanel
        mode="error"
        title="Couldn't load movies"
        message={errorMessage || "Check your connection and try again"}
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
        title="No account"
        message="Add your media service from Settings"
        cta={() => navigation.navigate("Accounts")}
        ctaLabel="Add Account"
      />
    );
  }

  return (
    <YStack flex={1} minHeight={0} backgroundColor={colors.bg} position="relative">
      <ScrollView
        ref={scrollRef}
        onScroll={(e) => setVAnchor(Math.max(0, Math.floor((e.nativeEvent.contentOffset.y - listTop) / rowStride)))}
        flex={1} minHeight={0} contentContainerStyle={{ paddingBottom: ss(80) }}
      >
        <YStack maxWidth={MAX_W} width="100%" alignSelf="center">
        <YStack paddingHorizontal={ss(48)} paddingTop={ss(24)} paddingBottom={ss(4)}>
          <Text color={colors.text} fontFamily={fonts.display} fontSize={ss(22)} fontWeight="700" letterSpacing={-0.3} marginBottom={ss(12)}>Discover</Text>
          <DiscoverPills
            items={discoverItems}
            focusedCol={focusedRow === 0 ? focusedCol : -1}
            onSelect={(pill) => openCategory(pill.id, pill.label)}
          />
        </YStack>
        <YStack>
          {shelves.length > 0 ? (
            <div ref={listRef}>
              <div style={{ height: vWin.leadingPad }} />
              {shelves.slice(vWin.start, vWin.end).map((shelf) => (
                <div key={shelf.id} style={{ height: rowStride, overflow: "visible" }}>
                  <ContentShelf
                    id={shelf.id}
                    title={shelf.name} count={shelf.totalCount} items={shelf.items}
                    hasMore={shelf.hasMore} loadingMore={shelf.loadingMore} manual={false}
                    onVisible={handleShelfVisible}
                    onPress={selectMovie}
                    onTitlePress={openCategory}
                    onLoadMore={handleLoadMore}
                  />
                </div>
              ))}
              <div style={{ height: vWin.trailingPad }} />
            </div>
          ) : (
            <StatePanel mode="empty" {...emptyContentProps("movies")} />
          )}
        </YStack>
        </YStack>
      </ScrollView>
      {categoryPage && (
        <YStack position="absolute" top={0} left={0} right={0} bottom={0} zIndex={20}>
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
        <YStack position="absolute" top={0} left={0} right={0} bottom={0} zIndex={20}>
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
