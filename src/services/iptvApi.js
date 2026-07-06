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
// Bounded retry for the idempotent GET path: a single transient 5xx / network
// blip on first load otherwise surfaces a hard error (SWR only helps once a
// value is cached). Retries do NOT apply to aborts (caller cancel / timeout)
// or to non-transient 4xx responses.
const FETCH_RETRIES = 2;
const FETCH_RETRY_BACKOFF = 300;
// Small, slow-changing keys persisted together in one blob. Per-category stream
// lists are still NOT persisted here — they can be multiple MB and would blow the
// ~5 MB localStorage quota on web/webOS.
const PERSIST_KEYS = new Set(['live_categories', 'vod_categories', 'series_categories']);
// The two whole-catalog "robust" results ARE persisted, but each under its OWN
// storage key (not the shared blob) so a quota failure on a big catalog can't
// take the categories down with it, and so the big read only happens when the
// user actually opens "All Movies/Series" (lazy disk-load in _cached). Serves the
// stale value instantly on a warm launch; stale-while-revalidate refreshes it.
const BULK_PERSIST_KEYS = new Set(['vod_streams_robust', 'series_robust']);
// Debounce disk writes so a burst of category sets re-stringifies once.
const PERSIST_DEBOUNCE = 2 * 1000;
const persistStorageKey = (ns) => `iptvcache_${ns}`;
const bulkStorageKey = (ns, key) => `iptvcache_${ns}_${key}`;

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
  // Whole-catalog keys whose in-memory value changed since the last disk write.
  // Flushed (each to its own storage key) alongside the category blob on persist.
  _dirtyBulk = new Set();
  baseUrl = null;
  username = null;
  password = null;

  setCredentials(host, username, password) {
    // Preserve an explicit scheme the user provided (https-only Xtream panels
    // break — and mixed-content-block on the https web/Electron build — if we
    // force http://). Default to http only when the host is bare.
    const scheme = /^https:\/\//i.test(host) ? 'https' : 'http';
    const cleanHost = host.replace(/^https?:\/\//i, '').replace(/\/$/, '');
    const newBase = `${scheme}://${cleanHost}`;
    if (newBase !== this.baseUrl || username !== this.username) {
      // Credentials changed → the old account's cache is invalid. Drop it and
      // begin hydrating this account's persisted category cache from disk.
      this._cache.clear();
      this._inflight.clear();
      this._dirtyBulk.clear();
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
    // Flush each dirty whole-catalog key to its own storage entry. Isolated
    // try/catch per key: a quota failure on one big catalog must not stop the
    // other from persisting (or affect the category blob written above).
    const dirty = [...this._dirtyBulk];
    this._dirtyBulk.clear();
    for (const key of dirty) {
      if (this._ns !== ns) return; // account switched mid-flush
      const entry = this._cache.get(key);
      if (!entry) continue;
      try {
        const storage = await getStorage();
        await storage.setItem(bulkStorageKey(ns, key), JSON.stringify({ data: entry.data, expiresAt: entry.expiresAt }));
      } catch { /* quota exceeded / storage error — skip this catalog, keep going */ }
    }
  }

  // Lazily read one whole-catalog key from its own storage entry. Returns the
  // cache entry ({ data, expiresAt }) or null. Only called on an in-memory miss
  // for a BULK key, so the (multi-MB) parse stays off the launch path and only
  // happens when the user actually opens "All Movies/Series".
  async _loadBulk(key) {
    const ns = this._ns;
    if (!ns) return null;
    try {
      const storage = await getStorage();
      const raw = await storage.getItem(bulkStorageKey(ns, key));
      if (!raw || this._ns !== ns) return null;
      const entry = JSON.parse(raw);
      if (entry && entry.data !== undefined) return { data: entry.data, expiresAt: entry.expiresAt ?? 0 };
    } catch { /* missing / corrupt / storage error — treat as a miss */ }
    return null;
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
    else if (BULK_PERSIST_KEYS.has(key)) { this._dirtyBulk.add(key); this._schedulePersist(); }
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
    // Bounded retry-with-backoff around the idempotent GET: a transient 5xx or
    // network blip on the retry-eligible attempts is retried; a caller abort,
    // our own timeout, or a non-transient 4xx is not (they re-throw at once).
    for (let attempt = 0; ; attempt++) {
      // Don't retry once the caller has cancelled between attempts.
      if (signal?.aborted) return this._fetchOnce(url, signal, timeout);
      try {
        return await this._fetchOnce(url, signal, timeout);
      } catch (e) {
        if (attempt >= FETCH_RETRIES || !this._isTransient(e)) throw e;
        await new Promise((r) => setTimeout(r, FETCH_RETRY_BACKOFF * (attempt + 1)));
      }
    }
  }

  // A single GET attempt. Aborts on our own timeout OR when the caller's signal
  // aborts (whichever first) so a hung provider rejects fast.
  async _fetchOnce(url, signal, timeout) {
    const controller = new AbortController();
    let timedOut = false;
    let timer;
    const onAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    // Hard deadline that rejects on its OWN — not only by aborting the request.
    // Some React Native fetch engines don't reject a hung request when its
    // AbortController fires, so relying on abort alone lets a stalled provider
    // hang forever and pin a loading state open (e.g. the Live TV spinner never
    // resolves to an error). Racing against this timer guarantees settlement.
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new Error(`Request timed out after ${timeout}ms`));
      }, timeout);
    });
    try {
      const request = (async () => {
        const response = await globalThis.fetch(url, {
          method: 'GET',
          headers: { Accept: 'application/json, text/plain, */*' },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return await response.json();
      })();
      // Swallow a late rejection from the losing branch so a request that
      // rejects just after the deadline won't surface as an unhandled rejection.
      request.catch(() => {});
      return await Promise.race([request, deadline]);
    } catch (e) {
      if (timedOut) throw new Error(`Request timed out after ${timeout}ms`);
      throw e;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }

  // Transient = worth retrying: a 5xx response or a network-level error. NOT an
  // abort (caller cancel / our timeout) and NOT a 4xx client error.
  _isTransient(e) {
    const msg = e?.message || '';
    if (e?.name === 'AbortError' || /aborted|timed out/i.test(msg)) return false;
    const m = msg.match(/status: (\d+)/);
    if (m) return Number(m[1]) >= 500;
    return true; // network-level error (TypeError: fetch failed, etc.)
  }

  async _cached(key, ttl, fetcher) {
    // Only category keys are persisted to disk, so only they need to wait for
    // hydration. Stream/robust/info keys start fetching immediately — this keeps
    // the one-time AsyncStorage load off the first "All Movies/All Series" fetch
    // (which otherwise made the very first open feel slow).
    if (PERSIST_KEYS.has(key)) await this._ensureHydrated();
    let entry = this._cache.get(key);
    // Whole-catalog miss: try this account's persisted copy before the network so
    // a warm launch serves the (stale) catalog instantly and revalidates below.
    if (!entry && BULK_PERSIST_KEYS.has(key)) {
      const disk = await this._loadBulk(key);
      if (disk && !this._cache.has(key)) { this._cache.set(key, disk); entry = disk; }
    }
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
