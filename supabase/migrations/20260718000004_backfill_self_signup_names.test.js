import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The migration this test guards. Read it relative to this test file so the
// test is CWD-independent (npm test runs from the repo root).
const MIGRATION_URL = new URL(
  "./20260718000004_backfill_self_signup_names.sql",
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
// terminating semicolon, so assertions anchor to ONE statement.
function statement(sql, start) {
  const from = sql.indexOf(start);
  if (from === -1) return "";
  const end = sql.indexOf(";", from);
  return end === -1 ? sql.slice(from) : sql.slice(from, end + 1);
}

describe("backfill self-signup names migration", () => {
  test("wraps the work in a single transaction", () => {
    const sql = executableSql();
    assert.match(sql, /\bbegin;/, "must open a transaction");
    assert.match(sql, /\bcommit;/, "must commit the transaction");
  });

  test("names adopted self accounts from their auth email", () => {
    const insert = statement(executableSql(), "insert into public.profiles");
    assert.ok(insert, "must upsert profiles rows");
    assert.ok(insert.includes("public.customer_accounts"), "must target adopted customer_accounts");
    assert.ok(insert.includes("auth.users"), "must join auth.users for the email");
    assert.ok(insert.includes("u.email"), "must use the auth email as the name");
  });

  test("scope: only self-origin, unattributed, non-provider accounts", () => {
    const insert = statement(executableSql(), "insert into public.profiles");
    assert.ok(insert.includes("ca.origin = 'self'"), "adopted set: origin='self'");
    assert.ok(insert.includes("ca.provider_id is null"), "adopted set: unattributed");
    assert.match(insert, /not exists \([^)]*public\.providers/, "must exclude providers");
  });

  test("idempotent upsert that fills a blank name only, never overwriting", () => {
    const insert = statement(executableSql(), "insert into public.profiles");
    assert.ok(
      insert.includes("on conflict (user_id) do update"),
      "must be an idempotent upsert keyed on user_id",
    );
    assert.ok(
      insert.includes("coalesce(nullif(p.username"),
      "must only fill a blank name, never overwrite an admin-set name",
    );
  });
});
