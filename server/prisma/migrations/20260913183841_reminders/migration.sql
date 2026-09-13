-- PRD §8.6 P1 / §6.4: reminder sequences, pausable per invoice.
ALTER TABLE "Document" ADD COLUMN     "remindersPaused" BOOLEAN NOT NULL DEFAULT false;

-- Same cross-tenant-scan problem as recurring schedules
-- (due_recurring_schedules, prior migration) and login/hosted-token
-- resolution before that: the reminder sweep needs to find candidate
-- invoices across every tenant, which RLS correctly blocks for the app
-- role. Bounded to the last 60 days of due dates so a merchant's very old
-- unpaid invoices don't get rechecked on every sweep forever; the actual
-- stage logic (has a reminder already fired, is it overdue-repeat time
-- yet) lives in application code (services/reminders.ts) against the real
-- DocumentEvent history, not in this function.
create function due_reminder_candidates()
returns table (id text, tenant_id text)
language sql
security definer
set search_path = public
as $$
  select id, "tenantId" from "Document"
  where "docType" = 'INVOICE'
    and status in ('APPROVED', 'VIEWED', 'PARTIALLY_PAID')
    and "remindersPaused" = false
    and "dueDate" is not null
    and "dueDate" >= now() - interval '60 days';
$$;

revoke all on function due_reminder_candidates() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'sendvoice_app') then
    execute 'grant execute on function due_reminder_candidates() to sendvoice_app';
  end if;
end $$;
