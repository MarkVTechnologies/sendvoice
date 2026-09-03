import type { InvoiceData } from './shared.js'
import { renderClassicTemplate } from './template-classic.js'
import { renderModernTemplate } from './template-modern.js'

// PRD §8.5 P0: "3-4 genuinely distinct" templates — a merchant's choice,
// captured once at signup (Tenant.pdfTemplate), not a random pick per
// invoice. Falls back to classic for anything unrecognized (a value from
// before a template existed, or a typo that slipped past validation
// somewhere) rather than throwing — a wrong-but-rendered PDF beats a failed
// approval.
export function renderInvoiceHtml(doc: InvoiceData): string {
  switch (doc.tenant.pdfTemplate) {
    case 'modern':
      return renderModernTemplate(doc)
    case 'classic':
    default:
      return renderClassicTemplate(doc)
  }
}
