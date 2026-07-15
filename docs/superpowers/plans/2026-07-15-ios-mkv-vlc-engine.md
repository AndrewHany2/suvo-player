# iOS MKV Playback via a VLC Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play AVPlayer-unsupported VOD containers (mkv/avi/flv/wmv/webm) on iOS by routing them to a libVLC-backed player behind the existing `PlayerDriver` contract, leaving the working `expo-video` path untouched. **Also bundled (per user request): fix Android "Continue" not resuming at the saved watch time** — a `expo-video` driver seek-timing bug (Task 7), independent of the VLC work and safe to do first.

**Architecture:** A pure `needsVlcEngine(url, platform)` decides routing. On iOS the native `VideoPlayerScreen` becomes a thin dispatcher that renders either the verbatim-moved `ExpoVideoPlayerScreen` (default) or a new `VlcPlayerScreen`. `VlcPlayerScreen` hosts `<VLCPlayer>` and drives it through a new `createVlcDriver` fed to the same `useResilientPlayback` host + `recoveryMachine` used by every other engine.

**Tech Stack:** Expo ~54 / React Native 0.81 / React 19, JavaScript only. New library: `react-native-vlc-media-player` (~1.0.98) with its Expo config plugin. Tests: `node:test` via `npm test`.

**Design spec:** [docs/superpowers/specs/2026-07-15-ios-mkv-vlc-engine-design.md](../specs/2026-07-15-ios-mkv-vlc-engine-design.md)

## Global Constraints

- **JavaScript only** — `.js` / `.jsx`, never TypeScript. `// @ts-check` header on pure modules matches the existing `src/playback` style.
- **No engine imports outside drivers** — only `vlcDriver.js` / `VlcPlayerScreen.native.jsx` may import `react-native-vlc-media-player`. `recoveryMachine.js` and `useResilientPlayback.js` stay engine-agnostic.
- **Tests are `node:test`** next to source as `*.test.js`; no Jest. Single file: `node --test <path>`; full suite: `npm test`.
- **Before every commit:** `npm test` and `npm run lint` must pass (lint warnings OK, errors not).
- **Routing is iOS-only** — `needsVlcEngine` returns `false` on every non-`ios` platform. Android stays on `expo-video`.
- **Container set (verbatim):** `UNSUPPORTED_IOS_CONTAINERS = new Set(['mkv', 'avi', 'flv', 'wmv', 'webm'])`.
- **UA/Referer gating:** VLC network sources MUST carry `:http-user-agent=<STREAM_USER_AGENT>` and `:http-referrer=<referer>` libVLC init options, or UA/Referer-gated providers (e.g. `mvo25.in`) return a 404/HTML error page. Reuse `STREAM_USER_AGENT` and `refererForUri` already exported from `src/playback/drivers/expoVideoDriver.js` (that module has no native imports, so importing it in a pure module and in `node:test` is safe).
- **VLC path is VOD-only** — `isLive()` is always `false`; live keeps its existing HLS/MPEG-TS routing.

## API facts pinned during planning (deviations from the spec's mapping table)

The spec was written before the library's exact API was confirmed. These corrections are authoritative for this plan:

1. **`initOptions` is a field on the `source` object**, not a top-level prop. `initType` is **not** read by the component — do not use it.
2. **`onBuffering` and `onLoad` are not in this version's `propTypes`.** Status/readiness comes from `onPlaying` (fires with `{ target, duration, seekable }`) and `onProgress`. Buffering-stall detection is done by a driver-side watchdog (same technique as `expoVideoDriver`), not a VLC buffering event.
3. **`onProgress` event shape:** `{ currentTime, duration, position, remainingTime }` where `currentTime`/`duration` are **milliseconds** and `position` is a **0..1 fraction**. Convert ms→s for the driver contract; use `position` directly for the seek bar.
4. **End-of-media callback name mismatch:** `propTypes` lists `onEnded` but the internal handler forwards `this.props.onEnd`. Wire **both** `onEnded` and `onEnd` to the same handler so next-episode auto-advance is robust across versions.
5. **Seeking:** `seek` is applied via the component **ref method** `ref.seek(fraction)` (fraction 0..1). Resume therefore seeks after duration is known (first `onPlaying`).
6. **Track discovery is best-effort.** Audio/subtitle track lists arrive via `onLoad` (`{ audioTracks:[{id,name}], textTracks:[{id,name}] }`) which may be version-dependent; passing the prop is harmless if unsupported. The track-selection UI is gated on discovery — if no tracks surface, the buttons simply don't render (no crash, no placeholder).

## File Structure

**New pure modules (unit-tested with `node:test`):**
- `src/playback/nativeEngine.js` — `containerExtension`, `needsVlcEngine`, `UNSUPPORTED_IOS_CONTAINERS`.
- `src/playback/nativeEngine.test.js`
- `src/playback/drivers/vlcInitOptions.js` — pure libVLC-options formatter.
- `src/playback/drivers/vlcInitOptions.test.js`
- `src/playback/drivers/vlcDriver.js` — `createVlcDriver(handle)` + `classifyVlcError`.
- `src/playback/drivers/vlcDriver.test.js`

**New screen:**
- `src/screens/VlcPlayerScreen.native.jsx` — libVLC host, reduced control set.

**Moved / rewritten:**
- `src/screens/VideoPlayerScreen.native.jsx` → `src/screens/ExpoVideoPlayerScreen.native.jsx` (verbatim body; function renamed).
- `src/screens/VideoPlayerScreen.native.jsx` — new thin dispatcher.

**Config (modified):**
- `package.json` — add `react-native-vlc-media-player`.
- `app.json` — add `"react-native-vlc-media-player"` to `expo.plugins`.

---

## Task 1: `nativeEngine` — pure routing decision

**Files:**
- Create: `src/playback/nativeEngine.js`
- Test: `src/playback/nativeEngine.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `UNSUPPORTED_IOS_CONTAINERS: Set<string>`
  - `containerExtension(uri: string): string` — lowercased extension after the last `.`, query/hash stripped; `''` when none.
  - `needsVlcEngine(uri: string, platform: string): boolean` — `true` only when `platform === 'ios'` **and** the extension is in `UNSUPPORTED_IOS_CONTAINERS`.

- [ ] **Step 1: Write the failing test**

Create `src/playback/nativeEngine.test.js`:

```js
// @ts-check
import test from 'node:test';
import assert from 'node:assert';
import { containerExtension, needsVlcEngine, UNSUPPORTED_IOS_CONTAINERS } from './nativeEngine.js';

