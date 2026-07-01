const test = require("node:test");
const assert = require("node:assert");
const { OBFUSCATE_OPTIONS } = require("./obfuscateConfig.js");

test("preset is TV-safe: no control-flow flattening, no string-array encoding", () => {
  assert.strictEqual(OBFUSCATE_OPTIONS.controlFlowFlattening, false);
  assert.strictEqual(OBFUSCATE_OPTIONS.deadCodeInjection, false);
  assert.strictEqual(OBFUSCATE_OPTIONS.selfDefending, false);
  assert.deepStrictEqual(OBFUSCATE_OPTIONS.stringArrayEncoding, []);
});

test("preset still mangles identifiers and uses a string array", () => {
  assert.strictEqual(OBFUSCATE_OPTIONS.identifierNamesGenerator, "mangled");
  assert.strictEqual(OBFUSCATE_OPTIONS.stringArray, true);
  assert.strictEqual(OBFUSCATE_OPTIONS.compact, true);
});
