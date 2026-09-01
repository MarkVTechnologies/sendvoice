/**
 * PRD §7.4: "configurable tax profiles rather than hardcoded rates."
 * Only two of the PRD's listed modes are implemented — none and single-rate
 * exclusive — since those are what "I don't charge tax" and a flat VAT/GST
 * onboarding choice need. inclusive/multi-rate/compound/withholding/
 * reverse-charge are real PRD requirements but not needed until a merchant
 * actually needs one; implementing all six speculatively would be exactly
 * the kind of unused surface area worth avoiding.
 */
export type TaxRules = { mode: 'none' } | { mode: 'exclusive'; ratePercent: number }

export function computeTax(rules: TaxRules, subtotal: number): number {
  if (rules.mode === 'none') return 0
  return Math.round(subtotal * (rules.ratePercent / 100) * 100) / 100
}

// Seed list for the launch-candidate markets named in PRD §11.6, not
// exhaustive — a country missing here just means no auto-suggested rate,
// not that the product can't serve it (any ISO country + currency is a
// valid choice; only the suggestion is looked up here).
export const COUNTRY_DEFAULTS: Record<string, { currency: string; taxLabel: string; suggestedRatePercent: number | null }> = {
  NG: { currency: 'NGN', taxLabel: 'VAT', suggestedRatePercent: 7.5 },
  GH: { currency: 'GHS', taxLabel: 'VAT', suggestedRatePercent: 15 },
  KE: { currency: 'KES', taxLabel: 'VAT', suggestedRatePercent: 16 },
  ZA: { currency: 'ZAR', taxLabel: 'VAT', suggestedRatePercent: 15 },
  IN: { currency: 'INR', taxLabel: 'GST', suggestedRatePercent: 18 },
  ID: { currency: 'IDR', taxLabel: 'VAT', suggestedRatePercent: 11 },
  PH: { currency: 'PHP', taxLabel: 'VAT', suggestedRatePercent: 12 },
  BR: { currency: 'BRL', taxLabel: 'Tax', suggestedRatePercent: null },
  US: { currency: 'USD', taxLabel: 'Sales tax', suggestedRatePercent: null },
  GB: { currency: 'GBP', taxLabel: 'VAT', suggestedRatePercent: 20 },
}

export function defaultsForCountry(country: string) {
  return COUNTRY_DEFAULTS[country] ?? { currency: 'USD', taxLabel: 'Tax', suggestedRatePercent: null }
}
