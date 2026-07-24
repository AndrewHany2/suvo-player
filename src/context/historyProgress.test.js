// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_HISTORY,
  mergeFavorites,
  normalizeHistoryItem,
  normalizeType,
  isDifferentTitle,
  upsertHistoryItem,
  applyProgress,
  mergeHistories,
  resolveAuthoritative,
} from "./historyProgress.js";

// ─── normalizeHistoryItem / normalizeType ───────────────────────────────────

test("normalizeHistoryItem maps movie→movies and resolves streamId/episodeId/cover", () => {
  const n = normalizeHistoryItem({ type: "movie", stream_id: 42, movie_image: "m.jpg" });
  assert.equal(n.type, "movies");
  assert.equal(n.streamId, 42);
  assert.equal(n.episodeId, 42);
  assert.equal(n.cover, "m.jpg");
});

test("normalizeType agrees with normalizeHistoryItem on the movie→movies rule", () => {
  assert.equal(normalizeType("movie"), "movies");
  assert.equal(normalizeType("series"), "series");
  assert.equal(normalizeType("live"), "live");
  assert.equal(normalizeType("movie"), normalizeHistoryItem({ type: "movie", id: 1 }).type);
});

test("normalizeHistoryItem prefers explicit streamId over stream_id over id", () => {
  assert.equal(normalizeHistoryItem({ type: "live", streamId: 1, stream_id: 2, id: 3 }).streamId, 1);
  assert.equal(normalizeHistoryItem({ type: "live", stream_id: 2, id: 3 }).streamId, 2);
  assert.equal(normalizeHistoryItem({ type: "live", id: 3 }).streamId, 3);
});

// ─── isDifferentTitle (dedupe key) ───────────────────────────────────────────

test("isDifferentTitle: same type+streamId is the same title", () => {
  assert.equal(isDifferentTitle({ type: "movies", streamId: 5 }, { type: "movies", streamId: 5 }), false);
  assert.equal(isDifferentTitle({ type: "movies", streamId: 5 }, { type: "movies", streamId: 6 }), true);
  assert.equal(isDifferentTitle({ type: "live", streamId: 5 }, { type: "movies", streamId: 5 }), true);
});

test("isDifferentTitle: series dedupe by seriesId over streamId", () => {
  const a = { type: "series", seriesId: "s1", streamId: 100 };
  const b = { type: "series", seriesId: "s1", streamId: 200 }; // diff episode, same series
  assert.equal(isDifferentTitle(a, b), false);
  const c = { type: "series", seriesId: "s2", streamId: 100 };
  assert.equal(isDifferentTitle(a, c), true);
});

// ─── upsertHistoryItem (addToWatchHistory core) ──────────────────────────────

test("upsertHistoryItem: creates a new front entry when none matches", () => {
  const { history, entry } = upsertHistoryItem([], normalizeHistoryItem({ type: "movie", id: 7 }), "2026-01-01T00:00:00Z");
  assert.equal(history.length, 1);
  assert.equal(history[0], entry);
  assert.equal(entry.type, "movies");
  assert.equal(entry.streamId, 7);
});

test("upsertHistoryItem: re-opening (currentTime 0) preserves saved position and dedupes", () => {
  const start = [
    { type: "movies", streamId: 7, id: "movies_7_1", currentTime: 512, duration: 3600, watchedAt: "2026-01-01T00:00:00Z" },
    { type: "movies", streamId: 8, id: "movies_8_1", currentTime: 10, duration: 60, watchedAt: "2026-01-02T00:00:00Z" },
  ];
  const item = normalizeHistoryItem({ type: "movie", id: 7, currentTime: 0, duration: 0 });
  const { history, entry } = upsertHistoryItem(start, item, "2026-02-01T00:00:00Z");
  assert.equal(history.length, 2); // deduped, not appended
  assert.equal(history[0], entry); // moved to front
  assert.equal(entry.id, "movies_7_1"); // id preserved
  assert.equal(entry.currentTime, 512); // saved position preserved
  assert.equal(entry.watchedAt, "2026-02-01T00:00:00Z");
});

test("upsertHistoryItem: switching episodes within a series does NOT carry the prior episode's position", () => {
  // S1E5 watched to near the end.
  const start = [
    { type: "series", seriesId: "s1", streamId: 105, id: "series_105_1", seasonNum: 1, episodeNum: 5, currentTime: 3500, duration: 3600, watchedAt: "2026-01-01T00:00:00Z" },
  ];
  // Opening / auto-advancing to S1E6 — a normal open carries currentTime 0.
  const item = normalizeHistoryItem({ type: "series", seriesId: "s1", streamId: 106, seasonNum: 1, episodeNum: 6, currentTime: 0, duration: 0 });
  const { entry } = upsertHistoryItem(start, item, "2026-02-01T00:00:00Z");
  assert.equal(entry.streamId, 106); // now points at E6
  assert.equal(entry.episodeNum, 6);
  // Must NOT inherit E5's near-end position, or "Continue" would seek E6 to its
  // end and immediately auto-advance to E7.
  assert.equal(entry.currentTime, 0);
  assert.equal(entry.duration, 0);
});

