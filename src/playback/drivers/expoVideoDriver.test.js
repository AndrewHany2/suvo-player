// @ts-check
/**
 * Unit tests for the expo-video driver's play-intent handling.
 *
 * Regression focus: with the player created from a NULL source (the screen
 * delegates the initial load to the driver), a single play() issued immediately
 * after replace() lands before the freshly-replaced item is ready and is
 * dropped — the source still reaches `readyToPlay`, so the loading spinner
 * hides, but the video never actually starts. The driver must re-assert play()
 * when the player reaches readyToPlay, and must NOT do so once paused.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createExpoVideoDriver,
  STALL_THRESHOLD_MS,
  STREAM_USER_AGENT,
  refererForUri,
} from './expoVideoDriver.js';

/**
 * A fake expo-video player that reproduces "play() before the item is ready is
 * dropped": play() only starts playback once a readyToPlay status has been
 * emitted. statusChange listeners are captured so the test can drive readiness.
 */
function fakePlayer() {
  const listeners = [];
  return {
    playing: false,
    _ready: false,
    currentTime: 0,
    duration: NaN,
    addListener(ev, cb) {
      if (ev === 'statusChange') listeners.push(cb);
      return { remove() {} };
    },
    replace() {
      // A new item: not ready until the engine reports readyToPlay.
      this._ready = false;
      this.playing = false;
    },
    play() {
      // The intent is only honoured once the pipeline is ready.
      if (this._ready) this.playing = true;
    },
    pause() {
      this.playing = false;
    },
    // Test helper: emit an expo-video statusChange.
    _emit(status) {
      if (status === 'readyToPlay') this._ready = true;
      listeners.forEach((cb) => cb({ status }));
    },
  };
}

test('load(): uses replaceAsync when the engine exposes it, and seeks+plays on resolve', async () => {
  const player = fakePlayer();
  let replaceAsyncCalls = 0;
  let syncReplaceCalls = 0;
  const origReplace = player.replace.bind(player);
  player.replace = () => { syncReplaceCalls += 1; origReplace(); };
  player.replaceAsync = ({ uri: _uri } = {}) => {
    replaceAsyncCalls += 1;
    player._ready = false;
    player.playing = false;
    // Resolve on a microtask; the engine reports readyToPlay separately.
    return Promise.resolve().then(() => { player._ready = true; });
  };
  const driver = createExpoVideoDriver(player);

  driver.load({ uri: 'http://example/stream.mp4' }, { isLive: false, startTime: 42 });
  // Let the replaceAsync promise (and its .then seek+play) run.
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(replaceAsyncCalls, 1, 'replaceAsync is preferred');
  assert.equal(syncReplaceCalls, 0, 'sync replace is not used when async exists');
  // seekAndPlay ran after resolve: VOD startTime applied, playback started.
  assert.equal(player.currentTime, 42, 'resumes at the saved VOD position');
  assert.equal(player.playing, true, 'starts playing once the async load resolved');
});

test('refererForUri derives scheme://host/ and ignores non-http', () => {
  assert.equal(refererForUri('http://pha.tv:8080/movie/u/p/1.mp4'), 'http://pha.tv:8080/');
  assert.equal(refererForUri('https://cdn.example.com/x/y.m3u8'), 'https://cdn.example.com/');
  assert.equal(refererForUri('file:///local'), undefined);
  assert.equal(refererForUri(''), undefined);
});

test('load(): sends the IPTV User-Agent + Referer headers (server UA/Referer gating)', () => {
  const player = fakePlayer();
  let captured = null;
  player.replace = (src) => { captured = src; };
  const driver = createExpoVideoDriver(player);

  driver.load({ uri: 'http://pha.tv:8080/movie/u/p/1.mp4' }, { isLive: false });

  assert.ok(captured?.headers, 'source carries headers');
  assert.equal(captured.headers['User-Agent'], STREAM_USER_AGENT);
  assert.equal(captured.headers.Referer, 'http://pha.tv:8080/');
  assert.equal(captured.headers['Accept-Language'], 'en-US');
});

