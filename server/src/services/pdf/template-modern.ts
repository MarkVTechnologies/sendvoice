import { tenantLogoDataUri } from '../logo.js'
import { type InvoiceData, escapeHtml, formatDate, money } from './shared.js'

/**
 * PRD §8.5 P0's second template — deliberately structural differences from
 * classic, not a recolor: a full-bleed header band instead of a plain top
 * row, zebra-striped line items instead of hairline rules, and a shaded
 * totals card instead of a bare right-aligned table. Same determinism and
 * free-tier-footer constraints as classic (see that file's header comment).
 */
export function renderModernTemplate(doc: InvoiceData): string {
  const balance = Number(doc.total) - Number(doc.amountPaid)
  const logoDataUri = tenantLogoDataUri(doc.tenant)

  const rows = doc.lines
    .sort((a, b) => a.position - b.position)
    .map((line, i) => {
      const qty = line.qty ? Number(line.qty) : 1
      const lineTotal = qty * Number(line.rate) - (line.discount ? Number(line.discount) : 0)
      return `
        <tr class="${i % 2 === 1 ? 'alt' : ''}">
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
    color: #1e2530;
    margin: 0;
    font-size: 13px;
    line-height: 1.5;
  }
  .band {
    background: #232946;
    color: #fff;
    padding: 40px 56px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .business { display: flex; align-items: center; gap: 14px; }
  .business .logo-chip {
    background: #fff;
    border-radius: 8px;
    padding: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .business img { max-height: 36px; max-width: 120px; object-fit: contain; display: block; }
  .business h1 { font-size: 22px; margin: 0 0 4px; font-weight: 700; letter-spacing: -0.01em; }
  .business .meta { color: #b8bfd6; font-size: 11.5px; white-space: pre-line; }
  .doc-type { text-align: right; }
  .doc-type .label {
    display: inline-block;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    background: #eeb902;
    color: #232946;
    padding: 4px 10px;
    border-radius: 999px;
  }
  .doc-type .number { font-size: 15px; color: #fff; margin-top: 8px; font-weight: 600; }
  .content { padding: 36px 56px 48px; }
  .parties { display: flex; gap: 24px; margin-bottom: 32px; }
  .parties .card {
    flex: 1;
    background: #f4f5fa;
    border-radius: 10px;
    padding: 16px 18px;
  }
  .parties .card h2 { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.07em; color: #6b7290; margin: 0 0 8px; }
  .parties .card .name { font-weight: 700; }
  .parties .card div { margin-bottom: 2px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  thead th {
    text-align: left;
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #6b7290;
    background: #f4f5fa;
    padding: 10px 12px;
  }
  thead th:first-child { border-radius: 8px 0 0 8px; }
  thead th:last-child { border-radius: 0 8px 8px 0; }
  thead th.num { text-align: right; }
  tbody td { padding: 12px; vertical-align: top; }
  tbody tr.alt td { background: #fafafe; }
  tbody td.num { text-align: right; white-space: nowrap; }
  .line-note { font-size: 11px; color: #6b7290; margin-top: 2px; }
  .totals { display: flex; justify-content: flex-end; }
  .totals .card {
    width: 300px;
    background: #f4f5fa;
    border-radius: 10px;
    padding: 16px 20px;
  }
  .totals table { width: 100%; margin: 0; }
  .totals td { padding: 5px 0; border: none; }
  .totals td.num { text-align: right; }
  .totals .total-row td { font-weight: 700; font-size: 16px; border-top: 1.5px solid #232946; padding-top: 10px; margin-top: 4px; }
  .totals .balance-row td { color: #232946; font-weight: 700; }
  .totals .balance-row td.num { background: #eeb902; border-radius: 6px; padding: 4px 8px; }
  .notes { margin-top: 32px; font-size: 12px; color: #555; }
  .notes h2 { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.07em; color: #6b7290; margin: 0 0 6px; }
  .footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #e5e5ee; font-size: 10.5px; color: #9aa0b8; text-align: center; }
</style>
</head>
<body>
  <div class="band">
    <div class="business">
      ${logoDataUri ? `<div class="logo-chip"><img src="${logoDataUri}" alt="" /></div>` : ''}
      <div>
        <h1>${escapeHtml(doc.tenant.tradingName || doc.tenant.legalName)}</h1>
        <div class="meta">
          ${doc.tenant.address ? `<div>${escapeHtml(doc.tenant.address)}</div>` : ''}
          ${doc.tenant.taxId ? `<div>Tax ID: ${escapeHtml(doc.tenant.taxId)}</div>` : ''}
        </div>
      </div>
    </div>
    <div class="doc-type">
      <div class="label">${doc.docType}</div>
      <div class="number">${doc.number ?? 'DRAFT'}</div>
    </div>
  </div>

  <div class="content">
    <div class="parties">
      <div class="card">
        <h2>Bill to</h2>
        <div class="name">${escapeHtml(doc.customer.name)}</div>
        ${doc.customer.whatsapp ? `<div>${escapeHtml(doc.customer.whatsapp)}</div>` : ''}
        ${doc.customer.address ? `<div>${escapeHtml(doc.customer.address)}</div>` : ''}
      </div>
      <div class="card">
        <h2>Dates</h2>
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
      <div class="card">
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
    </div>

    ${doc.notes ? `<div class="notes"><h2>Notes</h2>${escapeHtml(doc.notes)}</div>` : ''}

    <div class="footer">Invoiced with Sendvoice</div>
  </div>
</body>
</html>`
}
