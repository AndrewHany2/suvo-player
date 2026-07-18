# Dashboard multi-line per customer + self-add toggle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a provider attach multiple IPTV lines to one customer login from both the dashboard create form and the account detail page, and control per-customer (default OFF) whether that customer may add their own lines in the app.

**Architecture:** One new column `customer_accounts.allow_self_lines`. The `admin` Edge Function gains per-line CRUD and returns `lines[]`; `accounts.create` inserts an array of lines. The `data` Edge Function gates `iptv.insert` on the flag (403 when a `customer_accounts` row exists with `allow_self_lines=false`). The app hides "Add account" via a flag read from `entitlement.fetch`. All decision logic lives in pure, unit-tested helpers; UI/handler wiring is verified by lint + build (no component renderer exists in either package).

**Tech Stack:** Supabase Postgres migrations + Deno Edge Functions (TypeScript importing pure `.js` helpers); dashboard = Vite + React + TS (vitest, pure-logic tests only); app = Expo/React Native (`node:test`, pure-logic tests only).

## Global Constraints

- JavaScript/TypeScript only per package; app is `.js`/`.jsx` (no TS). Edge Functions are `.ts` but import pure logic from `.js` so it runs under both Deno and `node:test`.
- Tests: `node:test` via `npm test` (`node --test src scripts supabase electron`); dashboard `npm test` (`vitest run`). Test files sit next to source as `*.test.js` / `*.test.ts`.
- **No React renderer in either package** (no RTL / react-test-renderer / jsdom). Do NOT write component render tests. Put logic in pure helpers and test those; verify components via `npm run lint` (app) and `npm run build` (dashboard, = `tsc` typecheck) + manual.
- Before committing: app `npm test` + `npm run lint` must pass (eslint warnings OK, errors not). Dashboard `npm test` + `npm run build` must pass.
- Migrations are append-only and idempotent; each ships a `*.test.js` guardrail asserting the SQL statically (see existing `20260718000002/3/4`). Next migration number is `20260718000006`.
- `profiles` display column is `name` (renamed from `username` on this branch; see `20260718000005`). Do not reintroduce `username` for the profile name.
- Provider-isolation invariant: every account action checks `canActOnAccount(caller, owner)` before acting. Audit metadata MUST NOT contain passwords or line credentials.

---

### Task 1: Migration — `allow_self_lines` column, backfill, adopt-fn update

**Files:**
- Create: `supabase/migrations/20260718000006_customer_account_allow_self_lines.sql`
- Test: `supabase/migrations/20260718000006_customer_account_allow_self_lines.test.js`

**Interfaces:**
- Produces: `customer_accounts.allow_self_lines boolean not null default false`; `public.adopt_self_signup_account(uuid)` re-created so its `customer_accounts` insert sets `allow_self_lines = true`.

- [ ] **Step 1: Write the failing guardrail test**

Create `supabase/migrations/20260718000006_customer_account_allow_self_lines.test.js`:

```js
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test supabase/migrations/20260718000006_customer_account_allow_self_lines.test.js`
Expected: FAIL — cannot read the `.sql` file (ENOENT), since it doesn't exist yet.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260718000006_customer_account_allow_self_lines.sql`. The `adopt_self_signup_account` body is copied verbatim from `20260718000005` with ONLY the `customer_accounts` insert changed (adds the `allow_self_lines` column + `true`):

```sql
/*
  Per-customer self-add control: allow_self_lines.

  Adds customer_accounts.allow_self_lines — whether the customer may add their
  own IPTV line in the app (AccountsScreen "Add account" -> data/iptv.insert).

  Policy at ship time (owner-approved):
    - column default FALSE            -> NEW provider-created customers can't.
    - one-time backfill: ALL existing rows -> TRUE (today there is no gate, so
      this preserves current behavior for everyone already relying on self-add).
    - adopt_self_signup_account sets  -> TRUE (future self-signups can self-add).

  RUN ONCE. The blanket backfill re-sets every row to true, so do NOT re-apply
  after go-live once providers have toggled some customers OFF (it would
  re-enable them). Idempotent for schema (add column if not exists) but the
  UPDATE is intentionally unconditional — treat this file as one-shot.

  Depends on 20260718000005 (profiles.name rename): the adopt function body
  below references profiles.name, so this MUST run after 000005.

  ROLLBACK:
    -- Revert the data + admin Edge Functions first (they read the column), then:
    alter table public.customer_accounts drop column if exists allow_self_lines;
    -- Restore the previous function body by re-applying 20260718000005.
*/

begin;

alter table public.customer_accounts
  add column if not exists allow_self_lines boolean not null default false;

-- Existing customers keep the self-add ability they have today (no gate before
-- this migration). New provider customers get the column default (false).
update public.customer_accounts set allow_self_lines = true;

-- Re-create the adoption fn so self-signup customers adopted going forward are
-- created with allow_self_lines = true. Body identical to 20260718000005 except
-- the customer_accounts insert now names+sets allow_self_lines.
create or replace function public.adopt_self_signup_account(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles as p (user_id, name, email)
  select p_user_id, u.email, u.email
  from auth.users u
  where u.id = p_user_id
    and u.email is not null
    and exists     (select 1 from public.iptv_accounts i  where i.user_id = p_user_id)
    and not exists (select 1 from public.providers     pr where pr.user_id = p_user_id)
  on conflict (user_id) do update
    set name  = coalesce(nullif(p.name, ''), excluded.name),
        email = coalesce(p.email, excluded.email);

  insert into public.customer_accounts (user_id, origin, provider_id, expires_at, note, allow_self_lines)
  select p_user_id, 'self', null, null, 'self: added via app', true
  where exists     (select 1 from public.iptv_accounts    i  where i.user_id = p_user_id)
    and not exists (select 1 from public.customer_accounts ca where ca.user_id = p_user_id)
    and not exists (select 1 from public.providers         p  where p.user_id = p_user_id)
  on conflict (user_id) do nothing;

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

Run: `node --test supabase/migrations/20260718000006_customer_account_allow_self_lines.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260718000006_customer_account_allow_self_lines.sql supabase/migrations/20260718000006_customer_account_allow_self_lines.test.js
git commit -m "feat(db): customer_accounts.allow_self_lines + adopt-fn sets true"
```

---

### Task 2: Pure helper — `selfLinesAllowed`

**Files:**
- Modify: `supabase/functions/_shared/accountStatus.js` (add one exported function)
- Test: `supabase/functions/_shared/accountStatus.test.js` (add a describe block)

**Interfaces:**
- Produces: `selfLinesAllowed(acctRow) -> boolean`. `acctRow` is a `customer_accounts` row (or `null`). Rule: no row → `true` (legacy/ungated); row present → `acctRow.allow_self_lines === true`. Consumed by Task 4 (`loadSelfLinesAllowed`, `entitlementSnapshot`).

- [ ] **Step 1: Write the failing test** — append to `supabase/functions/_shared/accountStatus.test.js`:

```js
import { selfLinesAllowed } from "./accountStatus.js";

