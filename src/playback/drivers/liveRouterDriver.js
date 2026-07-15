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
 * Element-based reads and subscriptions (currentTime/duration/buffered/onStatus/
 * onProgress/onStall) are engine-agnostic — both sub-drivers implement them on
 * the same <video> element — so the router delegates those to the hls sub-driver
 * permanently. Only load(), onError(), setQualityCap() and isLive() follow the
 * active engine; onError is rebound to the active engine on every switch.
 *
 * @typedef {import('./types.js').PlayerDriver} PlayerDriver
 */

import { probeLiveStream } from '../liveStreamProbe.js';

/**
 * @param {Object} deps
 * @param {PlayerDriver} deps.hls   - hls.js sub-driver (also the default engine).
 * @param {PlayerDriver} deps.mpegts- mpegts.js sub-driver (raw MPEG-TS).
 * @param {(url: string) => Promise<{engine:'hls'|'mpegts'}>} [deps.probe] - override for tests.
 * @returns {PlayerDriver}
 */
export function createLiveRouterDriver({ hls, mpegts, probe = probeLiveStream }) {
  /** @type {PlayerDriver} */
  let active = hls;
  /** @type {((err:any)=>void)|null} */
  let errorCb = null;
  /** @type {(()=>void)|null} */
  let errorUnsub = null;
  /** url -> resolved engine, so a recovery-reload doesn't re-probe. */
  const engineCache = new Map();

  function rebindError() {
    if (errorUnsub) { try { errorUnsub(); } catch { /* noop */ } errorUnsub = null; }
    if (errorCb) errorUnsub = active.onError(errorCb);
  }

  async function load(source, loadOpts = {}) {
    const uri = typeof source === 'string' ? source : source?.uri;
    let engine = 'hls';
    if (loadOpts.isLive && uri) {
      engine = engineCache.get(uri);
      if (!engine) {
        try { engine = (await probe(uri)).engine; } catch { engine = 'hls'; }
        engineCache.set(uri, engine);
      }
    }
    const next = engine === 'mpegts' ? mpegts : hls;
    if (next !== active) {
      // Free the <video> element from the previous engine before the next one
      // attaches, so two engines never fight over the same element.
      try { active.destroy?.(); } catch { /* noop */ }
      active = next;
      rebindError();
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
    onStatus: (cb) => hls.onStatus(cb),
    onProgress: (cb) => hls.onProgress(cb),
    onStall: (cb) => hls.onStall(cb),
    onError: (cb) => {
      errorCb = cb;
      rebindError();
      return () => {
        if (errorUnsub) { try { errorUnsub(); } catch { /* noop */ } errorUnsub = null; }
        errorCb = null;
      };
    },
  };
}

export default createLiveRouterDriver;
