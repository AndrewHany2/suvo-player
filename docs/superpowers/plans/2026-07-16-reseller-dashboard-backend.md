# Reseller Dashboard — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Supabase backend for a multi-provider reseller system — new tables (`providers`, `customer_accounts`, `admin_audit`), server-authoritative expiry/suspend gates in the existing Edge Functions, and one new `admin` Edge Function that lets a super-admin manage providers and lets each provider manage only their own customer accounts (create with full IPTV-line provisioning, set device count + expiry, suspend, and revoke devices).

**Architecture:** Mirrors the existing Edge Function pattern ([data/index.ts](../../../supabase/functions/data/index.ts)): the `admin` function verifies the caller's JWT, loads their `providers` row, enforces role/scope/quota via **pure, unit-tested logic modules**, then performs every write with the `service_role` client. RLS stays fully closed on all new tables (`anon`/`authenticated` revoked). Provider isolation lives in code, in one place.

**Tech Stack:** Supabase (Postgres 17 + GoTrue auth + Deno Edge Functions), plain `.js` shared logic modules tested with `node:test`.

## Global Constraints

- Node ≥ 20 (`.nvmrc`); tests via `npm test` = `node --test src scripts supabase electron`.
- Shared logic files under `supabase/functions/_shared/` MUST be plain `.js` with **no imports and no I/O** so they run under BOTH the Deno edge runtime and `node:test` (see [authz.js](../../../supabase/functions/_shared/authz.js) / [loginLogic.js](../../../supabase/functions/_shared/loginLogic.js)).
- Tests use `node:test` + `node:assert/strict`, `describe`/`test` style. NO Jest.
- All new tables: `enable row level security` + `revoke all … from anon, authenticated`. Reachable only via `service_role` Edge Functions. This matches the 2026-07-16 hardening — do not add `anon`/`authenticated` policies.
- Migrations are additive & idempotent (`create table if not exists`, guarded `do $$ … $$`), same style as [device_revoke.sql](../../../supabase/migrations/20260715000001_device_revoke.sql).
- `admin_audit.meta` must NEVER contain passwords or IPTV-line credentials.
- Edge Functions default to `verify_jwt = true` (config.toml). The `admin` function keeps that default (authenticated callers only) — no config entry needed. Only `login`'s gate change runs pre-auth.
- `minimum_password_length = 6` (config.toml) — validation must match.
- Before committing: `npm test` and `npm run lint` (eslint) must pass.

---

## File Structure

**Create:**
- `supabase/functions/_shared/accountStatus.js` — pure account active/expired/suspended decision.
- `supabase/functions/_shared/accountStatus.test.js` — its tests.
- `supabase/functions/_shared/adminLogic.js` — pure role/scope/quota/validation decisions.
- `supabase/functions/_shared/adminLogic.test.js` — its tests.
- `supabase/functions/admin/index.ts` — the admin action router (I/O only).
- `supabase/migrations/20260716000002_providers.sql`
- `supabase/migrations/20260716000003_customer_accounts.sql`
- `supabase/migrations/20260716000004_admin_audit.sql`

**Modify:**
- `supabase/functions/_shared/deviceGate.ts` — add `loadAccountStatus()` + `assertAccountActive()`.
- `supabase/functions/data/index.ts` — call the status gate; map inactive → 403.
- `supabase/functions/claim-device/index.ts` — deny inactive accounts.
- `supabase/functions/login/index.ts` — block inactive accounts after the password check.
- `supabase/README.md` — replace SQL runbook with "use the dashboard"; add super-admin bootstrap snippet.

---

## Task 1: `accountStatus.js` — pure status decision (TDD)

**Files:**
- Create: `supabase/functions/_shared/accountStatus.js`
- Test: `supabase/functions/_shared/accountStatus.test.js`

**Interfaces:**
- Produces:
  - `ACCOUNT_ACTIVE`, `ACCOUNT_SUSPENDED`, `ACCOUNT_EXPIRED`, `PROVIDER_SUSPENDED` (string constants).
  - `accountStatus(account, providerSuspended, nowMs) → string` — `account` is `{ suspended:boolean, expires_at:string|null }` or `null`; returns one of the constants.
  - `isActive(status) → boolean`.

- [ ] **Step 1: Write the failing test**

```js
// supabase/functions/_shared/accountStatus.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  accountStatus,
  isActive,
  ACCOUNT_ACTIVE,
  ACCOUNT_SUSPENDED,
  ACCOUNT_EXPIRED,
  PROVIDER_SUSPENDED,
} from "./accountStatus.js";

const NOW = Date.parse("2026-07-16T12:00:00Z");
const FUTURE = "2026-08-16T12:00:00Z";
const PAST = "2026-06-16T12:00:00Z";

describe("accountStatus", () => {
  test("no customer_accounts row => ACTIVE (unmanaged account, not gated)", () => {
    assert.equal(accountStatus(null, false, NOW), ACCOUNT_ACTIVE);
  });

  test("row with no expiry, not suspended, provider active => ACTIVE", () => {
    assert.equal(
      accountStatus({ suspended: false, expires_at: null }, false, NOW),
      ACCOUNT_ACTIVE,
    );
  });

  test("future expiry => ACTIVE", () => {
    assert.equal(
      accountStatus({ suspended: false, expires_at: FUTURE }, false, NOW),
      ACCOUNT_ACTIVE,
    );
  });

  test("account suspended => ACCOUNT_SUSPENDED (outranks expiry)", () => {
    assert.equal(
      accountStatus({ suspended: true, expires_at: PAST }, false, NOW),
      ACCOUNT_SUSPENDED,
    );
  });

  test("provider suspended => PROVIDER_SUSPENDED", () => {
    assert.equal(
      accountStatus({ suspended: false, expires_at: FUTURE }, true, NOW),
      PROVIDER_SUSPENDED,
    );
  });

  test("past expiry => ACCOUNT_EXPIRED", () => {
    assert.equal(
      accountStatus({ suspended: false, expires_at: PAST }, false, NOW),
      ACCOUNT_EXPIRED,
    );
  });

  test("malformed expires_at is ignored => ACTIVE", () => {
    assert.equal(
      accountStatus({ suspended: false, expires_at: "not-a-date" }, false, NOW),
      ACCOUNT_ACTIVE,
    );
  });

  test("isActive true only for ACTIVE", () => {
    assert.equal(isActive(ACCOUNT_ACTIVE), true);
    assert.equal(isActive(ACCOUNT_EXPIRED), false);
    assert.equal(isActive(ACCOUNT_SUSPENDED), false);
    assert.equal(isActive(PROVIDER_SUSPENDED), false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test supabase/functions/_shared/accountStatus.test.js`