describe("selfLinesAllowed", () => {
  test("no customer_accounts row => allowed (legacy / ungated)", () => {
    assert.equal(selfLinesAllowed(null), true);
    assert.equal(selfLinesAllowed(undefined), true);
  });
  test("row with allow_self_lines true => allowed", () => {
    assert.equal(selfLinesAllowed({ allow_self_lines: true }), true);
  });
  test("row with allow_self_lines false => not allowed", () => {
    assert.equal(selfLinesAllowed({ allow_self_lines: false }), false);
  });
  test("missing/nullish column on a present row => not allowed (fail closed)", () => {
    assert.equal(selfLinesAllowed({}), false);
    assert.equal(selfLinesAllowed({ allow_self_lines: null }), false);
  });
});
```

> Note: `accountStatus.test.js` already has top-of-file `import { test, describe } from "node:test"`, `import assert from "node:assert/strict"`, and imports from `./accountStatus.js`. Add only the new `import { selfLinesAllowed }` (merge into the existing import if one already pulls from `./accountStatus.js`) and the new describe block — do not duplicate the node:test/assert imports.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test supabase/functions/_shared/accountStatus.test.js`
Expected: FAIL — `selfLinesAllowed is not a function` / not exported.

- [ ] **Step 3: Implement** — append to `supabase/functions/_shared/accountStatus.js`:

```js
// Whether a customer may add their own IPTV lines in the app. A missing
// customer_accounts row is the legacy / ungated case (self-signup before
// adoption, or a provider login) — allowed. A present row must opt in
// explicitly; anything other than a literal true (including a missing column)
// fails closed to not-allowed.
export function selfLinesAllowed(acctRow) {
  if (acctRow == null) return true;
  return acctRow.allow_self_lines === true;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test supabase/functions/_shared/accountStatus.test.js`
