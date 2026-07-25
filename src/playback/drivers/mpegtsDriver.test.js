// @ts-check
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createMpegtsDriver, STALL_THRESHOLD_MS, STALL_POLL_MS } from './mpegtsDriver.js';

/** Minimal fake HTMLVideoElement with manual event dispatch + a settable clock. */
function makeFakeVideo() {
  const listeners = new Map();
  return {
    currentTime: 0,
    duration: NaN,
    paused: false,
    ended: false,
    buffered: { length: 0, end: () => 0 },
    error: null,
    addEventListener: (type, cb) => {
      const arr = listeners.get(type) || [];
      arr.push(cb);
      listeners.set(type, arr);
    },
    removeEventListener: (type, cb) => {
      listeners.set(type, (listeners.get(type) || []).filter((f) => f !== cb));
    },
    play: () => Promise.resolve(),
    pause: () => {},
    dispatch: (type) => { for (const cb of listeners.get(type) || []) cb(); },
  };
}

/** Drive setInterval-based polls without real time by stubbing the timer fns. */
function withFakeInterval(run) {
  const real = { setInterval: global.setInterval, clearInterval: global.clearInterval, now: Date.now };
  let clock = 0;
  const tasks = [];
  global.setInterval = (fn, ms) => { const t = { fn, ms, next: clock + ms }; tasks.push(t); return t; };
  global.clearInterval = (t) => { const i = tasks.indexOf(t); if (i >= 0) tasks.splice(i, 1); };
  Date.now = () => clock;
  const advance = (ms) => {
    const target = clock + ms;
    // step in poll-sized increments so each due interval fires once per period
    while (clock < target) {
      clock = Math.min(target, clock + STALL_POLL_MS);
      for (const t of tasks) { if (clock >= t.next) { t.next = clock + t.ms; t.fn(); } }
    }
  };
  try { run(advance); } finally {
    global.setInterval = real.setInterval; global.clearInterval = real.clearInterval; Date.now = real.now;
  }
}

describe('mpegtsDriver first-frame stall gate', () => {
  test('does NOT fire a stall while currentTime is flat before the first playing event', () => {
    withFakeInterval((advance) => {
      const video = makeFakeVideo();
      const driver = createMpegtsDriver(video);
      let stalls = 0;
      driver.onStall(() => { stalls += 1; });
      // Simulate a slow first buffer: play() called, not paused, currentTime pinned at 0.
      video.paused = false;
      advance(STALL_THRESHOLD_MS + 3 * STALL_POLL_MS);
      assert.equal(stalls, 0, 'slow first frame must not be read as a stall');
    });
  });

  test('DOES fire a stall once playing has started and then time freezes', () => {
    withFakeInterval((advance) => {
      const video = makeFakeVideo();
      const driver = createMpegtsDriver(video);
      let stalls = 0;
      driver.onStall(() => { stalls += 1; });
      // Playback genuinely started, clock advanced a little.
      video.dispatch('playing');
      video.currentTime = 5;
      advance(STALL_POLL_MS);
      // Now it freezes.
      advance(STALL_THRESHOLD_MS + STALL_POLL_MS);
      assert.equal(stalls, 1, 'a genuine mid-playback freeze must fire exactly once');
    });
  });
});
