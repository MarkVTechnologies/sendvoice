import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'

/**
 * PRD 6.1 (J1): phone + WhatsApp OTP, then one screen — business name,
 * logo (skippable), currency/country (auto-detected), tax setting
 * ("I don't charge tax" is first-class). No email, no password.
 *
 * Logo/currency/country/tax collection is a separate remaining-work item
 * (see plan) — this screen covers the P0 identity path: phone → OTP →
 * business name, which is enough to reach the composer.
 */
export default function Onboarding() {
  const navigate = useNavigate()
  const setSession = useAuth((s) => s.setSession)

  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [devCode, setDevCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function sendCode(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await api.requestOtp(phone)
      setDevCode(res.devCode ?? null)
      setStep('code')
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === undefined
          ? "Couldn't reach the server. Check your connection and try again."
          : "Couldn't send a code. Check the number and try again.",
      )
    } finally {
      setBusy(false)
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const { token } = await api.verifyOtp(phone, code, businessName || undefined)
      setSession(token, phone)
      navigate('/')
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === undefined
          ? "Couldn't reach the server. Check your connection and try again."
          : 'Wrong or expired code. Try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">Set up Sendvoice</h1>

      {step === 'phone' && (
        <form className="flex flex-col gap-4" onSubmit={sendCode}>
          <label className="flex flex-col gap-1 text-sm">
            WhatsApp number
            <input
              className="rounded border px-3 py-2"
              type="tel"
              placeholder="+234 801 234 5678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            className="rounded bg-emerald-700 px-4 py-2 text-white disabled:opacity-50"
            type="submit"
            disabled={busy || !phone}
          >
            Send code
          </button>
        </form>
      )}

      {step === 'code' && (
        <form className="flex flex-col gap-4" onSubmit={verifyCode}>
          <p className="text-sm text-neutral-600">Enter the code sent to {phone}.</p>
          {devCode && (
            <p className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Dev mode (no WhatsApp sender configured yet): code is <strong>{devCode}</strong>
            </p>
          )}
          <label className="flex flex-col gap-1 text-sm">
            6-digit code
            <input
              className="rounded border px-3 py-2 tracking-widest"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Business name
            <input
              className="rounded border px-3 py-2"
              placeholder="e.g. Chidera Fabrics"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            className="rounded bg-emerald-700 px-4 py-2 text-white disabled:opacity-50"
            type="submit"
            disabled={busy || code.length !== 6}
          >
            Start invoicing
          </button>
        </form>
      )}
    </div>
  )
}
