const test = require("node:test");
const assert = require("node:assert");
const { evaluateIntegrity } = require("./integrityPolicy.js");

test("web/electron/tv are never compromised", () => {
  assert.strictEqual(evaluateIntegrity({ platform: "web" }).compromised, false);
  assert.strictEqual(evaluateIntegrity({ platform: "windows" }).compromised, false);
});

test("native + jailbroken → compromised", () => {
  assert.strictEqual(evaluateIntegrity({ platform: "ios", isJailBroken: true }).compromised, true);
  assert.strictEqual(evaluateIntegrity({ platform: "android", isJailBroken: true }).compromised, true);
});

test("native + not jailbroken → not compromised", () => {
  assert.strictEqual(evaluateIntegrity({ platform: "ios", isJailBroken: false }).compromised, false);
});

test("native + unknown signal → fail-open (not compromised)", () => {
  assert.strictEqual(evaluateIntegrity({ platform: "android" }).compromised, false);
  assert.strictEqual(evaluateIntegrity({ platform: "ios", isJailBroken: undefined }).compromised, false);
});
