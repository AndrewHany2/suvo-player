import test from "node:test";
import assert from "node:assert/strict";
import { fractionFromX, secondsFromFraction, positionReached } from "./seekBarMath.js";

test("fractionFromX: maps a page-absolute X to a 0..1 fraction of the bar", () => {
  assert.equal(fractionFromX(100, 100, 200), 0);   // at left edge
  assert.equal(fractionFromX(200, 100, 200), 0.5); // midpoint
  assert.equal(fractionFromX(300, 100, 200), 1);   // at right edge
});

test("fractionFromX: clamps outside the bar and guards zero width", () => {
  assert.equal(fractionFromX(50, 100, 200), 0);  // left of the bar
  assert.equal(fractionFromX(999, 100, 200), 1); // right of the bar
  assert.equal(fractionFromX(150, 100, 0), 0);   // unmeasured width → no NaN
});

// Regression for the reported stutter: the old code fed locationX (relative to
// whichever child View was under the finger), so equal finger movement produced
// non-monotonic fractions. fractionFromX uses screen-absolute pageX, so a
// monotonic sweep MUST yield a monotonic, non-decreasing fraction.
test("fractionFromX: monotonic in X (no jitter as the finger sweeps)", () => {
  let prev = -1;
  for (let px = 100; px <= 300; px += 5) {
    const f = fractionFromX(px, 100, 200);
    assert.ok(f >= prev, `fraction went backwards at px=${px}: ${f} < ${prev}`);
    prev = f;
  }
});

test("secondsFromFraction: scales to duration and clamps", () => {
  assert.equal(secondsFromFraction(0.5, 100), 50);
  assert.equal(secondsFromFraction(0, 100), 0);
  assert.equal(secondsFromFraction(1, 100), 100);
  assert.equal(secondsFromFraction(2, 100), 100);   // clamped
  assert.equal(secondsFromFraction(-1, 100), 0);     // clamped
  assert.equal(secondsFromFraction(0.5, 0), 0);      // no duration → 0
});

test("positionReached: true once the engine position lands near the seek target", () => {
  assert.equal(positionReached(50, 50), true);
  assert.equal(positionReached(51, 50), true);   // within default 1.5s tolerance
  assert.equal(positionReached(48, 50), false);  // still 2s away (pre-seek → hold)
  assert.equal(positionReached(50, 50, 0.1), true);
  assert.equal(positionReached(50.5, 50, 0.1), false);
});
