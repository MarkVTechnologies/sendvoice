import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

/**
 * Client-side cache only (PRD 9.1): IndexedDB must never be the source of
 * truth for merchant data. Server confirmation is what makes a record durable.
 */
interface SendvoiceDB extends DBSchema {
  drafts: {
    key: string // client-generated ULID
    value: {
      id: string
      version: number
      customer: { name: string; whatsapp?: string }
      lines: Array<{
        id: string
        description: string
        qty?: number
        unit?: string
        rate: number
      }>
      updatedAt: string
    }
  }
  customers: {
    key: string
    value: { id: string; name: string; whatsapp?: string; syncedAt: string }
    indexes: { 'by-name': string }
  }
  outbox: {
    key: string
    value: {
      id: string
      kind: 'approve-invoice' | 'create-customer' | 'record-payment'
      payload: unknown
      createdAt: string
      attempts: number
    }
  }
}

let dbPromise: Promise<IDBPDatabase<SendvoiceDB>> | null = null

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<SendvoiceDB>('sendvoice', 1, {
      upgrade(db) {
        db.createObjectStore('drafts', { keyPath: 'id' })
        const customers = db.createObjectStore('customers', { keyPath: 'id' })
        customers.createIndex('by-name', 'name')
        db.createObjectStore('outbox', { keyPath: 'id' })
      },
    })
  }
  return dbPromise
}
