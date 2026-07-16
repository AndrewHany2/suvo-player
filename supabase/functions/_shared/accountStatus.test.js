import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  accountStatus,
  isActive,
  ACCOUNT_ACTIVE,
  ACCOUNT_SUSPENDED,
  ACCOUNT_EXPIRED,
  PROVIDER_SUSPENDED,
} from "./accountStatus.js";

const NOW = Date.parse("2026-07-16T12:00:00Z");
const FUTURE = "2026-08-16T12:00:00Z";
const PAST = "2026-06-16T12:00:00Z";

describe("accountStatus", () => {
  test("no customer_accounts row => ACTIVE (unmanaged account, not gated)", () => {
    assert.equal(accountStatus(null, false, NOW), ACCOUNT_ACTIVE);
  });

  test("row with no expiry, not suspended, provider active => ACTIVE", () => {
    assert.equal(
      accountStatus({ suspended: false, expires_at: null }, false, NOW),
      ACCOUNT_ACTIVE,
    );
  });

  test("future expiry => ACTIVE", () => {
    assert.equal(
      accountStatus({ suspended: false, expires_at: FUTURE }, false, NOW),
      ACCOUNT_ACTIVE,
    );
  });

  test("account suspended => ACCOUNT_SUSPENDED (outranks expiry)", () => {
    assert.equal(
      accountStatus({ suspended: true, expires_at: PAST }, false, NOW),
      ACCOUNT_SUSPENDED,
    );
  });

  test("provider suspended => PROVIDER_SUSPENDED", () => {
    assert.equal(
      accountStatus({ suspended: false, expires_at: FUTURE }, true, NOW),
      PROVIDER_SUSPENDED,
    );
  });

  test("past expiry => ACCOUNT_EXPIRED", () => {
    assert.equal(
      accountStatus({ suspended: false, expires_at: PAST }, false, NOW),
      ACCOUNT_EXPIRED,
    );
  });

  test("malformed expires_at is ignored => ACTIVE", () => {
    assert.equal(
      accountStatus({ suspended: false, expires_at: "not-a-date" }, false, NOW),
      ACCOUNT_ACTIVE,
    );
  });

  test("isActive true only for ACTIVE", () => {
    assert.equal(isActive(ACCOUNT_ACTIVE), true);
    assert.equal(isActive(ACCOUNT_EXPIRED), false);
    assert.equal(isActive(ACCOUNT_SUSPENDED), false);
    assert.equal(isActive(PROVIDER_SUSPENDED), false);
  });
});
