// Per-target obfuscation presets. Read-hardening only (Phase A): runtime
// anti-tamper flags (selfDefending / debugProtection) stay OFF here and are
// turned on in Phase B. Bar-raising, not real secrecy — see
// docs/superpowers/specs/2026-07-17-obfuscation-anti-tamper-layers-design.md.

// TV (webOS/Tizen) — weak engines over file://. controlFlowFlattening,
// deadCodeInjection, stringArrayEncoding, selfDefending crawl or break there.
// Kept: identifier mangling, string-array extraction, compaction. Only add a
// strong flag after validating on `npm run sim:lg` AND `npm run sim:tizen`.
const tvPreset = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  selfDefending: false,
  stringArray: true,
  stringArrayThreshold: 0.5,
  stringArrayEncoding: [],
  rotateStringArray: true,
  identifierNamesGenerator: "mangled",
  numbersToExpressions: false,
  simplify: true,
  splitStrings: false,
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
const webPreset = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.5,
  deadCodeInjection: false,
  selfDefending: false,
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
