import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  isPlausibleEpochMs,
  parseHttpDate,
  parseCloudflareTraceTs,
  evaluateExpiry,
} from "./trustedTimePolicy.js";

// A concrete, in-range instant used across the table below.
const EXPIRY = Date.UTC(2026, 6, 22); // 2026-07-22T00:00:00Z
const DAY = 24 * 60 * 60 * 1000;
const SKEW = 5 * 60 * 1000;

describe("isPlausibleEpochMs", () => {
  test("accepts an in-range epoch", () => {
    assert.equal(isPlausibleEpochMs(Date.UTC(2026, 0, 1)), true);
  });
  test("rejects non-finite / null / NaN", () => {
    assert.equal(isPlausibleEpochMs(null), false);
    assert.equal(isPlausibleEpochMs(NaN), false);
    assert.equal(isPlausibleEpochMs(Infinity), false);
  });
  test("rejects out-of-range (epoch 0, pre-2020, post-2100)", () => {
    assert.equal(isPlausibleEpochMs(0), false);
    assert.equal(isPlausibleEpochMs(Date.UTC(2019, 11, 31)), false);
    assert.equal(isPlausibleEpochMs(Date.UTC(2101, 0, 1)), false);
  });
  test("boundaries are exclusive", () => {
    assert.equal(isPlausibleEpochMs(Date.UTC(2020, 0, 1)), false);
    assert.equal(isPlausibleEpochMs(Date.UTC(2100, 0, 1)), false);
  });
});

describe("parseHttpDate", () => {
  test("parses an RFC 9110 IMF-fixdate (always GMT)", () => {
    const ms = parseHttpDate("Wed, 22 Jul 2026 00:00:00 GMT");
    assert.equal(ms, Date.UTC(2026, 6, 22, 0, 0, 0));
  });
  test("returns null for null / empty / garbage", () => {
    assert.equal(parseHttpDate(null), null);
    assert.equal(parseHttpDate(""), null);
    assert.equal(parseHttpDate("not a date"), null);
  });
  test("returns null for an implausible-but-parseable date", () => {
    assert.equal(parseHttpDate("Thu, 01 Jan 1970 00:00:00 GMT"), null);
  });
});

describe("parseCloudflareTraceTs", () => {
  test("extracts fractional unix seconds and converts to ms", () => {
    const body = "fl=1f2\nh=cloudflare.com\nip=1.2.3.4\nts=1753142400.5\nvisit_scheme=https\n";
    assert.equal(parseCloudflareTraceTs(body), 1753142400500);
  });
  test("handles integer ts", () => {
    assert.equal(parseCloudflareTraceTs("ts=1753142400\n"), 1753142400000);
  });
  test("returns null when no ts= present", () => {
    assert.equal(parseCloudflareTraceTs("fl=1f2\nh=cloudflare.com\n"), null);
    assert.equal(parseCloudflareTraceTs(""), null);
    assert.equal(parseCloudflareTraceTs(null), null);
  });
  test("returns null for an implausible ts", () => {
    assert.equal(parseCloudflareTraceTs("ts=1\n"), null);
  });
});

describe("evaluateExpiry — trusted (online) readings", () => {
  test("trusted, before expiry -> not expired", () => {
    const r = evaluateExpiry({ nowMs: EXPIRY - DAY, networkMs: EXPIRY - DAY, hwmMs: null, expiryMs: EXPIRY, offlinePolicy: "open", skewToleranceMs: SKEW });
    assert.equal(r.expired, false);
    assert.equal(r.trusted, true);
    assert.equal(r.rollbackDetected, false);
  });
  test("trusted, at/after expiry -> expired (network time wins even if device clock lies behind)", () => {
    const r = evaluateExpiry({ nowMs: EXPIRY - 10 * DAY, networkMs: EXPIRY + DAY, hwmMs: null, expiryMs: EXPIRY, offlinePolicy: "open", skewToleranceMs: SKEW });
    assert.equal(r.expired, true);
    assert.equal(r.trusted, true);
  });
});

describe("evaluateExpiry — offline behavior", () => {
  test("offline + benign + floor before expiry -> fail OPEN (not expired)", () => {
    const r = evaluateExpiry({ nowMs: EXPIRY - DAY, networkMs: null, hwmMs: EXPIRY - 2 * DAY, expiryMs: EXPIRY, offlinePolicy: "open", skewToleranceMs: SKEW });
    assert.equal(r.trusted, false);
    assert.equal(r.rollbackDetected, false);
    assert.equal(r.expired, false);
  });
  test("offline + benign but stored floor already crossed expiry -> expired", () => {
    // HWM (a past trusted reading) is already past the deadline; even offline the
    // monotonic floor locks it — you can't wait out the deadline in airplane mode.
    const r = evaluateExpiry({ nowMs: EXPIRY - 10 * DAY, networkMs: null, hwmMs: EXPIRY + DAY, expiryMs: EXPIRY, offlinePolicy: "open", skewToleranceMs: SKEW });
    assert.equal(r.trusted, false);
    assert.equal(r.expired, true);
  });
  test("offline + rollback detected -> fail CLOSED (expired) regardless of policy", () => {
    // Device clock yanked far below the high-water-mark => tamper evidence.
    const r = evaluateExpiry({ nowMs: EXPIRY - 30 * DAY, networkMs: null, hwmMs: EXPIRY - DAY, expiryMs: EXPIRY, offlinePolicy: "open", skewToleranceMs: SKEW });
    assert.equal(r.rollbackDetected, true);
    assert.equal(r.expired, true);
  });
  test("offlinePolicy 'closed' locks when unverifiable even below the floor", () => {
    const r = evaluateExpiry({ nowMs: EXPIRY - DAY, networkMs: null, hwmMs: EXPIRY - 2 * DAY, expiryMs: EXPIRY, offlinePolicy: "closed", skewToleranceMs: SKEW });
    assert.equal(r.trusted, false);
    assert.equal(r.rollbackDetected, false);
    assert.equal(r.expired, true);
  });
  test("small offline clock jitter within skew is NOT a rollback", () => {
    const r = evaluateExpiry({ nowMs: EXPIRY - DAY, networkMs: null, hwmMs: EXPIRY - DAY + SKEW - 1, expiryMs: EXPIRY, offlinePolicy: "open", skewToleranceMs: SKEW });
    assert.equal(r.rollbackDetected, false);
    assert.equal(r.expired, false);
  });
});

