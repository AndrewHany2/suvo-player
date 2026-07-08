import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyContentProps } from "./emptyContentProps.js";

test("movies: 'No movies found', film icon, no message", () => {
  const p = emptyContentProps("movies");
  assert.equal(p.icon, "film");
  assert.equal(p.title, "No movies found");
  assert.equal(p.message, undefined);
});

test("series: 'No series found' with account message, tv icon", () => {
  const p = emptyContentProps("series");
  assert.equal(p.icon, "tv");
  assert.equal(p.title, "No series found");
  assert.match(p.message, /this account/);
});