Expected: FAIL — cannot find module `./accountStatus.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// supabase/functions/_shared/accountStatus.js
// Pure account-status decision for the reseller gates. No I/O and no imports, so
// it runs under BOTH the Deno edge runtime and node:test.

export const ACCOUNT_ACTIVE = "ACTIVE";
export const ACCOUNT_SUSPENDED = "ACCOUNT_SUSPENDED";
export const ACCOUNT_EXPIRED = "ACCOUNT_EXPIRED";
export const PROVIDER_SUSPENDED = "PROVIDER_SUSPENDED";

/**
 * Decide a customer account's status. Priority: account-suspended >
 * provider-suspended > expired > active. A null account (no customer_accounts
 * row — e.g. a legacy/self/provider login) is NOT gated here => ACTIVE.
 *
 * @param {{suspended:boolean, expires_at:string|null}|null} account
 * @param {boolean} providerSuspended - owning provider's suspended flag
 * @param {number} nowMs - server epoch ms (Date.now())
 * @returns {string} one of the ACCOUNT_* / PROVIDER_* constants
 */
export function accountStatus(account, providerSuspended, nowMs) {
  if (!account) return ACCOUNT_ACTIVE;
  if (account.suspended) return ACCOUNT_SUSPENDED;
  if (providerSuspended) return PROVIDER_SUSPENDED;
  if (account.expires_at != null) {
    const exp = Date.parse(account.expires_at);
    if (Number.isFinite(exp) && exp < nowMs) return ACCOUNT_EXPIRED;
  }
  return ACCOUNT_ACTIVE;
}

export function isActive(status) {
  return status === ACCOUNT_ACTIVE;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test supabase/functions/_shared/accountStatus.test.js`
Expected: PASS — 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/accountStatus.js supabase/functions/_shared/accountStatus.test.js
git commit -m "feat(backend): pure account-status decision for reseller gates"
```

---

## Task 2: `adminLogic.js` — pure role/scope/quota/validation (TDD)

**Files:**
- Create: `supabase/functions/_shared/adminLogic.js`
- Test: `supabase/functions/_shared/adminLogic.test.js`

**Interfaces:**
- Produces:
  - `ROLE_SUPER_ADMIN`, `ROLE_PROVIDER` (constants).
  - `canInvoke(caller, action) → boolean` — `caller` is `{ userId, role, suspended }` or `null`.
  - `canActOnAccount(caller, targetProviderId) → boolean`.
  - `withinQuota(used, max, role) → boolean`.
  - `validateLine(line) → { ok, value }` — `value` = `{ type, host, username, password, url, nickname }`.
  - `validateNewAccount(input) → { ok, errors, value }` — `value` = `{ username, password, deviceLimit, expiresAt, line }`.
  - `providerSlug(name, userId) → string`.
  - `resolveEmail(username, providerSlug, email) → string`.

- [ ] **Step 1: Write the failing test**

```js
// supabase/functions/_shared/adminLogic.test.js
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
    username: "Customer_01",
    password: "secret1",
    deviceLimit: 2,
    expiresAt: "2026-12-31T00:00:00Z",
    line: { type: "xtream", host: "http://h", username: "u", password: "p" },
  };
  test("accepts + normalizes a good input (username lowercased)", () => {
    const r = validateNewAccount(good);
    assert.equal(r.ok, true);
    assert.equal(r.value.username, "customer_01");
    assert.equal(r.value.deviceLimit, 2);
    assert.equal(typeof r.value.expiresAt, "string");
  });
  test("rejects short password", () => {
    const r = validateNewAccount({ ...good, password: "123" });
    assert.equal(r.ok, false);
    assert.ok(r.errors.includes("password"));
  });
  test("rejects deviceLimit < 1", () => {
    const r = validateNewAccount({ ...good, deviceLimit: 0 });
    assert.ok(r.errors.includes("deviceLimit"));
  });
  test("rejects bad username", () => {
    const r = validateNewAccount({ ...good, username: "ab" });
    assert.ok(r.errors.includes("username"));
  });
  test("rejects invalid line", () => {
    const r = validateNewAccount({ ...good, line: { type: "m3u", url: "x" } });
    assert.ok(r.errors.includes("line"));
  });
  test("null/empty expiresAt allowed (=> null)", () => {
    const r = validateNewAccount({ ...good, expiresAt: "" });
    assert.equal(r.ok, true);
    assert.equal(r.value.expiresAt, null);
  });
});

