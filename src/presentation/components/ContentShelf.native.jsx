import { memo, useCallback, useRef } from "react";
import { View, Text, ActivityIndicator, Pressable, useWindowDimensions } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { colors, fonts, fontWeights, radii } from "../../ui/tokens";
import { ss } from "../../utils/scaleSize";
import { isLowEndDevice } from "../../utils/deviceTier";
import { posterShelfWidth, SHELF_TARGET_W } from "../../utils/posterLayout";
import { getShelfConfig } from "../virtualization/shelfConfig.js";
import Icon from "../../ui/Icon";
import PosterCard from "./PosterCard.native";
import SkeletonPoster from "./SkeletonPoster.native";

/**
 * Horizontal content rail — native. Lazy-loads its items on first layout
 * (onVisible) and paginates on horizontal scroll (onLoadMore). View-only; all
 * data/state comes from the feature hook (e.g. useMovies).
 *
 * Aurora: tokenized colors/type, an optional leading icon, and a display-font
 * section title with a cyan chevron-right affordance when the title is pressable
 * (chevron hidden when onTitlePress is absent). Callbacks receive the shelf `id`
 * so screens can pass stable useCallbacks and let the memo boundary bail.
 *
 * Poster-shaped by default (cardW derived from the screen). Pass `itemWidth`
 * (+ `gap`) to host fixed-width non-poster cards (e.g. Live TV channel cards).
 * The rail is a recycling FlashList, so a large category never mounts more than
 * a small reused window of cells.
 */
function ContentShelf({
  id, title, count, items, hasMore, loadingMore, manual,
  onVisible, onPress, onTitlePress, onLoadMore, renderItem,
  itemWidth, gap, leadingIcon, error, onRetry,
}) {
  const hasLoaded = useRef(false);
  const { width: winW } = useWindowDimensions();
  // Poster width derived from the screen (Electron's density model): a phone
  // shows ~2 posters + a peek, a tablet more — posters scale up with the device.
  // itemWidth/gap override it for non-poster rails (raw px, not ss()-scaled).
  const effGap = gap != null ? gap : ss(10);
  const cardW = itemWidth != null
    ? itemWidth
    : posterShelfWidth(winW - ss(16) * 2, { target: SHELF_TARGET_W, gap: ss(10) });
  // Lookahead knob centralized in the shared shelf config (Task 2). visibleCols
  // is derived from the SAME measured geometry the cards use (row width / stride),
  // so initialNumToRender mounts the visible posters plus the config overscan.
  const cfg = getShelfConfig("native");
  // FlashList recycles cells, so it self-manages the mounted window (no windowSize
  // /maxToRenderPerBatch to tune). Overscan only sizes the initial skeleton row;
  // halve it on low-end so a weak device paints fewer placeholders up front.
  const overscan = isLowEndDevice() ? Math.max(1, Math.floor(cfg.hOverscan / 2)) : cfg.hOverscan;
  const stride = cardW + effGap; // card width + the inter-item gap
  const visibleCols = Math.max(1, Math.floor((winW - ss(16) * 2) / stride));
  const initialNumToRender = visibleCols + overscan;
  const handleLayout = useCallback(() => {
    if (!hasLoaded.current && items === null && !manual) {
      hasLoaded.current = true;
      onVisible?.(id);
    }
  }, [id, items, manual, onVisible]);

  const keyExtractor = useCallback(
    (item, i) => String(item.series_id ?? item.stream_id ?? item.id ?? i),
    [],
  );
  const renderItemCb = useCallback(
    ({ item }) => (renderItem
      ? renderItem(item)
      : <PosterCard item={item} onPress={onPress} width={cardW} />),
    [renderItem, onPress, cardW],
  );
  // Inter-item gap: FlashList's contentContainerStyle only honors padding, so the
  // gap between cards comes from a separator rather than a `gap` style.
  const Separator = useCallback(() => <View style={{ width: effGap }} />, [effGap]);

  // A per-category fetch failure keeps the rail (with a retry affordance) rather
  // than silently vanishing; a genuinely empty loaded category still collapses.
  if (!error && items !== null && !items.length) return null;

  return (
    <View style={{ paddingTop: ss(20), paddingBottom: ss(8) }} onLayout={handleLayout}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: ss(16), marginBottom: ss(14) }}>
        <Pressable
          onPress={onTitlePress ? () => onTitlePress(id, title) : undefined}
          style={{ flexDirection: "row", alignItems: "center", gap: ss(4) }}
        >
          {leadingIcon && <Icon name={leadingIcon} size={ss(18)} color={colors.muted} />}
          {title ? (
            <Text style={{ color: colors.text, fontFamily: fonts.display, fontSize: ss(20), fontWeight: fontWeights.bold, letterSpacing: -0.3 }}>
              {title}
            </Text>
          ) : (
            // Skeleton title bar: keeps the header footprint while a loading gate
            // renders placeholder rails (title-less shelves).
            <View style={{ width: ss(140), height: ss(18), borderRadius: radii.sm / 2, backgroundColor: colors.surface }} />
          )}
          {onTitlePress && <Icon name="chevron-right" size={ss(18)} color={colors.muted} />}
        </Pressable>
        {!error && count != null && <Text style={{ color: colors.muted, fontFamily: fonts.body, fontSize: ss(13), fontWeight: fontWeights.medium }}>{count.toLocaleString()}</Text>}
      </View>

      {error ? (
        // Per-category fetch failed: a compact, tappable retry rail so the shelf
        // stays visible instead of silently disappearing.
        <Pressable
          onPress={() => onRetry?.(id)}
          style={{ marginHorizontal: ss(16), paddingVertical: ss(14), paddingHorizontal: ss(16), borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: "row", alignItems: "center", gap: ss(8) }}
          accessibilityRole="button"
          accessibilityLabel={`Retry loading ${title}`}
        >
          <Icon name="warning" size={ss(16)} color={colors.muted} />
          <Text style={{ color: colors.textDim, fontFamily: fonts.body, fontSize: ss(14), fontWeight: fontWeights.medium }}>Couldn't load — Tap to retry</Text>
        </Pressable>
      ) : items === null ? (
        // Skeleton rail: a row of poster-shaped placeholders sized like the real
        // cards. overflow:hidden clips the ones past the right edge.
        <View style={{ flexDirection: "row", paddingHorizontal: ss(16), gap: effGap, overflow: "hidden" }}>
          {Array.from({ length: initialNumToRender }).map((_, i) => (
            <SkeletonPoster key={i} width={cardW} />
          ))}
        </View>
      ) : (
        // FlashList recycles poster cells instead of mounting the whole rail, so a
        // large category (hundreds of items) keeps only a small recycled window
        // alive — the big win on low-RAM/weak-GPU hardware. v2 auto-measures item
        // size, so no getItemLayout/estimatedItemSize is needed.
        <FlashList
          horizontal
          data={items}
          keyExtractor={keyExtractor}
          renderItem={renderItemCb}
          ItemSeparatorComponent={Separator}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: ss(16) }}
          onEndReachedThreshold={0.5}
          onEndReached={() => { if (hasMore && !loadingMore) onLoadMore?.(id); }}
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

export default memo(ContentShelf);