test("upsertHistoryItem: caps to MAX_HISTORY", () => {
  const start = Array.from({ length: MAX_HISTORY }, (_, i) => ({
    type: "movies", streamId: i, id: `movies_${i}_1`, watchedAt: "2026-01-01T00:00:00Z",
  }));
  const { history } = upsertHistoryItem(start, normalizeHistoryItem({ type: "movie", id: 999 }), "2026-02-01T00:00:00Z");
  assert.equal(history.length, MAX_HISTORY);
  assert.equal(history[0].streamId, 999);
});

// ─── applyProgress (updateWatchProgress core) ────────────────────────────────

test("applyProgress: updates the matching row in place (position preserved)", () => {
  const start = [
    { type: "movies", streamId: 7, id: "movies_7_1", currentTime: 0, duration: 0, watchedAt: "2026-01-01T00:00:00Z" },
    { type: "series", streamId: 8, id: "series_8_1", currentTime: 0, duration: 0, watchedAt: "2026-01-02T00:00:00Z" },
  ];
  const { history, entry } = applyProgress(start, { streamId: 7, type: "movie", currentTime: 300, duration: 3600 }, "2026-02-01T00:00:00Z");
  assert.equal(history.length, 2);
  assert.equal(history[0], entry); // same index, not moved
  assert.equal(entry.id, "movies_7_1");
  assert.equal(entry.currentTime, 300);
  assert.equal(entry.duration, 3600);
  assert.equal(history[1].currentTime, 0); // other row untouched
});

test("applyProgress: UPSERT — creates an entry when no row matches (bug A fix)", () => {
  const { history, entry } = applyProgress([], { streamId: 42, type: "movie", currentTime: 120, duration: 600 }, "2026-02-01T00:00:00Z");
  assert.equal(history.length, 1);
  assert.equal(history[0], entry);
  assert.equal(entry.type, "movies"); // normalized
  assert.equal(entry.streamId, 42);
  assert.equal(entry.currentTime, 120);
  assert.equal(entry.duration, 600);
  assert.ok(entry.id);
});

test("applyProgress: a zero-position write does NOT clobber a saved resume (hung-on-load fix)", () => {
  const start = [
    { type: "movies", streamId: 7, id: "movies_7_1", currentTime: 300, duration: 3600, watchedAt: "2026-01-01T00:00:00Z" },
  ];
  // Simulates handleClose after a resume that hung on load: player.currentTime ≈ 0.
  const { history, entry } = applyProgress(start, { streamId: 7, type: "movie", currentTime: 0, duration: 0 }, "2026-02-01T00:00:00Z");
  assert.equal(entry.currentTime, 300); // resume position preserved
  assert.equal(entry.duration, 3600); // duration not zeroed
  assert.equal(entry.watchedAt, "2026-02-01T00:00:00Z"); // still bumped to recently opened
  assert.equal(history[0], entry);
});

test("applyProgress: a legit zero write DOES apply when no prior position exists", () => {
  const start = [
    { type: "movies", streamId: 7, id: "movies_7_1", currentTime: 0, duration: 0, watchedAt: "2026-01-01T00:00:00Z" },
  ];
  const { entry } = applyProgress(start, { streamId: 7, type: "movie", currentTime: 0, duration: 0 }, "2026-02-01T00:00:00Z");
  assert.equal(entry.currentTime, 0);
  assert.equal(entry.duration, 0);
});

test("applyProgress: two in-flight streams do not overwrite each other", () => {
  let hist = [];
  ({ history: hist } = applyProgress(hist, { streamId: 1, type: "movie", currentTime: 100, duration: 1000 }, "2026-01-01T00:00:00Z"));
  ({ history: hist } = applyProgress(hist, { streamId: 2, type: "series", currentTime: 200, duration: 2000 }, "2026-01-01T00:01:00Z"));
  ({ history: hist } = applyProgress(hist, { streamId: 1, type: "movie", currentTime: 150, duration: 1000 }, "2026-01-01T00:02:00Z"));
  ({ history: hist } = applyProgress(hist, { streamId: 2, type: "series", currentTime: 250, duration: 2000 }, "2026-01-01T00:03:00Z"));
  const s1 = hist.find((h) => h.streamId === 1 && h.type === "movies");
  const s2 = hist.find((h) => h.streamId === 2 && h.type === "series");
  assert.equal(s1.currentTime, 150);
  assert.equal(s2.currentTime, 250);
  assert.equal(hist.length, 2);
});

// ─── mergeHistories ──────────────────────────────────────────────────────────

