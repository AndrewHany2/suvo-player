/**
 * Shared player constants.
 *
 * A dependency-free leaf module so both the web hook (usePlayer.js) and the
 * native player screens can import it without pulling in platform-specific
 * playback code. Keep it free of imports.
 */

/**
 * Storage key remembering the last-watched live channel stream_id. Device-local
 * (AsyncStorage / the localStorage shim), not synced. The web and native player
 * entry points MUST share this key so the value written by one is read by the
 * other on the same device — previously they used divergent literals.
 */
export const LAST_CHANNEL_KEY = "suvo_last_live_channel";
