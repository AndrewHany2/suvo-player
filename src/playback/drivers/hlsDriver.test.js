// @ts-check
/**
 * Unit tests for the hls.js driver's pure-ish logic: quality-cap mapping onto
 * hls.js level controls, error normalization into NormalizedError, live-edge
 * seeking, and track get/set. Uses lightweight fakes for the <video> element and
 * the hls.js instance so no real engine/DOM is needed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import Hls from 'hls.js';
import { createHlsDriver, createHlsInstance } from './hlsDriver.js';

/** A minimal fake <video> element. */
function fakeVideo(overrides = {}) {
  const listeners = {};
  return {
    currentTime: 0,
    duration: NaN,
    paused: false,
    ended: false,
    seekable: { length: 0, end: () => 0 },
    buffered: { length: 0, end: () => 0 },
    error: null,
    play: () => Promise.resolve(),
    pause: () => {},
    src: '',
    addEventListener: (ev, cb) => {
      (listeners[ev] ||= []).push(cb);
    },
    removeEventListener: (ev, cb) => {
      listeners[ev] = (listeners[ev] || []).filter((f) => f !== cb);
    },
    _emit: (ev) => (listeners[ev] || []).forEach((f) => f()),
    ...overrides,
  };
}

/** A minimal fake hls.js instance. */
function fakeHls(levels = []) {
  return {
    levels,
    currentLevel: -1,
    maxAutoLevel: -1,
    audioTracks: [],
    audioTrack: -1,
    subtitleTracks: [],
    subtitleTrack: -1,
    liveSyncPosition: undefined,
    on: () => {},
    off: () => {},
    once: () => {},
    loadSource: () => {},
    attachMedia: () => {},
  };
}

test('setQualityCap: auto clears the cap (currentLevel/maxAutoLevel = -1)', () => {
  const inst = fakeHls([
    { height: 480, bitrate: 1e6 },
    { height: 720, bitrate: 2e6 },
    { height: 1080, bitrate: 4e6 },
  ]);
  inst.currentLevel = 2;
  inst.maxAutoLevel = 1;
  const d = createHlsDriver(fakeVideo(), { getHls: () => inst });
  d.setQualityCap('auto');
  assert.equal(inst.currentLevel, -1);
  assert.equal(inst.maxAutoLevel, -1);
});

test('setQualityCap: 720 pins maxAutoLevel to the highest level <= 720p', () => {
  const inst = fakeHls([
    { height: 480, bitrate: 1e6 }, // idx 0
    { height: 720, bitrate: 2e6 }, // idx 1
    { height: 1080, bitrate: 4e6 }, // idx 2
  ]);
  const d = createHlsDriver(fakeVideo(), { getHls: () => inst });
  d.setQualityCap('720');
  assert.equal(inst.maxAutoLevel, 1, 'caps at the 720p level');
  assert.equal(inst.currentLevel, -1, 'keeps ABR enabled beneath the ceiling');
});

test('setQualityCap: data-saver pins to the lowest-bitrate level', () => {
  const inst = fakeHls([
    { height: 1080, bitrate: 4e6 }, // idx 0
    { height: 480, bitrate: 1e6 }, // idx 1 (lowest bitrate)
    { height: 720, bitrate: 2e6 }, // idx 2
  ]);
  const d = createHlsDriver(fakeVideo(), { getHls: () => inst });
  d.setQualityCap('data-saver');
  assert.equal(inst.currentLevel, 1);
});

test('onError normalizes a 404 network error to httpStatus 404 (-> GONE class)', () => {
  let bound;
  const inst = fakeHls();
  inst.on = (ev, cb) => {
    if (ev === Hls.Events.ERROR) bound = cb;
  };
  const d = createHlsDriver(fakeVideo(), { getHls: () => inst });
  let received = null;
  d.onError((e) => (received = e));
  bound({}, {
    type: Hls.ErrorTypes.NETWORK_ERROR,
    details: 'manifestLoadError',
    fatal: true,
    response: { code: 404 },
  });
  assert.ok(received);
  assert.equal(received.httpStatus, 404);
  assert.equal(received.type, Hls.ErrorTypes.NETWORK_ERROR);
});

test('onError ignores non-fatal hls errors', () => {
  let bound;
  const inst = fakeHls();
  inst.on = (ev, cb) => {
    if (ev === Hls.Events.ERROR) bound = cb;
  };
  const d = createHlsDriver(fakeVideo(), { getHls: () => inst });
  let received = null;
  d.onError((e) => (received = e));
  bound({}, { type: Hls.ErrorTypes.NETWORK_ERROR, fatal: false });
  assert.equal(received, null);
});

test('onError: media error normalizes to kind media (-> MEDIA_DECODE class)', () => {
  let bound;
  const inst = fakeHls();
  inst.on = (ev, cb) => {
    if (ev === Hls.Events.ERROR) bound = cb;
  };
  const d = createHlsDriver(fakeVideo(), { getHls: () => inst });
  let received = null;
  d.onError((e) => (received = e));
  bound({}, { type: Hls.ErrorTypes.MEDIA_ERROR, details: 'bufferAppendError', fatal: true });
  assert.equal(received.kind, 'media');
});

