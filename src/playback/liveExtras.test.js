import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { nextChannel, prevChannel, decodeEpgText } from "./liveExtras.js";

const list = [
  { stream_id: 10, name: "A" },
  { stream_id: 20, name: "B" },
  { stream_id: 30, name: "C" },
];

describe("nextChannel", () => {
  test("returns the adjacent channel", () => {
    assert.equal(nextChannel(list, 10).stream_id, 20);
    assert.equal(nextChannel(list, 20).stream_id, 30);
  });

  test("wraps from last to first", () => {
    assert.equal(nextChannel(list, 30).stream_id, 10);
  });

  test("tolerates string/number id mismatch", () => {
    assert.equal(nextChannel(list, "20").stream_id, 30);
  });

  test("unknown id falls back to first", () => {
    assert.equal(nextChannel(list, 999).stream_id, 10);
  });

  test("single-element list returns the sole element", () => {
    const one = [{ stream_id: 5 }];
    assert.equal(nextChannel(one, 5).stream_id, 5);
  });

  test("empty / bad list returns null", () => {
    assert.equal(nextChannel([], 1), null);
    assert.equal(nextChannel(null, 1), null);
  });
});

describe("prevChannel", () => {
  test("returns the adjacent channel", () => {
    assert.equal(prevChannel(list, 30).stream_id, 20);
    assert.equal(prevChannel(list, 20).stream_id, 10);
  });

  test("wraps from first to last", () => {
    assert.equal(prevChannel(list, 10).stream_id, 30);
  });

  test("unknown id falls back to last", () => {
    assert.equal(prevChannel(list, 999).stream_id, 30);
  });

  test("single-element list returns the sole element", () => {
    const one = [{ stream_id: 5 }];
    assert.equal(prevChannel(one, 5).stream_id, 5);
  });

  test("empty / bad list returns null", () => {
    assert.equal(prevChannel([], 1), null);
    assert.equal(prevChannel(undefined, 1), null);
  });
});

describe("next/prev are inverses across the ring", () => {
  test("prev(next(x)) === x for every channel", () => {
    for (const ch of list) {
      const fwd = nextChannel(list, ch.stream_id);
      assert.equal(prevChannel(list, fwd.stream_id).stream_id, ch.stream_id);
    }
  });
});

describe("decodeEpgText", () => {
  test("decodes base64 to utf-8", () => {
    // "News" base64 -> "TmV3cw=="
    assert.equal(decodeEpgText("TmV3cw=="), "News");
  });

  test("empty / nullish -> empty string", () => {
    assert.equal(decodeEpgText(""), "");
    assert.equal(decodeEpgText(null), "");
    assert.equal(decodeEpgText(undefined), "");
  });
});
