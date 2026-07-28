import { test } from "node:test";
import assert from "node:assert/strict";
import { seriesActionTypes, seasonList } from "./seriesDetailActions.js";

test("with history: continue → episodes → fav", () => {
  assert.deepEqual(seriesActionTypes(true), ["continue", "episodes", "fav"]);
});

test("without history: episodes → fav (episodes is primary/first)", () => {
  assert.deepEqual(seriesActionTypes(false), ["episodes", "fav"]);
});

test("'episodes' is always present regardless of history", () => {
  assert.ok(seriesActionTypes(true).includes("episodes"));
  assert.ok(seriesActionTypes(false).includes("episodes"));
});

test("'continue' only appears with history, and never after 'episodes'", () => {
  assert.ok(!seriesActionTypes(false).includes("continue"));
  const withHist = seriesActionTypes(true);
  assert.ok(withHist.indexOf("continue") < withHist.indexOf("episodes"));
});

test("seasonList derives from episode keys, ascending", () => {
  const info = { episodes: { 2: [{}], 1: [{}], 10: [{}] } };
  assert.deepEqual(seasonList(info), ["1", "2", "10"]);
});

test("seasonList keeps a Specials season 0 (never falls back to its id)", () => {
  const info = { episodes: { 0: [{}], 1: [{}] } };
  assert.deepEqual(seasonList(info), ["0", "1"]);
});

test("seasonList falls back to info.seasons; season_number 0 stays '0', not id", () => {
  const info = {
    seasons: [
      { season_number: 0, id: 309556 },
      { season_number: 1, id: 42 },
    ],
  };
  assert.deepEqual(seasonList(info), ["0", "1"]);
});

test("seasonList prefers episode keys over the seasons array", () => {
  const info = {
    episodes: { 1: [{}], 2: [{}] },
    seasons: [{ season_number: 0, id: 999 }],
  };
  assert.deepEqual(seasonList(info), ["1", "2"]);
});

test("seasonList handles missing info gracefully", () => {
  assert.deepEqual(seasonList(undefined), []);
  assert.deepEqual(seasonList({}), []);
});
