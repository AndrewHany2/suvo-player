import { test } from "node:test";
import assert from "node:assert/strict";
import { isAuthError } from "./authError.js";

test("isAuthError is true for 401 and 403 provider failures", () => {
  assert.equal(isAuthError(new Error("HTTP error! status: 401")), true);
  assert.equal(isAuthError(new Error("HTTP error! status: 403")), true);
});

test("isAuthError is false for other statuses and non-status errors", () => {
  assert.equal(isAuthError(new Error("HTTP error! status: 500")), false);
  assert.equal(isAuthError(new Error("HTTP error! status: 404")), false);
  assert.equal(isAuthError(new Error("Request timed out after 15000ms")), false);
  assert.equal(isAuthError(new Error("Non-JSON response from provider: Blocked")), false);
});

test("isAuthError is false for nullish / shapeless input", () => {
  assert.equal(isAuthError(null), false);
  assert.equal(isAuthError(undefined), false);
  assert.equal(isAuthError({}), false);
});
