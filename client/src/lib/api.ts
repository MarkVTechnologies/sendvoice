const BASE = '/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`)
  return res.json() as Promise<T>
}

export const api = {
  requestOtp: (phone: string) =>
    request('/auth/otp/request', { method: 'POST', body: JSON.stringify({ phone }) }),
  verifyOtp: (phone: string, code: string) =>
    request<{ token: string }>('/auth/otp/verify', {
      method: 'POST',
      body: JSON.stringify({ phone, code }),
    }),
  approveInvoice: (draftId: string) =>
    request<{ id: string; number: string }>(`/invoices/${draftId}/approve`, { method: 'POST' }),
  listInvoices: () => request('/invoices'),
}
