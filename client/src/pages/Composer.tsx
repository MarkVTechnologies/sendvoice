import { useEffect, useMemo, useState } from 'react'
import { api, ApiError, type Invoice, type ItemSuggestion } from '../lib/api'
import { useAuth } from '../lib/auth'
import { enqueue } from '../lib/outbox'
import { buildWhatsAppSendLink } from '../lib/whatsapp'
import { deleteDraft, loadLatestDraft, saveDraft } from '../lib/drafts'

type Line = { id: string; description: string; qty: number; rate: number }

const AUTOSAVE_DEBOUNCE_MS = 500
// PRD §8.3 P1: item catalogue auto-save with fuzzy recall. Debounced
// separately from (and shorter than) the draft autosave above — this is a
// keystroke-driven network call, not a background save, so it needs to
// feel responsive without firing on every single character.
const ITEM_SEARCH_DEBOUNCE_MS = 250

/**
 * PRD 6.1 (J1): the app lands here, not on a dashboard. Inline numeric
 * keypad entry, live running total, real PDF preview before Approve & Send.
 * Invoice numbers are assigned server-side at approval (PRD 9.4) — this
 * screen only ever holds a draft; the total shown here is a preview, not
 * the number of record (the server recomputes it on approve).
 *
 * PRD §8.4 P0: the in-progress draft autosaves to IndexedDB (lib/drafts.ts)
 * so a lost connection or closed tab doesn't lose a merchant's work — never
 * the source of truth (PRD §9.1), just a local cache cleared once the
 * server (or the outbox, PRD §9.3) actually has it.
 */
