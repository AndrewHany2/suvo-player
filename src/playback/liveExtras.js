// @ts-check
/**
 * liveExtras — pure helpers + a defensive EPG fetcher for live TV.
 *
 * Two concerns:
 *   1. Channel navigation (PURE): nextChannel / prevChannel walk an ordered
 *      channels list relative to the current stream id, wrapping around at the
 *      ends. Safe on empty / single-element lists.
 *   2. EPG now/next (IMPURE): fetchNowNext() asks iptvApi for the short EPG of a
 *      channel and reduces it to a { now, next } summary with a progress
 *      percentage for the current programme. Always defensive: any failure or
 *      missing data resolves to nulls rather than throwing.
 *
 * Xtream's get_short_epg returns base64-encoded title/description fields, so we
 * decode them here. iptvApi already exposes getShortEpg(streamId, limit); we use
 * it when present and otherwise fall back to the raw request helper.
 */

/**
 * Identity of a channel's stream id, tolerant of string/number mismatches.
 * @param {*} a
 * @param {*} b
 * @returns {boolean}
 */
function sameId(a, b) {
  return a != null && b != null && String(a) === String(b);
}

/**
 * Find the index of the channel whose stream_id matches `id`.
 * @param {Array<any>} list
 * @param {*} id
 * @returns {number} index, or -1 if not found / bad input.
 */
function indexOfChannel(list, id) {
  if (!Array.isArray(list)) return -1;
  for (let i = 0; i < list.length; i++) {
    if (sameId(list[i]?.stream_id, id)) return i;
  }
  return -1;
}

/**
 * The channel after `id` in `list`, wrapping to the first when at the end.
 * Returns null for empty lists; returns the sole element for single lists.
 * If `id` is not found, returns the first channel (a sane default).
 *
 * @param {Array<any>} list
 * @param {*} id current stream_id
 * @returns {any|null}
 */
export function nextChannel(list, id) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const i = indexOfChannel(list, id);
  if (i === -1) return list[0];
  return list[(i + 1) % list.length];
}

/**
 * The channel before `id` in `list`, wrapping to the last when at the start.
 * Returns null for empty lists; returns the sole element for single lists.
 * If `id` is not found, returns the last channel (a sane default).
 *
 * @param {Array<any>} list
 * @param {*} id current stream_id
 * @returns {any|null}
 */
export function prevChannel(list, id) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const i = indexOfChannel(list, id);
  if (i === -1) return list[list.length - 1];
  return list[(i - 1 + list.length) % list.length];
}

/**
 * Decode a possibly-base64 EPG string. Xtream encodes titles/descriptions in
 * base64; if decoding fails (already plain text, bad padding) the original is
 * returned. Pure + defensive.
 *
 * @param {*} value
 * @returns {string}
 */
export function decodeEpgText(value) {
  if (value == null) return '';
  const str = String(value);
  if (str === '') return '';
  try {
    // atob in browsers; Buffer on native/node. Guard both.
    if (typeof globalThis.atob === 'function') {
      const decoded = globalThis.atob(str);
      // atob yields latin1; re-decode as UTF-8 when TextDecoder is available.
      if (typeof globalThis.TextDecoder === 'function') {
        const bytes = Uint8Array.from(decoded, (c) => c.charCodeAt(0));
        return new globalThis.TextDecoder('utf-8').decode(bytes);
      }
      return decoded;
    }
    if (typeof globalThis.Buffer !== 'undefined') {
      return globalThis.Buffer.from(str, 'base64').toString('utf-8');
    }
  } catch {
    /* fall through to raw */
  }
  return str;
}

/**
 * Parse an Xtream EPG timestamp into epoch milliseconds. Entries expose either
 * a unix `start_timestamp`/`stop_timestamp` (seconds) or ISO-ish `start`/`end`
 * strings. Returns NaN when unparseable.
 *
 * @param {*} unixSeconds
 * @param {*} isoString
 * @returns {number} epoch ms or NaN
 */
