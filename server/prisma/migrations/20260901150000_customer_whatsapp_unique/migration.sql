-- Replace the plain index on (tenantId, whatsapp) with a unique constraint —
-- PRD §8.2 P1 duplicate detection, enforced at the DB rather than as an
-- app-level check. Nulls are distinct under Postgres uniqueness, so
-- customers with no WhatsApp number never collide with each other.
DROP INDEX IF EXISTS "Customer_tenantId_whatsapp_idx";
CREATE UNIQUE INDEX "Customer_tenantId_whatsapp_key" ON "Customer"("tenantId", "whatsapp");
