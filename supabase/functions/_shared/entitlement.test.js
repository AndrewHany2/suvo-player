import { test } from "node:test";
import assert from "node:assert";
import { evaluateEntitlement } from "./entitlement.js";

const NOW = Date.parse("2026-07-17T00:00:00Z");
const future = new Date(NOW + 86400000).toISOString();
const past = new Date(NOW - 1000).toISOString();

test("no row → not entitled (fail closed)", () => {
  assert.deepStrictEqual(evaluateEntitlement(null, NOW), {
    entitled: false,
    reason: "no-entitlement",
  });
  assert.deepStrictEqual(evaluateEntitlement(undefined, NOW), {
    entitled: false,
    reason: "no-entitlement",
  });
});

test("suspended status → denied", () => {
  const r = evaluateEntitlement({ status: "suspended", expires_at: future }, NOW);
  assert.deepStrictEqual(r, { entitled: false, reason: "suspended" });
});

test("any non-active status → denied (fail closed)", () => {
  assert.strictEqual(evaluateEntitlement({ status: "blocked" }, NOW).entitled, false);
  assert.strictEqual(evaluateEntitlement({ status: "" }, NOW).entitled, true); // empty = unset → not gated by status
});

test("revoked in the past → denied even if unexpired", () => {
  const r = evaluateEntitlement(
    { status: "active", revoked_at: past, expires_at: future },
    NOW,
  );
  assert.deepStrictEqual(r, { entitled: false, reason: "revoked" });
});

test("malformed revoked_at → denied (fail closed)", () => {
  const r = evaluateEntitlement(
    { status: "active", revoked_at: "not-a-date", expires_at: future },
    NOW,
  );
  assert.deepStrictEqual(r, { entitled: false, reason: "revoked" });
});

test("any non-null revoked_at revokes immediately (even a future timestamp)", () => {
  // Kill-switch semantics match device_bindings: a set value means revoked, so a
  // future/fumbled timestamp can't leave a revoked user watching.
  assert.deepStrictEqual(
    evaluateEntitlement({ status: "active", revoked_at: future, expires_at: future }, NOW),
    { entitled: false, reason: "revoked" },
  );
  assert.deepStrictEqual(
    evaluateEntitlement({ status: "active", revoked_at: new Date(NOW).toISOString() }, NOW),
    { entitled: false, reason: "revoked" },
  );
});

test("expired trial → denied", () => {
  const r = evaluateEntitlement({ status: "active", expires_at: past }, NOW);
  assert.deepStrictEqual(r, { entitled: false, reason: "expired" });
});

test("malformed expires_at → denied (fail closed)", () => {
  const r = evaluateEntitlement({ status: "active", expires_at: "garbage" }, NOW);
  assert.deepStrictEqual(r, { entitled: false, reason: "expired" });
});

test("expires_at exactly now → denied (boundary is closed)", () => {
  const r = evaluateEntitlement(
    { status: "active", expires_at: new Date(NOW).toISOString() },
    NOW,
  );
  assert.strictEqual(r.entitled, false);
});

test("active within trial window → entitled", () => {
  assert.deepStrictEqual(evaluateEntitlement({ status: "active", expires_at: future }, NOW), {
    entitled: true,
    reason: "ok",
  });
});

test("active with null expiry (paid) → entitled", () => {
  assert.strictEqual(
    evaluateEntitlement({ status: "active", expires_at: null }, NOW).entitled,
    true,
  );
  assert.strictEqual(evaluateEntitlement({ status: "active" }, NOW).entitled, true);
});
