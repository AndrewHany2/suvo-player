import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { shelfWindow, railWindow, clampCol, nearRailEnd } from "./shelfWindow.js";

describe("shelfWindow", () => {
  test("mounts focus +/- buffer, half-open", () => {
    assert.deepEqual(shelfWindow(5, 20, 1), { start: 4, end: 7 });
  });
  test("clamps at the top", () => {
    assert.deepEqual(shelfWindow(0, 20, 1), { start: 0, end: 2 });
  });
  test("clamps at the bottom", () => {
    assert.deepEqual(shelfWindow(19, 20, 1), { start: 18, end: 20 });
  });
  test("never exceeds shelfCount and never negative", () => {
    const w = shelfWindow(0, 1, 1);
    assert.ok(w.start >= 0 && w.end <= 1);
  });
});

describe("railWindow", () => {
  test("non-focused rail mounts only first visibleCols", () => {
    assert.deepEqual(railWindow(0, 100, 6, 2, false), { start: 0, end: 6 });
  });
  test("focused rail windows around focusCol with hBuffer", () => {
    // start = focusCol - hBuffer, end = focusCol + visibleCols + hBuffer
    assert.deepEqual(railWindow(20, 100, 6, 2, true), { start: 18, end: 28 });
  });
  test("focused rail clamps to loaded range", () => {
    assert.deepEqual(railWindow(0, 4, 6, 2, true), { start: 0, end: 4 });
  });
  test("mounted count stays bounded regardless of loadedCount", () => {
    const w = railWindow(9999, 100000, 6, 2, true);
    assert.ok(w.end - w.start <= 6 + 2 * 2);
  });
});

describe("clampCol", () => {
  test("clamps into range", () => {
    assert.equal(clampCol(50, 10), 9);
  });
  test("empty rail -> 0", () => {
    assert.equal(clampCol(3, 0), 0);
  });
  test("negative -> 0", () => {
    assert.equal(clampCol(-2, 10), 0);
  });
});

describe("nearRailEnd", () => {
  test("true within threshold of loaded end", () => {
    assert.equal(nearRailEnd(8, 10, 3), true);
  });
  test("false when far from end", () => {
    assert.equal(nearRailEnd(2, 100, 3), false);
  });
  test("false for empty rail", () => {
    assert.equal(nearRailEnd(0, 0, 3), false);
  });
});
