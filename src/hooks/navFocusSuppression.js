// Pure decision for useTVInput's nav-focus yield. No React, no DOM — unit-tested
// in isolation so the "keys stay suppressed while the navbar holds focus, even
// across handler re-registration" invariant can't silently regress again.
//
// The bug this guards: when navHasFocus lived inside register()'s closure, every
// re-register() reset it to false, so a component that re-registers its key
// handler on most renders (VirtualShelves) would resume acting on keys while the
// navbar still owned the remote. Hoisting the flag to a survives-re-registration
// store (module/useRef) + reading it through this pure predicate fixes that.

/**
 * Should this keydown be suppressed (ignored by the screen handler)?
 * True only when the handler opted into yielding AND the navbar currently holds
 * focus. `navHasFocus` is read from a store that survives re-registration.
 */
export function shouldSuppressKey(navHasFocus, yieldToNav) {
  return !!yieldToNav && !!navHasFocus;
}
