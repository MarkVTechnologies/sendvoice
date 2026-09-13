import type { DocType, PrismaClient } from '@prisma/client'
import { allocateNumber } from './numbering.js'
import { recordItemUsage } from './items.js'
import { computeTax, type TaxRules } from './tax.js'
import { generateHostedToken, hostedTokenExpiry } from './hostedToken.js'

export type ApproveInvoiceInput = {
  customer: { name: string; whatsapp?: string; email?: string }
  lines: Array<{
    description: string
    qty?: number
    unit?: string
    rate: number
    discount?: number
  }>
  currency?: string
  dueDate?: string
  notes?: string
  // PRD §7.3: "shared engine, different label + numbering series" — a
  // quote and an invoice go through the identical approval path below,
  // differing only in docType (and therefore which NumberSeries/prefix they
  // draw from). Defaults to INVOICE so every existing caller is unaffected.
  docType?: Extract<DocType, 'INVOICE' | 'QUOTE'>
}

// PRD §9.4: format is "{prefix}-{YYYY}-{seq:0000} with per-series counters" —
// one series (and prefix) per docType, per tenant, per year.
const PREFIX_BY_DOC_TYPE: Record<'INVOICE' | 'QUOTE', string> = {
  INVOICE: 'INV',
  QUOTE: 'QT',
}

/**
 * PRD §6.1 (J1) + §9.4: the only place a Document is ever created and
 * numbered. Totals are computed here, server-side — never trust a client-
 * submitted total, since that's exactly the number a dispute hinges on.
 *
 * PRD §8.2 P0: customers are created inline during invoicing, never a
 * separate "add customer first" step — find-by-WhatsApp-number or create.
 *
 * Idempotent by (tenantId, draftId): a retried approve request — a flaky
 * connection, our own outbox flush retrying after a timeout — must return
 * the invoice already created, never mint a second one. The caller
 * (routes/invoices.ts) uses `created` to skip re-rendering the PDF on a
 * replay.
 */
export async function approveInvoice(
  tx: PrismaClient,
  tenantId: string,
  draftId: string,
  input: ApproveInvoiceInput,
) {
  const existing = await tx.document.findUnique({
    where: { tenantId_draftId: { tenantId, draftId } },
    omit: { pdfData: true },
    include: { lines: true, customer: true },
  })
  if (existing) return { document: existing, created: false }

  const docType = input.docType ?? 'INVOICE'

  // PRD §4.3 North Star: TTFI is specifically "time to first *invoice*" —
  // a merchant who sends a quote first shouldn't have that count, and
  // shouldn't have it block the real metric from firing once an invoice
  // does go out. Gated on docType, not just "any Document ever".
  const isFirstInvoice =
    docType === 'INVOICE' && (await tx.document.count({ where: { tenantId, docType: 'INVOICE' } })) === 0

  const customer = input.customer.whatsapp
    ? await tx.customer.upsert({
        where: { tenantId_whatsapp: { tenantId, whatsapp: input.customer.whatsapp } },
        update: {},
        create: {
          tenantId,
          name: input.customer.name,
          whatsapp: input.customer.whatsapp,
          email: input.customer.email,
        },
      })
    : await tx.customer.create({
        data: { tenantId, name: input.customer.name, email: input.customer.email },
      })

  let subtotal = 0
  const lineData = input.lines.map((line, index) => {
    const qty = line.qty ?? 1
    const gross = qty * line.rate
    const net = gross - (line.discount ?? 0)
    subtotal += net
    return {
      position: index,
      description: line.description,
      qty,
      unit: line.unit,
      rate: line.rate,
      discount: line.discount,
    }
  })

  // PRD §7.4: pin to whichever TaxProfile is the tenant's default right now
  // — never recompute against a *changed* profile later. Every tenant gets
  // one at signup (services/auth.ts), including an explicit "no tax" one,
  // so this should always find a row; falling back to 'none' only covers
  // tenants that predate this (or a future admin-only path that skips it).
  const taxProfile = await tx.taxProfile.findFirst({ where: { tenantId, isDefault: true } })
  const taxRules: TaxRules = (taxProfile?.rules as TaxRules | undefined) ?? { mode: 'none' }
  const taxTotal = computeTax(taxRules, subtotal)
  const total = subtotal + taxTotal

  const year = new Date().getFullYear()
  const number = await allocateNumber(tx, tenantId, docType, PREFIX_BY_DOC_TYPE[docType], year)
  const tenant = await tx.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { currency: true, createdAt: true },
  })

  const document = await tx.document.create({
    data: {
      tenantId,
      draftId,
      customerId: customer.id,
      docType,
      number,
      status: 'APPROVED',
      currency: input.currency ?? tenant.currency,
      taxProfileId: taxProfile?.id,
      taxProfileVersion: taxProfile?.version,
      issueDate: new Date(),
      dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
      notes: input.notes,
      subtotal,
      taxTotal,
      total,
      approvedAt: new Date(),
      hostedToken: generateHostedToken(),
      hostedTokenExpiresAt: hostedTokenExpiry(),
      lines: { create: lineData },
    },
    omit: { pdfData: true },
    include: { lines: true, customer: true },
  })

  const ttfiMs = isFirstInvoice ? document.approvedAt!.getTime() - tenant.createdAt.getTime() : undefined

  await recordItemUsage(tx, tenantId, input.lines)

  await tx.documentEvent.create({
    data: {
      documentId: document.id,
      type: 'approved',
      data: ttfiMs === undefined ? { number } : { number, ttfiMs },
    },
  })

  return { document, created: true, ttfiMs }
}

