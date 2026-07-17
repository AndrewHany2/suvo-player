-- Server-authoritative entitlements: the real boundary for demo/trial + license
-- (audit item P0-4). Enforcement (evaluateEntitlement / assertEntitled) reads
-- this table with the SERVER clock, so a value the client cannot freely choose
-- gates content — unlike the client-side demo lockout that was removed from the
-- app (commits 17d1c5c / 7e90cd9). Service-role writes only; each user reads
-- only their own row. RLS style mirrors 20260716000001_rls_close_public_read.sql.
--
-- Columns:
--   plan              descriptive: 'trial' | 'active' | 'expired' | 'blocked'
--   status            gate:        'active' | 'suspended'  (non-active denies)
--   trial_started_at  when a trial began (null for grandfathered/paid)
--   expires_at        trial/license end; NULL = no expiry (paid/active)
--   revoked_at        kill switch, mirrors device_bindings.revoked_at
--
-- ROLLOUT SAFETY: the backfill below grandfathers every EXISTING user as
-- active + no-expiry, so flipping the `data` function to enforce cannot lock out
-- current users (they already have an entitled row). Existing paid/provisioned
-- customers stay governed by the reseller gate (customer_accounts / accountStatus)
-- exactly as before; the NEW 7-day trial window applies only to NEW device claims
-- (see claim-device trial bootstrap). Apply this migration BEFORE deploying the
-- enforcing `data` function. To instead put existing users on a trial, change the
-- backfill's expires_at — but do that deliberately.

begin;

create table if not exists public.entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'trial',
  status text not null default 'active',
  trial_started_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.entitlements enable row level security;

-- Owner may read only their own row. No client INSERT/UPDATE/DELETE policy →
-- writes are service-role only (service role bypasses RLS).
drop policy if exists "own entitlement select" on public.entitlements;
create policy "own entitlement select" on public.entitlements
  for select to authenticated
  using (auth.uid() = user_id);

-- Grandfather existing users (see ROLLOUT SAFETY above). Idempotent: re-running
-- the migration never resets or re-grants an existing row.
insert into public.entitlements (user_id, plan, status, expires_at)
select id, 'active', 'active', null
from auth.users
on conflict (user_id) do nothing;

commit;
