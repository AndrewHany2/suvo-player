// @ts-check
/**
 * Engine-agnostic resilient-playback reducer.
 *
 * PURE: `reduce(state, event) -> { state, effects }`. No timers, no I/O, no
 * React/hls/expo imports. The host (a hook) interprets the returned `effects`
 * (schedule a timer, reload the engine, refresh credentials, show UI...) and
 * feeds results back in as new events (RETRY, RECOVERED, ONLINE, ...).
 *
 * State machine:
 *   idle -> loading -> playing <-> buffering -> recovering -> (playing | fatal)
 *
 * Key behaviors:
 *  - ERROR is classified via errorClassifier.classifyError(raw):
 *      GONE                -> fatal (GO_FATAL).
 *      AUTH_EXPIRED        -> first time: REFRESH_CREDENTIALS + schedule retry;
 *                             a second consecutive AUTH_EXPIRED -> fatal.
 *      OFFLINE             -> recovering, retries suppressed until ONLINE.
 *      STALL/TRANSIENT/    -> recovering + SCHEDULE_RETRY(nextDelay(attemptCount)).
 *        MEDIA_DECODE
 *  - OFFLINE event behaves like an OFFLINE-classified error.
 *  - ONLINE while recovering -> RELOAD at saved position (toLiveEdge if live).
 *  - RETRY (host fired the scheduled timer) -> RELOAD; attemptCount increments
 *    so delays grow and cap. The ladder is bounded: MAX_LOAD_ATTEMPTS retries
 *    without ever reaching sustained playback -> fatal (GO_FATAL 'UNPLAYABLE'),
 *    so a dead 404 / undecodable source can't reconnect forever.
 *  - Buffering: K consecutive buffering episodes -> SET_QUALITY_CAP one rung down.
 *  - Sustained PLAYING (PROGRESS while playing) resets attemptCount, clears the
 *    buffering streak, and steps the quality cap back up one rung.
 *  - RELOAD selects toLiveEdge for live streams, seekTo(savedTime) for VOD.
 */

import { nextDelay } from './backoff.js';
import { classifyError, ErrorClass } from './errorClassifier.js';
import { stepCap } from './backoff.js';

/** Consecutive buffering episodes before stepping quality down. */
export const BUFFERING_DOWNGRADE_THRESHOLD = 3;

/**
 * How many retries a source may burn WITHOUT ever reaching sustained playback
 * before the machine gives up and goes fatal. `attemptCount` resets to 0 on
 * real progress (see PROGRESS), so this only bites a source that fails
 * identically on every attempt — a dead 404 link, or an undecodable codec on
 * the native <video> path whose error carries no HTTP status (so it can't be
 * classified GONE). Without this cap those loop "Reconnecting…" forever.
 *
 * Set to 1: a single fast retry (~0.35s via RETRY_BACKOFF), then surface. Most
 * failures here are a flaky provider handing out a bad backend node on the 302
 * redirect (HTTP 406 / hang); one re-request usually lands on a good node, so a
 * single quick retry heals the common blip. If it fails again we stop and show
 * the real error + a Reload button in ~1s rather than spinning — the user asked
 * to see the error fast and retry manually. (This budget is shared with
 * live-stall recovery; offline drops are handled separately via OFFLINE/ONLINE
 * and don't count against it.)
 */
export const MAX_LOAD_ATTEMPTS = 1;

/**
 * Backoff profile for playback retries. Deliberately tight (see MAX_LOAD_ATTEMPTS
 * rationale): a quick re-request is the recovery, so short delays get the user
 * back to playing sooner and reach the fatal/Retry surface fast when they won't.
 * @type {{base:number, factor:number, max:number}}
 */
export const RETRY_BACKOFF = { base: 350, factor: 2, max: 1500 };

/**
 * Minimum currentTime advance (seconds) that counts as real playback progress
 * while recovering/buffering. Absorbs sub-second poll jitter so a frozen,
 * stalled engine isn't misread as recovered.
 */
export const PROGRESS_EPSILON = 0.05;

