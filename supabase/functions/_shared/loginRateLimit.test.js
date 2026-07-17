import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clientIpFromHeaders,
  loginRateLimitKeys,
  IP_MAX,
  EMAIL_MAX,
  WINDOW_SECONDS,
} from "./loginRateLimit.js";

const hdr = (obj) => new Headers(obj);

test("clientIpFromHeaders: single x-forwarded-for value", () => {
  assert.equal(clientIpFromHeaders(hdr({ "x-forwarded-for": "1.2.3.4" })), "1.2.3.4");
});

test("clientIpFromHeaders: takes leftmost of a proxy chain", () => {
  assert.equal(
    clientIpFromHeaders(hdr({ "x-forwarded-for": " 9.9.9.9 , 10.0.0.1, 10.0.0.2" })),
    "9.9.9.9",
  );
});

test("clientIpFromHeaders: falls back to x-real-ip", () => {
  assert.equal(clientIpFromHeaders(hdr({ "x-real-ip": "5.6.7.8" })), "5.6.7.8");
});

test("clientIpFromHeaders: 'unknown' when no IP header present", () => {
  assert.equal(clientIpFromHeaders(hdr({})), "unknown");
});

test("clientIpFromHeaders: tolerates a null/absent headers object", () => {
  assert.equal(clientIpFromHeaders(null), "unknown");
  assert.equal(clientIpFromHeaders(undefined), "unknown");
});

test("loginRateLimitKeys: namespaces IP and email, applies limits", () => {
  const keys = loginRateLimitKeys("1.2.3.4", "USER@Example.com");
  assert.deepEqual(keys, [
    { key: "ip:1.2.3.4", max: IP_MAX, windowSeconds: WINDOW_SECONDS },
    { key: "email:user@example.com", max: EMAIL_MAX, windowSeconds: WINDOW_SECONDS },
  ]);
});

test("loginRateLimitKeys: normalizes missing ip/email to stable keys", () => {
  const keys = loginRateLimitKeys("", "");
  assert.equal(keys[0].key, "ip:unknown");
  assert.equal(keys[1].key, "email:");
});

test("loginRateLimitKeys: email limit is tighter than IP limit", () => {
  assert.ok(EMAIL_MAX < IP_MAX, "per-email throttle should be stricter than per-IP");
});