test('load(toLiveEdge) seeks the element to hls.liveSyncPosition', () => {
  const video = fakeVideo();
  const inst = fakeHls([{ height: 720, bitrate: 2e6 }]);
  inst.liveSyncPosition = 123.4;
  // Fire MANIFEST_PARSED synchronously when registered via once().
  inst.once = (ev, cb) => {
    if (ev === Hls.Events.MANIFEST_PARSED) cb();
  };
  const d = createHlsDriver(video, { getHls: () => inst });
  d.load({ uri: 'http://x/stream.m3u8' }, { isLive: true, toLiveEdge: true });
  assert.equal(video.currentTime, 123.4);
});

test('load(VOD) seeks the element to startTime', () => {
  const video = fakeVideo();
  const inst = fakeHls([{ height: 720, bitrate: 2e6 }]);
  inst.once = (ev, cb) => {
    if (ev === Hls.Events.MANIFEST_PARSED) cb();
  };
  const d = createHlsDriver(video, { getHls: () => inst });
  d.load({ uri: 'http://x/movie.m3u8' }, { isLive: false, startTime: 42 });
  assert.equal(video.currentTime, 42);
});

// ── fast-first-frame config ──────────────────────────────────────────────────
for (const isTV of [false, true]) {
  test(`createHlsInstance: fast-start config present (isTV=${isTV})`, () => {
    const h = createHlsInstance({ isTV });
    try {
      assert.equal(h.config.startLevel, 0, 'starts at the lowest rendition');
      assert.equal(h.config.testBandwidth, false, 'skips the startup bandwidth probe');
      assert.equal(h.config.startFragPrefetch, true, 'prefetches the first fragment');
      // Manifest fast-fail is tightened; the per-fragment load budget must stay
      // at the hls.js default so slow-but-live mid-playback fragments survive.
      assert.ok(h.config.manifestLoadPolicy.default.maxLoadTimeMs <= 10000, 'manifest fast-fail');
      assert.ok(
        h.config.fragLoadPolicy.default.maxLoadTimeMs >= 60000,
        'fragment load budget left at the safe default (not shortened)',
      );
    } finally {
      h.destroy();
    }
  });
}

// ── stall watchdog first-frame gate ──────────────────────────────────────────
// load() calls play() immediately, so `paused` is false while the manifest +
// first segment are still downloading and currentTime sits at 0. The watchdog
// must NOT report that slow FIRST buffer as a stall (the recovery machine would
// read it as a mid-playback drop and reconnect, tearing down + re-buffering the
// engine). It arms only after the element's 'playing' event fires.

test('onStall: slow first buffer (flat at 0, not paused, no playing event) does NOT fire', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const video = fakeVideo({ paused: false, currentTime: 0 });
  const d = createHlsDriver(video, { getHls: () => null, stallThresholdMs: 6000 });

  let stalls = 0;
  const unsub = d.onStall(() => { stalls += 1; });

  for (let i = 0; i < 10; i += 1) t.mock.timers.tick(1000); // >6s flat at 0
  assert.equal(stalls, 0, 'a slow first buffer is not a stall');

  unsub();
  t.mock.timers.reset();
});

test('onStall: after the playing event, a genuine freeze fires exactly once', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const video = fakeVideo({ paused: false, currentTime: 0 });
  const d = createHlsDriver(video, { getHls: () => null, stallThresholdMs: 6000 });

  let stalls = 0;
  const unsub = d.onStall(() => { stalls += 1; });

  // Playback starts and advances once, then freezes.
  video._emit('playing');
  video.currentTime = 1;
  t.mock.timers.tick(1000);
  for (let i = 0; i < 8; i += 1) t.mock.timers.tick(1000); // freeze >6s
  assert.equal(stalls, 1, 'a freeze after playback started fires once');

  unsub();
  t.mock.timers.reset();
});

test('onStall: a new load() re-arms the gate so the next source is not insta-stalled', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const video = fakeVideo({ paused: false, currentTime: 0 });
  const d = createHlsDriver(video, { getHls: () => null, stallThresholdMs: 6000 });

  let stalls = 0;
  const unsub = d.onStall(() => { stalls += 1; });

  // First source starts + advances (arms the gate).
  video._emit('playing');
  video.currentTime = 5;
  t.mock.timers.tick(1000);
  // A new source loads (native path) and re-buffers at 0 while not paused.
  d.load({ uri: 'http://x/next.m3u8' });
  video.currentTime = 0;
  for (let i = 0; i < 10; i += 1) t.mock.timers.tick(1000);
  assert.equal(stalls, 0, 'the next source re-buffers without a false stall');

  unsub();
  t.mock.timers.reset();
});

