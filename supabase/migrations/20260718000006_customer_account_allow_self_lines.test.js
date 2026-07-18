import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MIGRATION_URL = new URL(
  "./20260718000006_customer_account_allow_self_lines.sql",
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

describe("allow_self_lines migration", () => {
  test("wraps the work in a single transaction", () => {
    const sql = executableSql();
    assert.match(sql, /\bbegin;/, "must open a transaction");
    assert.match(sql, /\bcommit;/, "must commit the transaction");
  });

  test("adds allow_self_lines as NOT NULL default false, idempotently", () => {
    const sql = executableSql();
    const add = statement(sql, "alter table public.customer_accounts");
    assert.ok(add.includes("add column if not exists allow_self_lines"), "idempotent add");
    assert.ok(add.includes("boolean not null default false"), "NOT NULL default false");
  });

  test("backfills every existing row to true", () => {
    const upd = statement(executableSql(), "update public.customer_accounts");
    assert.ok(upd.includes("set allow_self_lines = true"), "existing customers keep the ability");
    assert.ok(!upd.includes(" where "), "backfill is unconditional (all existing rows)");
  });

  test("re-creates adopt_self_signup_account to set allow_self_lines=true", () => {
    const sql = executableSql();
    assert.match(sql, /create or replace function public\.adopt_self_signup_account/, "re-creates the fn");
    const ins = statement(sql, "insert into public.customer_accounts");
    assert.ok(ins.includes("allow_self_lines"), "adopt insert names the column");
    assert.match(ins, /'self'\s*,\s*null\s*,\s*null\s*,\s*'self: added via app'\s*,\s*true/, "self adoption is allowed");
  });

  test("keeps the function locked down (revoke execute from public roles)", () => {
    assert.match(executableSql(), /revoke execute on function public\.adopt_self_signup_account\(uuid\) from public, authenticated, anon;/);
  });
});
