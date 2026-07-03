import { useCallback, useRef } from "react";
import { View, Text, FlatList, ActivityIndicator, Pressable, useWindowDimensions } from "react-native";
import { colors, fonts, fontWeights } from "../../ui/tokens";
import { ss } from "../../utils/scaleSize";
import { posterShelfWidth, SHELF_TARGET_W } from "../../utils/posterLayout";
import Icon from "../../ui/Icon";
import PosterCard from "./PosterCard.native";

/**
 * Horizontal content rail — native. Lazy-loads its items on first layout
 * (onVisible) and paginates on horizontal scroll (onLoadMore). View-only; all
 * data/state comes from the feature hook (e.g. useMovies).
 *
 * Aurora: tokenized colors/type, display-font section title with a cyan
 * chevron-right affordance when the title is pressable. Horizontal scroll +
 * pagination behaviour and the prop contract are unchanged.
 */
export default function ContentShelf({
  title, count, items, hasMore, loadingMore, manual,
  onVisible, onPress, onTitlePress, onLoadMore, renderItem,
}) {
  const hasLoaded = useRef(false);
  const { width: winW } = useWindowDimensions();
  // Poster width derived from the screen (Electron's density model): a phone
  // shows ~2 posters + a peek, a tablet more — posters scale up with the device.
  const cardW = posterShelfWidth(winW - ss(16) * 2, { target: SHELF_TARGET_W, gap: ss(10) });
  const handleLayout = useCallback(() => {
    if (!hasLoaded.current && items === null && !manual) {
      hasLoaded.current = true;
      onVisible?.();
    }
  }, [items, manual, onVisible]);

  if (items !== null && !items.length) return null;

  return (
    <View style={{ paddingTop: ss(20), paddingBottom: ss(8) }} onLayout={handleLayout}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: ss(16), marginBottom: ss(14) }}>
        <Pressable onPress={() => onTitlePress?.()} style={{ flexDirection: "row", alignItems: "center", gap: ss(4) }}>
          <Text style={{ color: colors.text, fontFamily: fonts.display, fontSize: ss(20), fontWeight: fontWeights.bold, letterSpacing: -0.3 }}>
            {title}
          </Text>
          <Icon name="chevron-right" size={ss(18)} color={colors.accent2} />
        </Pressable>
        {count != null && <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: ss(13), fontWeight: fontWeights.medium }}>{count}</Text>}
      </View>

      {items === null ? (
        <View style={{ paddingHorizontal: ss(16), paddingVertical: ss(18) }}>
          <ActivityIndicator size="small" color={colors.accent} />
        </View>
      ) : (
        <FlatList
          horizontal
          data={items}
          keyExtractor={(item, i) => String(item.stream_id ?? item.id ?? i)}
          renderItem={({ item }) => (renderItem
            ? renderItem(item)
            : <PosterCard item={item} onPress={onPress} width={cardW} />)}
          showsHorizontalScrollIndicator={false}
          // Keep a buffer of posters mounted ahead of the scroll on both sides so
          // travel never reveals a blank cell. removeClippedSubviews is left off:
          // it aggressively unmounts near-edge cells and can flash blanks during a
          // fast horizontal fling.
          removeClippedSubviews={false}
          initialNumToRender={9}
          windowSize={7}
          maxToRenderPerBatch={6}
          contentContainerStyle={{ paddingHorizontal: ss(16), gap: ss(10) }}
          onEndReachedThreshold={0.5}
          onEndReached={() => { if (hasMore && !loadingMore) onLoadMore?.(); }}
          ListFooterComponent={loadingMore ? (
            <View style={{ width: ss(60), justifyContent: "center", alignItems: "center" }}>
              <ActivityIndicator size="small" color={colors.accent} />
            </View>
          ) : null}
        />
      )}
    </View>
  );
}
