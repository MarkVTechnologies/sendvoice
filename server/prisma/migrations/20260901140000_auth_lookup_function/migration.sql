-- Login needs to answer "which tenant does this phone number belong to?"
-- before app.tenant_id can be set — an inherently cross-tenant lookup that
-- RLS (correctly) blocks for the restricted app role. Loosening the User
-- table's SELECT policy to allow this would expose every user row whenever
-- app.tenant_id happens to be unset, which is exactly the mistake RLS is
-- supposed to prevent.
--
-- The standard fix: a narrow SECURITY DEFINER function, owned by the table
-- owner (who bypasses RLS), that returns only what auth needs — the user id
-- and tenant id for one phone number — nothing else about the row, and
-- nothing about any other row.
create or replace function resolve_user_by_phone(p_phone text)
returns table (user_id text, tenant_id text)
language sql
security definer
set search_path = public
as $$
  select id, "tenantId" from "User" where phone = p_phone limit 1;
$$;

revoke all on function resolve_user_by_phone(text) from public;

-- Conditional: on a fresh environment this migration may run before
-- prisma/create-app-role.sql has created the role. Re-run this grant by hand
-- if so: grant execute on function resolve_user_by_phone(text) to sendvoice_app;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'sendvoice_app') then
    execute 'grant execute on function resolve_user_by_phone(text) to sendvoice_app';
  end if;
end $$;
