-- PRD §8.4 P1 "recurring invoice schedules" / §11.4 conversion trigger.
-- A snapshot of an existing invoice's lines, not a live reference to it —
-- the source Document is immutable and independent of whatever this goes
-- on to generate each cycle.

-- CreateTable
CREATE TABLE "RecurringSchedule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "currency" TEXT NOT NULL,
    "notes" TEXT,
    "dueDateOffsetDays" INTEGER,
    "frequency" TEXT NOT NULL,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "lastDocumentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecurringSchedule_tenantId_idx" ON "RecurringSchedule"("tenantId");

-- CreateIndex
CREATE INDEX "RecurringSchedule_active_nextRunAt_idx" ON "RecurringSchedule"("active", "nextRunAt");

-- AddForeignKey
ALTER TABLE "RecurringSchedule" ADD CONSTRAINT "RecurringSchedule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringSchedule" ADD CONSTRAINT "RecurringSchedule_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RowLevelSecurity (same tenant_isolation pattern as every other
-- direct-tenantId table — see prisma/rls-policies.sql's header note on
-- why FORCE is required).
ALTER TABLE "RecurringSchedule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RecurringSchedule" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "RecurringSchedule"
  USING ("tenantId" = current_setting('app.tenant_id', true));

-- The scheduler (services/recurring.ts's runDueRecurringSchedules) needs to
-- find due schedules across every tenant, which RLS correctly blocks for
-- the app role — same cross-tenant problem, same fix, as login
-- (resolve_user_by_phone) and the hosted page (resolve_document_by_token):
-- a narrow SECURITY DEFINER function returning only (id, tenant_id) for
-- rows that are actually due, nothing else about them.
create function due_recurring_schedules()
returns table (id text, tenant_id text)
language sql
security definer
set search_path = public
as $$
  select id, "tenantId" from "RecurringSchedule"
  where active = true and "nextRunAt" <= now();
$$;

revoke all on function due_recurring_schedules() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'sendvoice_app') then
    execute 'grant execute on function due_recurring_schedules() to sendvoice_app';
  end if;
end $$;
