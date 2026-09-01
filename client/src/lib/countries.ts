// Keep in sync with server/src/services/tax.ts's COUNTRY_DEFAULTS — a seed
// list for the launch-candidate markets in PRD §11.6, not exhaustive.
export const COUNTRY_DEFAULTS: Record<
  string,
  { label: string; currency: string; taxLabel: string; suggestedRatePercent: number | null }
> = {
  NG: { label: 'Nigeria', currency: 'NGN', taxLabel: 'VAT', suggestedRatePercent: 7.5 },
  GH: { label: 'Ghana', currency: 'GHS', taxLabel: 'VAT', suggestedRatePercent: 15 },
  KE: { label: 'Kenya', currency: 'KES', taxLabel: 'VAT', suggestedRatePercent: 16 },
  ZA: { label: 'South Africa', currency: 'ZAR', taxLabel: 'VAT', suggestedRatePercent: 15 },
  IN: { label: 'India', currency: 'INR', taxLabel: 'GST', suggestedRatePercent: 18 },
  ID: { label: 'Indonesia', currency: 'IDR', taxLabel: 'VAT', suggestedRatePercent: 11 },
  PH: { label: 'Philippines', currency: 'PHP', taxLabel: 'VAT', suggestedRatePercent: 12 },
  BR: { label: 'Brazil', currency: 'BRL', taxLabel: 'Tax', suggestedRatePercent: null },
  US: { label: 'United States', currency: 'USD', taxLabel: 'Sales tax', suggestedRatePercent: null },
  GB: { label: 'United Kingdom', currency: 'GBP', taxLabel: 'VAT', suggestedRatePercent: 20 },
}

/** Real, if rough, auto-detect from the browser locale — PRD §6.1 "auto-detected, one tap to confirm." */
export function detectCountry(): string {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region
    if (region && region in COUNTRY_DEFAULTS) return region
  } catch {
    // Intl.Locale unsupported or unparseable — fall through to default.
  }
  return 'NG'
}
