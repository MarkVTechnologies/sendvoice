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

/**
 * PRD §8.7 P1: "Bank transfer instructions rendered on the PDF with a
 * copy-to-clipboard account number." The PDF itself is a static render (no
 * clipboard on paper/a saved file), so the copy affordance lives only on
 * the hosted page (hostedInvoicePage.ts) — this just prints the numbers
 * clearly. Only ever shown on an INVOICE (a quote isn't asking to be paid
 * yet, a credit note is the opposite direction) and only when the tenant
 * has actually set an account number — most merchants on Free/Rail-A-only
 * take cash and never fill this in.
 */
export function renderBankDetailsBlock(doc: InvoiceData, headingTag: 'h2' = 'h2'): string {
  if (doc.docType !== 'INVOICE' || !doc.tenant.bankAccountNumber) return ''
  return `
    <div class="bank-details">
      <${headingTag}>Bank transfer</${headingTag}>
      ${doc.tenant.bankName ? `<div>${escapeHtml(doc.tenant.bankName)}</div>` : ''}
      ${doc.tenant.bankAccountName ? `<div>${escapeHtml(doc.tenant.bankAccountName)}</div>` : ''}
      <div><strong>${escapeHtml(doc.tenant.bankAccountNumber)}</strong></div>
    </div>`
}
