// @ts-check
/**
 * PURE: decide which native engine plays a given source.
 *
 * iOS AVFoundation/AVPlayer cannot demux the Matroska (mkv) container — nor
 * avi/flv/wmv/webm — and answers with "Cannot Open". expo-video (AVPlayer) is
 * fine for mp4/HLS. These containers are routed to a libVLC-backed player
 * instead. Routing is extension-based so it works for both remote
 * `http(s)://…/id.mkv` and downloaded `file://…/id.mkv`.
 */

/** Containers iOS/AVPlayer cannot demux; routed to the VLC engine. */
const UNSUPPORTED_IOS_CONTAINERS = new Set(['mkv', 'avi', 'flv', 'wmv', 'webm']);

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
 * Whether `uri` must use the VLC engine on the given platform. True only on iOS
 * for a container AVPlayer can't demux.
 *
 * @param {string} uri
 * @param {string} platform - Platform.OS ('ios'|'android'|'web').
 * @returns {boolean}
 */
function needsVlcEngine(uri, platform) {
  if (platform !== 'ios') return false;
  return UNSUPPORTED_IOS_CONTAINERS.has(containerExtension(uri));
}

export { UNSUPPORTED_IOS_CONTAINERS, containerExtension, needsVlcEngine };
