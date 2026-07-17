// @ts-check
/**
 * mpegts.js driver — the web/TV engine adapter for RAW MPEG-TS live streams
 * (`Content-Type: video/mp2t`), which hls.js cannot play. Implements the same
 * PlayerDriver contract as hlsDriver so the recovery brain and the resilient
 * playback host treat it identically. mpegts.js is imported ONLY here (mirrors
 * the "never import an engine outside its driver" rule).
 *
 * Unlike hls.js there are no ABR levels or track menus in a raw single-program
 * MPEG-TS stream, so setQualityCap is a no-op (like the native driver) and no
 * manifest/track listeners are wired. The driver owns its mpegts.js Player
 * lifecycle internally (create on load, destroy on reload/destroy) — the host
 * needs no ensureX callback because there are no menus to populate.
 *
 * @typedef {import('./types.js').PlayerDriver} PlayerDriver
 * @typedef {import('./types.js').NormalizedError} NormalizedError
 * @typedef {import('./types.js').PlayerSource} PlayerSource
 * @typedef {import('./types.js').LoadOptions} LoadOptions
 * @typedef {import('./types.js').Unsubscribe} Unsubscribe
 * @typedef {import('./types.js').PlayerStatus} PlayerStatus
 */

import mpegts from 'mpegts.js';
import { normalizeMpegtsError } from './mpegtsError.js';

// Re-export so the driver stays the single import surface for consumers.
export { normalizeMpegtsError };

export const STALL_THRESHOLD_MS = 6000;
export const STALL_POLL_MS = 1000;

/** @returns {boolean} whether mpegts.js MSE live playback is usable here. */
export function isMpegtsSupported() {
  try {
    return !!(mpegts && mpegts.isSupported && mpegts.isSupported());
  } catch {
    return false;
  }
}

/**
 * Build a PlayerDriver around mpegts.js + a <video> element.
 *
 * @param {HTMLVideoElement | (() => (HTMLVideoElement|null))} videoElOrGetter
 * @param {Object} [opts]
 * @param {boolean} [opts.isTV=false]
 * @param {number} [opts.stallThresholdMs=STALL_THRESHOLD_MS]
 * @returns {PlayerDriver}
 */
