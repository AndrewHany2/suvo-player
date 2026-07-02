// Storage (AsyncStorage) is resolved LAZILY rather than imported at module top
// so that merely loading this module doesn't require react-native — that keeps
// `node --test` able to import it (and defers AsyncStorage off the boot path).
// Falls back to a no-op backend if resolution fails (e.g. under the test runner).
let _storageBackend;
let _storagePromise;
const NOOP_STORAGE = { getItem: async () => null, setItem: async () => {} };
function getStorage() {
  if (_storageBackend) return Promise.resolve(_storageBackend);
  _storagePromise ??= import('../utils/storage')
    .then((m) => (_storageBackend = m.default))
    .catch(() => (_storageBackend = NOOP_STORAGE));
  return _storagePromise;
}
// Test seam: inject a storage mock so persistence/hydration can be exercised.
export function __setStorageBackend(s) { _storageBackend = s; }

const TTL = {
  categories: 10 * 60 * 1000,
  streams:     5 * 60 * 1000,
  seriesInfo: 30 * 60 * 1000,
};

// Hard cap on in-memory cache entries so the Map cannot grow unbounded over a
// long session (one entry per category/info id can otherwise accumulate).
const MAX_CACHE_ENTRIES = 200;
// Max concurrent requests when fanning out per-category in the robust fetchers.
const FANOUT_CONCURRENCY = 5;
// Abort a provider request that hasn't responded in this long so a hung server
// fails fast (and stale-while-revalidate can serve the previous value) instead
// of stalling a screen indefinitely.
const FETCH_TIMEOUT = 15 * 1000;
// The "all streams / all series" bulk endpoints return the ENTIRE catalog (can be
// many MB) and legitimately take much longer than an interactive call. Give them
// a generous budget so a large-but-working dump isn't aborted into the slower
// per-category fan-out fallback (which only exists for servers that BLOCK bulk).
const BULK_FETCH_TIMEOUT = 90 * 1000;
// Only these (small, slow-changing) keys are persisted to disk. Full stream
// lists are intentionally NOT persisted — they can be multiple MB and would
// blow the ~5 MB localStorage quota on web/webOS.
const PERSIST_KEYS = new Set(['live_categories', 'vod_categories', 'series_categories']);
// Debounce disk writes so a burst of category sets re-stringifies once.
const PERSIST_DEBOUNCE = 2 * 1000;
const persistStorageKey = (ns) => `iptvcache_${ns}`;

// Run `tasks` (array of () => Promise) with at most `limit` in flight at once.
// Preserves result order. Used to bound the per-category fan-out so we don't
// open hundreds of sockets at once on large libraries.
async function runPool(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  const workers = new Array(Math.min(limit, tasks.length)).fill(0).map(async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  });
  await Promise.all(workers);
  return results;
}

// Dedupe a stream/series list by its id field, dropping entries whose id is
// null/undefined. The provider's bulk endpoints can return the same title in
// multiple categories (or id-less placeholder rows); without this the grid keys
// on a non-unique id and React mis-reconciles cards (ghosted badges / glitches).
export function dedupeById(list, idField) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const id = item?.[idField];
    if (id == null || seen.has(id)) continue;
    seen.add(id);
    out.push(item);
  }
  return out;
}

export class IPTVApi {
  _cache = new Map();
  // Per-key in-flight fetch promises so a miss (or a stale-revalidate) fires at
  // most one network request per key even under a burst of concurrent reads.
  _inflight = new Map();
  // Credential-scoped disk-cache namespace, the hydrate promise for it, and the
  // debounced persist timer.
  _ns = null;
  _hydratePromise = null;
  _persistTimer = null;
  baseUrl = null;
  username = null;
  password = null;

  setCredentials(host, username, password) {
    let cleanHost = host.replace(/^(https?:\/\/)/, '');
    cleanHost = cleanHost.replace(/\/$/, '');
    const newBase = `http://${cleanHost}`;
    if (newBase !== this.baseUrl || username !== this.username) {
      // Credentials changed → the old account's cache is invalid. Drop it and
      // begin hydrating this account's persisted category cache from disk.
      this._cache.clear();
      this._inflight.clear();
      clearTimeout(this._persistTimer);
      this._ns = this._hash(`${newBase}|${username}`);
      this._hydratePromise = this._hydrate();
    }
    this.baseUrl = newBase;
    this.username = username;
    this.password = password;
  }

