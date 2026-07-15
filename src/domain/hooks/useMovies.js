import { useCallback } from "react";
import { useCatalog } from "./useCatalog";

/**
 * Single source of truth for the Movies feature — a thin wrapper over useCatalog
 * (the shared shelves/discover/drill-in engine) that supplies the movie-specific
 * ContentService methods + TMDB params and adds the movie detail/playback tail
 * (playMovie, fetchMovieInfo). The three MoviesScreen variants read everything
 * from here; view concerns (layout, D-pad focus) stay in the screen files.
 */
const DISCOVER_ITEMS = [
  { id: "all", label: "All Movies", icon: "🎬" },
  { id: "top_rated", label: "Top Rated", icon: "⭐" },
];

export function useMovies({ navigation } = {}) {
  const cat = useCatalog({
    navigation,
    logName: "useMovies",
    tmdbType: "movie",
    idField: "stream_id",
    discoverItems: DISCOVER_ITEMS,
    getAll: (cs) => cs.getAllMovies(),
    getCategories: (cs) => cs.getMovieCategories(),
    getByCategory: (cs, catId) => cs.getMoviesByCategory(catId),
  });
  const { contentService, playVideo } = cat;

  /** Raw provider VOD info for the TV detail view. */
  const fetchMovieInfo = useCallback((streamId) => contentService.getMovieInfoRaw(streamId), [contentService]);

  /** Build url + start playback + navigate to the player. */
  const playMovie = useCallback(({ streamId, name, cover = null, containerExtension = "mp4", startTime = 0 }) => {
    const url = contentService.buildMovieUrl(streamId, containerExtension || "mp4");
    playVideo({ type: "movies", streamId, name, url, cover, startTime });
    navigation?.navigate?.("VideoPlayer");
  }, [contentService, playVideo, navigation]);

  return {
    // status
    loading: cat.loading, loaded: cat.loaded, error: cat.error, errorMessage: cat.errorMessage, reload: cat.reload, activeUserId: cat.activeUserId,
    // discover + shelves (native/web)
    discoverItems: cat.discoverItems, shelves: cat.shelves, handleShelfVisible: cat.handleShelfVisible, handleLoadMore: cat.handleLoadMore,
    // category drill-in
    categoryPage: cat.categoryPage, openCategory: cat.openCategory, closeCategory: cat.closeCategory,
    isTopRatedCategory: cat.isTopRatedCategory, topRatedHasMore: cat.topRatedHasMore, topRatedLoadingMore: cat.topRatedLoadingMore, handleTopRatedMore: cat.handleTopRatedMore,
    // detail + play
    selectedMovie: cat.selected, selectMovie: cat.select, clearSelectedMovie: cat.clearSelected,
    playMovie, playVideoObject: cat.playVideoObject,
    // TV helpers
    categories: cat.categories, // shelves carry {id,name}; TV grid only needs those
    getCategoryItems: cat.getCategoryItems, fetchMovieInfo,
  };
}
