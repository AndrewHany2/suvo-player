const test = require("node:test");
const assert = require("node:assert");
const { mapInvokeResult } = require("./invokeData.logic.js");

test("returns data on success", () => {
  assert.deepStrictEqual(mapInvokeResult({ data: [1, 2], error: null }), [1, 2]);
});

test("throws DEVICE_MISMATCH when body signals it", () => {
  assert.throws(
    () => mapInvokeResult({ data: { error: "DEVICE_MISMATCH" }, error: null }),
    /DEVICE_MISMATCH/,
  );
});

test("throws generic on transport error", () => {
  assert.throws(
    () => mapInvokeResult({ data: null, error: { message: "boom" } }),
    /boom/,
  );
});
