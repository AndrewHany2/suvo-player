-- customer_accounts: subscription state + origin for every customer login.
-- origin/provider_id/plan_id future-proof the Phase-2 self-serve channel but are
-- unused by Phase-1 code beyond provider_id. Additive & idempotent. Reachable
-- only via service_role Edge Functions.
create table if not exists public.customer_accounts (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  origin      text not null default 'provider' check (origin in ('provider','self')),
  provider_id uuid references public.providers(user_id) on delete restrict,
  plan_id     uuid,
  expires_at  timestamptz,
  suspended   boolean not null default false,
  created_at  timestamptz not null default now(),
  note        text
);

alter table public.customer_accounts enable row level security;
revoke all on public.customer_accounts from anon, authenticated;

create index if not exists customer_accounts_provider_idx
  on public.customer_accounts (provider_id);
