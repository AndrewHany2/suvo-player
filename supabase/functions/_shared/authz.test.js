import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { userKeyIsAuthorized } from "./authz.js";

// userKey (client-supplied library key) is authorized only when it is the
// caller's own auth id, or an app_profile the caller owns. This is the decision
// that closes the data-function IDOR on watch_history / favorites.
describe("userKeyIsAuthorized", () => {
  test("allows the caller's own auth id (owner irrelevant)", () => {
    assert.equal(userKeyIsAuthorized("user-1", "user-1", null), true);
  });

  test("allows an app_profile the caller owns", () => {
    assert.equal(userKeyIsAuthorized("profile-9", "user-1", "user-1"), true);
  });

  test("denies an app_profile owned by another user (the IDOR attack)", () => {
    assert.equal(userKeyIsAuthorized("profile-9", "user-1", "user-2"), false);
  });

  test("denies an unknown / non-existent app_profile", () => {
    assert.equal(userKeyIsAuthorized("profile-x", "user-1", null), false);
  });

  test("denies an empty userKey", () => {
    assert.equal(userKeyIsAuthorized("", "user-1", null), false);
  });

  test("denies when there is no authenticated user id", () => {
    assert.equal(userKeyIsAuthorized("user-1", "", null), false);
  });
});
