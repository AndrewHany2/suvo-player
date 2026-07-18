# Adopt self-signup customers into the dashboard on line-add — Design

**Date:** 2026-07-18
**Status:** Approved (design)

## Problem

The one-time backfill migration (`20260718000002`) made *existing* self-signup
customers visible in the reseller dashboard by materializing a
`customer_accounts` row for each. But it is one-time: a user who self-signs up
and adds an IPTV line **after** the backfill again has no `customer_accounts`
row (the dashboard's `accounts.list` reads only that table), so they are once
more invisible under every provider and under "All providers."

**Goal:** make the visibility *ongoing* — when a self-signup end-user adds an
IPTV line in the app, they automatically become a visible, manageable customer
in the dashboard.

## Product decisions (from brainstorming)

1. **What's missing:** app self-add → dashboard consistency (not a new field, not
   multi-line-in-dashboard).
2. **Term for self-added accounts: Active, no expiry.** A self-signup user who
   adds a line becomes a **permanently active** account. This deliberately
   converts the current 7-day trial into permanent access for anyone who adds a
   line — an intentional monetization change, accepted by the owner (see
   **Monetization implication** below).

## Key architectural facts this design relies on

- The app never writes `iptv_accounts` directly. It calls the **`data` Edge
  Function** (`insertIptvAccount` → `invokeData("iptv.insert", …)`,
  `src/services/supabase.js:145`). The handler runs with the **service role**
  after verifying the JWT (`supabase/functions/data/index.ts:119`).
- Provider-created accounts go through a **different** function
  (`admin`/`accounts.create`), which already inserts a `customer_accounts` row
  (`origin='provider'`). So the app path and the provider path never collide.
- **The gate ordering is forced.** Every `data` action — including
  `iptv.insert` — runs behind `assertBoundDevice` + `assertAccountActive` +
  `assertEntitled` (`data/index.ts:29-47`). To reach `iptv.insert` a user must
  already have a bound device and an active entitlement, which means
  `claim-device` has already minted their (trial) entitlement
  (`claim-device/index.ts:70`). Therefore the order is always **claim-device
  (trial) → add line**, never the reverse — so at line-add time there is
  reliably an entitlement to reconcile.

## Approach — hook `data`/`iptv.insert` (chosen)

After the line is inserted, "adopt" the caller: the per-user version of the
`20260718000002` backfill.

**Alternatives rejected:**
- **DB trigger on `iptv_accounts` insert** — races with
  `admin.accounts.create`, which inserts the line (step 4) *before* the
  `customer_accounts` row (step 6). A trigger would create a `'self'` row that
  then collides with the provider insert (`user_id` PK) and fails account
  creation.
- **Hook `claim-device`** — claim can happen before any line exists, so it would
  adopt line-less / abandoned signups, violating the "must have a line" scope the
  backfill established, and would force the trial-vs-active fork to change for
  all self-signups.

## Mechanism

### 1. New idempotent Postgres function

`public.adopt_self_signup_account(p_user_id uuid)` — `SECURITY DEFINER`,
`set search_path = public`, `EXECUTE` revoked from `public`/`authenticated`/`anon`
(only the service role, which bypasses RLS, calls it). In one transaction it
performs the per-user backfill:

```sql
create or replace function public.adopt_self_signup_account(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 1. Adopt: only if the user has a line, has no customer_accounts row yet, and
  --    is not a provider. Active, no expiry, traceable marker note.
  insert into public.customer_accounts (user_id, origin, provider_id, expires_at, note)
  select p_user_id, 'self', null, null, 'self: added via app'
  where exists     (select 1 from public.iptv_accounts    i  where i.user_id = p_user_id)
    and not exists (select 1 from public.customer_accounts ca where ca.user_id = p_user_id)
    and not exists (select 1 from public.providers         p  where p.user_id = p_user_id)
  on conflict (user_id) do nothing;

  -- 2. Reconcile the adopted row's entitlement to active/no-expiry so the content
  --    gate agrees the account is permanently active (otherwise a lingering trial
  --    entitlement would still cut content at day 7). Never resurrects a revoked
  --    (killed) account.
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
```

