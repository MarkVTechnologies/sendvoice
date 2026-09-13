import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// PRD §9.1 P0: "Android: use beforeinstallprompt, deferred and surfaced
// after the first successful invoice send (install prompts before value
// delivery convert terribly)." The event fires once, early — often before
// any component has mounted to listen for it — so it's captured at module
// scope (imported for its side effect from main.tsx) rather than inside a
// component's useEffect, and its default mini-infobar is suppressed so we
// control exactly when it's shown.
//
// iOS Safari never fires this event at all (PRD §9.1: "iOS gives us no
// beforeinstallprompt event") — that path is a fully manual instructional
// banner, driven by UA sniffing + the standalone-display-mode check below.

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

type InstallState = {
  hasSentFirstInvoice: boolean
  dismissed: boolean
  markFirstInvoiceSent: () => void
  dismiss: () => void
}

export const useInstallState = create<InstallState>()(
  persist(
    (set) => ({
      hasSentFirstInvoice: false,
      dismissed: false,
      markFirstInvoiceSent: () => set({ hasSentFirstInvoice: true }),
      dismiss: () => set({ dismissed: true }),
    }),
    { name: 'sendvoice-install' },
  ),
)

let deferredPrompt: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt = e as BeforeInstallPromptEvent
    listeners.forEach((l) => l())
  })
  // Fires on a successful install (our own prompt, or the browser's native
  // menu item) — the deferred event is spent either way, and the app is
  // standalone-installed from here on, so there's nothing left to offer.
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    listeners.forEach((l) => l())
  })
}

export function getDeferredPrompt(): BeforeInstallPromptEvent | null {
  return deferredPrompt
}

export function onDeferredPromptChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari's own non-standard flag — display-mode media query support
    // there is inconsistent, so this is checked explicitly too.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

export function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}
