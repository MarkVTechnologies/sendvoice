import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { withTenant } from '../lib/prisma.js'
import { requireRole } from '../lib/authz.js'
import { inviteUser, listUsers, removeUser } from '../services/users.js'

const inviteSchema = z.object({
  phone: z.string().min(6),
  role: z.enum(['EDITOR', 'VIEWER', 'ACCOUNTANT']),
})

function userView(u: { id: string; phone: string; name: string | null; role: string; joinedAt: Date | null }) {
  return { id: u.id, phone: u.phone, name: u.name, role: u.role, joined: u.joinedAt !== null }
}

/**
 * PRD §8.1 P1: multi-user with roles. Every route is authenticated; only
 * inviting/removing is Owner-only (§5.2's "Tunde" persona — an Editor —
 * issues invoices, but managing who's on the team is an Owner decision).
 */
export default async function userRoutes(app: FastifyInstance) {
  app.get('/users', { preHandler: app.authenticate }, async (req) => {
    const { tenantId } = req.user as { tenantId: string }
    const users = await withTenant(tenantId, (tx) => listUsers(tx, tenantId))
    return users.map(userView)
  })

  app.post(
    '/users/invite',
    { preHandler: [app.authenticate, requireRole('OWNER')] },
    async (req, reply) => {
      const { tenantId } = req.user as { tenantId: string }
      const { phone, role } = inviteSchema.parse(req.body)

      const result = await withTenant(tenantId, (tx) => inviteUser(tx, tenantId, phone, role))
      if (!result.ok) {
        return reply.code(409).send({ error: result.reason })
      }
      const users = await withTenant(tenantId, (tx) => listUsers(tx, tenantId))
      return reply.send({ users: users.map(userView) })
    },
  )

  app.delete(
    '/users/:id',
    { preHandler: [app.authenticate, requireRole('OWNER')] },
    async (req, reply) => {
      const { tenantId, userId } = req.user as { tenantId: string; userId: string }
      const { id } = req.params as { id: string }

      const result = await withTenant(tenantId, (tx) => removeUser(tx, tenantId, userId, id))
      if (!result.ok) {
        return reply.code(409).send({ error: result.reason })
      }
      return reply.send({ ok: true })
    },
  )
}
