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

If your provider (Neon included) offers both a pooled and a direct connection endpoint, **`DATABASE_URL` needs the pooled one** — `MIGRATE_DATABASE_URL` is the one that needs direct, for Prisma Migrate's session mode. Getting this backwards doesn't error; it makes requests hang indefinitely once a few are in flight, which is a much worse thing to debug in production than at setup time.

```
npx prisma generate
npm run dev             # http://localhost:4177
```

Port is `4177`, not the more obvious `4000` — on a shared dev machine `4000` is a common default other projects also reach for, and cross-project port collisions there are a real thing we hit. Change `PORT` in `.env` if you need to.

PDF rendering needs Chrome installed locally (`CHROME_PATH` in `.env.example`, defaults to the standard Windows path) — see the note in `src/services/pdf.ts` for why the launch target is a dev shortcut, not a production setup. Chrome itself is launched once and reused across requests (not relaunched per call), so only the very first `/invoices/:id/approve` after a server start pays the ~10-14s cold-launch cost; subsequent approvals measured ~7s, dominated by DB round-trips to Neon rather than the browser. A real deployment still wants a small render pool with queueing rather than a single shared instance.

### Client

```
cd client
npm install
npm run dev              # http://localhost:5173, proxies /api to :4177
```

Sign-up/login is real (OTP → JWT, stored in localStorage): with no BSP wired up yet (Phase 2), `/auth/otp/request` returns the code directly in the response outside production (`devCode`) and the onboarding screen surfaces it — that's dev-only and must not ship.

Approving an invoice opens WhatsApp automatically with the invoice pre-filled (Rail A) — the link inside points at a public hosted page (`GET /i/:token`, no login) served directly by the server, not the client SPA.

Onboarding collects country (real auto-detect via `Intl.Locale`), currency, a tax setting — "I don't charge tax" is the default, first-class option — and an optional logo. A merchant who charges tax gets a real computed total, not a guess: approval pins the invoice to a versioned `TaxProfile`. A logo shows up in both the PDF and the hosted invoice page, embedded as a `data:` URI rather than served from a separate route — both render server-side with the full `Tenant` already in hand.

The composer autosaves to IndexedDB (PRD §8.4) — a lost connection or closed tab mid-edit doesn't lose the draft. Approval is idempotent by `draftId`: a retried request (flaky connection, the outbox flush) returns the original invoice instead of creating a duplicate.

Every approved line item is upserted into a real, per-tenant item catalogue (PRD §8.3) — the next time a merchant starts typing a description they've used before, the composer suggests it back (fuzzy, via Postgres `pg_trgm`, so a typo still matches) and picking one fills in the description and rate. A dedicated `/items` view lets a merchant see and prune what's accumulated.

Hosted invoice links are revocable (PRD §12) — the dashboard's "Revoke link" control mints a fresh token and kills the old one immediately, so an already-shared link stops working the moment a merchant asks it to.

The composer collects an optional due date, and the dashboard's Overdue total and per-invoice badges are real, computed from it — not permanently placeholder like they were before.

## Status

Phase 0, in progress. Working end-to-end today: signup (phone → OTP → business name, logo, country/currency, tax setting) → invoice composer, autosaved → approval (real allocated number, real tax-inclusive total, inline customer creation with WhatsApp dedup, a real rendered PDF, idempotent by draftId) → WhatsApp opens with the invoice pre-filled → the hosted link opens a real public page, logo included → dashboard (real outstanding total, real invoice list, opens the PDF). All of it tenant-isolated by Postgres RLS, verified against real cross-tenant reads. Run it and click through it — it works.

The PRD's own Phase 0 exit gate is TTFI < 90s, so a tenant's first approval logs a real `ttfiMs` (`Tenant.createdAt` → that invoice's `approvedAt`, server-computed, only on the first invoice ever). A real browser-driven run of the full signup-to-first-send path measured 23.3s.

Not yet built: real OTP delivery over WhatsApp (needs a BSP — Phase 2), tax modes beyond none/single-rate-exclusive, Pay Now on the hosted page (needs Phase 1's payment integration), Rail B, and real object storage for PDFs (currently in Postgres). See [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) for the complete checklist.
