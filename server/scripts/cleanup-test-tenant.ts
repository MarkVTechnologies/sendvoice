import 'dotenv/config'
import { withTenant } from '../src/lib/prisma.js'

const tenantId = process.argv[2]
if (!tenantId) {
  console.error('usage: tsx scripts/cleanup-test-tenant.ts <tenantId>')
  process.exit(1)
}

async function main() {
  await withTenant(tenantId, async (tx) => {
    const documentIds = (await tx.document.findMany({ where: { tenantId }, select: { id: true } })).map(
      (d) => d.id,
    )
    await tx.documentEvent.deleteMany({ where: { documentId: { in: documentIds } } })
    await tx.delivery.deleteMany({ where: { documentId: { in: documentIds } } })
    await tx.payment.deleteMany({ where: { documentId: { in: documentIds } } })
    await tx.documentLine.deleteMany({ where: { documentId: { in: documentIds } } })
    await tx.document.deleteMany({ where: { tenantId } })
    await tx.customer.deleteMany({ where: { tenantId } })
    await tx.user.deleteMany({ where: { tenantId } })
    await tx.numberSeries.deleteMany({ where: { tenantId } })
    await tx.tenant.delete({ where: { id: tenantId } })
  })
  console.log('deleted tenant', tenantId)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