test('containerExtension: basic and edge cases', () => {
  assert.equal(containerExtension('http://h/series/1/2/401998.mkv'), 'mkv');
  assert.equal(containerExtension('http://h/a.MKV'), 'mkv'); // lowercased
  assert.equal(containerExtension('http://h/a.mkv?token=abc'), 'mkv'); // query stripped
  assert.equal(containerExtension('http://h/a.mkv#frag'), 'mkv'); // hash stripped
  assert.equal(containerExtension('file:///var/media/x.avi'), 'avi'); // local file
  assert.equal(containerExtension('http://h/noext'), ''); // no extension
  assert.equal(containerExtension('http://h/dir.with.dots/name'), ''); // dot in path, not filename
  assert.equal(containerExtension(''), '');
  assert.equal(containerExtension(null), '');
});

test('needsVlcEngine: iOS unsupported containers only', () => {
  for (const ext of ['mkv', 'avi', 'flv', 'wmv', 'webm']) {
    assert.equal(needsVlcEngine(`http://h/x.${ext}`, 'ios'), true, `${ext} on ios`);
  }
  assert.equal(needsVlcEngine('http://h/x.mp4', 'ios'), false);
  assert.equal(needsVlcEngine('http://h/x.m3u8', 'ios'), false);
  assert.equal(needsVlcEngine('http://h/x.mov', 'ios'), false);
});

test('needsVlcEngine: never routes off iOS', () => {
  assert.equal(needsVlcEngine('http://h/x.mkv', 'android'), false);
  assert.equal(needsVlcEngine('http://h/x.mkv', 'web'), false);
  assert.equal(needsVlcEngine('file:///x.mkv', 'ios'), true); // local mkv still routes on ios
});

