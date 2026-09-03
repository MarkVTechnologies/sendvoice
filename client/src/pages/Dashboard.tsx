import { useEffect, useState } from 'react'
import { api, type Invoice } from '../lib/api'

/**
 * PRD 8.8 (P0): outstanding, overdue, paid this month, count sent.
 * Paid-this-month still needs real payment recording (Phase 1) — shown as
 * "—" rather than a misleading 0. Overdue now has what it needs: the
 * composer collects a due date.
 */
function isOverdue(inv: Invoice): boolean {
  return inv.status !== 'PAID' && inv.dueDate !== null && new Date(inv.dueDate) < new Date()
}
// A merchant re-clicking within this window confirms the revoke; clicking
// anything else first (or just waiting) disarms it again. Avoids a native
// confirm() dialog — blunt, unstyled, and untestable via browser automation
// — for a two-tap in-place confirm instead.
const REVOKE_CONFIRM_WINDOW_MS = 4000

export default function Dashboard() {
  const [invoices, setInvoices] = useState<Invoice[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmingRevokeId, setConfirmingRevokeId] = useState<string | null>(null)
  const [revokeError, setRevokeError] = useState<string | null>(null)

  useEffect(() => {
    api
      .listInvoices()
      .then(setInvoices)
      .catch(() => setError("Couldn't load invoices."))
  }, [])

  useEffect(() => {
    if (!confirmingRevokeId) return
    const timer = setTimeout(() => setConfirmingRevokeId(null), REVOKE_CONFIRM_WINDOW_MS)
    return () => clearTimeout(timer)
  }, [confirmingRevokeId])

  async function revokeLink(invoiceId: string) {
    if (confirmingRevokeId !== invoiceId) {
      setConfirmingRevokeId(invoiceId)
      return
    }
    setConfirmingRevokeId(null)
    setRevokeError(null)
    try {
      const { hostedUrl } = await api.revokeHostedLink(invoiceId)
      setInvoices((prev) => prev?.map((inv) => (inv.id === invoiceId ? { ...inv, hostedUrl } : inv)) ?? prev)
    } catch {
      setRevokeError("Couldn't revoke that link. Try again.")
    }
  }

  const outstanding = invoices
    ?.filter((inv) => inv.status !== 'PAID')
    .reduce((sum, inv) => sum + (Number(inv.total) - Number(inv.amountPaid)), 0)

  const overdue = invoices
    ?.filter(isOverdue)
    .reduce((sum, inv) => sum + (Number(inv.total) - Number(inv.amountPaid)), 0)

  const stats = [
    { label: 'Outstanding', value: invoices ? outstanding!.toFixed(2) : '—' },
    { label: 'Overdue', value: invoices ? overdue!.toFixed(2) : '—' },
    { label: 'Paid this month', value: '—' },
    { label: 'Sent', value: invoices ? String(invoices.length) : '—' },
  ]

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <div className="grid grid-cols-2 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded border p-3">
            <p className="text-sm text-neutral-500">{s.label}</p>
            <p className="text-2xl font-semibold">{s.value}</p>
          </div>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {revokeError && <p className="text-sm text-red-600">{revokeError}</p>}

      {invoices && invoices.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-neutral-500">Recent</h2>
          {invoices.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between gap-2 rounded border p-3 text-sm">
              <button
                className="flex-1 text-left disabled:opacity-50"
                disabled={!inv.pdfUrl}
                onClick={async () => {
                  if (!inv.pdfUrl) return
                  const url = await api.fetchInvoicePdfUrl(inv.id)
                  window.open(url, '_blank')
                }}
              >
                <p className="font-medium">
                  {inv.number}
                  {inv.status === 'VIEWED' && (
                    <span className="ml-2 text-xs font-normal text-sky-600">Viewed</span>
                  )}
                  {isOverdue(inv) && <span className="ml-2 text-xs font-normal text-red-600">Overdue</span>}
                </p>
                <p className="text-neutral-500">{inv.customer.name}</p>
              </button>
              <div className="flex flex-col items-end gap-1">
                <p className="font-medium">
                  {inv.currency} {inv.total}
                </p>
                {inv.hostedUrl && (
                  <button
                    className="text-xs text-amber-700 underline"
                    onClick={() => revokeLink(inv.id)}
                  >
                    {confirmingRevokeId === inv.id ? 'Confirm revoke?' : 'Revoke link'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
