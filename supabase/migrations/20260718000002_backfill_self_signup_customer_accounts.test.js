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

// Return the single SQL statement that begins with `start`, up to and including
// its terminating semicolon. Anchoring assertions to ONE statement (e.g. the
// reconcile UPDATE) is what makes this guardrail real: a predicate removed from
// the reconcile can no longer be "satisfied" by an identical-looking clause
// elsewhere in the file (the INSERT, or the UPDATE's own SET list).
function statement(sql, start) {
  const from = sql.indexOf(start);
  if (from === -1) return "";
  const end = sql.indexOf(";", from);
  return end === -1 ? sql.slice(from) : sql.slice(from, end + 1);
}

describe("backfill self-signup customer_accounts migration", () => {
  test("wraps the work in a single transaction", () => {
    const sql = executableSql();
    assert.match(sql, /\bbegin;/, "must open a transaction");
    assert.match(sql, /\bcommit;/, "must commit the transaction");
  });

  test("inserts self-origin, unattributed rows with the marker note", () => {
    const insert = statement(executableSql(), "insert into public.customer_accounts");
    assert.ok(insert, "must have an insert into public.customer_accounts");
    assert.ok(insert.includes("'self'"), "origin must be 'self'");
    assert.ok(
      insert.includes("backfill: self-signup adopted"),
      "must stamp the traceable note marker",
    );
  });

  test("scope: requires an iptv line, skips providers and already-managed", () => {
    const insert = statement(executableSql(), "insert into public.customer_accounts");
    assert.match(insert, /exists \([^)]*public\.iptv_accounts/, "must require an iptv line");
    assert.match(insert, /not exists \([^)]*public\.providers/, "must exclude providers");
    assert.match(
      insert,
      /not exists \([^)]*public\.customer_accounts/,
      "must skip already-managed accounts",
    );
  });

  test("insert is idempotent", () => {
    const insert = statement(executableSql(), "insert into public.customer_accounts");
    assert.ok(
      insert.includes("on conflict (user_id) do nothing"),
      "insert must be a no-op on re-run",
    );
  });

  test("reconcile touches ONLY the just-adopted set", () => {
    const update = statement(executableSql(), "update public.entitlements");
    assert.ok(update, "must reconcile entitlements");
    // Correlated to the customer_accounts rows this migration just adopted...
    assert.ok(update.includes("from public.customer_accounts ca"), "must join the adopted rows");
    assert.ok(update.includes("ca.user_id = e.user_id"), "must correlate ca to the entitlement");
    // ...and bounded to THOSE rows (self-origin, unattributed, marker note). If a
    // future edit dropped this scope, the reconcile would strip expiry off every
    // active user system-wide — these three assertions make that fail the test.
    assert.ok(update.includes("ca.origin = 'self'"), "adopted set: origin='self'");
    assert.ok(update.includes("ca.provider_id is null"), "adopted set: unattributed");
    assert.ok(
      update.includes("ca.note = 'backfill: self-signup adopted'"),
      "adopted set: marker note",
    );
  });

  test("reconcile is bounded to genuinely-active, future-dated entitlements", () => {
    const update = statement(executableSql(), "update public.entitlements");
    // Alias-qualified (e.*) so these bind to the WHERE bounds, never the SET clause.
    assert.ok(update.includes("e.status = 'active'"), "only status='active' entitlements");
    assert.ok(update.includes("e.revoked_at is null"), "never touch revoked entitlements");
    assert.ok(update.includes("e.expires_at > now()"), "only future-dated (never expired)");
    // Step-2 idempotency: already-reconciled rows (expires_at NULL) are skipped.
    assert.ok(
      update.includes("e.expires_at is not null"),
      "must skip already-reconciled (no-expiry) rows on re-run",
    );
  });
});
