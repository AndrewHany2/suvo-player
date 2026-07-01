-- Admin-configurable device count per account.
-- Replaces the single-device (user_id PK) model with N-devices-per-account,
-- gated by a per-account override (device_limits) atop a global default
-- (DEVICE_LIMIT_DEFAULT env var, passed into claim_device). Additive &
-- idempotent — safe to re-apply against the existing schema. Existing bound
-- rows survive the PK swap.

-- 1. device_bindings: allow N devices per user.
-- Add a surrogate id, drop the single-device user_id PK, promote id to PK,
-- and enforce one row per (user_id, device_id).
alter table public.device_bindings
  add column if not exists id uuid not null default gen_random_uuid();

alter table public.device_bindings
  drop constraint if exists device_bindings_pkey;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'device_bindings_pkey'
  ) then
    alter table public.device_bindings add primary key (id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'device_bindings_user_device_uniq'
  ) then
    alter table public.device_bindings
      add constraint device_bindings_user_device_uniq unique (user_id, device_id);
  end if;
end $$;

-- 2. Per-account overrides. No row => account uses the global default.
create table if not exists public.device_limits (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  device_limit int  not null check (device_limit >= 1)
);

alter table public.device_limits enable row level security;

-- Reachable only via service_role Edge Functions.
revoke all on public.device_limits from anon, authenticated;

-- 3. Race-safe claim. Serializes concurrent claims for one account via an
-- advisory lock so two devices cannot both take the last slot. Access uses the
-- PRIMARY anchor (device_id) only; secondary_fp is stored but never gates.
create or replace function public.claim_device(
  p_user_id       uuid,
  p_device_id     text,
  p_platform      text,
  p_secondary     jsonb,
  p_label         text,
  p_default_limit int
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit int;
  v_count int;
begin
  if p_device_id is null or p_device_id = '' then
    return 'denied';
  end if;

  -- serialize concurrent claims for this account
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  -- known device: refresh last_seen and allow
  if exists (
    select 1 from public.device_bindings
    where user_id = p_user_id and device_id = p_device_id
  ) then
    update public.device_bindings
      set last_seen_at = now()
      where user_id = p_user_id and device_id = p_device_id;
    return 'ok';
  end if;

  v_limit := coalesce(
    (select device_limit from public.device_limits where user_id = p_user_id),
    p_default_limit
  );

  select count(*) into v_count
    from public.device_bindings
    where user_id = p_user_id;

  if v_count < v_limit then
    insert into public.device_bindings
      (user_id, device_id, platform, secondary_fp, label, last_seen_at)
      values (p_user_id, p_device_id, p_platform, p_secondary, p_label, now());
    return 'bound';
  end if;

  return 'denied';
end;
$$;

revoke all on function public.claim_device(uuid, text, text, jsonb, text, int)
  from anon, authenticated;
