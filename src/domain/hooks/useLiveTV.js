import { useState, useEffect, useCallback, useRef } from "react";
import { usePlayback } from "../../context/AppContext";
import { useContentService } from "./useContentService";
import { MemoryManager } from "../../platform/optimization/MemoryManager";
import { epgNowTitle, toFlatChannel } from "./useLiveTV.helpers";
import { isLowEndDevice } from "../../utils/deviceTier";
import { isAuthError } from "../../utils/authError";

// Cap the per-category channel cache so a long browsing session can't pin every
// category's channel list in memory at once (WebOS budget is tight). Halved on
// low-RAM devices to shed memory pressure sooner.
const CHANNELS_CACHE_MAX = isLowEndDevice() ? 6 : 12;

/**
 * Single source of truth for the Live TV feature.
 *
 * Holds the data engine the three LiveTVScreen variants used to copy-paste:
 * live categories, lazy per-category channel loading (cached), short-EPG "now"
 * title fetch, and channel playback. Built on ContentService
 * (getLiveCategories / getLiveChannels / getShortEpg / buildLiveUrl).
 *
 * Live TV has no TMDB/top-rated/discover engine and no season→episode detail,
 * so this is deliberately leaner than useMovies/useSeries: categories in, a
 * cached channel fetcher, EPG, and play. The *scheduling* of channel fetches
 * (web's bounded FIFO queue, native's on-viewable) and all D-pad/focus/search
 * state stay in the screens; they read the engine from here.
 */

export function useLiveTV({ navigation } = {}) {
  const { contentService, activeUser, activeUserId } = useContentService();
  const { playVideo } = usePlayback();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [categories, setCategories] = useState([]);

  // LRU-capped catId -> normalized channel array. Shared by the shelf lazy-load
  // (web/native) and the TV drill-in so a re-open is instant.
  const channelsCacheRef = useRef(new MemoryManager(CHANNELS_CACHE_MAX));
  // Circuit breaker: set once a channel fetch fails with a provider auth error
  // (401/403). Xtream blocks at the account level, so that first failure means
  // every remaining category will fail too — trip the error panel and stop
  // rather than fanning out one doomed request per category.
  const authFailedRef = useRef(false);

  // ── Initial load: live categories ───────────────────────────────────────────
  const loadCategories = useCallback(async () => {
    if (!activeUser) return;
    setLoading(true);
    setError(false);
    authFailedRef.current = false;
    channelsCacheRef.current.clear();
    setCategories([]);
    try {
      const cats = await contentService.getLiveCategories(); // [{ id, name }]
      if (!cats?.length) return;
      setCategories(cats.map((c) => ({ id: c.id, name: c.name })));
    } catch (err) {
      console.error("useLiveTV.loadCategories:", err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [activeUser, contentService]);

  // Key ONLY on activeUserId (the stable account id), NOT loadCategories: the
  // callback's identity churns whenever `users` is replaced (cached-then-remote
  // account apply rebuilds the array, so `activeUser` → loadCategories get fresh
  // identities). Depending on it re-fired this effect in a loop, and because
  // each pass resets loading=true/error=false the error panel never rendered.
  // Same account id => no refetch; a real account switch still reloads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (activeUserId) loadCategories(); }, [activeUserId]);

  // ── Channel fetch (cached) ──────────────────────────────────────────────────
  /**
   * Normalized channel array for a category (cached). Throws on fetch failure so
   * the caller can decide between retry (web queue) and mark-empty; the screens
   * own that policy.
   */
  const getChannels = useCallback(async (catId) => {
    const cached = channelsCacheRef.current.get(catId);
    if (cached) return cached;
    // Breaker tripped by an earlier 401/403: fail fast without hitting the
    // network, so a burst of category fetches can't keep hammering a blocked
    // account after we already know access is denied.
    if (authFailedRef.current) throw new Error("HTTP error! status: 403");
    try {
      const items = await contentService.getLiveChannels(catId);
      channelsCacheRef.current.set(catId, items || []);
      return items || [];
    } catch (err) {
      // Account-level auth failure — surface the error panel once ("if one
      // fails, all fail") and stop. The caller still gets the throw to decide
      // its own per-shelf handling.
      if (isAuthError(err)) { authFailedRef.current = true; setError(true); }
      throw err;
    }
  }, [contentService]);

  /**
   * Flat-shaped channel array for the shelf views (web/native). Same cache as
   * getChannels; the flattening is cheap and done at the call boundary.
   */
  const getFlatChannels = useCallback(async (catId) => {
    const items = await getChannels(catId);
    // Wrap buildLiveUrl in an arrow so it's invoked as a method on
    // contentService — passing the bare reference detaches `this`, and the
    // method reaches the backend via `this.api` (m3u OR Xtream), so an unbound
    // call throws "Cannot read properties of undefined (reading 'api')".
    return (items || []).map((ch) =>
      toFlatChannel(ch, (streamId, ext) => contentService.buildLiveUrl(streamId, ext)));
  }, [getChannels, contentService]);

  // ── Short EPG "now" title ───────────────────────────────────────────────────
  const fetchEpgTitle = useCallback(async (streamId) => {
    const data = await contentService.getShortEpg(streamId, 1);
    return epgNowTitle(data);
  }, [contentService]);

  // ── Playback ────────────────────────────────────────────────────────────────
  const buildLiveUrl = useCallback(
    (streamId, extension) => contentService.buildLiveUrl(streamId, extension),
    [contentService],
  );

  /** Play a flat channel object (web/native — url already built into the item). */
  const playChannel = useCallback((item) => {
    playVideo({
      type: "live",
      streamId: item.stream_id || item.id,
      name: item.name,
      url: item.url,
    });
    navigation?.navigate?.("VideoPlayer");
  }, [playVideo, navigation]);

  /** Play a normalized channel (TV — build the .ts url here). */
  const playChannelTV = useCallback((item) => {
    const url = contentService.buildLiveUrl(item.stream_id, item.container_extension || "ts");
    playVideo({
      type: "live",
      streamId: item.stream_id,
      name: item.name,
      url,
      cover: item.stream_icon || null,
      startTime: 0,
    });
    navigation?.navigate?.("VideoPlayer");
  }, [contentService, playVideo, navigation]);

  return {
    // status
    loading, error, reload: loadCategories, activeUser, activeUserId,
    // categories + channel fetch
    categories, getChannels, getFlatChannels,
    // epg
    fetchEpgTitle,
    // play
    buildLiveUrl, playChannel, playChannelTV,
  };
}
