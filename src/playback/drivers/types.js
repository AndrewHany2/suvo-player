// @ts-check
/**
 * PlayerDriver interface — the contract every engine adapter (hls.js on web/TV,
 * expo-video on native) must satisfy. JSDoc-only: this file defines typedefs
 * and ships a single no-op reference export so it can be imported without side
 * effects. No runtime engine logic lives here.
 *
 * The recovery brain (recoveryMachine) never imports an engine; it only ever
 * speaks to a PlayerDriver and consumes NormalizedError objects.
 */

/**
 * Normalized error shape that {@link import('../errorClassifier.js').classifyError}
 * expects. Drivers flatten hls.js / expo-video error events into this.
 *
 * @typedef {Object} NormalizedError
 * @property {number} [httpStatus] - HTTP status code, when the error came from a response (404, 401, 503...).
 * @property {string} [type]       - Engine error type, e.g. hls.js 'networkError' | 'mediaError' | 'bufferStallError'.
 * @property {boolean} [fatal]     - Whether the engine flagged the error as fatal.
 * @property {boolean} [offline]   - True when the failure is due to the device being offline.
 * @property {string} [kind]       - Coarse hint when no httpStatus/type is available:
 *                                   'manifest-removed'|'gone'|'auth'|'auth-expired'|'media'|'decode'|
 *                                   'stall'|'buffer-underrun'|'timeout'|'segment'|'fetch'|'network'|'offline'.
 * @property {*} [original]        - The original engine error object, for logging/diagnostics.
 */

/**
 * A selectable media track (audio or text/subtitle).
 *
 * @typedef {Object} MediaTrack
 * @property {string|number} id - Stable identifier used with setAudioTrack/setSubtitleTrack.
 * @property {string} [label]   - Human-readable label.
 * @property {string} [language]- BCP-47 / ISO language code.
 * @property {string} [kind]    - For text tracks: 'subtitles'|'captions' etc.
 */

/**
 * An available quality level reported by the engine.
 *
 * @typedef {Object} QualityLevel
 * @property {string|number} id - Level identifier.
 * @property {number} [height]  - Vertical resolution (e.g. 1080, 720).
 * @property {number} [bitrate] - Bitrate in bits/sec.
 * @property {string} [label]   - Human-readable label.
 */

/**
 * Source descriptor passed to load().
 *
 * @typedef {Object} PlayerSource
 * @property {string} uri        - Manifest / media URL.
 * @property {Object} [headers]  - Optional request headers (auth, etc).
 * @property {string} [type]     - Optional MIME / format hint.
 */

/**
 * Options for load().
 *
 * @typedef {Object} LoadOptions
 * @property {number} [startTime] - Seconds to start at (VOD resume). Ignored for live.
 * @property {boolean} [isLive]   - Whether this source is a live stream.
 */

/**
 * Unsubscribe function returned by every event subscription.
 * @typedef {() => void} Unsubscribe
 */

/**
 * @typedef {Object} PlayerStatus
 * @property {'idle'|'loading'|'playing'|'paused'|'buffering'|'ended'|'error'} [state]
 * @property {boolean} [isBuffering]
 */

/**
 * The uniform engine adapter contract.
 *
 * @typedef {Object} PlayerDriver
 *
 * // --- lifecycle / transport ---
 * @property {(source: PlayerSource, opts?: LoadOptions) => (void|Promise<void>)} load
 * @property {() => (void|Promise<void>)} play
 * @property {() => (void|Promise<void>)} pause
 * @property {() => (void|Promise<void>)} [destroy]
 *
 * // --- getters ---
 * @property {() => number} currentTime          - Current playback position (seconds).
 * @property {() => number} duration             - Total duration (seconds); Infinity/NaN for live.
 * @property {() => number} buffered             - Buffered-ahead seconds from currentTime.
 * @property {() => boolean} isLive              - Whether the active source is live.
 *
 * // --- quality ---
 * @property {(cap: string) => void} setQualityCap       - Apply a QUALITY_CAPS value ('auto'|'1080'|...).
 *
 * // --- event subscriptions (each returns an Unsubscribe) ---
 * @property {(cb: (status: PlayerStatus) => void) => Unsubscribe} onStatus
 * @property {(cb: (currentTime: number) => void) => Unsubscribe} onProgress
 * @property {(cb: () => void) => Unsubscribe} onStall
 * @property {(cb: (err: NormalizedError) => void) => Unsubscribe} onError
 */

/**
 * No-op reference export so importers can reference the module without pulling
 * in any engine. Not a usable driver — implementations live in hlsDriver.js /
 * expoVideoDriver.js.
 * @type {null}
 */
export const PLAYER_DRIVER_CONTRACT = null;
