import { useMemo, useState } from 'react'
import { api, ApiError, type Invoice } from '../lib/api'
import { useAuth } from '../lib/auth'
import { enqueue } from '../lib/outbox'

type Line = { id: string; description: string; qty: number; rate: number }

/**
 * PRD 6.1 (J1): the app lands here, not on a dashboard. Inline numeric
 * keypad entry, live running total, real PDF preview before Approve & Send.
 * Invoice numbers are assigned server-side at approval (PRD 9.4) — this
 * screen only ever holds a draft; the total shown here is a preview, not
 * the number of record (the server recomputes it on approve).
 */
export default function Composer() {
  const clearSession = useAuth((s) => s.clear)
  const [customerName, setCustomerName] = useState('')
  const [customerWhatsapp, setCustomerWhatsapp] = useState('')
  const [lines, setLines] = useState<Line[]>([
    { id: crypto.randomUUID(), description: '', qty: 1, rate: 0 },
  ])
  const [status, setStatus] = useState<'idle' | 'sending' | 'queued' | 'sent' | 'error'>('idle')
  const [sentInvoice, setSentInvoice] = useState<Invoice | null>(null)
  const [error, setError] = useState<string | null>(null)

  const total = useMemo(
    () => lines.reduce((sum, l) => sum + l.qty * l.rate, 0),
    [lines],
  )

  function updateLine(id: string, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  }

  function addLine() {
    setLines((prev) => [...prev, { id: crypto.randomUUID(), description: '', qty: 1, rate: 0 }])
  }

  function resetDraft() {
    setCustomerName('')
    setCustomerWhatsapp('')
    setLines([{ id: crypto.randomUUID(), description: '', qty: 1, rate: 0 }])
    setStatus('idle')
    setSentInvoice(null)
  }

  async function approveAndSend() {
    const draftId = crypto.randomUUID()
    const payload = {
      customer: { name: customerName, whatsapp: customerWhatsapp },
      lines: lines
        .filter((l) => l.description)
        .map((l) => ({ description: l.description, qty: l.qty, rate: l.rate })),
    }

    if (!navigator.onLine) {
      await enqueue({ id: draftId, kind: 'approve-invoice', payload })
      setStatus('queued')
      return
    }

    setStatus('sending')
    setError(null)
    try {
      const invoice = await api.approveInvoice(draftId, payload)
      setSentInvoice(invoice)
      setStatus('sent')
      // Rail A (PRD §10, §6.1): open a wa.me deep link with the invoice
      // pre-filled, once there's a hosted invoice page to link to. Tracked
      // as a remaining Phase 0 item — approval alone is the milestone here.
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        clearSession()
        return
      }
      setError("Couldn't reach the server. If you're offline this will queue automatically.")
      setStatus('error')
    }
  }

  if (status === 'sent' && sentInvoice) {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-4 p-6 text-center">
        <h1 className="text-xl font-semibold text-emerald-700">Sent</h1>
        <p className="text-3xl font-semibold">{sentInvoice.number}</p>
        <p className="text-neutral-600">
          {sentInvoice.currency} {sentInvoice.total} to {sentInvoice.customer.name}
        </p>
        <button className="mt-4 rounded border px-4 py-2" onClick={resetDraft}>
          New invoice
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold">New invoice</h1>

      <div className="flex flex-col gap-2 rounded border p-3">
        <input
          className="rounded border px-3 py-2"
          placeholder="Customer name"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
        />
        <input
          className="rounded border px-3 py-2"
          placeholder="WhatsApp number"
          value={customerWhatsapp}
          onChange={(e) => setCustomerWhatsapp(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        {lines.map((line) => (
          <div key={line.id} className="grid grid-cols-[1fr_4rem_5rem] gap-2">
            <input
              className="rounded border px-2 py-1"
              placeholder="Description"
              value={line.description}
              onChange={(e) => updateLine(line.id, { description: e.target.value })}
            />
            <input
              className="rounded border px-2 py-1"
              type="number"
              inputMode="numeric"
              value={line.qty}
              onChange={(e) => updateLine(line.id, { qty: Number(e.target.value) })}
            />
            <input
              className="rounded border px-2 py-1"
              type="number"
              inputMode="decimal"
              value={line.rate}
              onChange={(e) => updateLine(line.id, { rate: Number(e.target.value) })}
            />
          </div>
        ))}
        <button className="text-left text-sm text-emerald-700" onClick={addLine} type="button">
          + Add line
        </button>
      </div>

      <div className="flex items-center justify-between border-t pt-3 text-lg font-semibold">
        <span>Total</span>
        <span>{total.toFixed(2)}</span>
      </div>

      <button
        className="rounded bg-emerald-700 px-4 py-3 text-white disabled:opacity-50"
        onClick={approveAndSend}
        disabled={
          status === 'sending' || !customerWhatsapp || lines.every((l) => !l.description)
        }
      >
        {status === 'sending' ? 'Sending…' : 'Approve & Send'}
      </button>

      {status === 'queued' && (
        <p className="text-sm text-amber-700">Queued — will send when you&apos;re back online.</p>
      )}
      {status === 'error' && error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
