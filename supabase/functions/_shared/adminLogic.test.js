import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  canInvoke,
  canActOnAccount,
  withinQuota,
  validateLine,
  validateNewAccount,
  providerSlug,
  resolveEmail,
  ROLE_SUPER_ADMIN,
  ROLE_PROVIDER,
} from "./adminLogic.js";

const superAdmin = { userId: "sa", role: ROLE_SUPER_ADMIN, suspended: false };
const provider = { userId: "p1", role: ROLE_PROVIDER, suspended: false };

describe("canInvoke", () => {
  test("null caller denied", () => {
    assert.equal(canInvoke(null, "accounts.list"), false);
  });
  test("suspended provider denied everything", () => {
    assert.equal(canInvoke({ ...provider, suspended: true }, "accounts.list"), false);
  });
  test("provider denied super-admin-only action", () => {
    assert.equal(canInvoke(provider, "providers.create"), false);
  });
  test("provider allowed provider action", () => {
    assert.equal(canInvoke(provider, "accounts.create"), true);
  });
  test("super-admin allowed anything", () => {
    assert.equal(canInvoke(superAdmin, "providers.create"), true);
    assert.equal(canInvoke(superAdmin, "accounts.create"), true);
  });
});

describe("canActOnAccount", () => {
  test("provider may act on own account", () => {
    assert.equal(canActOnAccount(provider, "p1"), true);
  });
  test("provider may NOT act on another provider's account (isolation)", () => {
    assert.equal(canActOnAccount(provider, "p2"), false);
  });
  test("super-admin may act on any account", () => {
    assert.equal(canActOnAccount(superAdmin, "p2"), true);
  });
  test("suspended provider denied", () => {
    assert.equal(canActOnAccount({ ...provider, suspended: true }, "p1"), false);
  });
});

describe("withinQuota", () => {
  test("provider under quota", () => {
    assert.equal(withinQuota(4, 5, ROLE_PROVIDER), true);
  });
  test("provider at quota denied", () => {
    assert.equal(withinQuota(5, 5, ROLE_PROVIDER), false);
  });
  test("super-admin exempt", () => {
    assert.equal(withinQuota(999, 1, ROLE_SUPER_ADMIN), true);
  });
});

describe("validateLine", () => {
  test("valid xtream", () => {
    const r = validateLine({ type: "xtream", host: "http://h", username: "u", password: "p" });
    assert.equal(r.ok, true);
    assert.equal(r.value.type, "xtream");
    assert.equal(r.value.url, null);
  });
  test("xtream missing password invalid", () => {
    assert.equal(validateLine({ type: "xtream", host: "http://h", username: "u" }).ok, false);
  });
  test("valid m3u", () => {
    const r = validateLine({ type: "m3u", url: "http://list.m3u" });
    assert.equal(r.ok, true);
    assert.equal(r.value.type, "m3u");
    assert.equal(r.value.host, null);
  });
  test("m3u non-url invalid", () => {
    assert.equal(validateLine({ type: "m3u", url: "not-a-url" }).ok, false);
  });
});

