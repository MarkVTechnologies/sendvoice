import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { issueOtp, verifyOtp } from '../services/otp.js'
import { resolveOrCreateIdentity } from '../services/auth.js'
import { isTelnyxConfigured, sendOtp } from '../services/telnyx.js'

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
  // PRD §6.1: "logo (optional, skippable)". Base64 in the same JSON body
  // rather than multipart — simple, and fine for something logo-sized.
  // ~3.5M base64 chars is a blunt P0 sanity cap (~2.6MB decoded), not a
  // tuned production limit.
  logo: z
    .object({
      dataBase64: z.string().max(3_500_000),
      mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    })
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

    if (isTelnyxConfigured()) {
      try {
        await sendOtp(phone, code)
      } catch (err) {
        req.log.error({ err, phone }, 'Telnyx OTP send failed')
        return reply.code(502).send({ error: 'otp_send_failed' })
      }
      // A real send happened — devCode must never appear in the response
      // once there's somewhere real for the code to have gone, regardless
      // of NODE_ENV.
      return reply.send({ ok: true })
    }

    // No BSP configured (dev, or prod misconfiguration) — nowhere real to
    // deliver this, so log it and hand the code back directly for local
    // testing. Never in production: devCode in a response only makes sense
    // when nothing real was sent.
    req.log.info({ phone, code }, 'otp issued (dev: Telnyx not configured, logging instead of sending)')
    const devOnly = process.env.NODE_ENV !== 'production' ? { devCode: code } : {}
    return reply.send({ ok: true, ...devOnly })
  })

  app.post('/auth/otp/verify', async (req, reply) => {
    const { phone, code, businessName, country, currency, tax, logo } = verifyOtpSchema.parse(req.body)

    const ok = await verifyOtp(phone, code)
    if (!ok) {
      return reply.code(401).send({ error: 'invalid_or_expired_code' })
    }

    const identity = await resolveOrCreateIdentity(phone, {
      businessName,
      country,
      currency,
      taxRules: tax,
      logo: logo ? { data: Buffer.from(logo.dataBase64, 'base64'), mimeType: logo.mimeType } : undefined,
    })
    const token = await reply.jwtSign(identity)
    return reply.send({ token })
  })
}
