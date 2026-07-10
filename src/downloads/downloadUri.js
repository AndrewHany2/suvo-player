export const DEFAULT_EXT = 'mp4';

export function remoteUrlFor(api, item) {
  const ext = item.ext || DEFAULT_EXT;
  if (item.kind === 'movie') return api.buildStreamUrl('movie', item.streamId, ext);
  return api.buildStreamUrl('series', item.episodeStreamId, ext);
}

export function localPathFor(id, ext, dir) {
  const safe = String(id).replace(/:/g, '_');
  return `${dir}downloads/${safe}.${ext || DEFAULT_EXT}`;
}
