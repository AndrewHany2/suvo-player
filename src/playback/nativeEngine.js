// @ts-check
/**
 * PURE: decide which native engine plays a given source.
 *
 * These containers — mkv/avi/flv/wmv/webm — go to a libVLC-backed player instead
 * of expo-video on BOTH native platforms, for VOD:
 *
 *   iOS: AVFoundation/AVPlayer cannot demux them at all — it answers "Cannot
 *   Open". expo-video (AVPlayer) is fine only for mp4/HLS.
 *
 *   Android: ExoPlayer *can* demux them, but these providers mux their .mkv with
 *   the seek index (Cues) at the END of the file AND serve it over HTTP 200 with
 *   no Range support. ExoPlayer seeks to read the end-Cues before emitting the
 *   first frame; unable to range-jump, it reads through the ENTIRE file first —
 *   tens of seconds / >1 GB of "Loading…" before playback. libVLC demuxes
 *   progressively and starts without that block. (Confirmed 2026-07-25: media
 *   response 200 / full-file body, Cues at EOF.)
 *
 * Routing is extension-based so it works for both remote `http(s)://…/id.mkv`
 * and downloaded `file://…/id.mkv`. LIVE is never routed here (the dispatcher
 * gates on type !== 'live') — live has its own probe/router path.
 */

/** Containers routed to the VLC engine on iOS + Android (see module doc). */
const VLC_CONTAINERS = new Set(['mkv', 'avi', 'flv', 'wmv', 'webm']);

/**
 * Lowercased file extension of a URL/path: the text after the LAST '.', with any
 * query string or hash removed first. '' when there is no extension in the final
 * path segment.
 *
 * @param {string|null|undefined} uri
 * @returns {string}
 */
function containerExtension(uri) {
  if (typeof uri !== 'string' || !uri) return '';
  // Strip query/hash, then take the final path segment.
  const clean = uri.split('#')[0].split('?')[0];
  const seg = clean.slice(clean.lastIndexOf('/') + 1);
  const dot = seg.lastIndexOf('.');
  if (dot <= 0 || dot === seg.length - 1) return ''; // no dot, leading dot, or trailing dot
  return seg.slice(dot + 1).toLowerCase();
}

/**
 * Whether `uri` must use the VLC engine on the given platform. True on iOS and
 * Android for a container in {@link VLC_CONTAINERS}; false on web and for any
 * other container. The caller is responsible for excluding live streams.
 *
 * @param {string} uri
 * @param {string} platform - Platform.OS ('ios'|'android'|'web').
 * @returns {boolean}
 */
function needsVlcEngine(uri, platform) {
  if (platform !== 'ios' && platform !== 'android') return false;
  return VLC_CONTAINERS.has(containerExtension(uri));
}

export { VLC_CONTAINERS, containerExtension, needsVlcEngine };
