-- Per-account isolation for the library. Additive & idempotent — safe against
-- the existing (dashboard-managed) watch_history / favorites tables.
--
-- account_key partitions a profile's library by the IPTV account it was saved
-- from. Legacy rows default to '' and never match a real account_key, so they
-- are hidden until re-saved. The old (user_key, entry_id) unique must go: it
-- would forbid two accounts under one profile from holding the same entry_id.

alter table public.watch_history add column if not exists account_key text not null default '';
alter table public.favorites     add column if not exists account_key text not null default '';

-- Drop any UNIQUE constraint or standalone unique index defined on exactly
-- (user_key, entry_id) for each table (the dashboard-created name is unknown).
do $$
declare
  r record;
begin
  for r in
    select tc.table_name, tc.constraint_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = tc.constraint_name
     and kcu.table_schema = tc.table_schema
    where tc.table_schema = 'public'
      and tc.table_name in ('watch_history', 'favorites')
      and tc.constraint_type = 'UNIQUE'
    group by tc.table_name, tc.constraint_name
    having array_agg(kcu.column_name order by kcu.column_name) = array['entry_id','user_key']
  loop
    execute format('alter table public.%I drop constraint %I', r.table_name, r.constraint_name);
  end loop;

  for r in
    select i.relname as idx
    from pg_index x
    join pg_class i on i.oid = x.indexrelid
    join pg_class t on t.oid = x.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname in ('watch_history', 'favorites')
      and x.indisunique
      and not exists (select 1 from pg_constraint c where c.conindid = x.indexrelid)
      and (
        select array_agg(a.attname order by a.attname)
        from unnest(x.indkey) k
        join pg_attribute a on a.attrelid = t.oid and a.attnum = k
      ) = array['entry_id','user_key']
  loop
    execute format('drop index if exists public.%I', r.idx);
  end loop;
end $$;

create unique index if not exists watch_history_user_account_entry_uidx
  on public.watch_history (user_key, account_key, entry_id);
create unique index if not exists favorites_user_account_entry_uidx
  on public.favorites (user_key, account_key, entry_id);
