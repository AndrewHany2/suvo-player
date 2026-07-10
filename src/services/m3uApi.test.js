import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { M3UApi } from "./m3uApi.js";

// A mixed Xtream m3u_plus-style playlist: live (no kind in path), movies
// (/movie/), and series episodes (/series/) grouped by group-title.
const PLAYLIST = [
  "#EXTM3U",
  '#EXTINF:-1 tvg-id="a" tvg-logo="http://l/a.png" group-title="News",A News',
  "http://srv/u/p/101",
  '#EXTINF:-1 group-title="Sports",B Sports',
  "http://srv/u/p/102",
  '#EXTINF:-1 tvg-logo="http://l/m.png" group-title="Action Movies",Big Movie (2021)',
  "http://srv/movie/u/p/2001.mp4",
  '#EXTINF:-1 group-title="Drama Series",Breaking Bad S01E01',
  "http://srv/series/u/p/3001.mkv",
  '#EXTINF:-1 group-title="Drama Series",Breaking Bad S01E02',
  "http://srv/series/u/p/3002.mkv",
  '#EXTINF:-1 group-title="Drama Series",Breaking Bad S02E01',
  "http://srv/series/u/p/3003.mkv",
].join("\n");

let realFetch;
function stub(body) {
  globalThis.fetch = async () => ({ ok: true, async text() { return body; } });
}
beforeEach(() => { realFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = realFetch; });

test("live: only non-movie/series entries, grouped", async () => {
  stub(PLAYLIST);
  const api = new M3UApi();
  api.setCredentials("http://pl/list.m3u");
  const cats = await api.getLiveCategories();
  assert.deepEqual(cats.map((c) => c.category_name), ["News", "Sports"]);
  const all = await api.getLiveStreams();
  assert.equal(all.length, 2);
  assert.equal(all[0].name, "A News");
});

test("movies: classified by /movie/ path, shaped for normalizeMovie", async () => {
  stub(PLAYLIST);
  const api = new M3UApi();
  api.setCredentials("http://pl/list.m3u");
  const cats = await api.getVODCategories();
  assert.deepEqual(cats.map((c) => c.category_name), ["Action Movies"]);
  const movies = await api.getAllVODStreamsRobust();
  assert.equal(movies.length, 1);
  assert.equal(movies[0].name, "Big Movie (2021)");
  assert.equal(movies[0].stream_icon, "http://l/m.png");
  assert.equal(movies[0].container_extension, "mp4");
  // play url is the raw entry URL
  assert.equal(api.buildStreamUrl("movie", movies[0].stream_id), "http://srv/movie/u/p/2001.mp4");
});

test("series: episodes grouped into series → seasons", async () => {
  stub(PLAYLIST);
  const api = new M3UApi();
  api.setCredentials("http://pl/list.m3u");
  const seriesCats = await api.getSeriesCategories();
  assert.deepEqual(seriesCats.map((c) => c.category_name), ["Drama Series"]);

  const series = await api.getAllSeriesRobust();
  assert.equal(series.length, 1);
  assert.equal(series[0].name, "Breaking Bad");

  const info = await api.getSeriesInfo(series[0].series_id);
  assert.deepEqual(Object.keys(info.episodes).sort(), ["1", "2"]);
  assert.equal(info.episodes["1"].length, 2);
  assert.equal(info.episodes["2"].length, 1);
  const ep1 = info.episodes["1"][0];
  assert.equal(ep1.episode_num, 1);
  assert.equal(ep1.container_extension, "mkv");
  // episode play url is the raw entry URL
  assert.equal(api.buildStreamUrl("series", ep1.id, "mkv"), "http://srv/series/u/p/3001.mkv");
});

test("getSeriesInfo for unknown id returns empty structure", async () => {
  stub(PLAYLIST);
  const api = new M3UApi();
  api.setCredentials("http://pl/list.m3u");
  const info = await api.getSeriesInfo("nope");
  assert.deepEqual(info, { info: {}, episodes: {} });
});

test("fetches the playlist only once across live/vod/series calls", async () => {
  let hits = 0;
  globalThis.fetch = async () => { hits++; return { ok: true, async text() { return PLAYLIST; } }; };
  const api = new M3UApi();
  api.setCredentials("http://pl/list.m3u");
  await api.getLiveCategories();
  await api.getAllVODStreamsRobust();
  await api.getAllSeriesRobust();
  assert.equal(hits, 1);
});

test("throws a readable error on HTTP failure", async () => {
  globalThis.fetch = async () => ({ ok: false, status: 404, async text() { return ""; } });
  const api = new M3UApi();
  api.setCredentials("http://pl/missing.m3u");
  await assert.rejects(() => api.getLiveStreams(), /404/);
});

test("rejects on timeout even if fetch never settles", async (t) => {
  // Mock setTimeout so the 30s deadline fires on demand instead of in real time.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  globalThis.fetch = () => new Promise(() => {}); // hangs forever, never resolves
  const api = new M3UApi();
  api.setCredentials("http://pl/hang.m3u");
  const assertion = assert.rejects(() => api.getLiveStreams(), /timed out/);
  t.mock.timers.tick(30 * 1000);
  await assertion;
});

test("plain playlist with no path kinds → all live", async () => {
  stub(["#EXTM3U", "#EXTINF:-1,Chan 1", "http://h/1", "#EXTINF:-1,Chan 2", "http://h/2"].join("\n"));
  const api = new M3UApi();
  api.setCredentials("http://pl/plain.m3u");
  assert.equal((await api.getLiveStreams()).length, 2);
  assert.deepEqual(await api.getAllVODStreamsRobust(), []);
  assert.deepEqual(await api.getAllSeriesRobust(), []);
});
