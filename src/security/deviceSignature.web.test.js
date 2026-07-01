const test = require("node:test");
const assert = require("node:assert");
const { detectPlatform, ensureUuid } = require("./deviceSignature.web.js");

test("detects electron when machineId bridge present", () => {
  assert.strictEqual(detectPlatform({ electronAPI: { machineId: "m" } }), "electron");
});

test("detects tizen", () => {
  assert.strictEqual(detectPlatform({ tizen: {} }), "tizen");
});

test("detects webos", () => {
  assert.strictEqual(detectPlatform({ webOS: {} }), "webos");
});

test("ensureUuid creates once then reuses", () => {
  const store = {};
  const fakeLs = {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => {
      store[k] = v;
    },
  };
  const a = ensureUuid(fakeLs, () => "uuid-1");
  const b = ensureUuid(fakeLs, () => "uuid-2");
  assert.strictEqual(a, "uuid-1");
  assert.strictEqual(b, "uuid-1"); // reused, generator not called again
});
