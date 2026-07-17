import { useState, useEffect, useCallback, useRef } from "react";
import { usePlayback } from "../../context/AppContext";
import { useContentService } from "./useContentService";
import tmdbApi from "../../services/tmdbApi";
import { MemoryManager } from "../../platform/optimization/MemoryManager";
import { isLowEndDevice } from "../../utils/deviceTier";
import { isAuthError, describeError } from "../../utils/authError";
import { isConnectivityError } from "../../utils/networkError.logic.js";

// Cap the drill-in item cache so a long browsing session can't pin the item lists
// for every category in memory at once (WebOS budget is tight). Halved on low-RAM
// devices to shed memory pressure sooner.
const ITEMS_CACHE_MAX = isLowEndDevice() ? 4 : 8;

export const byRatingDesc = (list) =>
  [...(list || [])]
    .filter((s) => Number.parseFloat(s.rating) > 0)
    .sort((a, b) => Number.parseFloat(b.rating) - Number.parseFloat(a.rating));

/**
 * Shared engine behind useMovies and useSeries. Movies and series differ only in
 * which ContentService methods they call, their TMDB (type, idField), their
 * discover-pill labels, and the detail/playback tail of the returned object — so
 * that catalog logic (lazy shelves + circuit breaker, the TMDB top-rated cursor
 * prefetch, drill-in with stale-response guards, the LRU drill-in cache) lives
 * here ONCE and each hook is a thin wrapper that supplies `config` and remaps the
 * tail. The two copies were byte-identical and drifted by hand; this removes that.
 *
 * @param {object} config
 * @param {object} [config.navigation]              react-navigation nav (for playVideoObject callers)
 * @param {string} config.logName                   "useMovies" | "useSeries" — for log prefixes
 * @param {string} config.tmdbType                  TMDB media type: "movie" | "tv"
 * @param {string} config.idField                   id field for TMDB matching: "stream_id" | "series_id"
 * @param {Array}  config.discoverItems             discover pills ([{id,label,icon}])
 * @param {(cs:object)=>Promise<Array>} config.getAll         whole-catalog fetch
 * @param {(cs:object)=>Promise<Array>} config.getCategories  category list
 * @param {(cs:object,catId:any)=>Promise<Array>} config.getByCategory  one category's items
 *
 * Returns the 19 shared keys the screens consume, plus the generic detail-select
 * primitives (`selected`/`select`/`clearSelected`), `playVideoObject`, and the raw
 * `contentService`/`playVideo`/`navigation` deps so the wrapper can build its
 * kind-specific helpers (playMovie, fetchSeriesInfo, …).
 */