function toEpochMs(unixSeconds, isoString) {
  const n = Number(unixSeconds);
  if (Number.isFinite(n) && n > 0) return n * 1000;
  if (isoString != null) {
    const t = Date.parse(String(isoString).replace(' ', 'T'));
    if (Number.isFinite(t)) return t;
  }
  return NaN;
}

/**
 * Normalize a single raw EPG listing into a typed shape.
 * @param {any} entry
 * @returns {{title:string, start:number, end:number}|null}
 */
function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const start = toEpochMs(entry.start_timestamp, entry.start);
  const end = toEpochMs(entry.stop_timestamp ?? entry.end_timestamp, entry.end ?? entry.stop);
  if (!Number.isFinite(start)) return null;
  return {
    title: decodeEpgText(entry.title) || 'Unknown',
    start,
    end: Number.isFinite(end) ? end : start,
  };
}

/**
 * Progress percentage [0..100] through a programme at time `now`.
 * @param {number} start epoch ms
 * @param {number} end epoch ms
 * @param {number} now epoch ms
 * @returns {number}
 */
function progressPct(start, end, now) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  const pct = ((now - start) / (end - start)) * 100;
  if (pct < 0) return 0;
  if (pct > 100) return 100;
  return Math.round(pct);
}

/**
 * @typedef {Object} NowNext
 * @property {{title:string,start:number,end:number,progressPct:number}|null} now
 * @property {{title:string,start:number}|null} next
 */

/**
 * Fetch the "now & next" programmes for a live channel.
 *
 * Uses iptvApi.getShortEpg when available, otherwise falls back to the standard
 * Xtream get_short_epg action via iptvApi.fetch/buildUrl. Titles are base64
 * decoded. Always resolves; on any failure returns { now: null, next: null }.
 *
 * @param {any} iptvApi the shared IPTVApi instance
 * @param {*} streamId live stream id
 * @param {{ now?: number }} [opts] inject `now` (epoch ms) for testing
 * @returns {Promise<NowNext>}
 */
export async function fetchNowNext(iptvApi, streamId, opts = {}) {
  const fallback = { now: null, next: null };
  if (!iptvApi || streamId == null) return fallback;

  let raw;
  try {
    if (typeof iptvApi.getShortEpg === 'function') {
      raw = await iptvApi.getShortEpg(streamId, 2);
    } else if (typeof iptvApi.fetch === 'function' && typeof iptvApi.buildUrl === 'function') {
      raw = await iptvApi.fetch(
        iptvApi.buildUrl('get_short_epg', { stream_id: streamId, limit: 2 })
      );
    } else {
      return fallback;
    }
  } catch {
    return fallback;
  }

  // Xtream returns either an array or { epg_listings: [...] }.
  const listings = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.epg_listings)
      ? raw.epg_listings
      : [];

  const entries = listings
    .map(normalizeEntry)
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

  if (entries.length === 0) return fallback;

  const now = Number.isFinite(opts.now) ? Number(opts.now) : Date.now();

  // "now" = the programme whose window contains `now`, else the first upcoming
  // one's predecessor, else the first entry.
  let nowIdx = entries.findIndex((e) => now >= e.start && now < e.end);
  if (nowIdx === -1) {
    // No window matches: pick the last entry that already started, else first.
    const started = entries.filter((e) => e.start <= now);
    nowIdx = started.length ? entries.indexOf(started[started.length - 1]) : 0;
  }

  const cur = entries[nowIdx];
  const nxt = entries[nowIdx + 1] || null;

  return {
    now: cur
      ? {
          title: cur.title,
          start: cur.start,
          end: cur.end,
          progressPct: progressPct(cur.start, cur.end, now),
        }
      : null,
    next: nxt ? { title: nxt.title, start: nxt.start } : null,
  };
}

export default { nextChannel, prevChannel, fetchNowNext, decodeEpgText };
