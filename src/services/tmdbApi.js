const TMDB_BASE = 'https://api.themoviedb.org/3';
const TTL = 6 * 60 * 60 * 1000; // 6h cache
const API_KEY = process.env.EXPO_PUBLIC_TMDB_API_KEY || null;

const normalize = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(the|a|an)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

class TmdbApi {
  _cache = new Map();
  _streamMapCache = new WeakMap();

  get hasKey() { return !!API_KEY; }

  _cacheGet(key) {
    const entry = this._cache.get(key);
    if (!entry || Date.now() > entry.expiresAt) { this._cache.delete(key); return null; }
    return entry.data;
  }

  _cacheSet(key, data) {
    this._cache.set(key, { data, expiresAt: Date.now() + TTL });
  }

  // Fetch a single TMDB page; returns { results, total_pages }
  async fetchPage(type, page) {
    const cacheKey = `tmdb_${type}_p${page}`;
    const cached = this._cacheGet(cacheKey);
    if (cached) return cached;
    if (!API_KEY) return { results: [], total_pages: 0 };

    let data;
    try {
      const r = await fetch(`${TMDB_BASE}/${type}/top_rated?api_key=${API_KEY}&page=${page}`);
      if (!r.ok) return { results: [], total_pages: 0 };
      data = await r.json();
    } catch {
      return { results: [], total_pages: 0 };
    }

    const normalized = {
      results: (data.results || []).map((item) => ({
        id: item.id,
        title: item.title || item.name || '',
        vote_average: item.vote_average || 0,
        normalized: normalize(item.title || item.name),
      })),
      total_pages: data.total_pages || 1,
    };
    this._cacheSet(cacheKey, normalized);
    return normalized;
  }

  // Memoized normalized title → IPTV item lookup map
  _getStreamMap(iptvItems) {
    let map = this._streamMapCache.get(iptvItems);
    if (map) return map;
    map = new Map();
    for (const item of iptvItems) {
      const n = normalize(item.name);
      if (n && !map.has(n)) map.set(n, item);
      const noYear = n.replace(/\b(19|20)\d{2}\b/g, '').replace(/\s+/g, ' ').trim();
      if (noYear && noYear !== n && !map.has(noYear)) map.set(noYear, item);
    }
    this._streamMapCache.set(iptvItems, map);
    return map;
  }

  // Fetch one TMDB page, match against IPTV library.
  // Returns { matched: IPTV items annotated with tmdb_rating, totalPages, hasMore }.
  // seenIds: Set of already-emitted IDs to avoid dupes across pages.
  async matchTopRatedPage({ type, iptvItems, idField, page, seenIds }) {
    if (!API_KEY) return { matched: [], totalPages: 0, hasMore: false };
    const { results, total_pages } = await this.fetchPage(type, page);
    const streamMap = this._getStreamMap(iptvItems);
    const matched = [];
    for (const tmdb of results) {
      const stream = streamMap.get(tmdb.normalized);
      if (stream && !seenIds.has(stream[idField])) {
        seenIds.add(stream[idField]);
        matched.push({ ...stream, tmdb_rating: tmdb.vote_average, tmdb_id: tmdb.id });
      }
    }
    return { matched, totalPages: total_pages, hasMore: page < total_pages };
  }

  // Fetch multiple TMDB pages in parallel, return concatenated matches.
  async matchTopRatedRange({ type, iptvItems, idField, fromPage, toPage, seenIds }) {
    if (!API_KEY) return { matched: [], totalPages: 0, hasMore: false };
    const pages = [];
    for (let p = fromPage; p <= toPage; p++) pages.push(p);

    const results = await Promise.all(
      pages.map((p) => this.fetchPage(type, p))
    );

    const streamMap = this._getStreamMap(iptvItems);
    const matched = [];
    let totalPages = 0;
    for (const { results: items, total_pages } of results) {
      totalPages = Math.max(totalPages, total_pages);
      for (const tmdb of items) {
        const stream = streamMap.get(tmdb.normalized);
        if (stream && !seenIds.has(stream[idField])) {
          seenIds.add(stream[idField]);
          matched.push({ ...stream, tmdb_rating: tmdb.vote_average, tmdb_id: tmdb.id });
        }
      }
    }
    return { matched, totalPages, hasMore: toPage < totalPages };
  }
}

export default new TmdbApi();
