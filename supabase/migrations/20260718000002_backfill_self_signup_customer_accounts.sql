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
