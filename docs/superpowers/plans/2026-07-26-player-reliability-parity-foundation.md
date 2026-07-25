# Player Reliability + Parity Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the reliability/parity correctness gaps in the engine-agnostic player: give raw-MPEG-TS the same first-frame stall gate the other engines have, make the driver contract testable, bring transport methods (`seekTo`/`seekBy`/`setVolume`/`setRate`) to every engine so a post-scrub reload never resumes at a stale position, and add a lightweight "nudge" recovery rung plus a live-vs-VOD retry budget.

**Architecture:** The pure reducer `recoveryMachine.js` emits effects; the React host `useResilientPlayback.js` runs them against a `PlayerDriver` (`drivers/types.js`). Engines live behind `expoVideoDriver` / `vlcDriver` / `hlsDriver` / `mpegtsDriver` / `liveRouterDriver`. This plan keeps the reducer pure, extends the driver contract with a `capabilities` descriptor + a `nudge()` method, and routes all screen transport through the driver.

**Tech Stack:** Expo ~54, expo-video ~3.0.16, React Native 0.81, react-native-web, React 19, hls.js 1.6.16, mpegts.js 1.8.0, react-native-vlc-media-player 1.0.98. JavaScript only (`.js`/`.jsx`). Tests: `node:test` via `npm test`. Lint: `npm run lint`.

## Global Constraints

- JavaScript only — `.js`/`.jsx`, never TypeScript. Files start with `// @ts-check` where the neighbours do.
- Never import `hls.js` / `mpegts.js` / `expo-video` / VLC outside their own driver file.
- The reducer (`recoveryMachine.js`) stays pure: no timers, no I/O, no engine/React imports.
- `node:test` only (no Jest). Test files sit next to source as `*.test.js`.
- Native `.native.jsx` screens are NOT covered by `node:test` — every screen-touching change ends with an explicit on-device verify step, never a "done" claim.
- `npm test` and `npm run lint` must both pass (lint warnings OK, errors not) before moving to the next task.
- Commit after every task with the message shown in that task's final step.

---

## Sub-project 1 — mpegts first-frame gate + router watchdog ownership

### Task 1: Add the `hasStartedPlaying` first-frame gate to `mpegtsDriver`

**Files:**
- Modify: `src/playback/drivers/mpegtsDriver.js` (`createMpegtsDriver` scope + `load` + `onStall`)
- Test: `src/playback/drivers/mpegtsDriver.test.js` (create)

**Interfaces:**
- Consumes: `createMpegtsDriver(videoElOrGetter, opts)` (existing), `STALL_THRESHOLD_MS`, `STALL_POLL_MS` (existing exports).
- Produces: no signature change; behavioral change only (the stall watchdog no longer fires before the first `playing` event).

- [ ] **Step 1: Write the failing test**

Create `src/playback/drivers/mpegtsDriver.test.js`. This uses a fake `<video>` element and fake timers to drive the poll-based watchdog. It mirrors how `hlsDriver` gates on `hasStartedPlaying`.

```js
// @ts-check
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createMpegtsDriver, STALL_THRESHOLD_MS, STALL_POLL_MS } from './mpegtsDriver.js';

/** Minimal fake HTMLVideoElement with manual event dispatch + a settable clock. */
function makeFakeVideo() {
  const listeners = new Map();
  return {
    currentTime: 0,
    duration: NaN,
    paused: false,
    ended: false,
    buffered: { length: 0, end: () => 0 },
    error: null,
    addEventListener: (type, cb) => {
      const arr = listeners.get(type) || [];
      arr.push(cb);
      listeners.set(type, arr);
    },
    removeEventListener: (type, cb) => {
      listeners.set(type, (listeners.get(type) || []).filter((f) => f !== cb));
    },
    play: () => Promise.resolve(),
    pause: () => {},
    dispatch: (type) => { for (const cb of listeners.get(type) || []) cb(); },
  };
}

/** Drive setInterval-based polls without real time by stubbing the timer fns. */
function withFakeInterval(run) {
  const real = { setInterval: global.setInterval, clearInterval: global.clearInterval, now: Date.now };
  let clock = 0;
  const tasks = [];
  global.setInterval = (fn, ms) => { const t = { fn, ms, next: clock + ms }; tasks.push(t); return t; };
  global.clearInterval = (t) => { const i = tasks.indexOf(t); if (i >= 0) tasks.splice(i, 1); };
  Date.now = () => clock;
  const advance = (ms) => {
    const target = clock + ms;
    // step in poll-sized increments so each due interval fires once per period
    while (clock < target) {
      clock = Math.min(target, clock + STALL_POLL_MS);
      for (const t of tasks) { if (clock >= t.next) { t.next = clock + t.ms; t.fn(); } }
    }
  };
  try { run(advance); } finally {
    global.setInterval = real.setInterval; global.clearInterval = real.clearInterval; Date.now = real.now;
  }
}

describe('mpegtsDriver first-frame stall gate', () => {
  test('does NOT fire a stall while currentTime is flat before the first playing event', () => {
    withFakeInterval((advance) => {
      const video = makeFakeVideo();
      const driver = createMpegtsDriver(video);
      let stalls = 0;
      driver.onStall(() => { stalls += 1; });
      // Simulate a slow first buffer: play() called, not paused, currentTime pinned at 0.
      video.paused = false;
      advance(STALL_THRESHOLD_MS + 3 * STALL_POLL_MS);
      assert.equal(stalls, 0, 'slow first frame must not be read as a stall');
    });
  });

  test('DOES fire a stall once playing has started and then time freezes', () => {
    withFakeInterval((advance) => {
      const video = makeFakeVideo();
      const driver = createMpegtsDriver(video);
      let stalls = 0;
      driver.onStall(() => { stalls += 1; });
      // Playback genuinely started, clock advanced a little.
      video.dispatch('playing');
      video.currentTime = 5;
      advance(STALL_POLL_MS);
      // Now it freezes.
      advance(STALL_THRESHOLD_MS + STALL_POLL_MS);
      assert.equal(stalls, 1, 'a genuine mid-playback freeze must fire exactly once');
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/playback/drivers/mpegtsDriver.test.js`
Expected: FAIL — the first test fails because today's `mpegtsDriver.onStall` fires after `STALL_THRESHOLD_MS` regardless of whether playback started (`stalls` is `1`, not `0`).

- [ ] **Step 3: Add the driver-scoped gate flag and set it on `playing`**

In `src/playback/drivers/mpegtsDriver.js`, inside `createMpegtsDriver`, add the flag next to `player`/`errorSink` (around line 82):

```js
  /** @type {any} */
  let player = null;
  /** @type {((err: NormalizedError) => void) | null} */
  let errorSink = null;
  // Has playback actually begun since the last load()? load() calls play()
  // immediately, so `paused` is false while the demuxer primes (~384 KB) and
  // currentTime sits at 0 — the stall watchdog must NOT treat that slow FIRST
  // buffer as a freeze, or the recovery machine reads it as a mid-playback drop
  // and reloads into the "reconnecting → black" loop. Reset on every load(),
  // set true on the element's 'playing' event. Mirrors hlsDriver.
  let hasStartedPlaying = false;
```

- [ ] **Step 4: Re-arm the gate on every `load()`**