export function useCatalog({ navigation, logName, tmdbType, idField, discoverItems, getAll, getCategories, getByCategory }) {
  const { contentService, activeUser, activeUserId } = useContentService();
  const { playVideo } = usePlayback();

  const [loading, setLoading] = useState(false);
  // True once the first category load has completed (success, error, or empty),
  // so a screen can tell "still loading" apart from "loaded but zero shelves"
  // (the M3U live-only case) without treating the latter as a stuck spinner.
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  // A user-facing reason when the failure is an auth/expired one (else null, so
  // the screen falls back to its generic "check your connection" copy).
  const [errorMessage, setErrorMessage] = useState(null);
  const [shelves, setShelves] = useState([]);
  const [categoryPage, setCategoryPage] = useState(null); // { catId, name, items }
  const [selected, setSelected] = useState(null); // raw item for detail
  const [topRatedHasMore, setTopRatedHasMore] = useState(false);
  const [topRatedLoadingMore, setTopRatedLoadingMore] = useState(false);

  const loadedRef = useRef(new Set());
  // Circuit breaker: set once a shelf fetch fails with a provider auth error
  // (401/403). Because Xtream blocks at the account level, that first failure
  // means every remaining category will fail too — so we stop firing them and
  // surface the error panel instead of fanning out hundreds of doomed requests.
  const authFailedRef = useRef(false);
  const allShuffledRef = useRef([]);
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

  // ── Top-rated prefetch (TMDB) ───────────────────────────────────────────────
  const prefetchTopRated = useCallback(async () => {
    // TV has no discover/top-rated UI, so skip the TMDB matching — but still warm
    // the whole-catalog fetch in the background so opening "All …" (which calls
    // getAll) is instant instead of downloading the catalog on click.
    if (typeof globalThis !== "undefined" && globalThis.__TV__) {
      getAll(contentService).catch(() => {});
      return null;
    }
    try {
      const streams = await getAll(contentService);
      if (!streams?.length) return null;
      if (!tmdbApi.hasKey) {
        return { streams, matched: byRatingDesc(streams), hasTmdb: false, seenIds: new Set(), totalPages: 0, hasMore: false };
      }
      const seenIds = new Set();
      const { matched, totalPages, hasMore } = await tmdbApi.matchTopRatedRange({
        type: tmdbType, iptvItems: streams, idField, fromPage: 1, toPage: 5, seenIds,
      });
      return { streams, matched, seenIds, totalPages, hasMore, hasTmdb: true };
    } catch { return null; }
  }, [contentService, getAll, tmdbType, idField]);

  // Defer the (expensive) top-rated prefetch — getAll() over the whole catalog +
  // up to 5 concurrent TMDB calls — off the initial-mount critical path so it
  // doesn't compete with the visible shelves' category fetches. Consumers still
  // `await` this promise; the work just starts when the main thread is idle
  // (capped at 2s) instead of synchronously inside load().
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
    setErrorMessage(null);
    loadedRef.current.clear();
    authFailedRef.current = false;
    allShuffledRef.current = [];
    prefetchRef.current = { topRated: null };
    itemsCacheRef.current.clear();
    openAbortRef.current?.abort();
    openAbortRef.current = null;
    setShelves([]);
    try {
      const cats = await getCategories(contentService); // [{ id, name }]
      if (!cats?.length) return;
      setShelves(cats.map((c) => ({
        id: c.id, name: c.name, items: null, totalCount: null,
        hasMore: false, loadingMore: false, manual: false,
      })));
      prefetchRef.current = { topRated: schedulePrefetch() };
    } catch (err) {
      console.error(`${logName}.load:`, err);
      setError(true);
      setErrorMessage(describeError(err));
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [activeUser, contentService, getCategories, schedulePrefetch, logName]);

  // Key ONLY on activeUserId, not `load`: its identity churns when `users` is
  // replaced (cached-then-remote account apply), which re-fired this effect in a
  // loop and — because each pass resets loading/error — hid the error panel. See
  // useLiveTV for the full note.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (activeUserId) load(); }, [activeUserId]);

  // ── Lazy shelf load ─────────────────────────────────────────────────────────
  const handleShelfVisible = useCallback(async (catId) => {
    // Breaker tripped by an earlier 401/403: don't fire more doomed requests.
    if (authFailedRef.current || loadedRef.current.has(catId)) return;
    // Mark loaded BEFORE the await — this is the no-loop guard. A shelf that
    // fails below stays in loadedRef, so it is never re-fetched on its own
    // (a remount re-firing onVisible hits the early return above). It reloads
    // only when load() clears the set (account switch / pull-to-refresh).
    loadedRef.current.add(catId);
    try {
      let all;
      if (catId === "all") {
        const prefetched = prefetchRef.current.topRated ? await prefetchRef.current.topRated : null;
        const streams = prefetched?.streams || (await getAll(contentService));
        all = [...(streams || [])].sort(() => Math.random() - 0.5);
        allShuffledRef.current = all;
      } else if (catId === "top_rated") {
        // Real categories never use this id; fall back to rating sort.
        all = byRatingDesc(await getAll(contentService));
      } else {
        all = await getByCategory(contentService, catId);
        // Cache the full array (warms the drill-in cache); the render window
        // now reveals items progressively, so no client-side slice is needed.
        itemsCacheRef.current.set(catId, all);
      }
      const items = all || [];
      setShelves((prev) => prev.map((s) =>
        s.id === catId ? { ...s, items, totalCount: items.length, hasMore: false } : s));
    } catch (err) {
      // A provider auth error (401/403) OR a connectivity fault (network / timeout
      // / gateway 521) means every category fails the same way — trip the breaker
      // and surface the full error panel ("if one fails, all fail") instead of
      // hiding this shelf and letting the rest spin then silently empty.
      if (isAuthError(err) || isConnectivityError(err)) {
        authFailedRef.current = true;
        console.warn(`${logName}: access denied / unreachable loading shelf "${catId}" — stopping`, err);
        setError(true);
        setErrorMessage(describeError(err));
        return;
      }
      // Isolated (non-auth, non-connectivity) failure: hide just this shelf
      // (items:[] → ContentShelf renders null). loadedRef still holds catId, so it
      // won't retry — no loop. Log it so a broken rail isn't a silent mystery.
      console.warn(`${logName}: shelf "${catId}" failed to load`, err);
      setShelves((prev) => prev.map((s) =>
        s.id === catId ? { ...s, items: [], totalCount: 0, hasMore: false } : s));
    }
  }, [contentService, getAll, getByCategory, logName]);

  // Xtream has no paging and the render window reveals the full fetched array,
  // so per-shelf "load more" is a no-op. Kept to preserve the screen prop contract.
  const handleLoadMore = useCallback(async () => {}, []);

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
          const streams = prefetched?.streams || (await getAll(contentService));
          allShuffledRef.current = [...(streams || [])].sort(() => Math.random() - 0.5);
        }
        all = allShuffledRef.current;
      } else if (catId === "top_rated") {
        const prefetched = prefetchRef.current.topRated ? await prefetchRef.current.topRated : null;
        if (prefetched?.hasTmdb) {
          const { streams, matched, seenIds, totalPages, hasMore } = prefetched;
          if (!isCurrent()) return;
          topRatedCursorRef.current = { streams, type: tmdbType, idField, page: 5, totalPages, seenIds, prefetch: null, prefetchTo: 0 };
          setTopRatedHasMore(hasMore);
          all = matched.length ? matched : byRatingDesc(streams);
          if (!matched.length) setTopRatedHasMore(false);
          else if (hasMore) kickoffPrefetch(topRatedCursorRef.current);
        } else if (prefetched) {
          all = prefetched.matched; setTopRatedHasMore(false);
        } else {
          const streams = await getAll(contentService);
          if (tmdbApi.hasKey) {
            const seenIds = new Set();
            const { matched, totalPages, hasMore } = await tmdbApi.matchTopRatedRange({ type: tmdbType, iptvItems: streams || [], idField, fromPage: 1, toPage: 5, seenIds, signal: controller.signal });
            if (!isCurrent()) return;
            topRatedCursorRef.current = { streams: streams || [], type: tmdbType, idField, page: 5, totalPages, seenIds, prefetch: null, prefetchTo: 0 };
            setTopRatedHasMore(hasMore);
            all = matched;
            if (!all.length) { all = byRatingDesc(streams); setTopRatedHasMore(false); }
            else if (hasMore) kickoffPrefetch(topRatedCursorRef.current);
          } else { all = byRatingDesc(streams); setTopRatedHasMore(false); }
        }
      } else {
        all = await getByCategory(contentService, catId);
        if (!loadedRef.current.has(catId)) handleShelfVisible(catId);
      }
      if (!isCurrent()) return; // stale response — discard
      setCategoryPage((prev) => prev ? { ...prev, items: all || [] } : prev);
    } catch (err) {
      if (err?.name === "AbortError" || !isCurrent()) return; // cancelled / superseded
      setCategoryPage((prev) => prev ? { ...prev, items: [] } : prev);
    }
  }, [contentService, getAll, getByCategory, handleShelfVisible, kickoffPrefetch, tmdbType, idField]);

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

  // ── Detail select (generic; wrappers alias to select{Movie,Series}) ──────────
  const select = useCallback((item) => setSelected(item), []);
  const clearSelected = useCallback(() => setSelected(null), []);

  /** TV drill-in: get a category's items (cached). */
  const getCategoryItems = useCallback(async (catId) => {
    const cached = itemsCacheRef.current.get(catId);
    if (cached) return cached;
    const items = catId === "all"
      ? await getAll(contentService)
      : await getByCategory(contentService, catId);
    itemsCacheRef.current.set(catId, items);
    return items;
  }, [contentService, getAll, getByCategory]);

  /** Play an already-built video object + navigate (SeriesDetail/MovieDetail path). */
  const playVideoObject = useCallback((videoObj) => {
    playVideo(videoObj);
    navigation?.navigate?.("VideoPlayer");
  }, [playVideo, navigation]);

  return {
    // status
    loading, loaded, error, errorMessage, reload: load, activeUserId,
    // discover + shelves (native/web)
    discoverItems, shelves, handleShelfVisible, handleLoadMore,
    // category drill-in
    categoryPage, openCategory, closeCategory,
    isTopRatedCategory, topRatedHasMore, topRatedLoadingMore, handleTopRatedMore,
    // TV helpers
    categories: shelves, // shelves carry {id,name}; TV grid only needs those
    getCategoryItems,
    // generic detail-select + play, and raw deps for wrapper-specific helpers
    selected, select, clearSelected, playVideoObject,
    contentService, playVideo, navigation,
  };
}
