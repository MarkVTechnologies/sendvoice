import type { Customer, Document } from '@prisma/client'

// Omit<..., 'pdfData'> matches the `omit: { pdfData: true }` shape every
// caller queries with — this export never needs the PDF bytes themselves,
// only the same fields already shown in the invoice list.
type ExportRow = Omit<Document, 'pdfData'> & { customer: Customer }

// RFC 4180: a field needs quoting only if it contains a comma, a quote, or a
// newline; an embedded quote doubles up. Hand-rolled rather than a library
// dependency — this is the one place in the codebase that needs it, and the
// escaping rule is three lines, the same call already made for HTML
// escaping in services/hostedInvoicePage.ts.
function csvField(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const HEADERS = [
  'Type',
  'Number',
  'Status',
  'Customer',
  'Customer WhatsApp',
  'Currency',
  'Issue date',
  'Due date',
  'Subtotal',
  'Tax',
  'Total',
  'Amount paid',
  'Balance due',
]

/**
 * PRD §8.8 P1: "Export CSV / XLSX / ZIP-of-PDFs, date-range filtered."
 * CSV first, per DEVELOPMENT_PLAN.md — cheapest to build, and it's the
 * format every accountant's own software already imports (PRD §5.3: "clean
 * exports" is the one thing the accountant persona explicitly needs).
 *
 * Every doc type is included, not just INVOICE — an accountant reconciling
 * month end wants to see quotes and credit notes too, each tagged by its
 * own Type column, rather than a second export to remember to also run.
 */
export function buildInvoicesCsv(documents: ExportRow[]): string {
  const rows = documents.map((doc) => {
    const balance = Number(doc.total) - Number(doc.amountPaid)
    return [
      doc.docType,
      doc.number ?? '',
      doc.status,
      doc.customer.name,
      doc.customer.whatsapp ?? '',
      doc.currency,
      doc.issueDate ? doc.issueDate.toISOString().slice(0, 10) : '',
      doc.dueDate ? doc.dueDate.toISOString().slice(0, 10) : '',
      doc.subtotal.toString(),
      doc.taxTotal.toString(),
      doc.total.toString(),
      doc.amountPaid.toString(),
      balance.toFixed(2),
    ]
      .map(csvField)
      .join(',')
  })

  // CRLF throughout — RFC 4180's actual line-ending, and what Excel expects
  // opening the file directly rather than through an import dialog.
  return [HEADERS.map(csvField).join(','), ...rows].join('\r\n') + '\r\n'
}
