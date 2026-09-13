import type { PrismaClient } from '@prisma/client'
import { prisma, withTenant } from '../lib/prisma.js'
import { sendWhatsAppTemplateMessage } from './telnyx.js'

// PRD §6.4/§8.6 P1: "a polite pre-due reminder, a due-date nudge, and
// configurable overdue follow-ups." Collapsed into the two templates
// actually named in §10.2 — invoice_reminder_due covers both the pre-due
// and due-date-itself cases (one send, whichever comes first),
// invoice_reminder_overdue repeats on a cap, never indefinitely (PRD's own
// "configurable" — these defaults are the starting configuration, not a
// hardcoded final answer).
const PRE_DUE_WINDOW_DAYS = 3
const OVERDUE_REMINDER_INTERVAL_DAYS = 7
const OVERDUE_REMINDER_MAX_COUNT = 3

export async function pauseReminders(tx: PrismaClient, tenantId: string, documentId: string): Promise<boolean> {
  const result = await tx.document.updateMany({ where: { id: documentId, tenantId }, data: { remindersPaused: true } })
  return result.count > 0
}

export async function resumeReminders(tx: PrismaClient, tenantId: string, documentId: string): Promise<boolean> {
  const result = await tx.document.updateMany({
    where: { id: documentId, tenantId },
    data: { remindersPaused: false },
  })
  return result.count > 0
}

type ReminderEventData = { stage?: string; templateName?: string }

/**
 * Deliberately parallel to services/railB.ts's own connected-WABA +
 * approved-template guard rather than sharing code with it — the two
 * differ in trigger (a merchant tap vs. an automated sweep) and in which
 * template/body-params they need, and forcing them through one shared
 * function would cost more in indirection than the few duplicated lines
 * save. Silently does nothing when Rail B isn't connected/approved yet —
 * same as a Rail B invoice send, this stays dormant until it is, rather
 * than erroring on every sweep tick for every tenant that hasn't set it up.
 */
async function processDocumentReminders(
  tx: PrismaClient,
  tenantId: string,
  documentId: string,
  log: { error: (obj: unknown, msg: string) => void },
): Promise<void> {
  const doc = await tx.document.findUnique({
    where: { id: documentId },
    include: { customer: true, events: true },
  })
  if (!doc || !doc.dueDate || doc.remindersPaused) return

  const now = Date.now()
  const daysUntilDue = (doc.dueDate.getTime() - now) / (1000 * 60 * 60 * 24)

  const reminderEvents = doc.events.filter((e) => e.type === 'reminder_sent')
  const dueReminderSent = reminderEvents.some((e) => (e.data as ReminderEventData | null)?.stage === 'due')
  const overdueEvents = reminderEvents.filter((e) => (e.data as ReminderEventData | null)?.stage === 'overdue')
  const lastOverdueAt = overdueEvents.length ? Math.max(...overdueEvents.map((e) => e.createdAt.getTime())) : null

  let templateName: 'invoice_reminder_due' | 'invoice_reminder_overdue' | null = null
  let stage: 'due' | 'overdue' | null = null

  // Bounded below by 0: an invoice that's already overdue the very first
  // time this ever runs for it (reminders were paused through the due
  // window, or it was approved already overdue) must never get the
  // "coming up" wording instead of "overdue" just because dueReminderSent
  // happens to be false — caught by testing a fresh 5-days-overdue invoice
  // with no prior events, which this condition originally matched.
  if (daysUntilDue >= 0 && daysUntilDue <= PRE_DUE_WINDOW_DAYS && !dueReminderSent) {
    templateName = 'invoice_reminder_due'
    stage = 'due'
  } else if (
    daysUntilDue < 0 &&
    overdueEvents.length < OVERDUE_REMINDER_MAX_COUNT &&
    (lastOverdueAt === null || now - lastOverdueAt >= OVERDUE_REMINDER_INTERVAL_DAYS * 24 * 60 * 60 * 1000)
  ) {
    templateName = 'invoice_reminder_overdue'
    stage = 'overdue'
  }

  if (!templateName || !stage) return

  const connection = await tx.wabaConnection.findUnique({ where: { tenantId }, include: { templates: true } })
  if (!connection || connection.status !== 'connected' || !connection.phoneNumberId) return
  const template = connection.templates.find((t) => t.name === templateName)
  if (!template || template.status !== 'APPROVED') return
  // PRD §10.3 P0: opt-out honoured on every send, not just at capture time.
  if (!doc.customer.whatsapp || doc.customer.optedOutAt) return

  try {
    await sendWhatsAppTemplateMessage({
      from: connection.phoneNumberId,
      to: doc.customer.whatsapp,
      templateName,
      templateLang: 'en_US',
      bodyParams: [
        doc.customer.name,
        doc.number ?? '',
        `${doc.currency} ${Number(doc.total).toFixed(2)}`,
        doc.dueDate.toISOString().slice(0, 10),
      ],
    })
  } catch (err) {
    log.error({ err, documentId }, 'reminder send failed')
    return
  }

  await tx.documentEvent.create({ data: { documentId, type: 'reminder_sent', data: { stage, templateName } } })
}

/**
 * PRD §8.6 P1: same in-process-interval shape as recurring schedules
 * (services/recurring.ts, index.ts) and the same reasoning for why —
 * BullMQ's repeatable-job scaffolding in jobs/queue.ts needs a real worker
 * process this deployment doesn't run yet.
 */
export async function runDueReminders(log: { error: (obj: unknown, msg: string) => void }): Promise<void> {
  const candidates = await prisma.$queryRaw<Array<{ id: string; tenant_id: string }>>`
    select * from due_reminder_candidates()
  `
  for (const { id, tenant_id: tenantId } of candidates) {
    try {
      await withTenant(tenantId, (tx) => processDocumentReminders(tx, tenantId, id, log))
    } catch (err) {
      log.error({ err, documentId: id, tenantId }, 'reminder processing failed')
    }
  }
}
