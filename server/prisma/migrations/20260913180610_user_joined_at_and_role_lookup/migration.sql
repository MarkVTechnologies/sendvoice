-- PRD §8.1 P1: multi-user with roles. NULL = invited but never logged in.
ALTER TABLE "User" ADD COLUMN     "joinedAt" TIMESTAMP(3);

-- Backfill: every existing user got here by actually logging in (invites
-- didn't exist before this migration), so they're all active as of now.
UPDATE "User" SET "joinedAt" = "createdAt" WHERE "joinedAt" IS NULL;

-- resolve_user_by_phone must also return `role` now — services/auth.ts's
-- login path needs it to embed in the JWT (routes/auth.ts signs it
-- directly), so a role check doesn't need a second DB round trip on every
-- authenticated request. Postgres requires DROP + CREATE (not
-- CREATE OR REPLACE) when a function's return-table shape changes.
drop function if exists resolve_user_by_phone(text);

create function resolve_user_by_phone(p_phone text)
returns table (user_id text, tenant_id text, role text)
language sql
security definer
set search_path = public
as $$
  select id, "tenantId", role::text from "User" where phone = p_phone limit 1;
$$;

revoke all on function resolve_user_by_phone(text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'sendvoice_app') then
    execute 'grant execute on function resolve_user_by_phone(text) to sendvoice_app';
  end if;
end $$;
