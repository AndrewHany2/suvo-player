import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  INVALID_CREDENTIALS,
  normalizeIdentifier,
  mapSignInError,
} from "./loginLogic.js";

describe("normalizeIdentifier", () => {
  test("lowercases and trims", () => {
    assert.deepEqual(normalizeIdentifier("  BoB  "), {
      value: "bob",
      isEmail: false,
    });
  });

  test("flags an email by the @ sign", () => {
    assert.deepEqual(normalizeIdentifier("Me@Example.COM"), {
      value: "me@example.com",
      isEmail: true,
    });
  });

  test("treats a bare handle as a username", () => {
    assert.equal(normalizeIdentifier("alice").isEmail, false);
  });

  test("tolerates null/undefined without throwing", () => {
    assert.deepEqual(normalizeIdentifier(undefined), {
      value: "",
      isEmail: false,
    });
    assert.deepEqual(normalizeIdentifier(null), { value: "", isEmail: false });
  });
});

describe("mapSignInError", () => {
  test("returns null when there is no error", () => {
    assert.equal(mapSignInError(null), null);
  });

  test("surfaces the email-not-confirmed case distinctly", () => {
    const msg = mapSignInError({ code: "email_not_confirmed" });
    assert.match(msg, /not confirmed/i);
  });

  test("collapses invalid credentials to the generic message", () => {
    assert.equal(
      mapSignInError({ code: "invalid_credentials" }),
      INVALID_CREDENTIALS,
    );
  });

  test("collapses ANY other error to the generic message (anti-enumeration)", () => {
    assert.equal(mapSignInError({ code: "something_else" }), INVALID_CREDENTIALS);
    assert.equal(mapSignInError({ message: "boom" }), INVALID_CREDENTIALS);
  });
});
