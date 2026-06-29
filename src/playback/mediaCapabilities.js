// @ts-check
/**
 * mediaCapabilities — platform-guarded media feature helpers, no new deps.
 *
 * Every browser/global access is feature-detected and wrapped so this module is
 * safe to import on web, react-native-web, webOS/Tizen, Electron, and native
 * (where `document`/`navigator`/`window` may be absent). Functions never throw;
 * they return safe falsy values or resolve gracefully.
 *
 * Web capabilities backed here:
 *   - Picture-in-Picture (video.requestPictureInPicture / document.exitPictureInPicture)
 *   - Remote Playback + Cast presence detection (video.remote / global Cast API)
 *   - MediaSession metadata (navigator.mediaSession)
 *   - Background-audio capability flag
 *
 * Native capabilities are exported as documented STUBS for the native
 * integrator to back with expo-video:
 *   - PiP: expo-video VideoView already sets allowsPictureInPicture
 *   - Background audio: expo-video player.staysActiveInBackground / expo-av audio mode
 *   - AirPlay (iOS): expo-video / native route picker availability
 *   - Chromecast: requires react-native-google-cast (NOT installed) -> always false (see NOTE)
 *
 * NOTE: Chromecast on native intentionally returns false here because
 * react-native-google-cast is not a declared dependency. Do not add it from
 * this module; the native integrator wires it separately if/when installed.
 */

/* ------------------------------------------------------------------ *
 * Internal guards
 * ------------------------------------------------------------------ */

/** @returns {boolean} true when a DOM-ish environment is present. */
function hasDom() {
  return typeof document !== 'undefined' && document != null;
}

/** @returns {Document|null} */
function doc() {
  return hasDom() ? document : null;
}

/** @returns {any} navigator or null */
function nav() {
  return typeof navigator !== 'undefined' && navigator != null ? navigator : null;
}

/** @returns {any} window/globalThis or null */
function win() {
  return typeof globalThis !== 'undefined' ? globalThis : null;
}

/* ------------------------------------------------------------------ *
 * Web: Picture-in-Picture
 * ------------------------------------------------------------------ */

/**
 * Whether browser Picture-in-Picture is usable for a given (optional) element.
 * When no element is passed, reports the document-level capability.
 *
 * @param {HTMLVideoElement} [video]
 * @returns {boolean}
 */
export function isPipSupported(video) {
  const d = doc();
  if (!d) return false;
  // document.pictureInPictureEnabled is the canonical capability flag.
  if (d.pictureInPictureEnabled !== true) return false;
  if (video) {
    return (
      typeof video.requestPictureInPicture === 'function' &&
      video.disablePictureInPicture !== true
    );
  }
  return true;
}

/**
 * Enter Picture-in-Picture for a <video>. Resolves true on success, false if
 * unsupported or it throws (e.g. not user-activated). Never rejects.
 *
 * @param {HTMLVideoElement} video
 * @returns {Promise<boolean>}
 */
export async function enterPip(video) {
  if (!video || !isPipSupported(video)) return false;
  try {
    const d = doc();
    if (d && d.pictureInPictureElement === video) return true;
    await video.requestPictureInPicture();
    return true;
  } catch {
    return false;
  }
}

/**
 * Exit Picture-in-Picture if currently active. Resolves true if it left PiP (or
 * was not in PiP), false only on an unexpected throw.
 *
 * @returns {Promise<boolean>}
 */
