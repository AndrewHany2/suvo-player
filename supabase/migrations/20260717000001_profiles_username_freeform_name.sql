-- profiles.username is now a freeform display NAME, not a login key. Email-only
-- login (the `login` Edge Function) no longer reads it, so its uniqueness is both
-- unnecessary AND harmful: duplicate names must be allowed. Free the column by
-- dropping any single-column UNIQUE constraint / UNIQUE index on `username` and
-- its NOT NULL. Idempotent + re-runnable (catalog-driven, drop-if-exists).
-- The table is Studio-managed, so constraint/index names are unknown here.
begin;

-- 1. Drop UNIQUE *constraints* whose single key column is `username`.
do $$
declare
  c record;
  uname_attnum smallint;
begin
  select attnum into uname_attnum
  from pg_attribute
  where attrelid = 'public.profiles'::regclass
    and attname = 'username' and not attisdropped;

  if uname_attnum is not null then
    for c in
      select conname
      from pg_constraint
      where conrelid = 'public.profiles'::regclass
        and contype = 'u'
        and conkey = array[uname_attnum]
    loop
      execute format('alter table public.profiles drop constraint %I', c.conname);
    end loop;
  end if;
end $$;

-- 2. Drop single-column UNIQUE *indexes* on `username` not backed by a constraint.
do $$
declare i record;
begin
  for i in
    select pg_index.indexrelid::regclass::text as idx
    from pg_index
    where pg_index.indrelid = 'public.profiles'::regclass
      and pg_index.indisunique
      and pg_index.indnatts = 1
      and not pg_index.indisprimary
      and pg_index.indkey[0] = (
        select attnum from pg_attribute
        where attrelid = 'public.profiles'::regclass
          and attname = 'username' and not attisdropped
      )
  loop
    execute format('drop index if exists %s', i.idx);
  end loop;
end $$;

-- 3. Allow NULL (no-op if already nullable).
alter table public.profiles alter column username drop not null;

commit;
