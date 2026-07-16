# Reseller dashboard — providers, accounts, device limits & revocation

**Date:** 2026-07-16
**Status:** Design approved, pending implementation plan
**Author:** Andrew Hany (with Claude)

## Problem

All operator/admin work today is done by hand-running SQL from the
[`supabase/README.md`](../../../supabase/README.md) runbook: setting a per-account
device limit, listing bound devices, unbinding a device, or flipping the
`revoked_at` kill-switch. There is **no admin UI** and **no reseller layer** — the
backend is a flat set of `auth.users`.

We want a **dashboard** so that a multi-provider (reseller) model can be operated
without SQL:

- A **super-admin** (us) creates **providers** and sets each provider's quota.
- Each **provider** logs in and manages **only their own** customer accounts:
  create them, set the number of devices, provision the IPTV line, set an expiry,
  suspend, and revoke individual devices.

This spec covers **Phase 1: the reseller dashboard only.** A later Phase 2 adds
in-app self-serve registration + plans + payment; this design leaves room for it
but does not build it.

## Goals

- A **super-admin** can create/edit/suspend providers and set a per-provider
  `max_accounts` quota.
- A **provider** can, scoped strictly to their own accounts:
  - Create a customer account = login (username + password) + a **provisioned
    IPTV line** (Xtream host/user/pass **or** M3U URL) + a **device count** +
    an **expiry**.
  - Edit device count, renew/extend expiry, reset password, edit the line.
  - **Suspend** an account instantly (independent of expiry) and un-suspend.
  - See an account's **bound devices** (platform, last-seen) and **revoke**,
    re-enable, or remove (free a slot) each one.
- **Server-authoritative** account status: an expired or suspended account (or an
  account whose provider is suspended) is blocked at login and on every data call.
- **Strict provider isolation** — provider A can never see or touch provider B's
  accounts or devices.
- Stay on **Supabase**, reusing GoTrue auth, RLS, `service_role` Edge Functions,
  and the 2026-07-16 security hardening. **Zero new infra.**
- Admin business logic lives in **pure, framework-agnostic modules** so a custom
  backend remains possible in a later phase without a rewrite.

## Non-goals (Phase 1)

- **No self-serve signup, plans, or payment** (StoreKit / Google Play Billing /
  Stripe). That is Phase 2. The schema reserves the hooks (`origin`, nullable
  `provider_id`, `plan_id`) at zero cost, but no billing code ships now.
- **No custom backend / Postgres migration.** The player app is deeply tied to
  Supabase auth + Edge Functions; a second backend over the same DB is the worst
  of both worlds. Revisit only if Phase-2 payments/scale justify it.
- No email/SMS delivery of credentials — the provider hands them to the customer
  out of band.
- No per-provider theming/branding of the app or dashboard.
- No credit/prepaid economy — a simple integer `max_accounts` quota, not credits.

## Actors

Three kinds of `auth.users`, distinguished by which table they appear in:

| Actor | Marker | Can do |
|-------|--------|--------|
| **Super-admin** | `providers` row, `role='super_admin'` | Manage providers + quotas; may act on any account. |
| **Provider** | `providers` row, `role='provider'` | Manage own customer accounts only. |
| **Customer** | `customer_accounts` row | Log into the player app only. Cannot access the dashboard. |

## Architecture

```
Dashboard (separate web app) ──JWT──▶ admin Edge Function ──service_role──▶ Postgres
Player app ──JWT + device──▶ login / claim-device / data ──▶ (now also checks account status)
```

One new Edge Function, **`admin`**, follows the exact pattern of the existing
[`data/index.ts`](../../../supabase/functions/data/index.ts): verify the JWT →
load the caller's role/scope → enforce → perform every write with the
`service_role`. RLS stays fully closed (`anon`/`authenticated` revoked on all new
tables). **Provider isolation lives in code, in one auditable place** — not spread
across RLS policies.

## Data model

Additive, idempotent migrations in the same style as the existing ones
(`create table if not exists`, `enable row level security`, `revoke all … from
anon, authenticated`).

### New — `providers` (who may use the dashboard)

| column | type | notes |
|--------|------|-------|
| `user_id` | uuid PK → `auth.users(id)` on delete cascade | the login |
| `role` | text `check (role in ('super_admin','provider'))` | |
| `name` | text not null | display name |
| `max_accounts` | int not null default 0 `check (>= 0)` | quota; ignored for `super_admin` |
| `suspended` | boolean not null default false | kill a whole reseller |
| `created_at` | timestamptz not null default now() | |

### New — `customer_accounts` (subscription state + origin; one row per customer)

