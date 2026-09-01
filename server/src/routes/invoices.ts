import type { FastifyInstance } from 'fastify'
import { withTenant } from '../lib/prisma.js'
import { allocateNumber } from '../services/numbering.js'

/**
 * PRD §6.1 (J1) + §9.4: approval is the single moment a draft becomes a
 * real, immutable, numbered document. This must be the only place a
 * Document row's `number` is ever set.
 */
export default async function invoiceRoutes(app: FastifyInstance) {
  app.get('/invoices', { preHandler: app.authenticate }, async (req) => {
    const { tenantId } = req.user as { tenantId: string }
    return withTenant(tenantId, (tx) =>
      tx.document.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } }),
    )
  })

  app.post('/invoices/:draftId/approve', { preHandler: app.authenticate }, async (req, reply) => {
    const { tenantId } = req.user as { tenantId: string }
    // TODO(Phase 0): load the pending draft payload (from request body or a
    // staged-drafts table), validate totals server-side, then commit.
    const result = await withTenant(tenantId, async (tx) => {
      const year = new Date().getFullYear()
      const number = await allocateNumber(tx, tenantId, 'INVOICE', 'INV', year)
      // TODO: create the Document + DocumentLine rows from the draft here,
      // in the same transaction as allocateNumber, then a DocumentEvent
      // 'approved' row for the audit log (PRD §12 P0).
      return { number }
    })
    return reply.send(result)
  })
}
