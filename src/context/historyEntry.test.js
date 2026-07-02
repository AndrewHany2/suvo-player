// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveProgressFields } from "./historyEntry.js";

test("preserves saved position when re-opening a title (currentTime 0)", () => {
  const prev = { currentTime: 512, duration: 3600 };
  const item = { currentTime: 0, duration: 0 }; // normal open carries startTime||0
  assert.deepEqual(resolveProgressFields(prev, item), {
    currentTime: 512,
    duration: 3600,
  });
});

test("takes an explicit incoming position over the saved one (resume/next-episode)", () => {
  const prev = { currentTime: 512, duration: 3600 };
  const item = { currentTime: 900, duration: 3600 };
  assert.deepEqual(resolveProgressFields(prev, item), {
    currentTime: 900,
    duration: 3600,
  });
});

test("new entry (no previous) uses the incoming values, defaulting to 0", () => {
  assert.deepEqual(resolveProgressFields(undefined, { currentTime: 0 }), {
    currentTime: 0,
    duration: 0,
  });
  assert.deepEqual(resolveProgressFields(null, { currentTime: 120, duration: 600 }), {
    currentTime: 120,
    duration: 600,
  });
});
