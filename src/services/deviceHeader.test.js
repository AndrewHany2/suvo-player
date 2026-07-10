import { test } from "node:test";
import assert from "node:assert/strict";
import { getDeviceId, setDeviceId } from "./deviceHeader.js";

// The module holds a single process-wide anchor. Tests run in order and share
// that state, so each case sets what it needs before reading.

test("getDeviceId returns empty string before any id is set", () => {
  // First read of the fresh module: uninitialised anchor coalesces to "".
  assert.equal(getDeviceId(), "");
});

test("setDeviceId then getDeviceId round-trips the value", () => {
  setDeviceId("abc-123");
  assert.equal(getDeviceId(), "abc-123");
});

test("setDeviceId overwrites a previously set id", () => {
  setDeviceId("first");
  setDeviceId("second");
  assert.equal(getDeviceId(), "second");
});

test("clearing the id (null) coalesces back to empty string, not null", () => {
  setDeviceId("something");
  setDeviceId(null);
  // getDeviceId must never hand a null into a header value.
  assert.equal(getDeviceId(), "");
});

test("undefined id also coalesces to empty string", () => {
  setDeviceId(undefined);
  assert.equal(getDeviceId(), "");
});
