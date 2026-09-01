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
  customer: { name: string; whatsapp: string | null }
}

export const api = {
  requestOtp: (phone: string) =>
    request<{ ok: true; devCode?: string }>('/auth/otp/request', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    }),
  verifyOtp: (phone: string, code: string, businessName?: string) =>
    request<{ token: string }>('/auth/otp/verify', {
      method: 'POST',
      body: JSON.stringify({ phone, code, businessName }),
    }),
  approveInvoice: (draftId: string, payload: ApproveInvoicePayload) =>
    request<Invoice>(`/invoices/${draftId}/approve`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  listInvoices: () => request<Invoice[]>('/invoices'),
}
