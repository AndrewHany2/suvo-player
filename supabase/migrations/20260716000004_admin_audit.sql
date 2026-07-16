-- admin_audit: append-only log of dashboard mutations. meta must never contain
-- passwords or IPTV-line credentials. Reachable only via service_role.
create table if not exists public.admin_audit (
  id         bigint generated always as identity primary key,
  actor_id   uuid not null,
  action     text not null,
  target     text,
  meta       jsonb,
  created_at timestamptz not null default now()
);

alter table public.admin_audit enable row level security;
revoke all on public.admin_audit from anon, authenticated;

create index if not exists admin_audit_actor_idx on public.admin_audit (actor_id, created_at desc);
