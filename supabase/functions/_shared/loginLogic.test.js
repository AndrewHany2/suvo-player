import test from "node:test";
import assert from "node:assert/strict";
import { INVALID_CREDENTIALS, normalizeEmail, mapSignInError } from "./loginLogic.js";

test("INVALID_CREDENTIALS is the generic email/password message", () => {
  assert.equal(INVALID_CREDENTIALS, "Invalid email or password.");
});

test("normalizeEmail trims and lowercases; tolerates nullish", () => {
  assert.equal(normalizeEmail("  John@Example.COM "), "john@example.com");
  assert.equal(normalizeEmail(undefined), "");
  assert.equal(normalizeEmail(null), "");
});

test("mapSignInError: null passthrough, email_not_confirmed surfaced, else generic", () => {
  assert.equal(mapSignInError(null), null);
  assert.match(mapSignInError({ code: "email_not_confirmed" }), /not confirmed/i);
  assert.equal(mapSignInError({ code: "invalid_grant" }), INVALID_CREDENTIALS);
});
