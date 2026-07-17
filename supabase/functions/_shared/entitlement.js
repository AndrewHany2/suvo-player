// Pure entitlement decision — the real demo/trial + license boundary. No I/O and
// no imports, so it runs under BOTH the Deno edge runtime and node:test (mirrors
// accountStatus.js). This is the ONLY layer of the obfuscation/anti-tamper
// program that is an actual security boundary; the client obfuscation layers
// (Phases A–C) merely raise effort.
//
// nowMs is the SERVER clock (Date.now() inside the Edge runtime) — NEVER a
// client-supplied timestamp. That is the entire point: a frozen client clock or
// a blocked network must not extend a trial.
//
// Fails CLOSED: anything not clearly active + unexpired + unrevoked is denied.
// (Contrast accountStatus.js, which fails OPEN on a missing row because a legacy
// account with no customer_accounts row is a real ungated case. Here a missing
// entitlement means "never provisioned" → deny.) A malformed timestamp is
// treated as the deny-side outcome (expired / revoked), not passed through.

/**
 * Decide whether an entitlements row grants access right now.
 *
 * @param {{status?:string, revoked_at?:string|null, expires_at?:string|null}|null|undefined} row
 *   the entitlements row for the caller, or null/undefined if they have none
 * @param {number} nowMs server epoch ms (Date.now() in the edge runtime)
 * @returns {{entitled:boolean, reason:string}} reason ∈
 *   no-entitlement | suspended | revoked | expired | ok
 */
export function evaluateEntitlement(row, nowMs) {
  if (!row) return { entitled: false, reason: "no-entitlement" };

  // status column is 'active' | 'suspended'. Any non-empty, non-active value
  // (suspended / blocked / anything unexpected) denies. An empty/unset status
  // is not a suspension signal — expiry/revocation still apply below.
  if (row.status && row.status !== "active") {
    return { entitled: false, reason: "suspended" };
  }

  // Kill switch — matches device_bindings, where ANY non-null revoked_at revokes
  // immediately (deviceGate filters `.is("revoked_at", null)`). We deliberately
  // do NOT honour a "future" revoked_at as scheduled: a set value means revoked,
  // full stop, so a mis-entered or wrong-timezone timestamp can never leave a
  // revoked user watching. nowMs is intentionally unused for revocation.
  if (row.revoked_at != null) {
    return { entitled: false, reason: "revoked" };
  }

  // Trial / license window. null expires_at = no expiry (paid/active). A past or
  // malformed value is expired (fail closed).
  if (row.expires_at != null) {
    const exp = Date.parse(row.expires_at);
    if (!Number.isFinite(exp) || exp <= nowMs) {
      return { entitled: false, reason: "expired" };
    }
  }

  return { entitled: true, reason: "ok" };
}
