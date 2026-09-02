-- Idempotency key for approval — a retried request (flaky connection, our
-- own outbox flush) must never create a second invoice for one merchant
-- action. Nulls are distinct under Postgres uniqueness, so historical rows
-- (created before this column existed) don't collide with each other.
ALTER TABLE "Document" ADD COLUMN "draftId" TEXT;
CREATE UNIQUE INDEX "Document_tenantId_draftId_key" ON "Document"("tenantId", "draftId");
