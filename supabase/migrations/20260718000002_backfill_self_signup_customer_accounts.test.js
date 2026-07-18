import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The migration this test guards. Read it relative to this test file so the
// test is CWD-independent (npm test runs from the repo root).
const MIGRATION_URL = new URL(
  "./20260718000002_backfill_self_signup_customer_accounts.sql",
  import.meta.url,
);

// Executable SQL only: strip block + line comments, lowercase, collapse
// whitespace. This guarantees the assertions below match the real statements,
// not the preview/rollback text that lives in the leading /* ... */ comment.
function executableSql() {
  const raw = readFileSync(fileURLToPath(MIGRATION_URL), "utf8");
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments (preview/rollback)
    .replace(/--[^\n]*/g, " ") // line comments
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

describe("backfill self-signup customer_accounts migration", () => {
  test("wraps the work in a single transaction", () => {
    const sql = executableSql();
    assert.match(sql, /\bbegin;/, "must open a transaction");
    assert.match(sql, /\bcommit;/, "must commit the transaction");
  });

  test("inserts self-origin, unattributed rows with the marker note", () => {
    const sql = executableSql();
    assert.match(sql, /insert into public\.customer_accounts/);
    assert.ok(sql.includes("'self'"), "origin must be 'self'");
    assert.ok(
      sql.includes("backfill: self-signup adopted"),
      "must stamp the traceable note marker",
    );
  });

  test("scope: requires an iptv line, skips providers and already-managed", () => {
    const sql = executableSql();
    assert.match(sql, /exists \([^)]*public\.iptv_accounts/, "must require an iptv line");
    assert.match(sql, /not exists \([^)]*public\.providers/, "must exclude providers");
    assert.match(
      sql,
      /not exists \([^)]*public\.customer_accounts/,
      "must skip already-managed accounts",
    );
  });

  test("insert is idempotent", () => {
    const sql = executableSql();
    assert.ok(
      sql.includes("on conflict (user_id) do nothing"),
      "insert must be a no-op on re-run",
    );
  });

  test("reconcile is tightly bounded to genuinely-active future-dated entitlements", () => {
    const sql = executableSql();
    assert.match(sql, /update public\.entitlements/, "must reconcile entitlements");
    assert.ok(sql.includes("status = 'active'"), "only status='active' entitlements");
    assert.ok(sql.includes("revoked_at is null"), "never touch revoked entitlements");
    assert.ok(sql.includes("expires_at > now()"), "only future-dated (never expired)");
  });
});
