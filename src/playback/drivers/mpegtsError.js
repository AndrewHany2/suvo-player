// @ts-check
/**
 * Pure mpegts.js error normalization — kept in its own module (like
 * hlsResponseUrl.js is to hlsDriver) so it can be unit-tested under bare
 * `node --test` without importing mpegts.js, which references `window` at load.
 *
 * @typedef {import('./types.js').NormalizedError} NormalizedError
 */

/**
 * Normalize an mpegts.js ERROR into the NormalizedError shape the recovery
 * classifier expects. mpegts errors are effectively always fatal.
 *
 * @param {string} errType   mpegts error type (e.g. "NetworkError", "MediaError")
 * @param {string} [errDetail] mpegts error detail
 * @param {{ code?: number }} [info] extra info; a numeric `code` becomes httpStatus
 * @returns {NormalizedError}
 */
export function normalizeMpegtsError(errType, errDetail, info) {
  /** @type {NormalizedError} */
  const out = { fatal: true, type: String(errType || ''), original: { errType, errDetail, info } };
  const code = info?.code;
  if (typeof code === 'number') out.httpStatus = code;
  const t = String(errType || '').toLowerCase();
  if (t.includes('network')) out.kind = 'network';
  else if (t.includes('media')) out.kind = 'media';
  else out.kind = 'media';
  return out;
}
