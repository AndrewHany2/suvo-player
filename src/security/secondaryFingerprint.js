// Secondary composite fingerprint. This is INFORMATIONAL only — it is stored
// alongside a binding to help spot anomalies (same primary anchor, wholly
// different hardware profile) but MUST NOT gate access, because these hints
// drift over time (network/OS/hardware changes) and would cause false lockouts
// under the permanent, admin-only-unbind policy.
//
// The pure functions accept an injected hasher for testability. In the app,
// pass a hasher backed by expo-crypto / Web Crypto; the Node default (sha256)
// is used in tests and any Node context.
const crypto = require("node:crypto");

function normalizeHints(hints) {
  const out = {};
  for (const key of Object.keys(hints || {}).sort()) {
    let v = hints[key];
    if (v === null || v === undefined || v === "") continue;
    if (typeof v === "string") v = v.toLowerCase();
    out[key] = v;
  }
  return out;
}

function fingerprintHash(hints, hasher) {
  const json = JSON.stringify(normalizeHints(hints));
  if (hasher) return hasher(json);
  return crypto.createHash("sha256").update(json).digest("hex");
}

module.exports = { normalizeHints, fingerprintHash };
