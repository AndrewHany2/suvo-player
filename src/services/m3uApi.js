// M3U playlist source. Implements the same method surface ContentService calls
// on the Xtream `iptvApi`, so ContentService can delegate to either backend
// (selected by account `type`) without the downstream hooks/screens changing.
//
// An M3U playlist is a flat list of entries. We classify each by its stream URL
// path (Xtream `m3u_plus` puts `/movie/…` and `/series/…` in the path; live has
// neither), falling back to group-title keywords. Live/Movie entries map 1:1 to
// channels/movies grouped by group-title; Series episodes are grouped back into
// series → seasons → episodes by parsing "Show SxxEyy" from the entry name. The
// whole playlist is fetched + parsed once (memoized until the URL changes).

import { parseM3U, classifyEntry, parseEpisodeName, extFromUrl } from "./m3uParser.js";

const UNCATEGORIZED = "Uncategorized";
// Abort a playlist fetch that hasn't responded in this long so a hung/huge URL
// fails fast instead of pinning a screen's spinner open.
const FETCH_TIMEOUT = 30 * 1000;

// djb2 — small, deterministic, filename-safe. Used to derive a stable series id
// from the series name so the same show maps to the same id across reloads.
function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// Ordered unique category list ([{ category_id, category_name }]) from the
// group-titles seen, preserving first-appearance order.
function categoriesFrom(groups) {
  const seen = new Set();
  const out = [];
  for (const g of groups) {
    if (!seen.has(g)) { seen.add(g); out.push({ category_id: g, category_name: g }); }
  }
  return out;
}

export class M3UApi {
  constructor() {
    this.url = null;
    this._loadPromise = null; // dedupes concurrent loads of the same playlist
    this._reset();
  }

  _reset() {
    this._channels = [];        // live rows (normalizeChannel shape)
    this._movies = [];          // VOD rows (normalizeMovie shape)
    this._series = [];          // series rows (normalizeSeries shape)
    this._liveCategories = [];
    this._vodCategories = [];
    this._seriesCategories = [];
    this._seriesById = new Map(); // series_id -> { info, episodes }
    this._urlById = new Map();    // stream/episode id -> real stream URL
  }

  // Point the source at a playlist URL; clearing the memoized parse on change
  // mirrors iptvApi.setCredentials dropping its cache.
  setCredentials(url) {
    const clean = (url || "").trim();
    if (clean === this.url) return;
    this.url = clean;
    this._loadPromise = null;
    this._reset();
  }

