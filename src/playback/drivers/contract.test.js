// @ts-check
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHlsDriver } from './hlsDriver.js';
import { createMpegtsDriver } from './mpegtsDriver.js';
import { createVlcDriver } from './vlcDriver.js';
import { createLiveRouterDriver } from './liveRouterDriver.js';

export const MANDATORY_DRIVER_METHODS = [
  'load', 'destroy',
  'currentTime', 'duration', 'buffered', 'isLive',
  'setQualityCap',
  'onStatus', 'onProgress', 'onStall', 'onError',
];

/** @param {any} driver @param {string} label */
export function assertMandatory(driver, label) {
  for (const m of MANDATORY_DRIVER_METHODS) {
    assert.equal(typeof driver[m], 'function', `${label} must implement ${m}()`);
  }
}

/** Build each driver with a minimal stub so the factory runs without a real engine. */
function buildAll() {
  const noVideo = () => null; // getters resolve to null; factories must still return the full shape
  const hls = createHlsDriver(noVideo);
  const mpegts = createMpegtsDriver(noVideo);
  const { driver: vlc } = createVlcDriver({ setSource: () => {}, setPaused: () => {}, seek: () => {} });
  const liveRouter = createLiveRouterDriver({ hls, mpegts, probe: async () => ({ engine: 'hls', confident: true }) });
  return { hls, mpegts, vlc, liveRouter };
}

describe('PlayerDriver contract — mandatory methods', () => {
  const drivers = buildAll();
  for (const [label, driver] of Object.entries(drivers)) {
    test(`${label} implements every mandatory method`, () => {
      assertMandatory(driver, label);
    });
  }
});
