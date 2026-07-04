// @ts-check
/**
 * PURE watch-history helpers — no React, no AsyncStorage, no Supabase.
 *
 * These are the shared, unit-testable pieces behind AppContext's watch-history
 * bookkeeping so `addToWatchHistory` and `updateWatchProgress` agree on the
 * (type, streamId) identity of an entry, and so a progress event with no
 * matching row still lands (upsert, not silent no-op).
 */

import { resolveProgressFields } from "./historyEntry.js";

// Max number of history entries kept locally, remotely-fetched, and after merge.
export const MAX_HISTORY = 20;

/**
 * PURE: normalize a raw item into a consistent history-entry shape so every
 * platform can resolve resume. Single write chokepoint used by both
 * addToWatchHistory and updateWatchProgress.
 *
 * @param {Object} item
 * @returns {Object}
 */
export function normalizeHistoryItem(item) {
  const type = item.type === "movie" ? "movies" : item.type;
  const streamId = item.streamId ?? item.stream_id ?? item.id;
  const episodeId = item.episodeId ?? streamId;
  const cover =
    item.cover ?? item.poster ?? item.stream_icon ?? item.movie_image ?? null;
  const normalized = { ...item, type, streamId, episodeId, cover };
  if (item.container_extension != null)
    normalized.container_extension = item.container_extension;
  return normalized;
}

/**
 * PURE: normalize a raw `type` the same way normalizeHistoryItem does, so a
 * bare (streamId, type) pair from a progress event resolves the same key.
 *
 * @param {string} type
 * @returns {string}
 */
export function normalizeType(type) {
  return type === "movie" ? "movies" : type;
}

/**
 * PURE: does history entry `h` refer to a *different* title than `item`?
 * Series match by seriesId, else seriesName, else streamId; everything else by
 * (type, streamId). Returning true means "keep h" (it's a different title).
 *
 * @param {Object} h
 * @param {Object} item
 * @returns {boolean}
 */
export function isDifferentTitle(h, item) {
  if (item.type === "series" && h.type === "series") {
    if (item.seriesId && h.seriesId) return h.seriesId !== item.seriesId;
    if (item.seriesName && h.seriesName) return h.seriesName !== item.seriesName;
    return h.streamId !== item.streamId;
  }
  return !(h.type === item.type && h.streamId === item.streamId);
}

/**
 * PURE: add/refresh a (normalized) item in a history array. Newest-wins:
 * the (re)added entry moves to the front with a fresh `watchedAt`, existing
 * progress is preserved via resolveProgressFields, dedupe is by title, and the
 * result is capped to MAX_HISTORY.
 *
 * @param {Object[]} history - existing history (unmodified)
 * @param {Object} item - already normalized via normalizeHistoryItem
 * @param {string} now - ISO timestamp for watchedAt
 * @returns {{ history: Object[], entry: Object }}
 */
export function upsertHistoryItem(history, item, now) {
  const existingIdx = history.findIndex((h) => !isDifferentTitle(h, item));
  let entry;
  let next;
  if (existingIdx === -1) {
    entry = {
      ...item,
      watchedAt: now,
      id: `${item.type}_${item.streamId || item.id}_${Date.now()}`,
      ...resolveProgressFields(undefined, item),
    };
    next = [entry, ...history].slice(0, MAX_HISTORY);
  } else {
    const prev = history[existingIdx];
    entry = {
      ...prev,
      ...item,
      id: prev.id,
      watchedAt: now,
      ...resolveProgressFields(prev, item),
    };
    next = [entry, ...history.filter((_, i) => i !== existingIdx)].slice(
      0,
      MAX_HISTORY,
    );
  }
  return { history: next, entry };
}

/**
 * PURE: apply a progress event (currentTime/duration) to a history array.
 * Upsert semantics: if a matching (type, streamId) row exists it is updated in
 * place (position preserved), moved nowhere; if none exists a new entry is
 * created at the front so progress emitted before/without addToWatchHistory is
 * never lost. Result is capped to MAX_HISTORY.
 *
 * @param {Object[]} history
 * @param {{ streamId: any, type: string, currentTime: number, duration: number }} ev
 * @param {string} now - ISO timestamp for watchedAt
 * @returns {{ history: Object[], entry: Object }}
 */
export function applyProgress(history, ev, now) {
  const type = normalizeType(ev.type);
  const streamId = ev.streamId;
  const idx = history.findIndex(
    (h) => h.streamId === streamId && h.type === type,
  );
  if (idx === -1) {
    // No existing row — create one so resume data survives.
    const entry = {
      streamId,
      type,
      id: `${type}_${streamId}_${Date.now()}`,
      currentTime: Number(ev.currentTime) || 0,
      duration: Number(ev.duration) || 0,
      watchedAt: now,
    };
    return { history: [entry, ...history].slice(0, MAX_HISTORY), entry };
  }
  const entry = {
    ...history[idx],
    currentTime: ev.currentTime,
    duration: ev.duration,
    watchedAt: now,
  };
  const next = history.map((h, i) => (i === idx ? entry : h));
  return { history: next, entry };
}

/**
 * PURE: merge local + remote history by `id`, newest-wins by `watchedAt`,
 * sorted newest-first and capped to MAX_HISTORY.
 *
 * @param {Object[]} local
 * @param {Object[]} remote
 * @returns {Object[]}
 */
export function mergeHistories(local, remote) {
  const map = new Map();
  for (const item of local) map.set(item.id, item);
  for (const item of remote) {
    const existing = map.get(item.id);
    if (!existing || new Date(item.watchedAt) > new Date(existing.watchedAt))
      map.set(item.id, item);
  }
  return Array.from(map.values())
    .sort((a, b) => new Date(b.watchedAt) - new Date(a.watchedAt))
    .slice(0, MAX_HISTORY);
}
