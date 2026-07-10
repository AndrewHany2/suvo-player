import { useCallback } from "react";
import { useCatalog } from "./useCatalog";

/**
 * Single source of truth for the Series feature — a thin wrapper over useCatalog
 * (the shared shelves/discover/drill-in engine) that supplies the series-specific
 * ContentService methods + TMDB params (type 'tv', idField 'series_id') and adds
 * the series detail/playback tail. Series differ from movies in the detail shape
 * (season → episode), so this exposes selectSeries/clearSelectedSeries (web/native
 * SeriesDetail), fetchSeriesInfo (TV detail), buildEpisodeUrl + playEpisodeObject
 * (TV), and playVideoObject (web/native). View concerns stay in the screen files.
 */
const DISCOVER_ITEMS = [
  { id: "all", label: "All Series", icon: "📺" },
  { id: "top_rated", label: "Top Rated", icon: "⭐" },
];

export function useSeries({ navigation } = {}) {
  const cat = useCatalog({
    navigation,
    logName: "useSeries",
    tmdbType: "tv",
    idField: "series_id",
    discoverItems: DISCOVER_ITEMS,
    getAll: (cs) => cs.getAllSeries(),
    getCategories: (cs) => cs.getSeriesCategories(),
    getByCategory: (cs, catId) => cs.getSeriesByCategory(catId),
  });
  const { contentService } = cat;

  /** Raw provider series info ({ info, seasons, episodes }) for the TV detail view. */
  const fetchSeriesInfo = useCallback((seriesId) => contentService.getSeriesInfoRaw(seriesId), [contentService]);

  /** Build a series episode stream url (used by the TV detail play/continue path).
   *  Delegates without overriding ContentService's default extension. */
  const buildEpisodeUrl = useCallback(
    (...args) => contentService.buildEpisodeUrl(...args),
    [contentService],
  );

  return {
    // status
    loading: cat.loading, loaded: cat.loaded, error: cat.error, reload: cat.reload, activeUserId: cat.activeUserId,
    // discover + shelves (native/web)
    discoverItems: cat.discoverItems, shelves: cat.shelves, handleShelfVisible: cat.handleShelfVisible, handleLoadMore: cat.handleLoadMore,
    // category drill-in
    categoryPage: cat.categoryPage, openCategory: cat.openCategory, closeCategory: cat.closeCategory,
    isTopRatedCategory: cat.isTopRatedCategory, topRatedHasMore: cat.topRatedHasMore, topRatedLoadingMore: cat.topRatedLoadingMore, handleTopRatedMore: cat.handleTopRatedMore,
    // detail + play
    selectedSeries: cat.selected, selectSeries: cat.select, clearSelectedSeries: cat.clearSelected,
    playVideoObject: cat.playVideoObject, playEpisodeObject: cat.playVideoObject,
    // TV helpers
    categories: cat.categories, // shelves carry {id,name}; TV grid only needs those
    getCategoryItems: cat.getCategoryItems, fetchSeriesInfo, buildEpisodeUrl,
  };
}
