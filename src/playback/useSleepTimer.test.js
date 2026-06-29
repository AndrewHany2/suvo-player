import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { formatRemaining, SLEEP_PRESETS } from "./useSleepTimer.js";

describe("formatRemaining", () => {
  test("formats whole minutes", () => {
    assert.equal(formatRemaining(600), "10:00");
    assert.equal(formatRemaining(60), "1:00");
  });

  test("zero-pads seconds under ten", () => {
    assert.equal(formatRemaining(65), "1:05");
    assert.equal(formatRemaining(9), "0:09");
  });

  test("formats seconds-only durations", () => {
    assert.equal(formatRemaining(45), "0:45");
    assert.equal(formatRemaining(0), "0:00");
  });

  test("floors fractional seconds", () => {
    assert.equal(formatRemaining(90.9), "1:30");
  });

  test("clamps negative / invalid input to 0:00", () => {
    assert.equal(formatRemaining(-5), "0:00");
    assert.equal(formatRemaining(NaN), "0:00");
    assert.equal(formatRemaining(Infinity), "0:00");
  });
});

describe("SLEEP_PRESETS", () => {
  test("offers 15/30/45/60 and end-of-episode", () => {
    const labels = SLEEP_PRESETS.map((p) => p.minutes);
    assert.deepEqual(labels, [15, 30, 45, 60, null]);
  });

  test("end-of-episode is a sentinel with no fixed minutes", () => {
    const eoe = SLEEP_PRESETS.find((p) => p.kind === "end-of-episode");
    assert.ok(eoe);
    assert.equal(eoe.minutes, null);
  });

  test("is frozen", () => {
    assert.ok(Object.isFrozen(SLEEP_PRESETS));
  });
});
