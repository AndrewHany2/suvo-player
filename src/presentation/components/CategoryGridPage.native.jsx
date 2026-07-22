import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { FlatList, useWindowDimensions } from "react-native";
import { YStack, XStack, Text, Input, Spinner } from "../../ui/primitives";
import Button from "../../ui/Button";
import { colors, fonts, fontWeights } from "../../ui/tokens";
import { posterGrid, GRID_TARGET_W } from "../../utils/posterLayout";
import PosterCard from "./PosterCard.native";
import SkeletonPoster from "./SkeletonPoster.native";

const GRID_PAGE = 40;
const GRID_OUTER = 16; // equal left/right screen margin
const GRID_GAP = 12; // gap between posters (columns and rows)

/**
 * Native drill-in grid page (a category's items or a discover pill result), with
 * a search box, width-derived responsive columns, and incremental local paging
 * that hands off to a remote "load more" when the local slice is exhausted.
 *
 * Shared by MoviesScreen.native and SeriesScreen.native — the two were
 * byte-duplicated and had drifted (different back button, title font, and
 * placeholder color). Unified here on the design-system Button + display font;
 * the only real per-screen differences are the item press handler and the id
 * field, so those are props.
 *
 * @param {object}   props
 * @param {string}   props.name         category title
 * @param {Array|null} props.items      items to render (null = still loading)
 * @param {() => void} props.onBack     leave the drill-in
 * @param {(item) => void} props.onSelect  item pressed (play / open detail)
 * @param {() => void} [props.onLoadMore]  fetch the next remote page (top-rated)
 * @param {boolean}  [props.hasRemote]  a remote "load more" is available
 * @param {boolean}  [props.loadingMore] a remote page is in flight
 * @param {string}   props.keyField     item id field: "stream_id" | "series_id"
 */
export default function CategoryGridPage({ name, items, onBack, onSelect, onLoadMore, hasRemote, loadingMore, keyField }) {
  const [displayCount, setDisplayCount] = useState(GRID_PAGE);
  const [search, setSearch] = useState("");
  const { width: winW } = useWindowDimensions();
  // Column count is DERIVED from the screen width (Electron's density model):
  // ~3 across on a phone, more on a tablet, posters sized to fill the row.
  const { cols, cardW } = posterGrid(winW - GRID_OUTER * 2, { target: GRID_TARGET_W, gap: GRID_GAP });

  // Defer the query so typing stays responsive: the TextInput stays bound to the
  // immediate `search`, but the (potentially large) catalog filter runs against
  // the deferred value, letting React keep keystrokes snappy under load.
  const deferredSearch = useDeferredValue(search);

  // Filter once per (items, query) instead of re-scanning the whole catalog on
  // every keystroke AND every render. The query is lowercased a single time
  // outside the predicate rather than once per item.
  const filtered = useMemo(() => {
    if (!items) return null;
    const q = deferredSearch.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => i.name?.toLowerCase().includes(q));
  }, [items, deferredSearch]);
  const displayed = useMemo(
    () => (filtered ? filtered.slice(0, displayCount) : null),
    [filtered, displayCount],
  );
  const hasLocalMore = filtered && displayCount < filtered.length;
  const hasMore = hasLocalMore || hasRemote;

  useEffect(() => { setDisplayCount(GRID_PAGE); }, [deferredSearch]);

  const keyExtractor = useCallback((item) => String(item[keyField]), [keyField]);
  const renderItem = useCallback(
    ({ item }) => <PosterCard item={item} onPress={onSelect} width={cardW} />,
    [onSelect, cardW],
  );

  return (
    <YStack flex={1} backgroundColor={colors.bg}>
      <XStack alignItems="center" gap={12} paddingHorizontal={16} paddingTop={16} paddingBottom={10} borderBottomWidth={1} borderBottomColor={colors.border}>
        <Button variant="ghost" size="sm" icon="back" onPress={onBack}>Back</Button>
        <Text color={colors.text} fontFamily={fonts.display} fontSize={18} fontWeight={fontWeights.bold} flex={1} numberOfLines={1}>{name}</Text>
        {filtered != null && (
          <YStack backgroundColor="rgba(255,255,255,0.07)" borderRadius={20} paddingHorizontal={10} paddingVertical={4}>
            <Text color={colors.muted} fontSize={12} fontWeight="600">{filtered.length.toLocaleString()}</Text>
          </YStack>
        )}
      </XStack>
      <Input
        margin={12} placeholder="Search titles..." placeholderTextColor={colors.muted}
        value={search} onChangeText={setSearch}
        backgroundColor={colors.surface2} color={colors.text} borderRadius={10}
        paddingHorizontal={14} paddingVertical={10} fontSize={14} borderWidth={1} borderColor={colors.border}
      />
      {!displayed ? (
        // Skeleton grid: poster-shaped placeholders sized like the real cells,
        // so the drill-in reads as content loading rather than a bare spinner.
        <YStack flex={1} paddingHorizontal={GRID_OUTER} paddingVertical={12}>
          <XStack flexWrap="wrap" gap={GRID_GAP}>
            {Array.from({ length: cols * 3 }).map((_, i) => (
              <SkeletonPoster key={i} width={cardW} />
            ))}
          </XStack>
        </YStack>
      ) : (
        <FlatList
          key={`grid-${cols}`}
          style={{ flex: 1 }}
          data={displayed}
          keyExtractor={keyExtractor}
          numColumns={cols}
          contentContainerStyle={{ paddingHorizontal: GRID_OUTER, paddingVertical: 12 }}
          columnWrapperStyle={{ gap: GRID_GAP, marginBottom: GRID_GAP }}
          renderItem={renderItem}
          removeClippedSubviews
          windowSize={7}
          initialNumToRender={cols * 4}
          maxToRenderPerBatch={cols * 3}
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