test("mergeHistories: dedupe by id, newest watchedAt wins", () => {
  const local = [{ id: "a", watchedAt: "2026-01-01T00:00:00Z", currentTime: 5 }];
  const remote = [{ id: "a", watchedAt: "2026-01-02T00:00:00Z", currentTime: 50 }];
  const merged = mergeHistories(local, remote);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].currentTime, 50); // remote is newer
});

test("mergeHistories: local wins when locally newer", () => {
  const local = [{ id: "a", watchedAt: "2026-01-03T00:00:00Z", currentTime: 5 }];
  const remote = [{ id: "a", watchedAt: "2026-01-02T00:00:00Z", currentTime: 50 }];
  assert.equal(mergeHistories(local, remote)[0].currentTime, 5);
});

test("mergeHistories: sorts newest-first and caps to MAX_HISTORY", () => {
  const local = Array.from({ length: MAX_HISTORY + 10 }, (_, i) => ({
    id: `l${i}`, watchedAt: new Date(2026, 0, 1, 0, i).toISOString(),
  }));
  const merged = mergeHistories(local, []);
  assert.equal(merged.length, MAX_HISTORY);
  // newest-first
  for (let i = 1; i < merged.length; i++)
    assert.ok(new Date(merged[i - 1].watchedAt) >= new Date(merged[i].watchedAt));
});

test("mergeFavorites: newer addedAt wins for a shared id", () => {
  const local = [{ id: "a", addedAt: "2026-01-01T00:00:00Z" }];
  const remote = [{ id: "a", addedAt: "2026-02-01T00:00:00Z" }];
  const out = mergeFavorites(local, remote);
  assert.equal(out.length, 1);
  assert.equal(out[0].addedAt, "2026-02-01T00:00:00Z");
});

test("mergeFavorites: local wins when it is the newer of a shared id", () => {
  const local = [{ id: "a", addedAt: "2026-03-01T00:00:00Z" }];
  const remote = [{ id: "a", addedAt: "2026-02-01T00:00:00Z" }];
  assert.equal(mergeFavorites(local, remote)[0].addedAt, "2026-03-01T00:00:00Z");
});

test("mergeFavorites: unions distinct ids, sorted newest-first, no cap", () => {
  const local = [{ id: "a", addedAt: "2026-01-01T00:00:00Z" }];
  const remote = [{ id: "b", addedAt: "2026-05-01T00:00:00Z" }, { id: "c", addedAt: "2026-03-01T00:00:00Z" }];
  const out = mergeFavorites(local, remote);
  assert.deepEqual(out.map((x) => x.id), ["b", "c", "a"]);
});

// ─── resolveAuthoritative ────────────────────────────────────────────────────

test("resolveAuthoritative: successful fetch replaces local so a remote-side delete propagates", () => {
  const localBase = [
    { id: "a", watchedAt: "2026-01-02T00:00:00Z" },
    { id: "b", watchedAt: "2026-01-01T00:00:00Z" }, // deleted on another device
  ];
  const remote = [{ id: "a", watchedAt: "2026-01-02T00:00:00Z" }];
  const out = resolveAuthoritative({ localBase, remote, fetchOk: true, tsField: "watchedAt" });
  assert.deepEqual(out.map((x) => x.id), ["a"]); // "b" is gone
});

test("resolveAuthoritative: failed fetch keeps local base (never wipe offline)", () => {
  const localBase = [{ id: "a", watchedAt: "2026-01-01T00:00:00Z" }];
  const out = resolveAuthoritative({ localBase, remote: null, fetchOk: false, tsField: "watchedAt" });
  assert.strictEqual(out, localBase);
});

test("resolveAuthoritative: non-array remote keeps local base even when fetchOk", () => {
  const localBase = [{ id: "a", watchedAt: "2026-01-01T00:00:00Z" }];
  const out = resolveAuthoritative({ localBase, remote: undefined, fetchOk: true, tsField: "watchedAt" });
  assert.strictEqual(out, localBase);
});

test("resolveAuthoritative: sorts remote newest-first and caps history to MAX_HISTORY", () => {
  const remote = Array.from({ length: MAX_HISTORY + 5 }, (_, i) => ({
    id: `r${i}`, watchedAt: new Date(2026, 0, 1, 0, i).toISOString(),
  }));
  const out = resolveAuthoritative({ localBase: [], remote, fetchOk: true, tsField: "watchedAt", cap: MAX_HISTORY });
  assert.equal(out.length, MAX_HISTORY);
  for (let i = 1; i < out.length; i++)
    assert.ok(new Date(out[i - 1].watchedAt) >= new Date(out[i].watchedAt));
});

test("resolveAuthoritative: favorites sort by addedAt with no cap", () => {
  const remote = [
    { id: "a", addedAt: "2026-01-01T00:00:00Z" },
    { id: "b", addedAt: "2026-05-01T00:00:00Z" },
  ];
  const out = resolveAuthoritative({ localBase: [], remote, fetchOk: true, tsField: "addedAt" });
  assert.deepEqual(out.map((x) => x.id), ["b", "a"]);
});
