import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, ApiError, type TaxChoice } from '../lib/api'
import { useAuth } from '../lib/auth'
import { COUNTRY_DEFAULTS, detectCountry } from '../lib/countries'

// 1MB raw, well under the server's ~2.6MB decoded cap — this file also
// gets inlined into the hosted invoice page, which has its own ≤60KB
// budget (PRD §9.1), so smaller than the server allows is deliberate.
const MAX_LOGO_BYTES = 1_000_000
const ACCEPTED_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp']

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/**
 * PRD 6.1 (J1): phone + WhatsApp OTP, then one screen — business name,
 * logo (skippable), currency/country (auto-detected), tax setting
 * ("I don't charge tax" is first-class). No email, no password.
 */
export default function Onboarding() {
  const navigate = useNavigate()
  const setSession = useAuth((s) => s.setSession)
  // PRD §4.3 viral coefficient: whatever a hosted invoice's footer CTA
  // attached as ?ref= (server ignores this on login, only uses it for a
  // brand-new signup — see services/auth.ts).
  const [searchParams] = useSearchParams()
  const referralSource = searchParams.get('ref') ?? undefined

  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [country, setCountry] = useState(detectCountry())
  const [currency, setCurrency] = useState(COUNTRY_DEFAULTS[detectCountry()].currency)
  const [noTax, setNoTax] = useState(true)
  const [taxRate, setTaxRate] = useState<number | ''>(
    COUNTRY_DEFAULTS[detectCountry()].suggestedRatePercent ?? '',
  )
  const [pdfTemplate, setPdfTemplate] = useState<'classic' | 'modern'>('classic')
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [logoError, setLogoError] = useState<string | null>(null)
  const [devCode, setDevCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function selectLogo(file: File | null) {
    setLogoError(null)
    if (!file) {
      setLogoFile(null)
      setLogoPreview(null)
      return
    }
    if (!ACCEPTED_LOGO_TYPES.includes(file.type)) {
      setLogoError('Use a PNG, JPEG, or WebP image.')
      return
    }
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError('That image is too large — under 1MB, please.')
      return
    }
    setLogoFile(file)
    setLogoPreview(URL.createObjectURL(file))
  }

  function selectCountry(code: string) {
    setCountry(code)
    const defaults = COUNTRY_DEFAULTS[code]
    setCurrency(defaults.currency)
    setTaxRate(defaults.suggestedRatePercent ?? '')
  }

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
    const tax: TaxChoice = noTax
      ? { mode: 'none' }
      : { mode: 'exclusive', ratePercent: taxRate === '' ? 0 : taxRate }
    try {
      const logo = logoFile
        ? { dataBase64: await readFileAsBase64(logoFile), mimeType: logoFile.type }
        : undefined
      const { token } = await api.verifyOtp(phone, code, {
        businessName: businessName || undefined,
        country,
        currency,
        tax,
        logo,
        pdfTemplate,
        referralSource,
      })
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

  const taxLabel = COUNTRY_DEFAULTS[country].taxLabel

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

          <div className="flex items-center gap-3">
            {logoPreview && (
              <img src={logoPreview} alt="Logo preview" className="h-12 w-12 rounded border object-contain" />
            )}
            <label className="flex-1 text-sm">
              Logo <span className="text-neutral-500">(optional)</span>
              <input
                className="mt-1 block w-full text-sm"
                type="file"
                accept={ACCEPTED_LOGO_TYPES.join(',')}
                onChange={(e) => selectLogo(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>
          {logoError && <p className="text-sm text-red-600">{logoError}</p>}

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Country
              <select
                className="rounded border px-3 py-2"
                value={country}
                onChange={(e) => selectCountry(e.target.value)}
              >
                {Object.entries(COUNTRY_DEFAULTS).map(([code, d]) => (
                  <option key={code} value={code}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Currency
              <input
                className="rounded border px-3 py-2 uppercase"
                value={currency}
                maxLength={3}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              />
            </label>
          </div>

          <div className="flex flex-col gap-2 rounded border p-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={noTax} onChange={(e) => setNoTax(e.target.checked)} />
              I don&apos;t charge tax
            </label>
            {!noTax && (
              <label className="flex items-center gap-2 text-sm">
                {taxLabel} rate
                <input
                  className="w-20 rounded border px-2 py-1"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  step={0.1}
                  value={taxRate}
                  onChange={(e) => setTaxRate(e.target.value === '' ? '' : Number(e.target.value))}
                />
                %
              </label>
            )}
          </div>

          <div className="flex flex-col gap-2 text-sm">
            PDF style
            <div className="grid grid-cols-2 gap-2">
              {(['classic', 'modern'] as const).map((style) => (
                <button
                  key={style}
                  type="button"
                  className={`rounded border px-3 py-2 text-left capitalize ${
                    pdfTemplate === style ? 'border-emerald-600 bg-emerald-50 text-emerald-900' : ''
                  }`}
                  onClick={() => setPdfTemplate(style)}
                >
                  {style}
                </button>
              ))}
            </div>
          </div>

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
