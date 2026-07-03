// src/presentation/virtualization/windowMath.test.js
const test = require("node:test");
const assert = require("node:assert");
const { computeWindow } = require("./windowMath.js");

test("windows around the anchor with overscan on both sides", () => {
  const w = computeWindow({ anchor: 10, total: 100, viewportCount: 5, overscan: 4 });
  assert.deepStrictEqual(w, { start: 6, end: 19, leadingCount: 6, trailingCount: 81 });
});

test("clamps start at 0 near the head", () => {
  const w = computeWindow({ anchor: 1, total: 100, viewportCount: 5, overscan: 4 });
  assert.strictEqual(w.start, 0);
  assert.strictEqual(w.leadingCount, 0);
});

test("clamps end at total near the tail", () => {
  const w = computeWindow({ anchor: 98, total: 100, viewportCount: 5, overscan: 4 });
  assert.strictEqual(w.end, 100);
  assert.strictEqual(w.trailingCount, 0);
});

test("always includes the anchor slot", () => {
  for (const anchor of [0, 3, 50, 99]) {
    const w = computeWindow({ anchor, total: 100, viewportCount: 5, overscan: 4 });
    assert.ok(anchor >= w.start && anchor < w.end, `anchor ${anchor} inside [${w.start},${w.end})`);
  }
});

test("empty list yields an empty window", () => {
  const w = computeWindow({ anchor: 0, total: 0, viewportCount: 5, overscan: 4 });
  assert.deepStrictEqual(w, { start: 0, end: 0, leadingCount: 0, trailingCount: 0 });
});
