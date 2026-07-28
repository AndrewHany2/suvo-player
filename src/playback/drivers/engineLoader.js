// @ts-nocheck
/**
 * Playback-engine module loader for hls.js (~543KB) and mpegts.js (~273KB).
 *
 * Three runtimes:
 *  - Web / Electron: Metro bundles the engines normally (the literal require
 *    below), so `ensure*()` resolves instantly and nothing changes vs. before.
 *  - TV (EXPO_PUBLIC_TV=1): metro.config resolves 'hls.js'/'mpegts.js' to a null
 *    stub (engineStub.js) so those ~816KB stay OUT of the single-bundle
 *    cold-start parse on the weak webOS/Tizen JS engine. Here we load them from
 *    vendored <script> tags on first play instead — tv/patch-index.js copies the
 *    UMD builds into tv/dist/vendor/, and the UMDs set globalThis.Hls /
 *    globalThis.mpegts. First play pays a one-time script fetch (local file:// on
 *    TV, so fast); the module is cached for every subsequent load.
 *  - Node test runtime: `require` is absent under ESM, so fall back to
 *    createRequire — the driver unit tests get the real modules.
 *
 * The literal `require('hls.js')` / `require('mpegts.js')` MUST stay literal:
 * Metro only bundles string-literal requires, so that is what keeps the engines
 * in the web bundle (and lets the TV resolver swap them for the stub).
 */

const isBrowser = typeof document !== "undefined";

// Node ESM test runtime only (no module-scoped require there). Never bundled:
// createRequire()(...) is not a literal require, so Metro doesn't collect it.
function nodeResolve(name) {
  if (isBrowser || typeof process === "undefined" || !process.getBuiltinModule) return null;
  try {
    const req = process.getBuiltinModule("node:module").createRequire(process.cwd() + "/");
    const m = req(name);
    return m?.default ?? m ?? null;
  } catch {
    return null;
  }
}

function requireHls() {
  if (typeof require === "function") {
    try {
      const m = require("hls.js"); // literal → bundled on web, stub (→null) on TV
      const r = m?.default ?? m;
      if (r) return r;
    } catch {
      /* stubbed / unavailable */
    }
  }
  return nodeResolve("hls.js");
}

function requireMpegts() {
  if (typeof require === "function") {
    try {
      const m = require("mpegts.js"); // literal → bundled on web, stub (→null) on TV
      const r = m?.default ?? m;
      if (r) return r;
    } catch {
      /* stubbed / unavailable */
    }
  }
  return nodeResolve("mpegts.js");
}

// Inject the vendored UMD <script> once and resolve the global it defines. TV
// loads relative (file://); web (only reached if the engine wasn't bundled) from root.
function loadVendorScript(file, globalName) {
  return new Promise((resolve, reject) => {
    if (!isBrowser) {
      reject(new Error("engineLoader: no document to inject " + file));
      return;
    }
    const existing = globalThis[globalName];
    if (existing) {
      resolve(existing.default ?? existing);
      return;
    }
    const src = (globalThis.__TV__ ? "./" : "/") + "vendor/" + file;
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => {
      const g = globalThis[globalName];
      if (g) resolve(g.default ?? g);
      else reject(new Error(file + " loaded but globalThis." + globalName + " is missing"));
    };
    s.onerror = () => reject(new Error("engineLoader: failed to load " + src));
    document.head.appendChild(s);
  });
}

// ── hls.js ──────────────────────────────────────────────────────────────────
let _hls = null;
let _hlsPromise = null;

/** Synchronous accessor: cached module, bundled module (web/Node), or global (TV
 *  after ensureHlsModule). Returns null on TV before the vendored script loads —
 *  every sync call site runs after load()'s awaited ensureHlsModule, so it's set. */
export function getHlsModule() {
  if (_hls) return _hls;
  if (typeof globalThis !== "undefined" && globalThis.Hls) {
    _hls = globalThis.Hls;
    return _hls;
  }
  const b = requireHls();
  if (b) {
    _hls = b;
    return _hls;
  }
  return null;
}

/** Async: guarantee the hls.js module is available (bundled → instant; TV → fetch
 *  the vendored script once). Call at the driver's load() entry before use. */
export function ensureHlsModule() {
  const cached = getHlsModule();
  if (cached) return Promise.resolve(cached);
  if (_hlsPromise) return _hlsPromise;
  _hlsPromise = loadVendorScript("hls.min.js", "Hls").then((m) => {
    _hls = m;
    return m;
  });
  return _hlsPromise;
}

// ── mpegts.js ────────────────────────────────────────────────────────────────
let _mpegts = null;
let _mpegtsPromise = null;

export function getMpegtsModule() {
  if (_mpegts) return _mpegts;
  if (typeof globalThis !== "undefined" && globalThis.mpegts) {
    _mpegts = globalThis.mpegts;
    return _mpegts;
  }
  const b = requireMpegts();
  if (b) {
    _mpegts = b;
    return _mpegts;
  }
  return null;
}

export function ensureMpegtsModule() {
  const cached = getMpegtsModule();
  if (cached) return Promise.resolve(cached);
  if (_mpegtsPromise) return _mpegtsPromise;
  _mpegtsPromise = loadVendorScript("mpegts.js", "mpegts").then((m) => {
    _mpegts = m;
    return m;
  });
  return _mpegtsPromise;
}
