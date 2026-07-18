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
