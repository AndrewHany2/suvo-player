// @ts-check
/**
 * hls.js driver — the web/TV engine adapter implementing the PlayerDriver
 * contract in ./types.js around an hls.js instance + a `<video>` element.
 *
 * The recovery brain (recoveryMachine) never imports hls.js; it only ever talks
 * to this driver and consumes NormalizedError objects. This module is the only
 * place in the web player that knows about hls.js's API surface.
 *
 * Unlike expo-video, hls.js exposes real per-level quality control, so
 * setQualityCap() actually pins/limits the rendered level. The driver also
 * supports the native-HLS fallback path (Safari / `video.src=`) where no hls.js
 * instance exists — in that mode quality selection degrades gracefully to a no-op.
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

import Hls from 'hls.js';

/**
 * How long currentTime may stay flat (while not paused and the element believes
 * it should be playing) before the watchdog reports a stall. Mirrors the native
 * driver's threshold so both engines behave the same.
 */
export const STALL_THRESHOLD_MS = 6000;

/** Interval (ms) for the time-not-advancing watchdog poll. */
export const STALL_POLL_MS = 1000;

/**
 * Map a quality cap value to a maximum vertical resolution (height). 'auto' and
 * 'data-saver' are handled specially by the caller.
 * @type {Record<string, number>}
 */
const CAP_TO_MAX_HEIGHT = {
  '1080': 1080,
  '720': 720,
  '480': 480,
};

/**
 * Build a PlayerDriver around an hls.js instance + a <video> element.
 *
 * The hls instance is owned by the host (the screen creates/destroys it across
 * source changes). When `hls` is null the driver runs in native-HLS mode and
 * operates directly on the <video> element.
 *
 * @param {HTMLVideoElement | (() => (HTMLVideoElement|null))} videoElOrGetter -
 *   The underlying media element, or a getter that resolves it lazily. A getter
 *   lets the host build the driver during render (before the <video> ref is
 *   attached) so the resilient-playback hook's load effect — which fires on the
 *   same commit — still sees a non-null driver and a live element.
 * @param {Object} [opts]
 * @param {boolean} [opts.isTV=false] - TV tuning toggle (informational; the host
 *   already applies the isTV hls config when it constructs the instance).
 * @param {() => (import('hls.js').default | null)} [opts.getHls] - Lazily resolve
 *   the current hls.js instance. Preferred over a captured reference so the
 *   driver always sees the live instance after a reload swaps it.
 * @param {import('hls.js').default | null} [opts.hls] - A fixed hls.js instance
 *   (used when there is no getHls accessor). May be null for native HLS.
 * @param {(url: string) => (import('hls.js').default | null)} [opts.ensureHls] -
 *   Factory the driver calls at the start of load() for an HLS url. It must
 *   (re)create the engine instance for this source, store it where getHls reads
 *   it, wire any host listeners (manifest/track menus), and return it (or null
 *   to fall back to native HLS). Guarantees the instance exists before
 *   loadSource regardless of React effect ordering.
 * @param {number} [opts.stallThresholdMs=STALL_THRESHOLD_MS]
 * @returns {PlayerDriver}
 */
