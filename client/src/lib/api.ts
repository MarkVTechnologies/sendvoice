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
  // PRD §8.6 P1: "all pausable per invoice."
  remindersPaused: boolean
}

export type TeamUser = { id: string; phone: string; name: string | null; role: string; joined: boolean }

export type Frequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly'

export type RecurringScheduleView = {
  id: string
  frequency: Frequency
  active: boolean
  nextRunAt: string
  lastRunAt: string | null
  lastDocumentId: string | null
  currency: string
  customerName: string
}

export type WabaTemplateStatus = { id: string; name: string; status: string; rejectionReason: string | null }

export type WabaStatus = {
  status: string
  wabaId: string | null
  phoneNumberId: string | null
  connectedAt: string | null
  templates: WabaTemplateStatus[]
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
  // PRD §8.4 P1 / §11.4: create a recurring schedule from an existing
  // invoice — same result-object shape as sendInvoiceViaRailB, since the
  // failure cases (not an invoice, no customer) are specific and expected.
  makeRecurring: async (
    invoiceId: string,
    frequency: Frequency,
  ): Promise<{ ok: true; id: string } | { ok: false; reason: string }> => {
    const token = useAuth.getState().token
    let res: Response
    try {
      res = await fetch(`${BASE}/invoices/${invoiceId}/make-recurring`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ frequency }),
      })
    } catch {
      throw new ApiError('Could not reach the server')
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string; id?: string }
    if (!res.ok) return { ok: false, reason: body.error ?? 'unknown_error' }
    return { ok: true, id: body.id! }
  },
  listRecurringSchedules: () => request<RecurringScheduleView[]>('/recurring'),
  // PRD §8.6 P1: reminders are pausable per invoice.
  pauseReminders: (invoiceId: string) =>
    request<{ ok: true }>(`/invoices/${invoiceId}/reminders/pause`, { method: 'POST', body: '{}' }),
  resumeReminders: (invoiceId: string) =>
    request<{ ok: true }>(`/invoices/${invoiceId}/reminders/resume`, { method: 'POST', body: '{}' }),
  pauseRecurringSchedule: (id: string) => request<{ ok: true }>(`/recurring/${id}/pause`, { method: 'POST', body: '{}' }),
  resumeRecurringSchedule: (id: string) => request<{ ok: true }>(`/recurring/${id}/resume`, { method: 'POST', body: '{}' }),
  deleteRecurringSchedule: (id: string) => request<{ ok: true }>(`/recurring/${id}`, { method: 'DELETE', body: '{}' }),
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
  // PRD §8.8 P1: "Export CSV... date-range filtered." Same auth problem as
  // the PDF route below (a plain <a href> can't carry the Bearer token),
  // but this one also needs to trigger an actual file save rather than open
  // a tab — a temporary <a download> click on the blob URL, then revoked,
  // is the standard way to do that from a fetch() response.
  exportInvoicesCsv: async (params?: { from?: string; to?: string }): Promise<void> => {
    const token = useAuth.getState().token
    const qs = new URLSearchParams()
    if (params?.from) qs.set('from', params.from)
    if (params?.to) qs.set('to', params.to)
    const query = qs.toString() ? `?${qs.toString()}` : ''
    let res: Response
    try {
      res = await fetch(`${BASE}/invoices/export${query}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
    } catch {
      throw new ApiError('Could not reach the server')
    }
    if (!res.ok) throw new ApiError(`CSV export failed: ${res.status}`, res.status)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `sendvoice-export-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  },
  // PRD §8.1 P1: multi-user with roles. Both invite and remove return a
  // result object (same reasoning as sendInvoiceViaRailB) since the normal
  // failure cases — phone already in use, can't remove the Owner — are
  // specific, expected outcomes the UI should name, not a generic error.
  listUsers: () => request<TeamUser[]>('/users'),
  inviteUser: async (
    phone: string,
    role: 'EDITOR' | 'VIEWER' | 'ACCOUNTANT',
  ): Promise<{ ok: true; users: TeamUser[] } | { ok: false; reason: string }> => {
    const token = useAuth.getState().token
    let res: Response
    try {
      res = await fetch(`${BASE}/users/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ phone, role }),
      })
    } catch {
      throw new ApiError('Could not reach the server')
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string; users?: TeamUser[] }
    if (!res.ok) return { ok: false, reason: body.error ?? 'unknown_error' }
    return { ok: true, users: body.users ?? [] }
  },
  removeUser: async (userId: string): Promise<{ ok: true } | { ok: false; reason: string }> => {
    const token = useAuth.getState().token
    let res: Response
    try {
      res = await fetch(`${BASE}/users/${userId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: '{}',
      })
    } catch {
      throw new ApiError('Could not reach the server')
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    if (!res.ok) return { ok: false, reason: body.error ?? 'unknown_error' }
    return { ok: true }
  },
  // PRD §10.1: Embedded Signup via Telnyx's Hosted Signup. A 503 here means
  // TELNYX_APP_ID/TELNYX_API_KEY aren't configured server-side yet — the
  // caller shows the same honest "not available yet" state Pay Now used
  // before Paystack was wired.
  connectWaba: () => request<{ url: string }>('/waba/connect', { method: 'POST', body: '{}' }),
  getWabaStatus: () => request<WabaStatus>('/waba/status'),
  submitWabaTemplates: () => request<{ templates: WabaTemplateStatus[] }>('/waba/templates/submit', {
    method: 'POST',
    body: '{}',
  }),
  refreshWabaTemplates: () => request<{ templates: WabaTemplateStatus[] }>('/waba/templates/refresh', {
    method: 'POST',
    body: '{}',
  }),
  // PRD §8.6/§10: unlike every other call here, a Rail B send has several
  // genuinely normal failure reasons (not connected yet, template still
  // pending, customer opted out) that aren't really "errors" — returning a
  // result object instead of throwing lets the caller show the specific
  // reason rather than a generic failure message.
  sendInvoiceViaRailB: async (invoiceId: string): Promise<{ ok: true } | { ok: false; reason: string }> => {
    const token = useAuth.getState().token
    let res: Response
    try {
      res = await fetch(`${BASE}/invoices/${invoiceId}/send-railb`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: '{}',
      })
    } catch {
      throw new ApiError('Could not reach the server')
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    if (!res.ok) return { ok: false, reason: body.error ?? 'unknown_error' }
    return { ok: true }
  },
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
