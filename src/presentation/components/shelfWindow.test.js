import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { scrollAnchor, windowFromAnchor, clampCol, nearRailEnd, railEdges } from "./shelfWindow.js";

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

describe("railEdges", () => {
  test("no hints when content fits (no overflow)", () => {
    assert.deepEqual(railEdges({ scrollLeft: 0, clientWidth: 1280, scrollWidth: 1000 }), {
      left: false,
      right: false,
    });
  });
  test("right hint at the start when there is overflow", () => {
    assert.deepEqual(railEdges({ scrollLeft: 0, clientWidth: 1280, scrollWidth: 2560 }), {
      left: false,
      right: true,
    });
  });
  test("both hints while scrolled in the middle", () => {
    assert.deepEqual(railEdges({ scrollLeft: 500, clientWidth: 1280, scrollWidth: 2560 }), {
      left: true,
      right: true,
    });
  });
  test("right hint CLEARS when scrolled flush to the end (the last-poster bug)", () => {
    // maxScroll = 2560 - 1280 = 1280. The floored-cols heuristic wrongly kept
    // "more right" true here; measured geometry must clear it.
    assert.deepEqual(railEdges({ scrollLeft: 1280, clientWidth: 1280, scrollWidth: 2560 }), {
      left: true,
      right: false,
    });
  });
  test("tolerates sub-pixel rounding slack at the end", () => {
    assert.equal(railEdges({ scrollLeft: 1279, clientWidth: 1280, scrollWidth: 2560 }).right, false);
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
