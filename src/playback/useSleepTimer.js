// @ts-check
/**
 * useSleepTimer — a countdown "sleep timer" for the player.
 *
 * Counts down once per second with setInterval. When it reaches zero it calls
 * the supplied `onElapsed` callback (the player will pause + close) and then
 * deactivates itself. The interval is always torn down on unmount, on cancel,
 * and whenever a fresh timer is started, so it can never leak or double-fire.
 *
 * The hook is engine-agnostic: it owns only wall-clock countdown state and
 * leaves the "what happens at zero" decision to the caller.
 *
 * Offered presets are exported as SLEEP_PRESETS. The special 'end-of-episode'
 * option does not have a fixed minute count — the player decides when the
 * episode ends and calls cancel()/start() accordingly — so start() accepts a
 * numeric minute value and the UI maps the 'end-of-episode' choice to its own
 * end-of-media handler. We still surface it here as a documented preset.
 *
 * @typedef {Object} SleepTimerApi
 * @property {boolean} active            Whether a countdown is currently running.
 * @property {number}  minutesLeft       Whole minutes remaining (ceil of secondsLeft).
 * @property {number}  secondsLeft       Exact seconds remaining (0 when inactive).
 * @property {(minutes: number) => void} start  Begin/replace a countdown for `minutes`.
 * @property {() => void} cancel         Stop and clear the countdown.
 * @property {(minutes: number) => void} extend Add `minutes` to the remaining time
 *                                              (starts a timer if none is active).
 */

import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Selectable sleep-timer presets for the UI. Numeric `minutes` are fixed
 * durations; `end-of-episode` is a sentinel the player maps to its own
 * end-of-media handler (no fixed duration).
 * @readonly
 */
export const SLEEP_PRESETS = Object.freeze([
  { label: '15 minutes', minutes: 15 },
  { label: '30 minutes', minutes: 30 },
  { label: '45 minutes', minutes: 45 },
  { label: '60 minutes', minutes: 60 },
  { label: 'End of episode', minutes: null, kind: 'end-of-episode' },
]);

/**
 * Pure helper: format a remaining-seconds count as "M:SS" (clamped at 0).
 * Used by the UI to render the countdown; exported for direct testing.
 *
 * @param {number} totalSeconds
 * @returns {string} e.g. 0 -> "0:00", 65 -> "1:05", 600 -> "10:00"
 */
export function formatRemaining(totalSeconds) {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

/**
 * @param {() => void} [onElapsed] Called once when the countdown hits zero.
 * @returns {SleepTimerApi}
 */
export function useSleepTimer(onElapsed) {
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [active, setActive] = useState(false);

  const intervalRef = useRef(/** @type {ReturnType<typeof setInterval> | null} */ (null));
  // Keep the latest onElapsed without re-arming the interval each render.
  const onElapsedRef = useRef(onElapsed);
  useEffect(() => { onElapsedRef.current = onElapsed; }, [onElapsed]);

  const clearTimer = useCallback(() => {
    if (intervalRef.current != null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    clearTimer();
    setActive(false);
    setSecondsLeft(0);
  }, [clearTimer]);

  const tick = useCallback(() => {
    setSecondsLeft((prev) => {
      const next = prev - 1;
      if (next <= 0) {
        clearTimer();
        setActive(false);
        // Fire the caller's handler exactly once, after state settles.
        const cb = onElapsedRef.current;
        if (typeof cb === 'function') cb();
        return 0;
      }
      return next;
    });
  }, [clearTimer]);

  const start = useCallback((minutes) => {
    const mins = Number(minutes);
    if (!Number.isFinite(mins) || mins <= 0) return;
    clearTimer();
    setSecondsLeft(Math.round(mins * 60));
    setActive(true);
    intervalRef.current = setInterval(tick, 1000);
  }, [clearTimer, tick]);

  const extend = useCallback((minutes) => {
    const mins = Number(minutes);
    if (!Number.isFinite(mins) || mins <= 0) return;
    const addSeconds = Math.round(mins * 60);
    setSecondsLeft((prev) => prev + addSeconds);
    setActive((wasActive) => {
      if (!wasActive) {
        // No timer running yet — arm one now.
        clearTimer();
        intervalRef.current = setInterval(tick, 1000);
      }
      return true;
    });
  }, [clearTimer, tick]);

  // Always tear down on unmount.
  useEffect(() => clearTimer, [clearTimer]);

  return {
    active,
    minutesLeft: Math.ceil(secondsLeft / 60),
    secondsLeft,
    start,
    cancel,
    extend,
  };
}

export default useSleepTimer;
