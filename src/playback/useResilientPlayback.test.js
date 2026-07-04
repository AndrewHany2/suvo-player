// @ts-check
/**
 * Tests for the useResilientPlayback HOST HOOK (not the pure recoveryMachine,
 * which recoveryMachine.test.js already covers). This exercises the effect
 * executor and timer plumbing that realizes the reload-loop guarantee:
 *   - CANCEL_RETRY actually clears the scheduled setTimeout (self-recovery
 *     cannot bounce into a stale RELOAD),
 *   - a fired RETRY RELOADs and seeks to the saved VOD position,
 *   - onFatal fires exactly once,
 *   - OFFLINE followed by ONLINE reloads exactly once.
 *
 * There is no React renderer available in this repo (no react-test-renderer /
 * @testing-library / jsdom), so we drive the REAL, unmodified hook through a
 * minimal single-component hooks host that supplies React 19's internal
 * dispatcher. The hook code under test is the shipped code — only the render
 * scheduling is stubbed. Effects use real timers, controlled with node:test
 * mock timers.
 *
 * The FAKE driver implements the PlayerDriver contract from drivers/types.js.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { useResilientPlayback } from "./useResilientPlayback.js";

const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

/** Shallow deps-equal, mirroring React's hook dependency comparison. */
function depsEqual(a, b) {
  return !!a && !!b && a.length === b.length && a.every((x, k) => Object.is(x, b[k]));
}

/**
 * Render `useResilientPlayback` in a minimal hooks host. Returns a handle whose
 * `act()` runs a callback and then flushes renders + effects, matching how
 * React re-renders after an external event fires a dispatch.
 */
