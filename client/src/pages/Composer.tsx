import { useMemo, useState } from 'react'
import { enqueue } from '../lib/outbox'

type Line = { id: string; description: string; qty: number; rate: number }

/**
 * PRD 6.1 (J1): the app lands here, not on a dashboard. Inline numeric
 * keypad entry, live running total, real PDF preview before Approve & Send.
 * Invoice numbers are assigned server-side at approval (PRD 9.4) — this
 * screen only ever holds a draft.
 */
export default function Composer() {
  const [customerName, setCustomerName] = useState('')
  const [customerWhatsapp, setCustomerWhatsapp] = useState('')
  const [lines, setLines] = useState<Line[]>([
    { id: crypto.randomUUID(), description: '', qty: 1, rate: 0 },
  ])
  const [status, setStatus] = useState<'idle' | 'queued' | 'sent'>('idle')

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

  async function approveAndSend() {
    const draftId = crypto.randomUUID()
    if (!navigator.onLine) {
      await enqueue({ id: draftId, kind: 'approve-invoice', payload: { customerName, customerWhatsapp, lines } })
      setStatus('queued')
      return
    }
    // TODO(Phase 0): call api.approveInvoice, then open Rail A deep link
    // (wa.me/<number>?text=<prefilled message + hosted invoice link>).
    setStatus('sent')
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
        disabled={!customerWhatsapp || lines.every((l) => !l.description)}
      >
        Approve &amp; Send
      </button>

      {status === 'queued' && (
        <p className="text-sm text-amber-700">Queued — will send when you&apos;re back online.</p>
      )}
      {status === 'sent' && <p className="text-sm text-emerald-700">Sent.</p>}
    </div>
  )
}
