import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { interpretUserInfo } from "./userInfo.js";

// Pure interpretation of an Xtream user_info envelope into a connect verdict.
// Keeps the auth/status/expiry rules out of the async network method so they
// can be unit-tested without stubbing fetch.
describe("interpretUserInfo", () => {
  test("auth 1 + Active → ok", () => {
    const r = interpretUserInfo({ user_info: { auth: 1, status: "Active" } });
    assert.equal(r.ok, true);
  });

  test('string "1" auth is accepted (panels return strings)', () => {
    assert.equal(interpretUserInfo({ user_info: { auth: "1", status: "Active" } }).ok, true);
  });

  test("auth 0 → wrong credentials", () => {
    const r = interpretUserInfo({ user_info: { auth: 0 } });
    assert.equal(r.ok, false);
    assert.match(r.message, /username|password|credential/i);
  });

  test("authed but Expired → not ok, surfaces the status", () => {
    const r = interpretUserInfo({ user_info: { auth: 1, status: "Expired" } });
    assert.equal(r.ok, false);
    assert.match(r.message, /expired/i);
  });

  test("authed but Banned → not ok", () => {
    assert.equal(interpretUserInfo({ user_info: { auth: 1, status: "Banned" } }).ok, false);
  });

  test("missing user_info → not ok (defensive)", () => {
    assert.equal(interpretUserInfo({}).ok, false);
    assert.equal(interpretUserInfo(null).ok, false);
  });

  test("authed with no status field → ok (some panels omit status)", () => {
    assert.equal(interpretUserInfo({ user_info: { auth: 1 } }).ok, true);
  });
});
