import { test } from "node:test";
import assert from "node:assert/strict";
import { pushCapped, normalizeError, RING_MAX } from "./observabilityCore.js";

test("pushCapped keeps the buffer bounded, evicting oldest first", () => {
  const ring = [];
  for (let i = 0; i < 5; i++) pushCapped(ring, i, 3);
  assert.deepEqual(ring, [2, 3, 4]);
});

test("pushCapped returns the same array and defaults to RING_MAX", () => {
  const ring = [];
  assert.equal(pushCapped(ring, "x"), ring);
  for (let i = 0; i < RING_MAX + 10; i++) pushCapped(ring, i);
  assert.equal(ring.length, RING_MAX);
});

test("normalizeError handles Error objects, capping the stack", () => {
  const err = new Error("boom");
  err.stack = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
  const n = normalizeError(err);
  assert.equal(n.message, "boom");
  assert.equal(n.name, "Error");
  assert.equal(n.stack.split("\n").length, 8);
});

test("normalizeError handles strings and nullish values without throwing", () => {
  assert.deepEqual(normalizeError("just a string"), { message: "just a string" });
  assert.deepEqual(normalizeError(null), { message: "null" });
  assert.deepEqual(normalizeError(undefined), { message: "undefined" });
});

test("normalizeError coerces a non-Error object with a message", () => {
  assert.equal(normalizeError({ message: 42 }).message, "42");
});
