import type { PrismaClient } from '@prisma/client'
import { prisma, withTenant } from '../lib/prisma.js'
import { approveInvoice, type ApproveInvoiceInput } from './invoices.js'
import { renderAndStorePdf } from './pdf.js'

export type Frequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly'
const FREQUENCIES: Frequency[] = ['weekly', 'monthly', 'quarterly', 'yearly']
export function isFrequency(v: string): v is Frequency {
  return (FREQUENCIES as string[]).includes(v)
}

function advance(date: Date, frequency: Frequency): Date {
  const next = new Date(date)
  switch (frequency) {
    case 'weekly':
      next.setDate(next.getDate() + 7)
      break
    case 'monthly':
      next.setMonth(next.getMonth() + 1)
      break
    case 'quarterly':
      next.setMonth(next.getMonth() + 3)
      break
    case 'yearly':
      next.setFullYear(next.getFullYear() + 1)
      break
  }
  return next
}

/**
 * PRD §8.4 P1 / §11.4: created from an existing invoice, not a separate
 * composer flow — matches the PRD's own conversion trigger ("sends the
 * same invoice to the same customer 3 months running → prompt recurring").
 * Snapshots the invoice's lines/currency/notes and the gap between its
 * issue and due dates (e.g. "net 14"), so every generated cycle keeps that
 * same payment window relative to its own issue date, not a fixed calendar
 * date that would make no sense on a schedule.
 */
export async function makeRecurringFromInvoice(
  tx: PrismaClient,
  tenantId: string,
  documentId: string,
  frequency: Frequency,
): Promise<{ ok: true; id: string } | { ok: false; reason: 'not_found' | 'not_an_invoice' | 'no_customer' }> {
  const doc = await tx.document.findUnique({ where: { id: documentId }, include: { lines: true, customer: true } })
  if (!doc) return { ok: false, reason: 'not_found' }
  if (doc.docType !== 'INVOICE') return { ok: false, reason: 'not_an_invoice' }
  if (!doc.customer) return { ok: false, reason: 'no_customer' }

  const dueDateOffsetDays =
    doc.dueDate && doc.issueDate
      ? Math.round((doc.dueDate.getTime() - doc.issueDate.getTime()) / (1000 * 60 * 60 * 24))
      : undefined

  const schedule = await tx.recurringSchedule.create({
    data: {
      tenantId,
      customerId: doc.customerId,
      currency: doc.currency,
      notes: doc.notes,
      dueDateOffsetDays,
      frequency,
      // Starts from the next cycle after the invoice this was made from —
      // that one already went out; this schedule is for the ones after it.
      nextRunAt: advance(new Date(), frequency),
      lines: doc.lines
        .sort((a, b) => a.position - b.position)
        .map((l) => ({
          description: l.description,
          qty: l.qty ? Number(l.qty) : undefined,
          unit: l.unit ?? undefined,
          rate: Number(l.rate),
          discount: l.discount ? Number(l.discount) : undefined,
        })),
    },
  })

  return { ok: true, id: schedule.id }
}

export async function listRecurringSchedules(tx: PrismaClient, tenantId: string) {
  return tx.recurringSchedule.findMany({
    where: { tenantId },
    include: { customer: true },
    orderBy: { createdAt: 'desc' },
  })
}

export async function setScheduleActive(
  tx: PrismaClient,
  tenantId: string,
  scheduleId: string,
  active: boolean,
): Promise<boolean> {
  const result = await tx.recurringSchedule.updateMany({ where: { id: scheduleId, tenantId }, data: { active } })
  return result.count > 0
}

export async function deleteSchedule(tx: PrismaClient, tenantId: string, scheduleId: string): Promise<boolean> {
  const result = await tx.recurringSchedule.deleteMany({ where: { id: scheduleId, tenantId } })
  return result.count > 0
}

