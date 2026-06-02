/**
 * Image proxy utility - SIMPLIFIED for TV performance
 * Only proxies IPTV server images, loads everything else directly
 */

const isTV =
  typeof window !== "undefined" &&
  (window.navigator.userAgent.includes("Web0S") ||
    window.navigator.userAgent.includes("webOS") ||
    window.navigator.userAgent.includes("SmartTV"));

// Get IPTV server host from current credentials
let iptvServerHost = null;

export function setIPTVServerHost(host) {
  if (host) {
    iptvServerHost = host.replace(/^(https?:\/\/)/, "").replace(/\/$/, "");
  }
}

/**
 * Check if URL is from IPTV server
 */
function isIPTVServerUrl(url) {
  if (!url || !iptvServerHost) return false;
  try {
    const urlObj = new URL(url);
    return urlObj.hostname === iptvServerHost || url.includes(iptvServerHost);
  } catch {
    return url.includes(iptvServerHost);
  }
}

/**
 * Convert image URL - only proxy IPTV server images
 * @param {string} url - Original image URL
 * @returns {string} - Original URL (no proxy for performance)
 */
export function getProxiedImageUrl(url) {
  // Always return original URL - let browser handle it
  // IPTV images will be loaded directly from server
  return url;
}

/**
 * Get alternative URL (no-op for performance)
 */
export function getAlternativeProxyUrl(url) {
  return url;
}

/**
 * Check if running on TV platform
 */
export function isTVPlatform() {
  return isTV;
}

export default {
  getProxiedImageUrl,
  getAlternativeProxyUrl,
  isTVPlatform,
  setIPTVServerHost,
};

// Made with Bob
