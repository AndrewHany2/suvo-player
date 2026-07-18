/*
  Rename the profiles display-name column: username -> name.

  `profiles.username` has held the freeform display NAME since 20260717000001
  (login is email-only; there is no username login key anymore). Keeping the
  physical name `username` was a persistent footgun — it reads like a login
  handle and collides in the head with iptv_accounts.username (a real Xtream
  credential, which is UNRELATED and stays as-is). This renames the column to
  `name` so the DB matches the API/app/dashboard, which already speak `name`.

  Because adopt_self_signup_account (20260718000003) has the old column baked
  into its body, it is re-created here to use `name`; otherwise it would error on
  its next call. All other readers/writers move to `name` in the same change set
  (admin/data Edge Functions + the app). profiles.fetch returns a `username`
  alias too, so already-installed app clients don't regress during rollout.

  DEPLOY (coordinated — do together, ideally in a quiet window): apply this
  migration AND deploy the admin + data Edge Functions. Between the two there is
  a brief window where profile name reads/writes can error (playback is NOT
  affected — it does not touch profiles).

  Idempotent: the rename is guarded on the old column still existing;
  create-or-replace is inherently re-runnable.

  ROLLBACK:
    alter table public.profiles rename column name to username;
    -- then redeploy the previous Edge Function + app build, and re-apply
    -- 20260718000003 to restore the username-based function body.
*/

begin;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'username'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'name'
  ) then
    alter table public.profiles rename column username to name;
  end if;
end $$;

create or replace function public.adopt_self_signup_account(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 0. Name the self-signup account from its auth email so it is identifiable in
  --    the dashboard. Only fills a missing/blank name — never overwrites an
  --    admin-set name. Same scope as adoption (has a line, not a provider).
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