In `load()`, immediately after the `destroyPlayer();` call (around line 104), add:

```js
    destroyPlayer();
    // Re-arm the first-frame gate for this (re)load / recovery RELOAD.
    hasStartedPlaying = false;
```

- [ ] **Step 5: Gate the watchdog and set the flag on `playing` in `onStall`**

Replace the body of `onStall` (lines 205–233) so it (a) marks `hasStartedPlaying` on the element `playing` event and (b) refreshes the clock and bails while `!hasStartedPlaying`, exactly like `hlsDriver.onStall`:

```js
  /** @param {() => void} cb */
  function onStall(cb) {
    const videoEl = el();
    if (!videoEl) return () => {};
    let lastTime = currentTime();
    let lastAdvance = Date.now();
    let firedForThisStall = false;

    // 'playing' fires on genuine start/resume, not on a programmatic seek, so
    // this arms the watchdog only once real playback has begun.
    const onPlaying = () => { hasStartedPlaying = true; };
    videoEl.addEventListener('playing', onPlaying);

    const id = setInterval(() => {
      if (!videoEl) return;
      const paused = videoEl.paused || videoEl.ended;
      const t = currentTime();
      const now = Date.now();
      if (Math.abs(t - lastTime) > 0.05) {
        lastTime = t;
        lastAdvance = now;
        firedForThisStall = false;
        return;
      }
      if (paused) {
        lastAdvance = now;
        lastTime = t;
        return;
      }
      if (!hasStartedPlaying) {
        // Pre-first-frame buffering: keep the clock fresh so the post-start
        // stall window measures from real playback, and never escalate a slow
        // initial buffer to a reconnect.
        lastAdvance = now;
        lastTime = t;
        return;
      }
      if (!firedForThisStall && now - lastAdvance >= stallThresholdMs) {
        firedForThisStall = true;
        cb();
      }
    }, STALL_POLL_MS);
    return () => {
      clearInterval(id);
      try { videoEl.removeEventListener('playing', onPlaying); } catch { /* noop */ }
    };
  }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test src/playback/drivers/mpegtsDriver.test.js`
Expected: PASS — both tests green.

- [ ] **Step 7: Run the full suite + lint**

Run: `npm test` then `npm run lint`
Expected: all tests pass; lint has no errors.

- [ ] **Step 8: Commit**

```bash
git add src/playback/drivers/mpegtsDriver.js src/playback/drivers/mpegtsDriver.test.js
git commit -m "fix(mpegts): gate stall watchdog on first frame (parity with hls/expo)"
```

---

### Task 2: Rebind the router watchdog to the active engine on switch

**Files:**
- Modify: `src/playback/drivers/liveRouterDriver.js`
- Test: `src/playback/drivers/liveRouterDriver.test.js` (add cases; create if absent)

**Interfaces:**
- Consumes: `createLiveRouterDriver({ hls, mpegts, probe, probeTimeoutMs })` (existing).
- Produces: after a switch to mpegts, `onStall`/`onStatus`/`onProgress` subscriptions are served by the active engine (previously always the hls sub-driver).

- [ ] **Step 1: Write the failing test**

Add to `src/playback/drivers/liveRouterDriver.test.js` (create the file with this content if it does not exist):

```js
// @ts-check
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createLiveRouterDriver } from './liveRouterDriver.js';

/** A stub sub-driver that records which of its subscriptions were used. */
function makeStubDriver(tag) {
  const calls = { onStall: 0, onStatus: 0, onProgress: 0, load: 0, destroy: 0 };
  return {
    tag,
    calls,
    load: () => { calls.load += 1; },
    play: () => {},
    pause: () => {},
    destroy: () => { calls.destroy += 1; },
    currentTime: () => 0,
    duration: () => NaN,
    buffered: () => 0,
    isLive: () => true,
    setQualityCap: () => {},
    onStatus: (cb) => { calls.onStatus += 1; return () => {}; },
    onProgress: (cb) => { calls.onProgress += 1; return () => {}; },
    onStall: (cb) => { calls.onStall += 1; return () => {}; },
    onError: (cb) => () => {},
  };
}

describe('liveRouterDriver watchdog ownership', () => {
  test('routes onStall to the mpegts engine after a switch to mpegts', async () => {
    const hls = makeStubDriver('hls');
    const mpegts = makeStubDriver('mpegts');
    const router = createLiveRouterDriver({
      hls,
      mpegts,
      probe: async () => ({ engine: 'mpegts', confident: true }),
    });
    // Subscribe BEFORE loading (as the host does), then load a live source that
    // resolves to mpegts.
    let stalled = false;
    router.onStall(() => { stalled = true; });
    await router.load({ uri: 'http://x/live.m3u8' }, { isLive: true });
    // After the switch, the router must (re)subscribe onStall on the active
    // (mpegts) engine, not leave it bound to hls.
    assert.equal(mpegts.calls.onStall >= 1, true, 'mpegts must receive the onStall subscription after switch');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/playback/drivers/liveRouterDriver.test.js`
Expected: FAIL — today `onStall` is hard-bound to `hls` (`onStall: (cb) => hls.onStall(cb)`), so `mpegts.calls.onStall` stays `0`.

- [ ] **Step 3: Generalize the rebind plumbing to cover status/progress/stall**

In `src/playback/drivers/liveRouterDriver.js`, replace the single error-only rebind with a small generic subscription registry. Replace the state block + `rebindError` (lines 32–44) with:

```js
  /** @type {PlayerDriver} */
  let active = hls;

  // The host subscribes once for the driver's whole life, but the active engine
  // changes on an hls↔mpegts switch. Keep each element-level subscription's
  // callback and re-point it at the active engine when we switch. onError was
  // already rebound this way; status/progress/stall now follow the active engine
  // too so the first-frame gate + stall watchdog belong to whichever engine is
  // actually driving the <video> element.
  /** @type {Record<'status'|'progress'|'stall'|'error', {cb: any, unsub: (()=>void)|null}>} */
  const subs = {
    status: { cb: null, unsub: null },
    progress: { cb: null, unsub: null },
    stall: { cb: null, unsub: null },
    error: { cb: null, unsub: null },
  };

  const SUB_METHOD = { status: 'onStatus', progress: 'onProgress', stall: 'onStall', error: 'onError' };

  /** @param {'status'|'progress'|'stall'|'error'} kind */
  function rebindOne(kind) {
    const entry = subs[kind];
    if (entry.unsub) { try { entry.unsub(); } catch { /* noop */ } entry.unsub = null; }
    if (entry.cb) entry.unsub = active[SUB_METHOD[kind]](entry.cb);
  }

  function rebindAll() {
    rebindOne('status');
    rebindOne('progress');
    rebindOne('stall');
    rebindOne('error');
  }

  /** @param {'status'|'progress'|'stall'|'error'} kind */
  function subscribe(kind, cb) {
    subs[kind].cb = cb;
    rebindOne(kind);
    return () => {
      const entry = subs[kind];
      if (entry.unsub) { try { entry.unsub(); } catch { /* noop */ } entry.unsub = null; }
      entry.cb = null;
    };
  }
```

- [ ] **Step 4: Rebind all subscriptions on switch, and delegate the four subscriptions through `subscribe`**

In `load()`, replace the `rebindError();` call inside the `if (next !== active)` block (line 92) with `rebindAll();`:

