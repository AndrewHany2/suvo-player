import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MIGRATION_URL = new URL(
  "./20260718000005_rename_profiles_username_to_name.sql",
  import.meta.url,
);

function executableSql() {
  const raw = readFileSync(fileURLToPath(MIGRATION_URL), "utf8");
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function statement(sql, start) {
  const from = sql.indexOf(start);
  if (from === -1) return "";
  const end = sql.indexOf(";", from);
  return end === -1 ? sql.slice(from) : sql.slice(from, end + 1);
}

describe("rename profiles.username -> name migration", () => {
  test("wraps the work in a single transaction", () => {
    const sql = executableSql();
    assert.match(sql, /\bbegin;/, "must open a transaction");
    assert.match(sql, /\bcommit;/, "must commit the transaction");
  });

  test("renames the column, guarded so re-running is a no-op", () => {
    const sql = executableSql();
    assert.match(
      sql,
      /alter table public\.profiles rename column username to name/,
      "must rename username -> name",
    );
    // Idempotency guard: only rename when `username` still exists.
    assert.ok(
      sql.includes("information_schema.columns") && sql.includes("column_name = 'username'"),
      "must guard the rename on the column still existing (idempotent re-run)",
    );
  });

  test("recreates adopt_self_signup_account to use the new `name` column", () => {
    const sql = executableSql();
    assert.match(
      sql,
      /create or replace function public\.adopt_self_signup_account\(p_user_id uuid\)/,
      "must re-create the adopt function so it no longer references username",
    );
    const insert = statement(sql, "insert into public.profiles");
    assert.ok(insert, "the recreated function must still upsert a profiles row");
    assert.ok(insert.includes("(user_id, name, email)"), "must write the new `name` column");
    assert.ok(
      insert.includes("coalesce(nullif(p.name"),
      "must fill a blank name only (never overwrite)",
    );
    assert.ok(
      !insert.includes("username"),
      "the recreated profiles upsert must not reference the old username column",
    );
  });
});