export async function exitPip() {
  const d = doc();
  if (!d || typeof d.exitPictureInPicture !== 'function') return false;
  try {
    if (d.pictureInPictureElement == null) return true;
    await d.exitPictureInPicture();
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a <video> is currently the PiP element.
 * @param {HTMLVideoElement} [video]
 * @returns {boolean}
 */
export function isPipActive(video) {
  const d = doc();
  if (!d) return false;
  if (video) return d.pictureInPictureElement === video;
  return d.pictureInPictureElement != null;
}

/* ------------------------------------------------------------------ *
 * Web: Remote Playback + Cast presence detection
 * ------------------------------------------------------------------ */

/**
 * Whether the W3C Remote Playback API is present on a media element.
 * (Actual device availability is async via remote.watchAvailability; we only
 * report API presence here.)
 *
 * @param {HTMLMediaElement} [video]
 * @returns {boolean}
 */
export function isRemotePlaybackSupported(video) {
  if (video) return video.remote != null && typeof video.remote.prompt === 'function';
  // No element: report whether the platform exposes the API on the prototype.
  const w = win();
  return !!(w && typeof w.HTMLMediaElement !== 'undefined' && 'remote' in w.HTMLMediaElement.prototype);
}

/**
 * Prompt the native Remote Playback picker (AirPlay on Safari, etc.). Resolves
 * true if the prompt was shown, false otherwise. Never rejects.
 *
 * @param {HTMLMediaElement} video
 * @returns {Promise<boolean>}
 */
export async function promptRemotePlayback(video) {
  if (!video || !isRemotePlaybackSupported(video)) return false;
  try {
    await video.remote.prompt();
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect presence of the Google Cast (Chromecast) Web Sender API. This reports
 * that the Cast framework is loaded on the page — not that a receiver is
 * currently reachable.
 *
 * @returns {boolean}
 */
export function isCastApiPresent() {
  const w = win();
  if (!w) return false;
  // cast.framework is set up by the Cast sender SDK; chrome.cast is the base API.
  const chrome = /** @type {any} */ (w).chrome;
  const cast = /** @type {any} */ (w).cast;
  return !!(
    (chrome && chrome.cast) ||
    (cast && cast.framework)
  );
}

/**
 * Aggregate web "casting available" signal: either a usable Remote Playback API
 * or a present Cast SDK.
 *
 * @param {HTMLMediaElement} [video]
 * @returns {boolean}
 */
export function isWebCastAvailable(video) {
  return isRemotePlaybackSupported(video) || isCastApiPresent();
}

/* ------------------------------------------------------------------ *
 * Web: MediaSession metadata + action handlers
 * ------------------------------------------------------------------ */

/** @returns {boolean} */
export function isMediaSessionSupported() {
  const n = nav();
  return !!(n && n.mediaSession);
}

/**
 * Set MediaSession "now playing" metadata for OS media controls / lockscreen.
 * Silently no-ops when unsupported. Never throws.
 *
 * @param {{ title?: string, artist?: string, album?: string,
 *           artwork?: Array<{src:string, sizes?:string, type?:string}> }} meta
 * @returns {boolean} true if metadata was applied
 */
export function setMediaSessionMetadata(meta) {
  const n = nav();
  const w = win();
  if (!n || !n.mediaSession || !w) return false;
  const MM = /** @type {any} */ (w).MediaMetadata;
  if (typeof MM !== 'function') return false;
  try {
    const m = meta || {};
    n.mediaSession.metadata = new MM({
      title: m.title || '',
      artist: m.artist || '',
      album: m.album || '',
      artwork: Array.isArray(m.artwork) ? m.artwork : [],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Register MediaSession action handlers (play/pause/seek/next/prev, etc.).
 * Unknown/unsupported actions are skipped. Pass a handler of null to clear one.
 * Never throws.
 *
 * @param {Record<string, ((details:any)=>void)|null>} handlers
 * @returns {string[]} the action names that were successfully set
 */
export function setMediaSessionHandlers(handlers) {
  const n = nav();
  if (!n || !n.mediaSession || typeof n.mediaSession.setActionHandler !== 'function') return [];
  const applied = [];
  for (const [action, handler] of Object.entries(handlers || {})) {
    try {
      n.mediaSession.setActionHandler(action, handler);
      applied.push(action);
    } catch {
      /* action unsupported by this browser — skip */
    }
  }
  return applied;
}

/**
 * Update the MediaSession position state (progress bar in OS controls).
 * @param {{ duration?: number, position?: number, playbackRate?: number }} state
 * @returns {boolean}
 */
export function setMediaSessionPosition(state) {
  const n = nav();
  if (!n || !n.mediaSession || typeof n.mediaSession.setPositionState !== 'function') return false;
  try {
    const s = state || {};
    const duration = Number.isFinite(s.duration) && s.duration > 0 ? s.duration : 0;
    if (duration <= 0) return false; // setPositionState rejects non-positive durations
    const position = Math.min(Math.max(Number(s.position) || 0, 0), duration);
    n.mediaSession.setPositionState({
      duration,
      position,
      playbackRate: Number.isFinite(s.playbackRate) && s.playbackRate > 0 ? s.playbackRate : 1,
    });
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Background audio capability flags
 * ------------------------------------------------------------------ */

/**
 * Whether background audio playback is plausibly supported on this platform.
 * On web this maps to MediaSession presence (the OS keeps audio alive and shows
 * controls). Native is reported via the stub below; the integrator backs it
 * with expo-video staysActiveInBackground / expo-av audio mode.
 *
 * @returns {boolean}
 */
export function isBackgroundAudioSupported() {
  // Web heuristic: MediaSession implies OS-level background media handling.
  return isMediaSessionSupported();
}

/* ------------------------------------------------------------------ *
 * Native STUBS (documented; integrator backs with expo-video)
 * ------------------------------------------------------------------ */

/**
 * Chromecast availability on NATIVE.
 *
 * NOTE: react-native-google-cast is NOT installed and must not be added here.
 * Until the native integrator wires it, this is hard-false. (Web Cast presence
 * is detected separately via isCastApiPresent / isWebCastAvailable.)
 *
 * @returns {boolean} always false
 */
export const isChromecastAvailable = () => false;

/**
 * AirPlay availability on NATIVE iOS.
 *
 * STUB: returns false by default. The native integrator should override/back
 * this using expo-video's route picker / a native AVRoutePickerView and report
 * true only on iOS where a route is available.
 *
 * @returns {boolean}
 */
export const isAirPlayAvailable = () => false;

/**
 * Native PiP capability.
 *
 * STUB: returns false here. expo-video's VideoView already sets
 * allowsPictureInPicture; the native integrator backs this with the player's
 * actual PiP support per-platform (iOS 14+/Android 8+).
 *
 * @returns {boolean}
 */
export const isNativePipSupported = () => false;

/**
 * Native background-audio capability.
 *
 * STUB: returns false here. The native integrator backs this with expo-video's
 * `staysActiveInBackground` (or expo-av Audio.setAudioModeAsync) and reports the
 * configured value.
 *
 * @returns {boolean}
 */
export const isNativeBackgroundAudioSupported = () => false;

/**
 * Convenience snapshot of currently-detectable WEB capabilities. Useful for a
 * settings/diagnostics panel. Native flags are reported via the stubs above so
 * they read false until the native integrator overrides them.
 *
 * @param {HTMLMediaElement} [video]
 * @returns {{pip:boolean, remotePlayback:boolean, cast:boolean,
 *            mediaSession:boolean, backgroundAudio:boolean}}
 */
export function getWebCapabilities(video) {
  return {
    pip: isPipSupported(/** @type {any} */ (video)),
    remotePlayback: isRemotePlaybackSupported(video),
    cast: isCastApiPresent(),
    mediaSession: isMediaSessionSupported(),
    backgroundAudio: isBackgroundAudioSupported(),
  };
}

export default {
  isPipSupported,
  enterPip,
  exitPip,
  isPipActive,
  isRemotePlaybackSupported,
  promptRemotePlayback,
  isCastApiPresent,
  isWebCastAvailable,
  isMediaSessionSupported,
  setMediaSessionMetadata,
  setMediaSessionHandlers,
  setMediaSessionPosition,
  isBackgroundAudioSupported,
  isChromecastAvailable,
  isAirPlayAvailable,
  isNativePipSupported,
  isNativeBackgroundAudioSupported,
  getWebCapabilities,
};