```js
    if (next !== active) {
      try { active.destroy?.(); } catch { /* noop */ }
      active = next;
      rebindAll();
    }
```

Then in the returned object (lines 97–122), replace the four subscription delegates so status/progress/stall follow the active engine (not hard-bound to `hls`), and error uses the same registry:

```js
    onStatus: (cb) => subscribe('status', cb),
    onProgress: (cb) => subscribe('progress', cb),
    onStall: (cb) => subscribe('stall', cb),
    onError: (cb) => subscribe('error', cb),
```

Leave the engine-agnostic element *reads* (`currentTime`/`duration`/`buffered`) delegating to `hls` — both sub-drivers read the same `<video>` element, and those are pull-based (no rebind needed). Update the file header comment (lines 11–16) to say status/progress/stall now follow the active engine.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test src/playback/drivers/liveRouterDriver.test.js`
Expected: PASS.

- [ ] **Step 6: Run the full suite + lint**

Run: `npm test` then `npm run lint`
Expected: all pass. (If a pre-existing liveRouter test asserted hls-bound subscriptions, update it to the active-engine expectation.)

- [ ] **Step 7: Commit**

```bash
git add src/playback/drivers/liveRouterDriver.js src/playback/drivers/liveRouterDriver.test.js
git commit -m "fix(liveRouter): rebind status/progress/stall to the active engine on switch"
```

---

## Sub-project 2 — driver contract + conformance test

### Task 3: Add the `capabilities` descriptor + a mandatory-method conformance test

**Files:**
- Modify: `src/playback/drivers/types.js` (typedef + docs)
- Modify: `src/playback/useResilientPlayback.js` (mark `currentTime`/`duration` `@internal`)
- Modify: `docs/ARCHITECTURE.md` (note the display-clock ownership + manual-retry semantics)
- Test: `src/playback/drivers/contract.test.js` (create)

**Interfaces:**
- Produces: a documented `capabilities: { canSeek: boolean, canSetRate: boolean, canSetVolume: boolean, canNudge: boolean }` field on the `PlayerDriver` typedef, and `MANDATORY_DRIVER_METHODS` exported from the contract test's target. The contract test's helper `assertMandatory(driver)` is reused by later tasks.

- [ ] **Step 1: Add the `capabilities` typedef + `nudge` to the contract**

In `src/playback/drivers/types.js`, extend the `PlayerDriver` typedef. After the transport lines (line 88) add:

```js
 * @property {(sec: number) => void} [seekTo]     - Seek to an absolute time (seconds); updates the resume target.
 * @property {(delta: number) => void} [seekBy]   - Seek by a relative offset (seconds), clamped to [0, duration].
 * @property {(v: number) => void} [setVolume]    - Set engine volume 0..1.
 * @property {(r: number) => void} [setRate]      - Set playback rate.
 * @property {() => void} [nudge]                 - Lightweight recovery: re-prime/seek-to-edge WITHOUT a teardown reload.
 *
 * // --- capabilities (which optional methods this engine actually implements) ---
 * @property {{canSeek: boolean, canSetRate: boolean, canSetVolume: boolean, canNudge: boolean}} [capabilities]
```

Update the file header comment to note that optional transport/nudge methods are declared present via `capabilities`, and that a conformance test enforces the "present iff capability" rule.

- [ ] **Step 2: Write the mandatory-method conformance test**

Create `src/playback/drivers/contract.test.js`. It builds each driver with the lightest possible stub host and asserts the mandatory method set exists. (Capability-gated method checks are added in later tasks as the methods land.)

```js
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
```

- [ ] **Step 3: Run the test to verify it passes (all mandatory methods already exist)**

Run: `node --test src/playback/drivers/contract.test.js`
Expected: PASS — every driver already implements the mandatory set. (This test locks the floor before the transport work extends it.)

- [ ] **Step 4: Mark the dead public API `@internal`**

In `src/playback/useResilientPlayback.js`, update the `ResilientPlaybackApi` typedef (lines 56–57) so the two currently-unconsumed fields are explicitly reserved:

```js
 * @property {number} currentTime    - @internal Last known position (seconds). Reserved: screens still own their display clock; do not consume yet (see docs/ARCHITECTURE.md).
 * @property {number} duration       - @internal Total duration (seconds); Infinity/NaN for live. Reserved (see currentTime).
```

- [ ] **Step 5: Document the decisions in `docs/ARCHITECTURE.md`**

Append a short subsection to `docs/ARCHITECTURE.md` under the playback section:

```markdown
### Player display clock & manual retry (2026-07 reliability slice)

- `useResilientPlayback` exposes `currentTime`/`duration`, but screens still own
  their own display clock (they poll the engine directly). Those two fields are
  reserved (`@internal`) until the performance slice consolidates the ~1 Hz
  re-render; do not wire screens to them yet.
- Manual `retry()` (the fatal-panel Reload button) is deliberately a single fast
  attempt — it resets the attempt counter and re-requests once. A slow backend
  (302 to a cold node) relies on the user re-tapping Reload. Automatic live
  recovery, by contrast, gets a nudge rung + up to 3 reload attempts.
- Driver `capabilities` ({canSeek,canSetRate,canSetVolume,canNudge}) declare which
  optional transport/nudge methods each engine implements; `drivers/contract.test.js`
  enforces "method present iff capability true".
```

- [ ] **Step 6: Run the full suite + lint**

Run: `npm test` then `npm run lint`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/playback/drivers/types.js src/playback/drivers/contract.test.js src/playback/useResilientPlayback.js docs/ARCHITECTURE.md
git commit -m "feat(drivers): capabilities descriptor + mandatory-method conformance test"
```

---

## Sub-project 3 — transport parity through the driver

### Task 4: Transport methods + capabilities on `hlsDriver`

**Files:**
- Modify: `src/playback/drivers/hlsDriver.js`
- Test: `src/playback/drivers/contract.test.js` (extend)

**Interfaces:**
- Consumes: `el()`, `hls()`, `duration()`, `currentTime()`, `seekToLiveEdge()`, `isLive()` (existing internals).
- Produces: `seekTo(sec)`, `seekBy(delta)`, `setVolume(v)`, `setRate(r)`, and `capabilities: { canSeek: true, canSetRate: true, canSetVolume: true, canNudge: true }` on the returned driver. (`nudge` is added in Task 9.)

- [ ] **Step 1: Extend the contract test for hls capability gating**

In `src/playback/drivers/contract.test.js`, add a shared helper + an hls case:

```js
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
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/playback/drivers/contract.test.js`
Expected: FAIL — `hls.capabilities` is `undefined`, so `canSeek` assertion fails.

- [ ] **Step 3: Implement the four transport methods in `hlsDriver`**

In `src/playback/drivers/hlsDriver.js`, add these functions just after `seekToLiveEdge()` (after line 409):

