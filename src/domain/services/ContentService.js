import iptvApi from "../../services/iptvApi";
import m3uApi from "../../services/m3uApi";
import { normalizeCategory } from "../models/Category";
import { normalizeMovie } from "../models/Movie";
import { normalizeSeries } from "../models/Series";
import { normalizeChannel } from "../models/Channel";
import { interpretUserInfo } from "./userInfo";
import { parseXtreamCredsFromUrl } from "../../services/xtreamUrl";

class ContentService {
  // The active source backend. Xtream (`iptvApi`) by default; swapped to the
  // M3U source (`m3uApi`) for `type: "m3u"` accounts in configure(). Every data
  // method below goes through `this.api`, so the two backends are interchangeable
  // and downstream hooks/screens never learn which one is live.
  api = iptvApi;

  // ── Configuration ──────────────────────────────────────────────────────────

  /**
   * Point the service at an IPTV account. Pass null to clear.
   * Replaces callers reaching into iptvApi.setCredentials directly.
   * @param {{ type?: "xtream"|"m3u", host?: string, username?: string,
   *           password?: string, url?: string } | null} credentials
   */
  configure(credentials) {
    if (!credentials) return;
    // Route by explicit type, falling back to the account SHAPE: a playlist URL
    // with no host can only be an M3U source. The shape fallback keeps live/VOD
    // fetching correct even when `type` is missing (e.g. a row synced before the
    // M3U columns were deployed), which otherwise misroutes M3U through Xtream.
    const isM3U = credentials.type === "m3u" || (!!credentials.url && !credentials.host);
    // An "M3U" URL that's really an Xtream `get.php` link (host + creds embedded)
    // is routed through the Xtream API instead: the embedded M3U playlist tokens
    // are short-lived and 406 once they expire, whereas the Xtream API builds a
    // fresh stream URL — and thus a fresh token — on every play.
    const derived = isM3U ? parseXtreamCredsFromUrl(credentials.url) : null;
    if (isM3U && !derived) {
      this.api = m3uApi;
      m3uApi.setCredentials(credentials.url);
    } else {
      this.api = iptvApi;
      const { host, username, password } = derived || credentials;
      iptvApi.setCredentials(host, username, password);
    }
  }

  /**
   * Cheap connect/auth check for the currently-configured account: does it
   * authenticate WITHOUT downloading the whole live catalog? Xtream hits the
   * actionless user_info envelope; M3U counts a successful playlist parse. Never
   * throws — returns a verdict { ok, status?, message } so the connect UI can
   * show a precise reason (wrong password vs expired vs provider unreachable).
   * @returns {Promise<{ ok: boolean, status?: string, message: string, expiresAt?: number }>}
   */
  async verifyCredentials() {
    try {
      return interpretUserInfo(await this.api.getUserInfo());
    } catch (err) {
      // A structured provider error carries a human reason; otherwise it's a
      // network/timeout/unreachable-host failure.
      return { ok: false, message: err?.userMessage || "Couldn't reach the provider. Check the host and your connection." };
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
    const raw = await this.api.getLiveCategories();
    return this._normalizeCached(raw, normalizeCategory);
  }

  async getLiveChannels(categoryId) {
    const raw = categoryId
      ? await this.api.getLiveStreamsByCategory(categoryId)
      : await this.api.getLiveStreams();
    return this._normalizeCached(raw, normalizeChannel);
  }

  getShortEpg(streamId, limit = 2) {
    return this.api.getShortEpg(streamId, limit);
  }

  // ── Movies ───────────────────────────────────────────────────────────────

  async getMovieCategories() {
    const raw = await this.api.getVODCategories();
    return this._normalizeCached(raw, normalizeCategory);
  }

  async getMoviesByCategory(categoryId) {
    const raw = await this.api.getVODStreams(categoryId);
    return this._normalizeCached(raw, normalizeMovie);
  }

  async getAllMovies() {
    const raw = await this.api.getAllVODStreamsRobust();
    return this._normalizeCached(raw, normalizeMovie);
  }

  /** Raw VOD info ({ info: {...}, movie_data: {...} }) for views that render the
   *  provider's native shape directly (e.g. the TV detail screen). */
  getMovieInfoRaw(movieId) {
    return this.api.getVODInfo(movieId);
  }

  /** Raw series info ({ info, episodes, seasons? }) for the detail/season views,
   *  routed through the active source so M3U series resolve too. */
  getSeriesInfoRaw(seriesId) {
    return this.api.getSeriesInfo(seriesId);
  }

  buildMovieUrl(movieId, containerExtension = "mp4") {
    return this.api.buildStreamUrl("movie", movieId, containerExtension);
  }

  // ── Series ───────────────────────────────────────────────────────────────

  async getSeriesCategories() {
    const raw = await this.api.getSeriesCategories();
    return this._normalizeCached(raw, normalizeCategory);
  }

  async getSeriesByCategory(categoryId) {
    const raw = await this.api.getSeries(categoryId);
    return this._normalizeCached(raw, normalizeSeries);
  }

  async getAllSeries() {
    const raw = await this.api.getAllSeriesRobust();
    return this._normalizeCached(raw, normalizeSeries);
  }

  buildEpisodeUrl(episodeId, containerExtension = "mkv") {
    return this.api.buildStreamUrl("series", episodeId, containerExtension);
  }

  buildLiveUrl(streamId, extension = "ts") {
    return this.api.buildStreamUrl("live", streamId, extension);
  }
}

export const contentService = new ContentService();
export default contentService;
