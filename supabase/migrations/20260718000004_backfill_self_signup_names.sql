/*
  One-time: name EXISTING adopted self-signup accounts from their auth email.

  The 20260718000002 backfill adopted self-signup customers into
  customer_accounts but left them nameless (self-signups have no profiles row at
  all), so in the dashboard they render with a blank, unsearchable name and their
  type-to-confirm delete dialog has nothing to type against. Going forward,
  adopt_self_signup_account (20260718000003) names accounts as they are adopted;
  this migration covers the ones already adopted before that shipped.

  Only fills a missing/blank name — never overwrites an admin-set or provider
  name (coalesce(nullif(...))). Providers are excluded. Idempotent: re-running is
  a no-op.

  PREVIEW (run BEFORE applying; read-only — how many will be named):
    select count(*)
    from public.customer_accounts ca
    join auth.users u on u.id = ca.user_id
    left join public.profiles p on p.user_id = ca.user_id
    where ca.origin = 'self' and ca.provider_id is null and u.email is not null
      and coalesce(nullif(p.username, ''), null) is null
      and not exists (select 1 from public.providers pr where pr.user_id = ca.user_id);

  ROLLBACK: none needed — this sets a display label only. To change a specific
  name afterward, edit it in the dashboard (accounts.update).
*/

begin;

insert into public.profiles as p (user_id, username, email)
select ca.user_id, u.email, u.email
from public.customer_accounts ca
join auth.users u on u.id = ca.user_id
where ca.origin = 'self'
  and ca.provider_id is null
  and u.email is not null
  and not exists (select 1 from public.providers pr where pr.user_id = ca.user_id)
on conflict (user_id) do update
  set username = coalesce(nullif(p.username, ''), excluded.username),
      email    = coalesce(p.email, excluded.email);

commit;
