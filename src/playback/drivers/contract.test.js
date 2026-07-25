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

const CAPABILITY_METHODS = {
  canSeek: ['seekTo', 'seekBy'],
  canSetRate: ['setRate'],
  canSetVolume: ['setVolume'],
  canNudge: ['nudge'],
};

/** @param {any} driver @param {string} label */
export function assertCapabilityGating(driver, label) {
  const caps = driver.capabilities || {};
  for (const [flag, methods] of Object.entries(CAPABILITY_METHODS)) {
    for (const m of methods) {
      if (caps[flag]) assert.equal(typeof driver[m], 'function', `${label}: ${flag} true ⇒ ${m}() must exist`);
      else assert.equal(driver[m], undefined, `${label}: ${flag} false ⇒ ${m}() must be absent`);
    }
  }
}

describe('PlayerDriver contract — capability gating', () => {
  const { hls } = buildAll();
  test('hls capabilities match implemented methods', () => {
    assert.equal(!!(hls.capabilities && hls.capabilities.canSeek), true, 'hls should advertise canSeek');
    assertCapabilityGating(hls, 'hls');
  });
  test('mpegts capabilities match implemented methods', () => {
    const { mpegts } = buildAll();
    assert.ok(mpegts.capabilities?.canSeek, 'mpegts should advertise canSeek');
    assert.ok(mpegts.capabilities?.canSetRate, 'mpegts should advertise canSetRate');
    assert.ok(mpegts.capabilities?.canSetVolume, 'mpegts should advertise canSetVolume');
    assertCapabilityGating(mpegts, 'mpegts');
  });
  test('vlc capabilities match implemented methods (rate/volume are prop-driven → absent)', () => {
    const { vlc } = buildAll();
    assert.ok(vlc.capabilities?.canSeek, 'vlc should advertise canSeek');
    assert.equal(vlc.capabilities?.canSetVolume, false, 'vlc volume is prop-driven → not a driver capability');
    assert.equal(vlc.capabilities?.canSetRate, false, 'vlc rate is prop-driven → not a driver capability');
    assertCapabilityGating(vlc, 'vlc');
  });
  test('liveRouter capabilities match delegated methods', () => {
    const { liveRouter } = buildAll();
    assert.ok(liveRouter.capabilities?.canSeek, 'liveRouter should advertise canSeek');
    assert.ok(liveRouter.capabilities?.canSetRate, 'liveRouter should advertise canSetRate');
    assert.ok(liveRouter.capabilities?.canSetVolume, 'liveRouter should advertise canSetVolume');
    assertCapabilityGating(liveRouter, 'liveRouter');
  });
});
