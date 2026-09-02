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
}

export type ApproveInvoicePayload = {
  customer: { name: string; whatsapp: string }
  lines: Array<{ description: string; qty?: number; unit?: string; rate: number }>
  notes?: string
}

export type Invoice = {
  id: string
  number: string
  total: string
  amountPaid: string
  status: string
  currency: string
  createdAt: string
  pdfUrl: string | null
  hostedUrl: string | null
  customer: { name: string; whatsapp: string | null }
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
