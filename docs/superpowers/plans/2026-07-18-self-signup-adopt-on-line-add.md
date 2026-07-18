# Adopt Self-Signup Customers on Line-Add — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a self-signup end-user adds an IPTV line in the app, automatically materialize a `customer_accounts` row (active, no expiry) so they become visible and manageable in the reseller dashboard.

**Architecture:** A new idempotent Postgres function `public.adopt_self_signup_account(p_user_id uuid)` performs the per-user version of the `20260718000002` backfill (insert the `customer_accounts` row if the user has a line, has no row, and is not a provider; then reconcile that adopted row's entitlement to active/no-expiry). The `data` Edge Function's `iptv.insert` handler calls it via a best-effort `admin.rpc(...)` right after inserting the line. No dashboard code changes — the row alone makes the customer appear. Guardrail tests lock the function's safety predicates and the handler wiring, because this touches the `entitlements`/`customer_accounts` security boundary and the repo has no SQL/Deno test harness.

**Tech Stack:** PostgreSQL (Supabase migrations), Deno/TypeScript (Edge Functions), Node.js `node:test` (ESM `.js`, run via `npm test`), ESLint flat config.

## Global Constraints

- **JavaScript only** for tests, ESM `.js`, `node:test` — no Jest, no TypeScript for tests. (CLAUDE.md)
- Test files sit next to source as `*.test.js`; `npm test` = `node --test src scripts supabase electron` (recurses). (CLAUDE.md)
- Before committing, `npm test` and `npm run lint` must both pass (eslint warnings OK, errors not). (CLAUDE.md)
- Migration filename convention: `supabase/migrations/<UTCstamp>_<name>.sql`; next stamp after the latest (`20260718000002_backfill_self_signup_customer_accounts.sql`) is **`20260718000003`**.
- Migration SQL: fully-qualified names (`public.*`), wrapped in `begin; … commit;`, idempotent (`create or replace` + `not exists`/`on conflict` guards → re-runnable as a no-op).
- The function is `SECURITY DEFINER`, `set search_path = public`, and `EXECUTE` is revoked from `public`, `authenticated`, `anon` (only the service role calls it).
- Exact marker string, used verbatim in the INSERT, the reconcile WHERE, and the rollback/tests: `self: added via app`.
- Backfilled row values: `origin='self'`, `provider_id=NULL`, `expires_at=NULL`.
- The reconcile UPDATE forces `status='active', expires_at=NULL, updated_at=now()`, scoped to the adopted self row (`origin='self' AND provider_id IS NULL AND note='self: added via app'`) and guarded by `e.revoked_at IS NULL` (never resurrect an admin-killed account).
- The `iptv.insert` call is **best-effort / non-fatal**: a failed `admin.rpc` must NOT fail the line insert; log and continue (mirrors `claim-device`'s "entitlement bootstrap failed (non-fatal)" pattern).
- No changes to `accounts.list`, `accounts.create`, `accounts.update`, or the dashboard UI.

## File Structure

- **Create:** `supabase/migrations/20260718000003_adopt_self_signup_account_fn.sql`
  Responsibility: define `public.adopt_self_signup_account(uuid)` + revoke execute, wrapped in a transaction, with a leading `/* … */` block comment carrying purpose and rollback.
- **Create:** `supabase/migrations/20260718000003_adopt_self_signup_account_fn.test.js`
  Responsibility: guardrail test — reads the migration `.sql`, strips comments, asserts the function's safety-critical clauses (statement-anchored, mirroring the `20260718000002` test).
- **Modify:** `supabase/functions/data/index.ts` — `case "iptv.insert"` only: add the best-effort `admin.rpc("adopt_self_signup_account", …)` call after the existing line insert. No other cases touched.
- **Create:** `supabase/functions/data/iptv-insert-adoption.test.js`
  Responsibility: content-guardrail test — reads `data/index.ts`, isolates the `iptv.insert` case, asserts it invokes `adopt_self_signup_account` via `.rpc(...)` with `p_user_id`, positioned after the line insert.

---

### Task 1: `adopt_self_signup_account` function migration + guardrail test

**Files:**
- Create: `supabase/migrations/20260718000003_adopt_self_signup_account_fn.sql`
- Test: `supabase/migrations/20260718000003_adopt_self_signup_account_fn.test.js`

**Interfaces:**
- Consumes: existing tables `public.customer_accounts` (`20260716000003`), `public.providers` (`20260716000002`), `public.entitlements` (`20260717000004`), legacy `public.iptv_accounts`.
- Produces: SQL function `public.adopt_self_signup_account(p_user_id uuid) returns void`. Task 2 calls it via `admin.rpc("adopt_self_signup_account", { p_user_id: userId })`. Contract: after it runs for a user who has ≥1 line, no `customer_accounts` row, and is not a provider, that user has exactly one `customer_accounts` row (`origin='self'`, `provider_id=NULL`, `expires_at=NULL`, `note='self: added via app'`) and their non-revoked entitlement is `status='active', expires_at=NULL`. Idempotent.

- [ ] **Step 1: Write the failing guardrail test**

Create `supabase/migrations/20260718000003_adopt_self_signup_account_fn.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test supabase/migrations/20260718000003_adopt_self_signup_account_fn.test.js`
Expected: FAIL — the migration `.sql` does not exist yet (`readFileSync` throws `ENOENT`), so every test errors.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260718000003_adopt_self_signup_account_fn.sql`:

```sql
/*
  Ongoing per-user adoption of self-signup customers into the reseller dashboard.
  The one-time backfill (20260718000002) only covered EXISTING users; this
  function is called from data/iptv.insert whenever a self-signup user adds a
  line, so new self-signups also become visible/manageable.

  Policy (owner-approved): self-added accounts are ACTIVE, NO EXPIRY — this
  removes the 7-day trial for anyone who adds a line. To change the policy later,
  edit expires_at below (and the reconcile).

  Safe: only adopts users who have a line, have no customer_accounts row, and are
  not providers. The entitlement reconcile never touches a revoked (admin-killed)
  account. Idempotent: create-or-replace + not-exists/on-conflict guards.

  ROLLBACK:
    drop function if exists public.adopt_self_signup_account(uuid);
    delete from public.customer_accounts
    where origin = 'self' and provider_id is null and note = 'self: added via app';
    -- The entitlement reconcile is not auto-reversed (active/no-expiry is a safe state).
*/

begin;

create or replace function public.adopt_self_signup_account(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 1. Adopt: only if the user has a line, has no customer_accounts row, and is
  --    not a provider. Active, no expiry, traceable marker note.
  insert into public.customer_accounts (user_id, origin, provider_id, expires_at, note)
  select p_user_id, 'self', null, null, 'self: added via app'
  where exists     (select 1 from public.iptv_accounts    i  where i.user_id = p_user_id)
    and not exists (select 1 from public.customer_accounts ca where ca.user_id = p_user_id)
    and not exists (select 1 from public.providers         p  where p.user_id = p_user_id)
  on conflict (user_id) do nothing;

  -- 2. Reconcile the adopted row's entitlement to active/no-expiry so the content
  --    gate agrees the account is permanently active. Never resurrects a revoked
  --    (admin-killed) account.
  update public.entitlements e
  set status = 'active', expires_at = null, updated_at = now()
  from public.customer_accounts ca
  where ca.user_id = e.user_id
    and ca.user_id = p_user_id
    and ca.origin = 'self'
    and ca.provider_id is null
    and ca.note = 'self: added via app'
    and e.revoked_at is null;
end;
$$;

revoke execute on function public.adopt_self_signup_account(uuid) from public, authenticated, anon;

commit;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test supabase/migrations/20260718000003_adopt_self_signup_account_fn.test.js`
Expected: PASS — 6 tests pass, 0 fail.

- [ ] **Step 5: Run the full suite and lint**

Run: `npm test`
Expected: whole suite passes (new guardrail suite included, no regressions).

Run: `npm run lint`
Expected: no errors (warnings OK).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260718000003_adopt_self_signup_account_fn.sql \
        supabase/migrations/20260718000003_adopt_self_signup_account_fn.test.js
git commit -m "feat(db): adopt_self_signup_account function for on-line-add adoption

Idempotent per-user version of the 20260718000002 backfill: inserts a
customer_accounts row (origin='self', no expiry) for a user who has a line, no
row, and is not a provider, then reconciles that adopted row's entitlement to
active/no-expiry (never resurrecting a revoked account). SECURITY DEFINER,
execute revoked from unprivileged roles. Guardrail test locks the predicates.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Wire the adoption call into `data`/`iptv.insert` + guardrail test

**Files:**
- Modify: `supabase/functions/data/index.ts` (the `case "iptv.insert"` block, currently lines ~119-134)
- Test: `supabase/functions/data/iptv-insert-adoption.test.js`

**Interfaces:**
- Consumes: `public.adopt_self_signup_account(uuid)` from Task 1 (called as `admin.rpc("adopt_self_signup_account", { p_user_id: userId })`). `admin` and `userId` are already in scope in the handler (`data/index.ts:27-28`).
- Produces: no new code interface; observable effect is that a successful `iptv.insert` also triggers adoption, best-effort.

- [ ] **Step 1: Write the failing content-guardrail test**

Create `supabase/functions/data/iptv-insert-adoption.test.js`:

```js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Read the handler source relative to this test (CWD-independent). We assert on
// the source text rather than executing it: index.ts is a Deno module with
// Deno-only imports, so node:test cannot run it — a content guardrail locks the
// wiring instead.
const SRC_URL = new URL("./index.ts", import.meta.url);

function source() {
  return readFileSync(fileURLToPath(SRC_URL), "utf8");
}

// Isolate the `case "iptv.insert":` block, up to the next case label, so the
// assertions can't be satisfied by an adoption call placed in some other case.
function iptvInsertCase(src) {
  const from = src.indexOf('case "iptv.insert"');
  const end = src.indexOf('case "iptv.update"', from);
  return from === -1 ? "" : src.slice(from, end === -1 ? undefined : end);
}

describe("data/iptv.insert adopts self-signup customers", () => {
  test("iptv.insert case exists and still inserts the line first", () => {
    const block = iptvInsertCase(source());
    assert.ok(block, 'must have a case "iptv.insert" block');
    assert.ok(block.includes('.from("iptv_accounts")'), "must still insert the line");
    assert.ok(block.includes(".insert("), "line insert must remain");
  });

  test("invokes adopt_self_signup_account via rpc, after the line insert", () => {
    const block = iptvInsertCase(source());
    assert.ok(
      block.includes("adopt_self_signup_account"),
      "must call the adoption function",
    );
    assert.match(block, /\.rpc\(\s*["']adopt_self_signup_account["']/, "must call it via .rpc()");
    assert.ok(block.includes("p_user_id"), "must pass p_user_id");
    // Adoption runs AFTER the line is saved.
    assert.ok(
      block.indexOf(".insert(") < block.indexOf("adopt_self_signup_account"),
      "adoption must come after the line insert",
    );
  });

  test("adoption is best-effort (non-fatal): its error is handled, not thrown", () => {
    const block = iptvInsertCase(source());
    // The rpc error is captured and logged, never rethrown, so a failed adoption
    // does not fail the line insert.
    assert.match(block, /adopterr|adopt_?error/i, "must capture the rpc error into a variable");
    assert.ok(block.includes("console.error"), "must log the non-fatal failure");
    assert.ok(!/throw\b/.test(block), "must not throw on adoption failure");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test supabase/functions/data/iptv-insert-adoption.test.js`
Expected: FAIL — the `iptv.insert` block does not yet reference `adopt_self_signup_account`, so the second and third tests fail (the first passes).

- [ ] **Step 3: Make the change**

In `supabase/functions/data/index.ts`, replace the `case "iptv.insert"` block:

```ts
      case "iptv.insert": {
        await assertOwnsProfile(admin, userId, payload.profileId);
        const { data } = await db("iptv_accounts")
          .insert({
            user_id: userId,
            profile_id: payload.profileId,
            type: payload.type || "xtream",
            nickname: payload.nickname || null,
            host: payload.host || null,
            username: payload.username || null,
            password: payload.password || null,
            url: payload.url || null,
          })
          .select("id")
          .single();
        return json({ id: data?.id ?? null });
      }
```

with:

```ts
      case "iptv.insert": {
        await assertOwnsProfile(admin, userId, payload.profileId);
        const { data } = await db("iptv_accounts")
          .insert({
            user_id: userId,
            profile_id: payload.profileId,
            type: payload.type || "xtream",
            nickname: payload.nickname || null,
            host: payload.host || null,
            username: payload.username || null,
            password: payload.password || null,
            url: payload.url || null,
          })
          .select("id")
          .single();
        // Best-effort: adopt a self-signup customer into the reseller dashboard
        // (active, no-expiry customer_accounts row + entitlement reconcile).
        // Non-fatal — the line is already saved; a failure here only delays
        // dashboard visibility. Mirrors claim-device's non-fatal bootstrap.
        const { error: adoptErr } = await admin.rpc("adopt_self_signup_account", {
          p_user_id: userId,
        });
        if (adoptErr) {
          console.error("self-signup adoption failed (non-fatal):", adoptErr.message);
        }
        return json({ id: data?.id ?? null });
      }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test supabase/functions/data/iptv-insert-adoption.test.js`
Expected: PASS — 3 tests pass, 0 fail.

- [ ] **Step 5: Run the full suite and lint**

Run: `npm test`
Expected: whole suite passes.

Run: `npm run lint`
Expected: no errors (warnings OK). (`data/index.ts` is not linted by the JS eslint config if it targets `.js` only; the test file is. Confirm no new errors either way.)

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/data/index.ts \
        supabase/functions/data/iptv-insert-adoption.test.js
git commit -m "feat(data): adopt self-signup customers on iptv.insert

After inserting an IPTV line, best-effort call adopt_self_signup_account so a
self-signup end-user becomes visible/manageable in the reseller dashboard as an
active, no-expiry account. Non-fatal: a failed rpc never fails the line insert.
Content-guardrail test locks the wiring.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Rollout runbook (owner-executed against the live DB)

This task changes no code. It is the operational procedure the owner runs after deploy (the repo has no clean local `supabase db reset`, and this needs deployed functions + a real device to exercise the gates). Record the outcome in the PR/commit description.

**Files:** none.

- [ ] **Step 1: Deploy**

Apply migration `20260718000003` (`supabase db push`) and deploy the `data` Edge Function (the project's normal deploy path). Confirm both succeed.

- [ ] **Step 2: Exercise the happy path**

With a **fresh** self-signup user: sign up → open the app (claims a device, mints the trial) → add an IPTV line (Xtream or M3U) in the app's Accounts screen.

- [ ] **Step 3: Verify dashboard visibility + term**

- Dashboard **Accounts** page: the new customer appears with **"—"** in the Provider column, status **Active**, expiry **blank**.
- Confirm content still plays **past day 7** (the entitlement was reconciled to no-expiry), demonstrating the trial→permanent policy.

- [ ] **Step 4: Verify idempotency + guards**

- Add a **second** line for the same user → still exactly **one** `customer_accounts` row (no duplicate, no error).
- Confirm a **provider** account that adds a line via the app does **not** get a `'self'` row.
- If you have an admin-**revoked** account, confirm adding a line does **not** resurrect it (entitlement stays revoked/denied).

---

## Self-Review

**1. Spec coverage:**
- Ongoing adoption on line-add → Task 1 function + Task 2 `iptv.insert` call.
- Row values (`origin='self'`, `provider_id=NULL`, `expires_at=NULL`, marker note) → Task 1 Step 3 INSERT; locked by Task 1 test "inserts a self-origin…".
- Scope (line, not provider, not already-managed) → INSERT `where`; locked by test "scope".
- Active/no-expiry policy + entitlement reconcile, kill-switch preserved → Task 1 Step 3 UPDATE; locked by test "reconcile forces active/no-expiry…".
- SECURITY DEFINER + execute revoked → Task 1 Step 3; locked by tests "defines a security-definer function" and "revokes execute".
- Best-effort/non-fatal wiring → Task 2 Step 3; locked by test "adoption is best-effort".
- No dashboard/`accounts.*` changes (non-goals) → File Structure states only `data/index.ts` changes.
- Verification/rollout → Task 3.
- Rollback → migration header comment.

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"write tests for the above". All code shown in full.

**3. Type/name consistency:** The function name `adopt_self_signup_account`, its `p_user_id uuid` parameter, and the marker `self: added via app` are identical across the migration, the `admin.rpc(...)` call, the rollback comment, and both tests. The migration filename `20260718000003_adopt_self_signup_account_fn.sql` matches the test's `MIGRATION_URL` and both `git add` paths. Table/column names (`customer_accounts.origin/provider_id/expires_at/note`, `entitlements.status/expires_at/revoked_at/updated_at`) match the migrations they come from. The `iptv.insert` before/after blocks match the current source (`data/index.ts:119-134`), changing only the added adoption call.
