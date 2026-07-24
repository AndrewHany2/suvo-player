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

/**
 * Headers sent with the native stream request, mirroring what the Electron
 * build already injects (see electron/main.js) — the config proven to play
 * these streams on desktop.
 *
 * iOS AVPlayer defaults to an `AppleCoreMedia/…` UA and Android ExoPlayer to a
 * generic one. Many IPTV / Xtream-Codes servers whitelist by User-Agent (and
 * expect a Referer) and answer an unrecognised request with a 404 / HTML error
 * page — which AVPlayer then tries to parse as media and fails (`FigFilePlayer`
 * err -12864) or surfaces as "The requested URL was not found on this server."
 * The web/TV path works because the browser/webview sends an accepted request;
 * expo-video sends nothing extra, so we must add these ourselves. The UA below
 * is the exact string Electron uses (it impersonates IPTV Smarters Pro, which
 * IPTV servers commonly whitelist). Referer is derived per-stream from its host.
 */
export const STREAM_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) IPTVSmartersPro/1.1.1 Chrome/53.0.2785.143 Electron/1.4.16 Safari/537.36';

/**
 * Derive the `Referer` header value (`scheme://host/`) from a stream URL. Uses a
 * regex rather than `new URL()` so it doesn't depend on a URL polyfill in the
 * native JS engine. Returns undefined for non-http(s) inputs.
 *
 * @param {string} uri
 * @returns {string|undefined}
 */
export function refererForUri(uri) {
  const m = /^(https?:\/\/[^/]+)/i.exec(uri || '');
  return m ? `${m[1]}/` : undefined;
}

