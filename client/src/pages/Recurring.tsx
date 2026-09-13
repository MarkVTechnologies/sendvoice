import { useEffect, useState } from 'react'
import { api, type RecurringScheduleView } from '../lib/api'

/**
 * PRD §8.4 P1: recurring invoice schedules — created from an existing
 * invoice's "Make recurring" action (Dashboard.tsx), managed here.
 */
export default function Recurring() {
  const [schedules, setSchedules] = useState<RecurringScheduleView[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  function load() {
    api
      .listRecurringSchedules()
      .then(setSchedules)
      .catch(() => setError("Couldn't load recurring schedules."))
  }

  useEffect(load, [])

  async function toggle(s: RecurringScheduleView) {
    setError(null)
    try {
      if (s.active) await api.pauseRecurringSchedule(s.id)
      else await api.resumeRecurringSchedule(s.id)
      setSchedules((prev) => prev?.map((x) => (x.id === s.id ? { ...x, active: !x.active } : x)) ?? prev)
    } catch {
      setError("Couldn't update that schedule.")
    }
  }

  async function remove(id: string) {
    setError(null)
    try {
      await api.deleteRecurringSchedule(id)
      setSchedules((prev) => prev?.filter((s) => s.id !== id) ?? prev)
    } catch {
      setError("Couldn't remove that schedule.")
    }
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold">Recurring invoices</h1>
      <p className="text-sm text-neutral-500">
        A new invoice is generated automatically for each schedule below — open Dashboard to send it once it
        appears.
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!schedules && <p className="text-sm text-neutral-500">Loading…</p>}
      {schedules && schedules.length === 0 && (
        <p className="text-sm text-neutral-500">
          No recurring schedules yet — open an invoice on Dashboard and tap "Make recurring".
        </p>
      )}

      {schedules && schedules.length > 0 && (
        <div className="flex flex-col gap-2">
          {schedules.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-2 rounded border p-3 text-sm">
              <div>
                <p className="font-medium">
                  {s.customerName} <span className="ml-1 text-xs font-normal text-neutral-500">{s.frequency}</span>
                </p>
                <p className="text-xs text-neutral-500">
                  Next: {new Date(s.nextRunAt).toLocaleDateString()}
                  {!s.active && <span className="ml-2 text-amber-600">Paused</span>}
                </p>
              </div>
              <div className="flex gap-2">
                <button className="text-xs text-emerald-700 underline" onClick={() => toggle(s)}>
                  {s.active ? 'Pause' : 'Resume'}
                </button>
                <button className="text-xs text-red-600 underline" onClick={() => remove(s.id)}>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
