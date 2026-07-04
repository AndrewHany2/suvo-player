import { useCallback, useEffect, useRef } from "react";
import { Platform } from "react-native";
import { resolveAction } from "../platform/adapters/input/keys";
import { shouldSuppressKey } from "./navFocusSuppression";

const isWeb = Platform.OS === "web";
const noop = () => {};

/**
 * Remote-control input for TV screens. Replaces the per-screen keydown handler
 * + inline keyCode constants + navbar focus-yield boilerplate that every
 * *.tv.jsx file used to copy-paste.
 *
 * Usage:
 *   const { register } = useTVInput();
 *   useEffect(() => register(
 *     { left, right, up, down, enter, back },
 *     { yieldToNav: true },
 *   ), [deps]);
 *
 * `register` returns a cleanup function, so it can be returned directly from a
 * useEffect. When `yieldToNav` is true, key handling pauses while the top
 * navbar has claimed focus (tv-nav-focus / tv-nav-blur events).
 *
 * On native this is an inert no-op (TV is a web/DOM target only).
 */
export function useTVInput() {
  // navHasFocus lives on the hook instance (a ref), NOT inside register()'s
  // closure — so it survives the frequent re-register() that screens do on most
  // renders. A closure-scoped flag reset to false on every register(), which
  // silently defeated yieldToNav (the navbar would lose its exclusive focus the
  // moment the screen re-rendered). See navFocusSuppression.test.js.
  const navHasFocusRef = useRef(false);

  // Subscribe to the navbar's focus hand-off ONCE (stable empty deps). Because
  // this is independent of register(), re-registering handlers can't drop or
  // reset the subscription or the flag.
  useEffect(() => {
    if (!isWeb) return undefined;
    const onNavFocus = () => { navHasFocusRef.current = true; };
    const onNavBlur = () => { navHasFocusRef.current = false; };
    globalThis.addEventListener("tv-nav-focus", onNavFocus);
    globalThis.addEventListener("tv-nav-blur", onNavBlur);
    return () => {
      globalThis.removeEventListener("tv-nav-focus", onNavFocus);
      globalThis.removeEventListener("tv-nav-blur", onNavBlur);
    };
  }, []);

  const register = useCallback((handlers, { yieldToNav = false } = {}) => {
    if (!isWeb) return noop;

    const onKey = (e) => {
      if (shouldSuppressKey(navHasFocusRef.current, yieldToNav)) return;
      const action = resolveAction(e);
      if (!action) return;
      const handler = handlers[action];
      if (handler) {
        e.preventDefault();
        handler(e);
      }
    };

    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, []);

  return { register };
}
