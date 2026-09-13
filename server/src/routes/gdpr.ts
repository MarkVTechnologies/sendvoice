import type { FastifyInstance } from 'fastify'
import { withTenant } from '../lib/prisma.js'
import { requireRole } from '../lib/authz.js'
import { exportTenantData } from '../services/gdpr.js'

/** PRD §12 P1: GDPR/NDPR data export. Owner-only — this is the whole business's data, not one user's. */
export default async function gdprRoutes(app: FastifyInstance) {
  app.get('/gdpr/export', { preHandler: [app.authenticate, requireRole('OWNER')] }, async (req, reply) => {
    const { tenantId } = req.user as { tenantId: string }
    const data = await withTenant(tenantId, (tx) => exportTenantData(tx, tenantId))
    reply.header('Content-Type', 'application/json; charset=utf-8')
    reply.header(
      'Content-Disposition',
      `attachment; filename="sendvoice-data-export-${new Date().toISOString().slice(0, 10)}.json"`,
    )
    return reply.send(JSON.stringify(data, null, 2))
  })
}
