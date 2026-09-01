import 'dotenv/config'
import { withTenant } from '../src/lib/prisma.js'

const tenantId = process.argv[2]
if (!tenantId) {
  console.error('usage: tsx scripts/cleanup-test-tenant.ts <tenantId>')
  process.exit(1)
}

async function main() {
  await withTenant(tenantId, async (tx) => {
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