test('load(): re-asserts play() when the source reaches readyToPlay', () => {
  const player = fakePlayer();
  const driver = createExpoVideoDriver(player);

  driver.load({ uri: 'http://example/stream.m3u8' }, { isLive: false });
  // The immediate play() was dropped — the item was not ready yet.
  assert.equal(player.playing, false);

  // Source becomes ready (spinner would hide here): playback must start.
  player._emit('readyToPlay');
  assert.equal(player.playing, true);
});

test('pause() clears the play intent so a later readyToPlay does not auto-resume', () => {
  const player = fakePlayer();
  const driver = createExpoVideoDriver(player);

  driver.load({ uri: 'http://example/stream.m3u8' }, { isLive: false });
  player._emit('readyToPlay');
  assert.equal(player.playing, true);

  driver.pause();
  assert.equal(player.playing, false);

  // A subsequent readyToPlay (e.g. a re-buffer) must not override the pause.
  player._emit('readyToPlay');
  assert.equal(player.playing, false);
});

// ── stall watchdog ───────────────────────────────────────────────────────────
//
// Regression: the "loader -> plays -> Reconnecting -> black -> plays -> ..."
// loop reported on native (both iOS and Android) for streams that play fine on
// web. Root cause: the watchdog compared `t > lastTime + 0.05`, treating
// `lastTime` as a monotonic high-water mark. A recovery RELOAD calls
// player.replace(), which can restart currentTime BELOW that mark (a fresh live
// edge / new pipeline). The watchdog then never observes `t > lastTime`, never
// resets lastAdvance, and fires a false STALL every STALL_THRESHOLD_MS even
// though the stream is genuinely advancing — an endless reconnect loop. Web
// dodged it only because its reload seeks back to the saved position, keeping
// currentTime monotonic. The watchdog must treat ANY currentTime movement (a
// backward jump from a reload/seek included) as activity, not just an advance.

/** Drive the poll interval by `seconds`, updating currentTime each 1s tick. */
function advance(t, player, from, to) {
  for (let s = from; s <= to; s += 1) {
    player.currentTime = s;
    t.mock.timers.tick(1000);
  }
}

test('onStall: a reload that resets currentTime lower must NOT fire a false stall while playback advances', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const player = fakePlayer();
  player._ready = true;
  player.playing = true;
  const driver = createExpoVideoDriver(player);

  let stalls = 0;
  const unsub = driver.onStall(() => { stalls += 1; });

  // Healthy forward playback up to 30s.
  advance(t, player, 1, 30);
  assert.equal(stalls, 0, 'no stall during healthy forward playback');

  // A recovery RELOAD (player.replace) restarts the timeline BELOW the old
  // high-water mark, then the stream plays normally again (3 -> 12s, i.e. more
  // than the 6s stall window of genuine advancing playback).
  player.currentTime = 3;
  advance(t, player, 4, 12);

  assert.equal(
    stalls,
    0,
    'a reload that reset currentTime lower must not be mistaken for a freeze',
  );

  unsub();
  t.mock.timers.reset();
});

test('onStall: still fires exactly once when currentTime truly freezes while playing', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const player = fakePlayer();
  player._ready = true;
  player.playing = true;
  const driver = createExpoVideoDriver(player);

  let stalls = 0;
  const unsub = driver.onStall(() => { stalls += 1; });

  // Establish a baseline at 10s, then freeze there past the threshold.
  player.currentTime = 10;
  t.mock.timers.tick(1000);
  const frozenTicks = Math.ceil(STALL_THRESHOLD_MS / 1000) + 1;
  for (let i = 0; i < frozenTicks; i += 1) t.mock.timers.tick(1000);

  assert.equal(stalls, 1, 'a genuine freeze while playing fires exactly one stall');

  unsub();
  t.mock.timers.reset();
});

// ── VOD resume seek (Android/ExoPlayer early-seek drop) ──────────────────────
//
// Root cause: load() sets player.currentTime = startTime right after
// replaceAsync() resolves. On Android/ExoPlayer a seek issued before the media
// item is prepared is silently dropped, so playback starts at 0. The driver
// re-asserts play() on readyToPlay but never re-applied the resume seek. The fix
// records the resume target and applies it ONCE on the first readyToPlay.

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
