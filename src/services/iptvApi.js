const TTL = {
  categories: 10 * 60 * 1000,
  streams:     5 * 60 * 1000,
  seriesInfo: 30 * 60 * 1000,
};

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

  async fetch(url) {
    const response = await globalThis.fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json, text/plain, */*' },
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

  getLiveStreamsByCategory(categoryId) {
    return this._cached(`live_streams_${categoryId}`, TTL.streams, () =>
      this.fetch(this.buildUrl('get_live_streams', { category_id: categoryId }))
    );
  }

  getLiveStreams() {
    return this._cached('live_streams', TTL.streams, () => this.fetch(this.buildUrl('get_live_streams')));
  }

  getVODCategories() {
    return this._cached('vod_categories', TTL.categories, () => this.fetch(this.buildUrl('get_vod_categories')));
  }

  getVODStreams(categoryId) {
    return this._cached(`vod_streams_${categoryId}`, TTL.streams, () =>
      this.fetch(this.buildUrl('get_vod_streams', { category_id: categoryId }))
    );
  }

  getAllVODStreams() {
    return this._cached('vod_streams_all', TTL.streams, () => this.fetch(this.buildUrl('get_vod_streams')));
  }

  getSeriesCategories() {
    return this._cached('series_categories', TTL.categories, () => this.fetch(this.buildUrl('get_series_categories')));
  }

  getSeries(categoryId) {
    return this._cached(`series_${categoryId}`, TTL.streams, () =>
      this.fetch(this.buildUrl('get_series', { category_id: categoryId }))
    );
  }

  getAllSeries() {
    return this._cached('series_all', TTL.streams, () => this.fetch(this.buildUrl('get_series')));
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