// TEMP diagnostic logging (dev only; inert under node:test). Remove once the
// iOS stream-init failure is resolved.
const RP_DEBUG = typeof __DEV__ !== 'undefined' && __DEV__;

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

  // Play intent. A single play() issued immediately after replace() on a
  // freshly-created (null-source) player is unreliable: the item may not exist
  // yet, so the call is dropped (or throws and is swallowed), leaving the player
  // at readyToPlay but paused — the source loads, the spinner hides, and nothing
  // ever starts. We track whether we WANT to be playing and re-assert play() the
  // moment the player reaches readyToPlay. Cleared by pause().
  let wantPlay = false;
  // Resume target for the current source. Applied ONCE on the first readyToPlay:
  // on Android/ExoPlayer a currentTime set right after replaceAsync resolves is
  // dropped (media not prepared yet), so the early seek in load() alone leaves
  // playback at 0. Re-applying here guarantees resume lands. resumeSeekDone is
  // reset per load() so recovery RELOADs (which pass a fresh seekTo) resume too.
  let pendingSeekSec = 0;
  let resumeSeekDone = false;
  // Has playback genuinely advanced since the last load()? The stall watchdog
  // must not fire while currentTime is still pinned at 0 / the resume offset
  // during the FIRST buffer — otherwise a slow cold start reads as a
  // mid-playback freeze and the recovery machine "reconnects" (RELOAD =
  // teardown + re-buffer from scratch). Reset on every load(); set true only on
  // a real, playback-sized forward step (which excludes the large one-shot jump
  // of a resume seek). Mirrors the shipped vlcDriver `started` guard.
  let hasStartedPlaying = false;
  try {
    player?.addListener?.('statusChange', (payload) => {
      if (payload?.status !== 'readyToPlay') return;
      if (!resumeSeekDone && pendingSeekSec > 0) {
        try {
          player.currentTime = pendingSeekSec;
        } catch {
          /* seeking before metadata is ready can throw; ignore */
        }
        resumeSeekDone = true;
      }
      if (wantPlay) {
        try {
          player.play();
        } catch {
          /* play() on a released/torn-down player throws; ignore */
        }
      }
    });
  } catch {
    /* addListener unavailable on this build */
  }

  // ── lifecycle / transport ─────────────────────────────────────────────────
  /**
   * @param {PlayerSource} source
   * @param {LoadOptions} [loadOpts]
   */
  function load(source, loadOpts = {}) {
    if (!player || !source) return;
    const uri = typeof source === 'string' ? source : source.uri;
    if (!uri) return;
    // We intend to play this source; the readyToPlay listener above re-asserts
    // play() once the pipeline is actually ready, in case the immediate play()
    // below is dropped (item not yet loaded on a freshly-replaced source).
    wantPlay = true;
    // Re-arm the first-frame gate: this (re)load must advance again before the
    // stall watchdog can fire, so a fresh source or a recovery RELOAD is never
    // insta-stalled while it re-buffers.
    hasStartedPlaying = false;
    // Record the resume target for the readyToPlay-gated seek (see the listener
    // above) and reset the once-guard for this load.
    pendingSeekSec =
      !loadOpts.isLive && typeof loadOpts.startTime === 'number' && loadOpts.startTime > 0
        ? loadOpts.startTime
        : 0;
    resumeSeekDone = false;
    // For VOD, resume at the saved position then start; live ignores startTime
    // (the engine joins at the live edge). This early seek is a fast path for
    // engines already prepared; Android's dropped seek is recovered on readyToPlay.
    const seekAndPlay = () => {
      if (pendingSeekSec > 0) {
        try {
          player.currentTime = pendingSeekSec;
        } catch {
          /* seeking before metadata is ready can throw; ignore */
        }
      }
      try {
        player.play();
      } catch {
        /* noop */
      }
    };
    // replace swaps the active source and re-initialises the pipeline (this is
    // how recovery RELOADs after an error/stall). Prefer replaceAsync when the
    // engine exposes it: the synchronous replace() loads the asset ON THE MAIN
    // THREAD, which iOS flags with a deprecation warning and can freeze the UI
    // on every (re)load. replaceAsync keeps the load off the main thread; we
    // seek+play when it resolves. Falls back to sync replace() where absent.
    // Mirror the Electron build's headers (User-Agent + Referer + Accept-Language)
    // so UA/Referer-gating IPTV servers return media instead of a 404 / error
    // page. Pass through any per-source headers last so a caller can override.
    const perSourceHeaders =
      source && typeof source === 'object' && source.headers ? source.headers : undefined;
    const referer = refererForUri(uri);
    const videoSource = {
      uri,
      headers: {
        'User-Agent': STREAM_USER_AGENT,
        'Accept-Language': 'en-US',
        ...(referer ? { Referer: referer } : {}),
        ...perSourceHeaders,
      },
    };
    const useAsync = typeof player.replaceAsync === 'function';
    if (RP_DEBUG) {
      console.log(
        `[RP:drv] load(v2 headers) via=${useAsync ? 'replaceAsync' : 'replace'} uri=${uri}` +
          ` referer=${referer} ua="${STREAM_USER_AGENT.slice(0, 24)}…"`,
      );
    }
    try {
      if (useAsync) {
        player
          .replaceAsync(videoSource)
          .then(seekAndPlay)
          .catch(() => {
            /* torn down or load failed; the statusChange error path handles it */
          });
      } else {
        player.replace(videoSource, true);
        seekAndPlay();
      }
    } catch {
      /* player may be torn down mid-recovery */
    }
  }

  function play() {
    wantPlay = true;
    try {
      player?.play();
    } catch {
      /* noop */
    }
  }

  function pause() {
    wantPlay = false;
    try {
      player?.pause();
    } catch {
      /* noop */
    }
  }

  // ── getters ────────────────────────────────────────────────────────────────
  // NOTE: expo-video player properties are backed by a native SharedObject.
  // Reading one before a source is loaded, or after the player is released,
  // throws NativeSharedObjectNotFoundException — the optional-chain (`player?.`)
  // does NOT catch that (player is a live JS object; the *getter* throws). Every
  // getter below must be try/catch-guarded so a lifecycle race can never crash
  // the render or a poll callback. Return the same safe defaults as a missing
  // player.
  function currentTime() {
    try {
      const t = player?.currentTime;
      return typeof t === 'number' && Number.isFinite(t) ? t : 0;
    } catch {
      return 0;
    }
  }

  function duration() {
    try {
      const d = player?.duration;
      return typeof d === 'number' ? d : NaN;
    } catch {
      return NaN;
    }
  }

  function buffered() {
    // expo-video exposes bufferedPosition as an absolute time; convert to
    // seconds-ahead-of-currentTime to match the contract.
    try {
      const bp = player?.bufferedPosition;
      if (typeof bp !== 'number' || !Number.isFinite(bp)) return 0;
      const ahead = bp - currentTime();
      return ahead > 0 ? ahead : 0;
    } catch {
      return 0;
    }
  }

  function isLive() {
    try {
      return !!player?.isLive;
    } catch {
      return false;
    }
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

      if (Math.abs(t - lastTime) > 0.05) {
        // The clock MOVED — reset the watchdog. Note this is |Δ|, not just a
        // forward advance: a recovery RELOAD (player.replace) or a seek can
        // restart currentTime BELOW the last sample. Treating only forward
        // motion as "alive" left `lastTime` a monotonic high-water mark, so
        // after such a reset every sample looked "flat" (t never exceeds the
        // old mark), lastAdvance never refreshed, and the watchdog fired a
        // false STALL every stallThresholdMs while the stream was genuinely
        // playing — an endless Reconnecting→reload→black loop. Any movement,
        // in either direction, means the pipeline is not frozen.
        // A real, playback-sized forward step (excludes the large one-shot jump
        // of a resume seek) marks playback as genuinely started, arming the gate.
        if (!paused && t > lastTime && t - lastTime < (progressPollMs / 1000) * 3) {
          hasStartedPlaying = true;
        }
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

      if (!hasStartedPlaying) {
        // Still in the FIRST buffer (currentTime pinned at 0 / the resume
        // offset). Keep the clock fresh and never escalate to a stall until
        // playback has actually advanced once.
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
      if (RP_DEBUG) {
        console.log(`[RP:drv] ERROR msg="${payload?.error?.message ?? ''}"`);
      }
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