Expected: PASS (existing tests + 4 new).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/accountStatus.js supabase/functions/_shared/accountStatus.test.js
git commit -m "feat(shared): selfLinesAllowed policy helper"
```

---

### Task 3: Pure `adminLogic` — lines array + `allowSelfLines` on account create

**Files:**
- Modify: `supabase/functions/_shared/adminLogic.js` (`validateNewAccount`)
- Test: `supabase/functions/_shared/adminLogic.test.js`

**Interfaces:**
- Consumes: existing `validateLine(line) -> { ok, value }` (unchanged).
- Produces: `validateNewAccount(input)` now returns `value.lines: LinePayload[]` (was `value.line`) and `value.allowSelfLines: boolean`. Accepts `input.lines` (array, ≥1) OR a legacy single `input.line` (normalized to a one-element array). `errors` includes `"lines"` if empty or any line invalid. Consumed by Task 5 (`admin/accounts.create`).

- [ ] **Step 1: Write the failing tests** — append to `supabase/functions/_shared/adminLogic.test.js` (reuse its existing `test`/`assert` imports):

```js
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

  test("requires at least one line", () => {
    const r = validateNewAccount({ ...base, lines: [] });
    assert.equal(r.ok, false);
    assert.ok(r.errors.includes("lines"));
  });

  test("rejects when any line is invalid", () => {
    const r = validateNewAccount({ ...base, lines: [xtream, { type: "xtream", host: "", username: "", password: "" }] });
    assert.equal(r.ok, false);
    assert.ok(r.errors.includes("lines"));
  });

  test("allowSelfLines defaults false and coerces to a strict boolean", () => {
    assert.equal(validateNewAccount({ ...base, lines: [xtream] }).value.allowSelfLines, false);
    assert.equal(validateNewAccount({ ...base, lines: [xtream], allowSelfLines: true }).value.allowSelfLines, true);
    assert.equal(validateNewAccount({ ...base, lines: [xtream], allowSelfLines: "yes" }).value.allowSelfLines, false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test supabase/functions/_shared/adminLogic.test.js`
Expected: FAIL — `r.value.lines` is undefined / `allowSelfLines` undefined.

- [ ] **Step 3: Implement** — replace the `validateNewAccount` function body in `supabase/functions/_shared/adminLogic.js` (lines 51-76) with:

```js
export function validateNewAccount(input) {
  const errors = [];
  const name = String(input?.name ?? "").trim();
  const password = String(input?.password ?? "");
  const deviceLimit = Number(input?.deviceLimit);
  if (name.length < 1 || name.length > 60) errors.push("name");
  // Mirrors supabase/config.toml's minimum_password_length = 6.
  if (password.length < 6) errors.push("password");
  if (!Number.isInteger(deviceLimit) || deviceLimit < 1) errors.push("deviceLimit");

  // Accept a `lines` array; normalize a legacy single `line` to [line]. At
  // least one valid line is required. Any invalid line fails the whole create.
  const rawLines = Array.isArray(input?.lines)
    ? input.lines
    : (input?.line != null ? [input.line] : []);
  const lines = [];
  if (rawLines.length < 1) {
    errors.push("lines");
  } else {
    for (const raw of rawLines) {
      const v = validateLine(raw);
      if (!v.ok) { errors.push("lines"); break; }
      lines.push(v.value);
    }
  }

  let expiresAt = null;
  if (input?.expiresAt != null && input.expiresAt !== "") {
    const t = Date.parse(input.expiresAt);
    if (!Number.isFinite(t)) errors.push("expiresAt");
    else expiresAt = new Date(t).toISOString();
  }

  const allowSelfLines = input?.allowSelfLines === true;

  return {
    ok: errors.length === 0,
    errors,
    value: { name, password, deviceLimit, expiresAt, lines, allowSelfLines },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test supabase/functions/_shared/adminLogic.test.js`
Expected: PASS. (Existing `validateNewAccount` tests that assert on `value.line` — if any — must be updated to `value.lines[0]`; grep the test file for `.value.line` and fix.)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/adminLogic.js supabase/functions/_shared/adminLogic.test.js
git commit -m "feat(shared): validateNewAccount accepts lines[] + allowSelfLines"
```

---

### Task 4: Server — `loadSelfLinesAllowed` + `entitlementSnapshot` exposes the flag

**Files:**
- Modify: `supabase/functions/_shared/deviceGate.ts`

**Interfaces:**
- Consumes: `selfLinesAllowed` (Task 2) from `./accountStatus.js`.
- Produces: `loadSelfLinesAllowed(admin, userId) -> Promise<boolean>` (reads `customer_accounts.allow_self_lines`, applies `selfLinesAllowed`); `entitlementSnapshot` return value gains `allowSelfLines: boolean`. Consumed by Task 5 (gate) and Task 9 (client).

> No unit test: this is Deno DB-I/O wiring, and the repo does not test the Deno layer (only pure logic, covered by Tasks 2/3). Verified by `deno check` if available, else by lint of the pure imports + review. The decision logic itself is already tested via `selfLinesAllowed`.

- [ ] **Step 1: Add the import** — in `supabase/functions/_shared/deviceGate.ts`, find where `accountStatus`/`isActive` are imported from `./accountStatus.js` and add `selfLinesAllowed` to that import list. If there is no such import, add:

```ts
import { selfLinesAllowed } from "./accountStatus.js";
```

- [ ] **Step 2: Add `loadSelfLinesAllowed`** — insert after the `loadAccountStatus` function (around line 158):

```ts
// Whether the caller may add their own IPTV lines in the app. Reads the flag
// off the caller's customer_accounts row; a missing row is the legacy/ungated
// case (allowed). A DB error throws SERVER_ERROR (retryable), never a denial.
export async function loadSelfLinesAllowed(
  admin: ReturnType<typeof adminClient>,
  userId: string,
): Promise<boolean> {
  const { data: acct, error } = await admin
    .from("customer_accounts")
    .select("allow_self_lines")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("SERVER_ERROR");
  return selfLinesAllowed(acct);
}
```

- [ ] **Step 3: Extend `entitlementSnapshot`** — replace the `entitlementSnapshot` function (lines 204-211) with:

```ts
export async function entitlementSnapshot(
  admin: ReturnType<typeof adminClient>,
  userId: string,
): Promise<{ entitled: boolean; reason: string; expires_at: string | null; allowSelfLines: boolean }> {
  const row = await loadEntitlement(admin, userId);
  const verdict = evaluateEntitlement(row, Date.now());
  const allowSelfLines = await loadSelfLinesAllowed(admin, userId);
  return { entitled: verdict.entitled, reason: verdict.reason, expires_at: row?.expires_at ?? null, allowSelfLines };
}
```

- [ ] **Step 4: Verify pure tests still pass + lint**

Run: `node --test supabase && npm run lint`
Expected: PASS / no new errors. (No behavioral test here; the tested seam is `selfLinesAllowed`.)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/deviceGate.ts
git commit -m "feat(data): loadSelfLinesAllowed + entitlementSnapshot exposes allowSelfLines"
```

---

### Task 5: Server — gate `data`/`iptv.insert` on the flag

**Files:**
- Modify: `supabase/functions/data/index.ts` (import + `iptv.insert` case)

**Interfaces:**
- Consumes: `loadSelfLinesAllowed` (Task 4).
- Produces: `iptv.insert` returns `{ error: "SELF_ADD_DISABLED" }` HTTP 403 when a `customer_accounts` row exists with `allow_self_lines=false`. No row / true → unchanged (insert + best-effort adoption).

> No unit test (Deno DB-I/O layer). The decision (`selfLinesAllowed`) is tested in Task 2. Verified by lint + manual (see Verification below).

- [ ] **Step 1: Add the import** — in `supabase/functions/data/index.ts`, add `loadSelfLinesAllowed` to the existing `from "../_shared/deviceGate.ts"` import block (after `entitlementSnapshot,`):

```ts
  entitlementSnapshot,
  loadSelfLinesAllowed,
```

- [ ] **Step 2: Add the gate** — in the `case "iptv.insert":` block, immediately after the existing `await assertOwnsProfile(admin, userId, payload.profileId);` line and BEFORE the `const { data } = await db("iptv_accounts").insert({...})`:

```ts
        // Per-customer self-add gate. A provider can lock a customer to the
        // lines they were given (allow_self_lines=false). No customer_accounts
        // row (legacy / pre-adoption self-signup) is allowed — the first
        // self-add is what triggers adoption below. Server-authoritative: the
        // app also hides the button, but a patched client hitting this path
        // still gets the 403.
        if (!(await loadSelfLinesAllowed(admin, userId))) {
          return json({ error: "SELF_ADD_DISABLED" }, 403);
        }
```

- [ ] **Step 3: Verify lint**

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 4: Manual verification note (record in the task report; requires deployed functions)**

After deploy: as a provider-created customer with `allow_self_lines=false`, calling `iptv.insert` (app "Add account") returns 403 `SELF_ADD_DISABLED`; after toggling the flag on in the dashboard it succeeds. A self-signup user with no `customer_accounts` row can still add their first line (and gets adopted with the flag true).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/data/index.ts
git commit -m "feat(data): gate iptv.insert on customer_accounts.allow_self_lines"
```

---

### Task 6: `admin` Edge Function — multi-line create/get, per-line CRUD, allowSelfLines

**Files:**
- Modify: `supabase/functions/admin/index.ts` (`accounts.create`, `accounts.get`, `accounts.update`, `accounts.updateLine`; add `accounts.addLine`, `accounts.deleteLine`)

**Interfaces:**
- Consumes: `validateNewAccount` (Task 3, now `value.lines`/`value.allowSelfLines`), existing `validateLine`, `canActOnAccount`, `accountProviderId`, `audit`.
- Produces (API contract consumed by Tasks 7–8):
  - `accounts.create` payload: `{ name, password, deviceLimit, expiresAt, email?, note?, lines: LinePayload[], allowSelfLines: boolean }`. (Still accepts legacy `line`.)
  - `accounts.get` response: adds `allowSelfLines: boolean` and returns `lines: Line[]` (each `{id,type,nickname,host,username,url}`) instead of `line`.
  - `accounts.update` payload: accepts `allowSelfLines?: boolean`.
  - `accounts.addLine` payload `{ userId, line }` → `{ ok: true }`.
  - `accounts.updateLine` payload `{ userId, lineId, line }` → `{ ok: true }` (targets a specific line; falls back to first line when `lineId` omitted, for safety).
  - `accounts.deleteLine` payload `{ userId, lineId }` → `{ ok: true }`.

> No unit test (Deno layer). Validation is covered by Task 3. Verified by lint + the dashboard build/tests (Tasks 7–8) exercising the payloads + manual.

- [ ] **Step 1: `accounts.create` — insert all lines + allow_self_lines.** In `accounts.create` (around lines 227-238), replace the single "4. iptv line under that profile" insert with a loop over `v.value.lines`:

```ts
          // 4. iptv line(s) under that profile
          for (const ln of v.value.lines) {
            const { error: lineErr } = await admin.from("iptv_accounts").insert({
              user_id: newId,
              profile_id: prof.id,
              type: ln.type,
              nickname: ln.nickname,
              host: ln.host,
              username: ln.username,
              password: ln.password,
              url: ln.url,
            });
            if (lineErr) throw lineErr;
          }
```

Then in the "6. subscription record" `customer_accounts` insert (around lines 246-252), add `allow_self_lines`:

```ts
          const { error: caErr } = await admin.from("customer_accounts").insert({
            user_id: newId,
            origin: "provider",
            provider_id: userId,
            expires_at: v.value.expiresAt,
            note: payload.note ? String(payload.note) : null,
            allow_self_lines: v.value.allowSelfLines,
          });
```

And update the audit meta (lines 266-271) `lineType: v.value.line.type` → `lineCount: v.value.lines.length`:

```ts
        await audit(admin, userId, "account.create", newId, {
          name: v.value.name,
          deviceLimit: v.value.deviceLimit,
          expiresAt: v.value.expiresAt,
          lineCount: v.value.lines.length,
          allowSelfLines: v.value.allowSelfLines,
        });
```

- [ ] **Step 2: `accounts.get` — return all lines + allowSelfLines.** Replace the acct select (line 353) to include the column and the single-`line` query (lines 357-360) + the returned object (lines 362-372):

```ts
        const { data: acct } = await admin
          .from("customer_accounts")
          .select("provider_id, expires_at, suspended, note, origin, allow_self_lines")
          .eq("user_id", target).maybeSingle();
        const { data: lim } = await admin
          .from("device_limits").select("device_limit").eq("user_id", target).maybeSingle();
        const { data: lines } = await admin
          .from("iptv_accounts")
          .select("id, type, nickname, host, username, url")
          .eq("user_id", target).order("created_at", { ascending: true });
        const status = await loadAccountStatus(admin, target);
        return json({
          userId: target,
          name: prof?.name ?? "",
          email: prof?.email ?? "",
          status,
          expiresAt: acct?.expires_at ?? null,
          suspended: acct?.suspended ?? false,
          note: acct?.note ?? null,
          deviceLimit: lim?.device_limit ?? null,
          allowSelfLines: acct?.allow_self_lines ?? false,
          lines: lines ?? [], // passwords intentionally omitted from reads
        });
```

- [ ] **Step 3: `accounts.update` — accept allowSelfLines.** In `accounts.update`, after the `suspended` handling (line 391), add:

```ts
        if (payload.allowSelfLines !== undefined) acctPatch.allow_self_lines = payload.allowSelfLines === true;
```

- [ ] **Step 4: `accounts.updateLine` — target a specific line id.** Replace the body (lines 435-447) so a provided `lineId` updates that row; keep the first-line fallback when omitted:

```ts
        const fields = {
          type: line.value.type, nickname: line.value.nickname, host: line.value.host,
          username: line.value.username, password: line.value.password, url: line.value.url,
        };
        const lineId = String(payload.lineId ?? "");
        if (lineId) {
          const { error: uErr } = await admin.from("iptv_accounts").update(fields).eq("id", lineId).eq("user_id", target);
          if (uErr) return json({ error: "SERVER_ERROR" }, 500);
        } else {
          const { data: existing } = await admin
            .from("iptv_accounts").select("id").eq("user_id", target)
            .order("created_at", { ascending: true }).limit(1).maybeSingle();
          if (existing?.id) {
            await admin.from("iptv_accounts").update(fields).eq("id", existing.id).eq("user_id", target);
          } else {
            const { data: prof } = await admin.from("app_profiles").select("id").eq("user_id", target).limit(1).maybeSingle();
            await admin.from("iptv_accounts").insert({ user_id: target, profile_id: prof?.id ?? null, ...fields });
          }
        }
```

- [ ] **Step 5: Add `accounts.addLine` and `accounts.deleteLine`.** Insert two new cases after `accounts.updateLine` (after line 450):

```ts
      case "accounts.addLine": {
        const target = String(payload.userId ?? "");
        const owner = await accountProviderId(admin, target);
        if (owner === undefined || !canActOnAccount(caller, owner)) return json({ error: "FORBIDDEN" }, 403);
        const line = validateLine(payload.line);
        if (!line.ok) return json({ error: "INVALID_INPUT", fields: ["line"] }, 400);
        const { data: prof } = await admin.from("app_profiles").select("id").eq("user_id", target).limit(1).maybeSingle();
        const { error: insErr } = await admin.from("iptv_accounts").insert({
          user_id: target, profile_id: prof?.id ?? null,
          type: line.value.type, nickname: line.value.nickname, host: line.value.host,
          username: line.value.username, password: line.value.password, url: line.value.url,
        });
        if (insErr) return json({ error: "SERVER_ERROR" }, 500);
        await audit(admin, userId, "account.addLine", target, { lineType: line.value.type }); // no creds
        return json({ ok: true });
      }

      case "accounts.deleteLine": {
        const target = String(payload.userId ?? "");
        const owner = await accountProviderId(admin, target);
        if (owner === undefined || !canActOnAccount(caller, owner)) return json({ error: "FORBIDDEN" }, 403);
        const lineId = String(payload.lineId ?? "");
        if (!lineId) return json({ error: "INVALID_INPUT", fields: ["lineId"] }, 400);
        const { error: delErr } = await admin.from("iptv_accounts").delete().eq("id", lineId).eq("user_id", target);
        if (delErr) return json({ error: "SERVER_ERROR" }, 500);
        await audit(admin, userId, "account.deleteLine", target, null);
        return json({ ok: true });
      }
```

- [ ] **Step 6: Verify lint**

Run: `npm run lint`
Expected: no new errors. (Deno layer has no unit tests here; the shape is exercised by Tasks 7–8.)

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/admin/index.ts
git commit -m "feat(admin): multi-line create/get, per-line add/update/delete, allowSelfLines"
```

---

### Task 7: Dashboard pure — `buildLinesPayload`

**Files:**
- Modify: `dashboard/src/lib/linePayload.ts`
- Test: `dashboard/src/lib/linePayload.test.ts`

**Interfaces:**
- Consumes: existing `buildLinePayload`, `LineType`, `LineFormFields`, `LinePayload`.
- Produces: `LineForm = { type: LineType } & LineFormFields`; `buildLinesPayload(forms: LineForm[]) -> LinePayload[]`. Consumed by Task 9 (CreateAccount) and Task 8 (AccountDetail add/edit).

- [ ] **Step 1: Write the failing test** — append to `dashboard/src/lib/linePayload.test.ts`:

```ts
import { buildLinesPayload, type LineForm } from "./linePayload";

describe("buildLinesPayload", () => {
  it("maps each form to its payload", () => {
    const forms: LineForm[] = [
      { type: "xtream", host: "h:8080", lineUsername: "u", linePassword: "p", url: "", nickname: "A" },
      { type: "m3u", host: "", lineUsername: "", linePassword: "", url: "http://x/get.php", nickname: "" },
    ];
    const out = buildLinesPayload(forms);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ type: "xtream", host: "h:8080", username: "u", password: "p", nickname: "A" });
    expect(out[1]).toMatchObject({ type: "m3u", url: "http://x/get.php", host: null });
  });

  it("returns an empty array for no forms", () => {
    expect(buildLinesPayload([])).toEqual([]);
  });
});
```

> If `linePayload.test.ts` uses `import { describe, it, expect } from "vitest"`, keep that import; add only the new `buildLinesPayload`/`LineForm` import and describe block.

- [ ] **Step 2: Run to verify it fails**

Run (from `dashboard/`): `npm test -- linePayload`
Expected: FAIL — `buildLinesPayload` not exported.

- [ ] **Step 3: Implement** — append to `dashboard/src/lib/linePayload.ts`:

```ts
// One line's full form state (type + the raw fields). Used by the multi-line
// editors in CreateAccount and AccountDetail.
export type LineForm = { type: LineType } & LineFormFields;

export function buildLinesPayload(forms: LineForm[]): LinePayload[] {
  return forms.map((f) => buildLinePayload(f.type, f));
}
```

- [ ] **Step 4: Run to verify it passes**

Run (from `dashboard/`): `npm test -- linePayload`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/lib/linePayload.ts dashboard/src/lib/linePayload.test.ts
git commit -m "feat(dashboard): buildLinesPayload for multi-line forms"
```

---

### Task 8: Dashboard AccountDetail — lines list (add/edit/delete) + self-add toggle

**Files:**
- Modify: `dashboard/src/screens/AccountDetail.tsx`

**Interfaces:**
- Consumes: `accounts.get` (`lines[]`, `allowSelfLines` — Task 6), `accounts.addLine`, `accounts.updateLine` (with `lineId`), `accounts.deleteLine`, `accounts.update` (`allowSelfLines`); `buildLinePayload`, `lineUpdateBlockedReason`.

> No render test (dashboard has no jsdom). Verified by `npm run build` (typecheck) + `npm test` (pure) + manual.

- [ ] **Step 1: Update the data types.** Replace the `AccountDetailData` type (lines 17-27) — drop `line`, add `lines` + `allowSelfLines`:

```ts
type AccountDetailData = {
  userId: string;
  name: string;
  email: string;
  status: string;
  expiresAt: string | null;
  suspended: boolean;
  note: string | null;
  deviceLimit: number | null;
  allowSelfLines: boolean;
  lines: Line[];
};
```

- [ ] **Step 2: Add the self-add toggle to `SubscriptionCard`.** Add a saving-state and a row. Inside `SubscriptionCard`, add near the other `useState`s:

```ts
  const [savingSelfAdd, setSavingSelfAdd] = useState(false);
```

and add this row just before the closing `</section>` of `SubscriptionCard` (after the Note row):

```tsx
      <div className="card-row">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={data.allowSelfLines}
            disabled={savingSelfAdd}
            onChange={() => run(setSavingSelfAdd, { allowSelfLines: !data.allowSelfLines })}
          />
          Allow this customer to add their own IPTV lines in the app
        </label>
      </div>
```

- [ ] **Step 3: Replace `LineCard` with `LinesCard`.** Replace the entire `LineCard` function (lines 385-475) with a list + reusable editor. Also update the call site in the top-level component (line 106) from `<LineCard .../>` to `<LinesCard .../>`:

```tsx
function LinesCard({
  data,
  userId,
  onSaved,
}: {
  data: AccountDetailData;
  userId: string;
  onSaved: () => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Line | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmRemove() {
    if (!removing) return;
    setBusy(true);
    setError(null);
    try {
      await call("accounts.deleteLine", { userId, lineId: removing.id });
      setRemoving(null);
      await onSaved();
    } catch (e) {
      setError(apiErrorMessage((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>IPTV lines</h2>
      {error && <p className="field-error">{error}</p>}

      {data.lines.length === 0 && <p>No lines yet.</p>}
      {data.lines.map((ln) =>
        editingId === ln.id ? (
          <LineEditor
            key={ln.id}
            line={ln}
            onCancel={() => setEditingId(null)}
            onSubmit={async (payload) => {
              await call("accounts.updateLine", { userId, lineId: ln.id, line: payload });
              setEditingId(null);
              await onSaved();
            }}
          />
        ) : (
          <div className="card-row" key={ln.id}>
            <div style={{ flex: 1 }}>
              <strong>{ln.nickname || ln.host || ln.url || ln.type}</strong>{" "}
              <span className="muted">
                {ln.type === "m3u" ? ln.url : `${ln.username ?? ""}@${ln.host ?? ""}`}
              </span>
            </div>
            <Button variant="secondary" onClick={() => { setAdding(false); setEditingId(ln.id); }}>Edit</Button>
            <Button variant="danger" disabled={busy} onClick={() => setRemoving(ln)}>Delete</Button>
          </div>
        ),
      )}

      {adding ? (
        <LineEditor
          onCancel={() => setAdding(false)}
          onSubmit={async (payload) => {
            await call("accounts.addLine", { userId, line: payload });
            setAdding(false);
            await onSaved();
          }}
        />
      ) : (
        <Button onClick={() => { setEditingId(null); setAdding(true); }}>Add line</Button>
      )}

      {removing && (
        <Modal title="Delete line" onClose={() => setRemoving(null)}>
          <p>
            Delete line <strong>{removing.nickname || removing.host || removing.url}</strong>? This can't be undone.
          </p>
          <div className="btn-row">
            <Button variant="danger" disabled={busy} onClick={confirmRemove}>
              {busy ? "Deleting…" : "Delete line"}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setRemoving(null)}>Cancel</Button>
          </div>
        </Modal>
      )}
    </section>
  );
}

// Add/edit a single line. For an existing xtream line the password must be
// re-entered to save (the server never returns it) — same rule as before,
// enforced via lineUpdateBlockedReason.
function LineEditor({
  line,
  onSubmit,
  onCancel,
}: {
  line?: Line;
  onSubmit: (payload: ReturnType<typeof buildLinePayload>) => Promise<void>;
  onCancel: () => void;
}) {
  const [lineType, setLineType] = useState<LineType>(line?.type ?? "xtream");
  const [host, setHost] = useState(line?.host ?? "");
  const [lineUsername, setLineUsername] = useState(line?.username ?? "");
  const [linePassword, setLinePassword] = useState("");
  const [url, setUrl] = useState(line?.url ?? "");
  const [nickname, setNickname] = useState(line?.nickname ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Adding a brand-new line requires a password (no existing secret to keep);
  // editing an xtream line also requires re-entry. Both reduce to "xtream needs
  // a password in the box".
  const blockedReason = lineUpdateBlockedReason(lineType, linePassword);

  async function handleSave() {
    if (blockedReason) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(buildLinePayload(lineType, { host, lineUsername, linePassword, url, nickname }));
    } catch (e) {
      setError(apiErrorMessage((e as Error).message));
    } finally {
      setSaving(false);
    }
  }

  return (
    <fieldset className="field-group">
      <legend>{line ? "Edit line" : "New line"}</legend>
      {error && <p className="field-error">{error}</p>}
      <div className="btn-row">
        <Button type="button" variant={lineType === "xtream" ? "primary" : "secondary"} onClick={() => setLineType("xtream")}>Xtream</Button>
        <Button type="button" variant={lineType === "m3u" ? "primary" : "secondary"} onClick={() => setLineType("m3u")}>M3U</Button>
      </div>
      {lineType === "xtream" ? (
        <>
          <Field label="Host"><input value={host} onChange={(e) => setHost(e.target.value)} /></Field>
          <Field label="Line username"><input value={lineUsername} onChange={(e) => setLineUsername(e.target.value)} /></Field>
          <Field label="Line password" error={blockedReason ?? undefined}>
            <input type="password" value={linePassword} onChange={(e) => setLinePassword(e.target.value)} placeholder={line ? "Re-enter to change" : ""} />
          </Field>
        </>
      ) : (
        <Field label="Playlist URL"><input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></Field>
      )}
      <Field label="Nickname (optional)"><input value={nickname} onChange={(e) => setNickname(e.target.value)} /></Field>
      <div className="btn-row">
        <Button disabled={saving || !!blockedReason} onClick={handleSave}>{saving ? "Saving…" : "Save line"}</Button>
        <Button variant="secondary" disabled={saving} onClick={onCancel}>Cancel</Button>
      </div>
    </fieldset>
  );
}
```

- [ ] **Step 4: Verify build + tests + lint**

Run (from `dashboard/`): `npm run build && npm test`
Expected: typecheck passes; vitest passes. Fix any type errors (e.g. a lingering `data.line` reference).

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/screens/AccountDetail.tsx
git commit -m "feat(dashboard): manage multiple lines + self-add toggle on account detail"
```

---

### Task 9: Dashboard CreateAccount — multi-line editor + self-add toggle

**Files:**
- Modify: `dashboard/src/screens/CreateAccount.tsx`

**Interfaces:**
- Consumes: `buildLinesPayload` + `LineForm` (Task 7); `accounts.create` payload with `lines[]` + `allowSelfLines` (Task 6).

> No render test. Verified by `npm run build` + manual.

- [ ] **Step 1: Replace single-line state with an array + toggle.** Remove the six single-line `useState`s (lines 30-35: `lineType,host,lineUsername,linePassword,url,nickname`) and add:

```ts
  const emptyLine = (): LineForm => ({ type: "xtream", host: "", lineUsername: "", linePassword: "", url: "", nickname: "" });
  const [lines, setLines] = useState<LineForm[]>([emptyLine()]);
  const [allowSelfLines, setAllowSelfLines] = useState(false);

  function updateLine(i: number, patch: Partial<LineForm>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function addLine() { setLines((prev) => [...prev, emptyLine()]); }
  function removeLine(i: number) { setLines((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev)); }
```

Update the import on line 5 to add `buildLinesPayload` and `LineForm`:

```ts
import { buildLinesPayload, type LineForm, type LineType } from "../lib/linePayload";
```

- [ ] **Step 2: Update `handleSubmit` payload.** Replace the `const line = buildLinePayload(...)` line and the `payload` object (lines 52-61) with:

```ts
      const payload = {
        name: name.trim(),
        password,
        deviceLimit: Number(deviceLimit),
        expiresAt,
        note: note.trim() || undefined,
        email: email.trim() || undefined,
        lines: buildLinesPayload(lines),
        allowSelfLines,
      };
```

- [ ] **Step 3: Replace the single IPTV-line `<fieldset>` with a repeatable editor + the toggle.** Replace the `IPTV line` fieldset (lines 160-214) with:

```tsx
        <div className="card-row">
          <label className="checkbox-row">
            <input type="checkbox" checked={allowSelfLines} onChange={(e) => setAllowSelfLines(e.target.checked)} />
            Allow this customer to add their own IPTV lines in the app
          </label>
        </div>

        {lines.map((ln, i) => (
          <fieldset className="field-group" key={i}>
            <legend>
              IPTV line {i + 1}
              {lineInvalid && <span className="field-error"> — check the fields below</span>}
            </legend>
            <div className="btn-row">
              <Button type="button" variant={ln.type === "xtream" ? "primary" : "secondary"} onClick={() => updateLine(i, { type: "xtream" })}>Xtream</Button>
              <Button type="button" variant={ln.type === "m3u" ? "primary" : "secondary"} onClick={() => updateLine(i, { type: "m3u" })}>M3U</Button>
              {lines.length > 1 && (
                <Button type="button" variant="danger" onClick={() => removeLine(i)}>Remove line</Button>
              )}
            </div>
            {ln.type === "xtream" ? (
              <>
                <Field label="Host"><input value={ln.host} onChange={(e) => updateLine(i, { host: e.target.value })} required /></Field>
                <Field label="Line username"><input value={ln.lineUsername} onChange={(e) => updateLine(i, { lineUsername: e.target.value })} required /></Field>
                <Field label="Line password"><input type="password" value={ln.linePassword} onChange={(e) => updateLine(i, { linePassword: e.target.value })} required /></Field>
              </>
            ) : (
              <Field label="Playlist URL"><input type="url" value={ln.url} onChange={(e) => updateLine(i, { url: e.target.value })} placeholder="https://…" required /></Field>
            )}
            <Field label="Nickname (optional)"><input value={ln.nickname} onChange={(e) => updateLine(i, { nickname: e.target.value })} /></Field>
          </fieldset>
        ))}
        <Button type="button" variant="secondary" onClick={addLine}>Add another line</Button>
```

> The `lineInvalid` const (line 73) stays; the server returns `fields:["lines"]` on validation failure, so update line 73 to `const lineInvalid = invalidFields.includes("lines");`.

- [ ] **Step 4: Verify build + lint**

Run (from `dashboard/`): `npm run build`
Expected: typecheck passes. Remove any now-unused imports (`buildLinePayload` if no longer referenced) to keep lint clean.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/screens/CreateAccount.tsx
git commit -m "feat(dashboard): multi-line create form + self-add toggle"
```

---

### Task 10: App — fetch the flag and hide "Add account" when not allowed

**Files:**
- Modify: `src/services/supabase.js` (add `fetchEntitlement`)
- Modify: `src/context/AppContext.jsx` (fetch + expose `allowSelfLines`)
- Modify: `src/screens/AccountsScreen.jsx` (gate the button + empty-state CTA)

**Interfaces:**
- Consumes: `entitlement.fetch` response `{ entitled, reason, expires_at, allowSelfLines }` (Task 4).
- Produces: `allowSelfLines` on the app context (default `true`; only `false` hides the UI).

> No render test (app has no renderer). The default-true / only-false-hides rule keeps a missing field from ever hiding the button on older servers. Verified by `npm run lint` + manual.

- [ ] **Step 1: Add `fetchEntitlement`** — append to the IPTV/entitlement area of `src/services/supabase.js` (near the other `invokeData` wrappers):

```js
export async function fetchEntitlement() {
  return invokeData("entitlement.fetch", {});
}
```

- [ ] **Step 2: Wire it into AppContext.** In `src/context/AppContext.jsx`:

Add `fetchEntitlement` to the import from `../services/supabase` (the block near line 10 that already imports `fetchProfile`, `insertIptvAccount`, etc.).

Add state near the other auth state (around line 56):

```js
  // UX mirror of the server's per-customer self-add gate. Default true so a
  // missing field (older server) never hides the button; only an explicit
  // false hides it. The server (data/iptv.insert) is authoritative.
  const [allowSelfLines, setAllowSelfLines] = useState(true);
```

In the post-device profile-fetch effect (lines 470-478), add the entitlement fetch:

```js
    fetchProfile(authUser.id).then((p) => { if (p) setProfile(p); }).catch(() => {});
    fetchAppProfiles(authUser.id).then(setAppProfiles).catch(() => {});
    fetchEntitlement().then((e) => setAllowSelfLines(e?.allowSelfLines !== false)).catch(() => {});
```

Reset it on sign-out — in the sign-out reset (line 149, alongside `setProfile(null)`), add `setAllowSelfLines(true);`.

Expose it on the context `value` (lines 594-616): add `allowSelfLines,` to the returned object and `allowSelfLines` to the `useMemo` dependency array.

- [ ] **Step 3: Gate the UI in AccountsScreen.** In `src/screens/AccountsScreen.jsx`:

Add `allowSelfLines` to the `useApp()` destructure (line 47).

Wrap the "Add account" button block (lines 255-259) so it only renders when allowed:

```jsx
      {allowSelfLines && (
        <YStack margin={ss(16)}>
          <Button variant="primary" icon="plus" disabled={loading} onPress={handleAddNew}>
            Add account
          </Button>
        </YStack>
      )}
```

For the empty state (lines 269-277), drop the CTA when not allowed so a locked customer isn't invited to add one:

```jsx
      {users.length === 0 ? (
        <StatePanel
          mode="empty"
          icon="tv"
          title="No accounts"
          message={allowSelfLines
            ? 'Tap "Add account" to add your first media service'
            : "Your provider manages your subscription. Contact them to add a service."}
          cta={allowSelfLines ? handleAddNew : undefined}
          ctaLabel={allowSelfLines ? "Add account" : undefined}
        />
      ) : (
```

- [ ] **Step 4: Verify lint + full app test suite**

Run: `npm run lint && npm test`
Expected: no lint errors; all tests pass (no test targets these UI files directly).

- [ ] **Step 5: Commit**

```bash
git add src/services/supabase.js src/context/AppContext.jsx src/screens/AccountsScreen.jsx
git commit -m "feat(app): hide Add account when provider disallows self-add"
```

---

### Task 11: Full verification sweep + deploy notes

**Files:** none (verification only).

- [ ] **Step 1: Run every suite.**

Run: `npm test && npm run lint`
Run (from `dashboard/`): `npm test && npm run build`
Expected: all green (eslint warnings OK, no errors).

- [ ] **Step 2: Record the owner deploy order** in the task report (do NOT run these — owner action):

```
1. supabase db push        # applies 20260718000006 (column + backfill + adopt fn)
2. redeploy Edge Functions: admin, data
3. dashboard: npm run build && host the new bundle
4. ship the RN/Expo client
```

- [ ] **Step 3: Manual smoke (post-deploy, record results):**
  - Dashboard → Create account with 2 lines + toggle OFF → account detail shows both lines; app for that customer shows both, "Add account" hidden; direct `iptv.insert` → 403.
  - Toggle ON in detail → app shows "Add account"; customer self-add succeeds; the added line appears in the dashboard lines list.
  - Add / edit / delete a line from account detail → reflected in the app after its next `iptv.list`.
  - A self-signup customer (no prior `customer_accounts` row) adds a first line → adopted, `allow_self_lines=true`, can add more.

---

## Self-Review

**Spec coverage:**
- Data model column + backfill + adopt-fn true → Task 1. ✔
- `accounts.create` multi-line + `allowSelfLines` → Task 3 (validation) + Task 6. ✔
- `accounts.get` returns `lines[]` + `allowSelfLines` → Task 6. ✔
- `addLine`/`updateLine(id)`/`deleteLine` → Task 6. ✔
- CreateAccount multi-line + toggle → Tasks 7, 9. ✔
- AccountDetail lines list + toggle → Task 8. ✔
- Server gate on `iptv.insert` → Tasks 2, 4, 5. ✔
- Client mirror (`entitlement.fetch` + hide button) → Tasks 4, 10. ✔
- Quota unchanged (per-customer): no task touches quota — correct, nothing to change. ✔
- Testing approach (pure seams; no renderer) → reflected across tasks. ✔
- Deploy order → Task 11. ✔

**Placeholder scan:** No TBD/TODO; every code step has concrete code; manual-verification steps are explicitly labeled as post-deploy record-only because the repo cannot run the Deno/DB layer in tests.

**Type consistency:** `value.lines` (Task 3) consumed as `v.value.lines` (Task 6); `LineForm`/`buildLinesPayload` defined in Task 7 and used in Tasks 8/9; `accounts.get` `lines[]`/`allowSelfLines` (Task 6) consumed by `AccountDetailData` (Task 8); `loadSelfLinesAllowed` (Task 4) consumed in Task 5; `fetchEntitlement`→`allowSelfLines` (Task 4/10). `updateLine` uses `lineId` consistently in Task 6 (handler) and Task 8 (caller). Consistent.
