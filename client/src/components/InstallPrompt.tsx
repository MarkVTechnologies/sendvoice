import { useEffect, useState } from 'react'
import {
  getDeferredPrompt,
  isIOS,
  isStandalone,
  onDeferredPromptChange,
  useInstallState,
} from '../lib/install'

/**
 * PRD §9.1 P0. Two genuinely different mechanisms, not one component
 * pretending they're the same: Android gets the real captured
 * beforeinstallprompt, re-shown here (not at first load) once a merchant
 * has sent a real invoice; iOS gets an explicit "Add to Home Screen"
 * instructional banner, since Safari never offers a programmatic prompt at
 * all — the PRD's own reasoning for treating iOS as the baseline, not an
 * exception.
 */
export default function InstallPrompt() {
  const hasSentFirstInvoice = useInstallState((s) => s.hasSentFirstInvoice)
  const dismissed = useInstallState((s) => s.dismissed)
  const dismiss = useInstallState((s) => s.dismiss)
  const [, forceRerender] = useState(0)

  // The captured event can arrive after this component has already
  // rendered once (it's fired by the browser on its own schedule) — this
  // re-renders once it does, so a merchant who already sent an invoice
  // sees the banner appear rather than needing a reload.
  useEffect(() => onDeferredPromptChange(() => forceRerender((n) => n + 1)), [])

  if (dismissed || !hasSentFirstInvoice || isStandalone()) return null

  const prompt = getDeferredPrompt()
  const showIOS = isIOS() && !prompt
  if (!prompt && !showIOS) return null

  async function installAndroid() {
    if (!prompt) return
    await prompt.prompt()
    await prompt.userChoice
    dismiss()
  }

  return (
    <div className="fixed inset-x-0 bottom-14 z-20 mx-auto max-w-lg px-3">
      <div className="flex items-center gap-3 rounded-lg border bg-white p-3 shadow-lg">
        <div className="flex-1 text-sm">
          <p className="font-medium">Install Sendvoice</p>
          {showIOS ? (
            <p className="text-neutral-500">
              Tap <span aria-hidden="true">⎋</span> Share, then "Add to Home Screen".
            </p>
          ) : (
            <p className="text-neutral-500">Add it to your home screen for one-tap access.</p>
          )}
        </div>
        {!showIOS && (
          <button
            type="button"
            className="shrink-0 rounded bg-emerald-700 px-3 py-2 text-sm text-white"
            onClick={installAndroid}
          >
            Install
          </button>
        )}
        <button
          type="button"
          className="shrink-0 px-1 text-lg leading-none text-neutral-400"
          onClick={dismiss}
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  )
}
