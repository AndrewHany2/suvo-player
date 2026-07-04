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
import { createExpoVideoDriver } from './expoVideoDriver.js';

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