```js
  // ── transport ────────────────────────────────────────────────────────────
  /**
   * Seek to an absolute position (seconds). Clamps to [0, duration] for VOD;
   * for live, clamps to the seekable window. Writes the element directly — the
   * <video> currentTime IS the source of truth for element-based engines, so a
   * recovery RELOAD (which re-reads currentTime for VOD) resumes at the new spot.
   * @param {number} sec
   */
  function seekTo(sec) {
    const videoEl = el();
    if (!videoEl || typeof sec !== 'number' || !Number.isFinite(sec)) return;
    let target = Math.max(0, sec);
    const d = duration();
    if (Number.isFinite(d) && d > 0) target = Math.min(target, d);
    try { videoEl.currentTime = target; } catch { /* not seekable yet */ }
  }

  /** @param {number} delta seconds (may be negative) */
  function seekBy(delta) {
    if (typeof delta !== 'number' || !Number.isFinite(delta)) return;
    seekTo(currentTime() + delta);
  }

  /** @param {number} v 0..1 */
  function setVolume(v) {
    const videoEl = el();
    if (!videoEl || typeof v !== 'number' || !Number.isFinite(v)) return;
    const nv = Math.max(0, Math.min(1, v));
    try { videoEl.volume = nv; videoEl.muted = nv === 0; } catch { /* noop */ }
  }

  /** @param {number} r playback rate */
  function setRate(r) {
    const videoEl = el();
    if (!videoEl || typeof r !== 'number' || !Number.isFinite(r) || r <= 0) return;
    try { videoEl.playbackRate = r; } catch { /* noop */ }
  }
```

- [ ] **Step 4: Add the methods + capabilities to the returned driver**

In the returned object (lines 728–742), add the four methods and the capabilities descriptor (leave `nudge` out until Task 9, so keep `canNudge: false` for now):

```js
  /** @type {PlayerDriver} */
  return {
    load,
    play,
    pause,
    destroy,
    seekTo,
    seekBy,
    setVolume,
    setRate,
    currentTime,
    duration,
    buffered,
    isLive,
    setQualityCap,
    capabilities: { canSeek: true, canSetRate: true, canSetVolume: true, canNudge: false },
    onStatus,
    onProgress,
    onStall,
    onError,
  };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test src/playback/drivers/contract.test.js`
Expected: PASS — hls advertises `canSeek`/`canSetRate`/`canSetVolume` and implements the matching methods; `canNudge:false` and no `nudge` method is consistent.

- [ ] **Step 6: Run the full suite + lint, then commit**

Run: `npm test` then `npm run lint`

```bash
git add src/playback/drivers/hlsDriver.js src/playback/drivers/contract.test.js
git commit -m "feat(hls): implement seekTo/seekBy/setVolume/setRate + capabilities"
```

---

### Task 5: Transport methods + capabilities on `mpegtsDriver`

**Files:**
- Modify: `src/playback/drivers/mpegtsDriver.js`
- Test: `src/playback/drivers/contract.test.js` (extend)

**Interfaces:**
- Consumes: `el()`, `currentTime()`, `duration()` (existing internals).
- Produces: `seekTo`/`seekBy`/`setVolume`/`setRate` + `capabilities: { canSeek: true, canSetRate: true, canSetVolume: true, canNudge: false }`. (Raw live TS is not really seekable backward, but forward seek-to-edge and rate/volume are valid; `seekTo` clamps to the buffered/seekable window.)

- [ ] **Step 1: Extend the contract test for mpegts**

In `contract.test.js`, add inside the capability-gating describe block:

```js
  test('mpegts capabilities match implemented methods', () => {
    const { mpegts } = buildAll();
    assertCapabilityGating(mpegts, 'mpegts');
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test src/playback/drivers/contract.test.js`
Expected: FAIL — `mpegts.capabilities` undefined.

- [ ] **Step 3: Implement transport in `mpegtsDriver`**

In `src/playback/drivers/mpegtsDriver.js`, add after `buffered()` / `isLive()` (after line 169):

```js
  // ── transport ────────────────────────────────────────────────────────────
  /** @param {number} sec absolute position (seconds), clamped to the seekable window. */
  function seekTo(sec) {
    const videoEl = el();
    if (!videoEl || typeof sec !== 'number' || !Number.isFinite(sec)) return;
    let target = Math.max(0, sec);
    try {
      const seekable = videoEl.seekable;
      if (seekable && seekable.length > 0) {
        target = Math.min(target, seekable.end(seekable.length - 1));
      }
      videoEl.currentTime = target;
    } catch { /* not seekable yet */ }
  }
  /** @param {number} delta seconds (may be negative) */
  function seekBy(delta) {
    if (typeof delta !== 'number' || !Number.isFinite(delta)) return;
    seekTo(currentTime() + delta);
  }
  /** @param {number} v 0..1 */
  function setVolume(v) {
    const videoEl = el();
    if (!videoEl || typeof v !== 'number' || !Number.isFinite(v)) return;
    const nv = Math.max(0, Math.min(1, v));
    try { videoEl.volume = nv; videoEl.muted = nv === 0; } catch { /* noop */ }
  }
  /** @param {number} r playback rate */
  function setRate(r) {
    const videoEl = el();
    if (!videoEl || typeof r !== 'number' || !Number.isFinite(r) || r <= 0) return;
    try { videoEl.playbackRate = r; } catch { /* noop */ }
  }
```

- [ ] **Step 4: Add methods + capabilities to the returned driver**

Replace the returned object (lines 257–263) with:

```js
  /** @type {PlayerDriver} */
  return {
    load, play, pause, destroy,
    seekTo, seekBy, setVolume, setRate,
    currentTime, duration, buffered, isLive,
    setQualityCap,
    capabilities: { canSeek: true, canSetRate: true, canSetVolume: true, canNudge: false },
    onStatus, onProgress, onStall, onError,
  };
```

- [ ] **Step 5: Run the contract test, full suite, lint**

Run: `node --test src/playback/drivers/contract.test.js` (PASS), then `npm test` and `npm run lint`.

- [ ] **Step 6: Commit**

```bash
git add src/playback/drivers/mpegtsDriver.js src/playback/drivers/contract.test.js
git commit -m "feat(mpegts): implement seekTo/seekBy/setVolume/setRate + capabilities"
```

---

### Task 6: Seek parity on `vlcDriver` (fraction-aware, resume-correct)

**Files:**
- Modify: `src/playback/drivers/vlcDriver.js`
- Test: `src/playback/drivers/vlcDriver.test.js` (create) + `contract.test.js` (extend)

**Interfaces:**
- Consumes: the existing `handle.seek(fraction)` and driver-scoped `lastPositionSec`/`lastDurationSec`/`pendingStartSec`.
- Produces: `seekTo(sec)`, `seekBy(delta)` + `capabilities: { canSeek: true, canSetRate: false, canSetVolume: false, canNudge: true }`. Volume/rate stay React-prop-driven on `<VLCPlayer>` (the driver has no imperative handle for them), so those capabilities are **false** by design. `nudge` is added in Task 9. **Critical:** `seekTo` sets `lastPositionSec` (and `pendingStartSec`) synchronously BEFORE calling `handle.seek`, so a recovery RELOAD landing right after a scrub resumes at the NEW position.

- [ ] **Step 1: Write the failing driver test**

Create `src/playback/drivers/vlcDriver.test.js`:

