import { useEffect } from 'react'
import { Navigate, NavLink, Route, Routes } from 'react-router-dom'
import Composer from './pages/Composer'
import Dashboard from './pages/Dashboard'
import Onboarding from './pages/Onboarding'
import { api, type ApproveInvoicePayload } from './lib/api'
import { useAuth } from './lib/auth'
import { flushOutbox, watchConnectivity } from './lib/outbox'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useAuth((s) => s.token)
  return token ? <>{children}</> : <Navigate to="/onboarding" replace />
}

export default function App() {
  const token = useAuth((s) => s.token)

  useEffect(() => {
    if (!token) return
    const flush = () =>
      flushOutbox(async (entry) => {
        if (entry.kind === 'approve-invoice') {
          await api.approveInvoice(entry.id, entry.payload as ApproveInvoicePayload)
        }
      })
    flush()
    watchConnectivity(flush)
  }, [token])

  return (
    <div className="flex min-h-svh flex-col">
      <main className="flex-1">
        <Routes>
          <Route
            path="/"
            element={
              <RequireAuth>
                <Composer />
              </RequireAuth>
            }
          />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route
            path="/dashboard"
            element={
              <RequireAuth>
                <Dashboard />
              </RequireAuth>
            }
          />
        </Routes>
      </main>
      {token && (
        <nav className="flex justify-around border-t bg-white p-2 text-sm">
          <NavLink to="/">New invoice</NavLink>
          <NavLink to="/dashboard">Dashboard</NavLink>
        </nav>
      )}
    </div>
  )
}