  async _fetchText(url) {
    const controller = new AbortController();
    let timer;
    // Hard deadline that rejects on its OWN — not only by aborting the request.
    // Some React Native fetch engines don't reject a hung request when its
    // AbortController fires, so relying on abort alone lets a stalled/huge
    // playlist pin a screen's spinner open forever. Racing the timer guarantees
    // settlement. (Mirrors the deadline race in iptvApi's fetchJson.)
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`Playlist fetch timed out after ${FETCH_TIMEOUT}ms`));
      }, FETCH_TIMEOUT);
    });
    try {
      const request = (async () => {
        const res = await globalThis.fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return await res.text();
      })();
      return await Promise.race([request, deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  // Fetch + parse the playlist once, classifying every entry into live / movies
  // / series and building the category lists, the series season→episode maps,
  // and the id→URL lookup. Deduped so a burst of getLive/VOD/Series calls
  // triggers a single network fetch.
  _load() {
    if (this._loadPromise) return this._loadPromise;
    const url = this.url;
    this._loadPromise = (async () => {
      const text = await this._fetchText(url);
      if (this.url !== url) return; // account switched mid-fetch — drop result
      this._build(parseM3U(text));
    })().catch((err) => {
      // Don't cache a rejected load — a later call should be free to retry.
      this._loadPromise = null;
      throw err;
    });
    return this._loadPromise;
  }

  _build(entries) {
    this._reset();
    const liveGroups = [], vodGroups = [], seriesGroups = [];
    const seriesByKey = new Map(); // name-key -> series accumulator

    entries.forEach((e, i) => {
      const id = String(i);
      this._urlById.set(id, e.url);
      const group = e.groupTitle || UNCATEGORIZED;
      const kind = classifyEntry(e);

      if (kind === "movie") {
        vodGroups.push(group);
        this._movies.push({
          stream_id: id, name: e.name, stream_icon: e.tvgLogo || "", cover: e.tvgLogo || "",
          container_extension: extFromUrl(e.url) || "mp4", category_id: group, rating: "",
        });
      } else if (kind === "series") {
        seriesGroups.push(group);
        const { series: seriesName, season, episode } = parseEpisodeName(e.name);
        const key = seriesName.toLowerCase();
        let acc = seriesByKey.get(key);
        if (!acc) {
          acc = { series_id: `s_${hash(key)}`, name: seriesName, cover: e.tvgLogo || "", category_id: group, episodes: {} };
          seriesByKey.set(key, acc);
        }
        if (!acc.cover && e.tvgLogo) acc.cover = e.tvgLogo;
        const seasonKey = String(season);
        const list = (acc.episodes[seasonKey] ||= []);
        list.push({
          id, // episode stream id → _urlById
          // No SxxEyy marker → number episodes in arrival order within the season.
          episode_num: episode ?? list.length + 1,
          title: e.name,
          container_extension: extFromUrl(e.url) || "mp4",
          season,
          info: {},
        });
      } else {
        liveGroups.push(group);
        this._channels.push({
          stream_id: id, name: e.name, stream_icon: e.tvgLogo || "",
          epg_channel_id: e.tvgId || "", category_id: group, stream_type: "live",
        });
      }
    });

    this._liveCategories = categoriesFrom(liveGroups);
    this._vodCategories = categoriesFrom(vodGroups);
    this._seriesCategories = categoriesFrom(seriesGroups);

    // Freeze series accumulators into list rows + an id→info lookup.
    for (const acc of seriesByKey.values()) {
      this._series.push({ series_id: acc.series_id, name: acc.name, cover: acc.cover, category_id: acc.category_id, rating: "" });
      this._seriesById.set(acc.series_id, {
        info: { name: acc.name, cover: acc.cover },
        episodes: acc.episodes,
      });
    }
  }

  // ── Live TV ────────────────────────────────────────────────────────────────
  async getLiveCategories() { await this._load(); return this._liveCategories; }
  async getLiveStreams() { await this._load(); return this._channels; }
  async getLiveStreamsByCategory(categoryId) {
    await this._load();
    const id = String(categoryId);
    return this._channels.filter((c) => c.category_id === id);
  }

  // ── Movies (VOD) ─────────────────────────────────────────────────────────
  async getVODCategories() { await this._load(); return this._vodCategories; }
  async getVODStreams(categoryId) {
    await this._load();
    const id = String(categoryId);
    return this._movies.filter((m) => m.category_id === id);
  }
  async getAllVODStreamsRobust() { await this._load(); return this._movies; }
  async getVODInfo(vodId) {
    await this._load();
    const movie = this._movies.find((m) => m.stream_id === String(vodId));
    return { info: { movie_image: movie?.stream_icon || "", name: movie?.name || "" }, movie_data: {} };
  }

  // ── Series ─────────────────────────────────────────────────────────────────
  async getSeriesCategories() { await this._load(); return this._seriesCategories; }
  async getSeries(categoryId) {
    await this._load();
    const id = String(categoryId);
    return this._series.filter((s) => s.category_id === id);
  }
  async getAllSeriesRobust() { await this._load(); return this._series; }
  async getSeriesInfo(seriesId) {
    await this._load();
    const s = this._seriesById.get(String(seriesId));
    // `seasons` omitted — SeriesDetail/SeriesScreen derive seasons from the
    // episodes object keys when it's absent.
    return s ? { info: s.info, episodes: s.episodes } : { info: {}, episodes: {} };
  }

  // ── Playback URL ─────────────────────────────────────────────────────────
  // Every kind resolves to the entry's real URL by id (live stream id, movie
  // stream id, or episode id all live in the same _urlById map).
  buildStreamUrl(_type, streamId) {
    return this._urlById.get(String(streamId)) ?? null;
  }

  // M3U carries no EPG.
  async getShortEpg() { return { epg_listings: [] }; }
}

export default new M3UApi();
