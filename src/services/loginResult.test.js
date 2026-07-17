const test = require("node:test");
const assert = require("node:assert");
const { mapLoginResult } = require("./loginResult.logic.js");

test("returns tokens on a successful login", () => {
  assert.deepStrictEqual(
    mapLoginResult({
      data: { ok: true, access_token: "a", refresh_token: "r" },
      error: null,
    }),
    { access_token: "a", refresh_token: "r" },
  );
});

test("throws the server-supplied message on an expected failure", () => {
  assert.throws(
    () =>
      mapLoginResult({
        data: { ok: false, error: "Invalid email or password." },
        error: null,
      }),
    /invalid email or password/i,
  );
});

test("surfaces the email-not-confirmed message verbatim", () => {
  assert.throws(
    () =>
      mapLoginResult({
        data: { ok: false, error: "Your email is not confirmed." },
        error: null,
      }),
    /not confirmed/i,
  );
});

test("throws a generic message on a transport error (no internals leaked)", () => {
  assert.throws(
    () =>
      mapLoginResult({
        data: null,
        error: { message: "Edge Function returned a non-2xx status code" },
      }),
    /could not sign in right now/i,
  );
});

test("rejects a malformed ok:true body that is missing tokens", () => {
  assert.throws(
    () => mapLoginResult({ data: { ok: true, access_token: "a" }, error: null }),
    /invalid email or password/i,
  );
});

test("rejects a body with neither ok nor error", () => {
  assert.throws(
    () => mapLoginResult({ data: {}, error: null }),
    /invalid email or password/i,
  );
});
