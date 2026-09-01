# Sendvoice

WhatsApp-native invoicing for any business. See the full [development plan](./DEVELOPMENT_PLAN.md) for phasing, architecture decisions, and open questions.

## Structure

```
client/   Installable PWA (Vite + React + TS) — the merchant-facing app
server/   API (Fastify + TS + Prisma/Postgres) — auth, invoices, WhatsApp, payments, jobs
```

Each side is an independent npm project; there is no shared code between them yet (see plan for when/whether a shared `packages/` becomes worth it).

## Local development

### Server

Needs a Postgres database and a Redis instance. This project currently runs against **Neon** (Postgres) and **Upstash** (Redis) — both have real free tiers, so there's nothing to install locally. (Any Postgres/Redis works; swap the connection strings below.)

```
cd server
cp .env.example .env
npm install
```

Then, against your Postgres, as the **owner** role:

```
npx prisma migrate deploy          # creates tables + applies RLS policies
psql "$MIGRATE_DATABASE_URL" -v app_password='<generate one>' -f prisma/create-app-role.sql
```

Put the owner connection string in `MIGRATE_DATABASE_URL` and the `sendvoice_app` role's connection string (same host/db, different user/password) in `DATABASE_URL` — **the app must never connect as the owner role**. See the comments in `.env.example` and `prisma/rls-policies.sql` for why: Postgres doesn't apply RLS to a table's owner, and on Neon the default owner role additionally has `BYPASSRLS`, so nothing short of a separate, unprivileged role actually enforces tenant isolation.

```
npx prisma generate
npm run dev             # http://localhost:4000
```

### Client

```
cd client
npm install
npm run dev              # http://localhost:5173, proxies /api to :4000
```

## Status

Phase 0 scaffold only: PWA shell (manifest, service worker, offline-first IndexedDB outbox), invoice composer UI, Fastify API skeleton, Prisma data model, and the invoice-numbering + tenant-isolation patterns the rest of the product depends on. No business logic, WhatsApp integration, or payment integration is wired up yet — see the plan's Phase 0 checklist for what's next.