describe("evaluateExpiry — never-bootstrapped (offline, no prior trusted reading)", () => {
  test("offline + never bootstrapped fails CLOSED even below the deadline", () => {
    // Fresh install, clock held before the deadline, both time hosts blocked.
    const r = evaluateExpiry({ nowMs: EXPIRY - 10 * DAY, networkMs: null, hwmMs: null, expiryMs: EXPIRY, offlinePolicy: "open", everBootstrapped: false });
    assert.equal(r.trusted, false);
    assert.equal(r.expired, true);
    assert.equal(r.reason, "offline-unbootstrapped");
  });
  test("offline + bootstrapped keeps offline grace below the deadline", () => {
    const r = evaluateExpiry({ nowMs: EXPIRY - DAY, networkMs: null, hwmMs: EXPIRY - 2 * DAY, expiryMs: EXPIRY, offlinePolicy: "open", everBootstrapped: true });
    assert.equal(r.expired, false);
    assert.equal(r.reason, "offline");
  });
  test("a trusted reading is unaffected by everBootstrapped=false", () => {
    const r = evaluateExpiry({ nowMs: EXPIRY - DAY, networkMs: EXPIRY - DAY, hwmMs: null, expiryMs: EXPIRY, offlinePolicy: "open", everBootstrapped: false });
    assert.equal(r.trusted, true);
    assert.equal(r.expired, false);
    assert.equal(r.reason, "ok");
  });
  test("rollback still wins over the unbootstrapped branch", () => {
    const r = evaluateExpiry({ nowMs: EXPIRY - 30 * DAY, networkMs: null, hwmMs: EXPIRY - DAY, expiryMs: EXPIRY, offlinePolicy: "open", everBootstrapped: false, skewToleranceMs: SKEW });
    assert.equal(r.expired, true);
    assert.equal(r.reason, "rollback");
  });
  test("defaults to bootstrapped (backward-compatible) when the flag is omitted", () => {
    const r = evaluateExpiry({ nowMs: EXPIRY - DAY, networkMs: null, hwmMs: EXPIRY - 2 * DAY, expiryMs: EXPIRY, offlinePolicy: "open" });
    assert.equal(r.expired, false);
    assert.equal(r.reason, "offline");
  });
});

describe("evaluateExpiry — high-water-mark discipline", () => {
  test("HWM advances only from a trusted reading", () => {
    const r = evaluateExpiry({ nowMs: EXPIRY - DAY, networkMs: EXPIRY - DAY, hwmMs: EXPIRY - 3 * DAY, expiryMs: EXPIRY, offlinePolicy: "open", skewToleranceMs: SKEW });
    assert.equal(r.newHwmMs, EXPIRY - DAY); // advanced to the trusted reading
  });
  test("an untrusted (offline) pass never advances the HWM", () => {
    const prior = EXPIRY - 3 * DAY;
    const r = evaluateExpiry({ nowMs: EXPIRY - DAY, networkMs: null, hwmMs: prior, expiryMs: EXPIRY, offlinePolicy: "open", skewToleranceMs: SKEW });
    assert.equal(r.newHwmMs, prior); // unchanged
  });
  test("a future DEVICE clock does not poison the HWM (only trusted network time can)", () => {
    const prior = EXPIRY - 3 * DAY;
    const farFuture = Date.UTC(2099, 0, 1);
    const r = evaluateExpiry({ nowMs: farFuture, networkMs: null, hwmMs: prior, expiryMs: EXPIRY, offlinePolicy: "open", skewToleranceMs: SKEW });
    assert.equal(r.newHwmMs, prior); // device clock never touches the stored floor
  });
  test("trusted reading older than the HWM does not lower it", () => {
    const prior = EXPIRY - DAY;
    const r = evaluateExpiry({ nowMs: EXPIRY - 2 * DAY, networkMs: EXPIRY - 2 * DAY, hwmMs: prior, expiryMs: EXPIRY, offlinePolicy: "open", skewToleranceMs: SKEW });
    assert.equal(r.newHwmMs, prior); // max(prior, network) keeps the floor
  });
  test("first-ever trusted reading seeds the HWM from null", () => {
    const r = evaluateExpiry({ nowMs: EXPIRY - DAY, networkMs: EXPIRY - DAY, hwmMs: null, expiryMs: EXPIRY, offlinePolicy: "open", skewToleranceMs: SKEW });
    assert.equal(r.newHwmMs, EXPIRY - DAY);
  });
});
