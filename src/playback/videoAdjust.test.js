// @ts-check
const test = require("node:test");
const assert = require("node:assert");

const {
  DEFAULT_VIDEO_ADJUST,
  ADJUST_MIN,
  ADJUST_MAX,
  ADJUST_LEVELS,
  clampAdjustValue,
  normalizeAdjust,
  buildVideoFilter,
} = require("./videoAdjust.js");

test("default is neutral", () => {
  assert.deepStrictEqual(DEFAULT_VIDEO_ADJUST, { brightness: 100, contrast: 100 });
});

test("clampAdjustValue clamps into range and rounds", () => {
  assert.strictEqual(clampAdjustValue(0), ADJUST_MIN);
  assert.strictEqual(clampAdjustValue(999), ADJUST_MAX);
  assert.strictEqual(clampAdjustValue(100), 100);
  assert.strictEqual(clampAdjustValue(112.6), 113);
});

test("clampAdjustValue falls back to 100 on garbage", () => {
  assert.strictEqual(clampAdjustValue(undefined), 100);
  assert.strictEqual(clampAdjustValue(null), 100);
  assert.strictEqual(clampAdjustValue("nope"), 100);
  assert.strictEqual(clampAdjustValue(NaN), 100);
});

test("normalizeAdjust fills + clamps missing fields", () => {
  assert.deepStrictEqual(normalizeAdjust(undefined), { brightness: 100, contrast: 100 });
  assert.deepStrictEqual(normalizeAdjust({ brightness: 200 }), { brightness: 150, contrast: 100 });
  assert.deepStrictEqual(normalizeAdjust({ contrast: 60 }), { brightness: 100, contrast: 60 });
});

test("buildVideoFilter returns empty string when neutral", () => {
  assert.strictEqual(buildVideoFilter(undefined), "");
  assert.strictEqual(buildVideoFilter({ brightness: 100, contrast: 100 }), "");
});

test("buildVideoFilter only emits changed dimensions", () => {
  assert.strictEqual(buildVideoFilter({ brightness: 120, contrast: 100 }), "brightness(1.2)");
  assert.strictEqual(buildVideoFilter({ brightness: 100, contrast: 80 }), "contrast(0.8)");
  assert.strictEqual(
    buildVideoFilter({ brightness: 110, contrast: 90 }),
    "brightness(1.1) contrast(0.9)",
  );
});

test("ADJUST_LEVELS are all within range and include the neutral midpoint", () => {
  assert.ok(ADJUST_LEVELS.includes(100));
  for (const lvl of ADJUST_LEVELS) {
    assert.ok(lvl >= ADJUST_MIN && lvl <= ADJUST_MAX, `${lvl} in range`);
  }
});