  // djb2 — small, fast, deterministic, filename-safe. Not for security.
  _hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  // Load this account's persisted category entries into the in-memory cache.
  // Entries are loaded even if TTL-expired: stale-while-revalidate will refresh
  // them on first read while the stale value renders instantly. Never throws.
  async _hydrate() {
    const ns = this._ns;
    if (!ns) return;
    try {
      const storage = await getStorage();
      const raw = await storage.getItem(persistStorageKey(ns));
      if (!raw) return;
      const blob = JSON.parse(raw);
      for (const [key, entry] of Object.entries(blob)) {
        // A concurrent setCredentials may have switched accounts mid-await —
        // don't pollute the new account's cache with the old one's data.
        if (this._ns !== ns) return;
        if (entry && entry.data !== undefined && !this._cache.has(key)) {
          this._cache.set(key, { data: entry.data, expiresAt: entry.expiresAt ?? 0 });
        }
      }
    } catch { /* missing / corrupt / storage error — ignore */ }
  }

  _ensureHydrated() {
    return this._hydratePromise || Promise.resolve();
  }

  // Debounced write of the persist-whitelisted subset of the cache to disk.
  _schedulePersist() {
    clearTimeout(this._persistTimer);
    this._persistTimer = setTimeout(() => this._persist(), PERSIST_DEBOUNCE);
  }

  async _persist() {
    const ns = this._ns;
    if (!ns) return;
    const blob = {};
    for (const key of PERSIST_KEYS) {
      const entry = this._cache.get(key);
      if (entry) blob[key] = { data: entry.data, expiresAt: entry.expiresAt };
    }
    try {
      const storage = await getStorage();
      await storage.setItem(persistStorageKey(ns), JSON.stringify(blob));
    } catch { /* quota exceeded / storage error — skip, never crash */ }
  }

  _cacheSet(key, data, ttl) {
    // Refresh insertion order so the cap evicts the genuinely oldest entry.
    if (this._cache.has(key)) this._cache.delete(key);
    else if (this._cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = this._cache.keys().next().value;
      if (oldest !== undefined) this._cache.delete(oldest);
    }
    this._cache.set(key, { data, expiresAt: Date.now() + ttl });
    if (PERSIST_KEYS.has(key)) this._schedulePersist();
  }

  // Foreground fetch for a cache miss: dedupe concurrent misses on the same key
  // and cache the result. Returns the (awaitable) data.
  _refresh(key, ttl, fetcher) {
    const inflight = this._inflight.get(key);
    if (inflight) return inflight;
    const p = (async () => {
      try {
        const data = await fetcher();
        this._cacheSet(key, data, ttl);
        return data;
      } finally {
        this._inflight.delete(key);
      }
    })();
    this._inflight.set(key, p);
    return p;
  }

  // Background refresh for a stale hit: fire-and-forget, deduped, keep the stale
  // value on failure.
  _revalidate(key, ttl, fetcher) {
    if (this._inflight.has(key)) return;
    const p = (async () => {
      try {
        const data = await fetcher();
        this._cacheSet(key, data, ttl);
      } catch { /* keep stale value */ }
      finally { this._inflight.delete(key); }
    })();
    this._inflight.set(key, p);
  }

