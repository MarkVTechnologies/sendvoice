-- One-time setup per database, run as the owner role (psql, Neon SQL editor,
-- or any client connected with MIGRATE_DATABASE_URL).
--
-- Why this exists: RLS policies (rls-policies.sql, applied as a tracked
-- migration) restrict access by tenant. But Postgres never applies RLS to a
-- table's owning role — and on Neon specifically, the default `neondb_owner`
-- role additionally has BYPASSRLS, which no ALTER TABLE ... FORCE ROW LEVEL
-- SECURITY can override. If the app connects as the owner, tenant isolation
-- silently does nothing. So the app must connect as a separate role that
-- owns nothing and has plain table grants only.
--
-- Usage: replace :'app_password' below (or pass -v app_password='...' to
-- psql) with a generated secret, then put the resulting connection string
-- in DATABASE_URL — see .env.example.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'sendvoice_app') then
    create role sendvoice_app with login password :'app_password';
  end if;
end $$;

grant usage on schema public to sendvoice_app;
grant select, insert, update, delete on all tables in schema public to sendvoice_app;
alter default privileges in schema public
  grant select, insert, update, delete on tables to sendvoice_app;
grant usage, select on all sequences in schema public to sendvoice_app;

-- Sanity check: must be false. If it's true, do not point DATABASE_URL at
-- this role — RLS will not be enforced.
select rolname, rolbypassrls from pg_roles where rolname = 'sendvoice_app';
