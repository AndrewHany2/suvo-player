// @ts-check
/**
 * PURE quality-cap ladder helpers — no React, no hls.js. Split out of
 * usePlayer.js so the manual-cap ↔ auto-downgrade ceiling contract can be
 * unit-tested with bare `node --test`.
 *
 * The ladder values ("1080" | "720" | "480" | "data-saver" | "auto") mirror
 * backoff.js QUALITY_CAPS: a manual quality pick sets the hook's manualCap, which
 * the recovery machine treats as the *best* quality auto-downgrade may restore to
 * — auto-downgrade can drop below the user's pick but never exceed it.
 */

/**
 * Map an hls.js level height to a quality-cap ladder value.
 * @param {number} [height]
 * @returns {"auto"|"1080"|"720"|"480"|"data-saver"}
 */
export function heightToCap(height) {
  if (!height) return "auto";
  if (height >= 1080) return "1080";
  if (height >= 720) return "720";
  if (height >= 480) return "480";
  return "data-saver";
}

/**
 * Numeric ceiling for a quality-cap ladder value, used to pick the best hls
 * level at or below a remembered cap. 'auto' (or unknown) => Infinity (no cap).
 * @param {string} [cap]
 * @returns {number}
 */
export function capToMaxHeight(cap) {
  switch (cap) {
    case "1080": return 1080;
    case "720": return 720;
    case "480": return 480;
    case "data-saver": return 360;
    default: return Infinity;
  }
}

/**
 * Given the available hls levels and a remembered cap, return the index of the
 * best (tallest) level whose height is at/below the cap, or -1 for Auto.
 * @param {Array<{height?: number}>} levels
 * @param {string} [cap]
 * @returns {number}
 */
export function levelForCap(levels, cap) {
  if (!cap || cap === "auto" || !Array.isArray(levels) || levels.length === 0) return -1;
  const max = capToMaxHeight(cap);
  let bestIdx = -1;
  let bestH = -1;
  for (let i = 0; i < levels.length; i++) {
    const h = levels[i]?.height || 0;
    if (h <= max && h > bestH) { bestH = h; bestIdx = i; }
  }
  return bestIdx;
}

/**
 * Human label for a quality level. Falls back to bitrate when height is unknown,
 * and disambiguates duplicate heights by appending the bitrate.
 * @param {{height?: number, bitrate: number}} level
 * @param {Array<{height?: number}>} levels
 * @returns {string}
 */
export function getLevelLabel(level, levels) {
  if (!level.height) return `${Math.round(level.bitrate / 1000)}k`;
  return levels.filter((l) => l.height === level.height).length > 1
    ? `${level.height}p (${Math.round(level.bitrate / 1000)}k)`
    : `${level.height}p`;
}