/**
 * The one write this makes beyond approveInvoice itself: advances
 * nextRunAt and records lastRunAt/lastDocumentId. draftId is derived from
 * the schedule id and the exact nextRunAt it fired on — approveInvoice's
 * own (tenantId, draftId) uniqueness (services/invoices.ts) is what makes
 * this safe to call twice for the same due cycle (a scheduler tick that
 * overlaps a slow previous run) without minting two invoices.
 */
async function generateFromSchedule(tx: PrismaClient, tenantId: string, scheduleId: string) {
  const schedule = await tx.recurringSchedule.findUniqueOrThrow({
    where: { id: scheduleId },
    include: { customer: true },
  })
  const frequency = schedule.frequency as Frequency
  const issueDate = new Date()
  const dueDate =
    schedule.dueDateOffsetDays != null
      ? new Date(issueDate.getTime() + schedule.dueDateOffsetDays * 24 * 60 * 60 * 1000)
      : undefined

  const input: ApproveInvoiceInput = {
    customer: {
      name: schedule.customer.name,
      whatsapp: schedule.customer.whatsapp ?? undefined,
      email: schedule.customer.email ?? undefined,
    },
    lines: schedule.lines as ApproveInvoiceInput['lines'],
    currency: schedule.currency,
    dueDate: dueDate?.toISOString(),
    notes: schedule.notes ?? undefined,
  }

  const draftId = `recurring-${schedule.id}-${schedule.nextRunAt.toISOString()}`
  const { document, created } = await approveInvoice(tx, tenantId, draftId, input)

  await tx.recurringSchedule.update({
    where: { id: scheduleId },
    data: { nextRunAt: advance(schedule.nextRunAt, frequency), lastRunAt: new Date(), lastDocumentId: document.id },
  })

  return { document, created }
}

/**
 * PRD §8.4: the actual generation step. Runs in-process on a plain
 * interval (see index.ts) rather than the BullMQ repeatable-job
 * infrastructure already scaffolded in jobs/queue.ts — that needs a real,
 * separately-run worker process to be production-correct, which nothing
 * in this deployment starts yet. An interval inside the same server
 * process is the honest MVP shape today; moving this onto a real worker
 * is a scaling concern, not a correctness one, once one exists.
 *
 * due_recurring_schedules() is the one legitimate cross-tenant read here
 * (same SECURITY DEFINER pattern as login/hosted-token resolution) — it
 * returns only (id, tenantId) for schedules that are actually due, and
 * every real read after that goes through the normal RLS-scoped
 * withTenant() path. One schedule's failure is logged and skipped, never
 * allowed to block every other tenant's due schedules in the same tick.
 */
export async function runDueRecurringSchedules(log: { error: (obj: unknown, msg: string) => void }): Promise<void> {
  // Observed (not chased further): this raw $queryRaw immediately followed
  // by the loop's own withTenant() transactions below prints a Node pg
  // driver "client.query() when the client is already executing a query"
  // deprecation warning on every real run, including through the actual
  // server interval (not just a standalone script) — verified twice, with
  // correct results both times (no duplicate invoices, correct nextRunAt
  // advancement each time). Everything here is properly sequentially
  // awaited; this looks like a driver-adapter-internals artifact of Prisma
  // 7's @prisma/adapter-pg under this raw-query-then-transaction shape,
  // not a control-flow bug in this function — flagged here rather than
  // silently ignored, in case it becomes a real error on a future pg/
  // adapter upgrade (the warning itself says pg 9 removes the leniency).
  const due = await prisma.$queryRaw<Array<{ id: string; tenant_id: string }>>`
    select * from due_recurring_schedules()
  `
  for (const { id, tenant_id: tenantId } of due) {
    try {
      const result = await withTenant(tenantId, (tx) => generateFromSchedule(tx, tenantId, id))
      if (result.created) {
        await renderAndStorePdf(tenantId, result.document.id)
      }
    } catch (err) {
      log.error({ err, scheduleId: id, tenantId }, 'recurring schedule generation failed')
    }
  }
}
