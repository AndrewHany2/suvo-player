-- Close two public-read RLS holes on the direct-PostgREST path (2026-07-16 audit).
--
-- RLS is ON for all app tables, and iptv_accounts / watch_history / app_profiles
-- are correctly owner-scoped. Two tables were NOT, via dashboard-created policies:
--
--   1. profiles  — had SELECT policies with `using (true)` for role `public`
--      ("public username lookup", "Profiles are publicly readable"). That lets
--      anyone hit `GET /rest/v1/profiles?select=email` and enumerate every user's
--      email/username directly — which silently defeats the login Edge Function's
--      email-enumeration fix. No client code reads `profiles`; the only reader is
--      the login function, which uses the service role and bypasses RLS. So the
--      public SELECT is pure legacy cruft — drop it, keep an owner-scoped read.
--
--   2. favorites — had `using (true)` / `with check (true)` for role `public`,
--      so any user could read AND write everyone else's favorites. Re-scope it to
--      the owner, mirroring the existing watch_history policy (user_key = the
--      caller, or one of the caller's app_profiles sub-profiles).
--
-- Independent of the pending grant-revoke sequence (revoke_table_grants.sql);
-- this only tightens row visibility and is safe to apply on its own.
--
-- NOTE: leftover duplicate INSERT/UPDATE policies on profiles ("own profile
-- insert" / "own profile update") are harmless redundancy and left untouched to
-- keep this migration surgical; dedupe separately if desired.

begin;

-- Defensive: these are already enabled, but keep the migration self-contained.
alter table public.profiles  enable row level security;
alter table public.favorites enable row level security;

-- 1. profiles: remove public read; allow owner-only read.
drop policy if exists "public username lookup"         on public.profiles;
drop policy if exists "Profiles are publicly readable"  on public.profiles;
drop policy if exists "own profile select"              on public.profiles;
create policy "own profile select" on public.profiles
  for select to authenticated
  using (auth.uid() = user_id);

-- 2. favorites: replace wide-open policy with owner-scoping (mirrors watch_history).
drop policy if exists "users manage own favorites" on public.favorites;
create policy "users manage own favorites" on public.favorites
  for all to authenticated
  using (
    user_key = (auth.uid())::text
    or user_key in (
      select (app_profiles.id)::text
      from public.app_profiles
      where app_profiles.user_id = auth.uid()
    )
  )
  with check (
    user_key = (auth.uid())::text
    or user_key in (
      select (app_profiles.id)::text
      from public.app_profiles
      where app_profiles.user_id = auth.uid()
    )
  );

commit;
