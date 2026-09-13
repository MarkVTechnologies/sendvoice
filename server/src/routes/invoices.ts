import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { withTenant } from '../lib/prisma.js'
import { approveInvoice, convertQuoteToInvoice } from '../services/invoices.js'
import { renderAndStorePdf } from '../services/pdf.js'
import { generateHostedToken, hostedTokenExpiry } from '../services/hostedToken.js'
import { recordPayment } from '../services/payments.js'
import { buildInvoicesCsv } from '../services/csvExport.js'
import { sendInvoiceViaRailB } from '../services/railB.js'

// Needs to be a real absolute URL — it goes into a wa.me pre-filled message
// (Rail A), not just a client-side fetch. Defaults to localhost for dev;
// production must set this to the server's real public origin.
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 4177}`
const hostedUrl = (token: string | null) => (token ? `${PUBLIC_BASE_URL}/i/${token}` : null)

const approveSchema = z.object({
  customer: z.object({
    name: z.string().min(1),
    whatsapp: z.string().min(6).optional(),
    email: z.string().email().optional(),
  }),
  lines: z
    .array(
      z.object({
        description: z.string().min(1),
        qty: z.number().positive().optional(),
        unit: z.string().optional(),
        rate: z.number().nonnegative(),
        discount: z.number().nonnegative().optional(),
      }),
    )
    .min(1),
  currency: z.string().length(3).optional(),
  dueDate: z.string().datetime().optional(),
  notes: z.string().optional(),
  // PRD §7.3: "shared engine, different label + numbering series" — a
  // quote goes through this same approval endpoint, distinguished only by
  // docType. Defaults to INVOICE so no existing caller needs to change.
  docType: z.enum(['INVOICE', 'QUOTE']).optional(),
})

const recordPaymentSchema = z.object({
  amount: z.number().positive(),
  method: z.enum(['cash', 'bank_transfer']),
  reference: z.string().max(200).optional(),
})

const exportQuerySchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
})

/**
 * PRD §6.1 (J1) + §9.4: approval is the single moment a draft becomes a
 * real, immutable, numbered document. This must be the only place a
 * Document row's `number` is ever set.
 */
export default async function invoiceRoutes(app: FastifyInstance) {
  app.get('/invoices', { preHandler: app.authenticate }, async (req) => {
    const { tenantId } = req.user as { tenantId: string }
    const docs = await withTenant(tenantId, (tx) =>
      tx.document.findMany({
        where: { tenantId },
        // pdfData excluded — Prisma's default field set would otherwise
        // ship the full PDF bytes as JSON on every list call.
        omit: { pdfData: true },
        include: { customer: true },
        orderBy: { createdAt: 'desc' },
      }),
    )
    // hostedToken is the bearer credential for the public page — the client
    // gets the constructed hostedUrl, never the raw token in a response.
    return docs.map(({ hostedToken, ...d }) => ({ ...d, hostedUrl: hostedUrl(hostedToken) }))
  })

  // PRD §8.8 P1: "Export CSV... date-range filtered." Named as a distinct
  // path rather than a query flag on GET /invoices above, since the two
  // responses are genuinely different shapes (a file download vs. JSON) —
  // conflating them behind an Accept header or a ?format= flag would save
  // one route at the cost of making both harder to reason about.
  app.get('/invoices/export', { preHandler: app.authenticate }, async (req, reply) => {
    const { tenantId } = req.user as { tenantId: string }
    const { from, to } = exportQuerySchema.parse(req.query)

    const docs = await withTenant(tenantId, (tx) =>
      tx.document.findMany({
        where: {
          tenantId,
          ...(from || to
            ? {
                issueDate: {
                  ...(from ? { gte: new Date(from) } : {}),
                  // End-of-day, inclusive — a plain date-only `to` would
                  // otherwise exclude everything issued on that date itself.
                  ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
                },
              }
            : {}),
        },
        omit: { pdfData: true },
        include: { customer: true },
        orderBy: { issueDate: 'asc' },
      }),
    )

    const csv = buildInvoicesCsv(docs)
    reply.header('Content-Type', 'text/csv; charset=utf-8')
    reply.header(
      'Content-Disposition',
      `attachment; filename="sendvoice-export-${new Date().toISOString().slice(0, 10)}.csv"`,
    )
    return reply.send(csv)
  })

  // draftId doubles as an idempotency key (services/invoices.ts) — a
  // retried request (flaky connection, our own outbox flush) returns the
  // invoice already created instead of minting a second one. There is no
  // server-side staged-drafts table yet (tracked in the plan), so the full
  // draft payload travels in the request body every time.
  app.post('/invoices/:draftId/approve', { preHandler: app.authenticate }, async (req, reply) => {
    const { tenantId } = req.user as { tenantId: string }
    const { draftId } = req.params as { draftId: string }
    const input = approveSchema.parse(req.body)

    const { document, created, ttfiMs } = await withTenant(tenantId, (tx) =>
      approveInvoice(tx, tenantId, draftId, input),
    )

    // PRD §4.3 North Star / Phase 0 exit gate: log this tenant's real
    // time-to-first-invoice so it's visible without a separate analytics
    // pipeline. Only present on a tenant's very first invoice.
    if (ttfiMs !== undefined) {
      req.log.info({ tenantId, ttfiMs }, 'ttfi: time to first invoice')
    }

    // Only render on first creation — a replay already has a PDF (or, if
    // rendering genuinely failed last time, retrying silently forever isn't
    // solved by re-rendering on every duplicate request either).
    if (created) {
      // PRD §8.4/§8.5 P0: a real PDF for every approved invoice. Rendered
      // synchronously here rather than queued (PRD's own job-queue pattern)
      // since Phase 0 has no worker process yet — a fast-follow, not a
      // design decision to keep long-term. The invoice itself already
      // exists and is numbered even if rendering below were to fail.
      await renderAndStorePdf(tenantId, document.id)
    }

    const { hostedToken, ...rest } = document
    return reply.send({
      ...rest,
      pdfUrl: `/api/invoices/${document.id}/pdf`,
      hostedUrl: hostedUrl(hostedToken),
    })
  })

  // PRD §12 P0: hosted invoice links are bearer tokens for financial data —
  // must be revocable, not just expiring. "Revoke" here means mint a fresh
  // token and discard the old one, rather than just nulling it out: the old
  // link (already sent, possibly to the wrong person) dies immediately
  // since resolve_document_by_token can no longer find it, but the merchant
  // isn't left with a dead invoice — a new, live link is ready to re-share.
  // A DocumentEvent records it, closing the "documented reason/log is
  // remaining work" gap noted on Document.hostedToken in schema.prisma.
  app.post('/invoices/:id/revoke-link', { preHandler: app.authenticate }, async (req, reply) => {
    const { tenantId, userId } = req.user as { tenantId: string; userId: string }
    const { id } = req.params as { id: string }

    const result = await withTenant(tenantId, async (tx) => {
      const existing = await tx.document.findUnique({ where: { id }, select: { id: true } })
      if (!existing) return null

      const document = await tx.document.update({
        where: { id },
        data: { hostedToken: generateHostedToken(), hostedTokenExpiresAt: hostedTokenExpiry() },
        select: { hostedToken: true },
      })
      await tx.documentEvent.create({
        data: { documentId: id, type: 'hosted_link_revoked', actorId: userId, data: { reason: 'merchant_requested' } },
      })
      return document
    })

    if (!result) return reply.code(404).send({ error: 'invoice_not_found' })
    return reply.send({ hostedUrl: hostedUrl(result.hostedToken) })
  })

  // PRD §7.3: "Quote→Invoice conversion is one tap and preserves the link
  // for audit." Never edits the quote — creates a new, separately-numbered
  // INVOICE document instead (services/invoices.ts's convertQuoteToInvoice).
  app.post('/invoices/:id/convert', { preHandler: app.authenticate }, async (req, reply) => {
    const { tenantId } = req.user as { tenantId: string }
    const { id } = req.params as { id: string }

    const result = await withTenant(tenantId, (tx) => convertQuoteToInvoice(tx, tenantId, id))
    if (!result) return reply.code(404).send({ error: 'quote_not_found' })

    const { document, created, ttfiMs } = result
    if (ttfiMs !== undefined) {
      req.log.info({ tenantId, ttfiMs }, 'ttfi: time to first invoice (via quote conversion)')
    }
    if (created) {
      await renderAndStorePdf(tenantId, document.id)
    }

    const { hostedToken, ...rest } = document
    return reply.send({
      ...rest,
      pdfUrl: `/api/invoices/${document.id}/pdf`,
      hostedUrl: hostedUrl(hostedToken),
    })
  })

  // PRD §8.7 P0: "Manual payment recording (cash, transfer) with partial
  // support." Shares the same recordPayment core as the Paystack
  // webhook/callback (services/payments.ts) — a merchant marking cash
  // received moves Document.status the same way a PSP confirmation does,
  // and multiple partial entries accumulate the same way multiple partial
  // PSP payments would.
  app.post('/invoices/:id/payments', { preHandler: app.authenticate }, async (req, reply) => {
    const { tenantId } = req.user as { tenantId: string }
    const { id } = req.params as { id: string }
    const input = recordPaymentSchema.parse(req.body)

    let result: Awaited<ReturnType<typeof recordPayment>>
    try {
      result = await withTenant(tenantId, (tx) =>
        recordPayment(tx, id, { amount: input.amount, method: input.method, reference: input.reference }),
      )
    } catch {
      return reply.code(404).send({ error: 'invoice_not_found' })
    }

    if (!result.created) {
      return reply.code(400).send({ error: 'cannot_record_payment' })
    }

    const { hostedToken, ...rest } = result.document
    return reply.send({
      ...rest,
      pdfUrl: `/api/invoices/${result.document.id}/pdf`,
      hostedUrl: hostedUrl(hostedToken),
    })
  })

  // PRD §8.6 P0 / §10: Rail B send for one specific invoice, from the
  // merchant's own connected WhatsApp number. Always safe to call — every
  // failure mode returns a clear `reason` rather than a 500, since Rail A
  // (the client's own wa.me deep link, entirely separate from this) is
  // always available as the fallback (PRD §9.5).
  app.post('/invoices/:id/send-railb', { preHandler: app.authenticate }, async (req, reply) => {
    const { tenantId } = req.user as { tenantId: string }
    const { id } = req.params as { id: string }

    let result: Awaited<ReturnType<typeof sendInvoiceViaRailB>>
    try {
      result = await withTenant(tenantId, (tx) => sendInvoiceViaRailB(tx, tenantId, id))
    } catch {
      return reply.code(404).send({ error: 'invoice_not_found' })
    }

    if (!result.ok) {
      return reply.code(409).send({ error: result.reason })
    }
    return reply.send({ ok: true, deliveryId: result.deliveryId })
  })

  app.get('/invoices/:id/pdf', { preHandler: app.authenticate }, async (req, reply) => {
    const { tenantId } = req.user as { tenantId: string }
    const { id } = req.params as { id: string }

    const doc = await withTenant(tenantId, (tx) =>
      tx.document.findUnique({ where: { id }, select: { pdfData: true, number: true } }),
    )
    if (!doc?.pdfData) {
      return reply.code(404).send({ error: 'pdf_not_found' })
    }

    reply.header('Content-Type', 'application/pdf')
    reply.header('Content-Disposition', `inline; filename="${doc.number ?? id}.pdf"`)
    return reply.send(Buffer.from(doc.pdfData))
  })
}
