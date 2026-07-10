import { useCallback, useMemo } from "react";
import { useApp, usePlayback, useWatchHistory } from "../../context/AppContext";
import { useContentService } from "./useContentService";
import { splitHistory } from "./historyGroups";

/**
 * Single source of truth for the History feature.
 *
 * History is smaller than Movies/Series: its data already lives in AppContext
 * (watchHistory + myList), so this is mostly a thin selector plus the playback
 * handlers the three HistoryScreen variants used to copy-paste. It exposes:
 *   - the derived lists (watchedHistory = non-live history; myList) and the
 *     remove-entry actions, forwarded from AppContext.
 *   - playEntry(item): the direct-play path for a live entry (build url +
 *     playVideo + navigate) — the one branch all three screens share.
 *   - playVideoObject(obj): start playback of an already-built video object and
 *     navigate (web/native MovieDetail/SeriesDetail onPlay; TV detail play).
 *   - url builders + raw provider-info fetchers routed through ContentService
 *     (buildMovieUrl / buildEpisodeUrl / fetchMovieInfo / fetchSeriesInfo) so
 *     the TV detail views no longer reach into iptvApi directly.
 *
 * View + D-pad/focus concerns stay in the screen files; they read everything
 * they need from here.
 */
export function useHistory({ navigation } = {}) {
  const { contentService } = useContentService();
  const { myList, removeFromMyList } = useApp();
  const { playVideo } = usePlayback();
  const { watchHistory, removeFromWatchHistory } = useWatchHistory();

  const { watched: watchedHistory } = useMemo(() => splitHistory(watchHistory), [watchHistory]);

  const navigateToPlayer = useCallback(() => {
    navigation?.navigate?.("VideoPlayer");
  }, [navigation]);

  /** Play an already-built video object + navigate (detail-screen play path). */
  const playVideoObject = useCallback((videoObj) => {
    playVideo(videoObj);
    navigateToPlayer();
  }, [playVideo, navigateToPlayer]);

  /** Direct-play a live history entry: build its url, start playback, navigate. */
  const playLive = useCallback((item) => {
    const url = contentService.buildLiveUrl(item.streamId, item.containerExtension || "ts");
    playVideoObject({
      type: "live",
      streamId: item.streamId,
      name: item.name,
      url,
      cover: item.cover,
      startTime: 0,
    });
  }, [contentService, playVideoObject]);

  const buildMovieUrl = useCallback(
    (...args) => contentService.buildMovieUrl(...args),
    [contentService],
  );

  const buildEpisodeUrl = useCallback(
    (...args) => contentService.buildEpisodeUrl(...args),
    [contentService],
  );

  /** Raw provider VOD info ({ info, movie_data }) for the TV movie detail view. */
  const fetchMovieInfo = useCallback(
    (movieId) => contentService.getMovieInfoRaw(movieId),
    [contentService],
  );

  /** Raw provider series info ({ info, seasons, episodes }) for the TV detail
   *  view, routed through ContentService so it resolves against the active
   *  source (Xtream or M3U). */
  const fetchSeriesInfo = useCallback((seriesId) => contentService.getSeriesInfoRaw(seriesId), [contentService]);

  return {
    // selectors
    watchHistory, watchedHistory, myList,
    // remove actions
    removeFromWatchHistory, removeFromMyList,
    // playback
    playLive, playVideoObject,
    // TV detail helpers (routed through ContentService, not iptvApi)
    buildMovieUrl, buildEpisodeUrl, fetchMovieInfo, fetchSeriesInfo,
  };
}