describe("validateNewAccount", () => {
  const good = {
    name: "Customer 01",
    password: "secret1",
    deviceLimit: 2,
    expiresAt: "2026-12-31T00:00:00Z",
    line: { type: "xtream", host: "http://h", username: "u", password: "p" },
  };
  test("accepts + trims a good input (name preserved, not lowercased)", () => {
    const r = validateNewAccount(good);
    assert.equal(r.ok, true);
    assert.equal(r.value.name, "Customer 01");
    assert.equal(r.value.deviceLimit, 2);
    assert.equal(typeof r.value.expiresAt, "string");
  });
  test("rejects short password", () => {
    const r = validateNewAccount({ ...good, password: "123" });
    assert.equal(r.ok, false);
    assert.ok(r.errors.includes("password"));
  });
  test("accepts password of exactly the minimum length (6)", () => {
    const r = validateNewAccount({ ...good, password: "123456" });
    assert.equal(r.ok, true);
    assert.ok(!r.errors.includes("password"));
  });
  test("rejects password one below the minimum length (5)", () => {
    const r = validateNewAccount({ ...good, password: "12345" });
    assert.equal(r.ok, false);
    assert.ok(r.errors.includes("password"));
  });
  test("rejects deviceLimit < 1", () => {
    const r = validateNewAccount({ ...good, deviceLimit: 0 });
    assert.ok(r.errors.includes("deviceLimit"));
  });
  test("rejects invalid line", () => {
    const r = validateNewAccount({ ...good, line: { type: "m3u", url: "x" } });
    assert.ok(r.errors.includes("lines"));
  });
  test("null/empty expiresAt allowed (=> null)", () => {
    const r = validateNewAccount({ ...good, expiresAt: "" });
    assert.equal(r.ok, true);
    assert.equal(r.value.expiresAt, null);
  });
  test("accepts a freeform 1-60 char name", () => {
    const r = validateNewAccount({
      name: "  John — living room  ",
      password: "secret6",
      deviceLimit: 2,
      line: { type: "m3u", url: "http://x/y.m3u" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.value.name, "John — living room");
  });
  test("rejects empty / >60 char name", () => {
    assert.deepEqual(
      validateNewAccount({ name: "   ", password: "secret6", deviceLimit: 1, line: { type: "m3u", url: "http://x" } }).errors.includes("name"),
      true,
    );
    assert.deepEqual(
      validateNewAccount({ name: "x".repeat(61), password: "secret6", deviceLimit: 1, line: { type: "m3u", url: "http://x" } }).errors.includes("name"),
      true,
    );
  });
});

describe("validateNewAccount — lines array + allowSelfLines", () => {
  const base = { name: "Acme", password: "secret6", deviceLimit: 2 };
  const xtream = { type: "xtream", host: "h:8080", username: "u", password: "p" };
  const m3u = { type: "m3u", url: "http://x/get.php" };

  test("accepts a lines[] array and returns all normalized lines", () => {
    const r = validateNewAccount({ ...base, lines: [xtream, m3u] });
    assert.equal(r.ok, true);
    assert.equal(r.value.lines.length, 2);
    assert.equal(r.value.lines[0].type, "xtream");
    assert.equal(r.value.lines[1].type, "m3u");
  });

  test("normalizes a legacy single `line` into a one-element array", () => {
    const r = validateNewAccount({ ...base, line: xtream });
    assert.equal(r.ok, true);
    assert.equal(r.value.lines.length, 1);
    assert.equal(r.value.lines[0].host, "h:8080");
  });

  test("requires at least one line when self-add is off", () => {
    const r = validateNewAccount({ ...base, lines: [] });
    assert.equal(r.ok, false);
    assert.ok(r.errors.includes("lines"));
  });

  test("allows zero lines when allowSelfLines is true", () => {
    const r = validateNewAccount({ ...base, lines: [], allowSelfLines: true });
    assert.equal(r.ok, true);
    assert.ok(!r.errors.includes("lines"));
    assert.deepEqual(r.value.lines, []);
    assert.equal(r.value.allowSelfLines, true);
  });

  test("still keeps provided lines when allowSelfLines is true", () => {
    const r = validateNewAccount({ ...base, lines: [xtream], allowSelfLines: true });
    assert.equal(r.ok, true);
    assert.equal(r.value.lines.length, 1);
    assert.equal(r.value.lines[0].host, "h:8080");
  });

  test("rejects when any line is invalid", () => {
    const r = validateNewAccount({ ...base, lines: [xtream, { type: "xtream", host: "", username: "", password: "" }] });
    assert.equal(r.ok, false);
    assert.ok(r.errors.includes("lines"));
  });

  test("still rejects an invalid line even when allowSelfLines is true", () => {
    const r = validateNewAccount({ ...base, lines: [{ type: "xtream", host: "", username: "", password: "" }], allowSelfLines: true });
    assert.equal(r.ok, false);
    assert.ok(r.errors.includes("lines"));
  });

  test("allowSelfLines defaults false and coerces to a strict boolean", () => {
    assert.equal(validateNewAccount({ ...base, lines: [xtream] }).value.allowSelfLines, false);
    assert.equal(validateNewAccount({ ...base, lines: [xtream], allowSelfLines: true }).value.allowSelfLines, true);
    assert.equal(validateNewAccount({ ...base, lines: [xtream], allowSelfLines: "yes" }).value.allowSelfLines, false);
  });
});

describe("providerSlug", () => {
  test("slug from name", () => {
    assert.equal(providerSlug("Acme TV!", "abc1234567"), "acme-tv");
  });
  test("slug falls back to id when name empty", () => {
    assert.equal(providerSlug("", "abcd1234ef"), "abcd1234");
  });
});

describe("resolveEmail", () => {
  test("uses a supplied email (lowercased) when it has @", () => {
    assert.equal(resolveEmail("acme", "Me@Example.com", "deadbeef"), "me@example.com");
  });
  test("auto-generates acc-<token>@<slug>.accounts.local otherwise", () => {
    assert.equal(resolveEmail("acme", "", "deadbeef"), "acc-deadbeef@acme.accounts.local");
    assert.equal(resolveEmail("acme", undefined, "deadbeef"), "acc-deadbeef@acme.accounts.local");
  });
});
