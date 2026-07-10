import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { IPTVApi } from "./iptvApi.js";

// The robust bulk fetchers (getAllVODStreamsRobust / getAllSeriesRobust) power
// the All Movies / All Series grids with branch-heavy fallback logic and had no
// coverage. They also exercise the module-private runPool, which we test through
// the per-category fan-out (its ordering + concurrency bound).

const jsonRes = (data) => ({ ok: true, status: 200, text: async () => JSON.stringify(data) });
const httpErr = (status) => ({ ok: false, status, text: async () => "{}" });

function makeApi() {
  const api = new IPTVApi();
  api.setCredentials("http://box:8080", "u", "p");
  return api;
}

describe("getAllVODStreamsRobust — fallback branches", () => {
  let realFetch;
  beforeEach(() => { realFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = realFetch; });

  test("uses the bulk endpoint and dedupes by stream_id (no fan-out)", async () => {
    let catHit = 0;
    globalThis.fetch = async (url) => {
      if (url.includes("get_vod_categories")) { catHit++; return jsonRes([]); }
      if (url.includes("category_id=")) return jsonRes([]);
      return jsonRes([{ stream_id: 1 }, { stream_id: 2 }, { stream_id: 1 }]); // bulk, with a dupe
    };
    const out = await makeApi().getAllVODStreamsRobust();
    assert.deepEqual(out.map((x) => x.stream_id), [1, 2]);
    assert.equal(catHit, 0, "categories never fetched when the bulk endpoint returns data");
  });

  test("falls back to per-category fan-out when the bulk endpoint throws (403)", async () => {
    globalThis.fetch = async (url) => {
      if (url.includes("get_vod_categories")) return jsonRes([{ category_id: "a" }, { category_id: "b" }]);
      if (url.includes("category_id=a")) return jsonRes([{ stream_id: 10 }, { stream_id: 11 }]);
      if (url.includes("category_id=b")) return jsonRes([{ stream_id: 11 }, { stream_id: 12 }]); // 11 dupes across cats
      return httpErr(403); // bulk endpoint blocked
    };
    const out = await makeApi().getAllVODStreamsRobust();
    assert.deepEqual(out.map((x) => x.stream_id), [10, 11, 12], "merged in category order, deduped across categories");
  });

  test("falls back when the bulk endpoint returns an empty array", async () => {
    globalThis.fetch = async (url) => {
      if (url.includes("get_vod_categories")) return jsonRes([{ category_id: "a" }]);
      if (url.includes("category_id=a")) return jsonRes([{ stream_id: 7 }]);
      return jsonRes([]); // bulk is empty (not an error) → still fall through
    };
    const out = await makeApi().getAllVODStreamsRobust();
    assert.deepEqual(out.map((x) => x.stream_id), [7]);
  });

  test("returns [] when the bulk endpoint fails and there are no categories", async () => {
    globalThis.fetch = async (url) => {
      if (url.includes("get_vod_categories")) return jsonRes([]);
      return httpErr(403);
    };
    assert.deepEqual(await makeApi().getAllVODStreamsRobust(), []);
  });

  test("tolerates a per-category failure and still returns the others", async () => {
    globalThis.fetch = async (url) => {
      if (url.includes("get_vod_categories")) return jsonRes([{ category_id: "a" }, { category_id: "b" }]);
      if (url.includes("category_id=a")) return httpErr(404); // one category fails (4xx → no retry)
      if (url.includes("category_id=b")) return jsonRes([{ stream_id: 5 }]);
      return httpErr(403);
    };
    const out = await makeApi().getAllVODStreamsRobust();
    assert.deepEqual(out.map((x) => x.stream_id), [5]);
  });

  test("runPool bounds fan-out concurrency to 5 and preserves category order", async () => {
    let inFlight = 0, peak = 0;
    const cats = Array.from({ length: 12 }, (_, i) => ({ category_id: `c${i}` }));
    globalThis.fetch = async (url) => {
      if (url.includes("get_vod_categories")) return jsonRes(cats);
      if (url.includes("category_id=")) {
        inFlight++; peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return jsonRes([{ stream_id: Number(url.match(/category_id=c(\d+)/)[1]) }]);
      }
      return httpErr(403); // force fan-out
    };
    const out = await makeApi().getAllVODStreamsRobust();
    assert.deepEqual(out.map((x) => x.stream_id), cats.map((_, i) => i), "results follow category order");
    assert.ok(peak <= 5, `concurrency bounded to 5 (peak=${peak})`);
    assert.ok(peak > 1, `fan-out actually runs in parallel (peak=${peak})`);
  });
});

describe("getAllSeriesRobust — fallback", () => {
  let realFetch;
  beforeEach(() => { realFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = realFetch; });

  test("bulk endpoint path dedupes by series_id", async () => {
    globalThis.fetch = async (url) => {
      if (url.includes("get_series_categories")) return jsonRes([]);
      if (url.includes("category_id=")) return jsonRes([]);
      return jsonRes([{ series_id: 1 }, { series_id: 1 }, { series_id: 2 }]);
    };
    const out = await makeApi().getAllSeriesRobust();
    assert.deepEqual(out.map((x) => x.series_id), [1, 2]);
  });

  test("fans out per-category on a bulk failure, deduped by series_id", async () => {
    globalThis.fetch = async (url) => {
      if (url.includes("get_series_categories")) return jsonRes([{ category_id: "a" }, { category_id: "b" }]);
      if (url.includes("category_id=a")) return jsonRes([{ series_id: 100 }]);
      if (url.includes("category_id=b")) return jsonRes([{ series_id: 100 }, { series_id: 200 }]);
      return httpErr(403);
    };
    const out = await makeApi().getAllSeriesRobust();
    assert.deepEqual(out.map((x) => x.series_id), [100, 200]);
  });
});
