-- Grouped per-provider account counts for the admin dashboard's providers.list.
-- Replaces an N+1 count-per-provider loop in the Edge Function with a single
-- grouped read. SECURITY DEFINER + service-role-only EXECUTE (super-admin-only
-- data; never exposed to anon/authenticated PostgREST). Additive & idempotent.
create or replace function public.provider_account_counts()
returns table (provider_id uuid, cnt bigint)
language sql
security definer
set search_path = ''
as $$
  select provider_id, count(*)
  from public.customer_accounts
  where provider_id is not null
  group by provider_id
$$;

revoke all on function public.provider_account_counts() from public;
grant execute on function public.provider_account_counts() to service_role;
