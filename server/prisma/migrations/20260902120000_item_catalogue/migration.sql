-- PRD §8.3 P1: item catalogue auto-save with fuzzy recall — a merchant
-- retyping "Tailoring services" every invoice should get it suggested back
-- instead. Upserted inline during approval (same transaction, same
-- dedup-on-approve pattern as Customer), tenant-isolated the same way as
-- every other table here.

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "normalizedDescription" TEXT NOT NULL,
    "unit" TEXT,
    "rate" DECIMAL(14,2) NOT NULL,
    "useCount" INTEGER NOT NULL DEFAULT 1,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Item_tenantId_normalizedDescription_key" ON "Item"("tenantId", "normalizedDescription");

-- CreateIndex
CREATE INDEX "Item_tenantId_lastUsedAt_idx" ON "Item"("tenantId", "lastUsedAt");

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RowLevelSecurity (see prisma/rls-policies.sql — same tenant_isolation
-- pattern as every other direct-tenantId table; FORCE is required because
-- the migration/app roles' relationship to table ownership is what makes
-- RLS actually apply, not just declaring it — see that file's header note).
ALTER TABLE "Item" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Item" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "Item"
  USING ("tenantId" = current_setting('app.tenant_id', true));

-- Fuzzy recall: trigram similarity, not just substring ILIKE — "tailorng"
-- (typo) or "tailor" (partial) should still surface "Tailoring services".
-- Neon supports pg_trgm out of the box; created here since it's owner-only,
-- same as the extension-requiring parts of any managed-Postgres migration.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "Item_description_trgm_idx" ON "Item" USING gin ("description" gin_trgm_ops);
