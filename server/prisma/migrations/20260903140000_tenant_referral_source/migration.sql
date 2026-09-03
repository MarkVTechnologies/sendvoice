-- PRD §4.3 viral coefficient: raw signup-attribution source (a hosted
-- invoice's token, at the only source wired up so far), unresolved.
-- Null on every existing tenant — matches reality, since attribution didn't
-- exist before this migration.
ALTER TABLE "Tenant" ADD COLUMN "referralSource" TEXT;
