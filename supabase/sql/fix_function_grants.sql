-- ============================================================================
-- FIX — SECURITY DEFINER functions left EXECUTE-able by anon/authenticated.
-- Surfaced by supabase/sql/audit_rls_and_grants.sql check #7 (2026-07-23).
--
-- Root cause: the original migrations did `revoke all ... from public`, but
-- Supabase's stock ALTER DEFAULT PRIVILEGES grants EXECUTE to anon,
-- authenticated, service_role INDIVIDUALLY on every function in `public`.
-- Revoking the PUBLIC pseudo-role does NOT drop those per-role grants, so the
-- intended service-role-only lockdown silently no-op'd.
--
-- Safe to apply now — none of these are called by the client (all callers are
-- service_role Edge Functions), so revoking client EXECUTE changes nothing for
-- legitimate traffic. service_role bypasses GRANTs entirely and keeps working.
-- ============================================================================

begin;

-- 1. Service-role-only RPCs: strip the leaked client EXECUTE, re-assert intent.
revoke execute on function public.hit_login_rate_limit(text, int, int)
  from anon, authenticated;
revoke execute on function public.provider_account_counts()
  from anon, authenticated;
grant  execute on function public.hit_login_rate_limit(text, int, int) to service_role;
grant  execute on function public.provider_account_counts()            to service_role;

-- 2. Trigger function: no one should hold direct EXECUTE (fires via the trigger).
revoke execute on function public.purge_library_on_user_delete()
  from anon, authenticated, public;

-- 3. create_profile — DEAD (0 repo refs; profiles are managed by the `data`
--    Edge Function under service_role now) AND dangerous (SECURITY DEFINER that
--    trusts a caller-supplied p_user_id → arbitrary-profile write past RLS).
--    Interim safe move = revoke; recommended = DROP the dead overloads.
revoke execute on function public.create_profile(uuid, text, text)
  from anon, authenticated, public;
revoke execute on function public.create_profile(text, text)
  from anon, authenticated, public;

-- ⚠️ DROP is irreversible. Uncomment only after confirming nothing (trigger,
--    view, or client build in the wild) still calls create_profile. Grep of the
--    repo on 2026-07-23 found zero references.
-- drop function if exists public.create_profile(uuid, text, text);
-- drop function if exists public.create_profile(text, text);

commit;

-- VERIFY: re-run check #7 of audit_rls_and_grants.sql — client_exec_grantees
-- for all four functions should read "(no anon/authenticated/public EXECUTE — good)".
