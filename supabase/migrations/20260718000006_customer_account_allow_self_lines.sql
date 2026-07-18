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
