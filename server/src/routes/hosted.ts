import type { FastifyInstance } from 'fastify'
import { resolveHostedDocument } from '../services/hosted.js'
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
