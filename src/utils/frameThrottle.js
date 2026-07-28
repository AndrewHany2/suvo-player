/**
 * frameThrottle — coalesce a burst of calls to at most one execution per
 * animation frame, while keeping the FIRST call instant (leading edge) and
 * guaranteeing the LAST call always runs (trailing edge).
 *
 * Why this exists: on TV, holding a D-pad direction fires OS key-autorepeat
 * (~30ms). Each repeat used to trigger a full React re-render + scroll layout,
 * which on a slow webOS/Tizen CPU takes longer than the repeat interval — so
 * keydown events pile up in the browser queue and focus keeps sliding after the
 * user lets go (overshoot). Throttling the expensive render to one per frame
 * lets the app skip intermediate renders and "catch up" to the latest position.
 *
 * Intended use is the ref-flush pattern: keep the synchronous parts of a key
 * handler (preventDefault, the position ref update) inline, and wrap only the
 * expensive `setState` so it reads the ref when it flushes — idempotent, so it
 * always converges to the true latest position and never drops the final move:
 *
 *   const commit = frameThrottle(() => setFocus(focusRef.current));
 *   const move = (n) => { focusRef.current = n; commit(); };
 *
 * `schedule` is injectable for tests; it defaults to requestAnimationFrame
 * (falling back to a ~60fps timer where rAF is unavailable, e.g. old engines).
 */

const rafSchedule =
  typeof requestAnimationFrame === "function"
    ? (cb) => requestAnimationFrame(cb)
    : (cb) => setTimeout(cb, 16);

export function frameThrottle(fn, schedule = rafSchedule) {
  let pending = false; // a flush is already scheduled for the current frame
  let queued = false; // a trailing call arrived while a flush was pending
  let lastArgs = null;

  const flush = () => {
    if (queued) {
      queued = false;
      const args = lastArgs;
      lastArgs = null;
      fn(...args);
      // Keep the gate open one more cycle so calls that arrive during this
      // frame's render also coalesce, instead of firing a fresh leading edge.
      schedule(flush);
    } else {
      pending = false;
    }
  };

  const throttled = (...args) => {
    if (!pending) {
      pending = true;
      fn(...args); // leading edge — instant, so a single press has no latency
      schedule(flush);
    } else {
      queued = true; // coalesce: only the most recent call survives the frame
      lastArgs = args;
    }
  };

  /** Drop any pending trailing call (e.g. when the surface unmounts). */
  throttled.cancel = () => {
    pending = false;
    queued = false;
    lastArgs = null;
  };

  return throttled;
}
