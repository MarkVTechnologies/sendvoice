import { useEffect, useState } from 'react'
import { api, type Customer } from '../lib/api'

// Same two-tap in-place confirm as Dashboard's revoke/convert actions —
// erasure is permanent, so it gets the same "click again within a window"
// guard rather than a native confirm() dialog.
const CONFIRM_WINDOW_MS = 4000

/**
 * PRD §12 P1: "GDPR/NDPR: data export, right to erasure (with a documented
 * carve-out for statutory invoice retention, typically 5-7 years)."
 * Erasure anonymizes a customer's contact details — their invoices stay
 * exactly as they were, since the tax authority still needs those.
 */
export default function Privacy() {
  const [customers, setCustomers] = useState<Customer[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [confirmingEraseId, setConfirmingEraseId] = useState<string | null>(null)

  useEffect(() => {
    if (!confirmingEraseId) return
    const timer = setTimeout(() => setConfirmingEraseId(null), CONFIRM_WINDOW_MS)
    return () => clearTimeout(timer)
  }, [confirmingEraseId])

  function load() {
    api
      .listCustomers()
      .then(setCustomers)
      .catch(() => setError("Couldn't load customers."))
  }

  useEffect(load, [])

  async function exportData() {
    setError(null)
    setExporting(true)
    try {
      await api.exportGdprData()
    } catch {
      setError("Couldn't export your data. Try again.")
    } finally {
      setExporting(false)
    }
  }

  async function erase(id: string) {
    if (confirmingEraseId !== id) {
      setConfirmingEraseId(id)
      return
    }
    setConfirmingEraseId(null)
    setError(null)
    try {
      await api.eraseCustomer(id)
      setCustomers(
        (prev) =>
          prev?.map((c) => (c.id === id ? { ...c, name: 'Erased customer', whatsapp: null, email: null } : c)) ??
          prev,
      )
    } catch {
      setError("Couldn't erase that customer. Try again.")
    }
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold">Privacy &amp; data</h1>

      <div className="rounded border p-3 text-sm">
        <p className="font-medium">Export your data</p>
        <p className="mt-1 text-neutral-500">
          Download everything about your business, customers, and invoices as a single file.
        </p>
        <button
          className="mt-2 rounded bg-neutral-800 px-3 py-2 text-white disabled:opacity-50"
          disabled={exporting}
          onClick={exportData}
        >
          {exporting ? 'Exporting…' : 'Export my data'}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-neutral-500">Customers</h2>
        <p className="text-xs text-neutral-500">
          Erasing a customer removes their name and contact details permanently. Their invoices are kept as-is —
          amounts and dates are retained for tax records.
        </p>
        {!customers && <p className="text-sm text-neutral-500">Loading…</p>}
        {customers?.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-2 rounded border p-3 text-sm">
            <div>
              <p className="font-medium">{c.name}</p>
              <p className="text-xs text-neutral-500">{c.whatsapp ?? c.email ?? '—'}</p>
            </div>
            {c.name !== 'Erased customer' && (
              <button className="text-xs text-red-600 underline" onClick={() => erase(c.id)}>
                {confirmingEraseId === c.id ? 'Confirm erase?' : 'Erase'}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
