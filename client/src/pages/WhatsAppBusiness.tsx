import { useEffect, useState } from 'react'
import { api, ApiError, type WabaStatus } from '../lib/api'

/**
 * PRD §10.1/§10.2: Rail B's WABA connection (Embedded Signup via Telnyx's
 * Hosted Signup) and per-merchant template management surface — "at 500
 * merchants this is thousands of templates in various review states; it
 * cannot be handled by support tickets."
 */
export default function WhatsAppBusiness() {
  const [status, setStatus] = useState<WabaStatus | null>(null)
  const [notConfigured, setNotConfigured] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  function load() {
    api
      .getWabaStatus()
      .then(setStatus)
      .catch(() => setError("Couldn't load WhatsApp Business status."))
  }

  useEffect(load, [])

  async function connect() {
    setError(null)
    setConnecting(true)
    try {
      const { url } = await api.connectWaba()
      window.open(url, '_blank')
      setStatus((s) => (s ? { ...s, status: 'pending' } : s))
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        setNotConfigured(true)
      } else {
        setError("Couldn't start WhatsApp Business signup. Try again.")
      }
    } finally {
      setConnecting(false)
    }
  }

  async function refreshStatus() {
    setError(null)
    setRefreshing(true)
    try {
      setStatus(await api.getWabaStatus())
    } catch {
      setError("Couldn't refresh status. Try again.")
    } finally {
      setRefreshing(false)
    }
  }

  async function submitTemplates() {
    setError(null)
    setSubmitting(true)
    try {
      const { templates } = await api.submitWabaTemplates()
      setStatus((s) => (s ? { ...s, templates } : s))
    } catch {
      setError("Couldn't submit templates. Try again.")
    } finally {
      setSubmitting(false)
    }
  }

  async function refreshTemplates() {
    setError(null)
    setRefreshing(true)
    try {
      const { templates } = await api.refreshWabaTemplates()
      setStatus((s) => (s ? { ...s, templates } : s))
    } catch {
      setError("Couldn't refresh template status. Try again.")
    } finally {
      setRefreshing(false)
    }
  }

  const statusBadge: Record<string, string> = {
    PENDING: 'text-amber-600',
    APPROVED: 'text-emerald-600',
    REJECTED: 'text-red-600',
    PAUSED: 'text-amber-600',
    DISABLED: 'text-neutral-400',
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold">WhatsApp Business</h1>
      <p className="text-sm text-neutral-500">
        Connect your own WhatsApp Business number so invoices send automatically, from your own number — no manual
        tap required (Rail B). Your free WhatsApp send from the composer keeps working either way.
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {notConfigured && (
        <div className="rounded border p-3 text-sm text-neutral-500">
          WhatsApp Business connection isn't set up on this server yet.
        </div>
      )}

      {!notConfigured && !status && <p className="text-sm text-neutral-500">Loading…</p>}

      {!notConfigured && status && status.status === 'not_connected' && (
        <button
          className="rounded bg-emerald-700 px-4 py-2 text-white disabled:opacity-50"
          disabled={connecting}
          onClick={connect}
        >
          {connecting ? 'Starting…' : 'Connect WhatsApp Business'}
        </button>
      )}

      {!notConfigured && status && status.status === 'pending' && (
        <div className="flex flex-col gap-2 rounded border p-3 text-sm">
          <p>Signup in progress — finish it in the tab that opened, then refresh here.</p>
          <button
            className="self-start rounded bg-neutral-800 px-3 py-2 text-white disabled:opacity-50"
            disabled={refreshing}
            onClick={refreshStatus}
          >
            {refreshing ? 'Checking…' : 'Refresh status'}
          </button>
        </div>
      )}

      {!notConfigured && status && status.status === 'connected' && (
        <div className="flex flex-col gap-3">
          <div className="rounded border p-3 text-sm">
            <p className="font-medium text-emerald-700">Connected</p>
            <p className="text-neutral-500">WABA: {status.wabaId}</p>
            <p className="text-neutral-500">Number: {status.phoneNumberId}</p>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-neutral-500">Templates</h2>
              <div className="flex gap-2">
                {status.templates.length > 0 && (
                  <button className="text-xs text-emerald-700 underline disabled:opacity-50" disabled={refreshing} onClick={refreshTemplates}>
                    {refreshing ? 'Checking…' : 'Refresh status'}
                  </button>
                )}
                <button
                  className="text-xs text-emerald-700 underline disabled:opacity-50"
                  disabled={submitting}
                  onClick={submitTemplates}
                >
                  {submitting ? 'Submitting…' : 'Submit templates'}
                </button>
              </div>
            </div>

            {status.templates.length === 0 && (
              <p className="text-sm text-neutral-500">
                No templates submitted yet. Submitting starts Meta's review — this usually takes hours to days.
              </p>
            )}

            {status.templates.map((t) => (
              <div key={t.id} className="rounded border p-3 text-sm">
                <p className="font-medium">
                  {t.name} <span className={statusBadge[t.status] ?? 'text-neutral-500'}>{t.status}</span>
                </p>
                {t.rejectionReason && <p className="mt-1 text-xs text-red-600">{t.rejectionReason}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
