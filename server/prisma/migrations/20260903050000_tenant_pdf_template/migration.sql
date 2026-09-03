-- PRD §8.5 P0: a signup-time choice of PDF template, not per-invoice.
-- Existing tenants backfill to "classic" via the column default, matching
-- the only template that existed before this migration.
ALTER TABLE "Tenant" ADD COLUMN "pdfTemplate" TEXT NOT NULL DEFAULT 'classic';
