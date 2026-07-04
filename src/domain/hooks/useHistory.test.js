// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitHistory } from "./historyGroups.js";

test("splitHistory drops live entries from the watched list", () => {
  const history = [
    { id: "a", type: "movies" },
    { id: "b", type: "live" },
    { id: "c", type: "series" },
  ];
  const { watched } = splitHistory(history);
  assert.deepEqual(watched.map((e) => e.id), ["a", "c"]);
});

test("splitHistory preserves the original (recency) order of watched entries", () => {
  const history = [
    { id: "1", type: "series" },
    { id: "2", type: "movies" },
    { id: "3", type: "movie" },
  ];
  const { watched } = splitHistory(history);
  assert.deepEqual(watched.map((e) => e.id), ["1", "2", "3"]);
});

test("splitHistory tolerates null/undefined input", () => {
  assert.deepEqual(splitHistory(null).watched, []);
  assert.deepEqual(splitHistory(undefined).watched, []);
});

test("splitHistory returns empty when every entry is live", () => {
  const { watched } = splitHistory([{ id: "x", type: "live" }]);
  assert.deepEqual(watched, []);
});
