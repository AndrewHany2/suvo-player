const test = require("node:test");
const assert = require("node:assert");
const {
  normalizeHints,
  fingerprintHash,
} = require("./secondaryFingerprint.js");

test("normalize drops empty values and sorts keys", () => {
  const out = normalizeHints({ b: "X", a: null, c: "y" });
  assert.deepStrictEqual(Object.keys(out), ["b", "c"]);
  assert.strictEqual(out.c, "y");
});

test("hash is stable regardless of key order", () => {
  const h1 = fingerprintHash({ cpu: "m1", cores: 8 });
  const h2 = fingerprintHash({ cores: 8, cpu: "m1" });
  assert.strictEqual(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
});

test("different hints produce different hashes", () => {
  assert.notStrictEqual(
    fingerprintHash({ cpu: "m1" }),
    fingerprintHash({ cpu: "m2" }),
  );
});