```js
// @ts-check
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createVlcDriver } from './vlcDriver.js';

describe('vlcDriver seekTo resume correctness', () => {
  test('seekTo updates currentTime() synchronously and calls handle.seek with the right fraction', () => {
    const seeks = [];
    const { driver, ingest } = createVlcDriver({
      setSource: () => {}, setPaused: () => {}, seek: (frac) => seeks.push(frac),
    });
    // Establish a known duration via a progress tick (600s clip, at 60s).
    ingest.progress({ currentTime: 60000, duration: 600000 });
    assert.equal(Math.round(driver.currentTime()), 60);

    driver.seekTo(300); // jump to 5:00
    // currentTime must reflect the new target immediately (before any callback),
    // so a RELOAD that reads currentTime resumes at 300, not the stale 60.
    assert.equal(Math.round(driver.currentTime()), 300);
    // handle.seek is fraction-based: 300 / 600 = 0.5
    assert.equal(seeks.at(-1), 0.5);
  });

  test('seekTo is a no-op-safe when duration is unknown (falls back to remembering seconds)', () => {
    const seeks = [];
    const { driver } = createVlcDriver({
      setSource: () => {}, setPaused: () => {}, seek: (frac) => seeks.push(frac),
    });
    driver.seekTo(120);
    // No duration yet → we still remember the target so a resume can use it.
    assert.equal(Math.round(driver.currentTime()), 120);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test src/playback/drivers/vlcDriver.test.js`
Expected: FAIL — `driver.seekTo` is not a function.

- [ ] **Step 3: Implement `seekTo`/`seekBy` in `vlcDriver`**

In `src/playback/drivers/vlcDriver.js`, add after `setQualityCap()` (after line 123):

```js
  // ── transport ────────────────────────────────────────────────────────────
  /**
   * Seek to an absolute position (seconds). <VLCPlayer>.seek takes a FRACTION,
   * so convert via the known duration. Update lastPositionSec + pendingStartSec
   * SYNCHRONOUSLY first: a recovery RELOAD reads currentTime()/uses the pending
   * start, and must land on the NEW position, not the stale pre-scrub one.
   * @param {number} sec
   */
  function seekTo(sec) {
    if (typeof sec !== 'number' || !Number.isFinite(sec)) return;
    const target = Math.max(0, sec);
    lastPositionSec = target;
    pendingStartSec = target; // so a reload before the next progress tick resumes here
    didSeek = false;          // allow the resume seek to re-fire after a reload
    if (lastDurationSec > 0) {
      const frac = Math.max(0, Math.min(1, target / lastDurationSec));
      try { handle.seek(frac); } catch { /* noop */ }
    }
  }
  /** @param {number} delta seconds (may be negative) */
  function seekBy(delta) {
    if (typeof delta !== 'number' || !Number.isFinite(delta)) return;
    seekTo(currentTime() + delta);
  }
```

- [ ] **Step 4: Add methods + capabilities to the returned driver**

In the `driver` object (lines 226–240), add `seekTo, seekBy` and a `capabilities` descriptor. Volume/rate remain prop-driven → `false`:

```js
  /** @type {PlayerDriver} */
  const driver = {
    load,
    play,
    pause,
    destroy,
    seekTo,
    seekBy,
    currentTime,
    duration,
    buffered,
    isLive,
    setQualityCap,
    capabilities: { canSeek: true, canSetRate: false, canSetVolume: false, canNudge: false },
    onStatus,
    onProgress,
    onStall,
    onError,
  };
```

- [ ] **Step 5: Extend the contract test for vlc**

In `contract.test.js`, add:

```js
  test('vlc capabilities match implemented methods (rate/volume are prop-driven → absent)', () => {
    const { vlc } = buildAll();
    assertCapabilityGating(vlc, 'vlc');
  });
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test src/playback/drivers/vlcDriver.test.js` then `node --test src/playback/drivers/contract.test.js`
Expected: PASS. (`assertCapabilityGating` confirms `setVolume`/`setRate` are absent, matching `canSetVolume/canSetRate: false`.)

- [ ] **Step 7: Full suite + lint + commit**

Run: `npm test` then `npm run lint`

```bash
git add src/playback/drivers/vlcDriver.js src/playback/drivers/vlcDriver.test.js src/playback/drivers/contract.test.js
git commit -m "feat(vlc): resume-correct seekTo/seekBy through the driver + capabilities"
```

---

### Task 7: Delegate transport through `liveRouterDriver`

**Files:**
- Modify: `src/playback/drivers/liveRouterDriver.js`
- Test: `src/playback/drivers/contract.test.js` (extend)

**Interfaces:**
- Produces: `seekTo`/`seekBy`/`setVolume`/`setRate` on the router, each delegating to the active engine, plus `capabilities: { canSeek: true, canSetRate: true, canSetVolume: true, canNudge: true }` (both sub-drivers are element-based and implement them; `nudge` lands in Task 9).

- [ ] **Step 1: Extend the contract test for liveRouter**

In `contract.test.js`:

```js
  test('liveRouter capabilities match delegated methods', () => {
    const { liveRouter } = buildAll();
    assertCapabilityGating(liveRouter, 'liveRouter');
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test src/playback/drivers/contract.test.js`
Expected: FAIL — router has no `capabilities`/`seekTo`.

- [ ] **Step 3: Add delegating transport + capabilities to the router**

In `src/playback/drivers/liveRouterDriver.js`, inside the returned object (after `setQualityCap`, line 110), add:

```js
    seekTo: (sec) => active.seekTo?.(sec),
    seekBy: (delta) => active.seekBy?.(delta),
    setVolume: (v) => active.setVolume?.(v),
    setRate: (r) => active.setRate?.(r),
    capabilities: { canSeek: true, canSetRate: true, canSetVolume: true, canNudge: false },
```

- [ ] **Step 4: Run the contract test, full suite, lint**

Run: `node --test src/playback/drivers/contract.test.js` (PASS), then `npm test`, `npm run lint`.

- [ ] **Step 5: Commit**

```bash
git add src/playback/drivers/liveRouterDriver.js src/playback/drivers/contract.test.js
git commit -m "feat(liveRouter): delegate seekTo/seekBy/setVolume/setRate to the active engine"
```

---

### Task 8: Route screen transport writes through the driver

**Files:**
- Modify: `src/playback/drivers/expoVideoDriver.js` (drop the finite precondition in `seekTo`)
- Modify: `src/playback/usePlayer.js` (expose `seekTo`/`seekBy` on the public API)
- Modify: `src/screens/VlcPlayerScreen.native.jsx` (lines ~406, ~423: `vlcRef…seek` → `driver.seekTo`)
- Modify: `src/screens/VideoPlayerScreen.web.jsx` (seek handler → `player.seekTo`)
- Modify: `src/screens/VideoPlayerScreen.tv.jsx` (line ~742: `videoRef.current.currentTime = …` → `player.seekTo`)

**Interfaces:**
- Consumes: `usePlayer` already returns `notifyPause`/`notifyPlay` (pattern to mirror) and holds the driver in a ref.
- Produces: `usePlayer(...)` returns `seekTo(sec)` and `seekBy(delta)` that call the driver's methods. All screen seek call sites route through the driver so `savedTime` stays correct.

- [ ] **Step 1: Drop the finite-currentTime precondition in `expoVideoDriver.seekTo`**

In `src/playback/drivers/expoVideoDriver.js`, `seekTo` (around line 424) currently guards on `Number.isFinite(player.currentTime)` before writing. Remove that precondition so a mid-session scrub is attempted inside the existing try/catch. Confirm the final shape is:

