import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDuration } from "./formatDuration.js";

test("formats sub-minute as M:SS with zero-padded seconds", () => {
  assert.equal(formatDuration(59), "0:59");
  assert.equal(formatDuration(5), "0:05");
});

test("rolls into minutes and hours at the right boundaries", () => {
  assert.equal(formatDuration(60), "1:00");
  assert.equal(formatDuration(3599), "59:59");
  assert.equal(formatDuration(3600), "1:00:00");
  assert.equal(formatDuration(3661), "1:01:01");
});

test("floors fractional seconds", () => {
  assert.equal(formatDuration(90.9), "1:30");
});

test("guards invalid / non-positive input to 0:00", () => {
  for (const v of [0, -5, NaN, null, undefined, "", "abc"]) {
    assert.equal(formatDuration(v), "0:00");
  }
});

test("parses a numeric string", () => {
  assert.equal(formatDuration("125"), "2:05");
});
