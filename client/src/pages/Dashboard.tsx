import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Frequency, type Invoice } from '../lib/api'
import { buildWhatsAppSendLink } from '../lib/whatsapp'

/**
 * PRD 8.8 (P0): outstanding, overdue, paid this month, count sent.
 * Paid-this-month still needs real payment recording (Phase 1) — shown as
 * "—" rather than a misleading 0. Overdue now has what it needs: the
 * composer collects a due date.
 *
 * Only ever true for an INVOICE — a quote's dueDate means "valid until",
 * not "payment overdue", and quotes are excluded from every money stat
 * below for the same reason (PRD §7.3: a quote isn't billed, it's offered).
 */
function isOverdue(inv: Invoice): boolean {
  return (
    inv.docType === 'INVOICE' && inv.status !== 'PAID' && inv.dueDate !== null && new Date(inv.dueDate) < new Date()
  )
}
// A merchant re-clicking within this window confirms the revoke/convert;
// clicking anything else first (or just waiting) disarms it again. Avoids a
// native confirm() dialog — blunt, unstyled, and untestable via browser
// automation — for a two-tap in-place confirm instead.
const CONFIRM_WINDOW_MS = 4000

export default function Dashboard() {
  const [invoices, setInvoices] = useState<Invoice[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmingRevokeId, setConfirmingRevokeId] = useState<string | null>(null)
  const [revokeError, setRevokeError] = useState<string | null>(null)
  const [confirmingConvertId, setConfirmingConvertId] = useState<string | null>(null)
  const [convertingId, setConvertingId] = useState<string | null>(null)
  const [convertError, setConvertError] = useState<string | null>(null)
  // PRD §8.7 P0: manual cash/bank-transfer recording. `payingId` is which
  // invoice's inline form is open — same "one open at a time" shape as the
  // revoke/convert confirms above, just without their timed auto-dismiss
  // since filling in an amount takes longer than a single tap.
  const [payingId, setPayingId] = useState<string | null>(null)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'bank_transfer'>('cash')
  const [recordingPayment, setRecordingPayment] = useState(false)
  const [paymentError, setPaymentError] = useState<string | null>(null)
  // PRD §8.8 P1: "Export CSV... date-range filtered." Both bounds optional
  // — an empty range exports everything, matching how the date filter on
  // the server (routes/invoices.ts) treats an absent from/to.
  const [exportFrom, setExportFrom] = useState('')
  const [exportTo, setExportTo] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  // PRD §8.6/§10: Rail B send — always safe to attempt (the endpoint
  // returns a clear reason rather than erroring), so no separate
  // "is WABA connected" check is fetched here; the reason itself explains
  // why, same honesty as Pay Now's disabled state before a PSP is wired.
  const [sendingRailBId, setSendingRailBId] = useState<string | null>(null)
  const [railBResult, setRailBResult] = useState<Record<string, string>>({})
  // PRD §8.4 P1 / §11.4: "make recurring" from an existing invoice, one
  // frequency choice per row (defaults to monthly — the common case) with
  // no separate form, since the schedule can be paused/removed afterward
  // from the Recurring page if the frequency ends up wrong.
  const [recurringFrequency, setRecurringFrequency] = useState<Record<string, Frequency>>({})
  const [makingRecurringId, setMakingRecurringId] = useState<string | null>(null)
  const [recurringActionResult, setRecurringActionResult] = useState<Record<string, string>>({})

  useEffect(() => {
    api
      .listInvoices()
      .then(setInvoices)
      .catch(() => setError("Couldn't load invoices."))
  }, [])

  useEffect(() => {
    if (!confirmingRevokeId) return
    const timer = setTimeout(() => setConfirmingRevokeId(null), CONFIRM_WINDOW_MS)
    return () => clearTimeout(timer)
  }, [confirmingRevokeId])

  useEffect(() => {
    if (!confirmingConvertId) return
    const timer = setTimeout(() => setConfirmingConvertId(null), CONFIRM_WINDOW_MS)
    return () => clearTimeout(timer)
  }, [confirmingConvertId])

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

  // PRD §7.3: "Quote→Invoice conversion is one tap and preserves the link
  // for audit." Mirrors the composer's own Approve & Send: a fresh invoice
  // is created, added to the list, and WhatsApp opens pre-filled with it —
  // converting isn't a lesser action than sending a new invoice outright.
  async function convertQuote(quoteId: string) {
    if (confirmingConvertId !== quoteId) {
      setConfirmingConvertId(quoteId)
      return
    }
    setConfirmingConvertId(null)
    setConvertError(null)
    setConvertingId(quoteId)
    try {
      const invoice = await api.convertQuote(quoteId)
      setInvoices((prev) => (prev ? [invoice, ...prev] : prev))
      if (invoice.customer.whatsapp && invoice.hostedUrl) {
        window.open(
          buildWhatsAppSendLink(invoice.customer.whatsapp, invoice.number, invoice.hostedUrl, invoice.docType),
          '_blank',
        )
      }
    } catch {
      setConvertError("Couldn't convert that quote. Try again.")
    } finally {
      setConvertingId(null)
    }
  }

  function openPaymentForm(inv: Invoice) {
    setPayingId(inv.id)
    setPaymentAmount((Number(inv.total) - Number(inv.amountPaid)).toFixed(2))
    setPaymentMethod('cash')
    setPaymentError(null)
  }

  async function submitPayment(invoiceId: string) {
    const amount = Number(paymentAmount)
    if (!amount || amount <= 0) {
      setPaymentError('Enter a valid amount.')
      return
    }
    setPaymentError(null)
    setRecordingPayment(true)
    try {
      const updated = await api.recordPayment(invoiceId, { amount, method: paymentMethod })
      setInvoices((prev) => prev?.map((inv) => (inv.id === invoiceId ? updated : inv)) ?? prev)
      setPayingId(null)
    } catch {
      setPaymentError("Couldn't record that payment. Try again.")
    } finally {
      setRecordingPayment(false)
    }
  }

  const RAILB_REASON_MESSAGES: Record<string, string> = {
    not_connected: 'Connect WhatsApp Business first',
    template_not_approved: "invoice_new template isn't approved yet",
    opted_out: 'This customer opted out of WhatsApp messages',
    no_whatsapp_number: 'No WhatsApp number on file for this customer',
    already_sent: 'Already sent via WhatsApp Business',
  }

  async function sendRailB(invoiceId: string) {
    setSendingRailBId(invoiceId)
    setRailBResult((prev) => ({ ...prev, [invoiceId]: '' }))
    try {
      const result = await api.sendInvoiceViaRailB(invoiceId)
      setRailBResult((prev) => ({
        ...prev,
        [invoiceId]: result.ok ? 'Sent' : (RAILB_REASON_MESSAGES[result.reason] ?? "Couldn't send"),
      }))
    } catch {
      setRailBResult((prev) => ({ ...prev, [invoiceId]: "Couldn't send" }))
    } finally {
      setSendingRailBId(null)
    }
  }

  async function makeRecurring(invoiceId: string) {
    const frequency = recurringFrequency[invoiceId] ?? 'monthly'
    setMakingRecurringId(invoiceId)
    setRecurringActionResult((prev) => ({ ...prev, [invoiceId]: '' }))
    try {
      const result = await api.makeRecurring(invoiceId, frequency)
      setRecurringActionResult((prev) => ({
        ...prev,
        [invoiceId]: result.ok ? 'Recurring schedule created' : "Couldn't create a schedule",
      }))
    } catch {
      setRecurringActionResult((prev) => ({ ...prev, [invoiceId]: "Couldn't create a schedule" }))
    } finally {
      setMakingRecurringId(null)
    }
  }

  async function exportCsv() {
    setExportError(null)
    setExporting(true)
    try {
      await api.exportInvoicesCsv({ from: exportFrom || undefined, to: exportTo || undefined })
    } catch {
      setExportError("Couldn't export. Try again.")
    } finally {
      setExporting(false)
    }
  }

  const financial = invoices?.filter((inv) => inv.docType === 'INVOICE')

  const outstanding = financial
    ?.filter((inv) => inv.status !== 'PAID')
    .reduce((sum, inv) => sum + (Number(inv.total) - Number(inv.amountPaid)), 0)

  const overdue = financial
    ?.filter(isOverdue)
    .reduce((sum, inv) => sum + (Number(inv.total) - Number(inv.amountPaid)), 0)

  const stats = [
    { label: 'Outstanding', value: invoices ? outstanding!.toFixed(2) : '—' },
    { label: 'Overdue', value: invoices ? overdue!.toFixed(2) : '—' },
    { label: 'Paid this month', value: '—' },
    { label: 'Sent', value: financial ? String(financial.length) : '—' },
  ]

  // A quote that's already been converted shows a link to the resulting
  // invoice instead of a second "Convert" button — convertedFromId is the
  // audit trail the PRD asks for (§7.3), read back out of the same list.
  const invoiceByQuoteId = new Map(
    (invoices ?? []).filter((inv) => inv.convertedFromId).map((inv) => [inv.convertedFromId as string, inv]),
  )

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <Link to="/recurring" className="text-xs text-emerald-700 underline">
          Recurring schedules
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded border p-3">
            <p className="text-sm text-neutral-500">{s.label}</p>
            <p className="text-2xl font-semibold">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded border p-3 text-sm">
        <div className="flex flex-col">
          <label className="text-xs text-neutral-500">From</label>
          <input
            type="date"
            className="rounded border px-2 py-1"
            value={exportFrom}
            onChange={(e) => setExportFrom(e.target.value)}
          />
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-neutral-500">To</label>
          <input
            type="date"
            className="rounded border px-2 py-1"
            value={exportTo}
            onChange={(e) => setExportTo(e.target.value)}
          />
        </div>
        <button
          className="rounded bg-neutral-800 px-3 py-2 text-white disabled:opacity-50"
          disabled={exporting}
          onClick={exportCsv}
        >
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {revokeError && <p className="text-sm text-red-600">{revokeError}</p>}
      {convertError && <p className="text-sm text-red-600">{convertError}</p>}
      {exportError && <p className="text-sm text-red-600">{exportError}</p>}

      {invoices && invoices.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-neutral-500">Recent</h2>
          {invoices.map((inv) => {
            const isQuote = inv.docType === 'QUOTE'
            const convertedInto = isQuote ? invoiceByQuoteId.get(inv.id) : undefined
            // Only a real, unpaid INVOICE can take a manual payment — a
            // quote isn't billed (PRD §7.3), and there's nothing left to
            // collect once the balance is already zero.
            const canRecordPayment =
              inv.docType === 'INVOICE' && Number(inv.total) - Number(inv.amountPaid) > 0
            return (
              <div key={inv.id} className="flex flex-col gap-2 rounded border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
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
                      {isQuote && <span className="ml-2 text-xs font-normal text-violet-600">Quote</span>}
                      {inv.status === 'VIEWED' && (
                        <span className="ml-2 text-xs font-normal text-sky-600">Viewed</span>
                      )}
                      {inv.status === 'ACCEPTED' && (
                        <span className="ml-2 text-xs font-normal text-emerald-600">Accepted</span>
                      )}
                      {inv.status === 'DECLINED' && (
                        <span className="ml-2 text-xs font-normal text-red-600">Declined</span>
                      )}
                      {inv.status === 'PAID' && (
                        <span className="ml-2 text-xs font-normal text-emerald-600">Paid</span>
                      )}
                      {inv.status === 'PARTIALLY_PAID' && (
                        <span className="ml-2 text-xs font-normal text-amber-600">Partially paid</span>
                      )}
                      {isOverdue(inv) && <span className="ml-2 text-xs font-normal text-red-600">Overdue</span>}
                      {inv.convertedFromId && (
                        <span className="ml-2 text-xs font-normal text-neutral-400">from quote</span>
                      )}
                    </p>
                    <p className="text-neutral-500">{inv.customer.name}</p>
                  </button>
                  <div className="flex flex-col items-end gap-1">
                    <p className="font-medium">
                      {inv.currency} {inv.total}
                    </p>
                    {isQuote &&
                      (convertedInto ? (
                        <span className="text-xs text-neutral-400">→ {convertedInto.number}</span>
                      ) : (
                        <button
                          className="text-xs text-emerald-700 underline disabled:opacity-50"
                          disabled={convertingId === inv.id}
                          onClick={() => convertQuote(inv.id)}
                        >
                          {convertingId === inv.id
                            ? 'Converting…'
                            : confirmingConvertId === inv.id
                              ? 'Confirm convert?'
                              : 'Convert to invoice'}
                        </button>
                      ))}
                    {inv.hostedUrl && (
                      <button className="text-xs text-amber-700 underline" onClick={() => revokeLink(inv.id)}>
                        {confirmingRevokeId === inv.id ? 'Confirm revoke?' : 'Revoke link'}
                      </button>
                    )}
                    {canRecordPayment && payingId !== inv.id && (
                      <button className="text-xs text-emerald-700 underline" onClick={() => openPaymentForm(inv)}>
                        Record payment
                      </button>
                    )}
                    {!isQuote && (
                      <button
                        className="text-xs text-emerald-700 underline disabled:opacity-50"
                        disabled={sendingRailBId === inv.id}
                        onClick={() => sendRailB(inv.id)}
                      >
                        {sendingRailBId === inv.id ? 'Sending…' : 'Send via WhatsApp Business'}
                      </button>
                    )}
                    {railBResult[inv.id] && (
                      <span
                        className={`text-xs ${railBResult[inv.id] === 'Sent' ? 'text-emerald-600' : 'text-neutral-500'}`}
                      >
                        {railBResult[inv.id]}
                      </span>
                    )}
                    {!isQuote && (
                      <div className="flex items-center gap-1">
                        <select
                          className="rounded border px-1 py-0.5 text-xs"
                          value={recurringFrequency[inv.id] ?? 'monthly'}
                          onChange={(e) =>
                            setRecurringFrequency((prev) => ({ ...prev, [inv.id]: e.target.value as Frequency }))
                          }
                        >
                          <option value="weekly">Weekly</option>
                          <option value="monthly">Monthly</option>
                          <option value="quarterly">Quarterly</option>
                          <option value="yearly">Yearly</option>
                        </select>
                        <button
                          className="text-xs text-emerald-700 underline disabled:opacity-50"
                          disabled={makingRecurringId === inv.id}
                          onClick={() => makeRecurring(inv.id)}
                        >
                          {makingRecurringId === inv.id ? 'Saving…' : 'Make recurring'}
                        </button>
                      </div>
                    )}
                    {recurringActionResult[inv.id] && (
                      <span className="text-xs text-neutral-500">{recurringActionResult[inv.id]}</span>
                    )}
                  </div>
                </div>

                {payingId === inv.id && (
                  <div className="flex flex-col gap-2 border-t pt-2">
                    <div className="flex gap-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className="w-24 rounded border px-2 py-1"
                        value={paymentAmount}
                        onChange={(e) => setPaymentAmount(e.target.value)}
                      />
                      <select
                        className="rounded border px-2 py-1"
                        value={paymentMethod}
                        onChange={(e) => setPaymentMethod(e.target.value as 'cash' | 'bank_transfer')}
                      >
                        <option value="cash">Cash</option>
                        <option value="bank_transfer">Bank transfer</option>
                      </select>
                      <button
                        className="rounded bg-emerald-700 px-3 py-1 text-white disabled:opacity-50"
                        disabled={recordingPayment}
                        onClick={() => submitPayment(inv.id)}
                      >
                        {recordingPayment ? 'Saving…' : 'Save'}
                      </button>
                      <button className="text-neutral-500" onClick={() => setPayingId(null)}>
                        Cancel
                      </button>
                    </div>
                    {paymentError && <p className="text-xs text-red-600">{paymentError}</p>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
