// Secondary composite fingerprint. This is INFORMATIONAL only — it is stored
// alongside a binding to help spot anomalies (same primary anchor, wholly
// different hardware profile) but MUST NOT gate access, because these hints
// drift over time (network/OS/hardware changes) and would cause false lockouts
// under the permanent, admin-only-unbind policy.
//
// The default hasher is pure JS (no node:crypto / Web Crypto) so this module
// bundles safely under Metro for web/native/TV and runs identically in Node
// tests. Callers may inject their own hasher if a stronger digest is wanted.

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

// Deterministic 64-hex-char digest: eight 32-bit FNV-1a-style passes with
// distinct seeds, concatenated. Order-independent because the input string is
// built from normalizeHints (keys sorted). Not cryptographic — informational.
function hash64hex(str) {
  const seeds = [
    0x9e3779b1, 0x85ebca77, 0xc2b2ae3d, 0x27d4eb2f, 0x165667b1, 0xd3a2646c,
    0xfd7046c5, 0xb55a4f09,
  ];
  let out = "";
  for (const seed of seeds) {
    let h = seed >>> 0;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 0x01000193) >>> 0;
    }
    out += ("00000000" + h.toString(16)).slice(-8);
  }
  return out;
}

function fingerprintHash(hints, hasher) {
  const json = JSON.stringify(normalizeHints(hints));
  return hasher ? hasher(json) : hash64hex(json);
}

module.exports = { normalizeHints, fingerprintHash, hash64hex };