/**
 * @typedef {'idle'|'loading'|'playing'|'buffering'|'recovering'|'fatal'} PlayerState
 */

/**
 * @typedef {Object} MachineState
 * @property {PlayerState} state            - Current state node.
 * @property {boolean} isLive               - Live stream vs VOD.
 * @property {number} savedTime             - Last known good currentTime (VOD resume).
 * @property {number} attemptCount          - Monotonic retry attempt counter.
 * @property {number} bufferingStreak       - Consecutive buffering episodes.
 * @property {boolean} credentialsRefreshed - True after one AUTH refresh, until recovery.
 * @property {boolean} offline              - Currently offline (suppress retries).
 * @property {string} qualityCap            - Current quality cap (see QUALITY_CAPS).
 * @property {string|undefined} manualCap   - User-pinned ceiling for quality.
 * @property {boolean} userPaused           - User explicitly paused.
 * @property {{reason:string, message?:string, httpStatus?:number}|null} [fatalError]
 *   - Details of the failure that drove the machine fatal, for the UI to show
 *     (reason + the raw engine/provider message + parsed HTTP status). Null
 *     until a GO_FATAL; reset by RESET/LOAD.
 */

/**
 * Build the initial state.
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.isLive=false]
 * @param {number}  [opts.startTime=0]
 * @param {string}  [opts.qualityCap='auto']
 * @param {string}  [opts.manualCap]
 * @returns {MachineState}
 */
export function initialState(opts = {}) {
  const { isLive = false, startTime = 0, qualityCap = 'auto', manualCap } = opts;
  return {
    state: 'idle',
    isLive: !!isLive,
    savedTime: startTime || 0,
    attemptCount: 0,
    bufferingStreak: 0,
    credentialsRefreshed: false,
    offline: false,
    qualityCap,
    manualCap,
    userPaused: false,
    fatalError: null,
  };
}

/**
 * Build a RELOAD effect appropriate for the stream type.
 * @param {MachineState} s
 * @returns {{type:'RELOAD', seekTo:(number|null), toLiveEdge:boolean}}
 */
function reloadEffect(s) {
  return s.isLive
    ? { type: 'RELOAD', seekTo: null, toLiveEdge: true }
    : { type: 'RELOAD', seekTo: s.savedTime || 0, toLiveEdge: false };
}

/**
 * Schedule-retry effect using exponential backoff for the current attempt.
 * @param {MachineState} s
 * @returns {{type:'SCHEDULE_RETRY', delayMs:number}}
 */
function scheduleRetryEffect(s) {
  return { type: 'SCHEDULE_RETRY', delayMs: nextDelay(s.attemptCount, RETRY_BACKOFF) };
}

/**
 * True when the source has burned the full retry ladder without ever reaching
 * sustained playback (attemptCount resets to 0 on real progress). Such a source
 * is effectively unplayable — retrying again would just loop forever.
 * @param {MachineState} s
 * @returns {boolean}
 */
function retriesExhausted(s) {
  return s.attemptCount >= MAX_LOAD_ATTEMPTS;
}

/**
 * Transition to the fatal state, emitting GO_FATAL for the host and stashing the
 * failure details on state so the UI can show the real error + a Reload button.
 * @param {MachineState} s
 * @param {string} reason
 * @param {Array<Object>} effects
 * @param {{message?: string, httpStatus?: number}} [info] - Raw error detail.
 * @returns {{state: MachineState, effects: Array<Object>}}
 */
function goFatal(s, reason, effects, info) {
  const message = info?.message;
  const httpStatus = info?.httpStatus;
  effects.push({ type: 'GO_FATAL', reason, message, httpStatus });
  return {
    state: { ...s, state: 'fatal', fatalError: { reason, message, httpStatus } },
    effects,
  };
}

/**
 * Pure reducer. Returns the next state plus a list of effects for the host.
 *
 * @param {MachineState} state
 * @param {{type:string, [k:string]:any}} event
 * @returns {{state: MachineState, effects: Array<Object>}}
 */