```js
  function seekTo(sec) {
    const target = typeof sec === 'number' && Number.isFinite(sec) && sec > 0 ? sec : 0;
    pendingSeekSec = target;
    lastGoodTime = target;
    try {
      if (player) player.currentTime = target;
    } catch { /* setter can throw during teardown; pendingSeekSec re-applies on load */ }
  }
```

Also add `canNudge: false` to the expo driver's `capabilities` if it does not already expose one; add `capabilities: { canSeek: true, canSetRate: true, canSetVolume: true, canNudge: false }` to its returned object (near line 611) so the contract test can include expo later. (If the expo driver is not built in `contract.test.js`'s `buildAll()` because it needs a real `useVideoPlayer` instance, leave the contract test as-is and just add the descriptor for runtime consumers.)

- [ ] **Step 2: Add a failing test for the usePlayer seek passthrough**

`usePlayer` is a React hook; test its seek delegation with a fake driver via the machine host is heavy. Instead, assert the contract at the driver level is already covered (Tasks 4–7) and treat the screen wiring as on-device-verified. Add one focused unit test for the pure clamp helper used by TV/web seek if you introduce one; otherwise skip a unit test here and rely on the driver tests + the on-device checklist in Step 7. Document this explicitly in the commit body.

- [ ] **Step 3: Expose `seekTo`/`seekBy` from `usePlayer`**

In `src/playback/usePlayer.js`, mirror the existing `notifyPause`/`notifyPlay` pattern. Near where those are defined, add:

```js
  const seekTo = useCallback((sec) => { driverRef.current?.seekTo?.(sec); }, []);
  const seekBy = useCallback((delta) => { driverRef.current?.seekBy?.(delta); }, []);
```

and add `seekTo, seekBy` to the object `usePlayer` returns. (If the local driver ref has a different name than `driverRef`, use that name — it is the same ref the hook already uses to call `driver.play()/pause()`.)

- [ ] **Step 4: Route the VLC screen seek call sites through the driver**

In `src/screens/VlcPlayerScreen.native.jsx`, the screen has `driver` from `createVlcDriver(handle)` (line 169). Replace the two direct `vlcRef.current?.seek?.(…)` seek call sites:

- Line ~406 (`commitScrub`-style handler): replace
  ```js
  vlcRef.current?.seek?.(clamped / dur);
  ```
  with
  ```js
  driver.seekTo(clamped);
  ```
- Line ~423 (double-tap / gesture seek): replace
  ```js
  vlcRef.current?.seek?.(frac);
  ```
  with the seconds-based equivalent — compute the target seconds already available at that site (it currently derives `frac`); pass the seconds value to `driver.seekTo(targetSec)`. If only a fraction is in scope there, convert with the known duration: `driver.seekTo(frac * dur)`.

Leave the `handle.seek` used internally by the driver untouched (that is the driver→component channel).

- [ ] **Step 5: Route the web + TV seek call sites through the driver**

- `src/screens/VideoPlayerScreen.web.jsx`: the web seek currently flows through `useWebVideoControls().seekWebToClientX` (sets `video.currentTime` in `playerFeatures.js:103`). Change the web seek handler to also call `player.seekTo(ratio * duration)` (from `usePlayer`) so the machine's saved position updates. Keep the element write for immediate visual response, or replace it with `player.seekTo` — prefer `player.seekTo` as the single path.
- `src/screens/VideoPlayerScreen.tv.jsx` line ~742: replace
  ```js
  videoRef.current.currentTime = ratio * tvDuration;
  ```
  with
  ```js
  player.seekTo(ratio * tvDuration);
  ```

- [ ] **Step 6: Run the full suite + lint**

Run: `npm test` then `npm run lint`
Expected: all pass (driver-level tests already cover seek correctness; screens are unit-untested).

- [ ] **Step 7: On-device verify (record results in the commit body)**

Verify on a real device/build per platform — this is the acceptance gate for Task 8:
1. **VLC (native, e.g. an .mkv title):** start playback, scrub to a new position, and immediately trigger a reload (toggle airplane mode briefly or background→foreground). Playback must resume at the **new** scrubbed position, not the pre-scrub one.
2. **Web/Electron:** same scrub-then-reload check on a VOD title.
3. **TV:** same scrub-then-reload check; confirm FF/REW still work.

- [ ] **Step 8: Commit**

```bash
git add src/playback/drivers/expoVideoDriver.js src/playback/usePlayer.js src/screens/VlcPlayerScreen.native.jsx src/screens/VideoPlayerScreen.web.jsx src/screens/VideoPlayerScreen.tv.jsx
git commit -m "fix(player): route screen seek through the driver so reload resumes at the scrubbed position"
```

---

## Sub-project 4 — live-aware recovery ladder + nudge

### Task 9: Add the `NUDGE` rung + live/VOD retry budget to `recoveryMachine`

**Files:**
- Modify: `src/playback/recoveryMachine.js`
- Test: `src/playback/recoveryMachine.test.js` (extend)

**Interfaces:**
- Produces: a new effect `{ type: 'NUDGE' }`; a new constant `NUDGE_WINDOW_MS`; a new state field `nudged: boolean`; `maxLoadAttempts(isLive)` semantics (`isLive ? 3 : 1`). The host (Task 10) handles the `NUDGE` effect by calling `driver.nudge()`.

- [ ] **Step 1: Write the failing tests**

Append to `src/playback/recoveryMachine.test.js`:

