/**
 * Shared remote-control key mapping for TV.
 *
 * Previously every *.tv.jsx screen re-declared `const KEY_LEFT = 37 …` and a
 * `new Set([27, 461, 10009, 8])` for the back button (LG webOS 461, Samsung
 * Tizen 10009, Esc, Backspace). This is the single source of truth.
 */

export const KEY_CODES = {
  37: "left", 38: "up", 39: "right", 40: "down",
  13: "enter",
  // 91 (Meta) is the Back key on this deployment's remote, alongside the
  // standard LG webOS 461, Samsung Tizen 10009, Esc (27), Backspace (8).
  27: "back", 461: "back", 10009: "back", 8: "back", 91: "back",
};

export const KEY_NAMES = {
  ArrowLeft: "left", ArrowUp: "up", ArrowRight: "right", ArrowDown: "down",
  Enter: "enter",
  Escape: "back", Meta: "back",
};

/** Resolve a keydown event to a logical action, or null. */
export function resolveAction(e) {
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
