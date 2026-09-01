import { randomUUID } from 'node:crypto'
import { prisma, withTenant } from '../lib/prisma.js'

export type Identity = { userId: string; tenantId: string; phone: string }

/**
 * Login: resolve which tenant a phone belongs to via the SECURITY DEFINER
 * lookup function (prisma/migrations/.../auth_lookup_function) — this is the
 * one legitimate cross-tenant read, and it returns only ids, nothing else.
 * Signup: create Tenant + first User (role OWNER) in one transaction.
 *
 * Tenant.id is generated here, not left to the DB default, and app.tenant_id
 * is set to it before the insert — INSERT...RETURNING is subject to the
 * SELECT policy too, so a fresh row can't see itself otherwise (PRD plan,
 * §1 "Tenant creation").
 */
export async function resolveOrCreateIdentity(
  phone: string,
  businessName?: string,
): Promise<Identity> {
  const existing = await prisma.$queryRaw<Array<{ user_id: string; tenant_id: string }>>`
    select * from resolve_user_by_phone(${phone})
  `

  if (existing.length > 0) {
    const { user_id: userId, tenant_id: tenantId } = existing[0]
    return { userId, tenantId, phone }
  }

  const tenantId = randomUUID()
  const userId = randomUUID()

  await withTenant(tenantId, async (tx) => {
    await tx.tenant.create({
      data: {
        id: tenantId,
        legalName: businessName?.trim() || 'My Business',
        // PRD §6.1 (J1): auto-detected at onboarding, one tap to confirm.
        // Real detection is a separate Phase 0 item; these are placeholder
        // defaults a merchant edits in the onboarding screen, not a guess
        // we're presenting as final.
        country: 'NG',
        currency: 'NGN',
      },
    })
    await tx.user.create({
      data: { id: userId, tenantId, phone, role: 'OWNER' },
    })
  })

  return { userId, tenantId, phone }
}
