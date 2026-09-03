-- PRD §6.1 onboarding field — every PDF template already had a slot for
-- this, it just had nothing to render. Free text, optional/skippable.
ALTER TABLE "Tenant" ADD COLUMN "address" TEXT;
