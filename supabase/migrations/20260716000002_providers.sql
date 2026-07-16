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
