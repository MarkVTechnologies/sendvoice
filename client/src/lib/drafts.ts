import { getDB } from './db'

/**
 * PRD §8.4 P0 "draft autosave, offline-capable": a merchant mid-invoice who
 * loses connection or closes the tab shouldn't lose their work — it lives
 * only in IndexedDB until approval, never the source of truth (PRD §9.1).
 * This app only ever has one in-progress draft at a time (no multi-draft
 * list UI), so there's at most one row here.
 */
export type DraftRecord = {
  id: string
  version: number
  customer: { name: string; whatsapp?: string }
  lines: Array<{ id: string; description: string; qty?: number; unit?: string; rate: number }>
  dueDate?: string // YYYY-MM-DD, straight from an <input type="date">
  updatedAt: string
}

export async function saveDraft(draft: Omit<DraftRecord, 'updatedAt'>) {
  const db = await getDB()
  await db.put('drafts', { ...draft, updatedAt: new Date().toISOString() })
}

/** Most recently updated draft, if any — there should be ≤1 in practice. */
export async function loadLatestDraft(): Promise<DraftRecord | undefined> {
  const db = await getDB()
  const all = await db.getAll('drafts')
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
}

export async function deleteDraft(id: string) {
  const db = await getDB()
  await db.delete('drafts', id)
}
