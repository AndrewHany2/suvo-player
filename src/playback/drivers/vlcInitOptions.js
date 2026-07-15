// @ts-check
/**
 * PURE: build the libVLC per-input option array that carries the same
 * UA/Referer headers the expo-video driver sends. Many IPTV/Xtream servers
 * whitelist by User-Agent and expect a Referer; without these the stream 404s.
 *
 * libVLC reads these as media-input options: `:http-user-agent=` and
 * `:http-referrer=` (note libVLC's historical "referrer" spelling). They are
 * placed on the VLC source object's `initOptions` array.
 *
 * @param {{ userAgent?: string, referer?: string }} [headers]
 * @returns {string[]}
 */
function vlcInitOptions(headers = {}) {
  const opts = [];
  if (headers.userAgent) opts.push(`:http-user-agent=${headers.userAgent}`);
  if (headers.referer) opts.push(`:http-referrer=${headers.referer}`);
  return opts;
}

export { vlcInitOptions };
