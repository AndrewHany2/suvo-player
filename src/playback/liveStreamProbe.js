// @ts-check
// Decide which engine a live stream needs: hls.js (HLS playlist) or mpegts.js
// (raw MPEG-TS over HTTP). Both arrive as `.m3u8` URLs from Xtream, so the URL
// alone can't tell them apart — some panels 302-redirect `…/<id>.m3u8` to a
// backend that returns a continuous `video/mp2t` stream instead of a playlist.
// hls.js can't play that; mpegts.js can. See
// docs/superpowers/specs/2026-07-14-mpegts-live-playback-design.md.
//
// classifyLiveStream is pure (no engine/DOM/network) so the rules are unit-
// testable; probeLiveStream does one aborted fetch and delegates to it.

const HLS_CONTENT_TYPE = /mpegurl/i;              // application/(x-|vnd.apple.)mpegurl
const TS_CONTENT_TYPE = /mp2t|video\/mpeg\b/i;    // video/mp2t (raw MPEG-TS)
const TS_SYNC = 0x47;                             // MPEG-TS packet sync byte
const TS_PACKET = 188;                            // …repeats every 188 bytes

/**
 * Classify from what a probe observed. Body signature is authoritative (panels
 * mislabel content-type); content-type is the tiebreaker; ambiguous defaults to
 * 'hls' to preserve the pre-existing behavior for genuine HLS providers.
 *
 * @param {{ contentType?: string|null, firstBytes?: Uint8Array|null }} obs
 * @returns {'hls'|'mpegts'}
 */
export function classifyLiveStream({ contentType, firstBytes } = {}) {
  const bytes = firstBytes && firstBytes.length ? firstBytes : null;
  if (bytes) {
    // Skip leading ASCII whitespace, then look for the #EXTM3U tag.
    let i = 0;
    while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i++;
    if (startsWith(bytes, i, '#EXTM3U')) return 'hls';
    // Raw MPEG-TS: 0x47 sync at the start, ideally repeating at the packet stride.
    if (bytes[i] === TS_SYNC && (bytes.length <= i + TS_PACKET || bytes[i + TS_PACKET] === TS_SYNC)) {
      return 'mpegts';
    }
    if (bytes[i] === TS_SYNC) return 'mpegts';
  }
  const ct = typeof contentType === 'string' ? contentType : '';
  if (HLS_CONTENT_TYPE.test(ct)) return 'hls';
  if (TS_CONTENT_TYPE.test(ct)) return 'mpegts';
  return 'hls';
}

/**
 * Probe a live URL: one fetch (redirects followed), read Content-Type + a small
 * first chunk of the body, then abort the body (never download the live stream).
 * Never throws — a failed probe resolves to `{ engine: 'hls' }` so the recovery
 * machine surfaces the real error via the normal path.
 *
 * @param {string} url
 * @param {{ fetchImpl?: typeof fetch, signal?: AbortSignal }} [opts]
 * @returns {Promise<{ engine: 'hls'|'mpegts', url: string }>}
 */
export async function probeLiveStream(url, { fetchImpl, signal } = {}) {
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) return { engine: 'hls', url };
  try {
    const res = await doFetch(url, { method: 'GET', signal, redirect: 'follow' });
    const contentType = res?.headers?.get ? res.headers.get('content-type') : null;
    let firstBytes = null;
    const reader = res?.body?.getReader ? res.body.getReader() : null;
    if (reader) {
      try {
        const { value } = await reader.read();
        firstBytes = value || null;
      } finally {
        // Stop the download — for a raw TS stream the body never ends.
        try { await reader.cancel(); } catch { /* noop */ }
        try { reader.releaseLock?.(); } catch { /* noop */ }
      }
    }
    return { engine: classifyLiveStream({ contentType, firstBytes }), url };
  } catch {
    return { engine: 'hls', url };
  }
}

/** @returns {boolean} whether `bytes` from index `i` matches the ASCII `tag`. */
function startsWith(bytes, i, tag) {
  if (i + tag.length > bytes.length) return false;
  for (let k = 0; k < tag.length; k++) if (bytes[i + k] !== tag.charCodeAt(k)) return false;
  return true;
}
