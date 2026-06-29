import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  decideResume,
  resolveChoice,
  findHistoryEntry,
  RESUME_MIN_SECONDS,
  RESUME_MAX_PERCENT,
} from "./resumeDecision.js";

describe("decideResume", () => {
  test("offers resume for a VOD entry past the floor and below the ceiling", () => {
    const d = decideResume({ currentTime: 300, duration: 1000, type: "movies" });
    assert.equal(d.hasResume, true);
    assert.equal(d.resumeTime, 300);
    assert.equal(d.duration, 1000);
    assert.equal(d.percent, 0.3);
  });

  test("no resume for live", () => {
    const d = decideResume({ currentTime: 300, duration: 1000 }, { isLive: true });
    assert.equal(d.hasResume, false);
    assert.equal(d.resumeTime, 0);
  });

  test("no resume when null/missing entry", () => {
    assert.equal(decideResume(null).hasResume, false);
    assert.equal(decideResume(undefined).hasResume, false);
  });

  test("no resume at or below the minimum-seconds floor", () => {
    assert.equal(decideResume({ currentTime: RESUME_MIN_SECONDS, duration: 1000 }).hasResume, false);
    assert.equal(decideResume({ currentTime: 5, duration: 1000 }).hasResume, false);
    // just above the floor -> resume
    assert.equal(decideResume({ currentTime: RESUME_MIN_SECONDS + 1, duration: 1000 }).hasResume, true);
  });

  test("no resume at or above the finished ceiling", () => {
    const atCeiling = decideResume({ currentTime: 950, duration: 1000 });
    assert.equal(atCeiling.hasResume, false); // 95% exactly => finished
    const past = decideResume({ currentTime: 990, duration: 1000 });
    assert.equal(past.hasResume, false);
    const justBelow = decideResume({ currentTime: 940, duration: 1000 });
    assert.equal(justBelow.hasResume, true);
  });

  test("RESUME_MAX_PERCENT is the ceiling used", () => {
    const justUnder = decideResume({ currentTime: 1000 * RESUME_MAX_PERCENT - 1, duration: 1000 });
    assert.equal(justUnder.hasResume, true);
  });

  test("unknown duration: resume offered when past floor, percent reported as 0", () => {
    const d = decideResume({ currentTime: 120, duration: 0 });
    assert.equal(d.hasResume, true);
    assert.equal(d.percent, 0);
    assert.equal(d.duration, 0);
  });

  test("tolerates string numbers", () => {
    const d = decideResume({ currentTime: "300", duration: "1000" });
    assert.equal(d.hasResume, true);
    assert.equal(d.resumeTime, 300);
    assert.equal(d.percent, 0.3);
  });

  test("custom thresholds respected", () => {
    const d = decideResume({ currentTime: 5, duration: 1000 }, { minSeconds: 2, maxPercent: 0.5 });
    assert.equal(d.hasResume, true);
    const finished = decideResume({ currentTime: 600, duration: 1000 }, { maxPercent: 0.5 });
    assert.equal(finished.hasResume, false);
  });
});

describe("resolveChoice", () => {
  test("resume returns saved time, startOver returns 0", () => {
    assert.equal(resolveChoice("resume", 300), 300);
    assert.equal(resolveChoice("startOver", 300), 0);
  });

  test("non-resume choices return 0", () => {
    assert.equal(resolveChoice("anything", 300), 0);
  });

  test("tolerates non-numeric resumeTime", () => {
    assert.equal(resolveChoice("resume", undefined), 0);
    assert.equal(resolveChoice("resume", "abc"), 0);
  });
});

describe("findHistoryEntry", () => {
  const history = [
    { type: "movies", streamId: 42, currentTime: 100, duration: 1000 },
    { type: "series", streamId: "ep-7", currentTime: 50, duration: 1400 },
    { type: "live", streamId: 9, currentTime: 0, duration: 0 },
  ];

  test("matches normalized movie type ('movie' -> 'movies')", () => {
    const e = findHistoryEntry(history, { type: "movie", streamId: 42 });
    assert.equal(e?.currentTime, 100);
  });

  test("matches series by string streamId", () => {
    const e = findHistoryEntry(history, { type: "series", streamId: "ep-7" });
    assert.equal(e?.currentTime, 50);
  });

  test("matches across number/string streamId mismatch", () => {
    const e = findHistoryEntry(history, { type: "movie", streamId: "42" });
    assert.equal(e?.currentTime, 100);
  });

  test("falls back to stream_id / id fields", () => {
    assert.equal(findHistoryEntry(history, { type: "movie", stream_id: 42 })?.currentTime, 100);
    assert.equal(findHistoryEntry(history, { type: "movie", id: 42 })?.currentTime, 100);
  });

  test("returns undefined for unknown / null inputs", () => {
    assert.equal(findHistoryEntry(history, { type: "movie", streamId: 999 }), undefined);
    assert.equal(findHistoryEntry(history, null), undefined);
    assert.equal(findHistoryEntry(null, { type: "movie", streamId: 42 }), undefined);
    assert.equal(findHistoryEntry(history, { type: "movie" }), undefined);
  });
});

describe("decideResume + resolveChoice integration", () => {
  test("a typical mid-watch movie yields resume time on 'resume'", () => {
    const entry = { type: "movies", streamId: 1, currentTime: 412, duration: 5400 };
    const d = decideResume(entry, { isLive: false });
    assert.equal(d.hasResume, true);
    assert.equal(resolveChoice("resume", d.resumeTime), 412);
    assert.equal(resolveChoice("startOver", d.resumeTime), 0);
  });
});
