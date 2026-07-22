import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { resolveAction, isMacCommand } from "../platform/adapters/input/keys";

const isWeb = Platform.OS === "web";

/**
 * Remote-control key trap + navigator for TV modals/overlays.
 *
 * While `active`, this OWNS the remote via a capture-phase keydown listener that
 * (1) stopImmediatePropagation()s every nav key so the screen's own global
 * keydown handlers (grid navigation, navbar, useTVNavigation) never fire behind
 * the modal, and (2) preventDefault()s + drives the modal's OWN focus ring
 * through the directional callbacks below.
 *
 * This app navigates with a custom index-based model (a visual ring tracked in
 * React state, NOT native DOM focus — the onPress YStacks render as
 * non-focusable divs). So the modal must move its own ring; there is no native
 * 5-way focus to fall back on. Arrows are therefore preventDefault'd, which also
 * stops webOS spatial nav from double-moving.
 *
 * This is the reusable form of the exit-confirm prompt's capture+stop idiom in
 * AppNavigator.web.jsx.
 *
 * `onBack`  — Escape / webOS Back (461) / Tizen Back (10009) / Backspace / Meta.
 * `onEnter` — Enter (only when no text field is focused).
 * `onLeft/onRight/onUp/onDown` — arrow keys (only when no text field is focused).
 *   Omit a direction to make it an inert (but still shielded) no-op.
 *
 * Text fields keep working: while an INPUT/TEXTAREA has focus, arrows drive the
 * caret (default action untouched) and Enter/Back blur the field first, matching
 * the behaviour in useTVNavigation.
 *
 * On native this is an inert no-op (TV is a web/DOM target only).
 */
export function useModalKeyTrap(active, handlers = {}) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!isWeb || !active) return undefined;

    const onKey = (e) => {
      if (isMacCommand(e)) return; // ⌘ shares keyCode 91 with Back in the sim
      const action = resolveAction(e);
      if (!action) return; // non-nav key (typing): let it through untouched

      // Shield the background from every nav key — the screen behind us must
      // never move its ring while a modal owns the remote.
      e.stopImmediatePropagation();

      const { onBack, onEnter, onLeft, onRight, onUp, onDown } =
        handlersRef.current;
      const ae = document.activeElement;
      const inField =
        ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA");

      if (inField) {
        // Enter/Back hand control back from the field; arrows drive the caret
        // (left untouched so the browser moves the cursor, not our ring).
        if (action === "enter" || action === "back") {
          e.preventDefault();
          ae.blur();
          if (action === "back") onBack?.(e);
        }
        return;
      }

      // A real focused button (or role="button" control) must activate itself on
      // Enter — otherwise the detail hero's <button>s (Watch Trailer / Add to My
      // List / From Start) would fire Play instead. Let Enter fall through
      // untouched: no preventDefault, no onEnter. Web-only guard (native has no
      // document.activeElement).
      if (
        action === "enter" &&
        typeof document !== "undefined" &&
        ae &&
        (ae.tagName === "BUTTON" ||
          (ae.getAttribute?.("role") === "button" &&
            ae.hasAttribute?.("tabindex")))
      ) {
        return;
      }

      // No text field focused: we drive the modal's own ring. Every nav key is
      // preventDefault'd so webOS native spatial focus can't also move.
      const dispatch = {
        back: onBack,
        enter: onEnter,
        left: onLeft,
        right: onRight,
        up: onUp,
        down: onDown,
      }[action];
      if (dispatch) {
        e.preventDefault();
        dispatch(e);
      } else if (action === "back" || action === "enter") {
        // Back/Enter are always consumed even without a handler, so they never
        // leak to the (shielded but present) background as a fallthrough.
        e.preventDefault();
      }
    };

    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [active]);
}
