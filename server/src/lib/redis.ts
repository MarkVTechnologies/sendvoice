import { Redis } from 'ioredis'

/**
 * Plain app-level Redis client. Deliberately separate from the BullMQ
 * connection in jobs/queue.ts — BullMQ requires maxRetriesPerRequest: null,
 * which would make ordinary GET/SET calls here retry indefinitely instead
 * of failing fast.
 */
export const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')
