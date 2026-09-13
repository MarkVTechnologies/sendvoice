import type { PrismaClient } from '@prisma/client'

export type RecordPaymentInput = {
  amount: number
  method: 'psp' | 'cash' | 'bank_transfer'
  provider?: string
  reference?: string
}

/**
 * PRD §8.7 P0: records a payment — a PSP webhook/callback confirmation, or a
 * merchant's manual cash/bank-transfer entry — and moves Document.status to
 * PARTIALLY_PAID or PAID based on the running total. Never touches a QUOTE
 * (PRD §7.3: a quote isn't billed, it's offered) or a VOIDed document.
 *
 * Idempotent on (provider, reference) for PSP payments — enforced by the DB
 * unique constraint (prisma/schema.prisma), not just this check, since a
 * Paystack webhook retry and the hosted page's own post-payment redirect
 * can genuinely race each other. Manual (cash/bank_transfer) payments carry
 * no reference and are never deduped this way — a merchant recording two
 * separate real cash payments on the same invoice is normal, not a replay.
 */
export async function recordPayment(
  tx: PrismaClient,
  documentId: string,
  input: RecordPaymentInput,
) {
  // pdfData excluded — routes/invoices.ts spreads this straight into a JSON
  // response (the same shape every other invoice-mutation endpoint
  // returns); without this, the full PDF bytes would ship as JSON on every
  // payment recorded, the exact bug already found and fixed once on the
  // invoice-list endpoint (see DEVELOPMENT_PLAN.md).
  const document = await tx.document.findUniqueOrThrow({ where: { id: documentId }, omit: { pdfData: true } })
  if (document.docType !== 'INVOICE' || document.status === 'VOID') {
    return { document, created: false }
  }

  if (input.provider && input.reference) {
    const existing = await tx.payment.findFirst({
      where: { provider: input.provider, reference: input.reference },
    })
    if (existing) return { document, created: false }
  }

  await tx.payment.create({
    data: {
      documentId,
      amount: input.amount,
      method: input.method,
      provider: input.provider,
      reference: input.reference,
    },
  })

  const { _sum } = await tx.payment.aggregate({ where: { documentId }, _sum: { amount: true } })
  const amountPaid = _sum.amount ? Number(_sum.amount) : 0
  const total = Number(document.total)
  const status = amountPaid >= total ? 'PAID' : amountPaid > 0 ? 'PARTIALLY_PAID' : document.status

  const updated = await tx.document.update({
    where: { id: documentId },
    data: { amountPaid, status },
    omit: { pdfData: true },
  })

  await tx.documentEvent.create({
    data: {
      documentId,
      type: 'payment_recorded',
      data: { amount: input.amount, method: input.method, provider: input.provider ?? null },
    },
  })

  return { document: updated, created: true }
}
