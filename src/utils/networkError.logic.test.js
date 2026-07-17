const test = require("node:test");
const assert = require("node:assert");
const {
  CONNECTIVITY_MESSAGE,
  errorStatus,
  isConnectivityError,
} = require("./networkError.logic.js");

test("CONNECTIVITY_MESSAGE is a non-empty string", () => {
  assert.equal(typeof CONNECTIVITY_MESSAGE, "string");
  assert.ok(CONNECTIVITY_MESSAGE.length > 0);
});

test("errorStatus reads .status, .context.status, and 'status: N' text", () => {
  assert.equal(errorStatus(Object.assign(new Error("x"), { status: 401 })), 401);
  assert.equal(errorStatus({ context: { status: 521 } }), 521);
  assert.equal(errorStatus(new Error("HTTP error! status: 503")), 503);
  assert.equal(errorStatus(new Error("no status here")), null);
  assert.equal(errorStatus(null), null);
});

test("isConnectivityError is true for supabase transport error names", () => {
  assert.equal(isConnectivityError({ name: "FunctionsFetchError", message: "" }), true);
  assert.equal(isConnectivityError({ name: "FunctionsRelayError", message: "" }), true);
});

test("isConnectivityError is true for gateway statuses (incl. 521)", () => {
  assert.equal(isConnectivityError({ context: { status: 521 } }), true);
  assert.equal(isConnectivityError(new Error("HTTP error! status: 523")), true);
  assert.equal(isConnectivityError(new Error("HTTP error! status: 503")), true);
  assert.equal(isConnectivityError(new Error("HTTP error! status: 502")), true);
});

test("isConnectivityError is true for raw fetch/network and timeout errors", () => {
  assert.equal(isConnectivityError(new TypeError("Failed to fetch")), true);
  assert.equal(isConnectivityError(new Error("Network request failed")), true);
  assert.equal(isConnectivityError({ name: "AbortError", message: "" }), true);
  assert.equal(isConnectivityError(new Error("Request timed out after 15000ms")), true);
  assert.equal(isConnectivityError(new Error("connect ECONNRESET 1.2.3.4:443")), true);
});

test("isConnectivityError is false for auth, normal 4xx, provider envelope, and nullish", () => {
  assert.equal(isConnectivityError(new Error("HTTP error! status: 401")), false);
  assert.equal(isConnectivityError(new Error("HTTP error! status: 404")), false);
  assert.equal(isConnectivityError(Object.assign(new Error("expired"), { providerError: true, status: 512 })), false);
  assert.equal(isConnectivityError(null), false);
  assert.equal(isConnectivityError({}), false);
});
