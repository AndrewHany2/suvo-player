# Backfill `customer_accounts` for self-signup customers — Design

**Date:** 2026-07-18
**Status:** Approved (design)

## Problem

The reseller dashboard's account list (`admin` Edge Function, `accounts.list`) reads
**only** from `public.customer_accounts`. The single insert path for that table is
`accounts.create` (the dashboard "New account" flow, `supabase/functions/admin/index.ts:246`).

Any customer who did **not** come through the dashboard — self-signup through the app,
or a login predating the reseller system — has **no `customer_accounts` row** and is
therefore invisible in the dashboard: not under any provider, and not under "All
providers." `claim-device` already treats "no `customer_accounts` row" as a self-signup
account (`supabase/functions/claim-device/index.ts:56`).

**Goal:** make these self-signup customers fully manageable in the dashboard (edit,
suspend, set expiry) by backfilling a `customer_accounts` row for each — **without
changing any customer's current access**.

## Scope

Backfill a `customer_accounts` row for every `auth.users` row where **all** hold:

1. **Not a provider/super-admin** — no matching `public.providers.user_id`.
2. **Not already managed** — no existing `public.customer_accounts.user_id`.
3. **Is a real customer** — has ≥1 `public.iptv_accounts` line (`user_id`).

This deliberately excludes empty/abandoned signups that never configured a line.

Out of scope: any change to `accounts.list`, `accounts.update`, `accounts.create`, the
dashboard UI, or the provider-filter behavior. This is a one-time data backfill only.

## Backfilled row values

| Column        | Value                                                             |
|---------------|-------------------------------------------------------------------|
| `user_id`     | the customer's auth id                                            |
| `origin`      | `'self'`                                                          |
| `provider_id` | `NULL` (unattributed — appears under "All providers", "—" column) |
| `expires_at`  | the customer's **current** `entitlements.expires_at` (NULL if grandfathered or if no entitlement row) |
| `note`        | `'backfill: self-signup adopted'` (traceable / reversible marker) |

`plan_id` left NULL (unused in Phase 1). `suspended` defaults to `false`.

## Why access is preserved (the correctness argument)

Content requires **both** gates to pass, AND-combined:
- `assertAccountActive` → reads `customer_accounts` via `accountStatus` (`data/index.ts:30`, `deviceGate.ts:133`).
- `assertEntitled` → reads `entitlements` (`data/index.ts:47`).

Login uses `accountStatus` alone (`login/index.ts:65`). `accountStatus(null,…)` returns
`ACTIVE` (fails **open** on a missing row); `evaluateEntitlement(null,…)` fails **closed**.

By setting `customer_accounts.expires_at` to the value the entitlement already carries,
both gates deny at the identical instant they do today:

| Group | entitlement today | backfilled `expires_at` | net access change |
|---|---|---|---|
| Grandfathered (present at `20260717000004`) | active / null | NULL | none — stays active |
| Mid-trial (post-migration signup, within 7d) | active / trial-end **T** | **T** | none — same deadline |
| Expired / suspended / revoked entitlement | denies content | past date / NULL | none — entitlement still denies content |
| Line but **no** entitlement row (never claimed) | content fail-closed (denied) | NULL | none — login already open; content stays denied until first claim provisions it |

**Only observable shift:** a mid-trial user, *after* T, is now blocked at **login** (not
just content). Same "no access," same deadline, slightly earlier surface. No customer
loses access earlier than today.

## Entitlement reconciliation (mid-trial subset) — Option B

For backfilled rows whose entitlement is currently **genuinely active and future-dated**
(`status = 'active'` AND `revoked_at IS NULL` AND `expires_at > now()`), also set that
entitlement to `status='active', expires_at=NULL`.

Rationale: this makes `customer_accounts.expires_at` (= T) the **single source of truth**
for that account's term — exactly how provider-created accounts already behave
(claim-device provisions provider-origin accounts as active/no-expiry; the reseller gate
enforces the term). Consequences:

- Access still preserved: the login + content `assertAccountActive` gate now carries T,
  so denial still happens at T.
