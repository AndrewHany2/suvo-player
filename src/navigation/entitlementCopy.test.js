import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { interpretEntitlement } from "./entitlementCopy.js";

describe("interpretEntitlement", () => {
  test("each known server reason has a distinct, non-empty title + message", () => {
    const reasons = ["expired", "revoked", "suspended", "no-entitlement"];
    const titles = new Set();
    for (const reason of reasons) {
      const { title, message } = interpretEntitlement(reason);
      assert.ok(title && title.length > 0, `${reason} has a title`);
      assert.ok(message && message.length > 0, `${reason} has a message`);
      titles.add(title);
    }
    // Distinct titles so the user can tell expired from revoked from suspended.
    assert.equal(titles.size, reasons.length);
  });

  test("expired copy names the expiry", () => {
    assert.match(interpretEntitlement("expired").title, /expired/i);
  });

  test("unknown/empty/ok reasons fall back to a generic inactive message", () => {
    const fallback = interpretEntitlement("expired") === interpretEntitlement("expired");
    assert.ok(fallback); // sanity
    for (const reason of [undefined, null, "", "ok", "something-new"]) {
      const { title, message } = interpretEntitlement(reason);
      assert.ok(title.length > 0 && message.length > 0);
      assert.match(title, /inactive/i);
    }
  });
});