describe("providerSlug + resolveEmail", () => {
  test("slug from name", () => {
    assert.equal(providerSlug("Acme TV!", "abc1234567"), "acme-tv");
  });
  test("slug falls back to id when name empty", () => {
    assert.equal(providerSlug("", "abcd1234ef"), "abcd1234");
  });
  test("real email used verbatim (lowercased)", () => {
    assert.equal(resolveEmail("bob", "acme", "Bob@Mail.com"), "bob@mail.com");
  });
  test("username-only builds synthetic email", () => {
    assert.equal(resolveEmail("bob", "acme", ""), "bob@acme.accounts.local");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test supabase/functions/_shared/adminLogic.test.js`
Expected: FAIL — cannot find module `./adminLogic.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// supabase/functions/_shared/adminLogic.js
// Pure authorization + validation decisions for the `admin` Edge Function. No
// I/O and no imports, so it runs under BOTH the Deno edge runtime and node:test.

export const ROLE_SUPER_ADMIN = "super_admin";
export const ROLE_PROVIDER = "provider";

// Actions only a super-admin may call.
const SUPER_ADMIN_ACTIONS = new Set([
  "providers.list",
  "providers.create",
  "providers.update",
  "providers.delete",
]);

// caller: { userId, role, suspended } | null
export function canInvoke(caller, action) {
  if (!caller || caller.suspended) return false;
  if (caller.role === ROLE_SUPER_ADMIN) return true;
  if (SUPER_ADMIN_ACTIONS.has(action)) return false;
  return caller.role === ROLE_PROVIDER;
}

// The provider-isolation invariant: a provider may act only on accounts they
// own; a super-admin may act on any.
export function canActOnAccount(caller, targetProviderId) {
  if (!caller || caller.suspended) return false;
  if (caller.role === ROLE_SUPER_ADMIN) return true;
  return caller.role === ROLE_PROVIDER && targetProviderId === caller.userId;
}

export function withinQuota(used, max, role) {
  if (role === ROLE_SUPER_ADMIN) return true;
  return Number(used) < Number(max);
}

export function validateLine(line) {
  const type = String(line?.type ?? "xtream").toLowerCase();
  const nickname = line?.nickname ? String(line.nickname) : null;
  if (type === "m3u") {
    const url = String(line?.url ?? "").trim();
    if (!/^https?:\/\//i.test(url)) return { ok: false, value: null };
    return { ok: true, value: { type: "m3u", host: null, username: null, password: null, url, nickname } };
  }
  const host = String(line?.host ?? "").trim();
  const username = String(line?.username ?? "").trim();
  const password = String(line?.password ?? "");
  if (!host || !username || !password) return { ok: false, value: null };
  return { ok: true, value: { type: "xtream", host, username, password, url: null, nickname } };
}

export function validateNewAccount(input) {
  const errors = [];
  const username = String(input?.username ?? "").trim().toLowerCase();
  const password = String(input?.password ?? "");
  const deviceLimit = Number(input?.deviceLimit);
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) errors.push("username");
  if (password.length < 6) errors.push("password");
  if (!Number.isInteger(deviceLimit) || deviceLimit < 1) errors.push("deviceLimit");

  const line = validateLine(input?.line);
  if (!line.ok) errors.push("line");

  let expiresAt = null;
  if (input?.expiresAt != null && input.expiresAt !== "") {
    const t = Date.parse(input.expiresAt);
    if (!Number.isFinite(t)) errors.push("expiresAt");
    else expiresAt = new Date(t).toISOString();
  }

  return {
    ok: errors.length === 0,
    errors,
    value: { username, password, deviceLimit, expiresAt, line: line.value },
  };
}

export function providerSlug(name, userId) {
  const base = String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || String(userId ?? "").slice(0, 8) || "provider";
}

export function resolveEmail(username, slug, email) {
  const e = String(email ?? "").trim().toLowerCase();
  if (e.includes("@")) return e;
  return `${username}@${slug}.accounts.local`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test supabase/functions/_shared/adminLogic.test.js`
Expected: PASS — all tests pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/adminLogic.js supabase/functions/_shared/adminLogic.test.js
git commit -m "feat(backend): pure admin role/scope/quota/validation logic"
```

---

## Task 3: Migration — `providers` table

**Files:**
- Create: `supabase/migrations/20260716000002_providers.sql`

**Interfaces:**
- Produces: `public.providers(user_id, role, name, max_accounts, suspended, created_at)`.

- [ ] **Step 1: Write the migration**

```sql
-- providers: who may use the reseller dashboard. A row here marks an auth user
-- as a super-admin or a provider (reseller). Additive & idempotent. Reachable
-- only via service_role Edge Functions (no anon/authenticated policies).
create table if not exists public.providers (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  role         text not null check (role in ('super_admin','provider')),
  name         text not null,
  max_accounts int  not null default 0 check (max_accounts >= 0),
  suspended    boolean not null default false,
  created_at   timestamptz not null default now()
);

alter table public.providers enable row level security;
revoke all on public.providers from anon, authenticated;

-- ── Bootstrap the FIRST super-admin (run once, manually, in the SQL editor) ──
-- There is no super-admin until you promote an existing auth user. Create the
-- user first (dashboard Auth > Add user, or the app), then:
--
--   insert into public.providers (user_id, role, name, max_accounts)
--   select id, 'super_admin', 'Owner', 0
--   from auth.users where lower(email) = lower('<your-admin-email>')
--   on conflict (user_id) do update set role = 'super_admin';
```

- [ ] **Step 2: Apply locally and verify**

Run: `supabase db reset` (applies all migrations to the local DB)
Then verify the table exists:
Run: `psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '\"')" -c "\d public.providers"`
Expected: shows columns `user_id, role, name, max_accounts, suspended, created_at`; RLS enabled.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260716000002_providers.sql
git commit -m "feat(backend): providers table (reseller/super-admin registry)"
```

---

## Task 4: Migration — `customer_accounts` table

**Files:**
- Create: `supabase/migrations/20260716000003_customer_accounts.sql`

**Interfaces:**
- Produces: `public.customer_accounts(user_id, origin, provider_id, plan_id, expires_at, suspended, created_at, note)` + index on `provider_id`.

- [ ] **Step 1: Write the migration**

```sql
-- customer_accounts: subscription state + origin for every customer login.
-- origin/provider_id/plan_id future-proof the Phase-2 self-serve channel but are
-- unused by Phase-1 code beyond provider_id. Additive & idempotent. Reachable
-- only via service_role Edge Functions.
create table if not exists public.customer_accounts (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  origin      text not null default 'provider' check (origin in ('provider','self')),
  provider_id uuid references public.providers(user_id) on delete restrict,
  plan_id     uuid,
  expires_at  timestamptz,
  suspended   boolean not null default false,
  created_at  timestamptz not null default now(),
  note        text
);

alter table public.customer_accounts enable row level security;
revoke all on public.customer_accounts from anon, authenticated;

create index if not exists customer_accounts_provider_idx
  on public.customer_accounts (provider_id);
```

- [ ] **Step 2: Apply locally and verify**

Run: `supabase db reset`
Run: `psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '\"')" -c "\d public.customer_accounts"`
Expected: columns present; `provider_id` FK → `providers(user_id)` `ON DELETE RESTRICT`; index `customer_accounts_provider_idx` present; RLS enabled.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260716000003_customer_accounts.sql
git commit -m "feat(backend): customer_accounts table (origin, provider link, expiry, suspend)"
```

---

## Task 5: Migration — `admin_audit` table

**Files:**
- Create: `supabase/migrations/20260716000004_admin_audit.sql`

**Interfaces:**
- Produces: `public.admin_audit(id, actor_id, action, target, meta, created_at)`.

- [ ] **Step 1: Write the migration**

```sql
-- admin_audit: append-only log of dashboard mutations. meta must never contain
-- passwords or IPTV-line credentials. Reachable only via service_role.
create table if not exists public.admin_audit (
  id         bigint generated always as identity primary key,
  actor_id   uuid not null,
  action     text not null,
  target     text,
  meta       jsonb,
  created_at timestamptz not null default now()
);

alter table public.admin_audit enable row level security;
revoke all on public.admin_audit from anon, authenticated;

create index if not exists admin_audit_actor_idx on public.admin_audit (actor_id, created_at desc);
```

- [ ] **Step 2: Apply locally and verify**

Run: `supabase db reset`
Run: `psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '\"')" -c "\d public.admin_audit"`
Expected: columns present; RLS enabled.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260716000004_admin_audit.sql
git commit -m "feat(backend): admin_audit table (append-only dashboard action log)"
```

---

## Task 6: Account-status gate helpers in `deviceGate.ts`

**Files:**
- Modify: `supabase/functions/_shared/deviceGate.ts`

**Interfaces:**
- Consumes: `accountStatus`, `isActive` from `./accountStatus.js`; `adminClient` (already in file).
- Produces:
  - `loadAccountStatus(admin, userId) → Promise<string>` — reads `customer_accounts` + owning provider's `suspended`, returns an `accountStatus` constant.
  - `assertAccountActive(admin, userId) → Promise<void>` — throws `new Error(status)` (one of `ACCOUNT_SUSPENDED`/`ACCOUNT_EXPIRED`/`PROVIDER_SUSPENDED`) when inactive.

- [ ] **Step 1: Add the import at the top of the file**

At line 5 (after the `userKeyIsAuthorized` import), add:

```ts
import { accountStatus, isActive } from "./accountStatus.js";
```

- [ ] **Step 2: Append the two helpers at the end of the file**

```ts
// Reads the caller's customer_accounts row + owning provider's suspended flag
// and returns an accountStatus() constant. A caller with no customer_accounts
// row (legacy / self / a provider login) is ACTIVE — not gated here.
export async function loadAccountStatus(
  admin: ReturnType<typeof adminClient>,
  userId: string,
): Promise<string> {
  const { data: acct, error } = await admin
    .from("customer_accounts")
    .select("suspended, expires_at, provider_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("SERVER_ERROR");
  if (!acct) return accountStatus(null, false, Date.now());

  let providerSuspended = false;
  if (acct.provider_id) {
    const { data: prov, error: pErr } = await admin
      .from("providers")
      .select("suspended")
      .eq("user_id", acct.provider_id)
      .maybeSingle();
    if (pErr) throw new Error("SERVER_ERROR");
    providerSuspended = !!prov?.suspended;
  }
  return accountStatus(acct, providerSuspended, Date.now());
}

// Throws the specific status string when the account is inactive; the caller
// maps it to a client-facing message / HTTP code.
export async function assertAccountActive(
  admin: ReturnType<typeof adminClient>,
  userId: string,
): Promise<void> {
  const status = await loadAccountStatus(admin, userId);
  if (!isActive(status)) throw new Error(status);
}
```

- [ ] **Step 3: Sanity-check syntax with the whole suite**

Run: `npm test`
Expected: PASS (existing tests unaffected; the new helpers are exercised by later tasks / manual curl). If a Deno type-only issue exists, it surfaces at `supabase functions serve`, not in node:test.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/deviceGate.ts
git commit -m "feat(backend): loadAccountStatus + assertAccountActive gate helpers"
```

---

## Task 7: Enforce status in `claim-device`

**Files:**
- Modify: `supabase/functions/claim-device/index.ts`

**Interfaces:**
- Consumes: `assertAccountActive` from `../_shared/deviceGate.ts`.

- [ ] **Step 1: Update the import (line 5)**

```ts
import { getUserId, adminClient, json, corsPreflight, assertAccountActive } from "../_shared/deviceGate.ts";
```

- [ ] **Step 2: Call the gate before the claim (inside the `try`, after `const admin = adminClient();`)**

Replace the block starting at `const admin = adminClient();` through the `rpc` call so it reads:

```ts
    const admin = adminClient();

    // Reseller gate: a suspended/expired account (or one under a suspended
    // provider) is denied the claim, routing the client to the locked screen.
    try {
      await assertAccountActive(admin, userId);
    } catch (_e) {
      return json({ status: "denied" }, 403);
    }

    const { data: status, error } = await admin.rpc("claim_device", {
```

- [ ] **Step 3: Verify locally with curl**

Prereq: `supabase start` and a bound test customer whose `customer_accounts.suspended = true`.
Run (substitute a valid customer JWT + device id):

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/claim-device" \
  -H "Authorization: Bearer $CUSTOMER_JWT" -H "x-device-id: dev-1" \
  -H "content-type: application/json" -d '{"deviceId":"dev-1"}' -w '\n%{http_code}\n'
```

Expected: `{"status":"denied"}` with HTTP `403` when suspended; `{"status":"ok"|"bound"}` `200` when active.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/claim-device/index.ts
git commit -m "feat(backend): deny device claim for suspended/expired accounts"
```

---

## Task 8: Enforce status in `data`

**Files:**
- Modify: `supabase/functions/data/index.ts`

**Interfaces:**
- Consumes: `assertAccountActive` from `../_shared/deviceGate.ts`.

- [ ] **Step 1: Add `assertAccountActive` to the import (lines 3-11)**

Add `assertAccountActive,` to the existing import list from `../_shared/deviceGate.ts`.

- [ ] **Step 2: Call the gate right after the bound-device check**

After line 21 (`await assertBoundDevice(admin, userId, req.headers.get("x-device-id") ?? "");`) add:

```ts
    await assertAccountActive(admin, userId);
```

- [ ] **Step 3: Map inactive statuses to 403 in the catch block**

In the final `catch (e)` block, after the `DEVICE_MISMATCH` line, add:

```ts
    if (msg === "ACCOUNT_SUSPENDED" || msg === "ACCOUNT_EXPIRED" || msg === "PROVIDER_SUSPENDED") {
      return json({ error: "ACCOUNT_INACTIVE", reason: msg }, 403);
    }
```

- [ ] **Step 4: Verify locally with curl**

Run (active vs suspended customer JWT):

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/data" \
  -H "Authorization: Bearer $CUSTOMER_JWT" -H "x-device-id: dev-1" \
  -H "content-type: application/json" -d '{"action":"profiles.fetch"}' -w '\n%{http_code}\n'
```

Expected: active → profile JSON `200`; suspended/expired → `{"error":"ACCOUNT_INACTIVE","reason":"ACCOUNT_SUSPENDED"}` `403`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/data/index.ts
git commit -m "feat(backend): block data access for suspended/expired accounts (403)"
```

---

## Task 9: Enforce status in `login`

**Files:**
- Modify: `supabase/functions/login/index.ts`

**Interfaces:**
- Consumes: `adminClient`, `loadAccountStatus` from `../_shared/deviceGate.ts`; `isActive` from `../_shared/accountStatus.js`.

- [ ] **Step 1: Extend the imports**

Line 15 currently: `import { adminClient, json, corsPreflight } from "../_shared/deviceGate.ts";`
Change to add `loadAccountStatus`, and add a second import:

```ts
import { adminClient, json, corsPreflight, loadAccountStatus } from "../_shared/deviceGate.ts";
import { isActive } from "../_shared/accountStatus.js";
```

- [ ] **Step 2: Block inactive accounts after a successful password check**

After the successful sign-in (right before the final `return json({ ok: true, … })`), insert:

```ts
    // Reseller gate: the password is correct, so the account provably exists —
    // safe to return a SPECIFIC status (no enumeration leak).
    const status = await loadAccountStatus(adminClient(), signIn.session.user.id);
    if (!isActive(status)) {
      return json({ ok: false, error: status }); // ACCOUNT_EXPIRED | ACCOUNT_SUSPENDED | PROVIDER_SUSPENDED
    }
```

- [ ] **Step 3: Verify locally with curl**

Run (expired customer credentials):

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/login" \
  -H "content-type: application/json" \
  -d '{"usernameOrEmail":"customer_01","password":"secret1"}' -w '\n%{http_code}\n'
```

Expected: active → `{"ok":true,"access_token":...}`; expired → `{"ok":false,"error":"ACCOUNT_EXPIRED"}` `200`.

Note (client copy, handled in the web/app layer, not here): the player's `mapLoginResult` already treats `ok:false` as an error string — these new codes surface as the error message. Friendly copy is a client concern tracked in the web plan / a follow-up app task.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/login/index.ts
git commit -m "feat(backend): block login for suspended/expired accounts with specific status"
```

---

## Task 10: `admin` function — router skeleton, provider load, `me`

**Files:**
- Create: `supabase/functions/admin/index.ts`

**Interfaces:**
- Consumes: `getUserId`, `adminClient`, `json`, `corsPreflight` from `../_shared/deviceGate.ts`; `canInvoke`, `ROLE_SUPER_ADMIN` from `../_shared/adminLogic.js`.
- Produces: an HTTP action router. `me` action returns `{ role, name, quota: { used, max } }`.

- [ ] **Step 1: Create the file with the skeleton + `me` + audit helper**

```ts
// admin: reseller management router. Verifies the JWT, loads the caller's
// providers row (must exist and not be suspended), enforces role/scope/quota via
// the pure adminLogic module, then performs writes with the service role.
// verify_jwt defaults to true (config.toml) — only authenticated callers reach here.
import { getUserId, adminClient, json, corsPreflight } from "../_shared/deviceGate.ts";
import {
  canInvoke,
  canActOnAccount,
  withinQuota,
  validateNewAccount,
  providerSlug,
  resolveEmail,
  ROLE_SUPER_ADMIN,
} from "../_shared/adminLogic.js";

type Admin = ReturnType<typeof adminClient>;

async function audit(admin: Admin, actorId: string, action: string, target: string | null, meta: unknown) {
  await admin.from("admin_audit").insert({ actor_id: actorId, action, target, meta: meta ?? null });
}

// Load the caller's providers row → the `caller` shape adminLogic expects.
async function loadCaller(admin: Admin, userId: string) {
  const { data } = await admin
    .from("providers")
    .select("user_id, role, name, max_accounts, suspended")
    .eq("user_id", userId)
    .maybeSingle();
  return data; // null if not a provider/super-admin
}

Deno.serve(async (req) => {
  const pre = corsPreflight(req);
  if (pre) return pre;
  try {
    const userId = await getUserId(req);
    const admin = adminClient();
    const row = await loadCaller(admin, userId);
    const caller = row
      ? { userId: row.user_id, role: row.role, suspended: row.suspended }
      : null;

    const { action, payload = {} } = await req.json();
    if (!canInvoke(caller, action)) return json({ error: "FORBIDDEN" }, 403);

    switch (action) {
      case "me": {
        const { count } = await admin
          .from("customer_accounts")
          .select("user_id", { count: "exact", head: true })
          .eq("provider_id", userId);
        return json({
          role: row.role,
          name: row.name,
          quota: { used: count ?? 0, max: row.max_accounts },
        });
      }
      default:
        return json({ error: "UNKNOWN_ACTION" }, 400);
    }
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "Unauthorized") return json({ error: "Unauthorized" }, 401);
    return json({ error: "SERVER_ERROR" }, 500);
  }
});
```

- [ ] **Step 2: Serve locally and verify the gate + `me`**

Run: `supabase functions serve admin --no-verify-jwt` *(local only; the deployed function keeps verify_jwt=true)*
Run (super-admin JWT):

```bash
curl -s -X POST "http://localhost:54321/functions/v1/admin" \
  -H "Authorization: Bearer $ADMIN_JWT" -H "content-type: application/json" \
  -d '{"action":"me"}' -w '\n%{http_code}\n'
```

Expected: `{"role":"super_admin","name":"Owner","quota":{"used":0,"max":0}}` `200`.
Run with a plain customer JWT (no providers row): expected `{"error":"FORBIDDEN"}` `403`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/admin/index.ts
git commit -m "feat(backend): admin function skeleton, provider gate, me action"
```

---

## Task 11: `admin` — `providers.*` actions (super-admin)

**Files:**
- Modify: `supabase/functions/admin/index.ts`

**Interfaces:**
- Produces cases: `providers.list`, `providers.create`, `providers.update`, `providers.delete`.

- [ ] **Step 1: Add the four cases before `default:`**

```ts
      case "providers.list": {
        const { data } = await admin
          .from("providers")
          .select("user_id, role, name, max_accounts, suspended, created_at")
          .order("created_at", { ascending: true });
        // annotate each with its live account count
        const out = [];
        for (const p of data ?? []) {
          const { count } = await admin
            .from("customer_accounts")
            .select("user_id", { count: "exact", head: true })
            .eq("provider_id", p.user_id);
          out.push({ ...p, accounts_used: count ?? 0 });
        }
        return json(out);
      }

      case "providers.create": {
        const email = String(payload.email ?? "").trim().toLowerCase();
        const password = String(payload.password ?? "");
        const name = String(payload.name ?? "").trim();
        const maxAccounts = Number(payload.maxAccounts);
        if (!email.includes("@") || password.length < 6 || !name || !Number.isInteger(maxAccounts) || maxAccounts < 0) {
          return json({ error: "INVALID_INPUT" }, 400);
        }
        const { data: created, error: cErr } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        if (cErr || !created.user) return json({ error: "CREATE_FAILED" }, 400);
        const { error: pErr } = await admin.from("providers").insert({
          user_id: created.user.id,
          role: "provider",
          name,
          max_accounts: maxAccounts,
        });
        if (pErr) {
          await admin.auth.admin.deleteUser(created.user.id); // rollback
          return json({ error: "CREATE_FAILED" }, 400);
        }
        await audit(admin, userId, "provider.create", created.user.id, { name, maxAccounts });
        return json({ userId: created.user.id });
      }

      case "providers.update": {
        const target = String(payload.userId ?? "");
        const patch: Record<string, unknown> = {};
        if (payload.name != null) patch.name = String(payload.name).trim();
        if (payload.maxAccounts != null) {
          const m = Number(payload.maxAccounts);
          if (!Number.isInteger(m) || m < 0) return json({ error: "INVALID_INPUT" }, 400);
          patch.max_accounts = m;
        }
        if (payload.suspended != null) patch.suspended = !!payload.suspended;
        if (!target || Object.keys(patch).length === 0) return json({ error: "INVALID_INPUT" }, 400);
        await admin.from("providers").update(patch).eq("user_id", target).eq("role", "provider");
        await audit(admin, userId, "provider.update", target, patch);
        return json({ ok: true });
      }

      case "providers.delete": {
        const target = String(payload.userId ?? "");
        if (!target) return json({ error: "INVALID_INPUT" }, 400);
        const { count } = await admin
          .from("customer_accounts")
          .select("user_id", { count: "exact", head: true })
          .eq("provider_id", target);
        if ((count ?? 0) > 0) return json({ error: "PROVIDER_HAS_ACCOUNTS" }, 409);
        await admin.from("providers").delete().eq("user_id", target).eq("role", "provider");
        await admin.auth.admin.deleteUser(target);
        await audit(admin, userId, "provider.delete", target, null);
        return json({ ok: true });
      }
```

- [ ] **Step 2: Verify with curl (super-admin JWT)**

```bash
# create
curl -s -X POST "http://localhost:54321/functions/v1/admin" -H "Authorization: Bearer $ADMIN_JWT" \
  -H "content-type: application/json" \
  -d '{"action":"providers.create","payload":{"email":"acme@x.com","password":"secret1","name":"Acme","maxAccounts":10}}'
# list
curl -s -X POST "http://localhost:54321/functions/v1/admin" -H "Authorization: Bearer $ADMIN_JWT" \
  -H "content-type: application/json" -d '{"action":"providers.list"}'
```

Expected: create → `{"userId":"…"}`; list → array including Acme with `accounts_used:0`. A provider JWT calling these → `{"error":"FORBIDDEN"}` `403`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/admin/index.ts
git commit -m "feat(backend): admin providers.* actions (super-admin CRUD)"
```

---

## Task 12: `admin` — `accounts.create` + `accounts.list`

**Files:**
- Modify: `supabase/functions/admin/index.ts`

**Interfaces:**
- Consumes: `validateNewAccount`, `withinQuota`, `providerSlug`, `resolveEmail`, `loadAccountStatus` (import), `accountStatus` constants.
- Produces cases: `accounts.create`, `accounts.list`.

- [ ] **Step 1: Extend imports at top of `admin/index.ts`**

Add to the `deviceGate.ts` import: `loadAccountStatus`. Add a new import:

```ts
import { ACCOUNT_ACTIVE } from "../_shared/accountStatus.js";
```

Add a small helper below `loadCaller`:

```ts
// Resolve the provider a given target account belongs to (for the isolation check).
async function accountProviderId(admin: Admin, targetUserId: string): Promise<string | null | undefined> {
  const { data } = await admin
    .from("customer_accounts")
    .select("provider_id")
    .eq("user_id", targetUserId)
    .maybeSingle();
  return data ? data.provider_id : undefined; // undefined = no such account
}
```

- [ ] **Step 2: Add the two cases before `default:`**

```ts
      case "accounts.create": {
        const v = validateNewAccount(payload);
        if (!v.ok) return json({ error: "INVALID_INPUT", fields: v.errors }, 400);

        // Quota (super-admin exempt). used = ALL of the provider's accounts.
        const { count } = await admin
          .from("customer_accounts")
          .select("user_id", { count: "exact", head: true })
          .eq("provider_id", userId);
        if (!withinQuota(count ?? 0, row.max_accounts, row.role)) {
          return json({ error: "QUOTA_EXCEEDED" }, 409);
        }

        const slug = providerSlug(row.name, userId);
        const email = resolveEmail(v.value.username, slug, payload.email);

        // 1. auth user
        const { data: created, error: cErr } = await admin.auth.admin.createUser({
          email,
          password: v.value.password,
          email_confirm: true,
          user_metadata: { username: v.value.username },
        });
        if (cErr || !created.user) return json({ error: "CREATE_FAILED" }, 400);
        const newId = created.user.id;

        try {
          // 2. profiles (username↔email lookup used by login)
          await admin.from("profiles").upsert(
            { user_id: newId, username: v.value.username, email },
            { onConflict: "user_id" },
          );
          // 3. default app_profile
          const { data: prof } = await admin
            .from("app_profiles")
            .insert({ user_id: newId, name: "Default", avatar: "👤" })
            .select("id")
            .single();
          // 4. iptv line under that profile
          await admin.from("iptv_accounts").insert({
            user_id: newId,
            profile_id: prof?.id ?? null,
            type: v.value.line.type,
            nickname: v.value.line.nickname,
            host: v.value.line.host,
            username: v.value.line.username,
            password: v.value.line.password,
            url: v.value.line.url,
          });
          // 5. device limit
          await admin.from("device_limits").upsert(
            { user_id: newId, device_limit: v.value.deviceLimit },
            { onConflict: "user_id" },
          );
          // 6. subscription record
          await admin.from("customer_accounts").insert({
            user_id: newId,
            origin: "provider",
            provider_id: userId,
            expires_at: v.value.expiresAt,
            note: payload.note ? String(payload.note) : null,
          });
        } catch (_e) {
          await admin.auth.admin.deleteUser(newId); // atomic: undo on any failure
          return json({ error: "CREATE_FAILED" }, 400);
        }

        // meta MUST NOT include the password or line credentials
        await audit(admin, userId, "account.create", newId, {
          username: v.value.username,
          deviceLimit: v.value.deviceLimit,
          expiresAt: v.value.expiresAt,
          lineType: v.value.line.type,
        });
        return json({ userId: newId });
      }

      case "accounts.list": {
        const search = String(payload.search ?? "").trim().toLowerCase();
        // Provider sees only their own; super-admin may pass providerId to scope.
        let q = admin
          .from("customer_accounts")
          .select("user_id, provider_id, expires_at, suspended, created_at, note")
          .order("created_at", { ascending: false });
        if (row.role === ROLE_SUPER_ADMIN) {
          if (payload.providerId) q = q.eq("provider_id", String(payload.providerId));
        } else {
          q = q.eq("provider_id", userId);
        }
        const { data: accts } = await q;

        const out = [];
        for (const a of accts ?? []) {
          const { data: prof } = await admin
            .from("profiles").select("username").eq("user_id", a.user_id).maybeSingle();
          const username = prof?.username ?? "";
          if (search && !username.includes(search)) continue;
          const { count: devicesUsed } = await admin
            .from("device_bindings")
            .select("device_id", { count: "exact", head: true })
            .eq("user_id", a.user_id);
          const { data: lim } = await admin
            .from("device_limits").select("device_limit").eq("user_id", a.user_id).maybeSingle();
          const status = await loadAccountStatus(admin, a.user_id);
          out.push({
            userId: a.user_id,
            username,
            status,
            expiresAt: a.expires_at,
            suspended: a.suspended,
            devicesUsed: devicesUsed ?? 0,
            deviceLimit: lim?.device_limit ?? null,
            note: a.note,
          });
        }
        return json(out);
      }
```

- [ ] **Step 3: Verify with curl (provider JWT)**

```bash
curl -s -X POST "http://localhost:54321/functions/v1/admin" -H "Authorization: Bearer $PROVIDER_JWT" \
  -H "content-type: application/json" -d '{"action":"accounts.create","payload":{
    "username":"customer_01","password":"secret1","deviceLimit":2,
    "expiresAt":"2026-12-31T00:00:00Z",
    "line":{"type":"xtream","host":"http://h","username":"u","password":"p"}}}'
curl -s -X POST "http://localhost:54321/functions/v1/admin" -H "Authorization: Bearer $PROVIDER_JWT" \
  -H "content-type: application/json" -d '{"action":"accounts.list"}'
```

Expected: create → `{"userId":"…"}`; list → one row `{username:"customer_01", status:"ACTIVE", devicesUsed:0, deviceLimit:2}`. Creating past a `max_accounts` of 1 → `{"error":"QUOTA_EXCEEDED"}` `409`.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/admin/index.ts
git commit -m "feat(backend): admin accounts.create (full provisioning + quota) and accounts.list"
```

---

## Task 13: `admin` — `accounts.get/update/setPassword/updateLine/delete`

**Files:**
- Modify: `supabase/functions/admin/index.ts`

**Interfaces:**
- Consumes: `canActOnAccount`, `accountProviderId`, `validateLine` (add to imports).
- Produces cases: `accounts.get`, `accounts.update`, `accounts.setPassword`, `accounts.updateLine`, `accounts.delete`.

- [ ] **Step 1: Add `validateLine` to the adminLogic import at top of file.**

- [ ] **Step 2: Add the cases before `default:`**

```ts
      case "accounts.get": {
        const target = String(payload.userId ?? "");
        const owner = await accountProviderId(admin, target);
        if (owner === undefined || !canActOnAccount(caller, owner)) return json({ error: "FORBIDDEN" }, 403);
        const { data: prof } = await admin
          .from("profiles").select("username, email").eq("user_id", target).maybeSingle();
        const { data: acct } = await admin
          .from("customer_accounts")
          .select("provider_id, expires_at, suspended, note, origin")
          .eq("user_id", target).maybeSingle();
        const { data: lim } = await admin
          .from("device_limits").select("device_limit").eq("user_id", target).maybeSingle();
        const { data: line } = await admin
          .from("iptv_accounts")
          .select("id, type, nickname, host, username, url")
          .eq("user_id", target).order("created_at", { ascending: true }).limit(1).maybeSingle();
        const status = await loadAccountStatus(admin, target);
        return json({
          userId: target,
          username: prof?.username ?? "",
          email: prof?.email ?? "",
          status,
          expiresAt: acct?.expires_at ?? null,
          suspended: acct?.suspended ?? false,
          note: acct?.note ?? null,
          deviceLimit: lim?.device_limit ?? null,
          line: line ?? null, // password intentionally omitted from reads
        });
      }

      case "accounts.update": {
        const target = String(payload.userId ?? "");
        const owner = await accountProviderId(admin, target);
        if (owner === undefined || !canActOnAccount(caller, owner)) return json({ error: "FORBIDDEN" }, 403);

        const acctPatch: Record<string, unknown> = {};
        if (payload.expiresAt !== undefined) {
          if (payload.expiresAt === null || payload.expiresAt === "") acctPatch.expires_at = null;
          else {
            const t = Date.parse(payload.expiresAt);
            if (!Number.isFinite(t)) return json({ error: "INVALID_INPUT" }, 400);
            acctPatch.expires_at = new Date(t).toISOString();
          }
        }
        if (payload.suspended !== undefined) acctPatch.suspended = !!payload.suspended;
        if (payload.note !== undefined) acctPatch.note = payload.note ? String(payload.note) : null;
        if (Object.keys(acctPatch).length > 0) {
          await admin.from("customer_accounts").update(acctPatch).eq("user_id", target);
        }
        if (payload.deviceLimit !== undefined) {
          const dl = Number(payload.deviceLimit);
          if (!Number.isInteger(dl) || dl < 1) return json({ error: "INVALID_INPUT" }, 400);
          await admin.from("device_limits").upsert({ user_id: target, device_limit: dl }, { onConflict: "user_id" });
        }
        await audit(admin, userId, "account.update", target, { ...acctPatch, deviceLimit: payload.deviceLimit });
        return json({ ok: true });
      }

      case "accounts.setPassword": {
        const target = String(payload.userId ?? "");
        const owner = await accountProviderId(admin, target);
        if (owner === undefined || !canActOnAccount(caller, owner)) return json({ error: "FORBIDDEN" }, 403);
        const password = String(payload.password ?? "");
        if (password.length < 6) return json({ error: "INVALID_INPUT" }, 400);
        const { error } = await admin.auth.admin.updateUserById(target, { password });
        if (error) return json({ error: "UPDATE_FAILED" }, 400);
        await audit(admin, userId, "account.setPassword", target, null); // never log the password
        return json({ ok: true });
      }

      case "accounts.updateLine": {
        const target = String(payload.userId ?? "");
        const owner = await accountProviderId(admin, target);
        if (owner === undefined || !canActOnAccount(caller, owner)) return json({ error: "FORBIDDEN" }, 403);
        const line = validateLine(payload.line);
        if (!line.ok) return json({ error: "INVALID_INPUT", fields: ["line"] }, 400);
        const { data: existing } = await admin
          .from("iptv_accounts").select("id").eq("user_id", target)
          .order("created_at", { ascending: true }).limit(1).maybeSingle();
        const fields = {
          type: line.value.type, nickname: line.value.nickname, host: line.value.host,
          username: line.value.username, password: line.value.password, url: line.value.url,
        };
        if (existing?.id) {
          await admin.from("iptv_accounts").update(fields).eq("id", existing.id).eq("user_id", target);
        } else {
          const { data: prof } = await admin.from("app_profiles").select("id").eq("user_id", target).limit(1).maybeSingle();
          await admin.from("iptv_accounts").insert({ user_id: target, profile_id: prof?.id ?? null, ...fields });
        }
        await audit(admin, userId, "account.updateLine", target, { lineType: line.value.type }); // no creds
        return json({ ok: true });
      }

      case "accounts.delete": {
        const target = String(payload.userId ?? "");
        const owner = await accountProviderId(admin, target);
        if (owner === undefined || !canActOnAccount(caller, owner)) return json({ error: "FORBIDDEN" }, 403);
        await admin.auth.admin.deleteUser(target); // cascades customer_accounts, device_bindings, etc.
        await audit(admin, userId, "account.delete", target, null);
        return json({ ok: true });
      }
```

- [ ] **Step 3: Verify the isolation invariant with curl**

With `$PROVIDER_B_JWT` (a different provider), attempt to read provider A's account:

```bash
curl -s -X POST "http://localhost:54321/functions/v1/admin" -H "Authorization: Bearer $PROVIDER_B_JWT" \
  -H "content-type: application/json" -d '{"action":"accounts.get","payload":{"userId":"<A_customer_id>"}}' -w '\n%{http_code}\n'
```

Expected: `{"error":"FORBIDDEN"}` `403`. The owning provider gets the detail `200`. `accounts.update` with `suspended:true` then a `data` call for that customer → `403 ACCOUNT_INACTIVE` (Task 8).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/admin/index.ts
git commit -m "feat(backend): admin account get/update/setPassword/updateLine/delete with isolation checks"
```

---

## Task 14: `admin` — `devices.*` actions

**Files:**
- Modify: `supabase/functions/admin/index.ts`

**Interfaces:**
- Produces cases: `devices.list`, `devices.revoke`, `devices.unrevoke`, `devices.remove`.

- [ ] **Step 1: Add the cases before `default:`**

```ts
      case "devices.list": {
        const target = String(payload.userId ?? "");
        const owner = await accountProviderId(admin, target);
        if (owner === undefined || !canActOnAccount(caller, owner)) return json({ error: "FORBIDDEN" }, 403);
        const { data } = await admin
          .from("device_bindings")
          .select("device_id, platform, label, bound_at, last_seen_at, revoked_at")
          .eq("user_id", target)
          .order("last_seen_at", { ascending: false, nullsFirst: false });
        return json(data ?? []);
      }

      case "devices.revoke":
      case "devices.unrevoke": {
        const target = String(payload.userId ?? "");
        const deviceId = String(payload.deviceId ?? "");
        const owner = await accountProviderId(admin, target);
        if (owner === undefined || !canActOnAccount(caller, owner) || !deviceId) return json({ error: "FORBIDDEN" }, 403);
        const revoked_at = action === "devices.revoke" ? new Date().toISOString() : null;
        await admin.from("device_bindings").update({ revoked_at })
          .eq("user_id", target).eq("device_id", deviceId);
        await audit(admin, userId, action, target, { deviceId });
        return json({ ok: true });
      }

      case "devices.remove": {
        const target = String(payload.userId ?? "");
        const deviceId = String(payload.deviceId ?? "");
        const owner = await accountProviderId(admin, target);
        if (owner === undefined || !canActOnAccount(caller, owner) || !deviceId) return json({ error: "FORBIDDEN" }, 403);
        await admin.from("device_bindings").delete().eq("user_id", target).eq("device_id", deviceId);
        await audit(admin, userId, "devices.remove", target, { deviceId });
        return json({ ok: true });
      }
```

- [ ] **Step 2: Verify with curl (owning provider JWT)**

```bash
curl -s -X POST "http://localhost:54321/functions/v1/admin" -H "Authorization: Bearer $PROVIDER_JWT" \
  -H "content-type: application/json" -d '{"action":"devices.list","payload":{"userId":"<customer_id>"}}'
curl -s -X POST "http://localhost:54321/functions/v1/admin" -H "Authorization: Bearer $PROVIDER_JWT" \
  -H "content-type: application/json" -d '{"action":"devices.revoke","payload":{"userId":"<customer_id>","deviceId":"dev-1"}}'
```

Expected: list → array with `revoked_at:null`; after revoke → that device's next `claim-device`/`data` call returns `403` (existing revoke wiring + Task 7/8). `unrevoke` clears it.

- [ ] **Step 3: Full suite + lint**

Run: `npm test`
Expected: PASS.
Run: `npm run lint`
Expected: no errors (warnings OK).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/admin/index.ts
git commit -m "feat(backend): admin devices.* actions (list/revoke/unrevoke/remove)"
```

---

## Task 15: Update `supabase/README.md`

**Files:**
- Modify: `supabase/README.md`

- [ ] **Step 1: Add a "Reseller dashboard" section at the top and demote the SQL runbook to "break-glass"**

Insert after the intro paragraph:

```markdown
## Reseller dashboard (preferred)

Providers and the super-admin manage everything through the **dashboard app**
(`dashboard/`), which calls the `admin` Edge Function. Day-to-day work — creating
accounts, setting device counts, expiry, suspend, and revoking devices — should go
through the dashboard, not the SQL below.

**One-time super-admin bootstrap** (there is no admin until you promote a user):

​```sql
insert into public.providers (user_id, role, name, max_accounts)
select id, 'super_admin', 'Owner', 0
from auth.users where lower(email) = lower('<your-admin-email>')
on conflict (user_id) do update set role = 'super_admin';
​```

The SQL snippets below remain as a **break-glass** fallback only.
```

- [ ] **Step 2: Commit**

```bash
git add supabase/README.md
git commit -m "docs(backend): point admin runbook at the dashboard; add super-admin bootstrap"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** providers table ✓ (T3); customer_accounts w/ origin/provider_id/plan_id ✓ (T4); admin_audit ✓ (T5); status gates in login/data/claim-device ✓ (T7-T9, helper T6); admin function with provider load + role gate ✓ (T10); providers.* ✓ (T11); accounts.create full provisioning + quota ✓ (T12); accounts CRUD + isolation ✓ (T13); devices.* revoke/unrevoke/remove ✓ (T14); README/bootstrap ✓ (T15); pure logic modules unit-tested ✓ (T1-T2). Synthetic-email scheme ✓ (T2 `resolveEmail`/`providerSlug`, used in T12).
- **Placeholder scan:** none — every step has concrete SQL/TS/test code and exact curl verification.
- **Type consistency:** `caller = {userId, role, suspended}` used consistently in `canInvoke`/`canActOnAccount` (T2, T10, T13); `line` shape from `validateLine` matches the `iptv_accounts` insert (T12, T13); status constants shared between `accountStatus.js` and the gates.
- **Known runtime prerequisite (not a placeholder):** the curl verification steps require a local Supabase (`supabase start`) and test JWTs; they are verification, not implementation, and the pure-logic tests (T1-T2) plus `npm test` gate every commit regardless.
