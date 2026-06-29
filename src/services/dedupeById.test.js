import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { dedupeById } from "./iptvApi.js";

describe("dedupeById", () => {
  test("removes duplicate ids, keeping first occurrence", () => {
    const out = dedupeById(
      [
        { stream_id: 1, name: "A" },
        { stream_id: 2, name: "B" },
        { stream_id: 1, name: "A-dupe" },
      ],
      "stream_id",
    );
    assert.deepEqual(out.map((i) => i.name), ["A", "B"]);
  });

  test("drops entries with null/undefined id (placeholder rows)", () => {
    const out = dedupeById(
      [
        { stream_id: 1 },
        { stream_id: null },
        { stream_id: undefined },
        {},
        { stream_id: 2 },
      ],
      "stream_id",
    );
    assert.deepEqual(out.map((i) => i.stream_id), [1, 2]);
  });

  test("treats 0 as a valid id (not null)", () => {
    const out = dedupeById([{ stream_id: 0 }, { stream_id: 0 }], "stream_id");
    assert.equal(out.length, 1);
    assert.equal(out[0].stream_id, 0);
  });

  test("works for an arbitrary id field (series_id)", () => {
    const out = dedupeById(
      [{ series_id: 9 }, { series_id: 9 }, { series_id: 10 }],
      "series_id",
    );
    assert.deepEqual(out.map((i) => i.series_id), [9, 10]);
  });

  test("returns [] for non-array input", () => {
    assert.deepEqual(dedupeById(null, "stream_id"), []);
    assert.deepEqual(dedupeById(undefined, "stream_id"), []);
  });
});