export function createMpegtsDriver(videoElOrGetter, opts = {}) {
  const stallThresholdMs = opts.stallThresholdMs ?? STALL_THRESHOLD_MS;

  /** @returns {HTMLVideoElement | null} */
  const el = () =>
    typeof videoElOrGetter === 'function' ? videoElOrGetter() : videoElOrGetter ?? null;

  /** @type {any} */
  let player = null;
  /** @type {((err: NormalizedError) => void) | null} */
  let errorSink = null;

  function destroyPlayer() {
    if (!player) return;
    try { player.unload(); } catch { /* noop */ }
    try { player.detachMediaElement(); } catch { /* noop */ }
    try { player.destroy(); } catch { /* noop */ }
    player = null;
  }

  /**
   * (Re)create the mpegts.js player for a source and start playback.
   * @param {PlayerSource} source
   * @param {LoadOptions} [loadOpts]
   */
  function load(source, loadOpts = {}) {
    const videoEl = el();
    const uri = typeof source === 'string' ? source : source?.uri;
    if (!videoEl || !uri) return;

    destroyPlayer();
    try {
      player = mpegts.createPlayer(
        { type: 'mpegts', isLive: loadOpts.isLive !== false, url: uri },
        {
          // Workers can break under webOS file:// — demux on the main thread.
          enableWorker: false,
          // Latency-chasing seeks to the live edge whenever latency grows; on a
          // weak TV / jittery stream that causes constant re-seeking (decode a
          // frame → jump → rebuffer → repeat, the "one frame then loading"
          // stutter). Smoothness matters more than live-edge latency here → off.
          liveBufferLatencyChasing: false,
          // Keep the demuxer pulling continuously for live (no lazy pausing),
          // and let the default stash buffer (~384 KB) prime playback so the
          // decoder isn't starved.
          lazyLoad: false,
          // Reclaim already-played buffer so a long session can't overflow the
          // TV's small SourceBuffer and stall.
          autoCleanupSourceBuffer: true,
        },
      );
      // Fatal engine faults → the recovery brain, normalized like hls.js.
      player.on(mpegts.Events.ERROR, (errType, errDetail, info) => {
        errorSink?.(normalizeMpegtsError(errType, errDetail, info));
      });
      player.attachMediaElement(videoEl);
      player.load();
      try { videoEl.play?.().catch?.(() => {}); } catch { /* noop */ }
    } catch (e) {
      errorSink?.({ fatal: true, kind: 'media', original: e });
    }
  }

  function play() {
    try { el()?.play?.().catch?.(() => {}); } catch { /* noop */ }
  }
  function pause() {
    try { el()?.pause?.(); } catch { /* noop */ }
  }
  function destroy() {
    destroyPlayer();
  }

  // ── getters (element-based; a raw live stream has no seekable duration) ──────
  function currentTime() {
    const t = el()?.currentTime;
    return typeof t === 'number' && Number.isFinite(t) ? t : 0;
  }
  function duration() {
    const d = el()?.duration;
    return typeof d === 'number' ? d : Number.NaN;
  }
  function buffered() {
    try {
      const b = el()?.buffered;
      if (!b || b.length === 0) return 0;
      const ahead = b.end(b.length - 1) - currentTime();
      return Math.max(0, ahead);
    } catch {
      return 0;
    }
  }
  function isLive() {
    return true; // this driver only handles raw live MPEG-TS
  }
  function setQualityCap() {
    /* raw MPEG-TS has no selectable levels — no-op (matches native driver) */
  }

  // ── event subscriptions (element-based, engine-agnostic) ─────────────────────
  /** @param {(status: PlayerStatus) => void} cb */
  function onStatus(cb) {
    const videoEl = el();
    if (!videoEl) return () => {};
    const onPlaying = () => cb({ state: 'playing' });
    const onWaiting = () => cb({ state: 'buffering', isBuffering: true });
    const onLoadStart = () => cb({ state: 'loading' });
    const onCanPlay = () => cb({ state: 'playing' });
    videoEl.addEventListener('playing', onPlaying);
    videoEl.addEventListener('waiting', onWaiting);
    videoEl.addEventListener('loadstart', onLoadStart);
    videoEl.addEventListener('canplay', onCanPlay);
    return () => {
      videoEl.removeEventListener('playing', onPlaying);
      videoEl.removeEventListener('waiting', onWaiting);
      videoEl.removeEventListener('loadstart', onLoadStart);
      videoEl.removeEventListener('canplay', onCanPlay);
    };
  }

  /** @param {(currentTime: number) => void} cb */
  function onProgress(cb) {
    const videoEl = el();
    if (!videoEl) return () => {};
    const onTimeUpdate = () => cb(currentTime());
    videoEl.addEventListener('timeupdate', onTimeUpdate);
    return () => videoEl.removeEventListener('timeupdate', onTimeUpdate);
  }

  /** @param {() => void} cb */
  function onStall(cb) {
    const videoEl = el();
    if (!videoEl) return () => {};
    let lastTime = currentTime();
    let lastAdvance = Date.now();
    let firedForThisStall = false;
    const id = setInterval(() => {
      if (!videoEl) return;
      const paused = videoEl.paused || videoEl.ended;
      const t = currentTime();
      const now = Date.now();
      if (Math.abs(t - lastTime) > 0.05) {
        lastTime = t;
        lastAdvance = now;
        firedForThisStall = false;
        return;
      }
      if (paused) {
        lastAdvance = now;
        lastTime = t;
        return;
      }
      if (!firedForThisStall && now - lastAdvance >= stallThresholdMs) {
        firedForThisStall = true;
        cb();
      }
    }, STALL_POLL_MS);
    return () => clearInterval(id);
  }

  /** @param {(err: NormalizedError) => void} cb */
  function onError(cb) {
    const videoEl = el();
    const unsubs = [];
    errorSink = cb;
    unsubs.push(() => { errorSink = null; });
    // Native <video> error (decode/src) — mpegts also surfaces via its ERROR
    // event, but the element error covers faults mpegts doesn't report.
    if (videoEl) {
      const onElError = () => {
        const code = videoEl.error?.code;
        /** @type {NormalizedError} */
        const out = { fatal: true, original: videoEl.error };
        out.kind = code === 3 || code === 4 ? 'media' : 'network';
        cb(out);
      };
      videoEl.addEventListener('error', onElError);
      unsubs.push(() => videoEl.removeEventListener('error', onElError));
    }
    return () => { for (const u of unsubs) { try { u(); } catch { /* noop */ } } };
  }

  /** @type {PlayerDriver} */
  return {
    load, play, pause, destroy,
    currentTime, duration, buffered, isLive,
    setQualityCap,
    onStatus, onProgress, onStall, onError,
  };
}

export default createMpegtsDriver;
