import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { validateEntry, MAX_ENTRY_BYTES } from "./entryLimits.js";

describe("validateEntry", () => {
  test("accepts a normal library entry with an id", () => {
    const e = { id: "movies_7_1", name: "Example", type: "movies", watchedAt: "2026-01-01T00:00:00Z" };
    assert.deepEqual(validateEntry(e), { ok: true });
  });

  test("accepts an entry with a numeric id", () => {
    assert.equal(validateEntry({ id: 12345 }).ok, true);
  });

  test("rejects a non-object entry (null / primitive / array)", () => {
    assert.equal(validateEntry(null).ok, false);
    assert.equal(validateEntry(undefined).ok, false);
    assert.equal(validateEntry("str").ok, false);
    assert.equal(validateEntry(42).ok, false);
    assert.equal(validateEntry([]).ok, false); // an array is never a valid entry object
  });

  test("rejects an entry with a missing or empty id", () => {
    assert.equal(validateEntry({ name: "no id" }).ok, false);
    assert.equal(validateEntry({ id: "" }).ok, false);
    assert.equal(validateEntry({ id: "   " }).ok, false);
    assert.equal(validateEntry({ id: null }).ok, false);
  });

  test("rejects an oversized entry (> MAX_ENTRY_BYTES)", () => {
    const big = { id: "x", blob: "a".repeat(MAX_ENTRY_BYTES) };
    const r = validateEntry(big);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "too_large");
  });

  test("accepts an entry just under the size limit", () => {
    const e = { id: "x", blob: "a".repeat(MAX_ENTRY_BYTES - 100) };
    assert.equal(validateEntry(e).ok, true);
  });

  test("rejects an entry that cannot be JSON-serialized (circular)", () => {
    const c = { id: "x" };
    c.self = c;
    assert.equal(validateEntry(c).ok, false);
  });
});
