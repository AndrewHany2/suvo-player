const test = require("node:test");
const assert = require("node:assert");
const { evaluateBinding } = require("./bindingDecision.js");

test("binds when this login inserted the row", () => {
  const r = evaluateBinding({
    insertedRow: { device_id: "A" },
    existingRow: null,
    callerDeviceId: "A",
  });
  assert.strictEqual(r.status, "bound");
});

test("ok when existing binding matches caller device", () => {
  const r = evaluateBinding({
    insertedRow: null,
    existingRow: { device_id: "A" },
    callerDeviceId: "A",
  });
  assert.strictEqual(r.status, "ok");
});

test("denied when existing binding is a different device", () => {
  const r = evaluateBinding({
    insertedRow: null,
    existingRow: { device_id: "A" },
    callerDeviceId: "B",
  });
  assert.strictEqual(r.status, "denied");
});

test("denied when caller device id is missing", () => {
  const r = evaluateBinding({
    insertedRow: null,
    existingRow: { device_id: "A" },
    callerDeviceId: "",
  });
  assert.strictEqual(r.status, "denied");
});
