import type { FastifyInstance, FastifyRequest } from 'fastify'
import { withTenant } from '../lib/prisma.js'
import { recordPayment } from '../services/payments.js'
import { verifyTransaction, verifyWebhookSignature } from '../services/paystack.js'

type RequestWithRawBody = FastifyRequest & { rawBody?: string }

/**
 * PRD §10.3: WhatsApp delivery-status and quality-rating webhooks.
 * PRD §8.7: payment provider webhooks (Paystack/Flutterwave/Stripe/
 * Razorpay/Mercado Pago/Xendit) confirm payment → Document.status = PAID.
 *
 * Every handler here must be idempotent (PRD §9.5) — providers retry.
 */
export default async function webhookRoutes(app: FastifyInstance) {
  // Overrides the default JSON parser, scoped to this plugin only (Fastify
  // encapsulation — every other route's body parsing is untouched). Needed
  // because verifying a Paystack signature (below) hashes the *raw* request
  // body — re-serialising the already-parsed object would silently break
  // verification the moment key order or whitespace ever differs.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    ;(req as RequestWithRawBody).rawBody = body as string
    try {
      done(null, (body as string).length ? JSON.parse(body as string) : {})
    } catch (err) {
      done(err as Error, undefined)
    }
  })

  app.post('/webhooks/whatsapp', async (req, reply) => {
    // TODO(Phase 2): verify BSP signature, fan delivery-status events into
    // Delivery rows keyed by idempotencyKey; surface quality-rating
    // degradation to the merchant before Meta throttles them (PRD §10.3).
    req.log.info({ body: req.body }, 'whatsapp webhook received')
    return reply.send({ ok: true })
  })

  app.post('/webhooks/payments/:provider', async (req, reply) => {
    const { provider } = req.params as { provider: string }

    if (provider !== 'paystack') {
      // TODO(Phase 1): Flutterwave/Stripe/Razorpay/Mercado Pago/Xendit —
      // same shape as the Paystack handler below once each is needed.
      req.log.info({ provider }, 'payment webhook received (provider not yet wired)')
      return reply.send({ ok: true })
    }

    const signature = req.headers['x-paystack-signature'] as string | undefined
    const rawBody = (req as RequestWithRawBody).rawBody ?? ''
    if (!verifyWebhookSignature(rawBody, signature)) {
      req.log.warn('paystack webhook: invalid or missing signature')
      return reply.code(401).send({ error: 'invalid_signature' })
    }

    const event = req.body as { event?: string; data?: { reference?: string } }
    if (event.event !== 'charge.success' || !event.data?.reference) {
      // Paystack sends many event types (transfer, subscription, etc.) we
      // don't act on yet — ack, don't 4xx, or Paystack keeps retrying them.
      return reply.send({ ok: true })
    }

    // Never trust the webhook body's own amount/status — re-verify
    // server-to-server against Paystack's record of the transaction.
    const verified = await verifyTransaction(event.data.reference)
    if (verified.status !== 'success') {
      req.log.warn({ reference: verified.reference, status: verified.status }, 'paystack webhook: verify disagreed')
      return reply.send({ ok: true })
    }

    const metadata = verified.metadata as { tenantId?: string; documentId?: string } | null
    if (!metadata?.tenantId || !metadata?.documentId) {
      req.log.error({ reference: verified.reference }, 'paystack webhook: missing tenantId/documentId in metadata')
      return reply.send({ ok: true })
    }

    await withTenant(metadata.tenantId, (tx) =>
      recordPayment(tx, metadata.documentId!, {
        amount: verified.amountMinorUnits / 100,
        method: 'psp',
        provider: 'paystack',
        reference: verified.reference,
      }),
    )

    return reply.send({ ok: true })
  })
}
