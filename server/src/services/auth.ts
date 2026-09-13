import { randomUUID } from 'node:crypto'
import { prisma, withTenant } from '../lib/prisma.js'
import { defaultsForCountry, type TaxRules } from './tax.js'

export type Identity = { userId: string; tenantId: string; phone: string; role: string }

export type OnboardingInput = {
  businessName?: string
  country?: string
  currency?: string
  taxRules?: TaxRules
  logo?: { data: Buffer; mimeType: string }
  pdfTemplate?: string
  referralSource?: string
  address?: string
  taxId?: string
  bankName?: string
  bankAccountName?: string
  bankAccountNumber?: string
}

/**
 * Login: resolve which tenant a phone belongs to via the SECURITY DEFINER
 * lookup function (prisma/migrations/.../auth_lookup_function) — this is the
 * one legitimate cross-tenant read, and it returns only ids, nothing else.
 * Signup: create Tenant + first User (role OWNER) + a default TaxProfile in
 * one transaction.
 *
 * Tenant.id is generated here, not left to the DB default, and app.tenant_id
 * is set to it before the insert — INSERT...RETURNING is subject to the
 * SELECT policy too, so a fresh row can't see itself otherwise (PRD plan,
 * §1 "Tenant creation").
 */
export async function resolveOrCreateIdentity(phone: string, input: OnboardingInput = {}): Promise<Identity> {
  const existing = await prisma.$queryRaw<Array<{ user_id: string; tenant_id: string; role: string }>>`
    select * from resolve_user_by_phone(${phone})
  `

  if (existing.length > 0) {
    const { user_id: userId, tenant_id: tenantId, role } = existing[0]
    // PRD §8.1 P1: this is the moment an invited user (services/users.ts's
    // inviteUser pre-creates their row with joinedAt null) becomes active —
    // same lookup path as any other login, so an invite needs no separate
    // "accept" step beyond completing OTP once. Only ever set once.
    await withTenant(tenantId, (tx) =>
      tx.user.updateMany({ where: { id: userId, joinedAt: null }, data: { joinedAt: new Date() } }),
    )
    return { userId, tenantId, phone, role }
  }

  const tenantId = randomUUID()
  const userId = randomUUID()
  const country = input.country?.toUpperCase() || 'NG'
  const currency = input.currency?.toUpperCase() || defaultsForCountry(country).currency
  // PRD §6.1 (J1): "I don't charge tax" is a first-class one-tap option —
  // the default when the client sends nothing, not an edge case.
  const taxRules: TaxRules = input.taxRules ?? { mode: 'none' }

  await withTenant(tenantId, async (tx) => {
    await tx.tenant.create({
      data: {
        id: tenantId,
        legalName: input.businessName?.trim() || 'My Business',
        country,
        currency,
        logoData: input.logo ? new Uint8Array(input.logo.data) : undefined,
        logoMimeType: input.logo?.mimeType,
        pdfTemplate: input.pdfTemplate === 'modern' ? 'modern' : 'classic',
        referralSource: input.referralSource?.trim() || undefined,
        address: input.address?.trim() || undefined,
        taxId: input.taxId?.trim() || undefined,
        bankName: input.bankName?.trim() || undefined,
        bankAccountName: input.bankAccountName?.trim() || undefined,
        bankAccountNumber: input.bankAccountNumber?.trim() || undefined,
      },
    })
    await tx.user.create({
      data: { id: userId, tenantId, phone, role: 'OWNER', joinedAt: new Date() },
    })
    // Never update this row's `rules` in place once invoices reference it —
    // a rate change must insert a new TaxProfile (new id, incremented
    // version) so historical documents keep pointing at the rules that
    // were actually in effect (PRD §7.4: "never re-render with new rates").
    await tx.taxProfile.create({
      data: {
        tenantId,
        name: taxRules.mode === 'none' ? 'No tax' : 'Default',
        version: 1,
        rules: taxRules,
        isDefault: true,
      },
    })
  })

  return { userId, tenantId, phone, role: 'OWNER' }
}
