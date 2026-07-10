import { test } from "node:test";
import assert from "node:assert/strict";
import { findNextEpisode } from "./episodeNav.js";

const series = (streamId, seasons) => ({ type: "series", streamId, seriesSeasons: seasons });

const SEASONS = {
  "1": [{ id: "a", episode_num: 1 }, { id: "b", episode_num: 2 }],
  "2": [{ id: "c", episode_num: 1 }],
  "10": [{ id: "d", episode_num: 1 }],
};

test("returns null without series context", () => {
  assert.equal(findNextEpisode(null), null);
  assert.equal(findNextEpisode(undefined), null);
  assert.equal(findNextEpisode({ type: "movie", streamId: "a" }), null);
  assert.equal(findNextEpisode({ type: "series", streamId: "a" }), null); // no seriesSeasons
});

test("advances within a season", () => {
  const next = findNextEpisode(series("a", SEASONS));
  assert.equal(next.episode.id, "b");
  assert.equal(next.seasonNum, "1");
});

test("crosses the season boundary to the next season's first episode", () => {
  const next = findNextEpisode(series("b", SEASONS));
  assert.equal(next.episode.id, "c");
  assert.equal(next.seasonNum, "2");
});

test("orders seasons numerically, not lexically (S2 before S10)", () => {
  // From the last episode of S2 the next is S10's first — proving 2 sorts
  // before 10 (string sort would put "10" before "2").
  const next = findNextEpisode(series("c", SEASONS));
  assert.equal(next.episode.id, "d");
  assert.equal(next.seasonNum, "10");
});

test("orders episodes numerically within a season (E2 before E10)", () => {
  const next = findNextEpisode(series("e2", {
    "1": [{ id: "e10", episode_num: 10 }, { id: "e2", episode_num: 2 }],
  }));
  assert.equal(next.episode.id, "e10");
});

test("returns null on the last episode of the last season", () => {
  assert.equal(findNextEpisode(series("d", SEASONS)), null);
});

test("returns null when the current episode isn't in the list", () => {
  assert.equal(findNextEpisode(series("missing", SEASONS)), null);
});

test("matches ids across string/number types", () => {
  const seasons = { "1": [{ id: 1, episode_num: 1 }, { id: 2, episode_num: 2 }] };
  const next = findNextEpisode(series("1", seasons)); // string streamId vs numeric id
  assert.equal(next.episode.id, 2);
});
