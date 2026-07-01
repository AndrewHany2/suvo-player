const test = require("node:test");
const assert = require("node:assert");
const { evaluateClaim } = require("./bindingDecision.js");

// evaluateClaim mirrors the claim_device SQL decision (SQL is authoritative).
// returns "ok" | "bound" | "denied".

test("no deviceId → denied", () => {
  assert.strictEqual(
    evaluateClaim({ deviceId: "", deviceAlreadyBound: false, currentCount: 0, limit: 1 }),
    "denied",
  );
});

test("device already bound → ok (even at limit)", () => {
  assert.strictEqual(
    evaluateClaim({ deviceId: "d1", deviceAlreadyBound: true, currentCount: 3, limit: 3 }),
    "ok",
  );
});

test("under limit, new device → bound", () => {
  assert.strictEqual(
    evaluateClaim({ deviceId: "d2", deviceAlreadyBound: false, currentCount: 0, limit: 1 }),
    "bound",
  );
});

test("at limit (1), new device → denied", () => {
  assert.strictEqual(
    evaluateClaim({ deviceId: "d2", deviceAlreadyBound: false, currentCount: 1, limit: 1 }),
    "denied",
  );
});

test("limit > 1: second device under limit → bound", () => {
  assert.strictEqual(
    evaluateClaim({ deviceId: "d2", deviceAlreadyBound: false, currentCount: 1, limit: 3 }),
    "bound",
  );
});

test("limit > 1: at higher limit → denied", () => {
  assert.strictEqual(
    evaluateClaim({ deviceId: "d4", deviceAlreadyBound: false, currentCount: 3, limit: 3 }),
    "denied",
  );
});
