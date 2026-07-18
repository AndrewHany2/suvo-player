import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The migration this test guards. Read it relative to this test file so the
// test is CWD-independent (npm test runs from the repo root).
const MIGRATION_URL = new URL(
  "./20260718000003_adopt_self_signup_account_fn.sql",
  import.meta.url,
);

// Executable SQL only: strip block + line comments, lowercase, collapse
// whitespace, so assertions match the real statements, not the header comment.
function executableSql() {
  const raw = readFileSync(fileURLToPath(MIGRATION_URL), "utf8");
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Return the single SQL statement that begins with `start`, up to its
// terminating semicolon. Anchors assertions to ONE statement so a predicate
// removed from the reconcile can't be "satisfied" by identical text elsewhere.
function statement(sql, start) {
  const from = sql.indexOf(start);
  if (from === -1) return "";
  const end = sql.indexOf(";", from);
  return end === -1 ? sql.slice(from) : sql.slice(from, end + 1);
}

describe("adopt_self_signup_account function migration", () => {
  test("wraps the work in a single transaction", () => {
    const sql = executableSql();
    assert.match(sql, /\bbegin;/, "must open a transaction");
    assert.match(sql, /\bcommit;/, "must commit the transaction");
  });

  test("defines a security-definer function with a pinned search_path", () => {
    const sql = executableSql();
    assert.match(
      sql,
      /create or replace function public\.adopt_self_signup_account\(p_user_id uuid\)/,
      "must (re)create the adopt function",
    );
    assert.ok(sql.includes("security definer"), "must be security definer");
    assert.ok(sql.includes("set search_path = public"), "must pin search_path");
  });

  test("revokes execute from unprivileged roles", () => {
    const sql = executableSql();
    assert.match(
      sql,
      /revoke execute on function public\.adopt_self_signup_account\(uuid\) from [^;]*public[^;]*;/,
      "must revoke execute (only the service role calls it)",
    );
  });

  test("inserts a self-origin, unattributed, no-expiry row with the marker note", () => {
    const insert = statement(executableSql(), "insert into public.customer_accounts");
    assert.ok(insert, "must insert into customer_accounts");
    assert.ok(insert.includes("'self'"), "origin must be 'self'");
    assert.ok(insert.includes("'self: added via app'"), "must stamp the marker note");
  });

  test("scope: requires a line, skips providers and already-managed", () => {
    const insert = statement(executableSql(), "insert into public.customer_accounts");
    assert.match(insert, /exists \([^)]*public\.iptv_accounts/, "must require an iptv line");
    assert.match(insert, /not exists \([^)]*public\.providers/, "must exclude providers");
    assert.match(
      insert,
      /not exists \([^)]*public\.customer_accounts/,
      "must skip already-managed accounts",
    );
    assert.ok(insert.includes("on conflict (user_id) do nothing"), "insert must be idempotent");
  });

  test("names the account from its auth email, filling a blank name only (never a provider)", () => {
    const insert = statement(executableSql(), "insert into public.profiles");
    assert.ok(insert, "must upsert a profiles row so the account is identifiable");
    assert.ok(insert.includes("auth.users"), "must source the name from auth.users");
    assert.ok(insert.includes("u.email"), "must use the auth email as the name");
    assert.ok(
      insert.includes("on conflict (user_id) do update"),
      "must be an idempotent upsert keyed on user_id",
    );
    assert.ok(
      insert.includes("coalesce(nullif(p.username"),
      "must only fill a blank name, never overwrite an admin-set/provider name",
    );
    assert.match(insert, /not exists \([^)]*public\.providers/, "must not name providers");
  });

  test("reconcile forces active/no-expiry, scoped to the adopted self row, never resurrecting a revoked account", () => {
    const update = statement(executableSql(), "update public.entitlements");
    assert.ok(update, "must reconcile entitlements");
    // Forces the target state.
    assert.ok(update.includes("status = 'active'"), "must set status active");
    assert.ok(update.includes("expires_at = null"), "must clear expiry");
    // Scoped to the just-adopted self row only.
    assert.ok(update.includes("ca.origin = 'self'"), "adopted set: origin='self'");
    assert.ok(update.includes("ca.provider_id is null"), "adopted set: unattributed");
    assert.ok(update.includes("ca.note = 'self: added via app'"), "adopted set: marker note");
    // Kill-switch preserved.
    assert.ok(update.includes("e.revoked_at is null"), "must never resurrect a revoked account");
  });
});
