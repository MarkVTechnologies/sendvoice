import { useEffect, useState } from 'react'
import { api, type Invoice } from '../lib/api'

/**
 * PRD 8.8 (P0): outstanding, overdue, paid this month, count sent.
 * Overdue and paid-this-month need due dates and payment recording, neither
 * of which exist yet (composer doesn't collect a due date; there's no
 * payment endpoint) — shown as "—" rather than a misleading 0.
 */
export default function Dashboard() {
  const [invoices, setInvoices] = useState<Invoice[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .listInvoices()
      .then(setInvoices)
      .catch(() => setError("Couldn't load invoices."))
  }, [])

  const outstanding = invoices
    ?.filter((inv) => inv.status !== 'PAID')
    .reduce((sum, inv) => sum + (Number(inv.total) - Number(inv.amountPaid)), 0)

  const stats = [
    { label: 'Outstanding', value: invoices ? outstanding!.toFixed(2) : '—' },
    { label: 'Overdue', value: '—' },
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

      {invoices && invoices.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-neutral-500">Recent</h2>
          {invoices.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between rounded border p-3 text-sm">
              <div>
                <p className="font-medium">{inv.number}</p>
                <p className="text-neutral-500">{inv.customer.name}</p>
              </div>
              <p className="font-medium">
                {inv.currency} {inv.total}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