function renderHook(initialProps) {
  const hooks = [];
  let idx = 0;
  let pendingEffects = [];
  let scheduled = false;
  let currentProps = initialProps;
  let result;

  const dispatcher = {
    useReducer(reducer, initialArg, init) {
      const i = idx++;
      if (hooks[i] === undefined) hooks[i] = { state: init ? init(initialArg) : initialArg };
      const h = hooks[i];
      return [
        h.state,
        (action) => {
          h.state = reducer(h.state, action);
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
      // Intentionally invoking the real hook inside a test harness that supplies
      // React's dispatcher; the rules-of-hooks lint does not apply here.
      // eslint-disable-next-line react-hooks/rules-of-hooks
      result = useResilientPlayback(currentProps);
    } finally {
      internals.H = prevDispatcher;
    }
  }

  function runEffects() {
    const toRun = pendingEffects;
    pendingEffects = [];
    for (const e of toRun) {
      if (hooks[e.i]?.cleanup) {
        try {
          hooks[e.i].cleanup();
        } catch {
          /* noop */
        }
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
    get result() {
      return result;
    },
    /** Run an interaction, then flush the resulting renders + effects. */
    act(fn) {
      fn?.();
      flush();
    },
    setProps(next) {
      currentProps = { ...currentProps, ...next };
      scheduled = true;
      flush();
    },
    unmount() {
      for (const h of hooks) {
        if (h?.cleanup) {
          try {
            h.cleanup();
          } catch {
            /* noop */
          }
        }
      }
    },
  };
}

/** A fake PlayerDriver (drivers/types.js contract) that records calls + lets tests emit events. */
function makeFakeDriver() {
  const calls = { load: [], setQualityCap: [], destroy: 0 };
  const listeners = { status: [], progress: [], stall: [], error: [] };
  const sub = (bucket) => (cb) => {
    listeners[bucket].push(cb);
    return () => {
      const i = listeners[bucket].indexOf(cb);
      if (i >= 0) listeners[bucket].splice(i, 1);
    };
  };
  return {
    calls,
    fire: {
      status: (s) => listeners.status.slice().forEach((f) => f(s)),
      progress: (t) => listeners.progress.slice().forEach((f) => f(t)),
      stall: () => listeners.stall.slice().forEach((f) => f()),
      error: (e) => listeners.error.slice().forEach((f) => f(e)),
    },
    // lifecycle / transport
    load: (source, opts) => calls.load.push({ source, opts }),
    play: () => {},
    pause: () => {},
    destroy: () => {
      calls.destroy++;
    },
    // getters
    currentTime: () => 0,
    duration: () => 100,
    buffered: () => 0,
    isLive: () => false,
    // quality
    setQualityCap: (cap) => calls.setQualityCap.push(cap),
    // subscriptions
    onStatus: sub("status"),
    onProgress: sub("progress"),
    onStall: sub("stall"),
    onError: sub("error"),
  };
}

test("mounts and issues an initial load at startTime", () => {
  const driver = makeFakeDriver();
  const h = renderHook({ driver, source: { uri: "http://x/s.m3u8" }, isLive: false, startTime: 5 });
  assert.equal(h.result.status, "loading");
  assert.ok(driver.calls.load.length >= 1, "expected an initial load");
  assert.equal(driver.calls.load[0].opts.startTime, 5);
});

test("CANCEL_RETRY clears the scheduled retry timeout on self-recovery", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const driver = makeFakeDriver();
  const h = renderHook({ driver, source: { uri: "http://x/s.m3u8" } });

  h.act(() => driver.fire.status({ state: "playing" }));
  h.act(() => driver.fire.progress(5)); // savedTime advances, state playing
  const loadsBefore = driver.calls.load.length;

  h.act(() => driver.fire.stall()); // -> recovering, SCHEDULE_RETRY (real setTimeout armed)
  assert.equal(h.result.isRecovering, true);

  h.act(() => driver.fire.progress(10)); // time advanced while recovering -> CANCEL_RETRY

  h.act(() => t.mock.timers.tick(120000)); // long past any backoff delay
  assert.equal(
    driver.calls.load.length,
    loadsBefore,
    "cancelled retry must not fire a stale RELOAD",
  );
});

test("a fired RETRY reloads and seeks to the saved VOD position", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const driver = makeFakeDriver();
  const h = renderHook({ driver, source: { uri: "http://x/s.m3u8" }, isLive: false });

  h.act(() => driver.fire.status({ state: "playing" }));
  h.act(() => driver.fire.progress(42)); // savedTime = 42
  const before = driver.calls.load.length;

  h.act(() => driver.fire.stall()); // schedules retry
  h.act(() => t.mock.timers.tick(120000)); // fire it -> RELOAD

  const reloads = driver.calls.load.slice(before);
  assert.ok(reloads.length >= 1, "expected a reload from the fired retry");
  const last = reloads[reloads.length - 1];
  assert.equal(last.opts.startTime, 42, "VOD reload seeks to savedTime");
});

test("onFatal fires exactly once even on repeated fatal errors", () => {
  const driver = makeFakeDriver();
  const reasons = [];
  renderHook({
    driver,
    source: { uri: "http://x/s.m3u8" },
    onFatal: (r) => reasons.push(r),
  });

  const gone = { httpStatus: 404, kind: "manifest-removed" };
  driver.fire.error(gone); // GONE -> fatal, onFatal("GONE")
  driver.fire.error(gone); // already fatal -> must not notify again

  assert.deepEqual(reasons, ["GONE"]);
});

test("OFFLINE then ONLINE reloads exactly once", () => {
  const driver = makeFakeDriver();
  const h = renderHook({ driver, source: { uri: "http://x/s.m3u8" }, isOnline: true });

  h.act(() => driver.fire.status({ state: "playing" }));
  const before = driver.calls.load.length;

  h.setProps({ isOnline: false }); // OFFLINE -> recovering, retries suppressed
  assert.equal(h.result.isRecovering, true);

  h.setProps({ isOnline: true }); // ONLINE -> single RELOAD
  assert.equal(driver.calls.load.length - before, 1, "reconnect reloads exactly once");
});

test("stays offline without reloading until ONLINE arrives", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const driver = makeFakeDriver();
  const h = renderHook({ driver, source: { uri: "http://x/s.m3u8" }, isOnline: true });

  h.act(() => driver.fire.status({ state: "playing" }));
  const before = driver.calls.load.length;

  h.setProps({ isOnline: false });
  h.act(() => t.mock.timers.tick(120000)); // no retry may fire while offline
  assert.equal(driver.calls.load.length, before, "no reload while offline");
});
