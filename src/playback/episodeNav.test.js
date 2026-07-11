import { test } from "node:test";
import assert from "node:assert/strict";
import { findNextEpisode, buildNextEpisodeVideo } from "./episodeNav.js";

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

// ── buildNextEpisodeVideo ───────────────────────────────────────────────────

const currentVid = {
  seriesId: "s99",
  seriesName: "The Show",
  seriesSeasons: { "1": [{ id: "a" }, { id: "b" }] },
};

test("buildNextEpisodeVideo builds the playVideo payload with padded S/E label", () => {
  const next = { episode: { id: "b", episode_num: 5, container_extension: "mkv" }, seasonNum: "2" };
  const video = buildNextEpisodeVideo(next, currentVid, (id, ext) => `url://${id}.${ext}`);
  assert.deepEqual(video, {
    type: "series",
    streamId: "b",
    seriesId: "s99",
    seriesName: "The Show",
    name: "The Show - S02E05",
    url: "url://b.mkv",
    seasonNum: "2",
    episodeNum: 5,
    seriesSeasons: currentVid.seriesSeasons,
  });
});

test("buildNextEpisodeVideo stringifies streamId and defaults ext to mp4", () => {
  const next = { episode: { id: 42, episode_num: 1 }, seasonNum: "1" };
  const seen = [];
  const video = buildNextEpisodeVideo(next, currentVid, (id, ext) => { seen.push([id, ext]); return "u"; });
  assert.equal(video.streamId, "42"); // numeric id stringified
  assert.deepEqual(seen, [[42, "mp4"]]); // buildUrl gets the raw id + default ext
});

test("buildNextEpisodeVideo returns null when there's nothing to advance to", () => {
  assert.equal(buildNextEpisodeVideo(null, currentVid, () => "u"), null);
  assert.equal(buildNextEpisodeVideo({ episode: { id: "x", episode_num: 1 }, seasonNum: "1" }, null, () => "u"), null);
});
