// @ts-check
/**
 * Tests for usePlayerPreferences — the two-scope (global + per-stream), debounced,
 * AsyncStorage-backed player-preference store.
 *
 * Like useResilientPlayback.test.js there's no React renderer in this repo, so we
 * drive the REAL hook through a minimal hooks host that supplies React 19's
 * internal dispatcher (extended here with useState). The async load and the 250ms
 * write debounce are exercised with real microtasks + node:test mock timers.
 *
 * AsyncStorage's native module is absent under bare node, so we install an
 * in-memory backing on the shared `storage` singleton (the exact object the hook
 * imports) before each test.
 */
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import storage from "../utils/storage.js";
import { usePlayerPreferences, GLOBAL_PREFS_KEY, streamPrefsKey } from "./usePlayerPreferences.js";

const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

/** Shallow deps-equal, mirroring React's hook dependency comparison. */
function depsEqual(a, b) {
  return !!a && !!b && a.length === b.length && a.every((x, k) => Object.is(x, b[k]));
}

/** Install an in-memory AsyncStorage on the shared singleton. Returns { map, writes }. */
function installFakeStorage() {
  const map = new Map();
  const writes = [];
  storage.getItem = async (k) => (map.has(k) ? map.get(k) : null);
  storage.setItem = async (k, v) => { writes.push(k); map.set(k, v); };
  storage.removeItem = async (k) => { map.delete(k); };
  return { map, writes };
}

/** Render `usePlayerPreferences(streamKey)` in a minimal hooks host. */
function renderHook(initialStreamKey) {
  const hooks = [];
  let idx = 0;
  let pendingEffects = [];
  let scheduled = false;
  let currentKey = initialStreamKey;
  let result;

  const dispatcher = {
    useState(initial) {
      const i = idx++;
      if (hooks[i] === undefined) {
        hooks[i] = { state: typeof initial === "function" ? initial() : initial };
      }
      const h = hooks[i];
      return [
        h.state,
        (v) => {
          h.state = typeof v === "function" ? v(h.state) : v;
          scheduled = true;
        },
      ];
    },
    useRef(value) {
      const i = idx++;
      if (hooks[i] === undefined) hooks[i] = { current: value };
      return hooks[i];
    },
    useMemo(fn, deps) {
      const i = idx++;
      const prev = hooks[i];
      if (!prev || !depsEqual(prev.deps, deps)) hooks[i] = { value: fn(), deps };
      return hooks[i].value;
    },
    useCallback(fn, deps) {
      const i = idx++;
      const prev = hooks[i];
      if (!prev || !depsEqual(prev.deps, deps)) hooks[i] = { value: fn, deps };
      return hooks[i].value;
    },
    useEffect(fn, deps) {
      const i = idx++;
      const prev = hooks[i];
      if (!prev || !depsEqual(prev.deps, deps)) {
        pendingEffects.push({ i, fn });
        hooks[i] = { deps, cleanup: prev?.cleanup };
      }
    },
  };

  function renderOnce() {
    idx = 0;
    const prevDispatcher = internals.H;
    internals.H = dispatcher;
    try {
      // eslint-disable-next-line react-hooks/rules-of-hooks
      result = usePlayerPreferences(currentKey);
    } finally {
      internals.H = prevDispatcher;
    }
  }

  function runEffects() {
    const toRun = pendingEffects;
    pendingEffects = [];
    for (const e of toRun) {
      if (hooks[e.i]?.cleanup) {
        try { hooks[e.i].cleanup(); } catch { /* noop */ }
      }
      const cleanup = e.fn();
      if (hooks[e.i]) hooks[e.i].cleanup = typeof cleanup === "function" ? cleanup : undefined;
    }
  }

  function flush() {
    let guard = 0;
    do {
      scheduled = false;
      renderOnce();
      runEffects();
      if (++guard > 50) throw new Error("render loop did not settle");
    } while (scheduled);
  }

  scheduled = true;
  flush(); // initial mount

  return {
    get result() { return result; },
    act(fn) { fn?.(); flush(); },
    setKey(next) { currentKey = next; scheduled = true; flush(); },
    /** Let the async load effect resolve, then flush the resulting re-render. */
    async settle() {
      for (let n = 0; n < 6; n++) await Promise.resolve();
      this.act(() => {});
    },
    unmount() {
      for (const h of hooks) {
        if (h?.cleanup) { try { h.cleanup(); } catch { /* noop */ } }
      }
    },
  };
}

