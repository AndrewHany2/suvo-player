import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { evaluateClientEntitlement } from "./entitlementGate.logic.js";

const NOW = Date.parse("2026-07-18T00:00:00Z");
const future = new Date(NOW + 86400000).toISOString();
const past = new Date(NOW - 1000).toISOString();

describe("evaluateClientEntitlement (advisory client gate)", () => {
  test("no snapshot → unknown, cannot play (fail closed, but not 'expired')", () => {
    assert.deepEqual(evaluateClientEntitlement(null, NOW), { canPlay: false, reason: "unknown" });
    assert.deepEqual(evaluateClientEntitlement(undefined, NOW), {
      canPlay: false,
      reason: "unknown",
    });
  });

  test("entitled with future expiry → can play", () => {
    assert.deepEqual(
      evaluateClientEntitlement({ entitled: true, reason: "ok", expires_at: future }, NOW),
      { canPlay: true, reason: "ok" },
    );
  });

  test("entitled with null expiry (paid) → can play", () => {
    assert.deepEqual(
      evaluateClientEntitlement({ entitled: true, reason: "ok", expires_at: null }, NOW),
      { canPlay: true, reason: "ok" },
    );
  });

  test("stale 'entitled' snapshot whose expiry has passed locally → denied (offline safety)", () => {
    assert.deepEqual(
      evaluateClientEntitlement({ entitled: true, reason: "ok", expires_at: past }, NOW),
      { canPlay: false, reason: "expired" },
    );
  });

  test("not entitled → carries the server reason", () => {
    assert.deepEqual(
      evaluateClientEntitlement({ entitled: false, reason: "revoked", expires_at: null }, NOW),
      { canPlay: false, reason: "revoked" },
    );
    assert.deepEqual(
      evaluateClientEntitlement({ entitled: false, reason: "expired", expires_at: past }, NOW),
      { canPlay: false, reason: "expired" },
    );
  });

  test("not entitled with no reason → 'not-entitled'", () => {
    assert.deepEqual(evaluateClientEntitlement({ entitled: false }, NOW), {
      canPlay: false,
      reason: "not-entitled",
    });
  });

  test("is never the boundary: an entitled=false snapshot never plays even with future expiry", () => {
    assert.equal(
      evaluateClientEntitlement({ entitled: false, reason: "suspended", expires_at: future }, NOW)
        .canPlay,
      false,
    );
  });
});
