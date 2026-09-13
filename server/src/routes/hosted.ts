import type { FastifyInstance } from 'fastify'
import { recordHostedView, resolveHostedDocument, respondToQuote } from '../services/hosted.js'
import { renderHostedInvoicePage } from '../services/hostedInvoicePage.js'

/**
 * PRD §8.6 P0 / §12 P0: public, tokenised, no login. Deliberately not under
 * /api and not part of the client SPA — this is what a customer opens from
 * a WhatsApp message, on whatever device, possibly with JS disabled.
 */
export default async function hostedRoutes(app: FastifyInstance) {
  // Scoped to this plugin only (Fastify encapsulation) — the JSON API
  // routes elsewhere are untouched. Needed because a quote's accept/decline
  // (below) is a plain HTML <form method="post">, not a fetch() call: the
  // hosted page ships zero client JS by design (PRD §9.1 "works with JS
  // disabled for the core view"), so the browser submits it as a normal
  // urlencoded form post, not JSON.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, Object.fromEntries(new URLSearchParams(body as string)))
    } catch (err) {
      done(err as Error, undefined)
    }
  })

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

  // PRD §7.3/§10.2: a quote's accept/decline, submitted as a plain HTML
  // form — no client JS, matching the rest of this page's no-JS-required
  // core view. Redirects back to the same token URL (303, POST→GET) so the
  // customer sees their answer reflected rather than a bare 200 response.
  app.post('/i/:token/respond', async (req, reply) => {
    const { token } = req.params as { token: string }
    const { response } = (req.body ?? {}) as { response?: string }
    const doc = await resolveHostedDocument(token)
    if (!doc) {
      reply.code(404)
      return reply.type('text/plain').send('This invoice link is invalid or has expired.')
    }
    if (response === 'accept' || response === 'decline') {
      try {
        await respondToQuote(doc.tenantId, doc.id, response)
      } catch (err) {
        req.log.error({ err, documentId: doc.id }, 'failed to record quote response')
      }
    }
    return reply.redirect(`/i/${token}`, 303)
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
