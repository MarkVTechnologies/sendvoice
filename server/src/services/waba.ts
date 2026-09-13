import type { PrismaClient } from '@prisma/client'
import {
  createHostedSignup,
  createWhatsAppTemplate,
  getHostedSignupStatus,
  getWhatsAppTemplateStatus,
} from './telnyx.js'

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 4177}`
const SAMPLE_INVOICE_PDF_URL = `${PUBLIC_BASE_URL}/api/waba/sample-invoice.pdf`

export type WabaConnectionView = {
  status: string
  wabaId: string | null
  phoneNumberId: string | null
  connectedAt: Date | null
}

function toView(
  c: { status: string; wabaId: string | null; phoneNumberId: string | null; connectedAt: Date | null } | null,
): WabaConnectionView {
  if (!c) return { status: 'not_connected', wabaId: null, phoneNumberId: null, connectedAt: null }
  return { status: c.status, wabaId: c.wabaId, phoneNumberId: c.phoneNumberId, connectedAt: c.connectedAt }
}

/**
 * PRD §10.1: kicks off Embedded Signup via Telnyx's Hosted Signup.
 * Re-calling while a signup is already pending just hands back a fresh URL
 * and overwrites the stored session — Telnyx's URLs expire (at most 3 days
 * out), so a merchant returning to a stale one needs a new one, not an
 * error.
 */
export async function startWabaConnection(tx: PrismaClient, tenantId: string): Promise<string> {
  const signup = await createHostedSignup()
  await tx.wabaConnection.upsert({
    where: { tenantId },
    create: { tenantId, status: 'pending', signupSessionId: signup.id },
    update: { status: 'pending', signupSessionId: signup.id },
  })
  return signup.url
}

/**
 * PRD §10.1: polls Telnyx for this tenant's own stored signup session —
 * there is no confirmed webhook for signup completion (see the comment on
 * getHostedSignupStatus in services/telnyx.ts), so polling on page load is
 * the one mechanism documented to exist at all.
 *
 * Treats "connected" as "Telnyx returned both a waba_id and a
 * phone_number_id", not as a match against a specific status string —
 * Telnyx's exact enum for this endpoint isn't documented anywhere found, so
 * matching on the data that actually matters (do we have what a send
 * needs) is more robust than guessing a literal like "completed".
 */
export async function refreshWabaConnection(tx: PrismaClient, tenantId: string): Promise<WabaConnectionView> {
  const existing = await tx.wabaConnection.findUnique({ where: { tenantId } })
  if (!existing || existing.status !== 'pending' || !existing.signupSessionId) {
    return toView(existing)
  }

  const result = await getHostedSignupStatus(existing.signupSessionId)
  if (result.wabaId && result.phoneNumberId) {
    const updated = await tx.wabaConnection.update({
      where: { tenantId },
      data: {
        status: 'connected',
        wabaId: result.wabaId,
        phoneNumberId: result.phoneNumberId,
        connectedAt: new Date(),
      },
    })
    return toView(updated)
  }
  return toView(existing)
}

// PRD §10.2: the five core templates named explicitly. Body copy is
// transactional-only by construction — every sentence references a
// specific document, number, amount, or date via a {{n}} placeholder —
// never promotional wording, since a template that reads as marketing
// risks Meta reclassifying the whole category (PRD §10.2's own warning
// that this is "the most cost-sensitive decision in the product").
//
// A button's URL is fixed up to its one trailing {{n}} placeholder — Meta
// only allows the dynamic portion of a URL button to be a suffix on a
// fixed, template-registered base, which `/i/{{1}}` (a hosted-invoice
// token) already satisfies.
const CORE_TEMPLATES: Array<{
  name: string
  bodyText: string
  documentHeader: boolean
  buttonUrl?: { text: string; url: string }
}> = [
  {
    name: 'invoice_new',
    bodyText: 'Hi {{1}}, here is invoice {{2}} for {{3}}, due {{4}}.',
    documentHeader: true,
    buttonUrl: { text: 'View & pay', url: `${PUBLIC_BASE_URL}/i/{{1}}` },
  },
  {
    name: 'invoice_reminder_due',
    bodyText: 'Hi {{1}}, a reminder that invoice {{2}} for {{3}} is due {{4}}.',
    documentHeader: false,
    buttonUrl: { text: 'View & pay', url: `${PUBLIC_BASE_URL}/i/{{1}}` },
  },
  {
    name: 'invoice_reminder_overdue',
    bodyText: 'Hi {{1}}, invoice {{2}} for {{3}} was due {{4}} and is still unpaid.',
    documentHeader: false,
    buttonUrl: { text: 'View & pay', url: `${PUBLIC_BASE_URL}/i/{{1}}` },
  },
  {
    name: 'payment_received',
    bodyText: 'Hi {{1}}, we have received your payment of {{2}} for invoice {{3}}. Thank you.',
    documentHeader: true,
  },
  {
    name: 'quote_new',
    bodyText: 'Hi {{1}}, here is quote {{2}} for {{3}}.',
    documentHeader: true,
    buttonUrl: { text: 'View quote', url: `${PUBLIC_BASE_URL}/i/{{1}}` },
  },
]

/**
 * PRD §10.2 P0: submits every core template not already submitted. Never
 * re-submits one that already has a row — a rejection needs a deliberate,
 * guided resubmit (PRD's own "one-tap resubmission" language implies an
 * explicit action, not an automatic retry on every click of this).
 */
export async function submitCoreTemplates(tx: PrismaClient, tenantId: string): Promise<void> {
  const connection = await tx.wabaConnection.findUnique({ where: { tenantId } })
  if (!connection?.wabaId) {
    throw new Error('cannot submit templates before a WABA is connected')
  }

  for (const template of CORE_TEMPLATES) {
    const existing = await tx.wabaTemplate.findUnique({
      where: { wabaId_name: { wabaId: connection.id, name: template.name } },
    })
    if (existing) continue

    const created = await createWhatsAppTemplate({
      wabaId: connection.wabaId,
      name: template.name,
      language: 'en_US',
      bodyText: template.bodyText,
      documentHeaderExampleUrl: template.documentHeader ? SAMPLE_INVOICE_PDF_URL : undefined,
      buttonUrl: template.buttonUrl,
    })

    await tx.wabaTemplate.create({
      data: { wabaId: connection.id, name: template.name, telnyxTemplateId: created.id, status: created.status },
    })
  }
}

/**
 * PRD §10.2 P0: "a per-merchant template management surface showing
 * status." PENDING is the only status genuinely expected to change on its
 * own; APPROVED/REJECTED/DISABLED are treated as terminal here (a
 * rejection is resolved by resubmitting under guidance, not by this
 * quietly re-polling forever) — PAUSED is left non-terminal since Meta can
 * un-pause a template without any action on our side.
 */
export async function refreshTemplateStatuses(tx: PrismaClient, tenantId: string): Promise<void> {
  const connection = await tx.wabaConnection.findUnique({ where: { tenantId }, include: { templates: true } })
  if (!connection) return

  for (const template of connection.templates) {
    if (!template.telnyxTemplateId) continue
    if (template.status === 'APPROVED' || template.status === 'REJECTED' || template.status === 'DISABLED') continue
    try {
      const result = await getWhatsAppTemplateStatus(template.telnyxTemplateId)
      await tx.wabaTemplate.update({
        where: { id: template.id },
        data: { status: result.status, rejectionReason: result.rejectionReason },
      })
    } catch {
      // Best-effort — the GET-by-id endpoint itself is an inference from
      // Telnyx's docs (services/telnyx.ts), not a confirmed contract. A
      // failure here shouldn't break the caller's whole request, just
      // leave this one template's status stale until the next refresh.
    }
  }
}

export async function listTemplates(tx: PrismaClient, tenantId: string) {
  const connection = await tx.wabaConnection.findUnique({ where: { tenantId }, include: { templates: true } })
  return connection?.templates ?? []
}
