import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { withTenant } from '../lib/prisma.js'
import { approveInvoice } from '../services/invoices.js'
import { renderAndStorePdf } from '../services/pdf.js'

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
})

/**
 * PRD §6.1 (J1) + §9.4: approval is the single moment a draft becomes a
 * real, immutable, numbered document. This must be the only place a
 * Document row's `number` is ever set.
 */
export default async function invoiceRoutes(app: FastifyInstance) {
  app.get('/invoices', { preHandler: app.authenticate }, async (req) => {
    const { tenantId } = req.user as { tenantId: string }
    return withTenant(tenantId, (tx) =>
      tx.document.findMany({
        where: { tenantId },
        // Excludes pdfData explicitly — Prisma's default field set would
        // otherwise ship the full PDF bytes as JSON on every list call.
        omit: { pdfData: true },
        include: { customer: true },
        orderBy: { createdAt: 'desc' },
      }),
    )
  })

  // draftId is a client-side correlation id only — there is no server-side
  // staged-drafts table yet (tracked in the plan), so the full draft payload
  // travels in the request body.
  app.post('/invoices/:draftId/approve', { preHandler: app.authenticate }, async (req, reply) => {
    const { tenantId } = req.user as { tenantId: string }
    const input = approveSchema.parse(req.body)

    const document = await withTenant(tenantId, (tx) => approveInvoice(tx, tenantId, input))

    // PRD §8.4/§8.5 P0: a real PDF for every approved invoice. Rendered
    // synchronously here rather than queued (PRD's own job-queue pattern)
    // since Phase 0 has no worker process yet — a fast-follow, not a
    // design decision to keep long-term. The invoice itself already exists
    // and is numbered even if rendering below were to fail.
    await renderAndStorePdf(tenantId, document.id)

    return reply.send({ ...document, pdfUrl: `/api/invoices/${document.id}/pdf` })
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
