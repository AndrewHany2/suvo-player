import { test } from "node:test";
import assert from "node:assert/strict";
import { resumePlaybackUrl } from "./resumePlaybackUrl.js";

// Why this exists: M3U sources key their stream URLs by playlist array index
// (m3uApi `stream_id = String(i)`), which is NOT stable — providers reorder /
// add / remove entries between sessions, so a saved index later resolves to a
// DIFFERENT stream (often a connection-limited live URL → HTTP 409). A history
// entry captured the exact URL it played, so resuming must replay THAT url and
// only fall back to rebuilding from the volatile id when no url was captured
// (e.g. a favorites entry, which stores none).

test("prefers the captured entry url over rebuilding from the id", () => {
  const entry = { url: "http://srv/token/abc", streamId: "42" };
  const url = resumePlaybackUrl(entry, () => "http://srv/rebuilt/from-id");
  assert.equal(url, "http://srv/token/abc");
});

test("does not invoke the rebuild fallback when a url is present", () => {
  let rebuilt = false;
  resumePlaybackUrl({ url: "http://srv/token/abc" }, () => {
    rebuilt = true;
    return "x";
  });
  assert.equal(rebuilt, false);
});

test("rebuilds when the entry carries no url", () => {
  const url = resumePlaybackUrl({ streamId: "42" }, () => "http://srv/rebuilt/from-id");
  assert.equal(url, "http://srv/rebuilt/from-id");
});

test("treats an empty-string url as absent and rebuilds", () => {
  const url = resumePlaybackUrl({ url: "" }, () => "http://srv/rebuilt/from-id");
  assert.equal(url, "http://srv/rebuilt/from-id");
});

test("rebuilds when the entry itself is null/undefined", () => {
  assert.equal(resumePlaybackUrl(null, () => "http://srv/rebuilt"), "http://srv/rebuilt");
  assert.equal(resumePlaybackUrl(undefined, () => "http://srv/rebuilt"), "http://srv/rebuilt");
});
