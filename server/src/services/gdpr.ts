import type { PrismaClient } from '@prisma/client'

/**
 * PRD §12 P1: "GDPR/NDPR: data export." Everything about the tenant's own
 * account — the merchant's own data-portability right, and also the
 * mechanism a merchant would use if one of their own customers asked them
 * for a copy of their data (the merchant, not us, is the controller of
 * their customers' data — we're the processor). Excludes PDF bytes
 * (available individually via the existing /invoices/:id/pdf) and the two
 * fields that shouldn't be casually multiplied into a bulk export file —
 * the tenant's logo bytes and bank account number.
 */
export async function exportTenantData(tx: PrismaClient, tenantId: string) {
  const [tenant, users, customers, documents, items] = await Promise.all([
    tx.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
    tx.user.findMany({ where: { tenantId } }),
    tx.customer.findMany({ where: { tenantId } }),
    tx.document.findMany({
      where: { tenantId },
      omit: { pdfData: true },
      include: { lines: true, payments: true, deliveries: true, events: true },
    }),
    tx.item.findMany({ where: { tenantId } }),
  ])

  const { logoData: _logoData, logoMimeType: _logoMimeType, bankAccountNumber: _bankAccountNumber, ...tenantSafe } =
    tenant

  return {
    exportedAt: new Date().toISOString(),
    tenant: tenantSafe,
    users: users.map(({ id, phone, name, role, joinedAt, createdAt }) => ({
      id,
      phone,
      name,
      role,
      joinedAt,
      createdAt,
    })),
    customers,
    documents,
    items,
  }
}

export type EraseResult = { ok: true } | { ok: false; reason: 'not_found' }

/**
 * PRD §12 P1: "right to erasure (with a documented carve-out for statutory
 * invoice retention, typically 5-7 years)." Anonymizes the customer's PII
 * in place rather than deleting the row — every Document referencing this
 * customer must survive with its real financial data intact (number,
 * amounts, tax, dates), which a row delete would either cascade-destroy or
 * be blocked outright by the foreign key. This *is* the carve-out: erase
 * the person, keep the transaction record a tax authority can still audit.
 *
 * whatsapp/email set to null rather than left in place — Postgres treats
 * NULL as distinct under the existing (tenantId, whatsapp) unique
 * constraint, so multiple erased customers never collide with each other,
 * and if that same phone number has a genuine new relationship with this
 * merchant later, it correctly starts as a fresh Customer row rather than
 * silently reattaching to the erased identity.
 */
export async function eraseCustomer(tx: PrismaClient, tenantId: string, customerId: string): Promise<EraseResult> {
  const result = await tx.customer.updateMany({
    where: { id: customerId, tenantId },
    data: { name: 'Erased customer', whatsapp: null, email: null, address: null, taxId: null, notes: null },
  })
  return result.count > 0 ? { ok: true } : { ok: false, reason: 'not_found' }
}