/**
 * PRD §7.3: "Quote→Invoice conversion is one tap and preserves the link for
 * audit." Never mutates the quote — approved documents are append-only
 * (PRD §9.4) — instead creates a brand-new, separately-numbered INVOICE
 * document with its own hosted link, linked back via convertedFromId.
 *
 * Idempotent the same shape as approveInvoice: converting the same quote
 * twice (a double-tap, a retried request) returns the invoice already
 * created rather than minting a second one.
 */
export async function convertQuoteToInvoice(tx: PrismaClient, tenantId: string, quoteId: string) {
  const quote = await tx.document.findUnique({
    where: { id: quoteId },
    include: { lines: true },
  })
  if (!quote || quote.docType !== 'QUOTE') return null

  const alreadyConverted = await tx.document.findFirst({
    where: { tenantId, convertedFromId: quoteId },
    omit: { pdfData: true },
    include: { lines: true, customer: true },
  })
  if (alreadyConverted) return { document: alreadyConverted, created: false }

  // PRD §4.3 North Star: a merchant whose very first document was a quote,
  // converted here into their first real invoice, must still produce a
  // TTFI reading — the metric is "time to first invoice", and this is a
  // second, equally valid way to reach one (see approveInvoice's own gate).
  const isFirstInvoice = (await tx.document.count({ where: { tenantId, docType: 'INVOICE' } })) === 0
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { createdAt: true } })

  const year = new Date().getFullYear()
  const number = await allocateNumber(tx, tenantId, 'INVOICE', PREFIX_BY_DOC_TYPE.INVOICE, year)

  const document = await tx.document.create({
    data: {
      tenantId,
      customerId: quote.customerId,
      docType: 'INVOICE',
      number,
      status: 'APPROVED',
      currency: quote.currency,
      taxProfileId: quote.taxProfileId,
      taxProfileVersion: quote.taxProfileVersion,
      issueDate: new Date(),
      dueDate: quote.dueDate,
      notes: quote.notes,
      subtotal: quote.subtotal,
      taxTotal: quote.taxTotal,
      total: quote.total,
      convertedFromId: quote.id,
      approvedAt: new Date(),
      hostedToken: generateHostedToken(),
      hostedTokenExpiresAt: hostedTokenExpiry(),
      lines: {
        create: quote.lines.map((line) => ({
          position: line.position,
          type: line.type,
          description: line.description,
          qty: line.qty,
          unit: line.unit,
          rate: line.rate,
          discount: line.discount,
          taxCode: line.taxCode,
          imageUrl: line.imageUrl,
          note: line.note,
        })),
      },
    },
    omit: { pdfData: true },
    include: { lines: true, customer: true },
  })

  const ttfiMs = isFirstInvoice ? document.approvedAt!.getTime() - tenant.createdAt.getTime() : undefined

  await tx.documentEvent.create({
    data: {
      documentId: document.id,
      type: 'converted_from_quote',
      data: ttfiMs === undefined ? { quoteId: quote.id, number } : { quoteId: quote.id, number, ttfiMs },
    },
  })
  await tx.documentEvent.create({
    data: { documentId: quote.id, type: 'converted_to_invoice', data: { invoiceId: document.id } },
  })

  return { document, created: true, ttfiMs }
}
