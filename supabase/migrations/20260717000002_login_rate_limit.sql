-- Brute-force throttle for the `login` Edge Function. The function verifies the
-- password server-side (anon signInWithPassword), so GoTrue sees the FUNCTION's
-- egress IP, not the caller's — its per-IP limit can't protect an account. This
-- re-establishes throttling: a fixed-window counter the function hits (via the
-- service role) once per key per attempt, keyed on the real client IP AND the
-- target email. Additive & idempotent. Reachable only via the SECURITY DEFINER
-- function below (never anon/authenticated PostgREST).
create table if not exists public.login_rate_limit (
  key          text primary key,
  attempts     int  not null default 0,
  window_start timestamptz not null default now()
);

alter table public.login_rate_limit enable row level security;
revoke all on public.login_rate_limit from anon, authenticated;

-- Atomically bump the counter for `p_key` and report whether the attempt is
-- within the limit. Fixed window: the window resets p_window_seconds after its
-- FIRST hit (so a flood can't extend the lockout). Returns TRUE when ALLOWED,
-- FALSE when the limit is exceeded. SECURITY DEFINER (runs as the owner) so the
-- caller needs only EXECUTE, not table access.
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

-- Only the service role (the Edge Function) may call it — not anon/authenticated,
-- who could otherwise grief-lock an arbitrary email or IP.
revoke all on function public.hit_login_rate_limit(text, int, int) from public;
grant execute on function public.hit_login_rate_limit(text, int, int) to service_role;

-- NOTE: rows accumulate one per distinct key seen. They are tiny; prune stale
-- ones periodically if desired, e.g. a daily pg_cron job:
--   delete from public.login_rate_limit where window_start < now() - interval '1 day';
