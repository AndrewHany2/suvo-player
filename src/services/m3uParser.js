// Pure M3U/M3U8 playlist parser. No React/RN/network — plain string in, array
// of channel descriptors out, so it runs under `node --test`.
//
// An M3U entry is a `#EXTINF:<duration> [attr="val" …],<Display Name>` header
// line followed by the stream URL on a later line. We read the attributes we
// map into the app's channel model (tvg-id → EPG id, tvg-logo → icon,
// group-title → category) and the display name after the comma.

const ATTR_RE = /([\w-]+)=("([^"]*)"|'([^']*)')/g;

function readAttrs(header) {
  const attrs = {};
  let m;
  while ((m = ATTR_RE.exec(header)) !== null) {
    attrs[m[1].toLowerCase()] = m[3] ?? m[4] ?? "";
  }
  return attrs;
}

// Media file extension from a stream URL (for `container_extension`), or "".
export function extFromUrl(url) {
  const path = String(url || "").split(/[?#]/)[0];
  const m = path.match(/\.([a-z0-9]{2,4})$/i);
  return m ? m[1].toLowerCase() : "";
}

/**
 * Classify an M3U entry as "movie" | "series" | "live".
 * Primary signal is the stream URL path — Xtream `m3u_plus` exports put the
 * stream kind in the path (`/movie/…`, `/series/…`, live has neither). Falls
 * back to group-title keywords for hand-made playlists that lack that structure.
 * @param {{ url?: string, groupTitle?: string }} entry
 */
export function classifyEntry(entry) {
  const path = String(entry?.url || "").split(/[?#]/)[0].toLowerCase();
  if (/\/movies?\//.test(path)) return "movie";
  if (/\/series\//.test(path)) return "series";
  const g = String(entry?.groupTitle || "").toLowerCase();
  if (/\b(movies?|vod|films?)\b/.test(g)) return "movie";
  if (/\b(series|serie|tv shows?)\b/.test(g)) return "series";
  return "live";
}

// Trailing separators/whitespace stripped; empty falls back to "Unknown".
function cleanName(s) {
  return String(s || "").replace(/[\s._-]+$/, "").trim() || "Unknown";
}

/**
 * Split a series episode entry name into { series, season, episode }.
 * Handles "Show S01E02", "Show S1 E2", "Show 1x02"; when no marker is present
 * the whole name is treated as the series (season 1), and the caller assigns a
 * running episode number.
 * @param {string} name
 */
export function parseEpisodeName(name) {
  const n = String(name || "");
  let m = n.match(/^(.*?)[\s._-]*S(\d{1,3})[\s._-]*E(\d{1,4})/i);
  if (m) return { series: cleanName(m[1]), season: Number(m[2]), episode: Number(m[3]) };
  m = n.match(/^(.*?)[\s._-]+(\d{1,2})x(\d{1,3})\b/i);
  if (m) return { series: cleanName(m[1]), season: Number(m[2]), episode: Number(m[3]) };
  return { series: cleanName(n), season: 1, episode: null };
}

/**
 * Parse M3U text into `[{ name, url, tvgId, tvgLogo, groupTitle }]`.
 * Missing attributes default to "". Entries without a following URL are dropped.
 * @param {string} text raw playlist body
 */
export function parseM3U(text) {
  if (typeof text !== "string" || !text) return [];
  const lines = text.split(/\r?\n/);
  const out = [];
  let pending = null; // { name, tvgId, tvgLogo, groupTitle } awaiting its URL

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith("#EXTINF")) {
      // Everything after the FIRST comma is the display name.
      const comma = line.indexOf(",");
      const header = comma === -1 ? line : line.slice(0, comma);
      const title = comma === -1 ? "" : line.slice(comma + 1).trim();
      const attrs = readAttrs(header);
      pending = {
        name: title || attrs["tvg-name"] || "",
        tvgId: attrs["tvg-id"] || "",
        tvgLogo: attrs["tvg-logo"] || "",
        groupTitle: attrs["group-title"] || "",
      };
      continue;
    }

    // Any other #-directive between the header and the URL (e.g. #EXTVLCOPT,
    // #EXTGRP) is metadata we don't consume — skip without dropping `pending`.
    if (line.startsWith("#")) continue;

    // A non-# line is the URL for the pending header. Without a header it's a
    // stray URL we can't describe, so ignore it.
    if (pending) {
      out.push({ ...pending, url: line });
      pending = null;
    }
  }
  return out;
}
