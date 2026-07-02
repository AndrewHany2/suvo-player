import iptvApi from "../../services/iptvApi";
import { normalizeCategory } from "../models/Category";
import { normalizeMovie } from "../models/Movie";
import { normalizeSeries } from "../models/Series";
import { normalizeChannel } from "../models/Channel";

class ContentService {
  // ── Configuration ──────────────────────────────────────────────────────────

  /**
   * Point the service at an IPTV account. Pass null to clear.
   * Replaces callers reaching into iptvApi.setCredentials directly.
   * @param {{ host: string, username: string, password: string } | null} credentials
   */
  configure(credentials) {
    if (credentials) {
      iptvApi.setCredentials(credentials.host, credentials.username, credentials.password);
    }
  }

  // Reuse normalized arrays by raw-array identity. iptvApi returns cache-stable
  // raw arrays within its TTL and normalize* is pure, so the same raw array
  // always maps to the same output — re-running .map(normalize) (one object
  // allocation per row) on every cache hit is wasted work. Mirrors tmdbApi's
  // _streamMapCache reuse-by-identity pattern. Lazy-init avoids class fields.
  _normalizeCached(raw, fn) {
    if (!Array.isArray(raw)) return [];
    this._normCache ??= new WeakMap();
    const hit = this._normCache.get(raw);
    if (hit) return hit;
    const out = raw.map(fn);
    this._normCache.set(raw, out);
    return out;
  }

  // ── Live TV ──────────────────────────────────────────────────────────────

  async getLiveCategories() {
    const raw = await iptvApi.getLiveCategories();
    return this._normalizeCached(raw, normalizeCategory);
  }

  async getLiveChannels(categoryId) {
    const raw = categoryId
      ? await iptvApi.getLiveStreamsByCategory(categoryId)
      : await iptvApi.getLiveStreams();
    return this._normalizeCached(raw, normalizeChannel);
  }

  getShortEpg(streamId, limit = 2) {
    return iptvApi.getShortEpg(streamId, limit);
  }

  // ── Movies ───────────────────────────────────────────────────────────────

  async getMovieCategories() {
    const raw = await iptvApi.getVODCategories();
    return this._normalizeCached(raw, normalizeCategory);
  }

  async getMoviesByCategory(categoryId) {
    const raw = await iptvApi.getVODStreams(categoryId);
    return this._normalizeCached(raw, normalizeMovie);
  }

  async getAllMovies() {
    const raw = await iptvApi.getAllVODStreamsRobust();
    return this._normalizeCached(raw, normalizeMovie);
  }

  /** Raw VOD info ({ info: {...}, movie_data: {...} }) for views that render the
   *  provider's native shape directly (e.g. the TV detail screen). */
  getMovieInfoRaw(movieId) {
    return iptvApi.getVODInfo(movieId);
  }

  buildMovieUrl(movieId, containerExtension = "mp4") {
    return iptvApi.buildStreamUrl("movie", movieId, containerExtension);
  }

  // ── Series ───────────────────────────────────────────────────────────────

  async getSeriesCategories() {
    const raw = await iptvApi.getSeriesCategories();
    return this._normalizeCached(raw, normalizeCategory);
  }

  async getSeriesByCategory(categoryId) {
    const raw = await iptvApi.getSeries(categoryId);
    return this._normalizeCached(raw, normalizeSeries);
  }

  async getAllSeries() {
    const raw = await iptvApi.getAllSeriesRobust();
    return this._normalizeCached(raw, normalizeSeries);
  }

  buildEpisodeUrl(episodeId, containerExtension = "mkv") {
    return iptvApi.buildStreamUrl("series", episodeId, containerExtension);
  }

  buildLiveUrl(streamId, extension = "ts") {
    return iptvApi.buildStreamUrl("live", streamId, extension);
  }
}

export const contentService = new ContentService();
export default contentService;
