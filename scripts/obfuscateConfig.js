// Per-target obfuscation presets. Read-hardening only (Phase A): runtime
// anti-tamper flags (selfDefending / debugProtection) stay OFF here and are
// turned on in Phase B. Bar-raising, not real secrecy — see
// docs/superpowers/specs/2026-07-17-obfuscation-anti-tamper-layers-design.md.

// TV (webOS/Tizen) — weak engines over file://. controlFlowFlattening,
// deadCodeInjection, stringArrayEncoding, selfDefending crawl or break there.
// Kept: identifier mangling, string-array extraction, compaction.
//
// Task-3 hardening (2026-07-17): added stringArrayThreshold:1 (extract ALL
// strings) + splitStrings (concatenation only). These are strictly milder than
// the web preset — no runtime decode, no control-flow rewrite, no key renaming —
// so they carry no crawl/break risk beyond what already runs on V8. NOT yet
// confirmed on a real TV engine (the webOS sim isn't installed here and the
// Tizen emulator can't HW-virtualize on this machine), so treat boot-time/perf
// as PENDING on-device confirmation — see docs/OBFUSCATION.md.
//
// Deliberately still OFF pending a real webOS+Tizen boot test (`npm run sim:lg`
// AND `npm run sim:tizen`, or deploy to the LG TV): stringArrayEncoding
// (base64/rc4 — runtime decode is the classic weak-engine crawl), and
// controlFlowFlattening (biggest hang risk). transformObjectKeys stays off
// permanently — it white-screens RN-web even on V8.
const tvPreset = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  selfDefending: false,
  stringArray: true,
  stringArrayThreshold: 1,
  stringArrayEncoding: [],
  rotateStringArray: true,
  identifierNamesGenerator: "mangled",
  numbersToExpressions: false,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 8,
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
  disableConsoleOutput: false,
  target: "browser",
};

// Web / Electron — no engine constraints. Balanced-aggressive: control-flow
// flattening at a moderate threshold, RC4-encoded string array, string
// splitting. Deliberately NOT "maximum": no deadCodeInjection /
// numbersToExpressions (bundle + runtime cost outweighs benefit).
// selfDefending/debugProtection remain OFF until Phase B.
//
// transformObjectKeys is OFF: it renames object-literal keys, which
// white-screens the React-Native-Web bundle (verified 2026-07-17 — a boot smoke
// of the obfuscated dist threw `Cannot read properties of undefined (reading
// 'focusBracket')` and rendered nothing). RN-web / React internals read some
// object keys by their original name across module boundaries, so renaming them
// breaks at runtime. Do not re-enable without a passing boot smoke.
//
// selfDefending is ON (Phase B, Layer 2): wraps the bundle in a self-checking
// guard so beautifying/patching the shipped code breaks it — raises the cost of
// tampering. Runtime-safe on the pristine bundle (verified by boot smoke
// 2026-07-17). debugProtection stays OFF — it traps on open devtools and needs
// its own per-target validation first.
const webPreset = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.5,
  deadCodeInjection: false,
  selfDefending: true,
  stringArray: true,
  stringArrayThreshold: 0.75,
  stringArrayEncoding: ["rc4"],
  rotateStringArray: true,
  identifierNamesGenerator: "mangled",
  numbersToExpressions: false,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 8,
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
  disableConsoleOutput: false,
  target: "browser",
};

const PRESETS = { web: webPreset, tv: tvPreset };

// Fail loud on an unknown profile — never silently fall back to a weaker (or
// wrong) preset. Use Object.hasOwn so prototype keys ("constructor",
// "__proto__", …) throw like any other unknown profile instead of resolving
// through Object.prototype.
function getPreset(profile) {
  if (!Object.hasOwn(PRESETS, profile)) {
    throw new Error(
      `unknown obfuscation profile: ${profile} (expected one of: ${Object.keys(PRESETS).join(", ")})`,
    );
  }
  return PRESETS[profile];
}

module.exports = { getPreset, PRESETS, webPreset, tvPreset };
