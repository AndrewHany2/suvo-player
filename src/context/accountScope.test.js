import { test } from "node:test";
import assert from "node:assert/strict";
import { accountKeyOf, accountLabelOf } from "./accountScope.js";

test("accountKeyOf prefers the account id", () => {
  assert.equal(accountKeyOf({ id: "abc", host: "h", username: "u" }), "abc");
});

test("accountKeyOf falls back to host_username when id is missing", () => {
  assert.equal(accountKeyOf({ host: "h", username: "u" }), "h_u");
  assert.equal(accountKeyOf({ username: "u" }), "_u");
});

test("accountKeyOf returns null for an unkeyable/absent account", () => {
  assert.equal(accountKeyOf(null), null);
  assert.equal(accountKeyOf({}), null);
  assert.equal(accountKeyOf({ id: "" }), null);
});

test("accountLabelOf prefers nickname then username", () => {
  assert.equal(accountLabelOf({ nickname: "Home", username: "u" }), "Home");
  assert.equal(accountLabelOf({ username: "u" }), "u");
  assert.equal(accountLabelOf(null), "this account");
});
