import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type AuthState = {
  token: string | null
  phone: string | null
  setSession: (token: string, phone: string) => void
  clear: () => void
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      phone: null,
      setSession: (token, phone) => set({ token, phone }),
      clear: () => set({ token: null, phone: null }),
    }),
    { name: 'sendvoice-auth' },
  ),
)
