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

class IPTVApi {
  _cache = new Map();
  baseUrl = null;
  username = null;
  password = null;

  setCredentials(host, username, password) {
    let cleanHost = host.replace(/^(https?:\/\/)/, '');
    cleanHost = cleanHost.replace(/\/$/, '');
    const newBase = `http://${cleanHost}`;
    if (newBase !== this.baseUrl || username !== this.username) {
      this._cache.clear();
    }
    this.baseUrl = newBase;
    this.username = username;
    this.password = password;
  }

  _cacheGet(key) {
    const entry = this._cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) { this._cache.delete(key); return null; }
    return entry.data;
  }

  _cacheSet(key, data, ttl) {
    // Refresh insertion order so the cap evicts the genuinely oldest entry.
    if (this._cache.has(key)) this._cache.delete(key);
    else if (this._cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = this._cache.keys().next().value;
      if (oldest !== undefined) this._cache.delete(oldest);
    }
    this._cache.set(key, { data, expiresAt: Date.now() + ttl });
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

  async fetch(url, { signal } = {}) {
    const response = await globalThis.fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json, text/plain, */*' },
      signal,
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return response.json();
  }

  async _cached(key, ttl, fetcher) {
    const hit = this._cacheGet(key);
    if (hit) return hit;
    const data = await fetcher();
    this._cacheSet(key, data, ttl);
    return data;
  }

  getLiveCategories() {
    return this._cached('live_categories', TTL.categories, () => this.fetch(this.buildUrl('get_live_categories')));
  }

  getLiveStreamsByCategory(categoryId, { signal } = {}) {
    return this._cached(`live_streams_${categoryId}`, TTL.streams, () =>
      this.fetch(this.buildUrl('get_live_streams', { category_id: categoryId }), { signal })
    );
  }

  getLiveStreams() {
    return this._cached('live_streams', TTL.streams, () => this.fetch(this.buildUrl('get_live_streams')));
  }

  getVODCategories() {
    return this._cached('vod_categories', TTL.categories, () => this.fetch(this.buildUrl('get_vod_categories')));
  }

  getVODStreams(categoryId, { signal } = {}) {
    return this._cached(`vod_streams_${categoryId}`, TTL.streams, () =>
      this.fetch(this.buildUrl('get_vod_streams', { category_id: categoryId }), { signal })
    );
  }

  getAllVODStreams() {
    return this._cached('vod_streams_all', TTL.streams, () => this.fetch(this.buildUrl('get_vod_streams')));
  }

  // Tries the "all" endpoint first, falls back to fanning out per-category if
  // the server blocks bulk fetches (e.g. 403). Dedupes by stream_id.
  getAllVODStreamsRobust() {
    return this._cached('vod_streams_robust', TTL.streams, async () => {
      try {
        const all = await this.fetch(this.buildUrl('get_vod_streams'));
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
    return this._cached(`series_${categoryId}`, TTL.streams, () =>
      this.fetch(this.buildUrl('get_series', { category_id: categoryId }), { signal })
    );
  }

  getAllSeries() {
    return this._cached('series_all', TTL.streams, () => this.fetch(this.buildUrl('get_series')));
  }

  // Tries the "all" endpoint first, falls back to fanning out per-category if
  // the server blocks bulk fetches (e.g. 403). Dedupes by series_id.
  getAllSeriesRobust() {
    return this._cached('series_robust', TTL.streams, async () => {
      try {
        const all = await this.fetch(this.buildUrl('get_series'));
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
