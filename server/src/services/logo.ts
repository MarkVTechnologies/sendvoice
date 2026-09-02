import type { Tenant } from '@prisma/client'

/** Both render paths (PDF, hosted page) run server-side with the Tenant
 * already in hand — a data: URI needs no separate public serving route. */
export function tenantLogoDataUri(tenant: Tenant): string | null {
  if (!tenant.logoData || !tenant.logoMimeType) return null
  return `data:${tenant.logoMimeType};base64,${Buffer.from(tenant.logoData).toString('base64')}`
}