Delivered as migration `supabase/migrations/20260718000003_adopt_self_signup_account_fn.sql`
(`begin; … commit;`, `create or replace` so re-running is a no-op).

### 2. Call it from `iptv.insert`, best-effort

In `supabase/functions/data/index.ts`, `case "iptv.insert"`, after the existing
line insert:

```ts
const { error: adoptErr } = await admin.rpc("adopt_self_signup_account", { p_user_id: userId });
if (adoptErr) console.error("self-signup adoption failed (non-fatal):", adoptErr.message);
```

**Non-fatal** — the line is already saved; a failure here only delays dashboard
visibility (the next line-add, or the one-time backfill, catches it). This mirrors
`claim-device`'s existing "entitlement bootstrap failed (non-fatal)" pattern
(`claim-device/index.ts:83`).

## Why this is consistent & safe

- **Idempotent:** a second line-add is a no-op — `customer_accounts` row already
  exists (`on conflict do nothing`; the `not exists` guard also holds), and the
  entitlement is already active/no-expiry.
- **Providers excluded:** same `not exists (… public.providers …)` guard as the
  backfill — a provider using the app never gets a `'self'` row.
- **Never resurrects a killed account:** the reconcile's `e.revoked_at is null`
  guard leaves admin-revoked entitlements denying (kill-switch preserved).
- **Deterministic:** the forced gate ordering guarantees an entitlement exists at
  line-add time.
- **No dashboard code changes:** the `customer_accounts` row alone makes the
  customer appear (with "—" in the Provider column, per the provider-visibility
  work) and be editable/suspendable via the existing `accounts.get` /
  `accounts.update`.
- **Consistency after the fact:** once `customer_accounts` (active/no-expiry) and
  the entitlement (active/no-expiry) both exist, a later `claim-device` sees the
  row and provisions active/no-expiry — everything stays aligned.

## Monetization implication (called out explicitly)

This makes **every self-signup user who adds a line permanently active** — the
7-day trial no longer bites for them. This is the direct, intended effect of the
"Active, no expiry" decision. If the policy should later become time-limited or
configurable, the single change point is step 1's `expires_at` (and step 2's
reconcile) in the function.

## Non-goals / edge cases

- A user whose trial **already expired** cannot self-adopt: they are blocked at
  `assertEntitled` before reaching `iptv.insert`, so the hook never runs. They
  would need admin action or a future backfill. Accepted.
- Dashboard `accounts.update` edits a **single** line; a self-user with multiple
  lines is still one dashboard customer editing one line. Out of scope.
- No entitlement row when adopt runs: cannot happen on the reachable path (the
  user passed `assertEntitled`), so step 2 always has a row to reconcile; no
  entitlement INSERT is added.
- No change to `accounts.list` / `accounts.create` / dashboard UI.

## Verification / rollout

Automated (in this repo):
- A **guardrail SQL test** for the migration (mirrors the `20260718000002` test):
  asserts the function is `security definer`, inserts `'self'` + marker note,
  is scoped (iptv line, not provider, not already-managed), reconciles bounded to
  the adopted self row with `revoked_at is null`, and revokes `execute`.
- A **content-guardrail `node:test`** asserting `data/index.ts`'s `iptv.insert`
  case invokes `adopt_self_signup_account` best-effort (non-fatal).
- `npm test` + `npm run lint` green.

Owner-run (needs deployed functions + a real device):
1. Deploy migration `20260718000003` and the `data` Edge Function.
2. Fresh self-signup → claim device → add a line in the app.
3. Confirm the customer now appears in the dashboard Accounts list with "—"
   provider, status **Active**, expiry blank; and that content plays past day 7.

Rollback: adopted rows are identifiable by `origin='self' AND provider_id IS NULL
AND note='self: added via app'`; `drop function public.adopt_self_signup_account`
and revert the `iptv.insert` call. Existing adopted rows are a safe
active/no-expiry state.
