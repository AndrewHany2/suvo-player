import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeSearch } from "./normalizeSearch.js";

test("returns empty string for nullish input", () => {
  assert.equal(normalizeSearch(undefined), "");
  assert.equal(normalizeSearch(null), "");
  assert.equal(normalizeSearch(""), "");
});

test("lowercases and trims like the old toLowerCase() path", () => {
  assert.equal(normalizeSearch("  MBC Action  "), "mbc action");
});

test("strips Arabic diacritics (tashkeel) so vowelled text matches bare text", () => {
  // مُحَمَّد (with harakat) → محمد
  assert.equal(normalizeSearch("مُحَمَّد"), normalizeSearch("محمد"));
});

test("removes tatweel (kashida) elongation", () => {
  // الجـــزيرة → الجزيرة
  assert.equal(normalizeSearch("الجـــزيرة"), normalizeSearch("الجزيرة"));
});

test("unifies alef variants (آ أ إ ٱ) to bare alef", () => {
  const bare = normalizeSearch("احمد");
  assert.equal(normalizeSearch("أحمد"), bare);
  assert.equal(normalizeSearch("إحمد"), bare);
  assert.equal(normalizeSearch("آحمد"), bare);
  assert.equal(normalizeSearch("ٱحمد"), bare);
});

test("folds alef maksura (ى) to yaa (ي)", () => {
  assert.equal(normalizeSearch("مصطفى"), normalizeSearch("مصطفي"));
});

test("folds taa marbuta (ة) to haa (ه)", () => {
  assert.equal(normalizeSearch("قناة"), normalizeSearch("قناه"));
});

test("folds hamza-carrier waw/yaa (ؤ ئ) to plain waw/yaa", () => {
  assert.equal(normalizeSearch("مسؤول"), normalizeSearch("مسوول"));
  assert.equal(normalizeSearch("رئيس"), normalizeSearch("رييس"));
});

test("normalizes Arabic-Indic and extended digits to ASCII", () => {
  assert.equal(normalizeSearch("قناة ٢"), normalizeSearch("قناة 2"));
  assert.equal(normalizeSearch("۹۹"), "99");
});

test("leaves plain ASCII and non-Arabic text unchanged apart from casing", () => {
  assert.equal(normalizeSearch("Netflix 4K"), "netflix 4k");
});
