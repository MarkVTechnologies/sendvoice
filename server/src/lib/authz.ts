import type { FastifyReply, FastifyRequest } from 'fastify'

// PRD §8.1 P1: "Multi-user with roles: Owner, Editor (create/send), Viewer,
// Accountant (read + export)." Role lives in the JWT (set at sign-time,
// services/auth.ts), not looked up fresh per request — a role change only
// takes effect on that user's next login, the same staleness tradeoff the
// JWT already accepts for tenantId/phone. No session-revocation mechanism
// exists yet for any of these fields; adding one is a bigger, separate
// piece of work, not specific to roles.
export function requireRole(...allowed: Array<'OWNER' | 'EDITOR' | 'VIEWER' | 'ACCOUNTANT'>) {
  return async function (req: FastifyRequest, reply: FastifyReply) {
    // Every JWT issued before this feature existed has no `role` claim at
    // all (services/auth.ts's Identity didn't carry one yet) — without this
    // fallback, every already-logged-in user, Owners included, would 403 on
    // every write action the moment this shipped, until they happened to
    // log out and back in. Defaulting to OWNER matches reality for those
    // tokens: single-user accounts predating this feature are the Owner by
    // construction (Role's own schema default is OWNER).
    const { role } = req.user as { role?: string }
    if (!allowed.includes((role ?? 'OWNER') as never)) {
      reply.code(403).send({ error: 'forbidden' })
    }
  }
}
