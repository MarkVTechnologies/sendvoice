import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { withTenant } from '../lib/prisma.js'
import { deleteItem, listItems, searchItems } from '../services/items.js'

const querySchema = z.object({ q: z.string().optional() })

/**
 * PRD §8.3 P1: item catalogue auto-save with fuzzy recall — the composer's
 * description field calls this (with `q`) as the merchant types, so a
 * repeat line item gets suggested instead of retyped. Without `q` it lists
 * the catalogue instead (most-recent first) for the manage view — without
 * this a merchant has no way to see or prune what's accumulated. The
 * catalogue itself is written inline during approval (services/items.ts,
 * from invoices.ts), never here — this route is read + delete only.
 */
export default async function itemRoutes(app: FastifyInstance) {
  app.get('/items', { preHandler: app.authenticate }, async (req) => {
    const { tenantId } = req.user as { tenantId: string }
    const { q } = querySchema.parse(req.query)

    const items = await withTenant(tenantId, (tx) => (q ? searchItems(tx, tenantId, q) : listItems(tx, tenantId)))
    return { items }
  })

  app.delete('/items/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const { tenantId } = req.user as { tenantId: string }
    const { id } = req.params as { id: string }

    const deleted = await withTenant(tenantId, (tx) => deleteItem(tx, tenantId, id))
    if (!deleted) return reply.code(404).send({ error: 'item_not_found' })
    return reply.send({ ok: true })
  })
}
