import type { PrismaClient } from '@prisma/client'
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

  // PRD §4.3 North Star: TTFI (time from signup to first invoice sent) is
  // Phase 0's exit metric. Computed here — never client-timed — because the
  // server already holds both ends of it (Tenant.createdAt, this approval)
  // with no client clock, reload, or crash able to lose or skew it. Only
  // meaningful once per tenant, so it's gated on this being their first
  // Document ever.
  const isFirstInvoice = (await tx.document.count({ where: { tenantId } })) === 0

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
  const number = await allocateNumber(tx, tenantId, 'INVOICE', 'INV', year)
  const tenant = await tx.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { currency: true, createdAt: true },
  })

  const document = await tx.document.create({
    data: {
      tenantId,
      draftId,
      customerId: customer.id,
      docType: 'INVOICE',
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
