import type { FastifyInstance } from 'fastify'
import { withTenant } from '../lib/prisma.js'
import { requireRole } from '../lib/authz.js'
import { eraseCustomer } from '../services/gdpr.js'

/** PRD §8.2 (list) / §12 P1 (erasure, Owner-only — this is a data-rights action). */
export default async function customerRoutes(app: FastifyInstance) {
  app.get('/customers', { preHandler: app.authenticate }, async (req) => {
    const { tenantId } = req.user as { tenantId: string }
    return withTenant(tenantId, (tx) => tx.customer.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } }))
  })

  app.post(
    '/customers/:id/erase',
    { preHandler: [app.authenticate, requireRole('OWNER')] },
    async (req, reply) => {
      const { tenantId } = req.user as { tenantId: string }
      const { id } = req.params as { id: string }
      const result = await withTenant(tenantId, (tx) => eraseCustomer(tx, tenantId, id))
      if (!result.ok) return reply.code(404).send({ error: result.reason })
      return reply.send({ ok: true })
    },
  )
}
