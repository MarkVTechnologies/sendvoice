import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
export const prisma = new PrismaClient({ adapter })

/**
 * Runs `fn` with Postgres RLS scoped to one tenant for the lifetime of the
 * transaction (PRD §9.2/§12: tenant isolation enforced at the DB, not the
 * application). Every request handler that touches tenant data must go
 * through this — never call `prisma.<model>` directly from a route.
 */
export async function withTenant<T>(tenantId: string, fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`select set_config('app.tenant_id', ${tenantId}, true)`
      return fn(tx as unknown as PrismaClient)
    },
    // Neon's serverless compute can cold-start from idle; give connection
    // acquisition more room than Prisma's 5s default.
    { maxWait: 10_000, timeout: 10_000 },
  )
}
