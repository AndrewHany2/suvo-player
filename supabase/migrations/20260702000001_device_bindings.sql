-- Device binding: one account = one device, enforced server-side.
-- user_id is the PRIMARY KEY, so the database physically cannot hold more than
-- one device per account. Additive & idempotent — safe to apply against an
-- existing (dashboard-managed) schema.
create table if not exists public.device_bindings (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  device_id     text not null,
  platform      text,
  label         text,
  secondary_fp  jsonb,
  attest_key_id text,
  attest_pubkey text,
  bound_at      timestamptz not null default now(),
  last_seen_at  timestamptz
);

alter table public.device_bindings enable row level security;

-- No anon/authenticated policies on purpose: this table is reachable only via
-- service_role Edge Functions (claim-device / data).
revoke all on public.device_bindings from anon, authenticated;
