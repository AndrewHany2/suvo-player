-- Bound login_rate_limit growth. The public (verify_jwt=false) login Edge
-- Function inserts one row per distinct (ip, email) key BEFORE authenticating,
-- and both the client IP (spoofable x-forwarded-for) and the email are
-- attacker-controllable. An attacker spraying distinct spoofed IPs / emails
-- creates a fresh row per key that stays at attempts=1, never trips a limit,
-- and (per the original migration) was only ever cleaned "if desired" via a
-- commented pg_cron suggestion — i.e. never. Rows are tiny, so this is a
-- storage/cost nuisance, not a breach, but it is unbounded on an unauthenticated
-- endpoint.
--
-- Fix without depending on pg_cron being enabled in the project: prune inside
-- hit_login_rate_limit itself, opportunistically and in a bounded batch, so each
-- call does O(1)-ish cleanup and can never block on a full-table delete. An
-- index on window_start keeps the eviction lookup cheap at any table size.
-- Additive & idempotent; re-defines the function from 20260717000002.

create index if not exists login_rate_limit_window_start_idx
  on public.login_rate_limit (window_start);

create or replace function public.hit_login_rate_limit(
  p_key text, p_max int, p_window_seconds int
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts int;
begin
  -- Opportunistic bounded prune: evict up to 100 rows whose window expired long
  -- ago (older than 24 windows). LIMIT + the window_start index keep this cheap
  -- and non-blocking even when the table is large.
  delete from public.login_rate_limit
  where ctid in (
    select ctid from public.login_rate_limit
    where window_start < now() - make_interval(secs => p_window_seconds * 24)
    limit 100
  );

  insert into public.login_rate_limit as l (key, attempts, window_start)
  values (p_key, 1, now())
  on conflict (key) do update
    set attempts = case
          when l.window_start < now() - make_interval(secs => p_window_seconds) then 1
          else l.attempts + 1
        end,
        window_start = case
          when l.window_start < now() - make_interval(secs => p_window_seconds) then now()
          else l.window_start
        end
  returning l.attempts into v_attempts;
  return v_attempts <= p_max;
end $$;

-- create or replace preserves grants, but be explicit and idempotent.
revoke all on function public.hit_login_rate_limit(text, int, int) from public;
grant execute on function public.hit_login_rate_limit(text, int, int) to service_role;