  buildUrl(action, params = {}) {
    const url = new URL(`${this.baseUrl}/player_api.php`);
    url.searchParams.append('username', this.username);
    url.searchParams.append('password', this.password);
    url.searchParams.append('action', action);
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, value);
    });
    return url.toString();
  }

  async fetch(url, { signal, timeout = FETCH_TIMEOUT } = {}) {
    // Abort on our own timeout OR when the caller's signal aborts (whichever
    // first). A hung provider then rejects fast instead of stalling forever.
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
    const onAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      const response = await globalThis.fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json, text/plain, */*' },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.json();
    } catch (e) {
      if (timedOut) throw new Error(`Request timed out after ${timeout}ms`);
      throw e;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }

  async _cached(key, ttl, fetcher) {
    // Only category keys are persisted to disk, so only they need to wait for
    // hydration. Stream/robust/info keys start fetching immediately — this keeps
    // the one-time AsyncStorage load off the first "All Movies/All Series" fetch
    // (which otherwise made the very first open feel slow).
    if (PERSIST_KEYS.has(key)) await this._ensureHydrated();
    const entry = this._cache.get(key);
    if (entry) {
      if (Date.now() <= entry.expiresAt) return entry.data;        // fresh
      this._revalidate(key, ttl, fetcher);                          // stale-while-revalidate
      return entry.data;
    }
    return this._refresh(key, ttl, fetcher);                        // miss
  }

  getLiveCategories() {
    return this._cached('live_categories', TTL.categories, () => this.fetch(this.buildUrl('get_live_categories')));
  }

  getLiveStreamsByCategory(categoryId, { signal } = {}) {
    return this._cached(`live_streams_${categoryId}`, TTL.streams, async () =>
      dedupeById(await this.fetch(this.buildUrl('get_live_streams', { category_id: categoryId }), { signal }), 'stream_id')
    );
  }

  getLiveStreams() {
    return this._cached('live_streams', TTL.streams, async () =>
      dedupeById(await this.fetch(this.buildUrl('get_live_streams')), 'stream_id'));
  }

  getVODCategories() {
    return this._cached('vod_categories', TTL.categories, () => this.fetch(this.buildUrl('get_vod_categories')));
  }

  getVODStreams(categoryId, { signal } = {}) {
    return this._cached(`vod_streams_${categoryId}`, TTL.streams, async () =>
      dedupeById(await this.fetch(this.buildUrl('get_vod_streams', { category_id: categoryId }), { signal }), 'stream_id')
    );
  }

  // Tries the "all" endpoint first, falls back to fanning out per-category if
  // the server blocks bulk fetches (e.g. 403). Dedupes by stream_id.
  getAllVODStreamsRobust() {
    return this._cached('vod_streams_robust', TTL.streams, async () => {
      try {
        const all = await this.fetch(this.buildUrl('get_vod_streams'), { timeout: BULK_FETCH_TIMEOUT });
        if (Array.isArray(all) && all.length > 0) return dedupeById(all, 'stream_id');
      } catch { /* fall through */ }
      const cats = await this.getVODCategories();
      if (!Array.isArray(cats) || !cats.length) return [];
      // Bounded fan-out instead of unbounded Promise.all so large libraries
      // don't open hundreds of sockets at once.
      const results = await runPool(
        cats.map((c) => () => this.getVODStreams(c.category_id).catch(() => [])),
        FANOUT_CONCURRENCY
      );
      const seen = new Set();
      const merged = [];
      for (let i = 0; i < results.length; i++) {
        for (const item of results[i] || []) {
          if (item?.stream_id != null && !seen.has(item.stream_id)) {
            seen.add(item.stream_id);
            merged.push(item);
          }
        }
        results[i] = null; // release per-category array after merge
      }
      return merged;
    });
  }

  getVODInfo(vodId) {
    return this._cached(`vod_info_${vodId}`, TTL.seriesInfo, () =>
      this.fetch(this.buildUrl('get_vod_info', { vod_id: vodId }))
    );
  }

  getSeriesCategories() {
    return this._cached('series_categories', TTL.categories, () => this.fetch(this.buildUrl('get_series_categories')));
  }

  getSeries(categoryId, { signal } = {}) {
    return this._cached(`series_${categoryId}`, TTL.streams, async () =>
      dedupeById(await this.fetch(this.buildUrl('get_series', { category_id: categoryId }), { signal }), 'series_id')
    );
  }

  // Tries the "all" endpoint first, falls back to fanning out per-category if
  // the server blocks bulk fetches (e.g. 403). Dedupes by series_id.
  getAllSeriesRobust() {
    return this._cached('series_robust', TTL.streams, async () => {
      try {
        const all = await this.fetch(this.buildUrl('get_series'), { timeout: BULK_FETCH_TIMEOUT });
        if (Array.isArray(all) && all.length > 0) return dedupeById(all, 'series_id');
      } catch { /* fall through */ }
      const cats = await this.getSeriesCategories();
      if (!Array.isArray(cats) || !cats.length) return [];
      // Bounded fan-out instead of unbounded Promise.all so large libraries
      // don't open hundreds of sockets at once.
      const results = await runPool(
        cats.map((c) => () => this.getSeries(c.category_id).catch(() => [])),
        FANOUT_CONCURRENCY
      );
      const seen = new Set();
      const merged = [];
      for (let i = 0; i < results.length; i++) {
        for (const item of results[i] || []) {
          if (item?.series_id != null && !seen.has(item.series_id)) {
            seen.add(item.series_id);
            merged.push(item);
          }
        }
        results[i] = null; // release per-category array after merge
      }
      return merged;
    });
  }

  getSeriesInfo(seriesId) {
    return this._cached(`series_info_${seriesId}`, TTL.seriesInfo, () =>
      this.fetch(this.buildUrl('get_series_info', { series_id: seriesId }))
    );
  }

  getShortEpg(streamId, limit = 2) {
    return this._cached(`epg_${streamId}_${limit}`, 5 * 60 * 1000, () =>
      this.fetch(this.buildUrl('get_short_epg', { stream_id: streamId, limit }))
    );
  }

  buildStreamUrl(type, streamId, extension = 'ts') {
    if (type === 'live')   return `${this.baseUrl}/live/${this.username}/${this.password}/${streamId}.${extension}`;
    if (type === 'movie')  return `${this.baseUrl}/movie/${this.username}/${this.password}/${streamId}.${extension}`;
    if (type === 'series') return `${this.baseUrl}/series/${this.username}/${this.password}/${streamId}.${extension}`;
    return null;
  }
}

export default new IPTVApi();
