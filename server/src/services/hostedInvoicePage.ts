import type { Customer, Document, DocumentLine, Tenant } from '@prisma/client'
import { tenantLogoDataUri } from './logo.js'

// PRD §4.3: "viral coefficient (recipient→signup attribution)" — needs the
// hosted page's footer CTA wired to signup source "from day one", not
// retrofitted. Separate from PUBLIC_BASE_URL (routes/invoices.ts) because
// the client SPA is a different origin/port from the API in dev.
const CLIENT_URL = process.env.CLIENT_URL ?? 'http://localhost:5173'

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
 * PRD §8.6 P0: "mobile-optimised hosted invoice page (no login, tokenised
 * URL) showing line items, total, due date, and a prominent Pay Now button
 * routing to the merchant's connected payment provider."
 *
 * §9.1 P0: ≤60KB critical path, sub-1s on 3G, works with JS disabled for
 * the core view. This is why it's a separate, plain server-rendered page
 * rather than part of the client SPA — no framework, no client JS at all
 * for the view itself, inline CSS, no external requests.
 *
 * Pay Now has no payment provider to route to yet (Phase 1) — shown as an
 * honest disabled state, not a button that silently does nothing.
 */
export function renderHostedInvoicePage(doc: InvoiceData): string {
  const businessName = escapeHtml(doc.tenant.tradingName || doc.tenant.legalName)
  const balance = Number(doc.total) - Number(doc.amountPaid)
  // Trades against the ≤60KB critical-path budget above for tenants with a
  // logo — inlined the same way as the PDF (no separate serving route to
  // maintain), but unlike the PDF this page's budget actually cares. Worth
  // revisiting (real object storage + a plain <img src>) if logos turn out
  // to push real pages over budget.
  const logoDataUri = tenantLogoDataUri(doc.tenant)

  const rows = doc.lines
    .sort((a, b) => a.position - b.position)
    .map((line) => {
      const qty = line.qty ? Number(line.qty) : 1
      const lineTotal = qty * Number(line.rate) - (line.discount ? Number(line.discount) : 0)
      return `
        <div class="line">
          <div class="line-desc">
            ${escapeHtml(line.description)}
            ${line.qty ? `<span class="line-qty">${qty}${line.unit ? ' ' + escapeHtml(line.unit) : ''} × ${money(line.rate, doc.currency)}</span>` : ''}
          </div>
          <div class="line-amount">${money(lineTotal, doc.currency)}</div>
        </div>`
    })
    .join('')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${doc.number ?? 'Invoice'} · ${businessName}</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: #f6f4ee;
    color: #1a1a1a;
    -webkit-text-size-adjust: 100%;
  }
  .wrap { max-width: 560px; margin: 0 auto; padding: 24px 20px 48px; }
  .card { background: #fff; border-radius: 12px; padding: 24px; box-shadow: 0 1px 2px rgba(0,0,0,0.06), 0 8px 24px -12px rgba(0,0,0,0.15); }
  .business { display: flex; align-items: center; gap: 10px; font-size: 15px; color: #555; margin-bottom: 2px; }
  .business img { max-height: 32px; max-width: 100px; object-fit: contain; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .status {
    display: inline-block;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 700;
    padding: 3px 9px;
    border-radius: 999px;
    background: #e3eee7;
    color: #0b5d3b;
    margin-bottom: 20px;
  }
  .meta { display: flex; justify-content: space-between; font-size: 13px; color: #777; margin-bottom: 20px; }
  .to { font-size: 13px; color: #777; margin-bottom: 4px; }
  .to strong { color: #1a1a1a; font-size: 15px; font-weight: 600; }
  .lines { border-top: 1px solid #eee; margin-top: 16px; }
  .line { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding: 14px 0; border-bottom: 1px solid #eee; }
  .line-desc { font-size: 14px; }
  .line-qty { display: block; font-size: 12.5px; color: #888; margin-top: 2px; }
  .line-amount { font-size: 14px; font-weight: 600; white-space: nowrap; }
  .totals { margin-top: 4px; }
  .totals .row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px; color: #555; }
  .totals .row.total { font-size: 19px; font-weight: 700; color: #1a1a1a; border-top: 1.5px solid #1a1a1a; margin-top: 6px; padding-top: 12px; }
  .totals .row.balance { color: #0b5d3b; font-weight: 700; }
  .pay {
    display: block;
    width: 100%;
    text-align: center;
    margin-top: 24px;
    padding: 15px;
    border-radius: 10px;
    font-size: 16px;
    font-weight: 600;
    border: none;
  }
  .pay.disabled { background: #eee; color: #999; }
  .pay-note { text-align: center; font-size: 12px; color: #999; margin-top: 8px; }
  .pdf-link {
    display: block;
    text-align: center;
    margin-top: 14px;
    font-size: 13.5px;
    color: #0b5d3b;
    text-decoration: none;
    font-weight: 600;
  }
  .footer { text-align: center; margin-top: 24px; font-size: 11.5px; }
  .footer-cta { color: #999; text-decoration: none; }
  .footer-cta:hover { text-decoration: underline; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="business">${logoDataUri ? `<img src="${logoDataUri}" alt="" />` : ''}${businessName}</div>
      <h1>${doc.number ?? 'Invoice'}</h1>
      <span class="status">${escapeHtml(doc.status)}</span>

      <div class="to">
        Billed to<br/>
        <strong>${escapeHtml(doc.customer.name)}</strong>
      </div>
      <div class="meta">
        <span>Issued ${formatDate(doc.issueDate)}</span>
        <span>Due ${formatDate(doc.dueDate)}</span>
      </div>

      <div class="lines">${rows}</div>

      <div class="totals">
        <div class="row"><span>Subtotal</span><span>${money(doc.subtotal, doc.currency)}</span></div>
        <div class="row"><span>Tax</span><span>${money(doc.taxTotal, doc.currency)}</span></div>
        <div class="row total"><span>Total</span><span>${money(doc.total, doc.currency)}</span></div>
        ${
          Number(doc.amountPaid) > 0
            ? `<div class="row"><span>Paid</span><span>${money(doc.amountPaid, doc.currency)}</span></div>
               <div class="row balance"><span>Balance due</span><span>${money(balance, doc.currency)}</span></div>`
            : ''
        }
      </div>

      <button class="pay disabled" disabled>Pay Now</button>
      <p class="pay-note">Online payment isn't set up for this business yet.</p>

      <a class="pdf-link" href="/i/${doc.hostedToken}/pdf">Download PDF</a>
    </div>
    <div class="footer">
      <a class="footer-cta" href="${CLIENT_URL}/onboarding?ref=${encodeURIComponent(doc.hostedToken ?? '')}">Invoiced with Sendvoice — send your own free</a>
    </div>
  </div>
</body>
</html>`
}
