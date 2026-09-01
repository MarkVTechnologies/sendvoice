/**
 * PRD 8.8 (P0): outstanding, overdue, paid this month, count sent.
 */
export default function Dashboard() {
  const stats = [
    { label: 'Outstanding', value: '—' },
    { label: 'Overdue', value: '—' },
    { label: 'Paid this month', value: '—' },
    { label: 'Sent', value: '—' },
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
    </div>
  )
}
