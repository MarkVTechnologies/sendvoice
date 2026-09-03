import { prisma, withTenant } from '../lib/prisma.js'

/**
 * Same two-step pattern as login (services/auth.ts): a SECURITY DEFINER
 * function does the one legitimate cross-tenant lookup — resolving a
 * stranger's token to a tenant — and returns only ids. Everything after
 * that goes through the normal RLS-scoped withTenant() path.
 */
// Fetches pdfData too even when the caller only needs the page view, not
// the PDF download — an unnecessary bytea read on that path. Acceptable
// for now; split into two query shapes if this route gets real traffic.
export async function resolveHostedDocument(token: string) {
  const rows = await prisma.$queryRaw<Array<{ document_id: string; tenant_id: string }>>`
    select * from resolve_document_by_token(${token})
  `
  if (rows.length === 0) return null
  const { document_id: documentId, tenant_id: tenantId } = rows[0]

  return withTenant(tenantId, (tx) =>
    tx.document.findUniqueOrThrow({
      where: { id: documentId },
      include: { lines: true, customer: true, tenant: true },
    }),
  )
}

/**
 * PRD §4.3 North Star: "invoices delivered and viewed per active merchant
 * per week" — nothing recorded this at all before. Every real open of the
 * hosted page logs a DocumentEvent (a raw, honest record — this will also
 * catch link-preview bots and scanners, which is an accepted Phase 0
 * tradeoff, not something worth building bot-detection for yet); the
 * `status` transition is conditional (`updateMany` scoped to the current
 * status) so it only fires once, from APPROVED → VIEWED, and never
 * downgrades a document that's already moved further (PARTIALLY_PAID,
 * PAID, VOID) back to VIEWED.
 */
export async function recordHostedView(tenantId: string, documentId: string): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    await tx.documentEvent.create({ data: { documentId, type: 'viewed' } })
    await tx.document.updateMany({
      where: { id: documentId, status: 'APPROVED' },
      data: { status: 'VIEWED' },
    })
  })
}
