import { useState, useEffect, useCallback, useRef } from "react";
import { useApp } from "../../context/AppContext";
import { useContentService } from "./useContentService";
import { detectPlatform } from "../../platform/configs/detectPlatform";
import tmdbApi from "../../services/tmdbApi";
import { MemoryManager } from "../../platform/optimization/MemoryManager";

// Cap the TV drill-in item cache so a long browsing session can't pin the
// item lists for every category in memory at once (WebOS budget is tight).
const ITEMS_CACHE_MAX = 8;

/**
 * Single source of truth for the Movies feature.
 *
 * Holds ALL the data + business logic that the three MoviesScreen variants used
 * to copy-paste: category shelves with lazy loading + pagination, the
 * "All Movies" / "Top Rated" discover engine (with TMDB top-rated cursor
 * prefetch), drill-into-category, detail selection and playback. Built on
 * ContentService (categories/streams/info/url) + tmdbApi (top-rated matching).
 *
 * View concerns (layout, D-pad focus state) stay in the screen files; they read
 * everything they need from here.
 */
// TV shelves are shorter (tighter WebOS memory budget); everything else pages 12.
const SHELF_PAGE = detectPlatform() === "tv" ? 8 : 12;

const byRatingDesc = (list) =>
  [...(list || [])]
    .filter((s) => Number.parseFloat(s.rating) > 0)
    .sort((a, b) => Number.parseFloat(b.rating) - Number.parseFloat(a.rating));

