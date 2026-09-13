import type { FastifyInstance } from 'fastify'
import { recordHostedView, resolveHostedDocument, respondToQuote } from '../services/hosted.js'
import { renderHostedInvoicePage } from '../services/hostedInvoicePage.js'
import { withTenant } from '../lib/prisma.js'
import { recordPayment } from '../services/payments.js'
import { initializeTransaction, isPaystackConfigured, paystackSupportsCurrency, verifyTransaction } from '../services/paystack.js'

// Same constant as routes/invoices.ts (not shared — one line, not worth a
// module for) — needs to be a real absolute URL since Paystack redirects
// the customer's browser here directly, not a client-side fetch.
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 4177}`

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

  // PRD §8.7 P0: "Pay Now on the hosted invoice page." A plain HTML form
  // submit (no client JS — same reasoning as the quote respond form above),
  // POSTing here just to redirect straight on to Paystack's own hosted
  // payment page — the customer's card details never touch our server
  // (PRD §12 P0 PCI scope minimisation).
  app.post('/i/:token/pay', async (req, reply) => {
    const { token } = req.params as { token: string }
    const doc = await resolveHostedDocument(token)
    if (!doc) {
      reply.code(404)
      return reply.type('text/plain').send('This invoice link is invalid or has expired.')
    }

    const balance = Number(doc.total) - Number(doc.amountPaid)
    if (doc.docType !== 'INVOICE' || balance <= 0 || !isPaystackConfigured() || !paystackSupportsCurrency(doc.currency)) {
      // Shouldn't normally be reachable — the button that submits this form
      // only renders when all of the above already hold (hostedInvoicePage.ts)
      // — but a stale page in a customer's back-button history could still
      // submit it, so this is a real guard, not dead code.
      return reply.redirect(`/i/${token}`, 303)
    }

    // Paystack requires an email; the hosted page never collects one from
    // the customer (PRD §8.6: "no login" — adding a required field here
    // would contradict that), so a customer with no email on file gets a
    // deterministic placeholder tied to their own Customer id rather than
    // a shared/fake address.
    const email = doc.customer.email || `${doc.customerId}@payer.sendvoice.app`
    const reference = `sv_${doc.id}_${Date.now()}`

    try {
      const { authorizationUrl } = await initializeTransaction({
        email,
        amountMinorUnits: Math.round(balance * 100),
        currency: doc.currency,
        reference,
        callbackUrl: `${PUBLIC_BASE_URL}/i/${token}/pay/callback`,
        metadata: { tenantId: doc.tenantId, documentId: doc.id },
      })
      return reply.redirect(authorizationUrl, 303)
    } catch (err) {
      req.log.error({ err, documentId: doc.id }, 'paystack transaction initialize failed')
      return reply.redirect(`/i/${token}`, 303)
    }
  })

  // Paystack redirects the customer's browser here after the payment
  // attempt (success or failure) — purely a UX convenience so they land
  // back on the invoice immediately. This is deliberately NOT the
  // authoritative confirmation (PRD §8.7 P0: "automatic status → Paid on
  // webhook confirmation") — a customer can close the tab before this ever
  // fires, and the webhook in routes/webhooks.ts is what actually must not
  // be missed. Both call the same idempotent recordPayment, so whichever
  // fires first wins and the other is a no-op.
  app.get('/i/:token/pay/callback', async (req, reply) => {
    const { token } = req.params as { token: string }
    const { reference } = req.query as { reference?: string }
    const doc = await resolveHostedDocument(token)
    if (!doc) {
      reply.code(404)
      return reply.type('text/plain').send('This invoice link is invalid or has expired.')
    }

    if (reference) {
      try {
        const verified = await verifyTransaction(reference)
        if (verified.status === 'success') {
          await withTenant(doc.tenantId, (tx) =>
            recordPayment(tx, doc.id, {
              amount: verified.amountMinorUnits / 100,
              method: 'psp',
              provider: 'paystack',
              reference: verified.reference,
            }),
          )
        }
      } catch (err) {
        req.log.error({ err, documentId: doc.id, reference }, 'paystack callback verify failed')
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
