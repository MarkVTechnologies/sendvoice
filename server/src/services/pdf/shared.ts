import type { Customer, Document, DocumentLine, Tenant } from '@prisma/client'

export type InvoiceData = Document & {
  lines: DocumentLine[]
  customer: Customer
  tenant: Tenant
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

export function money(amount: unknown, currency: string): string {
  return `${currency} ${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatDate(d: Date | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
