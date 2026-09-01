import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import authRoutes from './routes/auth.js'
import invoiceRoutes from './routes/invoices.js'
import webhookRoutes from './routes/webhooks.js'

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
await app.register(webhookRoutes, { prefix: '/api' })

const port = Number(process.env.PORT ?? 4000)
app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err)
  process.exit(1)
})