- Future dashboard **renewal works**: extending `customer_accounts.expires_at` actually
  moves the effective deadline (no entitlement-gate drift).

**Strictly bounded:** the reconcile UPDATE must touch **only** rows that are
`status='active' AND revoked_at IS NULL AND expires_at > now()` **and** are in the
just-backfilled set (`origin='self'`, `note='backfill: self-signup adopted'`,
`provider_id IS NULL`). It must **never** touch suspended, revoked, or expired
entitlements (those must keep denying), and never touch provider-origin accounts.

## Delivery

A single idempotent SQL migration
`supabase/migrations/20260718000002_backfill_self_signup_customer_accounts.sql`, following
the established pattern of the entitlements grandfather migration (which likewise reads
`auth.users` directly). Wrapped in `begin; … commit;`.

### Migration shape

```sql
begin;

-- 1. Backfill customer_accounts for self-signup customers with a line.
insert into public.customer_accounts (user_id, origin, provider_id, expires_at, note)
select u.id, 'self', null, ent.expires_at, 'backfill: self-signup adopted'
from auth.users u
left join public.entitlements ent on ent.user_id = u.id
where exists     (select 1 from public.iptv_accounts    i  where i.user_id  = u.id)
  and not exists (select 1 from public.customer_accounts ca where ca.user_id = u.id)
  and not exists (select 1 from public.providers         p  where p.user_id  = u.id)
on conflict (user_id) do nothing;

-- 2. Reconcile ONLY genuinely-active, future-dated entitlements for the rows we just
--    adopted, so customer_accounts.expires_at becomes the single source of truth.
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

Idempotency: step 1 is guarded by `not exists` + `on conflict do nothing`; step 2, on a
re-run, matches nothing new because reconciled rows now have `expires_at IS NULL` (the
`expires_at is not null` predicate excludes them). Re-running the migration is a no-op.

### Preview query (run BEFORE applying)

A standalone read-only query committed alongside the migration (as a comment block or a
`docs`/`scripts` snippet) that reports the exact impact:

```sql
-- How many rows will be backfilled, and a breakdown by expiry disposition.
select
  count(*)                                                as total_to_backfill,
  count(*) filter (where ent.expires_at is null)          as as_no_expiry,
  count(*) filter (where ent.expires_at > now())          as as_future_dated_midtrial,
  count(*) filter (where ent.expires_at <= now())         as as_already_expired
from auth.users u
left join public.entitlements ent on ent.user_id = u.id
where exists     (select 1 from public.iptv_accounts    i  where i.user_id  = u.id)
  and not exists (select 1 from public.customer_accounts ca where ca.user_id = u.id)
  and not exists (select 1 from public.providers         p  where p.user_id  = u.id);
```

## Verification / rollout

1. Run the preview query on the live DB; confirm counts look sane.
2. Apply the migration.
3. Re-run the preview query → expect `total_to_backfill = 0` (idempotency proven).
4. Spot-check the dashboard: a grandfathered account (status ACTIVE, no expiry, provider
   "—") and, if any, a mid-trial account (status ACTIVE, expiry = its trial end).
5. Confirm a suspended/revoked/expired self-signup account still shows the correct
   non-active status and that its content access is still denied.

Rollback (if ever needed): the adopted rows are identifiable by
`origin='self' AND provider_id IS NULL AND note='backfill: self-signup adopted'`.
Deleting them restores the prior "invisible self-signup" state, though the step-2
entitlement reconciliation is not automatically reversed (those accounts would simply be
active/no-expiry, which is a safe, access-preserving state).

## Non-goals / known follow-ups

- `accounts.update` does **not** reconcile `entitlements` today. After this backfill, all
  adopted accounts have `entitlements` at active/no-expiry, so `customer_accounts.expires_at`
  governs them correctly (same as provider accounts) — no `accounts.update` change is
  required for the adopted set. A general "expiry edits should sync entitlements" hardening
  is out of scope here.
- No UI change: unattributed accounts already render with "—" in the Provider column and
  are editable/suspendable via existing `accounts.get` / `accounts.update`.
