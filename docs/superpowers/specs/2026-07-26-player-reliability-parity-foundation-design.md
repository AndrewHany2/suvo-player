# Player Reliability + Parity Foundation — Design

- **Date:** 2026-07-26
- **Status:** Approved (design), pending implementation plan
- **Slice:** A of the player best-practices roadmap (reliability + parity foundation; roadmap sequences 1–4)
- **Branch:** `feat/player-reliability-parity-foundation`

## Background

The engine-agnostic playback stack is `recoveryMachine.js` (pure reducer) → `PlayerDriver`
contract (`drivers/types.js`) → `useResilientPlayback.js` (React host), with `usePlayer.js`
wrapping the host for web/TV. Engines live behind drivers: `expoVideoDriver` (native),
`vlcDriver` (native mkv/avi/flv/wmv/webm), `hlsDriver`/`mpegtsDriver`/`liveRouterDriver`
(web/TV).

A best-practices audit (51 findings across reliability, UX, performance, parity, and
engine-API lanes) surfaced that recent transport/resume work landed on **expo-video only**,
and that several correctness gaps bite exactly the flaky-IPTV case the recovery machine
exists to serve. This slice fixes the reliability/parity **correctness** gaps and lays the
contract foundation later UX/performance slices build on. Live-edge UX (roadmap seq 7),
steady-state re-render/poll consolidation (seq 6/11), and poster/buffering UX (seq 8) are
explicitly **out of scope** here.

## Principles

- The recovery machine stays **pure**; all engine differences live behind the driver contract.
- Every driver is proven to honor the contract by one shared conformance test.
- Native `.native.jsx` screens are not covered by `node:test`; any change touching them ends
  with an **explicit on-device verify step**, never a claim of done.
- `npm test` + `npm run lint` gate every sub-project (warnings OK, errors not).

## Scope — four sub-projects, built in dependency order

Order: **1 → 2 → 3 → 4**. The contract/conformance test (sub-project 2) lands before the
transport and nudge work so it guards them.

---

### Sub-project 1 — mpegts first-frame gate + router watchdog ownership (effort S)

**Problem.** `hlsDriver.onStall` and `expoVideoDriver.onStall` gate their stall watchdog on a
`hasStartedPlaying` flag; `mpegtsDriver.onStall` does not. A slow raw-MPEG-TS first frame on
a weak TV (>6 s while the demuxer primes ~384 KB) is therefore misread as a mid-playback
freeze and triggers the `Reconnecting → reload → black` loop the gate exists to prevent.
`liveRouterDriver` hard-binds `onStall` to the hls sub-driver, so the gate is correct only by
accident when the router is on hls and latent/incorrect across an hls→mpegts switch.

**Design.**
- Add driver-scoped `hasStartedPlaying` to `mpegtsDriver`:
  - reset `false` in `load()`,
  - set `true` on the media element `playing` event,
  - in the `onStall` watchdog, before the fire check:
    `if (!hasStartedPlaying) { lastAdvance = now; lastTime = t; return; }`
  - structurally identical to `hlsDriver.onStall`.
- In `liveRouterDriver`, make watchdog ownership explicit: **rebind** `onStall`/`onStatus`/
  `onProgress` to the active engine on switch, mirroring the existing `onError` rebind, so the
  gate always follows whichever engine is currently live.

**Tests.**
- New `mpegtsDriver.test.js`: a slow first frame (flat `currentTime` >6 s, not paused) does
  **not** fire the stall callback while `!hasStartedPlaying`; once playing, a genuine freeze
  does fire.
- `liveRouterDriver` test: after switching to mpegts, a slow first frame does not fire `STALL`.

---

### Sub-project 2 — driver contract + conformance test + dead-API disposition (effort M)

**Problem.** `types.js` is JSDoc-only with optional bracketed methods and a null reference
export, so nothing at build/test time catches a driver omitting a method a screen calls —
the root testability gap that let transport parity drift. Separately, `useResilientPlayback`
returns `currentTime` (`machine.savedTime`) and `duration` (`driver.duration()`) that **no
screen consumes** (each screen maintains its own display clock).

