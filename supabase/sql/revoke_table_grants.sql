-- ⚠️ DEFERRED — DO NOT run until the functions-based client build is RELEASED.
-- Intentionally NOT in supabase/migrations/ so `supabase db push` cannot apply
-- it prematurely. Revoking these grants instantly breaks the currently-shipped
-- (direct-table) app for all users until they update to the functions build.
--
-- Run manually (SQL editor) only AFTER the new client is live everywhere:
revoke all on public.profiles       from anon, authenticated;
revoke all on public.app_profiles   from anon, authenticated;
revoke all on public.iptv_accounts  from anon, authenticated;
revoke all on public.watch_history  from anon, authenticated;
revoke all on public.favorites      from anon, authenticated;
-- RLS stays enabled as defense-in-depth; the Edge Functions use service_role.
