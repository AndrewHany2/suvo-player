import { test } from "node:test";
import assert from "node:assert/strict";
import { posterGrid, posterShelfWidth, GRID_TARGET_W, SHELF_TARGET_W } from "./posterLayout.js";

test("posterGrid clamps to the minimum column count at narrow widths", () => {
  assert.deepEqual(posterGrid(200, { target: 104, gap: 12 }), { cols: 2, cardW: 94 });
  assert.equal(posterGrid(150, { target: 104, gap: 12, min: 3 }).cols, 3);
});

test("posterGrid derives more columns as width grows, and never overflows the row", () => {
  let prev = 0;
  for (const w of [200, 340, 500, 800]) {
    const { cols, cardW } = posterGrid(w, { target: 104, gap: 12 });
    assert.ok(cols >= prev, `cols monotonic non-decreasing at ${w}`);
    prev = cols;
    assert.ok(cardW * cols + 12 * (cols - 1) <= w, `cards + gaps fit within ${w}`);
    assert.ok(cardW > 0, `cardW positive at ${w}`);
  }
});

test("posterGrid fills the row exactly at a clean 4-up width", () => {
  assert.deepEqual(posterGrid(500, { target: 104, gap: 12 }), { cols: 4, cardW: 116 });
});

test("posterShelfWidth leaves a peek (poster narrower than the target)", () => {
  const w = posterShelfWidth(500, { target: 150, gap: 12 });
  assert.equal(w, 139);
  assert.ok(w < 150);
});

test("posterShelfWidth honors the minimum visible count at narrow widths", () => {
  assert.equal(posterShelfWidth(200, { target: 150, gap: 12 }), 75);
});

test("exposes the shared target-width constants", () => {
  assert.equal(GRID_TARGET_W, 104);
  assert.equal(SHELF_TARGET_W, 150);
});
