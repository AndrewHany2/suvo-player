// @ts-check
/**
 * expo-video driver — the native engine adapter implementing the PlayerDriver
 * contract in ./types.js around an `expo-video` player instance (the object
 * returned by `useVideoPlayer`).
 *
 * The recovery brain (recoveryMachine) never imports expo-video; it only ever
 * talks to this driver and consumes NormalizedError objects. This module is the
 * only place that knows about expo-video's API surface.
 *
 * @typedef {import('./types.js').PlayerDriver} PlayerDriver
 * @typedef {import('./types.js').NormalizedError} NormalizedError
 * @typedef {import('./types.js').MediaTrack} MediaTrack
 * @typedef {import('./types.js').QualityLevel} QualityLevel
 * @typedef {import('./types.js').PlayerSource} PlayerSource
 * @typedef {import('./types.js').LoadOptions} LoadOptions
 * @typedef {import('./types.js').Unsubscribe} Unsubscribe
 * @typedef {import('./types.js').PlayerStatus} PlayerStatus
 */

/**
 * Parse an HTTP status code out of an expo-video PlayerError message, which is
 * only a free-form string (e.g. "Response code: 403", "HTTP 404"). Best-effort.
 *
 * @param {string} msg
 * @returns {number|undefined}
 */
function parseHttpStatus(msg) {
  if (!msg) return undefined;
  // Match common shapes: "code: 403", "HTTP 404", "status 503", "(401)".
  const m =
    msg.match(/(?:code|status|http)\D{0,4}(\d{3})/i) ||
    msg.match(/\b(4\d{2}|5\d{2})\b/);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Derive a coarse `kind` hint from a free-form error message so classifyError
 * can route media/network/offline failures even when no status code is present.
 *
 * @param {string} msg
 * @returns {string|undefined}
 */
function kindFromMessage(msg) {
  const m = (msg || '').toLowerCase();
  if (!m) return undefined;
  if (/offline|no internet|not connected|network is unreachable/.test(m)) return 'offline';
  if (/timed?\s*out|timeout/.test(m)) return 'timeout';
  if (/decode|decoder|codec|unsupported|format/.test(m)) return 'media';
  if (/manifest|playlist|not found|removed|gone/.test(m)) return 'gone';
  if (/segment/.test(m)) return 'segment';
  if (/connection|network|fetch|load|host|dns|socket/.test(m)) return 'network';
  return undefined;
}

/**
 * Normalize an expo-video error into the {@link NormalizedError} shape the
 * classifier expects. expo-video only surfaces `{ message }`, so this is a
 * best-effort flatten: scrape an HTTP status and a coarse `kind` from the text.
 *
 * @param {{message?: string}|undefined} err
 * @returns {NormalizedError}
 */
export function normalizeExpoError(err) {
  const message = err && typeof err.message === 'string' ? err.message : '';
  const httpStatus = parseHttpStatus(message);
  const kind = kindFromMessage(message);
  /** @type {NormalizedError} */
  const out = { type: 'mediaError', fatal: true, original: err };
  if (httpStatus !== undefined) out.httpStatus = httpStatus;
  // Prefer a network kind so unknown failures bias to TRANSIENT_NETWORK
  // ("keep trying") rather than MEDIA_DECODE. Only flag media/gone/offline when
  // the message clearly says so.
  if (kind) out.kind = kind;
  else if (httpStatus === undefined) out.kind = 'network';
  return out;
}

/** Interval (ms) for the progress poll that backs onProgress + the stall watchdog. */
export const PROGRESS_POLL_MS = 1000;

/**
 * How long currentTime may stay flat (while not paused and the player believes
 * it is playing) before we treat it as a stall.
 */
export const STALL_THRESHOLD_MS = 6000;

/**
 * Build a PlayerDriver around an expo-video player instance.
 *
 * @param {any} player - The object returned by expo-video's `useVideoPlayer`.
 * @param {Object} [opts]
 * @param {number} [opts.progressPollMs=PROGRESS_POLL_MS]
 * @param {number} [opts.stallThresholdMs=STALL_THRESHOLD_MS]
 * @returns {PlayerDriver}
 */
export function createExpoVideoDriver(player, opts = {}) {
  const progressPollMs = opts.progressPollMs ?? PROGRESS_POLL_MS;
  const stallThresholdMs = opts.stallThresholdMs ?? STALL_THRESHOLD_MS;

  // Records the most recently requested quality cap. expo-video exposes no
  // public per-level selection API, so this is currently informational only
  // (see setQualityCap below).
  let requestedCap = 'auto';

  // ── lifecycle / transport ─────────────────────────────────────────────────
  /**
   * @param {PlayerSource} source
   * @param {LoadOptions} [loadOpts]
   */
  function load(source, loadOpts = {}) {
    if (!player || !source) return;
    const uri = typeof source === 'string' ? source : source.uri;
    if (!uri) return;
    // replace() swaps the active source and re-initialises the pipeline — this
    // is how recovery RELOADs the stream after an error/stall.
    try {
      player.replace({ uri });
    } catch {
      /* player may be torn down mid-recovery */
      return;
    }
    // For VOD, resume at the saved position; live ignores startTime (the engine
    // joins at the live edge by default).
    if (!loadOpts.isLive && typeof loadOpts.startTime === 'number' && loadOpts.startTime > 0) {
      try {
        player.currentTime = loadOpts.startTime;
      } catch {
        /* seeking before metadata is ready can throw; ignore */
      }
    }
    try {
      player.play();
    } catch {
      /* noop */
    }
  }

  function play() {
    try {
      player?.play();
    } catch {
      /* noop */
    }
  }

  function pause() {
    try {
      player?.pause();
    } catch {
      /* noop */
    }
  }

  // ── getters ────────────────────────────────────────────────────────────────
  function currentTime() {
    const t = player?.currentTime;
    return typeof t === 'number' && Number.isFinite(t) ? t : 0;
  }

  function duration() {
    const d = player?.duration;
    return typeof d === 'number' ? d : NaN;
  }

  function buffered() {
    // expo-video exposes bufferedPosition as an absolute time; convert to
    // seconds-ahead-of-currentTime to match the contract.
    const bp = player?.bufferedPosition;
    if (typeof bp !== 'number' || !Number.isFinite(bp)) return 0;
    const ahead = bp - currentTime();
    return ahead > 0 ? ahead : 0;
  }

  function isLive() {
    return !!player?.isLive;
  }

  // ── quality ──────────────────────────────────────────────────────────────────
  /**
   * Apply a quality cap.
   *
   * LIMITATION: expo-video (~3.0.x) does not expose a public API to enumerate or
   * pin HLS rendition levels — there is no equivalent of hls.js `currentLevel` /
   * `levels`. The native player's ABR picks levels internally. We therefore
   * record the requested cap (so the recovery machine's downgrade ladder stays
   * coherent and diagnostics can read it) but cannot enforce it on the engine.
   * This is intentionally a no-op against the player itself.
   *
   * @param {string} cap
   */
  function setQualityCap(cap) {
    requestedCap = cap;
  }


  // ── event subscriptions ──────────────────────────────────────────────────────
  /**
   * Map an expo-video VideoPlayerStatus to the contract's PlayerStatus.state.
   * @param {string} s
   * @returns {PlayerStatus['state']}
   */
  function mapStatus(s) {
    switch (s) {
      case 'idle':
        return 'idle';
      case 'loading':
        return 'loading';
      case 'readyToPlay':
        return 'playing';
      case 'error':
        return 'error';
      default:
        return 'loading';
    }
  }

  /**
   * @param {(status: PlayerStatus) => void} cb
   * @returns {Unsubscribe}
   */
  function onStatus(cb) {
    if (!player?.addListener) return () => {};
    const sub = player.addListener('statusChange', (payload) => {
      const state = mapStatus(payload?.status);
      cb({ state, isBuffering: payload?.status === 'loading' });
    });
    return () => {
      try {
        sub?.remove();
      } catch {
        /* noop */
      }
    };
  }

  /**
   * Drive progress from a poll (robust across engines) and also seed the stall
   * watchdog. expo-video has a `timeUpdate` event but its cadence is
   * configurable/unreliable for stall detection, so we poll.
   *
   * @param {(currentTime: number) => void} cb
   * @returns {Unsubscribe}
   */
  function onProgress(cb) {
    const id = setInterval(() => {
      cb(currentTime());
    }, progressPollMs);
    return () => clearInterval(id);
  }

  /**
   * Stall watchdog: emit when currentTime fails to advance for
   * `stallThresholdMs` while the player is not paused and believes it is
   * playing. Polls independently of onProgress so a host can wire either.
   *
   * @param {() => void} cb
   * @returns {Unsubscribe}
   */
  function onStall(cb) {
    let lastTime = currentTime();
    let lastAdvance = Date.now();
    let firedForThisStall = false;

    const id = setInterval(() => {
      if (!player) return;
      const paused = player.playing === false || player.status === 'idle';
      const t = currentTime();
      const now = Date.now();

      if (t > lastTime + 0.05) {
        // Time advanced: reset the watchdog.
        lastTime = t;
        lastAdvance = now;
        firedForThisStall = false;
        return;
      }

      // Time is flat. Only count it as a stall if we are supposed to be playing.
      if (paused) {
        // Keep the clock from accumulating paused time as a stall.
        lastAdvance = now;
        lastTime = t;
        return;
      }

      if (!firedForThisStall && now - lastAdvance >= stallThresholdMs) {
        firedForThisStall = true;
        cb();
      }
    }, progressPollMs);

    return () => clearInterval(id);
  }

  /**
   * @param {(err: NormalizedError) => void} cb
   * @returns {Unsubscribe}
   */
  function onError(cb) {
    if (!player?.addListener) return () => {};
    const sub = player.addListener('statusChange', (payload) => {
      if (payload?.status !== 'error') return;
      cb(normalizeExpoError(payload?.error));
    });
    return () => {
      try {
        sub?.remove();
      } catch {
        /* noop */
      }
    };
  }

  /** @type {PlayerDriver} */
  return {
    load,
    play,
    pause,
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
}

export default createExpoVideoDriver;
