import type { FastifyInstance } from 'fastify'
import { withTenant } from '../lib/prisma.js'
import { requireRole } from '../lib/authz.js'
import { deleteSchedule, listRecurringSchedules, setScheduleActive } from '../services/recurring.js'

function scheduleView(s: {
  id: string
  frequency: string
  active: boolean
  nextRunAt: Date
  lastRunAt: Date | null
  lastDocumentId: string | null
  currency: string
  customer: { name: string }
}) {
  return {
    id: s.id,
    frequency: s.frequency,
    active: s.active,
    nextRunAt: s.nextRunAt,
    lastRunAt: s.lastRunAt,
    lastDocumentId: s.lastDocumentId,
    currency: s.currency,
    customerName: s.customer.name,
  }
}

/**
 * PRD §8.4 P1: recurring invoice schedules. Created from an existing
 * invoice (routes/invoices.ts's make-recurring), managed here.
 */
export default async function recurringRoutes(app: FastifyInstance) {
  app.get('/recurring', { preHandler: app.authenticate }, async (req) => {
    const { tenantId } = req.user as { tenantId: string }
    const schedules = await withTenant(tenantId, (tx) => listRecurringSchedules(tx, tenantId))
    return schedules.map(scheduleView)
  })

  app.post(
    '/recurring/:id/pause',
    { preHandler: [app.authenticate, requireRole('OWNER', 'EDITOR')] },
    async (req, reply) => {
      const { tenantId } = req.user as { tenantId: string }
      const { id } = req.params as { id: string }
      const ok = await withTenant(tenantId, (tx) => setScheduleActive(tx, tenantId, id, false))
      if (!ok) return reply.code(404).send({ error: 'not_found' })
      return reply.send({ ok: true })
    },
  )

  app.post(
    '/recurring/:id/resume',
    { preHandler: [app.authenticate, requireRole('OWNER', 'EDITOR')] },
    async (req, reply) => {
      const { tenantId } = req.user as { tenantId: string }
      const { id } = req.params as { id: string }
      const ok = await withTenant(tenantId, (tx) => setScheduleActive(tx, tenantId, id, true))
      if (!ok) return reply.code(404).send({ error: 'not_found' })
      return reply.send({ ok: true })
    },
  )

  app.delete(
    '/recurring/:id',
    { preHandler: [app.authenticate, requireRole('OWNER', 'EDITOR')] },
    async (req, reply) => {
      const { tenantId } = req.user as { tenantId: string }
      const { id } = req.params as { id: string }
      const ok = await withTenant(tenantId, (tx) => deleteSchedule(tx, tenantId, id))
      if (!ok) return reply.code(404).send({ error: 'not_found' })
      return reply.send({ ok: true })
    },
  )
}
