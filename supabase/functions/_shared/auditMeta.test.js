import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { scrubAuditMeta } from "./auditMeta.js";

describe("scrubAuditMeta", () => {
  test("passes a clean audit meta through unchanged", () => {
    const meta = { name: "Acme", deviceLimit: 3, expiresAt: "2026-08-01T00:00:00Z", lineType: "m3u", suspended: true, note: "vip" };
    assert.deepEqual(scrubAuditMeta(meta), meta);
  });

  test("strips a top-level password key", () => {
    assert.deepEqual(scrubAuditMeta({ name: "x", password: "hunter2" }), { name: "x" });
  });

  test("strips nested line credentials but keeps benign fields", () => {
    const meta = { line: { type: "xtream", host: "h", username: "u", password: "p" } };
    assert.deepEqual(scrubAuditMeta(meta), { line: { type: "xtream", host: "h", username: "u" } });
  });

  test("strips token/secret/apikey variants (case- and separator-insensitive)", () => {
    const meta = { access_token: "a", refresh_token: "b", token: "c", Secret: "d", API_KEY: "e", ok: 1 };
    assert.deepEqual(scrubAuditMeta(meta), { ok: 1 });
  });

  test("scrubs inside arrays", () => {
    assert.deepEqual(scrubAuditMeta([{ id: 1, pwd: "x" }, { id: 2 }]), [{ id: 1 }, { id: 2 }]);
  });

  test("returns null / undefined / primitives unchanged", () => {
    assert.equal(scrubAuditMeta(null), null);
    assert.equal(scrubAuditMeta(undefined), undefined);
    assert.equal(scrubAuditMeta("s"), "s");
    assert.equal(scrubAuditMeta(5), 5);
  });
});
