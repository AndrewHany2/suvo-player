import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCategoryFilter, filterMovies } from "./moviesFilter.helpers.js";

const CATS = [
  { id: "1", name: "Action" },
  { id: "2", name: "Comedy" },
  { id: "3", name: "Action Classics" },
];

test("buildCategoryFilter prepends 'All Movies' when categories exist", () => {
  const out = buildCategoryFilter(CATS, "");
  assert.equal(out.length, 4);
  assert.deepEqual(out[0], { id: "all", name: "All Movies" });
  assert.deepEqual(out.slice(1), CATS);
});

test("buildCategoryFilter narrows by query (case-insensitive) and keeps the All entry", () => {
  const out = buildCategoryFilter(CATS, "  ACT ");
  assert.deepEqual(
    out.map((c) => c.name),
    ["All Movies", "Action", "Action Classics"],
  );
});

test("buildCategoryFilter returns the raw value unchanged while loading", () => {
  assert.deepEqual(buildCategoryFilter([], "x"), []);
  assert.deepEqual(buildCategoryFilter(null, "x"), []);
  assert.deepEqual(buildCategoryFilter(undefined, ""), []);
});

test("buildCategoryFilter tolerates a nullish query", () => {
  const out = buildCategoryFilter(CATS, undefined);
  assert.equal(out.length, 4);
});

const MOVIES = [
  { name: "Alien" },
  { name: "Avatar" },
  { name: "Batman" },
  { name: "avalanche" },
];

test("filterMovies with letter='all' and no query returns everything", () => {
  assert.deepEqual(filterMovies(MOVIES, "all", ""), MOVIES);
});

test("filterMovies applies the alpha filter case-insensitively", () => {
  assert.deepEqual(
    filterMovies(MOVIES, "a", "").map((m) => m.name),
    ["Alien", "Avatar", "avalanche"],
  );
});

test("filterMovies composes the alpha filter with the grid query", () => {
  assert.deepEqual(
    filterMovies(MOVIES, "a", "av").map((m) => m.name),
    ["Avatar", "avalanche"],
  );
});

test("filterMovies with a falsy letter skips the alpha filter", () => {
  assert.deepEqual(filterMovies(MOVIES, "", "bat").map((m) => m.name), ["Batman"]);
});

test("filterMovies returns [] for a nullish list", () => {
  assert.deepEqual(filterMovies(null, "all", ""), []);
  assert.deepEqual(filterMovies(undefined, "a", "x"), []);
});

test("filterMovies tolerates items with a missing name", () => {
  const items = [{ name: "Alpha" }, {}, { name: "Beta" }];
  assert.deepEqual(filterMovies(items, "a", "").map((m) => m.name), ["Alpha"]);
});

test("filterMovies matches an Arabic query across alef/yaa/diacritic variants", () => {
  const items = [{ name: "مُصطفى" }, { name: "الأسطورة" }];
  // Query with bare alef + trailing yaa still matches "مُصطفى" (harakat + maksura).
  assert.deepEqual(filterMovies(items, "all", "مصطفي").map((m) => m.name), ["مُصطفى"]);
  // Alef-hamza vs bare alef, taa-marbuta vs haa.
  assert.deepEqual(filterMovies(items, "all", "الاسطوره").map((m) => m.name), ["الأسطورة"]);
});

test("buildCategoryFilter narrows Arabic categories ignoring diacritics", () => {
  const cats = [{ id: "a", name: "أفلام عربية" }, { id: "b", name: "وثائقي" }];
  const out = buildCategoryFilter(cats, "افلام");
  assert.deepEqual(out.map((c) => c.name), ["All Movies", "أفلام عربية"]);
});
