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
 *    monotonically so delays grow and cap, retrying indefinitely.
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
  return { type: 'SCHEDULE_RETRY', delayMs: nextDelay(s.attemptCount) };
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
        state: { ...s, state: 'loading', userPaused: false },
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
 * @param {Object} raw
 * @param {Array<Object>} effects
 * @returns {{state: MachineState, effects: Array<Object>}}
 */
function errorTransition(s, raw, effects) {
  const cls = classifyError(raw);

  switch (cls) {
    case ErrorClass.GONE:
      effects.push({ type: 'GO_FATAL', reason: 'GONE' });
      return { state: { ...s, state: 'fatal' }, effects };

    case ErrorClass.OFFLINE:
      return offlineTransition(s, effects);

    case ErrorClass.AUTH_EXPIRED: {
      if (s.credentialsRefreshed) {
        // Already refreshed once and still failing -> fatal.
        effects.push({ type: 'GO_FATAL', reason: 'AUTH_EXPIRED' });
        return { state: { ...s, state: 'fatal' }, effects };
      }
      // First auth failure: refresh credentials, then retry.
      effects.push({ type: 'SHOW_RECONNECTING' });
      effects.push({ type: 'REFRESH_CREDENTIALS' });
      const next = { ...s, state: 'recovering', credentialsRefreshed: true };
      effects.push(scheduleRetryEffect(next));
      return { state: next, effects };
    }

    case ErrorClass.STALL: {
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
      const next = { ...s, state: 'recovering' };
      effects.push({ type: 'SHOW_RECONNECTING' });
      effects.push(scheduleRetryEffect(next));
      return { state: next, effects };
    }
  }
}
