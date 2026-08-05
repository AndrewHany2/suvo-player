import test from "node:test";
import assert from "node:assert/strict";
import { isPortrait, restorePortrait } from "./restoreOrientation.js";

// Orientation / OrientationLock enum values mirror expo-screen-orientation.
const Orientation = { UNKNOWN: 0, PORTRAIT_UP: 1, PORTRAIT_DOWN: 2, LANDSCAPE_LEFT: 3, LANDSCAPE_RIGHT: 4 };
const OrientationLock = { DEFAULT: 0, ALL: 1, PORTRAIT: 2, PORTRAIT_UP: 3, LANDSCAPE: 5 };

// Drain the microtask queue so the awaited lock/getOrientation steps inside
// restorePortrait settle before the test asserts / emits.
const flush = () => new Promise((r) => setTimeout(r, 0));

// A fake ScreenOrientation that records call order, lets the test control the
// reported orientation, and lets the test manually emit orientation-change
// events (as expo delivers them: { orientationInfo: { orientation } }).
function makeFake({ current = Orientation.LANDSCAPE_RIGHT, overrides = {} } = {}) {
  const log = [];
  let listener = null;
  const api = {
    Orientation,
    OrientationLock,
    lockAsync(lock) {
      log.push(`lock:${lock}`);
      return Promise.resolve();
    },
    unlockAsync() {
      log.push("unlock");
      return Promise.resolve();
    },
    getOrientationAsync() {
      log.push("getOrientation");
      return Promise.resolve(current);
    },
    addOrientationChangeListener(fn) {
      log.push("addListener");
      listener = fn;
      return { fn };
    },
    removeOrientationChangeListener() {
      log.push("removeListener");
      listener = null;
    },
    ...overrides,
  };
  const emit = (orientation) => listener?.({ orientationInfo: { orientation } });
  return { api, log, emit };
}

test("isPortrait: true only for portrait orientations", () => {
  assert.equal(isPortrait(Orientation.PORTRAIT_UP, Orientation), true);
  assert.equal(isPortrait(Orientation.PORTRAIT_DOWN, Orientation), true);
  assert.equal(isPortrait(Orientation.LANDSCAPE_LEFT, Orientation), false);
  assert.equal(isPortrait(Orientation.LANDSCAPE_RIGHT, Orientation), false);
  assert.equal(isPortrait(Orientation.UNKNOWN, Orientation), false);
});

// The core regression: unlocking immediately after lockAsync (the old
// lock().then(unlock) chain) released orientation control before portrait was
// actually applied, so the device stayed landscape. The lock must be held until
// the device REPORTS portrait, and only then released.
test("restorePortrait: holds the lock until portrait is applied, then unlocks", async () => {
  const { api, log, emit } = makeFake({ current: Orientation.LANDSCAPE_RIGHT });
  const p = restorePortrait(api);
  await flush();

  // Locked to portrait and subscribed — but NOT yet unlocked.
  assert.deepEqual(log, ["lock:3", "getOrientation", "addListener"]);

  // A non-portrait event must be ignored (still not unlocked).
  emit(Orientation.LANDSCAPE_LEFT);
  await flush();
  assert.deepEqual(log, ["lock:3", "getOrientation", "addListener"]);

  // Portrait arrives → remove the listener, then unlock.
  emit(Orientation.PORTRAIT_UP);
  await p;
  assert.deepEqual(log, ["lock:3", "getOrientation", "addListener", "removeListener", "unlock"]);
});

test("restorePortrait: unlocks immediately when already portrait (no listener)", async () => {
  const { api, log } = makeFake({ current: Orientation.PORTRAIT_UP });
  await restorePortrait(api);
  assert.deepEqual(log, ["lock:3", "getOrientation", "unlock"]);
});

// Safety net: if the portrait event never arrives, the injected timeout fires so
// the lock never outlives the player and the listener is always cleaned up.
test("restorePortrait: safety timeout unlocks and removes listener if portrait never arrives", async () => {
  const { api, log } = makeFake({ current: Orientation.LANDSCAPE_RIGHT });
  let timerCb = null;
  const setTimeoutFn = (cb) => { timerCb = cb; return 42; };
  let cleared = null;
  const clearTimeoutFn = (id) => { cleared = id; };

  const p = restorePortrait(api, { setTimeoutFn, clearTimeoutFn });
  await flush();
  assert.deepEqual(log, ["lock:3", "getOrientation", "addListener"]);
  assert.equal(typeof timerCb, "function");

  timerCb(); // portrait never came — safety cap fires
  await p;
  assert.deepEqual(log, ["lock:3", "getOrientation", "addListener", "removeListener", "unlock"]);
  assert.equal(cleared, 42); // timer was cleared on finish
});

test("restorePortrait: fires the timer exactly once on portrait, clearing the safety cap", async () => {
  const { api, emit } = makeFake({ current: Orientation.LANDSCAPE_RIGHT });
  let cleared = false;
  const setTimeoutFn = () => 7;
  const clearTimeoutFn = () => { cleared = true; };
  const p = restorePortrait(api, { setTimeoutFn, clearTimeoutFn });
  await flush();
  emit(Orientation.PORTRAIT_UP);
  await p;
  assert.equal(cleared, true);
});

// Orientation control is best-effort; a rejection from any step must never
// escape (this runs inside an unmount cleanup).
test("restorePortrait: never throws if the native calls reject", async () => {
  const { api } = makeFake({
    overrides: { lockAsync: () => Promise.reject(new Error("boom")) },
  });
  await assert.doesNotReject(() => restorePortrait(api));
});
