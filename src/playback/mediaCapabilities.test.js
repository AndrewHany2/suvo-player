import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  isPipSupported,
  enterPip,
  exitPip,
  isPipActive,
  isRemotePlaybackSupported,
  isCastApiPresent,
  isWebCastAvailable,
  isMediaSessionSupported,
  setMediaSessionMetadata,
  setMediaSessionHandlers,
  setMediaSessionPosition,
  isBackgroundAudioSupported,
  isChromecastAvailable,
  isAirPlayAvailable,
  isNativePipSupported,
  isNativeBackgroundAudioSupported,
  getWebCapabilities,
} from "./mediaCapabilities.js";

// node:test runs in a non-DOM environment: every web guard must degrade to
// a safe falsy value and nothing may throw.
describe("no-DOM guards degrade safely", () => {
  test("pip helpers report unsupported / inactive", () => {
    assert.equal(isPipSupported(), false);
    assert.equal(isPipActive(), false);
  });

  test("enterPip / exitPip resolve without throwing", async () => {
    assert.equal(await enterPip(undefined), false);
    assert.equal(await exitPip(), false);
  });

  test("remote playback + cast detection are false without DOM", () => {
    assert.equal(isRemotePlaybackSupported(), false);
    assert.equal(isCastApiPresent(), false);
    assert.equal(isWebCastAvailable(), false);
  });

  test("media session helpers no-op", () => {
    assert.equal(isMediaSessionSupported(), false);
    assert.equal(setMediaSessionMetadata({ title: "x" }), false);
    assert.deepEqual(setMediaSessionHandlers({ play: () => {} }), []);
    assert.equal(setMediaSessionPosition({ duration: 100, position: 5 }), false);
  });

  test("background audio false without media session", () => {
    assert.equal(isBackgroundAudioSupported(), false);
  });

  test("getWebCapabilities returns an all-false snapshot", () => {
    assert.deepEqual(getWebCapabilities(), {
      pip: false,
      remotePlayback: false,
      cast: false,
      mediaSession: false,
      backgroundAudio: false,
    });
  });
});

describe("native stubs", () => {
  test("chromecast is hard-false (react-native-google-cast not installed)", () => {
    assert.equal(isChromecastAvailable(), false);
  });

  test("airplay / native pip / native bg audio stubs default false", () => {
    assert.equal(isAirPlayAvailable(), false);
    assert.equal(isNativePipSupported(), false);
    assert.equal(isNativeBackgroundAudioSupported(), false);
  });
});

describe("element-level web detection with mocks", () => {
  test("isRemotePlaybackSupported true when element exposes remote.prompt", () => {
    const fakeVideo = { remote: { prompt: () => Promise.resolve() } };
    assert.equal(isRemotePlaybackSupported(/** @type {any} */ (fakeVideo)), true);
  });

  test("isRemotePlaybackSupported false when element lacks remote", () => {
    assert.equal(isRemotePlaybackSupported(/** @type {any} */ ({})), false);
  });
});
