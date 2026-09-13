/**
 * A minimal, hand-built, valid single-page PDF — used only as the required
 * "example" document Meta's template review needs for a DOCUMENT-header
 * template (services/telnyx.ts's createWhatsAppTemplate). Never shown to a
 * real customer; the real per-send attachment is the actual invoice PDF
 * (services/pdf.ts), supplied separately at send time.
 *
 * Hand-built with computed byte offsets rather than rendered through the
 * Puppeteer pipeline used for real invoices — that pipeline needs a
 * Document row and a running Chrome install, and this needs to exist
 * before either does (a template is submitted once, generically, not
 * per-invoice). A spec-correct minimal PDF is a few dozen lines either way.
 */
function buildMinimalPdf(text: string): Buffer {
  const escaped = text.replace(/[()\\]/g, (c) => `\\${c}`)
  const stream = `BT /F1 14 Tf 20 100 Td (${escaped}) Tj ET`

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 320 150] /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ]

  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((obj, i) => {
    offsets.push(body.length)
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`
  })

  const xrefStart = body.length
  // Each entry must be exactly 20 bytes per the PDF spec (10-digit offset,
  // space, 5-digit generation, space, f/n flag, space, newline).
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  body += xref
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`

  return Buffer.from(body, 'latin1')
}

export const sampleInvoicePdf = buildMinimalPdf('Sendvoice sample invoice document')
