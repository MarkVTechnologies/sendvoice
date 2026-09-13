import { useEffect } from 'react'
import { Navigate, NavLink, Route, Routes } from 'react-router-dom'
import Composer from './pages/Composer'
import Dashboard from './pages/Dashboard'
import Items from './pages/Items'
import Onboarding from './pages/Onboarding'
import WhatsAppBusiness from './pages/WhatsAppBusiness'
import Team from './pages/Team'
import Recurring from './pages/Recurring'
import Privacy from './pages/Privacy'
import InstallPrompt from './components/InstallPrompt'
import { api, type ApproveInvoicePayload } from './lib/api'
import { useAuth } from './lib/auth'
import { flushOutbox, watchConnectivity } from './lib/outbox'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useAuth((s) => s.token)
  return token ? <>{children}</> : <Navigate to="/onboarding" replace />
}

// PRD §8.1 P1: a Viewer/Accountant can't approve or send anything, so
// landing them on the composer is a dead end, not a permission the server
// even needs to reject — redirect to the one place they actually have
// something to do. `role === null` (a pre-existing session's JWT predates
// this feature) defaults to full access, matching the server's own
// requireRole fallback (server/src/lib/authz.ts).
function RequireWriteAccess({ children }: { children: React.ReactNode }) {
  const role = useAuth((s) => s.role)
  if (role === 'VIEWER' || role === 'ACCOUNTANT') return <Navigate to="/dashboard" replace />
  return <>{children}</>
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
                <RequireWriteAccess>
                  <Composer />
                </RequireWriteAccess>
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
          <Route
            path="/items"
            element={
              <RequireAuth>
                <Items />
              </RequireAuth>
            }
          />
          <Route
            path="/whatsapp"
            element={
              <RequireAuth>
                <WhatsAppBusiness />
              </RequireAuth>
            }
          />
          <Route
            path="/team"
            element={
              <RequireAuth>
                <Team />
              </RequireAuth>
            }
          />
          <Route
            path="/recurring"
            element={
              <RequireAuth>
                <Recurring />
              </RequireAuth>
            }
          />
          <Route
            path="/privacy"
            element={
              <RequireAuth>
                <Privacy />
              </RequireAuth>
            }
          />
        </Routes>
      </main>
      {token && <InstallPrompt />}
      {token && (
        <nav className="flex justify-around border-t bg-white p-2 text-sm">
          <NavLink to="/">New invoice</NavLink>
          <NavLink to="/dashboard">Dashboard</NavLink>
          <NavLink to="/items">Items</NavLink>
          <NavLink to="/whatsapp">WhatsApp</NavLink>
          <NavLink to="/team">Team</NavLink>
        </nav>
      )}
    </div>
  )
}
