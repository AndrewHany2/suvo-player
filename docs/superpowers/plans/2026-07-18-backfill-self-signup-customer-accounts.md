# Backfill `customer_accounts` for Self-Signup Customers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt self-signup / pre-reseller customers into the reseller dashboard by backfilling a `customer_accounts` row for each, without changing any customer's current access.

**Architecture:** A single idempotent SQL migration does two things in one transaction: (1) INSERT a `customer_accounts` row (`origin='self'`, `provider_id=NULL`, `expires_at` mirrored from the user's current `entitlements.expires_at`) for every `auth.users` row that has an IPTV line, is not a provider, and has no `customer_accounts` row yet; (2) reconcile only the genuinely-active, future-dated entitlements of the just-adopted rows to `active`/no-expiry, so `customer_accounts.expires_at` becomes the single source of truth for their term. Because the content gate AND-combines `assertAccountActive` (customer_accounts) with `assertEntitled` (entitlements) on the same deadline, access is preserved for every group. A guardrail JS test locks the safety-critical predicates because this touches the `entitlements` security boundary and there is no SQL test harness in this repo.

**Tech Stack:** PostgreSQL (Supabase migrations), Node.js `node:test` (ESM `.js`, run via `npm test`), ESLint flat config (`npm run lint`).

## Global Constraints

- **JavaScript only**, ESM `.js`, `node:test` — no Jest, no TypeScript for tests. (CLAUDE.md)
- Test files sit next to source as `*.test.js`; `npm test` = `node --test src scripts supabase electron` (recurses). (CLAUDE.md)
- Before committing, `npm test` and `npm run lint` must both pass (eslint warnings OK, errors not). (CLAUDE.md)
- Migration filename convention: `supabase/migrations/<UTCstamp>_<name>.sql`; next stamp after the latest (`20260718000001_login_rate_limit_prune.sql`) is **`20260718000002`**.
- Migration SQL: fully-qualified names (`public.*`, `auth.users`), wrapped in `begin; … commit;`, idempotent (re-runnable as a no-op). Matches the existing entitlements grandfather migration pattern (`20260717000004_entitlements.sql`) which reads `auth.users` directly.
- Exact marker string (used verbatim in INSERT and in the reconcile WHERE): `backfill: self-signup adopted`.
- The reconcile UPDATE must touch **only** entitlements that are `status='active' AND revoked_at IS NULL AND expires_at > now()` **and** belong to the adopted set (`origin='self' AND provider_id IS NULL AND note='backfill: self-signup adopted'`). It must never touch suspended/revoked/expired entitlements or provider-origin accounts.

## File Structure

- **Create:** `supabase/migrations/20260718000002_backfill_self_signup_customer_accounts.sql`
  Responsibility: the entire backfill + reconcile transaction, plus a leading `/* … */` block comment carrying the preview query and rollback recipe (block comment so it is neither executed nor seen by the guardrail test).
- **Create:** `supabase/migrations/20260718000002_backfill_self_signup_customer_accounts.test.js`
  Responsibility: guardrail test — reads the migration `.sql`, strips comments, and asserts the safety-critical clauses are present. Lives beside the migration; `node --test supabase` picks it up, and the Supabase CLI ignores non-`.sql` files in the migrations dir.

No other files change. `accounts.list`, `accounts.update`, `accounts.create`, `deviceGate.ts`, and the dashboard UI are intentionally untouched (the design's non-goals).

---

### Task 1: Backfill migration + guardrail test

**Files:**
- Create: `supabase/migrations/20260718000002_backfill_self_signup_customer_accounts.sql`
- Test: `supabase/migrations/20260718000002_backfill_self_signup_customer_accounts.test.js`

**Interfaces:**
- Consumes: existing tables `auth.users`, `public.customer_accounts` (`20260716000003`), `public.providers` (`20260716000002`), `public.entitlements` (`20260717000004`), legacy `public.iptv_accounts`.
- Produces: no code interface. The migration's observable contract is: after it runs, every in-scope self-signup customer has exactly one `customer_accounts` row with `origin='self'`, `provider_id IS NULL`, `note='backfill: self-signup adopted'`, and `expires_at` equal to their pre-migration entitlement expiry.

- [ ] **Step 1: Write the failing guardrail test**

Create `supabase/migrations/20260718000002_backfill_self_signup_customer_accounts.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test supabase/migrations/20260718000002_backfill_self_signup_customer_accounts.test.js`
Expected: FAIL — the migration `.sql` does not exist yet, so `readFileSync` throws `ENOENT` and every test errors.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260718000002_backfill_self_signup_customer_accounts.sql`:

```sql
/*
  Backfill customer_accounts for self-signup / pre-reseller customers so they
  become manageable in the reseller dashboard (admin.accounts.list reads ONLY
  customer_accounts, whose sole insert path is admin.accounts.create).

  Scope: every auth.users row that (a) has >=1 iptv_accounts line, (b) has no
  customer_accounts row yet, and (c) is not a provider/super-admin. Adopted as
  origin='self', provider_id=NULL. expires_at is MIRRORED from the user's
  current entitlements.expires_at (NULL if grandfathered or no entitlement row),
  so no customer's current access changes: the content gate AND-combines
  assertAccountActive (customer_accounts) with assertEntitled (entitlements) on
  the same deadline.

  Step 2 reconciles ONLY genuinely-active, future-dated entitlements of the
  just-adopted rows to active/no-expiry, making customer_accounts.expires_at the
  single source of truth for their term (as with provider-created accounts), so
  dashboard renewal works without entitlement-gate drift. Suspended, revoked,
  and expired entitlements are deliberately left untouched (they must keep
  denying). Idempotent: re-running is a no-op.

  PREVIEW (run BEFORE applying; read-only):
    select
      count(*)                                        as total_to_backfill,
      count(*) filter (where ent.expires_at is null)  as as_no_expiry,
      count(*) filter (where ent.expires_at > now())  as as_future_dated_midtrial,
      count(*) filter (where ent.expires_at <= now()) as as_already_expired
    from auth.users u
    left join public.entitlements ent on ent.user_id = u.id
    where exists     (select 1 from public.iptv_accounts    i  where i.user_id  = u.id)
      and not exists (select 1 from public.customer_accounts ca where ca.user_id = u.id)
      and not exists (select 1 from public.providers         p  where p.user_id  = u.id);

  ROLLBACK (adopted rows are identifiable by the marker below):
    delete from public.customer_accounts
    where origin = 'self' and provider_id is null
      and note = 'backfill: self-signup adopted';
    -- Note: the step-2 entitlement reconciliation is NOT auto-reversed; those
    -- rows are active/no-expiry, which is a safe, access-preserving state.
*/

begin;

-- 1. Adopt self-signup customers with a line. Mirror current entitlement expiry.
insert into public.customer_accounts (user_id, origin, provider_id, expires_at, note)
select u.id, 'self', null, ent.expires_at, 'backfill: self-signup adopted'
from auth.users u
left join public.entitlements ent on ent.user_id = u.id
where exists     (select 1 from public.iptv_accounts    i  where i.user_id  = u.id)
  and not exists (select 1 from public.customer_accounts ca where ca.user_id = u.id)
  and not exists (select 1 from public.providers         p  where p.user_id  = u.id)
on conflict (user_id) do nothing;

-- 2. Make customer_accounts the single source of truth for the adopted set:
--    reconcile ONLY genuinely-active, future-dated entitlements to no-expiry.
--    Never touches suspended / revoked / expired entitlements.
update public.entitlements e
set status = 'active', expires_at = null, updated_at = now()
from public.customer_accounts ca
where ca.user_id = e.user_id
  and ca.origin = 'self'
  and ca.provider_id is null
  and ca.note = 'backfill: self-signup adopted'
  and e.status = 'active'
  and e.revoked_at is null
  and e.expires_at is not null
  and e.expires_at > now();

commit;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test supabase/migrations/20260718000002_backfill_self_signup_customer_accounts.test.js`
Expected: PASS — 5 tests pass, 0 fail.

- [ ] **Step 5: Run the full suite and lint**

Run: `npm test`
Expected: whole suite passes, including the new guardrail test (no regressions elsewhere).

Run: `npm run lint`
Expected: no errors (warnings OK). The new test file uses the same ESM import style as the existing `_shared/*.test.js`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260718000002_backfill_self_signup_customer_accounts.sql \
        supabase/migrations/20260718000002_backfill_self_signup_customer_accounts.test.js
git commit -m "feat(admin): backfill customer_accounts for self-signup customers

Adopt auth.users with an iptv line but no customer_accounts row (excluding
providers) into the dashboard: origin='self', provider_id NULL, expires_at
mirrored from the current entitlement so access is preserved. Reconcile only
genuinely-active future-dated entitlements so customer_accounts becomes the
single source of truth. Idempotent. Guardrail test locks the safety predicates.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Rollout runbook (owner-executed against the live DB)

This task changes no code. It is the operational procedure the project owner runs against the real Supabase database (the repo has no clean local `supabase db reset`, since `profiles`/`iptv_accounts` base tables live outside the migrations folder). Record the outcome in the PR/commit description.

**Files:** none.

- [ ] **Step 1: Preview the impact (read-only)**

In the Supabase SQL editor (or `psql`), run the PREVIEW query from the migration's header comment. Confirm the counts are sane:
- `total_to_backfill` — roughly the number of self-signup customers you expect.
- `as_future_dated_midtrial` — the small subset whose entitlement will be reconciled in step 2 of the migration.
- `as_already_expired` — these stay denied (entitlement untouched); expected to remain locked out.

- [ ] **Step 2: Apply the migration**

Run: `supabase db push` (or the project's normal migration-deploy path).
Expected: migration `20260718000002` applies without error.

- [ ] **Step 3: Prove idempotency**

Re-run the PREVIEW query.
Expected: `total_to_backfill = 0` (every in-scope row now has a `customer_accounts` row).

Optionally re-apply the migration (`supabase db push`) and confirm it is a no-op (0 rows inserted, 0 entitlements updated).

- [ ] **Step 4: Dashboard + gate spot-checks**

- Open the dashboard **Accounts** page → the previously-invisible customers now appear, with **"—"** in the Provider column and their correct status.
- Pick a **grandfathered** account: status **Active**, expiry blank.
- If any existed, pick a **mid-trial** account: status **Active**, expiry = its original trial end.
- Pick a **suspended/revoked/expired** self-signup account (if any): still shows the correct non-active status, and confirm its content access is still denied (the reconcile left its entitlement alone).

---

## Self-Review

**1. Spec coverage:**
- Scope (iptv line, not provider, not already-managed) → Task 1 Step 3 INSERT `where` clause; locked by Step 1 test "scope".
- Attribution (`origin='self'`, `provider_id NULL`) → INSERT column list; locked by test "inserts self-origin".
- Expiry mirrored from entitlement → INSERT `select … ent.expires_at` via LEFT JOIN.
- Entitlement reconciliation Option B (bounded) → INSERT step 2 UPDATE; locked by test "reconcile is tightly bounded".
- Delivery = idempotent migration + preview query → `on conflict do nothing` + `not exists` guards (test "insert is idempotent"); preview query in header comment + Task 2 Step 1.
- Verification/rollout → Task 2 (preview → apply → idempotency → spot-checks).
- Rollback recipe → migration header comment.
- No UI/`accounts.*` changes (non-goals) → File Structure states no other files change.

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"write tests for the above". All code shown in full.

**3. Type/name consistency:** The marker string `backfill: self-signup adopted` is identical in the INSERT, the reconcile WHERE, the rollback comment, and the test assertions. Table/column names (`customer_accounts.origin/provider_id/expires_at/note`, `entitlements.status/revoked_at/expires_at/updated_at`) match the migrations they come from (`20260716000003`, `20260717000004`). The migration filename `20260718000002_backfill_self_signup_customer_accounts.sql` is identical in the test's `MIGRATION_URL`, both Step 6 `git add` paths, and the File Structure.
