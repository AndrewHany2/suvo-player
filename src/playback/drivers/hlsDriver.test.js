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
import { createHlsDriver } from './hlsDriver.js';

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

