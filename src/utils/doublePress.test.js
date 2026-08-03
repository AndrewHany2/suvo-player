import test from "node:test";
import assert from "node:assert/strict";
import { isDoublePress } from "./doublePress.js";

test("isDoublePress: no prior press is never a double", () => {
  assert.equal(isDoublePress(1000, 0), false);
  assert.equal(isDoublePress(1000, null), false);
  assert.equal(isDoublePress(1000, undefined), false);
});

test("isDoublePress: a second press inside the window counts", () => {
  assert.equal(isDoublePress(1300, 1000), true); // 300ms < 400 default
  assert.equal(isDoublePress(1400, 1000), true); // exactly at the boundary
});

test("isDoublePress: a second press past the window does not", () => {
  assert.equal(isDoublePress(1401, 1000), false);
  assert.equal(isDoublePress(2000, 1000), false);
});

test("isDoublePress: honours a custom window", () => {
  assert.equal(isDoublePress(1200, 1000, 250), true);
  assert.equal(isDoublePress(1300, 1000, 250), false);
});