test('UNSUPPORTED_IOS_CONTAINERS is the agreed set', () => {
  assert.deepEqual([...UNSUPPORTED_IOS_CONTAINERS].sort(), ['avi', 'flv', 'mkv', 'webm', 'wmv']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/playback/nativeEngine.test.js`
Expected: FAIL — `Cannot find module './nativeEngine.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/playback/nativeEngine.js`:

```js
// @ts-check
/**
 * PURE: decide which native engine plays a given source.
 *
 * iOS AVFoundation/AVPlayer cannot demux the Matroska (mkv) container — nor
 * avi/flv/wmv/webm — and answers with "Cannot Open". expo-video (AVPlayer) is
 * fine for mp4/HLS. These containers are routed to a libVLC-backed player
 * instead. Routing is extension-based so it works for both remote
 * `http(s)://…/id.mkv` and downloaded `file://…/id.mkv`.
 */

/** Containers iOS/AVPlayer cannot demux; routed to the VLC engine. */
const UNSUPPORTED_IOS_CONTAINERS = new Set(['mkv', 'avi', 'flv', 'wmv', 'webm']);

/**
 * Lowercased file extension of a URL/path: the text after the LAST '.', with any
 * query string or hash removed first. '' when there is no extension in the final
 * path segment.
 *
 * @param {string|null|undefined} uri
 * @returns {string}
 */
function containerExtension(uri) {
  if (typeof uri !== 'string' || !uri) return '';
  // Strip query/hash, then take the final path segment.
  const clean = uri.split('#')[0].split('?')[0];
  const seg = clean.slice(clean.lastIndexOf('/') + 1);
  const dot = seg.lastIndexOf('.');
  if (dot <= 0 || dot === seg.length - 1) return ''; // no dot, leading dot, or trailing dot
  return seg.slice(dot + 1).toLowerCase();
}

/**
 * Whether `uri` must use the VLC engine on the given platform. True only on iOS
 * for a container AVPlayer can't demux.
 *
 * @param {string} uri
 * @param {string} platform - Platform.OS ('ios'|'android'|'web').
 * @returns {boolean}
 */
function needsVlcEngine(uri, platform) {
  if (platform !== 'ios') return false;
  return UNSUPPORTED_IOS_CONTAINERS.has(containerExtension(uri));
}

export { UNSUPPORTED_IOS_CONTAINERS, containerExtension, needsVlcEngine };
```

> **Module format:** this repo is ESM — every `src/playback` module uses `export` and every test uses `import` (confirmed: `episodeNav.test.js`, `drivers/*.test.js`). All new files in this plan use ESM, never `require`/`module.exports`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/playback/nativeEngine.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/playback/nativeEngine.js src/playback/nativeEngine.test.js
git commit -m "feat(playback): add nativeEngine routing (iOS mkv/avi/flv/wmv/webm → VLC)"
```

---

## Task 2: `vlcInitOptions` — pure libVLC options formatter

**Files:**
- Create: `src/playback/drivers/vlcInitOptions.js`
- Test: `src/playback/drivers/vlcInitOptions.test.js`

**Interfaces:**
- Consumes: nothing (stays pure — caller supplies the values).
- Produces: `vlcInitOptions({ userAgent?: string, referer?: string }): string[]` — array of libVLC per-input option strings; omits any option whose value is falsy.

- [ ] **Step 1: Write the failing test**

Create `src/playback/drivers/vlcInitOptions.test.js`:

```js
// @ts-check
import test from 'node:test';
import assert from 'node:assert';
import { vlcInitOptions } from './vlcInitOptions.js';

test('both userAgent and referer', () => {
  assert.deepEqual(
    vlcInitOptions({ userAgent: 'UA/1.0', referer: 'http://h/' }),
    [':http-user-agent=UA/1.0', ':http-referrer=http://h/'],
  );
});

test('userAgent only', () => {
  assert.deepEqual(vlcInitOptions({ userAgent: 'UA/1.0' }), [':http-user-agent=UA/1.0']);
});

test('referer only', () => {
  assert.deepEqual(vlcInitOptions({ referer: 'http://h/' }), [':http-referrer=http://h/']);
});

test('neither → empty array', () => {
  assert.deepEqual(vlcInitOptions({}), []);
  assert.deepEqual(vlcInitOptions(), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/playback/drivers/vlcInitOptions.test.js`
Expected: FAIL — `Cannot find module './vlcInitOptions.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/playback/drivers/vlcInitOptions.js`:

```js
// @ts-check
/**
 * PURE: build the libVLC per-input option array that carries the same
 * UA/Referer headers the expo-video driver sends. Many IPTV/Xtream servers
 * whitelist by User-Agent and expect a Referer; without these the stream 404s.
 *
 * libVLC reads these as media-input options: `:http-user-agent=` and
 * `:http-referrer=` (note libVLC's historical "referrer" spelling). They are
 * placed on the VLC source object's `initOptions` array.
 *
 * @param {{ userAgent?: string, referer?: string }} [headers]
 * @returns {string[]}
 */
function vlcInitOptions(headers = {}) {
  const opts = [];
  if (headers.userAgent) opts.push(`:http-user-agent=${headers.userAgent}`);
  if (headers.referer) opts.push(`:http-referrer=${headers.referer}`);
  return opts;
}

export { vlcInitOptions };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/playback/drivers/vlcInitOptions.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/playback/drivers/vlcInitOptions.js src/playback/drivers/vlcInitOptions.test.js
git commit -m "feat(playback): add vlcInitOptions (libVLC UA/Referer input options)"
```

---

## Task 3: `vlcDriver` + `classifyVlcError`

**Files:**
- Create: `src/playback/drivers/vlcDriver.js`
- Test: `src/playback/drivers/vlcDriver.test.js`

**Interfaces:**
- Consumes:
  - `vlcInitOptions` (Task 2).
  - `STREAM_USER_AGENT: string`, `refererForUri(uri: string): string|undefined` — from `src/playback/drivers/expoVideoDriver.js`.
  - `PlayerDriver` / `NormalizedError` typedefs from `./types.js`.
- Produces:
  - `createVlcDriver(handle) => { driver: PlayerDriver, ingest }` where
    - `handle = { setSource(srcOrNull), setPaused(bool), seek(fraction) }` — host state bridges.
    - `ingest = { progress(nativeEvent), playing(nativeEvent), paused(), stopped(), error(nativeEvent) }` — the host calls these from `<VLCPlayer>` callbacks.
  - `classifyVlcError(event) => NormalizedError`.

**Design notes (read before implementing):**
- The `driver` satisfies the `PlayerDriver` contract in `types.js`: `load/play/pause/destroy/currentTime/duration/buffered/isLive/setQualityCap/onStatus/onProgress/onStall/onError`.
- `load` builds the VLC source `{ uri, initOptions }` (UA + Referer via `vlcInitOptions`) and pushes it through `handle.setSource`. It records the VOD `startTime` and seeks once, on the first `playing` event (duration is known then).
- `currentTime()`/`duration()` return **seconds** (converted from the ms `ingest.progress`/`ingest.playing` payloads).
- `onStall` runs a `setInterval` watchdog over the last-known position — identical technique to `expoVideoDriver` (any movement in either direction resets it; only flat-while-playing for the threshold fires).
- `buffered()` → `0` (VLC RN exposes no reliable buffered-ahead). `isLive()` → `false`. `setQualityCap` → no-op.

- [ ] **Step 1: Write the failing test**

Create `src/playback/drivers/vlcDriver.test.js`:

```js
// @ts-check
import test from 'node:test';
import assert from 'node:assert';
import { createVlcDriver, classifyVlcError } from './vlcDriver.js';
import { STREAM_USER_AGENT } from './expoVideoDriver.js';

function makeHandle() {
  const calls = { source: [], paused: [], seek: [] };
  return {
    calls,
    setSource: (s) => calls.source.push(s),
    setPaused: (p) => calls.paused.push(p),
    seek: (f) => calls.seek.push(f),
  };
}

test('load builds a VLC source with UA + Referer init options and starts playing', () => {
  const h = makeHandle();
  const { driver } = createVlcDriver(h);
  driver.load({ uri: 'http://mvo25.in/series/u/p/401998.mkv' }, { isLive: false, startTime: 0 });
  const src = h.calls.source.at(-1);
  assert.equal(src.uri, 'http://mvo25.in/series/u/p/401998.mkv');
  assert.ok(src.initOptions.includes(`:http-user-agent=${STREAM_USER_AGENT}`));
  assert.ok(src.initOptions.includes(':http-referrer=http://mvo25.in/'));
  assert.equal(h.calls.paused.at(-1), false); // load → play
});

test('progress converts ms → s for currentTime/duration and fans out to onProgress', () => {
  const h = makeHandle();
  const { driver, ingest } = createVlcDriver(h);
  const seen = [];
  driver.onProgress((t) => seen.push(t));
  ingest.progress({ currentTime: 30154, duration: 99750, position: 0.302 });
  assert.equal(driver.currentTime(), 30.154);
  assert.equal(driver.duration(), 99.75);
  assert.equal(seen.at(-1), 30.154);
});

test('resume: seeks to startTime fraction on first playing event', () => {
  const h = makeHandle();
  const { driver, ingest } = createVlcDriver(h);
  driver.load({ uri: 'http://h/x.mkv' }, { isLive: false, startTime: 60 });
  // duration 120s → fraction 0.5
  ingest.playing({ target: 1, duration: 120000, seekable: true });
  assert.equal(h.calls.seek.at(-1), 0.5);
  // second playing must NOT re-seek
  ingest.playing({ target: 1, duration: 120000, seekable: true });
  assert.equal(h.calls.seek.length, 1);
});

test('load with startTime 0 does not seek', () => {
  const h = makeHandle();
  const { driver, ingest } = createVlcDriver(h);
  driver.load({ uri: 'http://h/x.mkv' }, { isLive: false, startTime: 0 });
  ingest.playing({ target: 1, duration: 120000, seekable: true });
  assert.equal(h.calls.seek.length, 0);
});

test('play/pause flip the paused prop; destroy clears the source', () => {
  const h = makeHandle();
  const { driver } = createVlcDriver(h);
  driver.pause();
  assert.equal(h.calls.paused.at(-1), true);
  driver.play();
  assert.equal(h.calls.paused.at(-1), false);
  driver.destroy();
  assert.equal(h.calls.source.at(-1), null);
});

test('onError classifies via classifyVlcError', () => {
  const h = makeHandle();
  const { driver, ingest } = createVlcDriver(h);
  const errs = [];
  driver.onError((e) => errs.push(e));
  ingest.error({ message: 'generic failure' });
  assert.equal(errs.at(-1).kind, 'media');
  assert.equal(errs.at(-1).fatal, true);
});

test('contract getters have safe defaults before any event', () => {
  const { driver } = createVlcDriver(makeHandle());
  assert.equal(driver.currentTime(), 0);
  assert.ok(Number.isNaN(driver.duration()));
  assert.equal(driver.buffered(), 0);
  assert.equal(driver.isLive(), false);
  assert.doesNotThrow(() => driver.setQualityCap('1080'));
});

test('classifyVlcError: generic → media/fatal; offline message → offline', () => {
  const g = classifyVlcError({ message: 'could not open' });
  assert.equal(g.kind, 'media');
  assert.equal(g.type, 'mediaError');
  assert.equal(g.fatal, true);

  const off = classifyVlcError({ message: 'Network is unreachable' });
  assert.equal(off.offline, true);
  assert.equal(off.kind, 'offline');
});

test('subscriptions return unsubscribe functions', () => {
  const { driver } = createVlcDriver(makeHandle());
  for (const sub of [driver.onStatus, driver.onProgress, driver.onStall, driver.onError]) {
    const un = sub(() => {});
    assert.equal(typeof un, 'function');
    assert.doesNotThrow(() => un());
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/playback/drivers/vlcDriver.test.js`
Expected: FAIL — `Cannot find module './vlcDriver.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/playback/drivers/vlcDriver.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/playback/drivers/vlcDriver.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Run the full pure-module suite + lint**

Run: `node --test src/playback/nativeEngine.test.js src/playback/drivers/vlcInitOptions.test.js src/playback/drivers/vlcDriver.test.js && npm run lint`
Expected: all PASS; lint reports no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/playback/drivers/vlcDriver.js src/playback/drivers/vlcDriver.test.js
git commit -m "feat(playback): add vlcDriver + classifyVlcError behind PlayerDriver contract"
```

---

## Task 4: Add the VLC library + build `VlcPlayerScreen`

**Files:**
- Modify: `package.json` (add dependency)
- Modify: `app.json` (add config plugin)
- Create: `src/screens/VlcPlayerScreen.native.jsx`

**Interfaces:**
- Consumes: `createVlcDriver` (Task 3), `useResilientPlayback`, `useResumePosition`, `usePlayerPreferences`, `useWatchHistory`/`usePlayback` (AppContext), `findNextEpisode`/`buildNextEpisodeVideo` (`episodeNav`), `contentService.buildEpisodeUrl`, `useDeviceIntegrity`, `ResumePrompt`, UI primitives/tokens/`Icon`/`Button`/`StatePanel`, `VLCPlayer` from `react-native-vlc-media-player`.
- Produces: `export default function VlcPlayerScreen({ navigation })` — a self-contained VOD player for the VLC path.

- [ ] **Step 1: Install the dependency**

Run: `npm install react-native-vlc-media-player@^1.0.98`
Expected: `package.json` + `package-lock.json` gain the dependency, install succeeds.

- [ ] **Step 2: Register the Expo config plugin**

Edit `app.json` — add the plugin string to `expo.plugins` (keep existing entries):

```json
    "plugins": [
      "expo-video",
      "expo-font",
      "@kesha-antonov/react-native-background-downloader",
      "react-native-vlc-media-player"
    ],
```

- [ ] **Step 3: Create the screen**

Create `src/screens/VlcPlayerScreen.native.jsx`:

```jsx
import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { StatusBar, Platform, TouchableOpacity, AppState, Modal, View } from "react-native";
import { VLCPlayer } from "react-native-vlc-media-player";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import * as ScreenOrientation from "expo-screen-orientation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { YStack, XStack, Text, ScrollView, Spinner } from "../ui/primitives";
import { colors, accentAlpha, fonts } from "../ui/tokens";
import Icon from "../ui/Icon";
import Button from "../ui/Button";
import StatePanel from "../ui/StatePanel";
import { usePlayback, useWatchHistory } from "../context/AppContext";
import { contentService } from "../domain/services/ContentService";
import { createVlcDriver } from "../playback/drivers/vlcDriver";
import { findNextEpisode, buildNextEpisodeVideo } from "../playback/episodeNav";
import { useResilientPlayback } from "../playback/useResilientPlayback";
import { useResumePosition } from "../playback/useResumePosition";
import { usePlayerPreferences } from "../playback/usePlayerPreferences";
import { useDeviceIntegrity } from "../security/useDeviceIntegrity";
import ResumePrompt from "../playback/components/ResumePrompt";
import { formatDuration as formatTime } from "../utils/formatDuration";

const MODAL_ORIENTATIONS = ["portrait", "landscape"];
// VLCPlayer resizeMode values; cycled by the aspect button.
const RESIZE_MODES = ["contain", "cover", "fill"];

export default function VlcPlayerScreen({ navigation }) {
  const { currentVideo, closeVideo, playVideo } = usePlayback();
  const { updateWatchProgress, addToWatchHistory, flushProgress } = useWatchHistory();
  const insets = useSafeAreaInsets();
  const progressIntervalRef = useRef(null);
  const hasAddedToHistory = useRef(false);
  const controlsTimerRef = useRef(null);

  const [showControls, setShowControls] = useState(true);
  const [resizeMode, setResizeMode] = useState("contain");
  const [audioTracks, setAudioTracks] = useState([]);
  const [textTracks, setTextTracks] = useState([]);
  const [selectedAudio, setSelectedAudio] = useState(null);
  const [selectedText, setSelectedText] = useState(-1); // -1 = subtitles off
  const [showAudioMenu, setShowAudioMenu] = useState(false);
  const [showTextMenu, setShowTextMenu] = useState(false);

  // VOD seek bar: fraction (0..1) + seconds, from onProgress.
  const [progress, setProgress] = useState({ position: 0, currentTimeSec: 0, durationSec: 0 });
  const [scrubFrac, setScrubFrac] = useState(null);
  const seekTrackWidth = useRef(0);

  const streamKey = currentVideo ? `${currentVideo.type}_${currentVideo.streamId}` : null;
  const { prefs, loaded: prefsLoaded, setPref } = usePlayerPreferences(streamKey);
  const prefsAppliedRef = useRef(false);

  const resume = useResumePosition(currentVideo);
  const needsResumeChoice = resume.hasResume && !resume.decided;
  const [resolvedStart, setResolvedStart] = useState(0);

  // ── VLC host state driven by the driver via `handle` ──
  const vlcRef = useRef(null);
  const [vlcSource, setVlcSource] = useState(null);
  const [paused, setPaused] = useState(false);

  const handle = useMemo(
    () => ({
      setSource: (s) => setVlcSource(s),
      setPaused: (p) => setPaused(p),
      seek: (frac) => {
        try {
          vlcRef.current?.seek?.(frac);
        } catch {
          /* noop */
        }
      },
    }),
    [],
  );
  const { driver, ingest } = useMemo(() => createVlcDriver(handle), [handle]);

  const playback = useResilientPlayback({
    driver,
    source: currentVideo && !needsResumeChoice ? { uri: currentVideo.url } : null,
    isLive: false,
    startTime: resolvedStart || currentVideo?.startTime || 0,
    refreshCredentials: () => {},
  });

  const isLoading = playback.status === "idle" || playback.status === "loading";
  const isRecovering = playback.isRecovering;
  const isFatal = playback.isFatal;

  // Refs mirroring latest progress for lifecycle writes.
  const progressRef = useRef(progress);
  progressRef.current = progress;

  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => setShowControls(false), 4000);
  }, []);
  useEffect(() => {
    resetControlsTimer();
    return () => clearTimeout(controlsTimerRef.current);
  }, [resetControlsTimer]);

  // Keep awake + lock portrait (mirrors the expo screen).
  useEffect(() => {
    activateKeepAwakeAsync().catch(() => {});
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    return () => {
      try {
        deactivateKeepAwake();
      } catch {
        /* noop */
      }
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, []);

  // Reset per-stream state when the URL changes.
  useEffect(() => {
    hasAddedToHistory.current = false;
    prefsAppliedRef.current = false;
    setAudioTracks([]);
    setTextTracks([]);
    setSelectedAudio(null);
    setSelectedText(-1);
    setResolvedStart(0);
    setProgress({ position: 0, currentTimeSec: 0, durationSec: 0 });
  }, [currentVideo?.url]);

  // Apply remembered aspect once prefs load.
  useEffect(() => {
    if (!prefsLoaded || prefsAppliedRef.current) return;
    if (prefs.aspectRatio && RESIZE_MODES.includes(prefs.aspectRatio)) setResizeMode(prefs.aspectRatio);
    prefsAppliedRef.current = true;
  }, [prefsLoaded, prefs.aspectRatio]);

  // Add to history once per stream (VOD).
  useEffect(() => {
    if (!currentVideo || hasAddedToHistory.current) return;
    if (currentVideo.type !== "live") {
      hasAddedToHistory.current = true;
      addToWatchHistory({ ...currentVideo, currentTime: currentVideo.startTime || 0 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentVideo?.url]);

  // Periodic progress recording (every 10s) — mirrors the expo path cadence.
  useEffect(() => {
    if (!currentVideo || currentVideo.type === "live") return undefined;
    clearInterval(progressIntervalRef.current);
    progressIntervalRef.current = setInterval(() => {
      const p = progressRef.current;
      updateWatchProgress(currentVideo.streamId, currentVideo.type, p.currentTimeSec, p.durationSec || 0);
    }, 10000);
    return () => clearInterval(progressIntervalRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentVideo?.url, updateWatchProgress]);

  // Flush progress + pause on background.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "background" && state !== "inactive") return;
      const p = progressRef.current;
      if (currentVideo && currentVideo.type !== "live") {
        updateWatchProgress(currentVideo.streamId, currentVideo.type, p.currentTimeSec, p.durationSec || 0);
      }
      flushProgress();
      if (state === "background") setPaused(true);
    });
    return () => sub.remove();
  }, [currentVideo, updateWatchProgress, flushProgress]);

  // Next-episode helpers.
  const getNextEpisode = useCallback(() => findNextEpisode(currentVideo), [currentVideo]);
  const handleNextEpisode = useCallback(() => {
    const video = buildNextEpisodeVideo(getNextEpisode(), currentVideo, (id, ext) =>
      contentService.buildEpisodeUrl(id, ext),
    );
    if (video) playVideo(video);
  }, [getNextEpisode, currentVideo, playVideo]);

  const handleEnded = useCallback(() => {
    if (currentVideo?.type === "series" && getNextEpisode()) handleNextEpisode();
  }, [currentVideo, getNextEpisode, handleNextEpisode]);

  const handleClose = useCallback(() => {
    const p = progressRef.current;
    if (currentVideo && currentVideo.type !== "live") {
      updateWatchProgress(currentVideo.streamId, currentVideo.type, p.currentTimeSec, p.durationSec || 0);
    }
    flushProgress();
    clearInterval(progressIntervalRef.current);
    // closeVideo() nulls currentVideo; the dispatcher owns popping the route.
    closeVideo();
  }, [currentVideo, updateWatchProgress, flushProgress, closeVideo]);

  // Resume choice.
  const handleResume = useCallback(() => {
    setResolvedStart(resume.decide("resume"));
  }, [resume]);
  const handleStartOver = useCallback(() => {
    resume.decide("startOver");
    setResolvedStart(0);
  }, [resume]);

  const cycleResizeMode = useCallback(() => {
    setResizeMode((cur) => {
      const next = RESIZE_MODES[(RESIZE_MODES.indexOf(cur) + 1) % RESIZE_MODES.length];
      setPref("aspectRatio", next);
      return next;
    });
  }, [setPref]);

  const handleAudioChange = (track) => {
    setSelectedAudio(track ? track.id : null);
    setShowAudioMenu(false);
  };
  const handleTextChange = (id) => {
    setSelectedText(id);
    setShowTextMenu(false);
  };

  // Seek-bar scrub (fraction of duration).
  const scrubToX = useCallback((x) => {
    const w = seekTrackWidth.current;
    if (!w) return;
    setScrubFrac(Math.max(0, Math.min(1, x / w)));
    resetControlsTimer();
  }, [resetControlsTimer]);
  const commitScrub = useCallback(() => {
    setScrubFrac((frac) => {
      if (frac != null) {
        try {
          vlcRef.current?.seek?.(frac);
        } catch {
          /* noop */
        }
      }
      return null;
    });
    resetControlsTimer();
  }, [resetControlsTimer]);

  const deviceCompromised = useDeviceIntegrity();

  if (!currentVideo) return null;

  if (deviceCompromised) {
    return (
      <YStack flex={1} backgroundColor="#000" alignItems="center" justifyContent="center" padding={24} gap={16}>
        <Icon name="warning" size={40} color={colors.danger} />
        <Text color={colors.danger} fontSize={20} fontWeight="700" textAlign="center">Playback blocked</Text>
        <Text color={colors.muted} fontSize={14} textAlign="center">
          This device appears to be jailbroken or rooted. Streaming is disabled for security.
        </Text>
        <Button variant="primary" size="lg" onPress={closeVideo}>Go back</Button>
      </YStack>
    );
  }

  const nextEpisode = getNextEpisode();
  const topPadding = Platform.OS === "ios" ? 12 : 8;
  const shownFrac = scrubFrac != null ? scrubFrac : progress.position;
  const playedPct = Math.max(0, Math.min(100, shownFrac * 100));

  return (
    <YStack flex={1} backgroundColor="#000">
      <StatusBar hidden />

      <View style={{ position: "absolute", top: insets.top, left: 0, right: 0, bottom: insets.bottom }}>
        {vlcSource && (
          <VLCPlayer
            ref={vlcRef}
            style={{ flex: 1 }}
            source={vlcSource}
            paused={paused}
            resizeMode={resizeMode}
            audioTrack={selectedAudio ?? undefined}
            textTrack={selectedText}
            onProgress={(e) => {
              ingest.progress(e);
              setProgress({
                position: typeof e?.position === "number" ? e.position : 0,
                currentTimeSec: (e?.currentTime || 0) / 1000,
                durationSec: (e?.duration || 0) / 1000,
              });
            }}
            onPlaying={(e) => ingest.playing(e)}
            onPaused={() => ingest.paused()}
            onStopped={() => ingest.stopped()}
            onError={(e) => ingest.error(e)}
            onEnded={handleEnded}
            onEnd={handleEnded}
            onLoad={(e) => {
              // Best-effort track discovery; absent on some versions (safe no-op).
              if (Array.isArray(e?.audioTracks)) setAudioTracks(e.audioTracks);
              if (Array.isArray(e?.textTracks)) setTextTracks(e.textTracks);
            }}
          />
        )}
      </View>

      {/* Tap surface toggles controls. */}
      <TouchableOpacity
        activeOpacity={1}
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        onPress={resetControlsTimer}
      />

      <ResumePrompt
        visible={needsResumeChoice}
        resumeTime={resume.resumeTime}
        percent={resume.percent}
        onResume={handleResume}
        onStartOver={handleStartOver}
      />

      {(isLoading || isRecovering) && !isFatal && !needsResumeChoice && (
        <YStack position="absolute" top={0} left={0} right={0} bottom={0} justifyContent="center" alignItems="center" gap={16} backgroundColor="rgba(0,0,0,0.35)" pointerEvents="none" zIndex={35}>
          <Spinner size="large" color={colors.accent} />
          <Text color={colors.text} fontFamily={fonts.body} fontSize={16} fontWeight="600">
            {isRecovering ? "Reconnecting…" : "Loading…"}
          </Text>
        </YStack>
      )}

      {isFatal && (
        <YStack position="absolute" top={0} left={0} right={0} bottom={0} backgroundColor="rgba(0,0,0,0.85)" zIndex={40}>
          <StatePanel
            mode="error"
            title="Failed to load stream"
            message={
              playback.fatalReason === "GONE"
                ? "This stream is no longer available."
                : "The stream could not be played."
            }
            onRetry={() => playback.retry()}
          />
          <XStack justifyContent="center" paddingBottom={32}>
            <Button variant="secondary" size="md" icon="close" onPress={handleClose}>Close</Button>
          </XStack>
        </YStack>
      )}

      {showControls && (
        <YStack position="absolute" top={0} left={0} right={0} paddingTop={insets.top + topPadding} pointerEvents="box-none">
          <XStack alignItems="center" paddingHorizontal={12} paddingVertical={8} backgroundColor="rgba(0,0,0,0.7)" gap={8} flexWrap="wrap">
            <YStack width={34} height={34} backgroundColor={accentAlpha(0.9)} borderRadius={17} justifyContent="center" alignItems="center" cursor="pointer" onPress={handleClose} pressStyle={{ opacity: 0.8 }}>
              <Icon name="close" size={16} color={colors.text} />
            </YStack>
            <Text color={colors.text} fontFamily={fonts.display} fontSize={14} fontWeight="600" flex={1} minWidth={60} numberOfLines={1}>{currentVideo.name}</Text>
            {nextEpisode && <Button variant="primary" size="sm" icon="play" onPress={handleNextEpisode}>Next</Button>}
          </XStack>
        </YStack>
      )}

      {showControls && (
        <YStack position="absolute" bottom={0} left={0} right={0} paddingBottom={insets.bottom + 12} backgroundColor="rgba(0,0,0,0.7)" zIndex={20}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8 }}>
            <Button variant="secondary" size="sm" icon={paused ? "play" : "pause"} onPress={() => setPaused((p) => !p)} />
            {audioTracks.length > 1 && (
              <Button variant="secondary" size="sm" icon="audio" onPress={() => { setShowAudioMenu(true); setShowTextMenu(false); }} />
            )}
            {textTracks.length > 0 && (
              <Button variant="secondary" size="sm" icon="cc" onPress={() => { setShowTextMenu(true); setShowAudioMenu(false); }} />
            )}
            <Button variant="secondary" size="sm" icon="aspect" onPress={cycleResizeMode} />
          </ScrollView>

          {progress.durationSec > 0 && (
            <YStack paddingHorizontal={16} paddingTop={4}>
              <View
                style={{ height: 26, justifyContent: "center" }}
                onLayout={(e) => { seekTrackWidth.current = e.nativeEvent.layout.width; }}
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => true}
                onResponderGrant={(e) => scrubToX(e.nativeEvent.locationX)}
                onResponderMove={(e) => scrubToX(e.nativeEvent.locationX)}
                onResponderRelease={commitScrub}
                onResponderTerminate={commitScrub}
              >
                <View style={{ height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.25)" }} />
                <View style={{ position: "absolute", left: 0, height: 4, borderRadius: 2, width: `${playedPct}%`, backgroundColor: colors.accent }} />
                <View style={{ position: "absolute", left: `${playedPct}%`, width: 14, height: 14, borderRadius: 7, marginLeft: -7, backgroundColor: colors.accent }} />
              </View>
              <XStack justifyContent="space-between" marginTop={4}>
                <Text color={colors.text} fontSize={12} fontWeight="600">{formatTime(shownFrac * progress.durationSec)}</Text>
                <Text color={colors.muted} fontSize={12}>{formatTime(progress.durationSec)}</Text>
              </XStack>
            </YStack>
          )}
        </YStack>
      )}

      {/* Audio menu */}
      <Modal visible={showAudioMenu} transparent animationType="fade" supportedOrientations={MODAL_ORIENTATIONS} onRequestClose={() => setShowAudioMenu(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center" }} activeOpacity={1} onPress={() => setShowAudioMenu(false)}>
          <YStack backgroundColor={colors.surface2} borderRadius={14} padding={8} width={240} maxHeight={360} borderWidth={1} borderColor={colors.border}>
            <Text color={colors.muted} fontSize={12} fontWeight="600" textAlign="center" paddingVertical={8} borderBottomWidth={1} borderBottomColor={colors.border} marginBottom={4}>Audio Track</Text>
            <ScrollView>
              {audioTracks.map((track) => (
                <YStack key={track.id} paddingVertical={12} paddingHorizontal={16} borderRadius={8} backgroundColor={selectedAudio === track.id ? accentAlpha(0.2) : "transparent"} cursor="pointer" onPress={() => handleAudioChange(track)} pressStyle={{ opacity: 0.7 }}>
                  <Text color={selectedAudio === track.id ? colors.accent : colors.muted} fontSize={15}>{track.name || `Track ${track.id}`}</Text>
                </YStack>
              ))}
            </ScrollView>
          </YStack>
        </TouchableOpacity>
      </Modal>

      {/* Subtitle menu */}
      <Modal visible={showTextMenu} transparent animationType="fade" supportedOrientations={MODAL_ORIENTATIONS} onRequestClose={() => setShowTextMenu(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center" }} activeOpacity={1} onPress={() => setShowTextMenu(false)}>
          <YStack backgroundColor={colors.surface2} borderRadius={14} padding={8} width={240} maxHeight={360} borderWidth={1} borderColor={colors.border}>
            <Text color={colors.muted} fontSize={12} fontWeight="600" textAlign="center" paddingVertical={8} borderBottomWidth={1} borderBottomColor={colors.border} marginBottom={4}>Subtitles</Text>
            <ScrollView>
              <YStack paddingVertical={12} paddingHorizontal={16} borderRadius={8} backgroundColor={selectedText === -1 ? accentAlpha(0.2) : "transparent"} cursor="pointer" onPress={() => handleTextChange(-1)} pressStyle={{ opacity: 0.7 }}>
                <Text color={selectedText === -1 ? colors.accent : colors.muted} fontSize={15}>Off</Text>
              </YStack>
              {textTracks.map((track) => (
                <YStack key={track.id} paddingVertical={12} paddingHorizontal={16} borderRadius={8} backgroundColor={selectedText === track.id ? accentAlpha(0.2) : "transparent"} cursor="pointer" onPress={() => handleTextChange(track.id)} pressStyle={{ opacity: 0.7 }}>
                  <Text color={selectedText === track.id ? colors.accent : colors.muted} fontSize={15}>{track.name || `Track ${track.id}`}</Text>
                </YStack>
              ))}
            </ScrollView>
          </YStack>
        </TouchableOpacity>
      </Modal>
    </YStack>
  );
}
```

- [ ] **Step 4: Lint the new screen**

Run: `npm run lint`
Expected: no new errors (react-hooks rules satisfied; the two `exhaustive-deps` disables mirror the expo screen's per-URL-reset pattern).

- [ ] **Step 5: Verify the pure suite still passes**

Run: `npm test`
Expected: PASS (RN screens aren't unit-tested under node; this confirms nothing else broke).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json app.json src/screens/VlcPlayerScreen.native.jsx
git commit -m "feat(player): add VlcPlayerScreen (libVLC VOD host for iOS mkv path)"
```

---

## Task 5: Extract `ExpoVideoPlayerScreen` + write the dispatcher

**Files:**
- Move: `src/screens/VideoPlayerScreen.native.jsx` → `src/screens/ExpoVideoPlayerScreen.native.jsx`
- Create (new): `src/screens/VideoPlayerScreen.native.jsx` (dispatcher)

**Interfaces:**
- Consumes: `needsVlcEngine` (Task 1), `VlcPlayerScreen` (Task 4), `usePlayback` (AppContext), `Platform`.
- Produces: `export default function VideoPlayerScreen({ navigation })` that renders the engine-appropriate child. `ExpoVideoPlayerScreen` is the verbatim previous body.

**Behaviour note (why a "last engine" ref):** `playVideo` reuses the same `VideoPlayer` route across episodes, so the dispatcher must re-decide when `currentVideo.url` changes (mp4↔mkv next episode). But on close, `closeVideo()` nulls `currentVideo` for one render before the route pops — decision must **not** flip engines then, or the wrong child mounts mid-teardown. So: decide from `currentVideo.url` when present; otherwise keep the last engine. Each child keeps full ownership of its own close/lifecycle (including the existing "external clear → goBack" safety net inside `ExpoVideoPlayerScreen`).

- [ ] **Step 1: Move the existing screen verbatim**

Run: `git mv src/screens/VideoPlayerScreen.native.jsx src/screens/ExpoVideoPlayerScreen.native.jsx`

- [ ] **Step 2: Rename the moved component's function**

Edit `src/screens/ExpoVideoPlayerScreen.native.jsx` — change only the export identifier:

```jsx
export default function ExpoVideoPlayerScreen({ navigation }) {
```

(from `export default function VideoPlayerScreen({ navigation }) {`). Nothing else in the file changes.

- [ ] **Step 3: Create the dispatcher**

Create `src/screens/VideoPlayerScreen.native.jsx`:

```jsx
import { useRef } from "react";
import { Platform } from "react-native";
import { usePlayback } from "../context/AppContext";
import { needsVlcEngine } from "../playback/nativeEngine";
import ExpoVideoPlayerScreen from "./ExpoVideoPlayerScreen.native.jsx";
import VlcPlayerScreen from "./VlcPlayerScreen.native.jsx";

/**
 * Native video-player dispatcher. Picks the engine by container:
 * AVPlayer-unsupported containers (mkv/avi/flv/wmv/webm) on iOS go to the VLC
 * screen; everything else uses the expo-video screen. The choice is re-made when
 * currentVideo.url changes (episode advance), but is held across the brief
 * currentVideo===null render during close so the engine doesn't flip mid-teardown.
 */
export default function VideoPlayerScreen(props) {
  const { currentVideo } = usePlayback();
  const lastUseVlcRef = useRef(false);

  const useVlc = currentVideo
    ? needsVlcEngine(currentVideo.url, Platform.OS)
    : lastUseVlcRef.current;
  lastUseVlcRef.current = useVlc;

  return useVlc ? <VlcPlayerScreen {...props} /> : <ExpoVideoPlayerScreen {...props} />;
}
```

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no new errors. (`ExpoVideoPlayerScreen` is unchanged apart from the function name; the dispatcher has no hooks-order hazard — each engine is a separate component.)

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/screens/VideoPlayerScreen.native.jsx src/screens/ExpoVideoPlayerScreen.native.jsx
git commit -m "feat(player): dispatch native player to VLC engine for unsupported iOS containers"
```

---

## Task 6: On-device verification (the New-Architecture gate)

No code; this is the acceptance gate the spec defers to the end. New Arch (Bridgeless) compatibility of the legacy `<VLCPlayer>` component is proven here.

- [ ] **Step 1: Prebuild with the VLC plugin**

Run: `npx expo prebuild -p ios --clean` then build/launch a dev build on iOS (device preferred — the arm64 Simulator + VLCKit combination is historically flaky).

- [ ] **Step 2: Verify the MKV path plays**

Play the reported `http://mvo25.in/series/…/401998.mkv` (via a series episode and via Continue Watching). Confirm it **plays** under Bridgeless — no "Cannot Open", no crash. Check the UA/Referer options took effect (no provider 404).

- [ ] **Step 3: Verify the expo path is unaffected**

Play an `.mp4` movie and an HLS/live channel. Confirm they still play via `expo-video` with the full control set (gestures, PiP, stats, sleep timer) intact.

- [ ] **Step 4: Verify VLC-path parity features**

On the MKV: resume prompt appears and resumes to the right position; watch progress updates Continue Watching; next-episode auto-advances at end-of-file; audio/subtitle menus appear when the file has multiple tracks (and are absent otherwise, with no crash).

- [ ] **Step 5: Record the outcome**

If interop fails outright, stop and report — the fallback ("format not supported on this device" message) is a separate, un-designed option. If it passes, note the result in the PR description.

---

## Task 7: Fix Android "Continue" not resuming at the saved watch time

**Independent of the VLC work** — this is a bug in the shared `expo-video` driver and can be implemented first. Both engines are unaffected by each other.

**Files:**
- Modify: `src/playback/drivers/expoVideoDriver.js` (the `statusChange` listener ~L150-162 and `load()`'s `seekAndPlay` ~L176-193)
- Test: `src/playback/drivers/expoVideoDriver.test.js` (extend — already ESM)

**Root cause:** `load()` sets `player.currentTime = startTime` immediately after `replaceAsync()` resolves. On Android/ExoPlayer a seek issued before the media item is prepared is silently dropped, so playback starts at 0. The driver re-asserts `play()` when the player reaches `readyToPlay` but never re-applies the resume seek. iOS/AVPlayer usually honours the early seek, which is why it only reproduces on Android.

**Fix:** record the resume target as `pendingSeekSec` and apply it **once** on the first `readyToPlay` (in addition to the existing best-effort early seek, which stays as a fast path). Guarded by a `resumeSeekDone` flag so a later `readyToPlay` (spurious, or after user scrubbing) never snaps back; each `load()` resets the flag, so recovery RELOADs still resume correctly.

**Interfaces:**
- Consumes: nothing new.
- Produces: no signature change — `createExpoVideoDriver(player, opts)` behaves identically except the resume seek now lands on Android.

- [ ] **Step 1: Write the failing tests**

Append to `src/playback/drivers/expoVideoDriver.test.js`:

```js
import { createExpoVideoDriver } from './expoVideoDriver.js';

// Fake expo-video player whose currentTime setter is DROPPED until the pipeline
// is ready — models Android/ExoPlayer's early-seek behaviour.
function makeResumeFakePlayer() {
  const listeners = [];
  return {
    _ready: false,
    _currentTime: 0,
    playCount: 0,
    get currentTime() {
      return this._currentTime;
    },
    set currentTime(v) {
      if (this._ready) this._currentTime = v; // dropped when not ready
    },
    play() {
      this.playCount++;
    },
    pause() {},
    replaceAsync() {
      return Promise.resolve();
    },
    addListener(evt, cb) {
      listeners.push({ evt, cb });
      return { remove() {} };
    },
    _emit(evt, payload) {
      listeners.filter((l) => l.evt === evt).forEach((l) => l.cb(payload));
    },
  };
}

test('resume seek lands on readyToPlay when the early seek was dropped (Android)', async () => {
  const player = makeResumeFakePlayer();
  const driver = createExpoVideoDriver(player);
  driver.load({ uri: 'http://h/x.mp4' }, { isLive: false, startTime: 60 });
  await Promise.resolve();
  await Promise.resolve(); // let replaceAsync().then(seekAndPlay) run
  assert.equal(player.currentTime, 0); // early seek dropped (not ready)
  player._ready = true;
  player._emit('statusChange', { status: 'readyToPlay' });
  assert.equal(player.currentTime, 60); // resume applied on ready
});

test('resume seek applies once — a later readyToPlay does not snap back', async () => {
  const player = makeResumeFakePlayer();
  player._ready = true;
  const driver = createExpoVideoDriver(player);
  driver.load({ uri: 'http://h/x.mp4' }, { isLive: false, startTime: 60 });
  await Promise.resolve();
  player._emit('statusChange', { status: 'readyToPlay' });
  assert.equal(player.currentTime, 60);
  player._currentTime = 90; // user scrubbed forward
  player._emit('statusChange', { status: 'readyToPlay' }); // spurious
  assert.equal(player.currentTime, 90); // NOT snapped back to 60
});

test('no resume seek when startTime is 0', async () => {
  const player = makeResumeFakePlayer();
  player._ready = true;
  const driver = createExpoVideoDriver(player);
  driver.load({ uri: 'http://h/x.mp4' }, { isLive: false, startTime: 0 });
  await Promise.resolve();
  player._emit('statusChange', { status: 'readyToPlay' });
  assert.equal(player.currentTime, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test src/playback/drivers/expoVideoDriver.test.js`
Expected: the first two new tests FAIL (`currentTime` stays 0 / early value) because the seek is not re-applied on `readyToPlay`.

- [ ] **Step 3: Implement the fix**

In `src/playback/drivers/expoVideoDriver.js`, replace the resume-seek state + `readyToPlay` listener. Change the declaration and listener block (currently):

```js
  let wantPlay = false;
  try {
    player?.addListener?.('statusChange', (payload) => {
      if (payload?.status === 'readyToPlay' && wantPlay) {
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
```

to:

```js
  let wantPlay = false;
  // Resume target for the current source. Applied ONCE on the first readyToPlay:
  // on Android/ExoPlayer a currentTime set right after replaceAsync resolves is
  // dropped (media not prepared yet), so the early seek in load() alone leaves
  // playback at 0. Re-applying here guarantees resume lands. resumeSeekDone is
  // reset per load() so recovery RELOADs (which pass a fresh seekTo) resume too.
  let pendingSeekSec = 0;
  let resumeSeekDone = false;
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
```

Then in `load()`, set the resume target alongside `wantPlay` and reference it from `seekAndPlay`. Change (currently):

```js
    wantPlay = true;
    // For VOD, resume at the saved position then start; live ignores startTime
    // (the engine joins at the live edge). On the async path this runs once the
    // source has loaded; on the sync fallback, immediately after replace().
    const seekAndPlay = () => {
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
    };
```

to:

```js
    wantPlay = true;
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test src/playback/drivers/expoVideoDriver.test.js`
Expected: PASS (existing tests + 3 new ones).

- [ ] **Step 5: Full suite + lint**

Run: `npm test && npm run lint`
Expected: all PASS; no new lint errors.

- [ ] **Step 6: Commit**

```bash
git add src/playback/drivers/expoVideoDriver.js src/playback/drivers/expoVideoDriver.test.js
git commit -m "fix(playback): apply VOD resume seek on readyToPlay (Android Continue starting at 0)"
```

- [ ] **Step 7: On-device Android verification**

On an Android dev build: play a movie/episode, watch >1 min, close, reopen via Continue Watching → confirm it resumes at (approximately) the saved position, not 0. Repeat with the in-player "Resume?" prompt path. Confirm iOS resume still works (no regression).

> **Separately:** the "Expo-video has failed to bind with the playback service" toast is a *different* symptom — it comes from `showNowPlayingNotification = true` without the Android foreground-service being declared in the manifest (the `expo-video` plugin is registered with no options). It does not affect resume. If it needs addressing, the fix is a one-line app.json change (`["expo-video", { "supportsBackgroundPlayback": true, "supportsPictureInPicture": true }]` + prebuild) — deferred, not in this plan.

## Self-Review (completed during authoring)

- **Spec coverage:** routing (`nativeEngine`, T1) ✓; UA/Referer init options (`vlcInitOptions`, T2) ✓; driver behind `PlayerDriver` (`vlcDriver`, T3) ✓; isolated VLC screen with reduced controls (T4) ✓; verbatim expo move + dispatcher (T5) ✓; config changes (T4) ✓; unit tests for all three pure modules ✓; on-device New-Arch gate (T6) ✓. Omitted-by-design (gestures/PiP/stats/sleep-timer) are absent from `VlcPlayerScreen` as the spec's non-goals require. **T7** (Android resume seek) is a user-requested addition outside the original spec — bundled here, independent of the VLC path.
- **Module format:** every new file and test uses ESM (`import`/`export`) matching the repo (`node --test` runs the ESM `src/playback/**/*.test.js` today). No `require`/`module.exports`.
- **Placeholder scan:** every code step contains complete code; no TBD/TODO/"add error handling".
- **Type consistency:** `handle` = `{ setSource, setPaused, seek }` and `ingest` = `{ progress, playing, paused, stopped, error }` used identically in T3 (definition + tests) and T4 (consumption). `needsVlcEngine(url, Platform.OS)` signature matches T1 and its use in T5. `createVlcDriver` returns `{ driver, ingest }` in both the test and the screen.
- **Spec deviations** (library API): documented in the "API facts pinned during planning" section — `initType` dropped, `onBuffering`/`onLoad` not relied on for status, `onEnd`+`onEnded` both wired, seek via ref, tracks best-effort. These make the plan match the real component; the spec's intent (headers, resume, history, next-episode) is preserved.
