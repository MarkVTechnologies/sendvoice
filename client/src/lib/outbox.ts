import { getDB } from './db'

/**
 * Foreground-flush outbox (PRD 9.1 / 9.3): approval and send require
 * connectivity because invoice numbers are assigned server-side. We never
 * rely on Background Sync (unavailable on iOS) — instead we flush on next
 * foreground/online event and show an honest "Queued" state until then.
 */
export async function enqueue(entry: {
  id: string
  kind: 'approve-invoice' | 'create-customer' | 'record-payment'
  payload: unknown
}) {
  const db = await getDB()
  await db.put('outbox', { ...entry, createdAt: new Date().toISOString(), attempts: 0 })
}

export async function flushOutbox(send: (kind: string, payload: unknown) => Promise<void>) {
  if (!navigator.onLine) return
  const db = await getDB()
  const tx = db.transaction('outbox', 'readwrite')
  const all = await tx.store.getAll()
  for (const entry of all) {
    try {
      await send(entry.kind, entry.payload)
      await tx.store.delete(entry.id)
    } catch {
      entry.attempts += 1
      await tx.store.put(entry)
    }
  }
  await tx.done
}

export function watchConnectivity(onOnline: () => void) {
  window.addEventListener('online', onOnline)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') onOnline()
  })
}
