// Pure, dependency-free core for the observability layer. Kept separate from
// observability.js (which imports react-native + wires global handlers) so this
// logic is unit-testable under bare `node --test`.

export const RING_MAX = 50;

/**
 * Push `item` onto `arr`, evicting oldest entries so length never exceeds `max`.
 * Mutates and returns `arr` (a bounded ring buffer).
 */
export function pushCapped(arr, item, max = RING_MAX) {
  arr.push(item);
  while (arr.length > max) arr.shift();
  return arr;
}

/**
 * Normalize an arbitrary thrown value into a small serializable shape. Accepts
 * Error objects, strings, or anything; never throws.
 * @returns {{ message: string, name?: string, stack?: string }}
 */
export function normalizeError(error) {
  if (error == null) return { message: String(error) };
  if (typeof error === "string") return { message: error };
  const message = error.message != null ? String(error.message) : String(error);
  const out = { message };
  if (error.name) out.name = String(error.name);
  // Cap the stack so a huge trace can't bloat the ring / a remote payload.
  if (error.stack) out.stack = String(error.stack).split("\n").slice(0, 8).join("\n");
  return out;
}