**Design.**
- Add a **capabilities descriptor** to the contract: `capabilities: { canSeek, canSetRate,
  canSetVolume, canNudge }`.
- Mandatory methods: `load`, `onStatus`, `onError`, `onStall`, `onProgress`, `duration`,
  `destroy`. Everything else is capability-gated.
- New `drivers/contract.test.js`: iterate every factory (expo/vlc/hls/mpegts/liveRouter),
  assert all mandatory methods exist, and that each capability-gated method is present **iff**
  its capability flag is `true`.
- **Dead-API disposition:** keep `currentTime`/`duration` on the public API but mark them
  `@internal`/reserved in the JSDoc, and add a note in `docs/ARCHITECTURE.md` that screens
  still own their display clock. Making screens consume `playback.currentTime` as the single
  seek-bar source of truth is a **performance** change (it interacts with the ~1 Hz
  re-render) and belongs to a later performance slice; we do not want to churn the screens
  twice. No behavior change in this slice.

---

### Sub-project 3 — transport parity through the driver (effort L)

**Problem.** `seekTo`/`seekBy`/`setVolume`/`setRate` exist only on `expoVideoDriver`.
`vlcDriver` implements none (`VlcPlayerScreen` calls `vlcRef.seek(frac)` and sets volume/rate
via props); `hlsDriver`/`mpegtsDriver`/`liveRouterDriver` implement none (web/TV write
`video.currentTime`/`playbackRate` directly via `playerFeatures.js` and
`VideoPlayerScreen.tv.jsx:742`). Because a raw DOM/`vlcRef` write does not update the
machine's `savedTime`, a recovery RELOAD landing in the sub-second window right after a scrub
resumes at the **stale pre-scrub position** on VLC and web/TV.

**Design.**
- Implement `seekTo`/`seekBy`/`setVolume`/`setRate` on `hlsDriver`, `mpegtsDriver`, and
  `vlcDriver`; `liveRouterDriver` delegates each to the active engine. Set each driver's
  `capabilities` flags accordingly.
- **Critical invariant:** every `seekTo(sec)` updates the driver's persisted resume position
  **synchronously before** the engine write, so a post-scrub RELOAD resumes at the *new*
  position on every engine:
  - VLC: set `lastPositionSec` (and `pendingStartSec`) before calling `handle.seek(sec/duration)`.
  - hls/mpegts: element `currentTime` write plus a `liveSyncPosition` clamp for live.
  - expo: already correct (`pendingSeekSec` + `lastGoodTime`).
- Route all screen transport writes through the driver: `VlcPlayerScreen`, web
  `playerFeatures.js` seek, and `VideoPlayerScreen.tv.jsx` seek/rate/volume call `driver.*`
  instead of raw refs/DOM.
- Fold in quick win: drop the `Number.isFinite(player.currentTime)` precondition in
  `expoVideoDriver.seekTo`; attempt the write inside the existing try/catch so a mid-session
  scrub is never silently lost.

**Tests.**
- `contract.test.js` covers presence of the four methods per capability flags.
- On-device verify: scrub-then-immediate-reload resumes at the new position on VLC (native),
  web, and TV.

---

### Sub-project 4 — live-aware recovery ladder + nudge (effort L)

**Problem.** `MAX_LOAD_ATTEMPTS = 1` is uniform across VOD and live. A live channel that
stalls, fires one non-sustained PROGRESS, then stalls again hits `retriesExhausted` and shows
a full-screen `UNPLAYABLE` panel for a provider blip. The only recovery move is a heavy
teardown RELOAD (hls destroy + reattach blanks the frame); there is no lightweight rung that
could heal a live stall without a black frame.

