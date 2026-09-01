import { randomBytes } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { allocateNumber } from './numbering.js'

// PRD §12 P0: high-entropy, unguessable — 24 bytes is 192 bits, plenty.
// 90-day default expiry; "configurable window" is remaining work.
const HOSTED_TOKEN_TTL_DAYS = 90
function generateHostedToken(): string {
  return randomBytes(24).toString('base64url')
}

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
 */
export async function approveInvoice(tx: PrismaClient, tenantId: string, input: ApproveInvoiceInput) {
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

  // No tax profile is wired up to onboarding yet (PRD §7.4) — taxTotal is
  // deliberately 0 until a tenant has a configured, versioned profile to pin
  // this invoice to. Computing a tax figure without one would be a guess
  // presented as a real number on a financial document.
  const taxTotal = 0
  const total = subtotal + taxTotal

  const year = new Date().getFullYear()
  const number = await allocateNumber(tx, tenantId, 'INVOICE', 'INV', year)

  const document = await tx.document.create({
    data: {
      tenantId,
      customerId: customer.id,
      docType: 'INVOICE',
      number,
      status: 'APPROVED',
      currency: input.currency ?? 'NGN',
      issueDate: new Date(),
      dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
      notes: input.notes,
      subtotal,
      taxTotal,
      total,
      approvedAt: new Date(),
      hostedToken: generateHostedToken(),
      hostedTokenExpiresAt: new Date(Date.now() + HOSTED_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
      lines: { create: lineData },
    },
    omit: { pdfData: true },
    include: { lines: true, customer: true },
  })

  await tx.documentEvent.create({
    data: { documentId: document.id, type: 'approved', data: { number } },
  })

  return document
}
