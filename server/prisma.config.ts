import 'dotenv/config'
import { defineConfig } from 'prisma/config'
import { PrismaPg } from '@prisma/adapter-pg'

// Prisma 7 config: connection URL lives here (not in schema.prisma).
// Migrations run as the DB owner (DDL privileges); the app connects with a
// separate, unprivileged role at runtime — see src/lib/prisma.ts and the
// comment on DATABASE_URL / MIGRATE_DATABASE_URL in .env.example.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.MIGRATE_DATABASE_URL!,
  },
  migrations: {
    adapter: () => new PrismaPg({ connectionString: process.env.MIGRATE_DATABASE_URL! }),
  },
})
