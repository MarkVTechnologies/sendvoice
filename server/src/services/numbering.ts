import type { PrismaClient } from '@prisma/client'
import type { DocType } from '@prisma/client'

/**
 * Sequential, gapless numbering per series per fiscal year (PRD §9.4).
 * Must run inside the same transaction as the approval write — never at
 * draft creation, and never outside a transaction (that's how gaps happen
 * under concurrent multi-user issuance).
 */
export async function allocateNumber(
  tx: PrismaClient,
  tenantId: string,
  docType: DocType,
  prefix: string,
  year: number,
): Promise<string> {
  const series = await tx.numberSeries.upsert({
    where: { tenantId_docType_year: { tenantId, docType, year } },
    create: { tenantId, docType, prefix, year, lastSeq: 1 },
    update: { lastSeq: { increment: 1 } },
  })
  const seq = series.lastSeq
  return `${prefix}-${year}-${String(seq).padStart(4, '0')}`
}
