import { NavLink, Route, Routes } from 'react-router-dom'
import Composer from './pages/Composer'
import Dashboard from './pages/Dashboard'
import Onboarding from './pages/Onboarding'

export default function App() {
  return (
    <div className="flex min-h-svh flex-col">
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Composer />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/dashboard" element={<Dashboard />} />
        </Routes>
      </main>
      <nav className="flex justify-around border-t bg-white p-2 text-sm">
        <NavLink to="/">New invoice</NavLink>
        <NavLink to="/dashboard">Dashboard</NavLink>
      </nav>
    </div>
  )
}
