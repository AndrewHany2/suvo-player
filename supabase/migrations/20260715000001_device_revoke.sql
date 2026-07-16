-- Server-side kill switch for a bound device. Setting revoked_at on a binding
-- makes that known device return 'denied' from claim_device on its next claim,
-- routing it to the existing device-locked path. Additive & idempotent — safe
-- to re-apply against the existing schema; existing bound rows keep working
-- (revoked_at defaults to NULL = not revoked).

-- 1. device_bindings: nullable revoke timestamp. NULL => active.
alter table public.device_bindings
  add column if not exists revoked_at timestamptz;

-- 2. Race-safe claim, now revoke-aware. Identical to the prior definition
-- except the known-device branch denies when revoked_at is set.
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

  -- known device: deny if revoked, else refresh last_seen and allow
  if exists (
    select 1 from public.device_bindings
    where user_id = p_user_id and device_id = p_device_id
  ) then
    if exists (
      select 1 from public.device_bindings
      where user_id = p_user_id and device_id = p_device_id
        and revoked_at is not null
    ) then
      return 'denied';
    end if;
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