| column | type | notes |
|--------|------|-------|
| `user_id` | uuid PK → `auth.users(id)` on delete cascade | |
| `origin` | text not null default `'provider'` `check (origin in ('provider','self'))` | future-proofs self-serve |
| `provider_id` | uuid → `providers(user_id)` **on delete restrict** | **null = direct/self**; indexed |
| `plan_id` | uuid null | reserved for Phase-2 plans; unused now |
| `expires_at` | timestamptz null | null = never expires |
| `suspended` | boolean not null default false | instant kill-switch |
| `created_at` | timestamptz not null default now() | |
| `note` | text null | free-form provider note |

`on delete restrict` on `provider_id`: the super-admin must reassign or delete a
provider's customers before deleting the provider.

### New — `admin_audit` (accountability)

| column | type | notes |
|--------|------|-------|
| `id` | bigint generated always as identity PK | |
| `actor_id` | uuid not null | provider/super-admin who acted |
| `action` | text not null | e.g. `account.create`, `device.revoke` |
| `target` | text null | affected `user_id` / `device_id` |
| `meta` | jsonb null | action-specific detail (never secrets) |
| `created_at` | timestamptz not null default now() | |

### Reused unchanged

- `device_limits` — the "number of devices"; the dashboard upserts it. Global
  `DEVICE_LIMIT_DEFAULT` remains the fallback.
- `device_bindings.revoked_at` — the revoke kill-switch, already wired into
  `claim_device()` ([device_revoke.sql](../../../supabase/migrations/20260715000001_device_revoke.sql)).
- `iptv_accounts` + `app_profiles` — the provisioned line. Creating an account
  writes a default `app_profiles` row and one `iptv_accounts` row under it.
- `profiles` — username↔email mapping used by the `login` function.

## Enforcement — expiry + suspend (server-authoritative)

Pure decision logic in a new **`_shared/accountStatus.js`** (unit-tested), wrapped
by an `assertAccountActive(admin, userId)` helper next to `assertBoundDevice` in
[`_shared/deviceGate.ts`](../../../supabase/functions/_shared/deviceGate.ts).

An account is **inactive** when any of:
1. its `customer_accounts.suspended` is true, or
2. `expires_at` is set and `< now()` (Postgres server time = truth), or
3. its owning provider's `providers.suspended` is true.

Wired at three gates:

| Gate | Behavior | Rationale |
|------|----------|-----------|
| **`login`** | After the password check succeeds, block inactive accounts with a **specific** message (`ACCOUNT_EXPIRED` / `ACCOUNT_SUSPENDED`). | Safe to be specific: the password already proved the account exists, so no enumeration leak. |
| **`data`** | Re-check on every call → `403 ACCOUNT_INACTIVE`. | The continuous gate; the client already logs out on 401/403. |
| **`claim-device`** | Deny the claim for inactive accounts. | Defense in depth → routes to the existing device-locked screen. |

Client-side trusted-time (the existing demo-lockout system) may show a countdown,
but the server is authoritative.

## The `admin` Edge Function (action router)

Every request: verify JWT → `getUserId` → load caller's `providers` row (**must
exist and not be suspended**) → dispatch on `action`. Provider actions auto-scope
to the caller's `user_id`; **every account/device action re-checks
`target.customer_accounts.provider_id === caller` (super-admin bypasses)** — this
is the isolation invariant. Every mutating action writes an `admin_audit` row.

### Super-admin only

- `providers.list`
- `providers.create` `{ email, password, name, maxAccounts }` → create auth user
  (GoTrue admin API) + `providers` row (`role='provider'`).
- `providers.update` `{ userId, name?, maxAccounts?, suspended? }`
- `providers.delete` `{ userId }` — guarded: rejects if the provider still has
  `customer_accounts`.

### Provider (super-admin may target any)

- `me` → `{ role, name, quota: { used, max } }`
- `accounts.list` `{ search?, status? }` → rows: `username`, `status`
  (active/expired/suspended), `expiresAt`, `devicesUsed`/`deviceLimit`.
- `accounts.create` `{ username, email, password, deviceLimit, expiresAt,
  line: { type, host, username, password, url, nickname } }`
  → **quota check** (a provider's used-count = **all** their `customer_accounts`,
  including suspended/expired — a slot is occupied until the account is deleted)
  → create auth user + `profiles` + default `app_profiles`
  + `iptv_accounts` + `device_limits` + `customer_accounts { origin:'provider',
  provider_id: caller }`. Atomic: on any failure, roll back (delete the auth user)
  so no orphan login is left.
- `accounts.get` `{ userId }` → detail + bound devices.
- `accounts.update` `{ userId, deviceLimit?, expiresAt?, suspended?, note? }`
- `accounts.setPassword` `{ userId, password }`
- `accounts.updateLine` `{ userId, line }`
- `accounts.delete` `{ userId }` — deletes the auth user (cascades to
  `customer_accounts`, `device_bindings`, etc.).
