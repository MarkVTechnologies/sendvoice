ALTER TABLE "Document" ADD COLUMN "hostedToken" TEXT;
ALTER TABLE "Document" ADD COLUMN "hostedTokenExpiresAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Document_hostedToken_key" ON "Document"("hostedToken");

-- Same pattern as resolve_user_by_phone (auth_lookup_function migration):
-- the public hosted invoice page is looked up by a stranger with no
-- app.tenant_id, which RLS correctly blocks on the Document table directly.
-- A narrow SECURITY DEFINER function is the standard fix — it returns only
-- (document_id, tenant_id) for a valid, unexpired token, nothing else.
-- Callers use that to open a normal, RLS-scoped withTenant() query for the
-- actual invoice data, exactly like the login flow does after resolving
-- a phone number.
create or replace function resolve_document_by_token(p_token text)
returns table (document_id text, tenant_id text)
language sql
security definer
set search_path = public
as $$
  select id, "tenantId"
  from "Document"
  where "hostedToken" = p_token
    and ("hostedTokenExpiresAt" is null or "hostedTokenExpiresAt" > now())
  limit 1;
$$;

revoke all on function resolve_document_by_token(text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'sendvoice_app') then
    execute 'grant execute on function resolve_document_by_token(text) to sendvoice_app';
  end if;
end $$;
