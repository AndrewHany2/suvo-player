import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { nextDisplay } from "./gridPage.js";

describe("nextDisplay", () => {
  test("stays put while focus is comfortably inside the rendered slice", () => {
    assert.equal(nextDisplay(0, 24, 5, 24, 1000), 24);
    assert.equal(nextDisplay(10, 24, 5, 24, 1000), 24);
  });
  test("grows by one page when focus is within `cols` of the rendered end", () => {
    // display 24, cols 5 -> threshold at index 19
    assert.equal(nextDisplay(19, 24, 5, 24, 1000), 48);
    assert.equal(nextDisplay(23, 24, 5, 24, 1000), 48);
  });
  test("clamps growth at total", () => {
    assert.equal(nextDisplay(29, 30, 5, 24, 40), 40); // 30+24=54 -> clamp 40
  });
  test("never shrinks and never exceeds total", () => {
    assert.equal(nextDisplay(0, 100, 5, 24, 40), 40); // already past total -> clamp down to total
    assert.equal(nextDisplay(0, 30, 5, 24, 1000), 30);
  });
  test("handles the very first page (display == pageSize)", () => {
    assert.equal(nextDisplay(0, 24, 5, 24, 10), 10); // total < display -> clamp to total
  });
});
