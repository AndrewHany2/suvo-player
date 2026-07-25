// @ts-check
/**
 * Live engine router — a PlayerDriver that picks hls.js or mpegts.js per source.
 *
 * Xtream live channels all arrive as `.m3u8` URLs, but some providers actually
 * serve a raw MPEG-TS stream behind that URL (a redirect to `video/mp2t`), which
 * hls.js can't play. On each LIVE load() this probes the stream and delegates to
 * the hls sub-driver (real HLS) or the mpegts sub-driver (raw TS). Non-live
 * sources always use hls (VOD is handled by hls/native there, unchanged).
 *
 * Element-based reads (currentTime/duration/buffered) are engine-agnostic — both
 * sub-drivers read the same <video> element — so those are pull-based and always
 * delegate to the hls sub-driver (no rebind needed). Subscriptions
 * (onStatus/onProgress/onStall/onError) follow the active engine on every switch
 * so the first-frame gate and stall watchdog belong to whichever engine is
 * actually driving the <video> element.
 *
 * @typedef {import('./types.js').PlayerDriver} PlayerDriver
 */

import { probeLiveStream } from '../liveStreamProbe.js';

/**
 * @param {Object} deps
 * @param {PlayerDriver} deps.hls   - hls.js sub-driver (also the default engine).
 * @param {PlayerDriver} deps.mpegts- mpegts.js sub-driver (raw MPEG-TS).
 * @param {(url: string, opts?: {signal?: AbortSignal}) => Promise<{engine:'hls'|'mpegts', confident?: boolean}>} [deps.probe] - override for tests.
 * @param {number} [deps.probeTimeoutMs=2000] - hard deadline for the probe; on
 *   expiry we default to hls and DON'T cache, so a wrong guess self-corrects.
 * @returns {PlayerDriver}
 */
export function createLiveRouterDriver({ hls, mpegts, probe = probeLiveStream, probeTimeoutMs = 2000 }) {
  /** @type {PlayerDriver} */
  let active = hls;

  // The host subscribes once for the driver's whole life, but the active engine
  // changes on an hls↔mpegts switch. Keep each element-level subscription's
  // callback and re-point it at the active engine when we switch. onError was
  // already rebound this way; status/progress/stall now follow the active engine
  // too so the first-frame gate + stall watchdog belong to whichever engine is
  // actually driving the <video> element.
  /** @type {Record<'status'|'progress'|'stall'|'error', {cb: any, unsub: (()=>void)|null}>} */
  const subs = {
    status: { cb: null, unsub: null },
    progress: { cb: null, unsub: null },
    stall: { cb: null, unsub: null },
    error: { cb: null, unsub: null },
  };

  const SUB_METHOD = { status: 'onStatus', progress: 'onProgress', stall: 'onStall', error: 'onError' };

  /** @param {'status'|'progress'|'stall'|'error'} kind */
  function rebindOne(kind) {
    const entry = subs[kind];
    if (entry.unsub) { try { entry.unsub(); } catch { /* noop */ } entry.unsub = null; }
    if (entry.cb) entry.unsub = active[SUB_METHOD[kind]](entry.cb);
  }

  function rebindAll() {
    rebindOne('status');
    rebindOne('progress');
    rebindOne('stall');
    rebindOne('error');
  }

  /** @param {'status'|'progress'|'stall'|'error'} kind */
  function subscribe(kind, cb) {
    subs[kind].cb = cb;
    rebindOne(kind);
    return () => {
      const entry = subs[kind];
      if (entry.unsub) { try { entry.unsub(); } catch { /* noop */ } entry.unsub = null; }
      entry.cb = null;
    };
  }

  /** url -> resolved engine, so a recovery-reload doesn't re-probe. */
  const engineCache = new Map();

  // Probe a live URL for its engine, bounded by a hard deadline. probeLiveStream
  // never throws (it swallows AbortError and resolves to hls), so a timeout is
  // surfaced as an explicit low-confidence verdict rather than a hang; we abort
  // the in-flight fetch on expiry. Only a CONFIDENT result is cached: a timed-out
  // or failed probe must not poison the cache with 'hls' for a raw-TS channel
  // (that would loop hls forever) — leaving it uncached lets the next load
  // re-probe. `confident !== false` keeps caching legacy/real confident results.
  async function resolveLiveEngine(uri) {
    const cached = engineCache.get(uri);
    if (cached) return cached;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timer = null;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => {
        try { controller?.abort(); } catch { /* noop */ }
        resolve({ engine: 'hls', confident: false });
      }, probeTimeoutMs);
    });
    let result;
    try {
      result = await Promise.race([
        probe(uri, controller ? { signal: controller.signal } : undefined),
        timeout,
      ]);
    } catch {
      result = { engine: 'hls', confident: false };
    } finally {
      if (timer) clearTimeout(timer);
    }
    const engine = result?.engine === 'mpegts' ? 'mpegts' : 'hls';
    if (result?.confident !== false) engineCache.set(uri, engine);
    return engine;
  }

  async function load(source, loadOpts = {}) {
    const uri = typeof source === 'string' ? source : source?.uri;
    let engine = 'hls';
    if (loadOpts.isLive && uri) {
      engine = await resolveLiveEngine(uri);
    }
    const next = engine === 'mpegts' ? mpegts : hls;
    if (next !== active) {
      // Free the <video> element from the previous engine before the next one
      // attaches, so two engines never fight over the same element.
      try { active.destroy?.(); } catch { /* noop */ }
      active = next;
      rebindAll();
    }
    active.load(source, loadOpts);
  }

  return {
    load,
    play: () => active.play?.(),
    pause: () => active.pause?.(),
    destroy: () => {
      try { hls.destroy?.(); } catch { /* noop */ }
      try { mpegts.destroy?.(); } catch { /* noop */ }
    },
    // Engine-agnostic element reads → delegate to hls sub-driver.
    currentTime: () => hls.currentTime(),
    duration: () => hls.duration(),
    buffered: () => hls.buffered(),
    isLive: () => active.isLive(),
    setQualityCap: (cap) => active.setQualityCap?.(cap),
    seekTo: (sec) => active.seekTo?.(sec),
    seekBy: (delta) => active.seekBy?.(delta),
    setVolume: (v) => active.setVolume?.(v),
    setRate: (r) => active.setRate?.(r),
    nudge: () => active.nudge?.(),
    capabilities: { canSeek: true, canSetRate: true, canSetVolume: true, canNudge: true },
    onStatus: (cb) => subscribe('status', cb),
    onProgress: (cb) => subscribe('progress', cb),
    onStall: (cb) => subscribe('stall', cb),
    onError: (cb) => subscribe('error', cb),
  };
}

export default createLiveRouterDriver;
