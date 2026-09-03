import type { FastifyInstance } from 'fastify'
import { recordHostedView, resolveHostedDocument } from '../services/hosted.js'
import { renderHostedInvoicePage } from '../services/hostedInvoicePage.js'

/**
 * PRD §8.6 P0 / §12 P0: public, tokenised, no login. Deliberately not under
 * /api and not part of the client SPA — this is what a customer opens from
 * a WhatsApp message, on whatever device, possibly with JS disabled.
 */
export default async function hostedRoutes(app: FastifyInstance) {
  app.get('/i/:token', async (req, reply) => {
    const { token } = req.params as { token: string }
    const doc = await resolveHostedDocument(token)
    if (!doc) {
      reply.code(404)
      return reply.type('text/plain').send('This invoice link is invalid or has expired.')
    }
    // Never let a tracking-write failure break rendering a real financial
    // document for the customer — recording the view matters, but showing
    // them the invoice matters more.
    try {
      await recordHostedView(doc.tenantId, doc.id)
    } catch (err) {
      req.log.error({ err, documentId: doc.id }, 'failed to record hosted invoice view')
    }
    reply.type('text/html')
    return reply.send(renderHostedInvoicePage(doc))
  })

  app.get('/i/:token/pdf', async (req, reply) => {
    const { token } = req.params as { token: string }
    const doc = await resolveHostedDocument(token)
    if (!doc?.pdfData) {
      return reply.code(404).send({ error: 'not_found' })
    }
    reply.header('Content-Type', 'application/pdf')
    reply.header('Content-Disposition', `inline; filename="${doc.number ?? 'invoice'}.pdf"`)
    return reply.send(Buffer.from(doc.pdfData))
  })
}