export function reduce(state, event) {
  const s = state;
  /** @type {Array<Object>} */
  const effects = [];

  switch (event.type) {
    case 'LOAD':
      return {
        state: { ...s, state: 'loading', userPaused: false, fatalError: null },
        effects,
      };

    case 'LOADED':
      return { state: { ...s, state: 'loading' }, effects };

    case 'PLAYING': {
      const wasRecovering = s.state === 'recovering' || s.state === 'buffering';
      const next = {
        ...s,
        state: 'playing',
        userPaused: false,
        // Recovered: clear the auth-refresh latch.
        credentialsRefreshed: false,
      };
      if (wasRecovering) {
        // We recovered on our own — hide the badge AND cancel any retry the
        // host scheduled for the stall, so it can't fire a stale RELOAD and
        // bounce us into a reload loop.
        effects.push({ type: 'HIDE_RECONNECTING' });
        effects.push({ type: 'CANCEL_RETRY' });
      }
      return { state: next, effects };
    }

    case 'PROGRESS': {
      const t = typeof event.currentTime === 'number' ? event.currentTime : s.savedTime;
      // Terminal / not-yet-started states are never advanced by the background
      // progress poll. A dead source (fatal) keeps its onProgress interval
      // firing PROGRESS at a frozen currentTime (typically 0); without this
      // guard that flips fatal->playing, hiding the "Failed to load stream"
      // panel and leaving a black "playing" frame instead of the actionable
      // Retry screen. `idle` likewise has nothing to advance, and `loading`
      // must reach `playing` via the PLAYING event (readyToPlay/canplay), not
      // via a frozen t=0 poll that would hide the loading spinner over black.
      if (s.state === 'fatal' || s.state === 'idle' || s.state === 'loading') {
        return { state: { ...s, savedTime: t }, effects };
      }
      // A stalled engine keeps polling `currentTime` at a frozen value. While
      // recovering/buffering, only *advancing* time proves the stream came back
      // — a repeated frozen sample must NOT be mistaken for recovery, or it
      // cancels the scheduled RELOAD and the retry ladder never runs. Stay put
      // and leave the pending retry armed. (~0.05s absorbs poll jitter.)
      if (
        (s.state === 'recovering' || s.state === 'buffering') &&
        t <= s.savedTime + PROGRESS_EPSILON
      ) {
        return { state: s, effects };
      }
      // Sustained progress while playing = stable: reset attempts, clear the
      // buffering streak, and step the quality cap back up one rung.
      let next = { ...s, savedTime: t, state: 'playing' };
      // Time advanced while recovering/buffering = the stream came back on its
      // own; cancel the pending retry and drop the reconnecting badge.
      if (s.state === 'recovering' || s.state === 'buffering') {
        effects.push({ type: 'HIDE_RECONNECTING' });
        effects.push({ type: 'CANCEL_RETRY' });
      }
      if (s.state === 'playing') {
        const steppedCap = stepCap(s.qualityCap, 'up', s.manualCap);
        next = {
          ...next,
          attemptCount: 0,
          bufferingStreak: 0,
          credentialsRefreshed: false,
          qualityCap: steppedCap,
        };
        if (steppedCap !== s.qualityCap) {
          effects.push({ type: 'SET_QUALITY_CAP', cap: steppedCap });
        }
      }
      return { state: next, effects };
    }

    case 'USER_PAUSE':
      return { state: { ...s, userPaused: true }, effects };

    case 'USER_PLAY':
      return { state: { ...s, userPaused: false }, effects };

    case 'STALL': {
      if (s.userPaused) {
        // Paused stalls are not real stalls.
        return { state: s, effects };
      }
      // A stall loop that never recovers is as fatal as a dead source.
      if (retriesExhausted(s)) return goFatal(s, 'UNPLAYABLE', effects);
      const streak = s.bufferingStreak + 1;
      let next = { ...s, state: 'recovering', bufferingStreak: streak };

      effects.push({ type: 'SHOW_RECONNECTING' });

      // K consecutive buffering episodes -> step quality down.
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

    case 'OFFLINE':
      return offlineTransition(s, effects);

    case 'ONLINE': {
      // Reconnected. If we were recovering due to offline, reload now.
      if (!s.offline) {
        return { state: s, effects };
      }
      const next = { ...s, offline: false, attemptCount: s.attemptCount + 1 };
      effects.push(reloadEffect(next));
      return { state: { ...next, state: 'loading' }, effects };
    }

    case 'RETRY': {
      // Host fired a scheduled retry timer. Suppress while offline.
      if (s.offline) {
        return { state: s, effects };
      }
      const next = { ...s, attemptCount: s.attemptCount + 1, state: 'loading' };
      effects.push(reloadEffect(next));
      return { state: next, effects };
    }

    case 'RECOVERED':
      effects.push({ type: 'HIDE_RECONNECTING' });
      effects.push({ type: 'CANCEL_RETRY' });
      return {
        state: {
          ...s,
          state: 'playing',
          attemptCount: 0,
          bufferingStreak: 0,
          credentialsRefreshed: false,
        },
        effects,
      };

    case 'ERROR':
      return errorTransition(s, event.raw, effects);

    case 'RESET':
      return {
        state: initialState({
          isLive: s.isLive,
          startTime: 0,
          qualityCap: s.manualCap || 'auto',
          manualCap: s.manualCap,
        }),
        effects,
      };

    default:
      return { state: s, effects };
  }
}

/**
 * Shared offline handling: enter recovering, suppress retries until ONLINE.
 * @param {MachineState} s
 * @param {Array<Object>} effects
 * @returns {{state: MachineState, effects: Array<Object>}}
 */
function offlineTransition(s, effects) {
  effects.push({ type: 'SHOW_RECONNECTING' });
  return {
    state: { ...s, state: 'recovering', offline: true },
    effects,
  };
}

/**
 * Handle ERROR by classifying the raw error and choosing a response.
 * @param {MachineState} s
 * @param {{original?: {message?: string}, message?: string, httpStatus?: number}} raw
 * @param {Array<Object>} effects
 * @returns {{state: MachineState, effects: Array<Object>}}
 */
function errorTransition(s, raw, effects) {
  const cls = classifyError(raw);
  // Preserve the real engine/provider error so the fatal UI can show it (the
  // raw message + parsed HTTP status), rather than only a generic line.
  const info = { message: raw?.original?.message ?? raw?.message, httpStatus: raw?.httpStatus };

  switch (cls) {
    case ErrorClass.GONE:
      return goFatal(s, 'GONE', effects, info);

    case ErrorClass.OFFLINE:
      return offlineTransition(s, effects);

    case ErrorClass.AUTH_EXPIRED: {
      if (s.credentialsRefreshed) {
        // Already refreshed once and still failing -> fatal.
        return goFatal(s, 'AUTH_EXPIRED', effects, info);
      }
      // First auth failure: refresh credentials, then retry.
      effects.push({ type: 'SHOW_RECONNECTING' });
      effects.push({ type: 'REFRESH_CREDENTIALS' });
      const next = { ...s, state: 'recovering', credentialsRefreshed: true };
      effects.push(scheduleRetryEffect(next));
      return { state: next, effects };
    }

    case ErrorClass.STALL: {
      if (retriesExhausted(s)) return goFatal(s, 'UNPLAYABLE', effects, info);
      // Treat like a stall episode (counts toward downgrade).
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

    case ErrorClass.MEDIA_DECODE:
    case ErrorClass.TRANSIENT_NETWORK:
    default: {
      // A 404 / undecodable source on the native <video> path arrives here with
      // no HTTP status (it can't be classified GONE); bound the ladder so it
      // surfaces a fatal error instead of reconnecting forever.
      if (retriesExhausted(s)) return goFatal(s, 'UNPLAYABLE', effects, info);
      const next = { ...s, state: 'recovering' };
      effects.push({ type: 'SHOW_RECONNECTING' });
      effects.push(scheduleRetryEffect(next));
      return { state: next, effects };
    }
  }
}
