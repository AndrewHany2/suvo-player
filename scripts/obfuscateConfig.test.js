const test = require("node:test");
const assert = require("node:assert");
const { getPreset, webPreset, tvPreset } = require("./obfuscateConfig.js");

test("tv preset stays TV-safe: no CFF, no string-array encoding, no self-defending", () => {
  assert.strictEqual(tvPreset.controlFlowFlattening, false);
  assert.strictEqual(tvPreset.deadCodeInjection, false);
  assert.strictEqual(tvPreset.selfDefending, false);
  assert.deepStrictEqual(tvPreset.stringArrayEncoding, []);
});

test("tv preset still mangles identifiers and uses a string array", () => {
  assert.strictEqual(tvPreset.identifierNamesGenerator, "mangled");
  assert.strictEqual(tvPreset.stringArray, true);
  assert.strictEqual(tvPreset.compact, true);
});

test("web preset is balanced-aggressive: CFF + RC4 string encoding + splitting", () => {
  assert.strictEqual(webPreset.controlFlowFlattening, true);
  assert.deepStrictEqual(webPreset.stringArrayEncoding, ["rc4"]);
  assert.strictEqual(webPreset.splitStrings, true);
});

test("web preset keeps transformObjectKeys OFF (white-screens RN-web — see 2026-07-17 boot smoke)", () => {
  assert.strictEqual(webPreset.transformObjectKeys, false);
});

test("web preset enables selfDefending (Phase B L2) but keeps debugProtection OFF", () => {
  // selfDefending: resists beautify/patch of the shipped bundle (Layer 2).
  // debugProtection stays OFF — it freezes on open devtools and needs its own
  // per-target testing before shipping (tracked in the Phase B native/verify plan).
  assert.strictEqual(webPreset.selfDefending, true);
  assert.strictEqual(webPreset.debugProtection ?? false, false);
});

test("getPreset returns the matching preset", () => {
  assert.strictEqual(getPreset("web"), webPreset);
  assert.strictEqual(getPreset("tv"), tvPreset);
});

test("getPreset throws loudly on an unknown profile", () => {
  assert.throws(() => getPreset("desktop"), /unknown obfuscation profile/i);
});

test("getPreset throws on prototype-chain keys, not just plain unknown strings", () => {
  assert.throws(() => getPreset("constructor"), /unknown obfuscation profile/i);
  assert.throws(() => getPreset("__proto__"), /unknown obfuscation profile/i);
  assert.throws(() => getPreset("hasOwnProperty"), /unknown obfuscation profile/i);
});
