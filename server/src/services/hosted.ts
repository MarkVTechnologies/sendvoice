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
