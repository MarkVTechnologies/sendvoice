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
import recurringRoutes from './routes/recurring.js'
import gdprRoutes from './routes/gdpr.js'
import customerRoutes from './routes/customers.js'
import { redis } from './lib/redis.js'
import { runDueRecurringSchedules } from './services/recurring.js'
import { runDueReminders } from './services/reminders.js'

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
await app.register(recurringRoutes, { prefix: '/api' })
await app.register(gdprRoutes, { prefix: '/api' })
await app.register(customerRoutes, { prefix: '/api' })
await app.register(hostedRoutes) // public, unauthenticated — not under /api

// PRD §8.4: in-process interval, not the BullMQ repeatable-job scaffolding
// in jobs/queue.ts — that needs a real, separately-run worker process to
// be production-correct, and nothing in this deployment starts one yet.
// An interval inside the same server process is the honest MVP shape;
// moving this to a real worker is a scaling concern, not a correctness
// one, once one exists. Configurable since a dev/test cadence (seconds)
// and a production one (minutes) are legitimately different needs.
const RECURRING_CHECK_INTERVAL_MS = Number(process.env.RECURRING_CHECK_INTERVAL_MS ?? 15 * 60 * 1000)
setInterval(() => {
  runDueRecurringSchedules(app.log).catch((err) => app.log.error({ err }, 'recurring schedule sweep failed'))
}, RECURRING_CHECK_INTERVAL_MS)

// PRD §8.6 P1: same in-process-interval shape and reasoning as recurring
// schedules above — stays dormant (no-op) for every tenant until Rail B is
// actually connected and invoice_reminder_due/overdue are approved.
const REMINDER_CHECK_INTERVAL_MS = Number(process.env.REMINDER_CHECK_INTERVAL_MS ?? 15 * 60 * 1000)
setInterval(() => {
  runDueReminders(app.log).catch((err) => app.log.error({ err }, 'reminder sweep failed'))
}, REMINDER_CHECK_INTERVAL_MS)

const port = Number(process.env.PORT ?? 4000)
app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err)
  process.exit(1)
})