```js
import { NUDGE_WINDOW_MS } from './recoveryMachine.js';

describe('live-aware recovery ladder + nudge', () => {
  const playing = (over = {}) => ({ ...initialState({ isLive: true }), state: 'playing', savedTime: 100, ...over });

  test('first STALL emits NUDGE (not a teardown reload) and schedules the nudge window', () => {
    const { state, effects } = reduce(playing(), { type: 'STALL' });
    const kinds = effects.map((e) => e.type);
    assert.ok(kinds.includes('NUDGE'), 'first stall should nudge');
    assert.ok(!kinds.includes('RELOAD'), 'first stall must not reload');
    const sched = effects.find((e) => e.type === 'SCHEDULE_RETRY');
    assert.equal(sched.delayMs, NUDGE_WINDOW_MS, 'nudge window drives the escalation timer');
    assert.equal(state.nudged, true);
  });

  test('after a nudge, the escalation RETRY performs the reload', () => {
    const s1 = reduce(playing(), { type: 'STALL' }).state;
    const { state, effects } = reduce(s1, { type: 'RETRY' });
    const reload = effects.find((e) => e.type === 'RELOAD');
    assert.ok(reload, 'escalation retry must reload');
    assert.equal(reload.toLiveEdge, true, 'live reload goes to the edge');
    assert.equal(state.attemptCount, 1);
  });

  test('a second STALL (already nudged) goes straight to the reload ladder', () => {
    const s1 = reduce(playing(), { type: 'STALL' }).state;       // nudged
    const s2 = reduce(s1, { type: 'PROGRESS', currentTime: 100.01 }).state; // still frozen → stays recovering
    const { effects } = reduce(s2, { type: 'STALL' });
    assert.ok(effects.some((e) => e.type === 'SHOW_RECONNECTING'), 'second stall shows reconnecting');
    assert.ok(effects.some((e) => e.type === 'SCHEDULE_RETRY'), 'second stall schedules a retry');
  });

  test('live gets up to 3 reload attempts before fatal; VOD gets 1', () => {
    // VOD: attemptCount already 1 → next STALL is fatal.
    const vod = { ...initialState({ isLive: false }), state: 'recovering', savedTime: 10, attemptCount: 1, nudged: true };
    assert.equal(reduce(vod, { type: 'STALL' }).state.state, 'fatal');
    // Live: attemptCount 1 and 2 still recover; only 3 is fatal.
    const live2 = { ...initialState({ isLive: true }), state: 'recovering', attemptCount: 2, nudged: true };
    assert.equal(reduce(live2, { type: 'STALL' }).state.state, 'recovering');
    const live3 = { ...initialState({ isLive: true }), state: 'recovering', attemptCount: 3, nudged: true };
    assert.equal(reduce(live3, { type: 'STALL' }).state.state, 'fatal');
  });

  test('self-recovery via advancing PROGRESS resets attemptCount and clears the nudged flag', () => {
    const s = { ...initialState({ isLive: true }), state: 'recovering', savedTime: 50, attemptCount: 2, nudged: true };
    const { state, effects } = reduce(s, { type: 'PROGRESS', currentTime: 51 });
    assert.equal(state.state, 'playing');
    assert.equal(state.attemptCount, 0);
    assert.equal(state.nudged, false);
    assert.ok(effects.some((e) => e.type === 'CANCEL_RETRY'));
  });

  test('regression: STALL → PLAYING → PROGRESS ends with a CANCEL_RETRY (timer cleared)', () => {
    const s1 = reduce(playing(), { type: 'STALL' }).state;
    const s2 = reduce(s1, { type: 'PLAYING' });
    assert.ok(s2.effects.some((e) => e.type === 'CANCEL_RETRY'), 'PLAYING after a stall cancels the pending retry');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test src/playback/recoveryMachine.test.js`
Expected: FAIL — `NUDGE_WINDOW_MS` is undefined and no `NUDGE` effect is emitted.

- [ ] **Step 3: Add the constant, `nudged` field, and live-aware budget helper**

In `src/playback/recoveryMachine.js`:

- After `RETRY_BACKOFF` (line 65), add:
  ```js
  /**
   * How long (ms) to let a lightweight NUDGE try to heal a live stall before
   * escalating to a full teardown RELOAD. Reuses the retry timer as the
   * escalation clock: the first stall schedules SCHEDULE_RETRY(NUDGE_WINDOW_MS)
   * alongside the NUDGE; advancing PROGRESS cancels it (self-heal), else it fires
   * RETRY → RELOAD.
   */
  export const NUDGE_WINDOW_MS = 3000;
  ```
- In `initialState` (line 108), add `nudged: false,` to the returned object.
- Replace `retriesExhausted` (lines 150–152) with a live-aware version:
  ```js
  /** VOD fast-fails after 1 attempt; live tolerates a few blips before fatal. */
  export function maxLoadAttempts(isLive) { return isLive ? 3 : 1; }
  function retriesExhausted(s) { return s.attemptCount >= maxLoadAttempts(s.isLive); }
  ```

- [ ] **Step 4: Add the nudge-first branch to the `STALL` handler**

Replace the `STALL` case (lines 280–303) with:

```js
    case 'STALL': {
      if (s.userPaused) {
        // Paused stalls are not real stalls.
        return { state: s, effects };
      }
      // A stall loop that never recovers is as fatal as a dead source.
      if (retriesExhausted(s)) return goFatal(s, 'UNPLAYABLE', effects);

      // First stall of this episode: try a lightweight nudge (re-prime /
      // seek-to-edge, no teardown) before the heavy RELOAD that blanks the
      // frame. Reuse the retry timer as the escalation clock — if PROGRESS
      // advances within NUDGE_WINDOW_MS the CANCEL_RETRY path fires; otherwise
      // RETRY → RELOAD escalates.
      if (!s.nudged) {
        const next = { ...s, state: 'buffering', nudged: true };
        effects.push({ type: 'NUDGE' });
        effects.push({ type: 'SCHEDULE_RETRY', delayMs: NUDGE_WINDOW_MS });
        return { state: next, effects };
      }

      const streak = s.bufferingStreak + 1;
      let next = { ...s, state: 'recovering', bufferingStreak: streak };
      effects.push({ type: 'SHOW_RECONNECTING' });
      if (streak >= BUFFERING_DOWNGRADE_THRESHOLD) {
        const steppedCap = stepCap(s.qualityCap, 'down', s.manualCap);
        next = { ...next, qualityCap: steppedCap, bufferingStreak: 0 };
        if (steppedCap !== s.qualityCap) {
          effects.push({ type: 'SET_QUALITY_CAP', cap: steppedCap });
        }
      }
      effects.push(scheduleRetryEffect(next));
      return { state: next, effects };
    }
```

- [ ] **Step 5: Reset `nudged` + `attemptCount` on self-recovery, and clear `nudged` on fresh load**

- In the `PROGRESS` recovering/buffering self-recovery block (lines 254–257), add `attemptCount: 0` and `nudged: false` to the state produced when time advances. Change:
  ```js
      if (s.state === 'recovering' || s.state === 'buffering') {
        effects.push({ type: 'HIDE_RECONNECTING' });
        effects.push({ type: 'CANCEL_RETRY' });
      }
  ```
  to also reset the counters — build `next` with them:
  ```js
      if (s.state === 'recovering' || s.state === 'buffering') {
        effects.push({ type: 'HIDE_RECONNECTING' });
        effects.push({ type: 'CANCEL_RETRY' });
        next = { ...next, attemptCount: 0, nudged: false };
      }
  ```
  (`next` is declared just above at line 251 as `let next = { ...s, savedTime: t, state: 'playing' };`.)
