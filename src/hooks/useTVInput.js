import { useCallback, useRef } from "react";
import { Platform } from "react-native";
import { resolveAction } from "../platform/adapters/input/keys";

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
  const cleanupRef = useRef(noop);

  const register = useCallback((handlers, { yieldToNav = false } = {}) => {
    if (!isWeb) return noop;

    let navHasFocus = false;

    const onKey = (e) => {
      // TEMP DIAGNOSTIC
      console.log("[tvinput]", "key=", e.key, "code=", e.keyCode, "action=", resolveAction(e), "navHasFocus=", navHasFocus);
      if (navHasFocus) return;
      const action = resolveAction(e);
      if (!action) return;
      const handler = handlers[action];
      if (handler) {
        e.preventDefault();
        handler(e);
      }
    };

    const onNavFocus = () => { navHasFocus = true; };
    const onNavBlur = () => { navHasFocus = false; };

    globalThis.addEventListener("keydown", onKey);
    if (yieldToNav) {
      globalThis.addEventListener("tv-nav-focus", onNavFocus);
      globalThis.addEventListener("tv-nav-blur", onNavBlur);
    }

    const cleanup = () => {
      globalThis.removeEventListener("keydown", onKey);
      if (yieldToNav) {
        globalThis.removeEventListener("tv-nav-focus", onNavFocus);
        globalThis.removeEventListener("tv-nav-blur", onNavBlur);
      }
    };
    cleanupRef.current = cleanup;
    return cleanup;
  }, []);

  return { register };
}
