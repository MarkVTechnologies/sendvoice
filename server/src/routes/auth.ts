import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { issueOtp, verifyOtp } from '../services/otp.js'
import { resolveOrCreateIdentity } from '../services/auth.js'

const requestOtpSchema = z.object({ phone: z.string().min(6) })
const verifyOtpSchema = z.object({
  phone: z.string().min(6),
  code: z.string().length(6),
  businessName: z.string().min(1).optional(),
  country: z.string().length(2).optional(),
  currency: z.string().length(3).optional(),
  // "I don't charge tax" (PRD §6.1 J1) is the default when this is omitted.
  tax: z
    .discriminatedUnion('mode', [
      z.object({ mode: z.literal('none') }),
      z.object({ mode: z.literal('exclusive'), ratePercent: z.number().min(0).max(100) }),
    ])
    .optional(),
})

/**
 * PRD §8.1: WhatsApp/SMS OTP auth. Phone number is the primary identity —
 * no email, no password (PRD §6.1 J1).
 */
export default async function authRoutes(app: FastifyInstance) {
  app.post('/auth/otp/request', async (req, reply) => {
    const { phone } = requestOtpSchema.parse(req.body)
    const code = await issueOtp(phone)

    // TODO(Phase 2): send via WhatsApp utility template (fallback SMS),
    // never a marketing-category send. No BSP is wired up yet (Open
    // Decision #1 in the plan blocks that), so for now the code goes to the
    // server log — this endpoint is not yet safe to expose in production.
    req.log.info({ phone, code }, 'otp issued (dev: BSP not wired up, logging instead of sending)')

    const devOnly = process.env.NODE_ENV !== 'production' ? { devCode: code } : {}
    return reply.send({ ok: true, ...devOnly })
  })

  app.post('/auth/otp/verify', async (req, reply) => {
    const { phone, code, businessName, country, currency, tax } = verifyOtpSchema.parse(req.body)

    const ok = await verifyOtp(phone, code)
    if (!ok) {
      return reply.code(401).send({ error: 'invalid_or_expired_code' })
    }

    const identity = await resolveOrCreateIdentity(phone, {
      businessName,
      country,
      currency,
      taxRules: tax,
    })
    const token = await reply.jwtSign(identity)
    return reply.send({ token })
  })
}
