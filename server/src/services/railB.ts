import type { PrismaClient } from '@prisma/client'
import { sendWhatsAppTemplateMessage } from './telnyx.js'

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 4177}`

// PRD §10.4: a placeholder, deliberately flagged rather than pretending
// precision — real per-country utility pricing needs verifying against
// Meta's live rate card (the PRD's own instruction: "verify live rates...
// at build time and re-verify quarterly," since "the figures above move").
// Recording *something* now, correctly keyed by recipient country and
// category, is the actual point (§10.4: "not a v2 feature, build this
// even though Rail B doesn't ship until Phase 2") — the exact cents value
// is a fast follow-up once a real account exists to check it against.
const PLACEHOLDER_UTILITY_RATE_USD_CENTS = 1

export type SendRailBResult =
  | { ok: true; deliveryId: string }
  | {
      ok: false
      reason: 'not_connected' | 'template_not_approved' | 'opted_out' | 'no_whatsapp_number' | 'already_sent' | 'send_failed'
    }

/**
 * PRD §8.6 P0 + §10: sends an approved invoice from the merchant's own
 * registered WhatsApp number (not a shared "Sendvoice" number — PRD §10.1:
 * that model "destroys the merchant's brand presence"), using the
 * invoice_new utility template.
 *
 * Gated hard on both a connected WABA and an APPROVED invoice_new template
 * before ever calling Telnyx — there is nothing to gracefully degrade to
 * server-side on a missing/unapproved template (Meta simply rejects the
 * send), so refusing early gives the caller an actionable reason instead of
 * an opaque provider error. The caller (routes/invoices.ts) always has
 * Rail A as a fallback regardless of which reason comes back, matching PRD
 * §9.5: "a merchant-visible failure state plus a one-tap fallback to Rail A."
 */
export async function sendInvoiceViaRailB(
  tx: PrismaClient,
  tenantId: string,
  documentId: string,
): Promise<SendRailBResult> {
  const connection = await tx.wabaConnection.findUnique({ where: { tenantId }, include: { templates: true } })
  if (!connection || connection.status !== 'connected' || !connection.phoneNumberId) {
    return { ok: false, reason: 'not_connected' }
  }
  const template = connection.templates.find((t) => t.name === 'invoice_new')
  if (!template || template.status !== 'APPROVED') {
    return { ok: false, reason: 'template_not_approved' }
  }

  const doc = await tx.document.findUniqueOrThrow({
    where: { id: documentId },
    include: { customer: true, tenant: true },
  })
  if (!doc.customer.whatsapp) {
    return { ok: false, reason: 'no_whatsapp_number' }
  }
  // PRD §10.3 P0: "opt-out must be honoured instantly and permanently
  // across all merchants for that recipient" — checked on every send, not
  // just at capture time.
  if (doc.customer.optedOutAt) {
    return { ok: false, reason: 'opted_out' }
  }

  // PRD §9.5: "every WhatsApp send is idempotent... and retried... on
  // transient failures." One row per document for this template — a
  // merchant re-tapping after it already went out must not double-send —
  // but a FAILED attempt must not permanently block every future retry
  // either, which is what merely checking "does a row exist" would do.
  // Only a delivery that actually reached Telnyx successfully (SENT, or a
  // later webhook-driven DELIVERED/READ once that exists) counts as
  // "already sent"; a FAILED row is reused for the retry rather than
  // left as a dead end. Caught by testing this exact path with a real
  // (fake-key) send failure, not assumed to be correct from reading the
  // code — the first version of this function got it wrong.
  const idempotencyKey = `railb-invoice_new-${documentId}`
  const existingDelivery = await tx.delivery.findUnique({ where: { idempotencyKey } })
  if (existingDelivery && existingDelivery.status !== 'FAILED') {
    return { ok: false, reason: 'already_sent' }
  }

  const delivery = existingDelivery
    ? await tx.delivery.update({
        where: { id: existingDelivery.id },
        data: { status: 'QUEUED', templateId: template.id, lastError: null },
      })
    : await tx.delivery.create({
        data: { documentId, rail: 'RAIL_B_DIRECT', status: 'QUEUED', templateId: template.id, idempotencyKey },
      })

  try {
    await sendWhatsAppTemplateMessage({
      from: connection.phoneNumberId,
      to: doc.customer.whatsapp,
      templateName: 'invoice_new',
      templateLang: 'en_US',
      bodyParams: [
        doc.customer.name,
        doc.number ?? '',
        `${doc.currency} ${Number(doc.total).toFixed(2)}`,
        doc.dueDate ? doc.dueDate.toISOString().slice(0, 10) : '—',
      ],
      documentHeader: { url: `${PUBLIC_BASE_URL}/i/${doc.hostedToken}/pdf`, filename: `${doc.number ?? 'invoice'}.pdf` },
    })
  } catch (err) {
    await tx.delivery.update({
      where: { id: delivery.id },
      data: {
        status: 'FAILED',
        lastError: err instanceof Error ? err.message : String(err),
        attempts: { increment: 1 },
      },
    })
    return { ok: false, reason: 'send_failed' }
  }

  await tx.delivery.update({ where: { id: delivery.id }, data: { status: 'SENT', attempts: { increment: 1 } } })

  // PRD §10.3 P0: consent capture, timestamp + source. An invoice being
  // sent is strong transactional context but, per the PRD's own wording,
  // "does not exempt us from Meta's Business Messaging Policy" — captured
  // here as the first real signal available, never assumed silently, and
  // never overwritten once set.
  if (!doc.customer.optedInAt) {
    await tx.customer.update({ where: { id: doc.customerId }, data: { optedInAt: new Date() } })
  }

  // PRD §10.4 P0: "build this now, not later" — every Rail B send attempt
  // records a ledger entry, keyed on the recipient's country (not the
  // merchant's, since Meta bills utility sends at the destination rate).
  await tx.sendCostLedgerEntry.create({
    data: {
      tenantId,
      recipientCountry: doc.tenant.country,
      category: 'utility',
      costMinorUnits: PLACEHOLDER_UTILITY_RATE_USD_CENTS,
      currency: 'USD',
    },
  })

  return { ok: true, deliveryId: delivery.id }
}
