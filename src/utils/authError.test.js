import { test } from "node:test";
import assert from "node:assert/strict";
import { isAuthError, authErrorMessage, describeError } from "./authError.js";

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

test("isAuthError is true for a structured provider status (error-envelope body)", () => {
  // Providers that answer an expired account with a 200 + {error, status:401}
  // body surface a thrown error carrying `.status` rather than the HTTP string.
  assert.equal(isAuthError(Object.assign(new Error("Provider error: USER_EXPIRED"), { status: 401 })), true);
  assert.equal(isAuthError(Object.assign(new Error("blocked"), { status: 403 })), true);
  assert.equal(isAuthError(Object.assign(new Error("server"), { status: 500 })), false);
});

test("authErrorMessage prefers the provider's own message", () => {
  const err = Object.assign(new Error("Provider error: USER_EXPIRED"), { status: 401, userMessage: "Your subscription has expired" });
  assert.equal(authErrorMessage(err), "Your subscription has expired");
});

test("authErrorMessage falls back to a generic account message for a bare 401/403", () => {
  assert.match(authErrorMessage(new Error("HTTP error! status: 401")), /expired or been disabled/);
  assert.match(authErrorMessage(new Error("HTTP error! status: 403")), /expired or been disabled/);
});

test("authErrorMessage returns null for non-auth failures (keep generic copy)", () => {
  assert.equal(authErrorMessage(new Error("HTTP error! status: 500")), null);
  assert.equal(authErrorMessage(new Error("Request timed out after 15000ms")), null);
  assert.equal(authErrorMessage(null), null);
});

test("describeError shows the connectivity message (+ status) for reachability faults", () => {
  assert.match(describeError(new TypeError("Failed to fetch")), /can't reach the server/i);
  assert.match(describeError({ context: { status: 521 } }), /can't reach the server/i);
  assert.match(describeError({ context: { status: 521 } }), /\(HTTP 521\)/);
  assert.match(describeError(new Error("Request timed out after 15000ms")), /can't reach the server/i);
});

test("describeError prefers the provider's own message + status", () => {
  const err = Object.assign(new Error("Provider error: USER_EXPIRED"), { status: 401, userMessage: "Your subscription has expired" });
  assert.match(describeError(err), /Your subscription has expired/);
  assert.match(describeError(err), /status 401/);
});

test("describeError gives account copy for a bare 401/403", () => {
  assert.match(describeError(new Error("HTTP error! status: 401")), /expired or been disabled/);
});

test("describeError surfaces a real HTTP status for other provider errors", () => {
  assert.match(describeError(new Error("HTTP error! status: 404")), /provider returned an error \(HTTP 404\)/i);
});

test("describeError is always a non-empty string, even for nullish input", () => {
  assert.equal(typeof describeError(null), "string");
  assert.ok(describeError(null).length > 0);
});
