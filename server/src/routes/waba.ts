import type { FastifyInstance } from 'fastify'
import { withTenant } from '../lib/prisma.js'
import { requireRole } from '../lib/authz.js'
import { isEmbeddedSignupConfigured } from '../services/telnyx.js'
import {
  listTemplates,
  refreshTemplateStatuses,
  refreshWabaConnection,
  startWabaConnection,
  submitCoreTemplates,
} from '../services/waba.js'
import { sampleInvoicePdf } from '../services/sampleInvoicePdf.js'

function templateView(t: { id: string; name: string; status: string; rejectionReason: string | null }) {
  return { id: t.id, name: t.name, status: t.status, rejectionReason: t.rejectionReason }
}

/**
 * PRD §10.1/§10.2: WABA connection (Embedded Signup, via Telnyx's Hosted
 * Signup) and the per-merchant template management surface.
 */
export default async function wabaRoutes(app: FastifyInstance) {
  // Public and unauthenticated on purpose — this needs to be fetchable by
  // Meta's own template-review process (services/waba.ts's
  // submitCoreTemplates), which has no Sendvoice credentials.
  app.get('/waba/sample-invoice.pdf', async (_req, reply) => {
    reply.header('Content-Type', 'application/pdf')
    return reply.send(sampleInvoicePdf)
  })

  app.post('/waba/connect', { preHandler: [app.authenticate, requireRole('OWNER')] }, async (req, reply) => {
    if (!isEmbeddedSignupConfigured()) {
      return reply.code(503).send({ error: 'embedded_signup_not_configured' })
    }
    const { tenantId } = req.user as { tenantId: string }
    const url = await withTenant(tenantId, (tx) => startWabaConnection(tx, tenantId))
    return reply.send({ url })
  })

  app.get('/waba/status', { preHandler: app.authenticate }, async (req, reply) => {
    const { tenantId } = req.user as { tenantId: string }
    const [connection, templates] = await withTenant(tenantId, async (tx) => [
      await refreshWabaConnection(tx, tenantId),
      await listTemplates(tx, tenantId),
    ])
    return reply.send({ ...connection, templates: templates.map(templateView) })
  })

  app.post('/waba/templates/submit', { preHandler: [app.authenticate, requireRole('OWNER')] }, async (req, reply) => {
    const { tenantId } = req.user as { tenantId: string }
    try {
      await withTenant(tenantId, (tx) => submitCoreTemplates(tx, tenantId))
    } catch (err) {
      req.log.error({ err, tenantId }, 'template submission failed')
      return reply.code(400).send({ error: 'template_submission_failed' })
    }
    const templates = await withTenant(tenantId, (tx) => listTemplates(tx, tenantId))
    return reply.send({ templates: templates.map(templateView) })
  })

  app.post('/waba/templates/refresh', { preHandler: app.authenticate }, async (req, reply) => {
    const { tenantId } = req.user as { tenantId: string }
    await withTenant(tenantId, (tx) => refreshTemplateStatuses(tx, tenantId))
    const templates = await withTenant(tenantId, (tx) => listTemplates(tx, tenantId))
    return reply.send({ templates: templates.map(templateView) })
  })
}
