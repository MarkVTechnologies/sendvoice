import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { withTenant } from '../lib/prisma.js'
import { searchItems } from '../services/items.js'

const querySchema = z.object({ q: z.string().optional() })

/**
 * PRD §8.3 P1: item catalogue auto-save with fuzzy recall — the composer's
 * description field calls this as the merchant types, so a repeat line item
 * gets suggested instead of retyped. Read-only; the catalogue itself is
 * written inline during approval (services/items.ts, from invoices.ts).
 */
export default async function itemRoutes(app: FastifyInstance) {
  app.get('/items', { preHandler: app.authenticate }, async (req) => {
    const { tenantId } = req.user as { tenantId: string }
    const { q } = querySchema.parse(req.query)
    if (!q) return { items: [] }

    const items = await withTenant(tenantId, (tx) => searchItems(tx, tenantId, q))
    return { items }
  })
}