- In the `PLAYING` case (lines 195–212), add `nudged: false` to the `next` object so a clean resume clears the flag.
- In the `LOAD` case (lines 186–190), add `nudged: false` to the state so a fresh source starts un-nudged. (`RESET` already rebuilds via `initialState`, which now defaults `nudged:false`.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test src/playback/recoveryMachine.test.js`
Expected: PASS — all new cases green and the existing suite unaffected.

- [ ] **Step 7: Full suite + lint + commit**

Run: `npm test` then `npm run lint`

```bash
git add src/playback/recoveryMachine.js src/playback/recoveryMachine.test.js
git commit -m "feat(recovery): nudge rung before reload + live-aware retry budget"
```

---

### Task 10: Run the `NUDGE` effect in the host + implement `nudge()` on the drivers

**Files:**
- Modify: `src/playback/useResilientPlayback.js` (handle the `NUDGE` effect)
- Modify: `src/playback/drivers/hlsDriver.js`, `mpegtsDriver.js`, `vlcDriver.js`, `expoVideoDriver.js`, `liveRouterDriver.js` (add `nudge()` + flip `canNudge: true`)
- Test: `src/playback/drivers/contract.test.js` (capabilities already assert `canNudge ⇔ nudge`)

**Interfaces:**
- Consumes: the `{ type: 'NUDGE' }` effect from Task 9; each driver's existing internals (`hls()`, `el()`, `seekToLiveEdge()`, `handle.seek`, `player`).
- Produces: `driver.nudge()` on every engine + `capabilities.canNudge: true`; the host calls `d.nudge?.()` on the `NUDGE` effect.

- [ ] **Step 1: Handle the `NUDGE` effect in `useResilientPlayback`**

In `src/playback/useResilientPlayback.js`, add a case to `runEffect`'s switch (near the `RELOAD` case, after line 140):

```js
        case 'NUDGE':
          // Lightweight recovery: re-prime / seek-to-edge without a teardown
          // reload. Best-effort — a driver without canNudge simply no-ops and
          // the scheduled escalation RETRY handles it.
          try { d?.nudge?.(); } catch { /* noop */ }
          break;
```

- [ ] **Step 2: Implement `nudge()` on `hlsDriver` and flip the capability**

In `src/playback/drivers/hlsDriver.js`, add after the transport methods from Task 4:

```js
  /**
   * Nudge recovery: ask hls.js to resume loading and re-seek toward the live
   * edge (live) or the buffered edge (VOD) WITHOUT destroying the instance.
   */
  function nudge() {
    const inst = hls();
    try { inst?.startLoad?.(); } catch { /* noop */ }
    try {
      if (isLive()) {
        seekToLiveEdge();
      } else {
        const videoEl = el();
        const b = videoEl?.buffered;
        if (b && b.length > 0) {
          const end = b.end(b.length - 1);
          if (Number.isFinite(end) && end > currentTime()) videoEl.currentTime = Math.min(end, currentTime() + 0.5);
        }
      }
    } catch { /* noop */ }
  }
```

Add `nudge,` to the returned object and set `canNudge: true` in its `capabilities`.

- [ ] **Step 3: Implement `nudge()` on `mpegtsDriver`**

In `mpegtsDriver.js`, add:

```js
  /** Nudge: reload the mpegts.js buffer + jump to the buffered edge (no teardown). */
  function nudge() {
    try {
      const videoEl = el();
      const b = videoEl?.buffered;
      if (b && b.length > 0) {
        const end = b.end(b.length - 1);
        if (Number.isFinite(end) && end > 0) videoEl.currentTime = end;
      }
    } catch { /* noop */ }
    try { player?.play?.().catch?.(() => {}); } catch { /* noop */ }
  }
```

Add `nudge,` to the returned object and set `canNudge: true`.

- [ ] **Step 4: Implement `nudge()` on `vlcDriver`**

In `vlcDriver.js`, add:

```js
  /** Nudge: re-seek to the current position to jog a stalled decoder (no reload). */
  function nudge() {
    if (lastDurationSec > 0) {
      const frac = Math.max(0, Math.min(1, lastPositionSec / lastDurationSec));
      try { handle.seek(frac); } catch { /* noop */ }
    }
    play();
  }
```

Add `nudge,` to the `driver` object and set `canNudge: true`.

- [ ] **Step 5: Implement `nudge()` on `expoVideoDriver`**

In `expoVideoDriver.js`, add a `nudge()` that seeks slightly forward / to live edge and resumes:

```js
  function nudge() {
    try {
      if (loadedIsLive) {
        // Re-snap toward the live edge if the engine exposes it; else small hop.
        seekTo(currentTime() + 0.5);
      } else {
        seekTo(currentTime() + 0.25);
      }
      player?.play?.();
    } catch { /* noop */ }
  }
```

(Use the driver's existing live flag — if it is named other than `loadedIsLive`, use that; the expo driver stores `isLive` from `load()`.) Add `nudge,` to the returned object and set `canNudge: true` in its capabilities.

- [ ] **Step 6: Delegate `nudge()` in `liveRouterDriver` + flip its capability**

In `liveRouterDriver.js`, add to the returned object:

```js
    nudge: () => active.nudge?.(),
```

and set `canNudge: true` in the router's `capabilities`.

- [ ] **Step 7: Run the contract test + full suite + lint**

Run: `node --test src/playback/drivers/contract.test.js`
Expected: PASS — every driver now advertises `canNudge: true` and implements `nudge()` (the gating assertion `canNudge ⇔ nudge` holds).
Then `npm test` and `npm run lint`.

- [ ] **Step 8: On-device verify (acceptance gate for Task 10)**

On a real live channel that stalls intermittently (or simulate by briefly throttling the network):
1. A short live blip should heal **without** the frame going black and without a full "Reconnecting" teardown on the first stall (the nudge rung).
2. If the blip persists past ~3s, the normal reload path takes over and, for live, tolerates up to 3 attempts before the fatal panel.
3. VOD still fast-fails (1 attempt) on a genuinely dead source.

- [ ] **Step 9: Commit**

```bash
git add src/playback/useResilientPlayback.js src/playback/drivers/hlsDriver.js src/playback/drivers/mpegtsDriver.js src/playback/drivers/vlcDriver.js src/playback/drivers/expoVideoDriver.js src/playback/drivers/liveRouterDriver.js src/playback/drivers/contract.test.js
git commit -m "feat(recovery): implement driver nudge() on all engines + host wiring"
```

---

## Self-Review

**Spec coverage:**
- Sub-project 1 (mpegts gate + router watchdog) → Tasks 1–2. ✓
- Sub-project 2 (contract + conformance + dead-API disposition) → Task 3. ✓
- Sub-project 3 (transport parity through the driver) → Tasks 4–8. ✓ (`seekTo`/`seekBy`/`setVolume`/`setRate` on hls/mpegts/vlc/liveRouter + screen rerouting + expo finite-guard drop.)
- Sub-project 4 (live-aware recovery ladder + nudge) → Tasks 9–10. ✓ (`NUDGE` effect + window, live/VOD budget, `attemptCount`/`nudged` reset, driver `nudge()` on every engine, host wiring.)
- Manual `retry()` stays single-fast-attempt → documented in Task 3 Step 5. ✓
- Testing/on-device gates → present on every screen-touching task (8, 10). ✓

**Placeholder scan:** No "TBD"/"handle appropriately". Two spots depend on a local name the implementer confirms in-file (`usePlayer` driver ref name in Task 8 Step 3; expo live flag name in Task 10 Step 5) — both name the fallback and how to resolve it, with the exact pattern to copy. Task 8 Step 2 explicitly states why there is no host unit test (React hook; covered by driver tests + on-device gate) rather than leaving a hollow test stub.

**Type consistency:** `capabilities: { canSeek, canSetRate, canSetVolume, canNudge }` is used identically across types.js, all five drivers, and `contract.test.js`'s `CAPABILITY_METHODS`. `NUDGE_WINDOW_MS`, `nudged`, `maxLoadAttempts(isLive)`, and the `{ type: 'NUDGE' }` effect names match between `recoveryMachine.js`, its test, and the host's `runEffect`. `seekTo(sec)` (seconds, absolute) is consistent everywhere; VLC converts seconds→fraction internally.

**Known scope boundary (honest):** the nudge uses the existing `buffering` state, so on the first stall the screens' current busy overlay may still show their "Reconnecting" treatment (isRecovering includes `buffering`). This slice lands the mechanism that avoids the *teardown + black frame* on the first stall; the finer "quiet buffering spinner vs. Reconnecting text" visual split rides with the deferred transient-buffering UX slice (roadmap seq 8) and is out of scope here.
