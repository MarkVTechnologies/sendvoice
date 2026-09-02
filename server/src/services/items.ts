import type { PrismaClient } from '@prisma/client'

// PRD §8.3 P1: item catalogue auto-save with fuzzy recall. Kept deliberately
// simple — collapse whitespace and case so "Tailoring services" and
// "tailoring   services" dedupe to the same row; no stemming/pluralization
// handling, that's what the trigram fuzzy search (searchItems below) is for.
export function normalizeItemDescription(description: string): string {
  return description.trim().toLowerCase().replace(/\s+/g, ' ')
}

export type ItemUsageLine = { description: string; unit?: string; rate: number }

/**
 * Upserts each approved line into the tenant's item catalogue — same
 * inline-dedup-on-approve pattern as Customer (services/invoices.ts). Only
 * called for a genuinely new invoice (never a replayed/idempotent one),
 * same as the PDF render and the TTFI log — a retried approve must not
 * double-count useCount for items that were already recorded the first
 * time. Two lines in one invoice with the same normalized description
 * (e.g. duplicated by mistake) are deliberately allowed to double-upsert;
 * that's an honest reflection of usage, not a bug to guard against.
 */
export async function recordItemUsage(tx: PrismaClient, tenantId: string, lines: ItemUsageLine[]): Promise<void> {
  await Promise.all(
    lines.map((line) => {
      const normalizedDescription = normalizeItemDescription(line.description)
      if (!normalizedDescription) return Promise.resolve()
      return tx.item.upsert({
        where: { tenantId_normalizedDescription: { tenantId, normalizedDescription } },
        update: {
          description: line.description,
          unit: line.unit,
          rate: line.rate,
          useCount: { increment: 1 },
          lastUsedAt: new Date(),
        },
        create: {
          tenantId,
          description: line.description,
          normalizedDescription,
          unit: line.unit,
          rate: line.rate,
        },
      })
    }),
  )
}

export type ItemSuggestion = {
  id: string
  description: string
  unit: string | null
  rate: string
  useCount: number
}

/**
 * Fuzzy recall via pg_trgm, not just `ILIKE '%q%'` — a merchant typo
 * ("tailorng") or a partial word should still surface "Tailoring services".
 * Falls back to plain substring matching in the same query (the `OR ILIKE`
 * arm) so a short, high-signal prefix like "tail" still ranks even when its
 * trigram similarity to the full stored phrase is low. Explicit tenantId
 * filter here is defense-in-depth on top of RLS, same as elsewhere in this
 * codebase — never rely on RLS alone as the only place isolation is
 * expressed.
 */
export async function searchItems(tx: PrismaClient, tenantId: string, query: string, limit = 8): Promise<ItemSuggestion[]> {
  const q = normalizeItemDescription(query)
  if (!q) return []

  return tx.$queryRaw<ItemSuggestion[]>`
    SELECT "id", "description", "unit", "rate"::text AS "rate", "useCount"
    FROM "Item"
    WHERE "tenantId" = ${tenantId}
      AND ("normalizedDescription" ILIKE '%' || ${q} || '%' OR "normalizedDescription" % ${q})
    ORDER BY similarity("normalizedDescription", ${q}) DESC, "useCount" DESC, "lastUsedAt" DESC
    LIMIT ${limit}
  `
}
