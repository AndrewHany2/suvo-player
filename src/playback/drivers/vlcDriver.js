// @ts-check
/**
 * libVLC driver — the native engine adapter implementing the PlayerDriver
 * contract in ./types.js around a <VLCPlayer> (react-native-vlc-media-player).
 *
 * <VLCPlayer> is declarative: playback is controlled by React props (`source`,
 * `paused`) and reports via callbacks (`onPlaying`, `onProgress`, `onPaused`,
 * `onStopped`, `onError`). This driver therefore takes a `handle` that writes
 * host state (setSource/setPaused/seek) and exposes an `ingest` object the host
 * wires the component's callbacks into.
 *
 * The recovery brain (recoveryMachine) never imports VLC; it only speaks to this
 * driver and consumes NormalizedError objects.
 *
 * @typedef {import('./types.js').PlayerDriver} PlayerDriver
 * @typedef {import('./types.js').NormalizedError} NormalizedError
 */

import { vlcInitOptions } from './vlcInitOptions.js';
import { STREAM_USER_AGENT, refererForUri } from './expoVideoDriver.js';

/** Progress poll interval (ms) for the stall watchdog. */
const STALL_POLL_MS = 1000;
/** How long position may stay flat while playing before we call it a stall. */
const STALL_THRESHOLD_MS = 6000;

/**
 * Map a VLC error event into the NormalizedError shape errorClassifier expects.
 * VLC's RN error payload is thin/opaque, so default to a fatal media error;
 * offline is separately handled by useResilientPlayback's NetInfo wiring, but we
 * still honour an explicit offline-ish message here.
 *
 * @param {{message?: string, error?: {message?: string}}|undefined} event
 * @returns {NormalizedError}
 */
export function classifyVlcError(event) {
  const message =
    (event && (event.message || (event.error && event.error.message))) || '';
  const lower = String(message).toLowerCase();
  /** @type {NormalizedError} */
  const out = { type: 'mediaError', fatal: true, kind: 'media', original: event };
  if (/offline|no internet|not connected|network is unreachable/.test(lower)) {
    out.offline = true;
    out.kind = 'offline';
  }
  return out;
}

/**
 * Build a PlayerDriver around a <VLCPlayer> host.
 *
 * @param {{ setSource: (s: any|null) => void, setPaused: (p: boolean) => void, seek: (fraction: number) => void }} handle
 * @returns {{ driver: PlayerDriver, ingest: { progress: (e:any)=>void, playing: (e:any)=>void, paused: ()=>void, stopped: ()=>void, error: (e:any)=>void } }}
 */
export function createVlcDriver(handle) {
  let lastPositionSec = 0;
  let lastDurationSec = NaN;
  let pendingStartSec = 0; // >0 means "seek here once we know duration"
  let didSeek = false;

  // Registered subscribers (single each is enough for useResilientPlayback).
  let statusCb = null;
  let progressCb = null;
  let stallCb = null;
  let errorCb = null;

  // ── PlayerDriver members ────────────────────────────────────────────────────
  function load(source, opts = {}) {
    const uri = typeof source === 'string' ? source : source && source.uri;
    if (!uri) return;
    const initOptions = vlcInitOptions({
      userAgent: STREAM_USER_AGENT,
      referer: refererForUri(uri),
    });
    // VOD resume: remember the target and seek once, on first playing.
    pendingStartSec =
      !opts.isLive && typeof opts.startTime === 'number' && opts.startTime > 0
        ? opts.startTime
        : 0;
    didSeek = false;
    lastPositionSec = 0;
    lastDurationSec = NaN;
    handle.setSource({ uri, initOptions });
    handle.setPaused(false);
  }

  function play() {
    handle.setPaused(false);
  }

  function pause() {
    handle.setPaused(true);
  }

  function destroy() {
    handle.setSource(null);
  }

  function currentTime() {
    return Number.isFinite(lastPositionSec) ? lastPositionSec : 0;
  }

  function duration() {
    return lastDurationSec;
  }

  function buffered() {
    return 0;
  }

  function isLive() {
    return false;
  }

  function setQualityCap() {
    /* progressive file, no ABR — no-op */
  }

  function onStatus(cb) {
    statusCb = cb;
    return () => {
      if (statusCb === cb) statusCb = null;
    };
  }

  function onProgress(cb) {
    progressCb = cb;
    return () => {
      if (progressCb === cb) progressCb = null;
    };
  }

  function onStall(cb) {
    stallCb = cb;
    let lastTime = lastPositionSec;
    let lastAdvance = Date.now();
    let fired = false;
    const id = setInterval(() => {
      const t = lastPositionSec;
      const now = Date.now();
      if (Math.abs(t - lastTime) > 0.05) {
        lastTime = t;
        lastAdvance = now;
        fired = false;
        return;
      }
      if (!fired && now - lastAdvance >= STALL_THRESHOLD_MS) {
        fired = true;
        try {
          cb();
        } catch {
          /* noop */
        }
      }
    }, STALL_POLL_MS);
    return () => {
      clearInterval(id);
      if (stallCb === cb) stallCb = null;
    };
  }

  function onError(cb) {
    errorCb = cb;
    return () => {
      if (errorCb === cb) errorCb = null;
    };
  }

  // ── ingest (host wires <VLCPlayer> callbacks here) ──────────────────────────
  function ingestProgress(e) {
    const ms = e && typeof e.currentTime === 'number' ? e.currentTime : null;
    const dms = e && typeof e.duration === 'number' ? e.duration : null;
    if (ms != null) lastPositionSec = ms / 1000;
    if (dms != null && dms > 0) lastDurationSec = dms / 1000;
    if (progressCb) progressCb(currentTime());
    if (statusCb) statusCb({ state: 'playing' });
  }

  function ingestPlaying(e) {
    const dms = e && typeof e.duration === 'number' ? e.duration : null;
    if (dms != null && dms > 0) lastDurationSec = dms / 1000;
    // Resume seek: once, when duration is known.
    if (!didSeek && pendingStartSec > 0 && lastDurationSec > 0) {
      const frac = Math.max(0, Math.min(1, pendingStartSec / lastDurationSec));
      didSeek = true;
      try {
        handle.seek(frac);
      } catch {
        /* noop */
      }
    }
    if (statusCb) statusCb({ state: 'playing' });
  }

  function ingestPaused() {
    if (statusCb) statusCb({ state: 'paused' });
  }

  function ingestStopped() {
    if (statusCb) statusCb({ state: 'idle' });
  }

  function ingestError(e) {
    if (errorCb) errorCb(classifyVlcError(e));
  }

  /** @type {PlayerDriver} */
  const driver = {
    load,
    play,
    pause,
    destroy,
    currentTime,
    duration,
    buffered,
    isLive,
    setQualityCap,
    onStatus,
    onProgress,
    onStall,
    onError,
  };

  return {
    driver,
    ingest: {
      progress: ingestProgress,
      playing: ingestPlaying,
      paused: ingestPaused,
      stopped: ingestStopped,
      error: ingestError,
    },
  };
}
