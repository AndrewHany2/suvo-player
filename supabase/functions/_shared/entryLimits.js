// Pure size/shape validation for client-supplied library `entry` blobs
// (watch_history / favorites). No I/O and no imports, so it runs under BOTH the
// Deno edge runtime and node:test.
//
// The data Edge Function stores payload.entry verbatim as jsonb. Without a cap a
// bound caller could write arbitrarily large blobs (storage-exhaustion / cost
// DoS on their own rows). The limit is generous — real entries are movie/episode
// metadata (a few KB at most) — so it never bites legitimate use, only abuse.

export const MAX_ENTRY_BYTES = 65536; // 64 KiB serialized

/**
 * Validate a client-supplied library entry before it is persisted.
 * @param {unknown} entry
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validateEntry(entry) {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    return { ok: false, reason: "not_object" };
  }
  const id = /** @type {Record<string, unknown>} */ (entry).id;
  // entry_id is persisted as a text key, so an id must be a string or number
  // (an object/array/boolean id is nonsensical and rejected).
  if ((typeof id !== "string" && typeof id !== "number") || String(id).trim() === "") {
    return { ok: false, reason: "no_id" };
  }
  let serialized;
  try {
    serialized = JSON.stringify(entry);
  } catch {
    return { ok: false, reason: "unserializable" };
  }
  // JSON.stringify can return undefined for exotic inputs (already guarded, but
  // be defensive) — treat that as invalid rather than passing it through.
  if (typeof serialized !== "string") return { ok: false, reason: "unserializable" };
  // Byte length, not char length: multibyte chars must count against the cap.
  if (new TextEncoder().encode(serialized).length > MAX_ENTRY_BYTES) {
    return { ok: false, reason: "too_large" };
  }
  return { ok: true };
}
