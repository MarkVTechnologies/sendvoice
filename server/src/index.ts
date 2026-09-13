import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import authRoutes from './routes/auth.js'
import invoiceRoutes from './routes/invoices.js'
import itemRoutes from './routes/items.js'
import webhookRoutes from './routes/webhooks.js'
import hostedRoutes from './routes/hosted.js'
import wabaRoutes from './routes/waba.js'
import userRoutes from './routes/users.js'
import { redis } from './lib/redis.js'

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => Promise<void>
  }
}

const app = Fastify({
  logger: process.env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : true,
})

await app.register(cors, { origin: true })
await app.register(jwt, { secret: process.env.JWT_SECRET ?? 'change-me' })

// PRD §12 P0: "rate limiting and abuse detection on sends... before public
// launch, not after." This is the general-purpose floor for every route;
// the OTP endpoints (the ones that actually cost money once Telnyx is live)
// get a much tighter, phone-keyed cap on top of this in services/otp.ts.
// Backed by the existing Redis client, not the plugin's in-memory default,
// so limits survive a dev-server restart and are shared across instances.
await app.register(rateLimit, {
  redis,
  max: 300,
  timeWindow: '1 minute',
})

app.decorate('authenticate', async (req, reply) => {
  try {
    await req.jwtVerify()
  } catch {
    reply.code(401).send({ error: 'unauthorized' })
  }
})

app.get('/api/health', async () => ({ ok: true }))

await app.register(authRoutes, { prefix: '/api' })
await app.register(invoiceRoutes, { prefix: '/api' })
await app.register(itemRoutes, { prefix: '/api' })
await app.register(webhookRoutes, { prefix: '/api' })
await app.register(wabaRoutes, { prefix: '/api' })
await app.register(userRoutes, { prefix: '/api' })
await app.register(hostedRoutes) // public, unauthenticated — not under /api

const port = Number(process.env.PORT ?? 4000)
app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err)
  process.exit(1)
})
