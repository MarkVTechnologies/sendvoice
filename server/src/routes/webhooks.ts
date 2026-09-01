import type { FastifyInstance } from 'fastify'

/**
 * PRD §10.3: WhatsApp delivery-status and quality-rating webhooks.
 * PRD §8.7: payment provider webhooks (Paystack/Flutterwave/Stripe/
 * Razorpay/Mercado Pago/Xendit) confirm payment → Document.status = PAID.
 *
 * Every handler here must be idempotent (PRD §9.5) — providers retry.
 */
export default async function webhookRoutes(app: FastifyInstance) {
  app.post('/webhooks/whatsapp', async (req, reply) => {
    // TODO(Phase 2): verify BSP signature, fan delivery-status events into
    // Delivery rows keyed by idempotencyKey; surface quality-rating
    // degradation to the merchant before Meta throttles them (PRD §10.3).
    req.log.info({ body: req.body }, 'whatsapp webhook received')
    return reply.send({ ok: true })
  })

  app.post('/webhooks/payments/:provider', async (req, reply) => {
    // TODO(Phase 1): verify provider signature, map to Document, record
    // Payment, set status → PAID/PARTIALLY_PAID, trigger receipt send.
    req.log.info({ provider: (req.params as { provider: string }).provider }, 'payment webhook received')
    return reply.send({ ok: true })
  })
}