export function useMovies({ navigation } = {}) {
  const { contentService, activeUser, activeUserId } = useContentService();
  const { playVideo } = useApp();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [shelves, setShelves] = useState([]);
  const [categoryPage, setCategoryPage] = useState(null); // { catId, name, items }
  const [selectedMovie, setSelectedMovie] = useState(null); // raw item for detail
  const [topRatedHasMore, setTopRatedHasMore] = useState(false);
  const [topRatedLoadingMore, setTopRatedLoadingMore] = useState(false);

  const loadedRef = useRef(new Set());
  const allShuffledRef = useRef([]);
  const topRatedRef = useRef([]);
  const prefetchRef = useRef({ topRated: null });
  const topRatedCursorRef = useRef(null);
  // Synchronous re-entrancy lock — set before the first await so a burst of
  // onEndReached calls in the same tick can't each pass the (async) state guard.
  const topRatedInFlightRef = useRef(false);
  // LRU-capped catId -> items (TV drill-in cache) so it can't grow unbounded.
  const itemsCacheRef = useRef(new MemoryManager(ITEMS_CACHE_MAX));
  // Monotonic id for the active category drill-in; a response whose id no longer
  // matches is stale (user switched categories) and must be discarded so it can't
  // overwrite the current list. Paired with an AbortController to cancel in-flight
  // TMDB work when the selection changes or the hook unmounts.
  const openSeqRef = useRef(0);
  const openAbortRef = useRef(null);

  const discoverItems = [
    { id: "all", label: "All Movies", icon: "🎬" },
    { id: "top_rated", label: "Top Rated", icon: "⭐" },
  ];

  // ── Top-rated prefetch (TMDB) ───────────────────────────────────────────────
  const prefetchTopRated = useCallback(async () => {
    // TV has no discover/top-rated UI; skip the expensive all-streams fetch.
    if (typeof globalThis !== "undefined" && globalThis.__TV__) return null;
    try {
      const streams = await contentService.getAllMovies();
      if (!streams?.length) return null;
      if (!tmdbApi.hasKey) {
        return { streams, matched: byRatingDesc(streams), hasTmdb: false, seenIds: new Set(), totalPages: 0, hasMore: false };
      }
      const seenIds = new Set();
      const { matched, totalPages, hasMore } = await tmdbApi.matchTopRatedRange({
        type: "movie", iptvItems: streams, idField: "stream_id", fromPage: 1, toPage: 5, seenIds,
      });
      return { streams, matched, seenIds, totalPages, hasMore, hasTmdb: true };
    } catch { return null; }
  }, [contentService]);

  // Defer the (expensive) top-rated prefetch — getAllMovies() over the whole VOD
  // catalog + up to 5 concurrent TMDB calls — off the initial-mount critical
  // path so it doesn't compete with the visible shelves' category fetches.
  // Consumers still `await` this promise; the work just starts when the main
  // thread is idle (capped at 2s) instead of synchronously inside load().
  const schedulePrefetch = useCallback(() => new Promise((resolve) => {
    const run = () => resolve(prefetchTopRated());
    const ric = typeof globalThis !== "undefined" ? globalThis.requestIdleCallback : null;
    if (typeof ric === "function") ric(run, { timeout: 2000 });
    else setTimeout(run, 200);
  }), [prefetchTopRated]);

  const kickoffPrefetch = useCallback((cursor) => {
    if (!cursor || cursor.prefetch) return;
    const fromPage = cursor.page + 1;
    const toPage = Math.min(cursor.page + 5, cursor.totalPages || Infinity);
    if (fromPage > toPage) return;
    cursor.prefetchTo = toPage;
    cursor.prefetch = tmdbApi.matchTopRatedRange({
      type: cursor.type, iptvItems: cursor.streams, idField: cursor.idField,
      fromPage, toPage, seenIds: cursor.seenIds,
    }).catch(() => null);
  }, []);

  // ── Initial load: categories → shelves ──────────────────────────────────────
  const load = useCallback(async () => {
    if (!activeUser) return;
    setLoading(true);
    setError(false);
    loadedRef.current.clear();
    allShuffledRef.current = [];
    topRatedRef.current = [];
    prefetchRef.current = { topRated: null };
    itemsCacheRef.current.clear();
    openAbortRef.current?.abort();
    openAbortRef.current = null;
    setShelves([]);
    try {
      const cats = await contentService.getMovieCategories(); // [{ id, name }]
      if (!cats?.length) return;
      setShelves(cats.map((c) => ({
        id: c.id, name: c.name, items: null, totalCount: null,
        hasMore: false, loadingMore: false, manual: false,
      })));
      prefetchRef.current = { topRated: schedulePrefetch() };
    } catch (err) {
      console.error("useMovies.load:", err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [activeUser, contentService, schedulePrefetch]);

  useEffect(() => { if (activeUserId) load(); }, [activeUserId, load]);

  // ── Lazy shelf load ─────────────────────────────────────────────────────────
  const handleShelfVisible = useCallback(async (catId) => {
    if (loadedRef.current.has(catId)) return;
    loadedRef.current.add(catId);
    try {
      let all;
      if (catId === "all") {
        const prefetched = prefetchRef.current.topRated ? await prefetchRef.current.topRated : null;
        const streams = prefetched?.streams || (await contentService.getAllMovies());
        all = [...(streams || [])].sort(() => Math.random() - 0.5);
        allShuffledRef.current = all;
      } else if (catId === "top_rated") {
        // Real categories never use this id; fall back to rating sort.
        all = byRatingDesc(await contentService.getAllMovies());
        topRatedRef.current = all;
      } else {
        all = await contentService.getMoviesByCategory(catId);
      }
      const firstPage = (all || []).slice(0, SHELF_PAGE);
      setShelves((prev) => prev.map((s) =>
        s.id === catId ? { ...s, items: firstPage, totalCount: all.length, hasMore: all.length > SHELF_PAGE } : s));
    } catch {
      setShelves((prev) => prev.map((s) =>
        s.id === catId ? { ...s, items: [], totalCount: 0, hasMore: false } : s));
    }
  }, [contentService]);

  const handleLoadMore = useCallback(async (catId) => {
    setShelves((prev) => prev.map((s) => s.id === catId ? { ...s, loadingMore: true } : s));
    try {
      const all = catId === "all" ? allShuffledRef.current
        : catId === "top_rated" ? topRatedRef.current
        : await contentService.getMoviesByCategory(catId);
      setShelves((prev) => prev.map((s) => {
        if (s.id !== catId) return s;
        const nextItems = (all || []).slice(0, (s.items?.length || 0) + SHELF_PAGE);
        return { ...s, items: nextItems, hasMore: nextItems.length < (all?.length || 0), loadingMore: false };
      }));
    } catch {
      setShelves((prev) => prev.map((s) => s.id === catId ? { ...s, loadingMore: false } : s));
    }
  }, [contentService]);

  // ── Drill into a category / discover pill ───────────────────────────────────
  const openCategory = useCallback(async (catId, name) => {
    // Per-request latest-id guard: a response whose seq no longer matches means
    // the user switched categories while it was in flight, so we drop it instead
    // of letting it overwrite the current list (fixes flicker / wrong-list races).
    const seq = ++openSeqRef.current;
    openAbortRef.current?.abort();
    const controller = new AbortController();
    openAbortRef.current = controller;
    const isCurrent = () => seq === openSeqRef.current;
    setCategoryPage({ catId, name, items: null });
    try {
      let all;
      if (catId === "all") {
        if (!allShuffledRef.current.length) {
          const prefetched = prefetchRef.current.topRated ? await prefetchRef.current.topRated : null;
          const streams = prefetched?.streams || (await contentService.getAllMovies());
          allShuffledRef.current = [...(streams || [])].sort(() => Math.random() - 0.5);
        }
        all = allShuffledRef.current;
      } else if (catId === "top_rated") {
        const prefetched = prefetchRef.current.topRated ? await prefetchRef.current.topRated : null;
        if (prefetched?.hasTmdb) {
          const { streams, matched, seenIds, totalPages, hasMore } = prefetched;
          if (!isCurrent()) return;
          topRatedCursorRef.current = { streams, type: "movie", idField: "stream_id", page: 5, totalPages, seenIds, prefetch: null, prefetchTo: 0 };
          setTopRatedHasMore(hasMore);
          all = matched.length ? matched : byRatingDesc(streams);
          if (!matched.length) setTopRatedHasMore(false);
          else if (hasMore) kickoffPrefetch(topRatedCursorRef.current);
        } else if (prefetched) {
          all = prefetched.matched; setTopRatedHasMore(false);
        } else {
          const streams = await contentService.getAllMovies();
          if (tmdbApi.hasKey) {
            const seenIds = new Set();
            const { matched, totalPages, hasMore } = await tmdbApi.matchTopRatedRange({ type: "movie", iptvItems: streams || [], idField: "stream_id", fromPage: 1, toPage: 5, seenIds, signal: controller.signal });
            if (!isCurrent()) return;
            topRatedCursorRef.current = { streams: streams || [], type: "movie", idField: "stream_id", page: 5, totalPages, seenIds, prefetch: null, prefetchTo: 0 };
            setTopRatedHasMore(hasMore);
            all = matched;
            if (!all.length) { all = byRatingDesc(streams); setTopRatedHasMore(false); }
            else if (hasMore) kickoffPrefetch(topRatedCursorRef.current);
          } else { all = byRatingDesc(streams); setTopRatedHasMore(false); }
        }
      } else {
        all = await contentService.getMoviesByCategory(catId);
        if (!loadedRef.current.has(catId)) handleShelfVisible(catId);
      }
      if (!isCurrent()) return; // stale response — discard
      setCategoryPage((prev) => prev ? { ...prev, items: all || [] } : prev);
    } catch (err) {
      if (err?.name === "AbortError" || !isCurrent()) return; // cancelled / superseded
      setCategoryPage((prev) => prev ? { ...prev, items: [] } : prev);
    }
  }, [contentService, handleShelfVisible, kickoffPrefetch]);

  const closeCategory = useCallback(() => {
    // Invalidate any in-flight drill-in so a late response can't repopulate a
    // closed page, and cancel its network work.
    openSeqRef.current++;
    openAbortRef.current?.abort();
    openAbortRef.current = null;
    setCategoryPage(null);
    topRatedCursorRef.current = null;
    setTopRatedHasMore(false);
    setTopRatedLoadingMore(false);
  }, []);

  // Abort any in-flight drill-in fetch when the hook unmounts.
  useEffect(() => () => {
    openSeqRef.current++;
    openAbortRef.current?.abort();
  }, []);

  const handleTopRatedMore = useCallback(async () => {
    const cursor = topRatedCursorRef.current;
    if (!cursor || topRatedInFlightRef.current) return;
    if (cursor.page >= cursor.totalPages && !cursor.prefetch) { setTopRatedHasMore(false); return; }
    topRatedInFlightRef.current = true;
    setTopRatedLoadingMore(true);
    try {
      let result;
      if (cursor.prefetch) { result = await cursor.prefetch; cursor.page = cursor.prefetchTo; cursor.prefetch = null; }
      else {
        const fromPage = cursor.page + 1;
        const toPage = Math.min(cursor.page + 5, cursor.totalPages);
        result = await tmdbApi.matchTopRatedRange({ type: cursor.type, iptvItems: cursor.streams, idField: cursor.idField, fromPage, toPage, seenIds: cursor.seenIds });
        cursor.page = toPage;
      }
      if (!result) return;
      cursor.totalPages = result.totalPages;
      setTopRatedHasMore(result.hasMore);
      if (result.matched.length) setCategoryPage((prev) => prev ? { ...prev, items: [...(prev.items || []), ...result.matched] } : prev);
      if (result.hasMore) kickoffPrefetch(cursor);
    } finally { setTopRatedLoadingMore(false); topRatedInFlightRef.current = false; }
  }, [kickoffPrefetch]);

  const isTopRatedCategory = categoryPage?.catId === "top_rated";

  // ── Detail + playback ───────────────────────────────────────────────────────
  const selectMovie = useCallback((item) => setSelectedMovie(item), []);
  const clearSelectedMovie = useCallback(() => setSelectedMovie(null), []);

  /** TV drill-in: get a category's items (cached). */
  const getCategoryItems = useCallback(async (catId) => {
    const cached = itemsCacheRef.current.get(catId);
    if (cached) return cached;
    const items = catId === "all"
      ? await contentService.getAllMovies()
      : await contentService.getMoviesByCategory(catId);
    itemsCacheRef.current.set(catId, items);
    return items;
  }, [contentService]);

  /** Raw provider VOD info for the TV detail view. */
  const fetchMovieInfo = useCallback((streamId) => contentService.getMovieInfoRaw(streamId), [contentService]);

  /** Build url + start playback + navigate to the player. */
  const playMovie = useCallback(({ streamId, name, cover = null, containerExtension = "mp4", startTime = 0 }) => {
    const url = contentService.buildMovieUrl(streamId, containerExtension || "mp4");
    playVideo({ type: "movies", streamId, name, url, cover, startTime });
    navigation?.navigate?.("VideoPlayer");
  }, [contentService, playVideo, navigation]);

  /** Play an already-built video object (used by the MovieDetail component path). */
  const playVideoObject = useCallback((videoObj) => {
    playVideo(videoObj);
    navigation?.navigate?.("VideoPlayer");
  }, [playVideo, navigation]);

  return {
    // status
    loading, error, reload: load, activeUserId,
    // discover + shelves (native/web)
    discoverItems, shelves, handleShelfVisible, handleLoadMore,
    // category drill-in
    categoryPage, openCategory, closeCategory,
    isTopRatedCategory, topRatedHasMore, topRatedLoadingMore, handleTopRatedMore,
    // detail + play
    selectedMovie, selectMovie, clearSelectedMovie,
    playMovie, playVideoObject,
    // TV helpers
    categories: shelves, // shelves carry {id,name}; TV grid only needs those
    getCategoryItems, fetchMovieInfo,
  };
}
