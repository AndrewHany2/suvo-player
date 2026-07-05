import { useState, useEffect, useCallback, useRef } from "react";
import { useApp } from "../../context/AppContext";
import { useContentService } from "./useContentService";
import { MemoryManager } from "../../platform/optimization/MemoryManager";
import { epgNowTitle, toFlatChannel } from "./useLiveTV.helpers";
import { isLowEndDevice } from "../../utils/deviceTier";

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
  const { playVideo } = useApp();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [categories, setCategories] = useState([]);

  // LRU-capped catId -> normalized channel array. Shared by the shelf lazy-load
  // (web/native) and the TV drill-in so a re-open is instant.
  const channelsCacheRef = useRef(new MemoryManager(CHANNELS_CACHE_MAX));

  // ── Initial load: live categories ───────────────────────────────────────────
  const loadCategories = useCallback(async () => {
    if (!activeUser) return;
    setLoading(true);
    setError(false);
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

  useEffect(() => { if (activeUserId) loadCategories(); }, [activeUserId, loadCategories]);

  // ── Channel fetch (cached) ──────────────────────────────────────────────────
  /**
   * Normalized channel array for a category (cached). Throws on fetch failure so
   * the caller can decide between retry (web queue) and mark-empty; the screens
   * own that policy.
   */
  const getChannels = useCallback(async (catId) => {
    const cached = channelsCacheRef.current.get(catId);
    if (cached) return cached;
    const items = await contentService.getLiveChannels(catId);
    channelsCacheRef.current.set(catId, items || []);
    return items || [];
  }, [contentService]);

  /**
   * Flat-shaped channel array for the shelf views (web/native). Same cache as
   * getChannels; the flattening is cheap and done at the call boundary.
   */
  const getFlatChannels = useCallback(async (catId) => {
    const items = await getChannels(catId);
    return (items || []).map((ch) => toFlatChannel(ch, contentService.buildLiveUrl));
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
