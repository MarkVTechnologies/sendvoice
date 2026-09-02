-- PRD §6.1 onboarding logo (optional, skippable). Stored inline, not
-- served from a URL — both render paths (PDF, hosted page) already have
-- the full Tenant in hand server-side and embed it as a data: URI.
ALTER TABLE "Tenant" ADD COLUMN "logoData" BYTEA;
ALTER TABLE "Tenant" ADD COLUMN "logoMimeType" TEXT;
