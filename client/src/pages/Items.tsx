import { useEffect, useState } from 'react'
import { api, type ItemSuggestion } from '../lib/api'

// Same in-place two-tap confirm pattern as the Dashboard's "Revoke link" —
// no native confirm() dialog (blunt, unstyled, blocks browser-automation
// testing), and deleting a catalogue entry is exactly the kind of action
// worth a beat of friction before it happens.
const DELETE_CONFIRM_WINDOW_MS = 4000

/**
 * PRD §8.3 P1: the composer suggests items back as a merchant types, but
 * until now there was no way to see or prune what had actually accumulated
 * — a typo approved once, a price that's since changed. This is that view:
 * read + delete only, since the catalogue itself is only ever written
 * inline during approval (services/items.ts).
 */
export default function Items() {
  const [items, setItems] = useState<ItemSuggestion[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)

  useEffect(() => {
    api
      .listItems()
      .then((res) => setItems(res.items))
      .catch(() => setError("Couldn't load your item catalogue."))
  }, [])

  useEffect(() => {
    if (!confirmingDeleteId) return
    const timer = setTimeout(() => setConfirmingDeleteId(null), DELETE_CONFIRM_WINDOW_MS)
    return () => clearTimeout(timer)
  }, [confirmingDeleteId])

  async function deleteItem(id: string) {
    if (confirmingDeleteId !== id) {
      setConfirmingDeleteId(id)
      return
    }
    setConfirmingDeleteId(null)
    setError(null)
    try {
      await api.deleteItem(id)
      setItems((prev) => prev?.filter((item) => item.id !== id) ?? prev)
    } catch {
      setError("Couldn't delete that item. Try again.")
    }
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold">Item catalogue</h1>
      <p className="text-sm text-neutral-500">
        Every description you've approved on an invoice, remembered so the composer can suggest it back.
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {items && items.length === 0 && (
        <p className="text-sm text-neutral-500">Nothing here yet — it fills in as you send invoices.</p>
      )}

      {items && items.length > 0 && (
        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-2 rounded border p-3 text-sm">
              <div>
                <p className="font-medium">{item.description}</p>
                <p className="text-neutral-500">
                  {item.rate} · used {item.useCount}×
                </p>
              </div>
              <button className="text-xs text-red-700 underline" onClick={() => deleteItem(item.id)}>
                {confirmingDeleteId === item.id ? 'Confirm delete?' : 'Delete'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
