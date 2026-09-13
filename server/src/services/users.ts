import type { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'

export type InviteResult = { ok: true; userId: string } | { ok: false; reason: 'phone_already_in_use' }

/**
 * PRD §8.1 P1: "Multi-user with roles." Pre-creates the User row directly
 * (joinedAt left null) rather than a separate Invitation record — login
 * already resolves any phone to a User via resolve_user_by_phone (the
 * SECURITY DEFINER lookup, same one every login uses), so an invited
 * phone completing OTP for the first time needs no separate "accept
 * invite" step or token; it's just that lookup finding this row instead
 * of finding nothing (services/auth.ts sets joinedAt there).
 *
 * phone is globally unique (PRD §8.1: "phone number is the primary
 * identity") — inviting a number already in *any* tenant (including this
 * one) fails cleanly rather than as a raw DB constraint error, since one
 * person having two tenant memberships isn't a case this schema or the
 * PRD's persona model ("Chidera runs one business") supports.
 */
export async function inviteUser(
  tx: PrismaClient,
  tenantId: string,
  phone: string,
  role: 'EDITOR' | 'VIEWER' | 'ACCOUNTANT',
): Promise<InviteResult> {
  const existing = await tx.user.findUnique({ where: { phone } })
  if (existing) {
    return { ok: false, reason: 'phone_already_in_use' }
  }
  const user = await tx.user.create({
    data: { id: randomUUID(), tenantId, phone, role, joinedAt: null },
  })
  return { ok: true, userId: user.id }
}

export async function listUsers(tx: PrismaClient, tenantId: string) {
  return tx.user.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } })
}

export type RemoveResult = { ok: true } | { ok: false; reason: 'not_found' | 'cannot_remove_owner' | 'cannot_remove_self' }

export async function removeUser(
  tx: PrismaClient,
  tenantId: string,
  actingUserId: string,
  targetUserId: string,
): Promise<RemoveResult> {
  const target = await tx.user.findUnique({ where: { id: targetUserId } })
  if (!target || target.tenantId !== tenantId) {
    return { ok: false, reason: 'not_found' }
  }
  // The tenant's Owner is never removable through this path — there's no
  // ownership-transfer flow, so removing the only Owner would strand the
  // tenant with no one able to invite/remove/manage it at all.
  if (target.role === 'OWNER') {
    return { ok: false, reason: 'cannot_remove_owner' }
  }
  if (target.id === actingUserId) {
    return { ok: false, reason: 'cannot_remove_self' }
  }
  await tx.user.delete({ where: { id: targetUserId } })
  return { ok: true }
}
