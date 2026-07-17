import { test } from "node:test";
import assert from "node:assert/strict";
import { chunk } from "./chunk.js";

test("chunk: splits into consecutive groups of size", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test("chunk: size >= length returns a single chunk", () => {
  assert.deepEqual(chunk([1, 2, 3], 10), [[1, 2, 3]]);
});

test("chunk: empty input returns empty", () => {
  assert.deepEqual(chunk([], 3), []);
});

test("chunk: non-array input is treated as empty", () => {
  assert.deepEqual(chunk(null, 3), []);
  assert.deepEqual(chunk(undefined, 3), []);
});

test("chunk: invalid size falls back to a single chunk (never infinite-loops)", () => {
  assert.deepEqual(chunk([1, 2, 3], 0), [[1, 2, 3]]);
  assert.deepEqual(chunk([1, 2, 3], -1), [[1, 2, 3]]);
  assert.deepEqual(chunk([1, 2, 3], 1.5), [[1, 2, 3]]);
});
