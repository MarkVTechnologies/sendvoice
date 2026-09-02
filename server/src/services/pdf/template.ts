import type { Customer, Document, DocumentLine, Tenant } from '@prisma/client'
import { tenantLogoDataUri } from '../logo.js'

type InvoiceData = Document & {
  lines: DocumentLine[]
  customer: Customer
  tenant: Tenant
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function money(amount: unknown, currency: string): string {
  return `${currency} ${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatDate(d: Date | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * PRD §8.5 P0: "genuinely distinct, professionally typeset" — this is the
 * first of an eventual 3–4 templates (remaining work). Server-rendered,
 * self-contained HTML (system fonts, no external requests) so the same
 * invoice renders identically regardless of what's running the headless
 * browser — PRD §9.2's determinism requirement.
 *
 * Free-tier footer per §8.5/§11.3/§11.5 — the "Invoiced with Sendvoice"
 * line is the viral loop, not decoration. Removing it on paid tiers is
 * tracked as remaining work once billing tiers exist.
 */
export function renderInvoiceHtml(doc: InvoiceData): string {
  const balance = Number(doc.total) - Number(doc.amountPaid)
  const logoDataUri = tenantLogoDataUri(doc.tenant)

  const rows = doc.lines
    .sort((a, b) => a.position - b.position)
    .map((line) => {
      const qty = line.qty ? Number(line.qty) : 1
      const lineTotal = qty * Number(line.rate) - (line.discount ? Number(line.discount) : 0)
      return `
        <tr>
          <td class="desc">
            ${escapeHtml(line.description)}
            ${line.note ? `<div class="line-note">${escapeHtml(line.note)}</div>` : ''}
          </td>
          <td class="num">${line.qty ? `${qty}${line.unit ? ' ' + escapeHtml(line.unit) : ''}` : '—'}</td>
          <td class="num">${money(line.rate, doc.currency)}</td>
          <td class="num">${money(lineTotal, doc.currency)}</td>
        </tr>`
    })
    .join('')

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1a1a1a;
    margin: 0;
    padding: 48px 56px;
    font-size: 13px;
    line-height: 1.5;
  }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; }
  .business { display: flex; align-items: center; gap: 14px; }
  .business img { max-height: 48px; max-width: 140px; object-fit: contain; }
  .business h1 { font-size: 20px; margin: 0 0 4px; }
  .business .meta { color: #555; font-size: 12px; }
  .doc-type { text-align: right; }
  .doc-type .label { font-size: 22px; font-weight: 700; letter-spacing: 0.04em; color: #0b5d3b; }
  .doc-type .number { font-size: 14px; color: #555; margin-top: 4px; }
  .parties { display: flex; justify-content: space-between; margin-bottom: 32px; gap: 40px; }
  .parties .block h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #888; margin: 0 0 6px; }
  .parties .block .name { font-weight: 600; }
  .dates { text-align: right; font-size: 12px; color: #555; }
  .dates div { margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  thead th {
    text-align: left;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #888;
    border-bottom: 1.5px solid #1a1a1a;
    padding: 0 0 8px;
  }
  thead th.num { text-align: right; }
  tbody td { padding: 10px 0; border-bottom: 1px solid #e5e5e5; vertical-align: top; }
  tbody td.num { text-align: right; white-space: nowrap; }
  .line-note { font-size: 11px; color: #888; margin-top: 2px; }
  .totals { display: flex; justify-content: flex-end; }
  .totals table { width: 280px; margin: 0; }
  .totals td { padding: 4px 0; border: none; }
  .totals td.num { text-align: right; }
  .totals .total-row td { font-weight: 700; font-size: 15px; border-top: 1.5px solid #1a1a1a; padding-top: 8px; }
  .totals .balance-row td { color: #0b5d3b; font-weight: 700; }
  .notes { margin-top: 32px; font-size: 12px; color: #555; }
  .notes h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #888; margin: 0 0 6px; }
  .footer { margin-top: 56px; padding-top: 16px; border-top: 1px solid #e5e5e5; font-size: 10.5px; color: #999; text-align: center; }
</style>
</head>
<body>
  <div class="header">
    <div class="business">
      ${logoDataUri ? `<img src="${logoDataUri}" alt="" />` : ''}
      <div>
        <h1>${escapeHtml(doc.tenant.tradingName || doc.tenant.legalName)}</h1>
        <div class="meta">
          ${/* No business address field on Tenant yet — full onboarding
               (PRD §6.1) is remaining work; tax ID is what's collectible today. */ ''}
          ${doc.tenant.taxId ? `Tax ID: ${escapeHtml(doc.tenant.taxId)}` : ''}
        </div>
      </div>
    </div>
    <div class="doc-type">
      <div class="label">${doc.docType}</div>
      <div class="number">${doc.number ?? 'DRAFT'}</div>
    </div>
  </div>

  <div class="parties">
    <div class="block">
      <h2>Bill to</h2>
      <div class="name">${escapeHtml(doc.customer.name)}</div>
      ${doc.customer.whatsapp ? `<div>${escapeHtml(doc.customer.whatsapp)}</div>` : ''}
      ${doc.customer.address ? `<div>${escapeHtml(doc.customer.address)}</div>` : ''}
    </div>
    <div class="dates">
      <div><strong>Issued</strong> ${formatDate(doc.issueDate)}</div>
      <div><strong>Due</strong> ${formatDate(doc.dueDate)}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th class="num">Qty</th>
        <th class="num">Rate</th>
        <th class="num">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>

  <div class="totals">
    <table>
      <tr><td>Subtotal</td><td class="num">${money(doc.subtotal, doc.currency)}</td></tr>
      <tr><td>Tax</td><td class="num">${money(doc.taxTotal, doc.currency)}</td></tr>
      <tr class="total-row"><td>Total</td><td class="num">${money(doc.total, doc.currency)}</td></tr>
      ${
        Number(doc.amountPaid) > 0
          ? `<tr><td>Paid</td><td class="num">${money(doc.amountPaid, doc.currency)}</td></tr>
             <tr class="balance-row"><td>Balance due</td><td class="num">${money(balance, doc.currency)}</td></tr>`
          : ''
      }
    </table>
  </div>

  ${
    doc.notes
      ? `<div class="notes"><h2>Notes</h2>${escapeHtml(doc.notes)}</div>`
      : ''
  }

  <div class="footer">Invoiced with Sendvoice</div>
</body>
</html>`
}