- `devices.list` `{ userId }`
- `devices.revoke` `{ userId, deviceId }` → set `revoked_at`.
- `devices.unrevoke` `{ userId, deviceId }` → clear `revoked_at`.
- `devices.remove` `{ userId, deviceId }` → delete the binding (frees a slot).

**Email requirement:** GoTrue requires an email. The provider supplies a username;
if no real email is given, the function generates a stable synthetic email of the
form **`<username>@<provider-slug>.accounts.local`** (provider-slug derived from
the provider's `name`/id), stored in `profiles`/auth so username-login continues
to resolve. A real email may still be supplied and is used verbatim when present.

## Dashboard app (separate package)

- **Location:** new top-level `dashboard/` package with its own `package.json` +
  Vite config, deployed as a static site, **separate from the player bundle**.
- **Stack:** Vite + React + **TypeScript** (greenfield, isolated from the JS-only
  Expo app, so it does not violate the repo convention; types are valuable for an
  admin tool handling credentials).
- **Auth:** `supabase-js` used **only** for `signInWithPassword`. All data via
  `fetch` to the `admin` function with the Bearer JWT. On login, call `me`; if the
  user is not a provider/super-admin, reject — customers cannot get in.
- **Provider screens:**
  - **Overview** — quota `used/max`, "expiring within 7 days" count, active-device
    count.
  - **Accounts table** — search; status badge (active / expired / suspended);
    expiry; `devices used/limit`; per-row actions.
  - **Create account** — username, password, device limit, expiry presets
    (1 / 3 / 6 / 12 mo + custom), IPTV line (type toggle: Xtream fields **or** M3U
    URL).
  - **Account detail** — edit device limit; renew/extend expiry; suspend toggle;
    reset password; edit line; **devices sub-table** (platform, last-seen,
    revoked?) with revoke / re-enable / remove-slot.
- **Super-admin screens:** providers list; create/edit provider (name, quota,
  suspend); drill into a provider to view their accounts (read-mostly).
- **Styling:** a small local component set (button / table / badge / modal).
  No heavy design system in v1; can align to the Suvo tokens later.

## Code layout & testing

Per [CLAUDE.md](../../../CLAUDE.md): `node:test`, run via `npm test`; test files
sit next to source.

- `supabase/migrations/` — `providers`, `customer_accounts`, `admin_audit`
  (+ `provider_id` index).
- `supabase/functions/admin/index.ts` — the router (thin; I/O only).
- `supabase/functions/_shared/adminLogic.js` (+ `.test.js`) — **pure, unit-tested**
  decisions: role gating, provider-scope authorization, quota check, status/label
  computation, create-account input validation. Mirrors the
  [`authz.js`](../../../supabase/functions/_shared/authz.js) /
  [`loginLogic.js`](../../../supabase/functions/_shared/loginLogic.js) split.
- `supabase/functions/_shared/accountStatus.js` (+ `.test.js`) — pure
  active/expired/suspended decision, consumed by all three gates.
- `dashboard/` — the web app (component tests deferred; v1 focuses on backend
  correctness).
- `supabase/README.md` — replace the manual-SQL runbook sections with "use the
  dashboard" (keep the SQL as a break-glass appendix).

## Security notes

- All new tables `revoke all … from anon, authenticated`; reachable only via the
  `service_role` `admin` function — consistent with the 2026-07-16 hardening.
- The isolation invariant (`target.provider_id === caller` unless super-admin) is
  enforced in `adminLogic.js` and unit-tested with A-touches-B cases.
- Passwords are set via the GoTrue admin API; the dashboard never stores them.
  IPTV-line credentials are written to `iptv_accounts` exactly as the player does
  today (no new exposure).
- `admin_audit.meta` must never contain passwords or line credentials.

## Phase 2 (out of scope, noted for continuity)

In-app self-serve registration where a user picks a provider or "single", buys a
**plan** (device count + duration derived from the plan), and — when not
provider-managed — brings their own IPTV line. This reuses `customer_accounts`
(`origin='self'`, `plan_id` set, `provider_id` null) and the same status gates.
Payment (StoreKit / Google Play Billing) and plan management are a separate spec.

## Resolved decisions

- **Quota counting:** a provider's used-count includes **all** their
  `customer_accounts` — suspended and expired ones still occupy a slot until
  deleted.
- **Super-admin reach (v1):** **read-mostly** drill-in into a provider's accounts.
  Full write control over any provider's accounts is a deliberate fast-follow, not
  v1.
- **Synthetic email:** username-only accounts get
  `<username>@<provider-slug>.accounts.local`; a real email is used verbatim when
  supplied.
