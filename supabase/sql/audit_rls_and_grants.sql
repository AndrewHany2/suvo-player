-- ============================================================================
-- READ-ONLY SECURITY AUDIT — "each user sees only their own data" + least
-- privilege. Run in the Supabase SQL editor (or `supabase db execute`). It
-- makes NO changes; every statement is a SELECT. Reads the LIVE catalog, so it
-- covers the Studio-managed policies that are NOT in supabase/migrations/**.
--
-- What "green" looks like is documented above each query. Anything that
-- deviates is called out in the WHERE clause (the query returns ONLY problems
-- for checks 1, 2, 5, 6, 8; checks 3/4/7 dump full state for eyeballing).
-- ============================================================================

-- ── 1. RLS ENABLED on every table in `public`? ──────────────────────────────
-- Isolation is only enforced when RLS is ON. Expect: ZERO rows.
select 'RLS_DISABLED' as issue, n.nspname as schema, c.relname as table
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and not c.relrowsecurity
order by c.relname;

-- ── 2. FORCE RLS on the user-data tables? ───────────────────────────────────
-- Without FORCE, the table OWNER role bypasses RLS. service_role bypasses via
-- BYPASSRLS regardless, so this is defense-in-depth, not required — informational.
-- Expect: rows here are "consider forcing", not a breach.
select 'RLS_NOT_FORCED' as note, c.relname as table
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relrowsecurity
  and not c.relforcerowsecurity
  and c.relname in ('profiles','app_profiles','iptv_accounts','watch_history','favorites')
order by c.relname;

-- ── 3. EVERY policy, with its roles + USING/CHECK expression ────────────────
-- Eyeball this. For the 5 user-data tables, the `qual` (USING) and `with_check`
-- MUST scope to the caller — e.g. `(auth.uid() = user_id)` — for roles
-- {authenticated} (or {public}). A qual of `true` for anon/authenticated/public
-- on a user-data table = cross-tenant read/write hole.
select
  c.relname                as table,
  p.polname                as policy,
  case p.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT'
                when 'w' then 'UPDATE' when 'd' then 'DELETE'
                when '*' then 'ALL' end as command,
  coalesce(
    (select array_agg(r.rolname order by r.rolname)
     from pg_roles r where r.oid = any(p.polroles)),
    array['PUBLIC']
  )                        as roles,
  pg_get_expr(p.polqual,       p.polrelid) as using_expr,
  pg_get_expr(p.polwithcheck,  p.polrelid) as check_expr
from pg_policy p
join pg_class c on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
order by c.relname, p.polname;

-- ── 4. DANGEROUS policies: permissive `true` (or NULL qual) for a client role ─
-- `true`/NULL USING on SELECT, or `true`/NULL WITH CHECK on write, granted to
-- anon/authenticated/public, means "any authenticated user, any row".
-- Expect: ZERO rows (RLS-enabled tables reachable by clients must be scoped).
select
  c.relname as table,
  p.polname as policy,
  case p.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT'
                when 'w' then 'UPDATE' when 'd' then 'DELETE'
                when '*' then 'ALL' end as command,
  coalesce(
    (select array_agg(r.rolname order by r.rolname)
     from pg_roles r where r.oid = any(p.polroles)),
    array['PUBLIC']
  ) as roles
from pg_policy p
join pg_class c on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and (
        p.polroles = '{0}'  -- PUBLIC
     or exists (select 1 from pg_roles r
                where r.oid = any(p.polroles)
                  and r.rolname in ('anon','authenticated'))
      )
  and (
        (p.polcmd in ('r','*') and (p.polqual      is null or pg_get_expr(p.polqual,      p.polrelid) = 'true'))
     or (p.polcmd in ('a','w','*') and (p.polwithcheck is null or pg_get_expr(p.polwithcheck, p.polrelid) = 'true'))
      )
order by c.relname, p.polname;

-- ── 5. LEAST PRIVILEGE: table privileges held by anon / authenticated ───────
-- The target end-state (after the functions-only client ships everywhere and
-- supabase/sql/revoke_table_grants.sql is applied) is: anon/authenticated hold
-- NO direct DML on the 5 user-data tables — all access goes through the
-- service_role Edge Functions. Until then, expect rows for
-- profiles/app_profiles/iptv_accounts/watch_history/favorites ONLY.
--
-- ANY row for a control table (device_bindings, device_limits, providers,
-- customer_accounts, admin_audit, entitlements, login_rate_limit) is a
-- least-privilege regression — those must have NO client grants.
select
  table_name,
  grantee,
  string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon','authenticated')
group by table_name, grantee
order by
  case when table_name in
    ('profiles','app_profiles','iptv_accounts','watch_history','favorites')
  then 1 else 0 end,   -- control-table rows (=0) float to the TOP as red flags
  table_name, grantee;

-- ── 6. PUBLIC (implicit) grants on tables — should be gone ──────────────────
-- `grant ... to public` leaks to every role including anon. Expect: ZERO rows.
select table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee = 'PUBLIC'
order by table_name, privilege_type;

-- ── 7. SECURITY DEFINER functions: search_path pinned + EXECUTE locked down ──
-- SECURITY DEFINER runs as the owner and BYPASSES RLS, so each must (a) pin
-- search_path (empty or explicit — else search_path hijacking) and (b) not be
-- EXECUTE-able by anon/authenticated unless intended. claim_device /
-- hit_login_rate_limit / provider_account_counts / adopt_self_signup_account
-- should be service_role-only. Eyeball `search_path` and `exec_grantees`.
select
  p.proname as function,
  pg_get_function_identity_arguments(p.oid) as args,
  coalesce(array_to_string(p.proconfig, ', '), '(none — search_path NOT pinned!)') as config,
  coalesce(
    (select string_agg(distinct g.grantee, ', ')
     from information_schema.role_routine_grants g
     where g.specific_schema = 'public'
       and g.routine_name = p.proname
       and g.grantee in ('anon','authenticated','public')),
    '(no anon/authenticated/public EXECUTE — good)'
  ) as client_exec_grantees
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
order by p.proname;

-- ── 8. Views that might leak past RLS (SECURITY DEFINER / non-invoker views) ─
-- A view owned by a privileged role reads with the owner's rights unless it is
-- `security_invoker=true`. Expect: review any row; a view over user-data tables
-- should be security_invoker or not exposed to clients.
select c.relname as view,
       coalesce((select option_value
                 from pg_options_to_table(c.reloptions)
                 where option_name = 'security_invoker'), 'false') as security_invoker
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'v'
order by c.relname;