export function createHlsDriver(videoElOrGetter, opts = {}) {
  const stallThresholdMs = opts.stallThresholdMs ?? STALL_THRESHOLD_MS;

  /** @returns {HTMLVideoElement | null} Resolve the live media element. */
  const el = () =>
    typeof videoElOrGetter === 'function' ? videoElOrGetter() : videoElOrGetter ?? null;

  /** @returns {import('hls.js').default | null} */
  const hls = () => {
    if (typeof opts.getHls === 'function') return opts.getHls();
    return opts.hls ?? null;
  };

  // Most recently requested cap; kept so the recovery ladder stays coherent and
  // so we can re-apply it after a reload.
  let requestedCap = 'auto';

  // ── error plumbing ────────────────────────────────────────────────────────
  // The hls.js instance is recreated on every reload (ensureHls), but the host
  // subscribes to onError once. So we keep the host's callback in a sink and
  // (re)bind the ERROR listener to whichever instance is current — at subscribe
  // time and again after each load() swaps the instance.
  /** @type {((err: NormalizedError) => void) | null} */
  let errorSink = null;
  /** @type {import('hls.js').default | null} */
  let boundInst = null;
  /** @type {(e:any, data:any)=>void} */
  let boundHandler = () => {};

  function bindHlsErrors() {
    const inst = hls();
    if (inst === boundInst) return; // already bound to this instance
    // Detach from the previous instance.
    if (boundInst) {
      try {
        boundInst.off(Hls.Events.ERROR, boundHandler);
      } catch {
        /* the old instance may already be destroyed */
      }
    }
    boundInst = inst;
    if (!inst || !errorSink) return;
    boundHandler = (_e, data) => {
      if (!data?.fatal) return; // only fatal errors reach the recovery brain
      errorSink?.(normalizeHlsError(data));
    };
    try {
      inst.on(Hls.Events.ERROR, boundHandler);
    } catch {
      /* noop */
    }
  }

  // ── lifecycle / transport ─────────────────────────────────────────────────
  /**
   * (Re)load a source. Reproduces the screen's original init logic:
   *  - live `.ts` URLs are rewritten to `.m3u8`,
   *  - hls.js path: loadSource + attachMedia, then on MANIFEST_PARSED seek to
   *    startTime (VOD) or to the live edge (toLiveEdge) and play,
   *  - native path: set video.src and seek on loadedmetadata.
   *
   * The host wires the hls.js MANIFEST_PARSED/ERROR/track listeners (it needs
   * them for the quality/audio/subtitle menus); this method only kicks off the
   * load + initial seek/play so it stays usable on its own.
   *
   * @param {PlayerSource} source
   * @param {LoadOptions & {toLiveEdge?: boolean}} [loadOpts]
   */
  function load(source, loadOpts = {}) {
    const videoEl = el();
    if (!videoEl || !source) return;
    const rawUri = typeof source === 'string' ? source : source.uri;
    if (!rawUri) return;

    const isLive = !!loadOpts.isLive;
    const uri =
      isLive && rawUri.endsWith('.ts') ? rawUri.replace(/\.ts$/, '.m3u8') : rawUri;
    const isHls = uri.includes('.m3u8');

    // Let the host (re)create + wire the engine instance for this source before
    // we touch it, so getHls() always resolves the fresh instance (avoids a
    // React effect-ordering race between the hook's load and the screen's own
    // hls-lifecycle effect).
    if (isHls && typeof opts.ensureHls === 'function' && Hls.isSupported()) {
      try {
        opts.ensureHls(uri);
      } catch {
        /* fall through to whatever getHls resolves */
      }
    }

    // (Re)bind the fatal-error listener to the instance ensureHls just created
    // so recovery RELOADs keep feeding errors to the recovery machine.
    bindHlsErrors();

    const seekToStart = () => {
      try {
        if (loadOpts.toLiveEdge) {
          seekToLiveEdge();
        } else if (typeof loadOpts.startTime === 'number' && loadOpts.startTime > 0) {
          videoEl.currentTime = loadOpts.startTime;
        }
      } catch {
        /* seeking before metadata is ready can throw; ignore */
      }
      try {
        videoEl.play().catch(() => {});
      } catch {
        /* noop */
      }
    };

    const inst = hls();
    if (inst) {
      // hls.js path. The host attaches MANIFEST_PARSED to populate menus + seek;
      // we also seek/play here so the driver is correct when used standalone.
      const onParsed = () => {
        try {
          if (requestedCap !== 'auto') applyCapToLevels(requestedCap);
        } catch {
          /* noop */
        }
        seekToStart();
      };
      try {
        inst.once(Hls.Events.MANIFEST_PARSED, onParsed);
      } catch {
        /* older instance may already be torn down */
      }
      try {
        inst.loadSource(uri);
        inst.attachMedia(videoEl);
      } catch {
        /* noop */
      }
    } else {
      // Native HLS (Safari etc.) — drive the element directly.
      const onMeta = () => seekToStart();
      try {
        videoEl.src = uri;
        videoEl.addEventListener('loadedmetadata', onMeta, { once: true });
      } catch {
        /* noop */
      }
    }
  }

  function play() {
    const videoEl = el();
    try {
      videoEl?.play?.().catch?.(() => {});
    } catch {
      /* noop */
    }
  }

  function pause() {
    const videoEl = el();
    try {
      videoEl?.pause?.();
    } catch {
      /* noop */
    }
  }

  /**
   * Seek to the live edge: hls.js exposes `liveSyncPosition`; fall back to the
   * seekable end / duration.
   */
  function seekToLiveEdge() {
    const videoEl = el();
    const inst = hls();
    let edge;
    if (inst && typeof inst.liveSyncPosition === 'number' && Number.isFinite(inst.liveSyncPosition)) {
      edge = inst.liveSyncPosition;
    } else if (videoEl?.seekable && videoEl.seekable.length > 0) {
      edge = videoEl.seekable.end(videoEl.seekable.length - 1);
    } else if (Number.isFinite(videoEl?.duration)) {
      edge = videoEl.duration;
    }
    if (videoEl && typeof edge === 'number' && Number.isFinite(edge) && edge > 0) {
      try {
        videoEl.currentTime = edge;
      } catch {
        /* noop */
      }
    }
  }

  // ── getters ────────────────────────────────────────────────────────────────
  function currentTime() {
    const t = el()?.currentTime;
    return typeof t === 'number' && Number.isFinite(t) ? t : 0;
  }

  function duration() {
    const d = el()?.duration;
    return typeof d === 'number' ? d : NaN;
  }

  function buffered() {
    try {
      const b = el()?.buffered;
      if (!b || b.length === 0) return 0;
      const t = currentTime();
      const end = b.end(b.length - 1);
      const ahead = end - t;
      return ahead > 0 ? ahead : 0;
    } catch {
      return 0;
    }
  }

  function isLive() {
    const videoEl = el();
    const inst = hls();
    if (inst && inst.levels && typeof inst.currentLevel === 'number') {
      const lvl = inst.levels[inst.currentLevel] ?? inst.levels[0];
      if (lvl && typeof lvl.details?.live === 'boolean') return lvl.details.live;
    }
    // Native fallback: live streams report an Infinity duration.
    return videoEl ? !Number.isFinite(videoEl.duration) : false;
  }

  // ── quality ──────────────────────────────────────────────────────────────────
  /**
   * Map the cap ladder to hls.js level controls and apply it.
   *
   *   'auto'        -> currentLevel = -1, maxAutoLevel = -1 (engine ABR, no cap).
   *   '1080'/'720'/ -> maxAutoLevel pinned to the highest level whose height is
   *     '480'          <= the cap; ABR still adapts beneath that ceiling.
   *   'data-saver'  -> currentLevel pinned to the single lowest-bitrate level.
   *
   * @param {string} cap
   */
  function applyCapToLevels(cap) {
    const inst = hls();
    if (!inst || !Array.isArray(inst.levels) || inst.levels.length === 0) return;
    const levels = inst.levels;

    if (cap === 'auto') {
      inst.currentLevel = -1;
      inst.maxAutoLevel = -1;
      return;
    }

    if (cap === 'data-saver') {
      // Pin to the lowest-bitrate level outright.
      let lowest = 0;
      for (let i = 1; i < levels.length; i += 1) {
        if ((levels[i].bitrate || 0) < (levels[lowest].bitrate || 0)) lowest = i;
      }
      inst.currentLevel = lowest;
      return;
    }

    const maxHeight = CAP_TO_MAX_HEIGHT[cap];
    if (!maxHeight) {
      inst.currentLevel = -1;
      inst.maxAutoLevel = -1;
      return;
    }

    // Highest index whose height fits under the cap. Fall back to the smallest
    // level if none qualify (e.g. all renditions exceed the cap).
    let capIdx = -1;
    let smallest = 0;
    for (let i = 0; i < levels.length; i += 1) {
      const h = levels[i].height || 0;
      if (h <= maxHeight && i > capIdx) capIdx = i;
      if ((levels[i].height || Infinity) < (levels[smallest].height || Infinity)) smallest = i;
    }
    const target = capIdx >= 0 ? capIdx : smallest;
    // Keep ABR enabled beneath the ceiling rather than hard-pinning a level.
    inst.currentLevel = -1;
    inst.maxAutoLevel = target;
  }

  /** @param {string} cap */
  function setQualityCap(cap) {
    requestedCap = cap || 'auto';
    try {
      applyCapToLevels(requestedCap);
    } catch {
      /* levels may not be parsed yet; re-applied on MANIFEST_PARSED */
    }
  }

  // ── error normalization ──────────────────────────────────────────────────────
  /**
   * Normalize an hls.js ERROR event `data` payload into the NormalizedError
   * shape the classifier expects.
   *
   * @param {any} data - hls.js ERROR event data.
   * @returns {NormalizedError}
   */
  function normalizeHlsError(data) {
    const d = data || {};
    /** @type {NormalizedError} */
    const out = { type: d.type, fatal: !!d.fatal, original: d };
    const code = d.response?.code;
    if (typeof code === 'number') out.httpStatus = code;

    // Map hls.js detail/types to a coarse `kind` so the classifier routes
    // correctly even when no HTTP status is present.
    const details = String(d.details || '').toLowerCase();
    if (d.type === Hls.ErrorTypes.MEDIA_ERROR) {
      out.kind = details.includes('bufferstall') ? 'stall' : 'media';
    } else if (d.type === Hls.ErrorTypes.NETWORK_ERROR) {
      if (details.includes('manifestloaderror') || details.includes('levelemptyerror')) {
        // A manifest that won't load with no status is treated as transient
        // (keep trying); a 404 is caught above via httpStatus -> GONE.
        out.kind = 'network';
      } else if (details.includes('timeout')) {
        out.kind = 'timeout';
      } else if (details.includes('frag')) {
        out.kind = 'segment';
      } else {
        out.kind = 'network';
      }
    }
    return out;
  }

  // ── event subscriptions ──────────────────────────────────────────────────────
  /**
   * @param {(status: PlayerStatus) => void} cb
   * @returns {Unsubscribe}
   */
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

  /**
   * @param {(currentTime: number) => void} cb
   * @returns {Unsubscribe}
   */
  function onProgress(cb) {
    const videoEl = el();
    if (!videoEl) return () => {};
    const onTimeUpdate = () => cb(currentTime());
    videoEl.addEventListener('timeupdate', onTimeUpdate);
    return () => videoEl.removeEventListener('timeupdate', onTimeUpdate);
  }

  /**
   * Stall watchdog: fires when currentTime fails to advance for
   * `stallThresholdMs` while the element is not paused and not ended, AND on the
   * element's native 'waiting'/'stalled' events. Polls so a hard freeze (no
   * events at all) is still caught.
   *
   * @param {() => void} cb
   * @returns {Unsubscribe}
   */
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

      if (t > lastTime + 0.05) {
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

    // NOTE: we deliberately do NOT treat the element's 'waiting'/'stalled'
    // events as stalls. Those fire on ordinary rebuffering (very common on
    // memory-constrained TVs with small buffers), and escalating them to the
    // recovery machine forced a needless RELOAD — which tore down + reattached
    // hls.js, blanking the frame to black and flashing "reconnecting" on every
    // buffer blip. Ordinary buffering is surfaced by the screen as a transient
    // spinner instead. Only a genuine stall — currentTime failing to advance
    // for `stallThresholdMs` while the element believes it is playing (caught by
    // the watchdog above) — escalates to recovery.

    return () => {
      clearInterval(id);
    };
  }

  /**
   * @param {(err: NormalizedError) => void} cb
   * @returns {Unsubscribe}
   */
  function onError(cb) {
    const videoEl = el();
    const unsubs = [];

    // Register the sink and bind to the current hls instance. load() re-binds on
    // every reload so a freshly recreated instance keeps reporting fatal errors.
    errorSink = cb;
    bindHlsErrors();
    unsubs.push(() => {
      errorSink = null;
      if (boundInst) {
        try {
          boundInst.off(Hls.Events.ERROR, boundHandler);
        } catch {
          /* noop */
        }
      }
      boundInst = null;
    });

    // Native <video> error (covers the Safari/src= path and engine-less faults).
    // When an hls.js instance is active it owns error reporting via the ERROR
    // event above; ignore the element's error then to avoid double-reporting
    // (mirrors the original screen's `if (!hlsRef.current)` guard).
    if (videoEl) {
      const onElError = () => {
        if (hls()) return; // hls.js path reports through its own ERROR event
        const code = videoEl.error?.code;
        /** @type {NormalizedError} */
        const out = { fatal: true, original: videoEl.error };
        // MediaError codes: 2 = NETWORK, 3 = DECODE, 4 = SRC_NOT_SUPPORTED.
        if (code === 3 || code === 4) out.kind = 'media';
        else out.kind = 'network';
        cb(out);
      };
      videoEl.addEventListener('error', onElError);
      unsubs.push(() => videoEl.removeEventListener('error', onElError));
    }

    return () => {
      for (const u of unsubs) {
        try {
          u();
        } catch {
          /* noop */
        }
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

export default createHlsDriver;
