// @ts-check
import test, { mock } from 'node:test';
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

test('onStall does not fire while paused (position flat because paused)', () => {
  mock.timers.enable({ apis: ['setInterval', 'Date'] });
  try {
    const h = makeHandle();
    const { driver, ingest } = createVlcDriver(h);
    let stalls = 0;
    const un = driver.onStall(() => { stalls++; });
    driver.load({ uri: 'http://h/x.mkv' }, { isLive: false, startTime: 0 });
    ingest.progress({ currentTime: 5000, duration: 100000, position: 0.05 }); // pos = 5s
    driver.pause();
    mock.timers.tick(10000); // 10s > 6s threshold, position stays flat
    assert.equal(stalls, 0);
    un();
  } finally {
    mock.timers.reset();
  }
});

test('onStall fires when position is flat while playing', () => {
  mock.timers.enable({ apis: ['setInterval', 'Date'] });
  try {
    const h = makeHandle();
    const { driver, ingest } = createVlcDriver(h);
    let stalls = 0;
    const un = driver.onStall(() => { stalls++; });
    driver.load({ uri: 'http://h/x.mkv' }, { isLive: false, startTime: 0 });
    ingest.progress({ currentTime: 5000, duration: 100000, position: 0.05 }); // playing, pos = 5s
    mock.timers.tick(1000); // absorb the one-time 0→5s position advance (resets the watchdog)
    mock.timers.tick(10000); // now flat while playing → stall
    assert.ok(stalls >= 1);
    un();
  } finally {
    mock.timers.reset();
  }
});
