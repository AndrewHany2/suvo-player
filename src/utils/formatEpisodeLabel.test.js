import { test } from "node:test";
import assert from "node:assert/strict";
import { formatEpisodeLabel } from "./formatEpisodeLabel.js";

test("pads the episode to two digits, leaves the season as-is", () => {
  assert.equal(formatEpisodeLabel(2, 5), "S2 · E05");
  assert.equal(formatEpisodeLabel(1, 1), "S1 · E01");
});

test("does not truncate two-digit episodes or seasons", () => {
  assert.equal(formatEpisodeLabel(10, 12), "S10 · E12");
});
