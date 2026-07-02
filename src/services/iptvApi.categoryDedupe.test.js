import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { IPTVApi } from "./iptvApi.js";

// The provider's per-category feeds can list the same title twice (same id) —
// the same duplication the bulk "all" endpoints already dedupe. These guard that
// the per-category methods dedupe too, so a category rail/grid never renders two
// identical cards. Stub `fetch` (the network boundary) and assert the method's
// returned list is deduped by its id field.
describe("IPTVApi per-category feeds dedupe by id", () => {
  let api;
  beforeEach(() => {
    api = new IPTVApi();
    // A bare IPTVApi has no configured base URL, so buildUrl() throws before the
    // fetcher runs. Stub it to a dummy string — this test only cares that the
    // method dedupes whatever `fetch` returns, not how the URL is built.
    api.buildUrl = () => "http://test/";
  });

  test("getVODStreams drops duplicate stream_ids in a category feed", async () => {
    api.fetch = async () => [
      { stream_id: 1, name: "A" },
      { stream_id: 2, name: "B" },
      { stream_id: 1, name: "A (dupe)" },
    ];
    const out = await api.getVODStreams("42");
    assert.deepEqual(out.map((i) => i.stream_id), [1, 2]);
  });

  test("getSeries drops duplicate series_ids in a category feed", async () => {
    api.fetch = async () => [
      { series_id: 9, name: "S" },
      { series_id: 9, name: "S (dupe)" },
      { series_id: 10, name: "T" },
    ];
    const out = await api.getSeries("7");
    assert.deepEqual(out.map((i) => i.series_id), [9, 10]);
  });

  test("getLiveStreamsByCategory drops duplicate stream_ids in a category feed", async () => {
    api.fetch = async () => [
      { stream_id: 5, name: "Ch5" },
      { stream_id: 5, name: "Ch5 (dupe)" },
      { stream_id: 6, name: "Ch6" },
    ];
    const out = await api.getLiveStreamsByCategory("3");
    assert.deepEqual(out.map((i) => i.stream_id), [5, 6]);
  });
});