export default function Composer() {
  const clearSession = useAuth((s) => s.clear)
  const [draftId, setDraftId] = useState<string>(() => crypto.randomUUID())
  const [customerName, setCustomerName] = useState('')
  const [customerWhatsapp, setCustomerWhatsapp] = useState('')
  const [lines, setLines] = useState<Line[]>([
    { id: crypto.randomUUID(), description: '', qty: 1, rate: 0 },
  ])
  const [status, setStatus] = useState<'idle' | 'sending' | 'queued' | 'sent' | 'error'>('idle')
  const [sentInvoice, setSentInvoice] = useState<Invoice | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeLineId, setActiveLineId] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<ItemSuggestion[]>([])

  const total = useMemo(
    () => lines.reduce((sum, l) => sum + l.qty * l.rate, 0),
    [lines],
  )

  // Restore any in-progress draft once on mount.
  useEffect(() => {
    loadLatestDraft().then((draft) => {
      if (!draft) return
      setDraftId(draft.id)
      setCustomerName(draft.customer.name)
      setCustomerWhatsapp(draft.customer.whatsapp ?? '')
      setLines(draft.lines.map((l) => ({ id: l.id, description: l.description, qty: l.qty ?? 1, rate: l.rate })))
    })
  }, [])

  // Debounced autosave — skip empty/trivial drafts so a merchant who never
  // typed anything doesn't leave a meaningless row behind.
  useEffect(() => {
    const hasContent = customerName.trim() || customerWhatsapp.trim() || lines.some((l) => l.description.trim())
    if (!hasContent) return
    const timer = setTimeout(() => {
      saveDraft({
        id: draftId,
        version: 1,
        customer: { name: customerName, whatsapp: customerWhatsapp || undefined },
        lines: lines.map((l) => ({ id: l.id, description: l.description, qty: l.qty, unit: undefined, rate: l.rate })),
      })
    }, AUTOSAVE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [draftId, customerName, customerWhatsapp, lines])

  // Item catalogue fuzzy recall, scoped to whichever line is focused —
  // querying by id (not just "the active description") so a selection made
  // right after typing doesn't race a stale in-flight search.
  const activeDescription = lines.find((l) => l.id === activeLineId)?.description ?? ''
  useEffect(() => {
    if (!activeLineId || !activeDescription.trim()) {
      setSuggestions([])
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      api
        .searchItems(activeDescription)
        .then((res) => {
          if (!cancelled) setSuggestions(res.items)
        })
        .catch(() => {
          if (!cancelled) setSuggestions([])
        })
    }, ITEM_SEARCH_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [activeLineId, activeDescription])

  function selectSuggestion(lineId: string, item: ItemSuggestion) {
    updateLine(lineId, { description: item.description, rate: Number(item.rate) })
    setActiveLineId(null)
    setSuggestions([])
  }

  function updateLine(id: string, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  }

  function addLine() {
    setLines((prev) => [...prev, { id: crypto.randomUUID(), description: '', qty: 1, rate: 0 }])
  }

  function resetDraft() {
    deleteDraft(draftId)
    setDraftId(crypto.randomUUID())
    setCustomerName('')
    setCustomerWhatsapp('')
    setLines([{ id: crypto.randomUUID(), description: '', qty: 1, rate: 0 }])
    setStatus('idle')
    setSentInvoice(null)
  }

  async function approveAndSend() {
    const payload = {
      customer: { name: customerName, whatsapp: customerWhatsapp },
      lines: lines
        .filter((l) => l.description)
        .map((l) => ({ description: l.description, qty: l.qty, rate: l.rate })),
    }

    if (!navigator.onLine) {
      await enqueue({ id: draftId, kind: 'approve-invoice', payload })
      await deleteDraft(draftId) // now durable in the outbox instead
      setStatus('queued')
      return
    }

    setStatus('sending')
    setError(null)
    try {
      const invoice = await api.approveInvoice(draftId, payload)
      await deleteDraft(draftId)
      setSentInvoice(invoice)
      setStatus('sent')
      // Rail A (PRD §6.1 J1): "Approve & Send" means WhatsApp opens with the
      // message pre-filled right away — the merchant's last step is tapping
      // send inside WhatsApp, not a separate click in our app. window.open
      // here (still inside the same click handler's async chain) generally
      // survives popup blockers; the Sent screen below keeps a manual
      // button as a fallback in case it doesn't.
      if (invoice.customer.whatsapp && invoice.hostedUrl) {
        window.open(buildWhatsAppSendLink(invoice.customer.whatsapp, invoice.number, invoice.hostedUrl), '_blank')
      }
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
        {sentInvoice.customer.whatsapp && sentInvoice.hostedUrl && (
          <button
            className="rounded bg-emerald-600 px-4 py-2 text-white"
            onClick={() =>
              window.open(
                buildWhatsAppSendLink(sentInvoice.customer.whatsapp!, sentInvoice.number, sentInvoice.hostedUrl!),
                '_blank',
              )
            }
          >
            Open WhatsApp
          </button>
        )}
        {sentInvoice.pdfUrl && (
          <button
            className="rounded border px-4 py-2"
            onClick={async () => {
              const url = await api.fetchInvoicePdfUrl(sentInvoice.id)
              window.open(url, '_blank')
            }}
          >
            View PDF
          </button>
        )}
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
            <div className="relative">
              <input
                className="w-full rounded border px-2 py-1"
                placeholder="Description"
                value={line.description}
                onChange={(e) => updateLine(line.id, { description: e.target.value })}
                onFocus={() => setActiveLineId(line.id)}
                onBlur={() => setTimeout(() => setActiveLineId((cur) => (cur === line.id ? null : cur)), 150)}
              />
              {activeLineId === line.id && suggestions.length > 0 && (
                <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-auto rounded border bg-white text-neutral-900 shadow-lg">
                  {suggestions.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-2 px-2 py-1 text-left text-sm text-neutral-900 hover:bg-emerald-50"
                        onClick={() => selectSuggestion(line.id, item)}
                      >
                        <span className="truncate">{item.description}</span>
                        <span className="shrink-0 text-neutral-500">{item.rate}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
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
