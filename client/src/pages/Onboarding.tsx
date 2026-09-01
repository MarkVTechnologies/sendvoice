import { useNavigate } from 'react-router-dom'

/**
 * PRD 6.1 (J1): phone + WhatsApp OTP, then one screen — business name,
 * logo (skippable), currency/country (auto-detected), tax setting
 * ("I don't charge tax" is first-class). No email, no password.
 */
export default function Onboarding() {
  const navigate = useNavigate()

  return (
    <div className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">Set up Sendvoice</h1>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          navigate('/')
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          Business name
          <input className="rounded border px-3 py-2" name="businessName" required />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Currency & country
          <input className="rounded border px-3 py-2" name="country" placeholder="Auto-detected" />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="noTax" />
          I don&apos;t charge tax
        </label>
        <button className="rounded bg-emerald-700 px-4 py-2 text-white" type="submit">
          Start invoicing
        </button>
      </form>
    </div>
  )
}
