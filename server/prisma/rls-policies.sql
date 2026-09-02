-- Row-level tenant isolation — PRD §9.2 / §12: "every query is tenant-scoped
-- by construction, not by developer discipline."
--
-- This is NOT auto-applied. After the first `prisma migrate dev` creates the
-- initial migration from schema.prisma, copy this file's contents into a new
-- migration (`prisma migrate dev --create-only --name row_level_security`)
-- so it's tracked in migration history rather than run out-of-band.
--
-- The API sets `app.tenant_id` per request/transaction via
-- `SELECT set_config('app.tenant_id', $1, true)` (see src/lib/prisma.ts).
--
-- IMPORTANT: Postgres does not apply RLS policies to a table's owning role
-- by default — only `FORCE ROW LEVEL SECURITY` does. Our current DATABASE_URL
-- connects as the table-owning role (Neon's default `neondb_owner`), so
-- without FORCE these policies would silently no-op. Provisioning a
-- dedicated, non-owner application role (and granting it table privileges
-- instead of ownership) is the cleaner long-term fix — tracked as a Phase 1
-- hardening item — but FORCE is what makes isolation actually hold today.

alter table "Tenant" enable row level security;
alter table "Tenant" force row level security;
alter table "User" enable row level security;
alter table "User" force row level security;
alter table "Customer" enable row level security;
alter table "Customer" force row level security;
alter table "NumberSeries" enable row level security;
alter table "NumberSeries" force row level security;
alter table "TaxProfile" enable row level security;
alter table "TaxProfile" force row level security;
alter table "Item" enable row level security;
alter table "Item" force row level security;
alter table "Document" enable row level security;
alter table "Document" force row level security;
alter table "DocumentLine" enable row level security;
alter table "DocumentLine" force row level security;
alter table "DocumentEvent" enable row level security;
alter table "DocumentEvent" force row level security;
alter table "Delivery" enable row level security;
alter table "Delivery" force row level security;
alter table "Payment" enable row level security;
alter table "Payment" force row level security;
alter table "WabaConnection" enable row level security;
alter table "WabaConnection" force row level security;
alter table "WabaTemplate" enable row level security;
alter table "WabaTemplate" force row level security;
alter table "PaymentProviderLink" enable row level security;
alter table "PaymentProviderLink" force row level security;
alter table "SendCostLedgerEntry" enable row level security;
alter table "SendCostLedgerEntry" force row level security;

-- Direct tenantId tables: filter on the session-scoped tenant id.
create policy tenant_isolation on "Tenant"
  using (id = current_setting('app.tenant_id', true));

create policy tenant_isolation on "User"
  using ("tenantId" = current_setting('app.tenant_id', true));

create policy tenant_isolation on "Customer"
  using ("tenantId" = current_setting('app.tenant_id', true));

create policy tenant_isolation on "NumberSeries"
  using ("tenantId" = current_setting('app.tenant_id', true));

create policy tenant_isolation on "TaxProfile"
  using ("tenantId" = current_setting('app.tenant_id', true));

create policy tenant_isolation on "Item"
  using ("tenantId" = current_setting('app.tenant_id', true));

create policy tenant_isolation on "Document"
  using ("tenantId" = current_setting('app.tenant_id', true));

create policy tenant_isolation on "WabaConnection"
  using ("tenantId" = current_setting('app.tenant_id', true));

create policy tenant_isolation on "PaymentProviderLink"
  using ("tenantId" = current_setting('app.tenant_id', true));

create policy tenant_isolation on "SendCostLedgerEntry"
  using ("tenantId" = current_setting('app.tenant_id', true));

-- Child tables without their own tenantId: join up to the tenant-scoped parent.
create policy tenant_isolation on "DocumentLine"
  using (exists (
    select 1 from "Document" d
    where d.id = "DocumentLine"."documentId"
      and d."tenantId" = current_setting('app.tenant_id', true)
  ));

create policy tenant_isolation on "DocumentEvent"
  using (exists (
    select 1 from "Document" d
    where d.id = "DocumentEvent"."documentId"
      and d."tenantId" = current_setting('app.tenant_id', true)
  ));

create policy tenant_isolation on "Delivery"
  using (exists (
    select 1 from "Document" d
    where d.id = "Delivery"."documentId"
      and d."tenantId" = current_setting('app.tenant_id', true)
  ));

create policy tenant_isolation on "Payment"
  using (exists (
    select 1 from "Document" d
    where d.id = "Payment"."documentId"
      and d."tenantId" = current_setting('app.tenant_id', true)
  ));

create policy tenant_isolation on "WabaTemplate"
  using (exists (
    select 1 from "WabaConnection" w
    where w.id = "WabaTemplate"."wabaId"
      and w."tenantId" = current_setting('app.tenant_id', true)
  ));
