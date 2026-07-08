-- Add M3U-playlist source support to iptv_accounts.
--
-- `type` discriminates the source backend: 'xtream' (default, host+username+
-- password) or 'm3u' (a playlist URL). `url` holds that playlist URL for m3u
-- rows and is null for xtream rows. Existing rows backfill to 'xtream' via the
-- default. Idempotent so it is safe to re-run.
alter table if exists public.iptv_accounts
  add column if not exists type text not null default 'xtream',
  add column if not exists url  text;
