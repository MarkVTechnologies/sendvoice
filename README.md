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
npm run dev             # http://localhost:4177
```

Port is `4177`, not the more obvious `4000` — on a shared dev machine `4000` is a common default other projects also reach for, and cross-project port collisions there are a real thing we hit. Change `PORT` in `.env` if you need to.

PDF rendering needs Chrome installed locally (`CHROME_PATH` in `.env.example`, defaults to the standard Windows path) — see the note in `src/services/pdf.ts` for why this is a dev shortcut, not a production setup. Expect ~10s on `/invoices/:id/approve`, dominated by launching a fresh browser per request; a real deployment should keep a warm instance rather than cold-launching Chrome on every call.

### Client

```
cd client
npm install
npm run dev              # http://localhost:5173, proxies /api to :4177
```

Sign-up/login is real (OTP → JWT, stored in localStorage): with no BSP wired up yet (Phase 2), `/auth/otp/request` returns the code directly in the response outside production (`devCode`) and the onboarding screen surfaces it — that's dev-only and must not ship.

## Status

Phase 0, in progress. Working end-to-end today: signup (phone → OTP → Tenant/User created) → invoice composer → approval (real allocated number, server-computed total, inline customer creation with WhatsApp dedup, a real rendered PDF) → dashboard (real outstanding total, real invoice list, opens the PDF). All of it tenant-isolated by Postgres RLS, verified against real cross-tenant reads. Run it and click through it — it works.

Not yet built: real OTP delivery over WhatsApp (needs a BSP — Phase 2), the hosted invoice page, Rail A/B delivery, payments, real object storage for PDFs (currently in Postgres), and full onboarding (logo, currency/country auto-detect, tax setting). See [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) for the complete checklist.