**Design (pure-reducer-first).**
- Add a **`NUDGE`** effect to `recoveryMachine`. On the **first** post-first-frame STALL, emit
  `NUDGE` instead of scheduling a RELOAD. If progress does not resume within a short window,
  escalate to the existing `SCHEDULE_RETRY` → `RELOAD` path.
- Drivers implement `nudge()` (capability-gated `canNudge`):
  - hls → `startLoad()` / seek to buffered edge (no destroy),
  - mpegts → equivalent light re-prime,
  - expo → small seek toward the live/buffered edge,
  - VLC → seek to the current buffered position.
  - If a driver lacks `canNudge`, the machine falls straight through to RELOAD (behavior
    identical to today for that engine).
- **Live vs VOD budget:** `MAX_LOAD_ATTEMPTS` becomes `isLive ? 3 : 1` (VOD unchanged
  fast-fail). Reset `attemptCount` on self-recovery (`HIDE_RECONNECTING`) so consecutive but
  separated live blips do not accumulate toward fatal.
- **Manual `retry()` stays single-fast-attempt** (explicit product decision): documented in
  the `useResilientPlayback` JSDoc and `docs/ARCHITECTURE.md`. A slow-backend case relies on
  the user re-tapping Reload.

**Tests.**
- Extend `recoveryMachine.test.js`:
  - first post-first-frame STALL emits `NUDGE`, not a reload;
  - nudge window elapses without progress → escalates to RELOAD;
  - live gets 3 reload attempts before fatal; VOD gets 1;
  - `attemptCount` resets on `HIDE_RECONNECTING`;
  - regression guard: `STALL → PLAYING → PROGRESS` always ends with the retry timer cleared,
    with a comment that PROGRESS throttling is safe only because PLAYING independently emits
    `CANCEL_RETRY`.

---

## Data flow (unchanged shape, extended vocabulary)

```
engine events ──▶ driver (onStatus/onError/onStall/onProgress)
                     │
                     ▼
        useResilientPlayback.send(event)
                     │
                     ▼
        recoveryMachine.reduce(state, event) ──▶ { state, effects }
                     │                                  │
     commit to React state                    runEffect: SCHEDULE_RETRY | RELOAD
                                                         | NUDGE (new) | SET_QUALITY_CAP
                                                         | REFRESH_CREDENTIALS | GO_FATAL | ...
                     ▲                                  │
     screen transport (seekTo/seekBy/setVolume/setRate) ┘  ──▶ driver.* (new: all engines)
```

New: a `NUDGE` effect that calls `driver.nudge()`; screen transport now always flows through
`driver.*` (never raw DOM/`vlcRef`), so `savedTime` is consistent for recovery.

## Error handling

- Nudge is best-effort: a `nudge()` that throws or whose engine lacks the capability
  degrades to the existing RELOAD path — never a dead end.
- `seekTo` writes inside try/catch and updates the persisted position first, so a failed
  engine write still leaves the machine's resume target correct.
- No change to fatal classification in this slice (that is a separate reliability item).

## Testing & sequencing summary

- Build order **1 → 2 → 3 → 4**; the contract test from sub-project 2 guards 3 and 4.
- `node:test` covers reducer + drivers + contract conformance.
- Three screen-touching changes need an on-device verify checklist in the implementation plan:
  1. native scrub-then-reload resume position (sub-project 3),
  2. live-blip self-heal via nudge without a black frame (sub-project 4),
  3. weak-TV mpegts cold start does not reload-loop (sub-project 1).
- `npm test` + `npm run lint` must pass for each sub-project before the next.

## Out of scope (deferred to later slices)

- Live-edge chrome / behind-live indicator / jump-to-live (roadmap seq 7).
- Steady-state re-render + poll consolidation (seq 6/11).
- Poster/last-frame + transient-buffering UX (seq 8).
- Offline-at-mount + auth-refresh-await correctness (seq 5).
- Orientation policy + cross-device offset consistency (seq 12).
- hls.js same-uri lifecycle reuse and CORS/ABR tuning beyond the transport work (seq 11).
