// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveRouterDriver } from './liveRouterDriver.js';

function fakeDriver(name, calls) {
  return {
    load: (s, o) => calls.push([name, 'load', typeof s === 'string' ? s : s?.uri, !!o?.isLive]),
    play: () => calls.push([name, 'play']),
    pause: () => calls.push([name, 'pause']),
    destroy: () => calls.push([name, 'destroy']),
    currentTime: () => (name === 'hls' ? 42 : -1),
    duration: () => (name === 'hls' ? 100 : -1),
    buffered: () => (name === 'hls' ? 5 : -1),
    isLive: () => name === 'mpegts',
    setQualityCap: (c) => calls.push([name, 'cap', c]),
    onStatus: () => () => {},
    onProgress: () => () => {},
    onStall: () => () => {},
    onError: (cb) => { calls.push([name, 'onError-bound']); return () => calls.push([name, 'onError-unbound']); },
  };
}

test('non-live source always uses hls, never probes', async () => {
  const calls = [];
  let probed = false;
  const d = createLiveRouterDriver({
    hls: fakeDriver('hls', calls), mpegts: fakeDriver('mpegts', calls),
    probe: async () => { probed = true; return { engine: 'mpegts' }; },
  });
  await d.load({ uri: 'http://h/movie.mp4' }, { isLive: false });
  assert.equal(probed, false);
  assert.deepEqual(calls.filter((c) => c[1] === 'load'), [['hls', 'load', 'http://h/movie.mp4', false]]);
});

test('live raw-TS source routes to mpegts after probe', async () => {
  const calls = [];
  const d = createLiveRouterDriver({
    hls: fakeDriver('hls', calls), mpegts: fakeDriver('mpegts', calls),
    probe: async () => ({ engine: 'mpegts' }),
  });
  await d.load({ uri: 'http://h/live/1.m3u8' }, { isLive: true });
  assert.deepEqual(calls.filter((c) => c[1] === 'load'), [['mpegts', 'load', 'http://h/live/1.m3u8', true]]);
});

test('live real-HLS source stays on hls', async () => {
  const calls = [];
  const d = createLiveRouterDriver({
    hls: fakeDriver('hls', calls), mpegts: fakeDriver('mpegts', calls),
    probe: async () => ({ engine: 'hls' }),
  });
  await d.load({ uri: 'http://h/live/2.m3u8' }, { isLive: true });
  assert.deepEqual(calls.filter((c) => c[1] === 'load'), [['hls', 'load', 'http://h/live/2.m3u8', true]]);
});

test('switching engines tears down the previous one and rebinds onError', async () => {
  const calls = [];
  let engine = 'hls';
  const d = createLiveRouterDriver({
    hls: fakeDriver('hls', calls), mpegts: fakeDriver('mpegts', calls),
    probe: async () => ({ engine }),
  });
  d.onError(() => {});                                  // binds to default (hls)
  engine = 'mpegts';
  await d.load({ uri: 'http://h/live/3.m3u8' }, { isLive: true });
  assert.ok(calls.some((c) => c[0] === 'hls' && c[1] === 'destroy'), 'hls torn down on switch');
  assert.ok(calls.some((c) => c[0] === 'mpegts' && c[1] === 'onError-bound'), 'error rebound to mpegts');
});

test('engine result is cached per url (no re-probe on reload)', async () => {
  const calls = [];
  let probes = 0;
  const d = createLiveRouterDriver({
    hls: fakeDriver('hls', calls), mpegts: fakeDriver('mpegts', calls),
    probe: async () => { probes++; return { engine: 'mpegts' }; },
  });
  await d.load({ uri: 'http://h/live/4.m3u8' }, { isLive: true });
  await d.load({ uri: 'http://h/live/4.m3u8' }, { isLive: true }); // recovery reload
  assert.equal(probes, 1);
});

test('a hung probe times out, attaches hls, and is NOT cached (re-probes next load)', async () => {
  const calls = [];
  let probes = 0;
  const d = createLiveRouterDriver({
    hls: fakeDriver('hls', calls), mpegts: fakeDriver('mpegts', calls),
    // Never resolves on its own → the router's deadline must win.
    probe: () => new Promise(() => { probes++; }),
    probeTimeoutMs: 5,
  });
  await d.load({ uri: 'http://h/live/hang.m3u8' }, { isLive: true });
  assert.deepEqual(
    calls.filter((c) => c[1] === 'load'),
    [['hls', 'load', 'http://h/live/hang.m3u8', true]],
    'a timed-out probe still attaches hls',
  );
  await d.load({ uri: 'http://h/live/hang.m3u8' }, { isLive: true });
  assert.equal(probes, 2, 'the timeout verdict was not cached — the next load re-probes');
});

test('an explicit low-confidence probe result is not cached', async () => {
  const calls = [];
  let probes = 0;
  const d = createLiveRouterDriver({
    hls: fakeDriver('hls', calls), mpegts: fakeDriver('mpegts', calls),
    probe: async () => { probes++; return { engine: 'hls', confident: false }; },
  });
  await d.load({ uri: 'http://h/live/6.m3u8' }, { isLive: true });
  await d.load({ uri: 'http://h/live/6.m3u8' }, { isLive: true });
  assert.equal(probes, 2, 'low-confidence hls fallback must re-probe, not poison the cache');
});

test('element reads delegate to hls sub-driver; isLive follows active engine', async () => {
  const calls = [];
  const d = createLiveRouterDriver({
    hls: fakeDriver('hls', calls), mpegts: fakeDriver('mpegts', calls),
    probe: async () => ({ engine: 'mpegts' }),
  });
  await d.load({ uri: 'http://h/live/5.m3u8' }, { isLive: true });
  assert.equal(d.currentTime(), 42);   // hls sub-driver
  assert.equal(d.duration(), 100);
  assert.equal(d.isLive(), true);      // active = mpegts
});
