import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { scrollAnchor, windowFromAnchor, focusedRailWindow, clampCol, nearRailEnd } from "./shelfWindow.js";

describe("scrollAnchor", () => {
  test("stays put while focus is inside the visible page", () => {
    assert.equal(scrollAnchor(0, 3, 6, 100), 0);
    assert.equal(scrollAnchor(0, 5, 6, 100), 0); // last col of the page
  });
  test("advances only when focus crosses the right edge", () => {
    assert.equal(scrollAnchor(0, 6, 6, 100), 1); // 6 > 0+5 -> 6-6+1
    assert.equal(scrollAnchor(0, 10, 6, 100), 5);
  });
  test("retreats when focus crosses the left edge", () => {
    assert.equal(scrollAnchor(5, 4, 6, 100), 4);
  });
  test("keeps the anchor when moving left but still inside the page", () => {
    assert.equal(scrollAnchor(5, 8, 6, 100), 5);
  });
  test("never scrolls the last page past the end", () => {
    assert.equal(scrollAnchor(50, 99, 6, 100), 94); // maxAnchor = 100-6
  });
  test("collapses to 0 when everything fits", () => {
    assert.equal(scrollAnchor(0, 2, 6, 4), 0);
  });
  test("clamps a stale anchor left over from a longer list", () => {
    assert.equal(scrollAnchor(90, 1, 6, 10), 1); // maxAnchor=4, focus 1 < clamped anchor
  });
});

describe("windowFromAnchor", () => {
  test("visible page plus overscan on each side, half-open", () => {
    assert.deepEqual(windowFromAnchor(10, 100, 6, 3), { start: 7, end: 19 });
  });
  test("defaults to 3 items of overscan", () => {
    assert.deepEqual(windowFromAnchor(10, 100, 6), { start: 7, end: 19 });
  });
  test("clamps the start at 0 (never negative)", () => {
    assert.deepEqual(windowFromAnchor(1, 100, 6, 3), { start: 0, end: 10 });
  });
  test("clamps the end at count", () => {
    assert.deepEqual(windowFromAnchor(95, 100, 6, 3), { start: 92, end: 100 });
  });
  test("always mounts the whole visible page (never blanks a visible slot)", () => {
    const visible = 6, overscan = 3;
    for (const [anchor, count] of [[0, 100], [1, 100], [50, 100], [94, 100], [0, 3]]) {
      const w = windowFromAnchor(anchor, count, visible, overscan);
      const lastVisible = Math.min(count - 1, anchor + visible - 1);
      assert.ok(w.start <= anchor, `start ${w.start} covers anchor ${anchor}`);
      assert.ok(w.end > lastVisible, `end ${w.end} covers last visible ${lastVisible}`);
    }
  });
  test("mounted count stays bounded regardless of list size", () => {
    const w = windowFromAnchor(9994, 100000, 6, 3);
    assert.ok(w.end - w.start <= 6 + 2 * 3);
  });
});

describe("focusedRailWindow", () => {
  test("covers the visible page and the focused card, with overscan", () => {
    // focus inside the visible page
    assert.deepEqual(focusedRailWindow(10, 12, 100, 6, 3), { start: 7, end: 19 });
  });
  test("keeps the focused card mounted when it is ahead of the scroll", () => {
    // scroll still at start (first=0) but focus jumped right to col 20
    const w = focusedRailWindow(0, 20, 100, 6, 3);
    assert.ok(w.start <= 20 && w.end > 20, "focused col 20 is mounted");
    assert.equal(w.start, 0); // still covers the visible page at the start
  });
  test("keeps the focused card mounted when it is behind the scroll", () => {
    const w = focusedRailWindow(30, 5, 100, 6, 3);
    assert.ok(w.start <= 5 && w.end > 5, "focused col 5 is mounted");
    assert.ok(w.end >= 30 + 6, "still covers the visible page");
  });
  test("shows the last poster at the end of the rail (no gap past it)", () => {
    // rail of 40, scrolled to the end, focus on the last card
    const w = focusedRailWindow(34, 39, 40, 6, 3);
    assert.equal(w.end, 40); // last index 39 is inside [start,end)
    assert.ok(w.start <= 34);
  });
  test("clamps to [0, count]", () => {
    assert.deepEqual(focusedRailWindow(0, 0, 4, 6, 3), { start: 0, end: 4 });
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
