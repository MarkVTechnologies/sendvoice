import { useAuth } from './auth'

const BASE = '/api'

export class ApiError extends Error {
  // status is undefined for network-level failures (server unreachable) —
  // that's a distinct case from the server actively rejecting the request,
  // and callers (e.g. OTP verify) need to tell them apart rather than
  // showing "wrong code" for what was actually a dropped connection.
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = useAuth.getState().token
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    })
  } catch {
    throw new ApiError(`Could not reach the server`)
  }
  if (!res.ok) throw new ApiError(`API ${path} failed: ${res.status}`, res.status)
  return res.json() as Promise<T>
}

export type TaxChoice = { mode: 'none' } | { mode: 'exclusive'; ratePercent: number }

export type OnboardingDetails = {
  businessName?: string
  country?: string
  currency?: string
  tax?: TaxChoice
  logo?: { dataBase64: string; mimeType: string }
  pdfTemplate?: 'classic' | 'modern'
  referralSource?: string
  address?: string
  taxId?: string
  bankName?: string
  bankAccountName?: string
  bankAccountNumber?: string
}

export type DocType = 'INVOICE' | 'QUOTE'

export type ApproveInvoicePayload = {
  customer: { name: string; whatsapp: string }
  lines: Array<{ description: string; qty?: number; unit?: string; rate: number }>
  dueDate?: string // full ISO 8601 datetime — the server's zod schema requires it, not just a date
  notes?: string
  // PRD §7.3: the same approval endpoint issues either doc type — omitted
  // means INVOICE, matching the server's own default.
  docType?: DocType
}

export type ItemSuggestion = {
  id: string
  description: string
  unit: string | null
  rate: string
  useCount: number
}

export type Invoice = {
  id: string
  number: string
  total: string
  amountPaid: string
  status: string
  currency: string
  createdAt: string
  dueDate: string | null
  pdfUrl: string | null
  hostedUrl: string | null
  customer: { name: string; whatsapp: string | null }
  docType: DocType
  // Set on an invoice that was converted from a quote — points back at the
  // quote's Document id (PRD §7.3 "preserves the link for audit").
  convertedFromId: string | null
}

export const api = {
  requestOtp: (phone: string) =>
    request<{ ok: true; devCode?: string }>('/auth/otp/request', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    }),
  verifyOtp: (phone: string, code: string, onboarding?: OnboardingDetails) =>
    request<{ token: string }>('/auth/otp/verify', {
      method: 'POST',
      body: JSON.stringify({ phone, code, ...onboarding }),
    }),
  approveInvoice: (draftId: string, payload: ApproveInvoicePayload) =>
    request<Invoice>(`/invoices/${draftId}/approve`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  listInvoices: () => request<Invoice[]>('/invoices'),
  // PRD §7.3: "Quote→Invoice conversion is one tap." Creates a brand-new
  // invoice linked back to the quote — the quote itself is never edited.
  convertQuote: (quoteId: string) =>
    request<Invoice>(`/invoices/${quoteId}/convert`, { method: 'POST', body: '{}' }),
  // PRD §8.7 P0: manual cash/bank-transfer recording, with partial support
  // — the server accumulates this the same way it would multiple PSP
  // payments, moving status to PARTIALLY_PAID or PAID as the total is met.
  recordPayment: (invoiceId: string, payload: { amount: number; method: 'cash' | 'bank_transfer' }) =>
    request<Invoice>(`/invoices/${invoiceId}/payments`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  // PRD §12 P0: hosted links must be revocable. Mints a fresh token and
  // discards the old one — the response's hostedUrl is the new live link.
  revokeHostedLink: (invoiceId: string) =>
    request<{ hostedUrl: string | null }>(`/invoices/${invoiceId}/revoke-link`, {
      method: 'POST',
      body: '{}',
    }),
  // PRD §8.3 P1: item catalogue auto-save with fuzzy recall. Empty/blank
  // queries aren't worth a round trip — callers should skip calling this
  // rather than lean on the server's own short-circuit for them.
  searchItems: (q: string) =>
    request<{ items: ItemSuggestion[] }>(`/items?q=${encodeURIComponent(q)}`),
  listItems: () => request<{ items: ItemSuggestion[] }>('/items'),
  // Same empty-body gotcha as revokeHostedLink above: Fastify rejects an
  // empty body under Content-Type: application/json, so every bodyless
  // call through this shared request() helper needs an explicit '{}'.
  deleteItem: (id: string) => request<{ ok: true }>(`/items/${id}`, { method: 'DELETE', body: '{}' }),
  // The PDF route requires the same Bearer auth as everything else, so a
  // plain <a href> won't carry it — fetch it as a blob and hand back an
  // object URL the caller can open/revoke.
  fetchInvoicePdfUrl: async (invoiceId: string): Promise<string> => {
    const token = useAuth.getState().token
    let res: Response
    try {
      res = await fetch(`${BASE}/invoices/${invoiceId}/pdf`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
    } catch {
      throw new ApiError('Could not reach the server')
    }
    if (!res.ok) throw new ApiError(`PDF fetch failed: ${res.status}`, res.status)
    const blob = await res.blob()
    return URL.createObjectURL(blob)
  },
}