let fake;
beforeEach(() => { fake = installFakeStorage(); });

describe("usePlayerPreferences", () => {
  test("loads global + stream and merges with stream winning", async () => {
    fake.map.set(GLOBAL_PREFS_KEY, JSON.stringify({ aspectRatio: "16:9", playbackSpeed: 1.5 }));
    fake.map.set(streamPrefsKey("movies_42"), JSON.stringify({ aspectRatio: "4:3" }));

    const h = renderHook("movies_42");
    await h.settle();

    assert.equal(h.result.loaded, true);
    assert.equal(h.result.prefs.aspectRatio, "4:3"); // stream overrides global
    assert.equal(h.result.prefs.playbackSpeed, 1.5); // inherited from global
  });

  test("setPref scope 'stream' writes the per-stream record", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const h = renderHook("movies_42");
    await h.settle();

    h.act(() => h.result.setPref("audioTrack", "English"));
    h.act(() => t.mock.timers.tick(300)); // fire the debounced write

    assert.deepEqual(
      JSON.parse(fake.map.get(streamPrefsKey("movies_42"))),
      { audioTrack: "English" },
    );
    assert.equal(fake.map.has(GLOBAL_PREFS_KEY), false); // global untouched
  });

  test("with no streamKey, a 'stream' setPref falls back to the global scope", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const h = renderHook(null);
    await h.settle();

    h.act(() => h.result.setPref("audioTrack", "English", { scope: "stream" }));
    h.act(() => t.mock.timers.tick(300));

    assert.deepEqual(JSON.parse(fake.map.get(GLOBAL_PREFS_KEY)), { audioTrack: "English" });
  });

  test("rapid setPref bursts coalesce into a single write per scope", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const h = renderHook("movies_42");
    await h.settle();

    h.act(() => {
      h.result.setPref("playbackSpeed", 1.25);
      h.result.setPref("playbackSpeed", 1.5);
      h.result.setPref("playbackSpeed", 2);
    });
    h.act(() => t.mock.timers.tick(300));

    const streamKey = streamPrefsKey("movies_42");
    const streamWrites = fake.writes.filter((k) => k === streamKey);
    assert.equal(streamWrites.length, 1, "three sets coalesce into one write");
    assert.equal(JSON.parse(fake.map.get(streamKey)).playbackSpeed, 2); // last value wins
  });

  test("resetStream clears the per-stream record and removes its key", async () => {
    fake.map.set(streamPrefsKey("movies_42"), JSON.stringify({ aspectRatio: "4:3" }));
    const h = renderHook("movies_42");
    await h.settle();
    assert.equal(h.result.prefs.aspectRatio, "4:3");

    h.act(() => h.result.resetStream());

    assert.equal(h.result.prefs.aspectRatio, undefined); // in-memory override cleared
    assert.equal(fake.map.has(streamPrefsKey("movies_42")), false); // persisted record removed
  });

  test("unmount flushes a still-pending debounced write", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const h = renderHook("movies_42");
    await h.settle();

    h.act(() => h.result.setPref("aspectRatio", "fill")); // arms the 250ms timer
    const streamKey = streamPrefsKey("movies_42");
    assert.equal(fake.map.has(streamKey), false, "write not persisted before debounce fires");

    h.unmount(); // must flush the pending write

    assert.deepEqual(JSON.parse(fake.map.get(streamKey)), { aspectRatio: "fill" });
  });
});
