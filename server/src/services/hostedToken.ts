import { randomBytes } from 'node:crypto'

// PRD §12 P0: high-entropy, unguessable — 24 bytes is 192 bits, plenty.
// 90-day default expiry; "configurable window" is remaining work. Shared
// between invoice creation (services/invoices.ts) and link revocation
// (routes/invoices.ts's revoke-link handler) — a revoke is really just
// "mint a fresh one and discard the old", so both need the identical rule.
export const HOSTED_TOKEN_TTL_DAYS = 90

export function generateHostedToken(): string {
  return randomBytes(24).toString('base64url')
}

export function hostedTokenExpiry(): Date {
  return new Date(Date.now() + HOSTED_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000)
}
