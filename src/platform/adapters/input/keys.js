/**
 * Shared remote-control key mapping for TV.
 *
 * The single source of truth for TV key codes. *.tv.jsx screens import these
 * constants instead of re-declaring `const KEY_LEFT = 37 …` and their own back
 * `new Set(...)` — so a new remote's key codes only need to change here.
 */

export const KEY_LEFT = 37;
export const KEY_UP = 38;
export const KEY_RIGHT = 39;
export const KEY_DOWN = 40;
export const KEY_ENTER = 13;

// Back varies by remote: LG webOS 461, Samsung Tizen 10009, plus Esc (27),
// Backspace (8), and Meta/91 (this deployment's remote). Dropping any of these
// silently breaks the Back button on that hardware.
export const KEY_BACK = new Set([27, 461, 10009, 8, 91]);

// Derived from the constants above so the keyCode→action map can never drift
// from KEY_BACK / the directional codes.
export const KEY_CODES = {
  [KEY_LEFT]: "left", [KEY_UP]: "up", [KEY_RIGHT]: "right", [KEY_DOWN]: "down",
  [KEY_ENTER]: "enter",
};
for (const code of KEY_BACK) KEY_CODES[code] = "back";

export const KEY_NAMES = {
  ArrowLeft: "left", ArrowUp: "up", ArrowRight: "right", ArrowDown: "down",
  Enter: "enter",
  Escape: "back", Meta: "back",
};

/**
 * True if the event is the Mac ⌘ (Command) modifier. It shares keyCode 91 / key
 * "Meta" with this deployment's remote Back button, but uniquely reports code
 * "MetaLeft"/"MetaRight" (a TV remote never does). We use this to ignore ⌘ while
 * testing in the webOS simulator on a Mac keyboard, so it doesn't trigger Back —
 * without affecting the real remote, which never sends those codes.
 */
export function isMacCommand(e) {
  return e.code === "MetaLeft" || e.code === "MetaRight";
}

/** Resolve a keydown event to a logical action, or null. */
export function resolveAction(e) {
  if (isMacCommand(e)) return null;
  return KEY_NAMES[e.key] ?? KEY_CODES[e.keyCode] ?? KEY_CODES[e.which] ?? null;
}

/** True if the event is any "back" key variant. */
export function isBackKey(e) {
  return resolveAction(e) === "back";
}

// ── Navbar focus hand-off (TV) ───────────────────────────────────────────────
// A screen dispatches tv-nav-focus to let the top navbar claim the remote;
// the navbar dispatches tv-nav-blur to hand focus back to the screen.

export function yieldFocusToNav() {
  if (typeof globalThis !== "undefined" && globalThis.dispatchEvent) {
    globalThis.dispatchEvent(new CustomEvent("tv-nav-focus"));
  }
}

export function reclaimFocusFromNav() {
  if (typeof globalThis !== "undefined" && globalThis.dispatchEvent) {
    globalThis.dispatchEvent(new CustomEvent("tv-nav-blur"));
  }
}
