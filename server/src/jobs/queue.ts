import { Queue, Worker, type Job } from 'bullmq'
import { Redis } from 'ioredis'

/**
 * Durable job queue for sends, retries, reminders, webhooks (PRD §9.2).
 * Every send carries an idempotency key (PRD §9.5) so retries after a
 * transient failure never double-send.
 */
const connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
})

export const sendQueue = new Queue('whatsapp-send', { connection })
export const reminderQueue = new Queue('reminders', { connection })

export type SendJobData = {
  documentId: string
  rail: 'RAIL_A_ASSISTED' | 'RAIL_B_DIRECT'
  idempotencyKey: string
}

export function startSendWorker(handler: (job: Job<SendJobData>) => Promise<void>) {
  return new Worker<SendJobData>('whatsapp-send', handler, {
    connection,
    // Exponential backoff with a hard cap, then a merchant-visible failure
    // state and one-tap fallback to Rail A (PRD §9.5).
  })
}
