-- M3U lines have no host/username/password — only a playlist `url`. The original
-- iptv_accounts table was built Xtream-only, so those three columns are NOT NULL;
-- the 2026-07-08 M3U migration (20260708000001) added `type`/`url` but never
-- relaxed them. Inserting an M3U line (host/username/password = NULL) therefore
-- violates NOT NULL and 500s the admin Edge Function's `accounts.addLine`
-- (supabase/functions/admin/index.ts) — and silently fails the app's own
-- `iptv.insert` (supabase/functions/data/index.ts) which ignores the error.
--
-- Make the Xtream-only credentials nullable so M3U rows are valid. Idempotent:
-- DROP NOT NULL is a no-op if the constraint is already absent.
alter table if exists public.iptv_accounts
  alter column host     drop not null,
  alter column username drop not null,
  alter column password drop not null;
