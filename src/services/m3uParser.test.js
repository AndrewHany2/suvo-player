import { test } from "node:test";
import assert from "node:assert/strict";
import { parseM3U, classifyEntry, parseEpisodeName, extFromUrl } from "./m3uParser.js";

test("classifyEntry: URL path /movie/ and /series/ win over group-title", () => {
  assert.equal(classifyEntry({ url: "http://h/movie/u/p/1.mp4", groupTitle: "News" }), "movie");
  assert.equal(classifyEntry({ url: "http://h/series/u/p/1.mkv", groupTitle: "News" }), "series");
  assert.equal(classifyEntry({ url: "http://h/u/p/1", groupTitle: "Sports" }), "live");
});

test("classifyEntry: group-title fallback when path has no kind", () => {
  assert.equal(classifyEntry({ url: "http://h/x.mp4", groupTitle: "VOD | Action" }), "movie");
  assert.equal(classifyEntry({ url: "http://h/x.mkv", groupTitle: "Series - Drama" }), "series");
  assert.equal(classifyEntry({ url: "http://h/x", groupTitle: "News HD" }), "live");
});

test("parseEpisodeName: SxxExx, Sx Ex, and 1x02 forms", () => {
  assert.deepEqual(parseEpisodeName("Breaking Bad S01E02"), { series: "Breaking Bad", season: 1, episode: 2 });
  assert.deepEqual(parseEpisodeName("Show Name S1 E14"), { series: "Show Name", season: 1, episode: 14 });
  assert.deepEqual(parseEpisodeName("The Wire 3x05 - Title"), { series: "The Wire", season: 3, episode: 5 });
});

test("parseEpisodeName: no marker → season 1, null episode (caller numbers it)", () => {
  assert.deepEqual(parseEpisodeName("Some Documentary"), { series: "Some Documentary", season: 1, episode: null });
});

test("extFromUrl", () => {
  assert.equal(extFromUrl("http://h/movie/u/p/1.mp4"), "mp4");
  assert.equal(extFromUrl("http://h/u/p/1.mkv?token=x"), "mkv");
  assert.equal(extFromUrl("http://h/u/p/1"), "");
});

test("parses a standard #EXTINF entry with attributes", () => {
  const text = [
    "#EXTM3U",
    '#EXTINF:-1 tvg-id="cnn.us" tvg-logo="http://logo/cnn.png" group-title="News",CNN HD',
    "http://server/live/cnn.m3u8",
  ].join("\n");
  const out = parseM3U(text);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    name: "CNN HD",
    url: "http://server/live/cnn.m3u8",
    tvgId: "cnn.us",
    tvgLogo: "http://logo/cnn.png",
    groupTitle: "News",
  });
});

test("parses multiple entries and preserves order", () => {
  const text = [
    "#EXTM3U",
    "#EXTINF:-1,Channel A",
    "http://a",
    "#EXTINF:-1,Channel B",
    "http://b",
  ].join("\n");
  const out = parseM3U(text);
  assert.equal(out.length, 2);
  assert.equal(out[0].name, "Channel A");
  assert.equal(out[0].url, "http://a");
  assert.equal(out[1].name, "Channel B");
  assert.equal(out[1].url, "http://b");
});

test("defaults missing attributes to empty strings", () => {
  const out = parseM3U("#EXTINF:-1,Bare\nhttp://bare");
  assert.equal(out[0].tvgId, "");
  assert.equal(out[0].tvgLogo, "");
  assert.equal(out[0].groupTitle, "");
});

test("handles CRLF line endings and blank lines", () => {
  const text = "#EXTM3U\r\n\r\n#EXTINF:-1,Name\r\nhttp://x\r\n";
  const out = parseM3U(text);
  assert.equal(out.length, 1);
  assert.equal(out[0].url, "http://x");
});

test("ignores an #EXTINF with no following URL line", () => {
  const text = "#EXTM3U\n#EXTINF:-1,Dangling";
  assert.deepEqual(parseM3U(text), []);
});

test("skips unrelated #-directives between EXTINF and URL (e.g. #EXTVLCOPT)", () => {
  const text = [
    "#EXTM3U",
    "#EXTINF:-1,With Options",
    "#EXTVLCOPT:http-user-agent=Mozilla",
    "http://opt",
  ].join("\n");
  const out = parseM3U(text);
  assert.equal(out.length, 1);
  assert.equal(out[0].url, "http://opt");
});

test("tolerates single-quoted attribute values", () => {
  const out = parseM3U("#EXTINF:-1 group-title='Sports',Match\nhttp://m");
  assert.equal(out[0].groupTitle, "Sports");
});

test("returns [] for empty or non-string input", () => {
  assert.deepEqual(parseM3U(""), []);
  assert.deepEqual(parseM3U(null), []);
  assert.deepEqual(parseM3U(undefined), []);
});

test("name falls back to tvg-name when comma title is empty", () => {
  const out = parseM3U('#EXTINF:-1 tvg-name="Backup Name",\nhttp://n');
  assert.equal(out[0].name, "Backup Name");
});
