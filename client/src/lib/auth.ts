import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type AuthState = {
  token: string | null
  phone: string | null
  role: string | null
  setSession: (token: string, phone: string) => void
  clear: () => void
}

// PRD §8.1 P1: role lives in the JWT (routes/auth.ts signs it directly
// from services/auth.ts's Identity), decoded here purely for client-side
// UI decisions — hiding a screen a Viewer/Accountant can't act on anyway.
// Not a trust boundary: the server enforces every real permission
// independently (server/src/lib/authz.ts's requireRole) regardless of
// anything decoded here.
function decodeRole(token: string): string | null {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
    const payload = JSON.parse(atob(padded)) as { role?: unknown }
    return typeof payload.role === 'string' ? payload.role : null
  } catch {
    return null
  }
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      phone: null,
      role: null,
      setSession: (token, phone) => set({ token, phone, role: decodeRole(token) }),
      clear: () => set({ token: null, phone: null, role: null }),
    }),
    { name: 'sendvoice-auth' },
  ),
)
