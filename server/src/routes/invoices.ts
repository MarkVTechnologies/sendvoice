import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { withTenant } from '../lib/prisma.js'
import { approveInvoice } from '../services/invoices.js'

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
    return reply.send(document)
  })
}
