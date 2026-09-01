# Sendvoice — Development Plan

Derived from the PRD (v1.0, 18 Aug 2026). This plan translates the PRD's roadmap (§14) into concrete engineering work, states the architecture decisions the PRD leaves implicit, and flags every `[OPEN]` item that blocks a later phase.

## 0. Repo structure (decided, scaffolded)

```
client/   Vite + React + TS PWA — offline-first, IndexedDB outbox, service worker
server/   Fastify + TS API — Prisma/Postgres (RLS), Redis/BullMQ job queue
```

Kept as two independent deployables, not a Next.js monolith: the PRD requires an installable, offline-first client with a hard 180KB JS budget and a server that owns durable jobs, PDF rendering, webhooks, and multi-tenant RLS. Coupling those into one framework's request lifecycle fights both requirements. A `packages/shared` (types, zod schemas) is worth adding once the API contract stabilizes — not before, since premature sharing between a repo-per-side setup just adds build wiring.

## 1. Architecture decisions locked in now

| Decision | Choice | Why |
|---|---|---|
| Client | React + Vite, `vite-plugin-pwa`, IndexedDB via `idb` | PRD §9.1 P0 performance budget (≤180KB JS gzip, LCP<2.5s/3G) rules out heavier frameworks; PWA plugin gives Workbox precaching for free |
| Offline state | IndexedDB = cache only; outbox queue flushed on foreground/online, never on Background Sync | PRD §9.1 explicit: iOS has no Background Sync, storage can be evicted — server confirmation is the only durable state |
| API | Fastify + TypeScript | Stateless HTTP + webhook receivers per §9.2; low overhead, first-class TS support |
| DB | Postgres, row-level security, Prisma as query layer | §9.2/§12 P0: tenant isolation enforced at the DB, not app code. RLS policies are raw SQL (`prisma/rls-policies.sql`) applied as a tracked migration — Prisma's schema DSL can't express RLS |
| DB/Redis hosting | Neon (Postgres) + Upstash (Redis), free tier | No local install path was viable this session (disk constraints); both have real free tiers with no card required. Either can be swapped for anything else later — nothing in the code is Neon/Upstash-specific |
| DB roles | App connects as a separate, unprivileged `sendvoice_app` role; migrations run as the owner | **Verified the hard way**: Postgres never applies RLS to a table's owner, and Neon's default owner role additionally has `BYPASSRLS` — no `FORCE ROW LEVEL SECURITY` can override that. If the app ever connects as the owner, tenant isolation silently does nothing. See `prisma/create-app-role.sql` |
| Jobs | Redis + BullMQ | §9.2 durable queue for sends/retries/reminders/webhooks; idempotency keys per send (§9.5) |
| PDF rendering | Server-side headless browser render → immutable, content-addressed object storage | §9.2 P0: client-side PDF generation is explicitly rejected — device-dependent output is a support and audit problem |
| Invoice numbering | Allocated inside the approval DB transaction only, via `NumberSeries` upsert-and-increment | §9.4 — the single hardest edge case in the PRD; drafts never carry a real number |
| Tenant creation | Client (server-side) pre-generates the tenant's id and sets `app.tenant_id` to it *before* the insert | **Verified the hard way**: `INSERT ... RETURNING` is subject to the SELECT policy too, not just `WITH CHECK` — a brand-new row can't satisfy `id = current_setting('app.tenant_id')` unless that's set first. A permissive `tenant_bootstrap_insert` policy (`WITH CHECK true`) covers tooling/admin paths that don't pre-know the id, but the signup path should use the pre-generated-id pattern, not rely on it |
| Auth | Phone + WhatsApp/SMS OTP, JWT | §8.1 P0 — no email/password |
| Login lookup | A `SECURITY DEFINER` Postgres function (`resolve_user_by_phone`), not a loosened RLS policy | Finding which tenant a phone belongs to is inherently cross-tenant, which RLS correctly blocks for the app role. A narrow, owner-defined function that returns only `(user_id, tenant_id)` for one phone is the standard-pattern fix — a permissive `SELECT` policy would expose every user row whenever `app.tenant_id` is unset |

## 2. Phase plan

Phases mirror PRD §14 exactly; each adds an engineering breakdown and an explicit exit gate.

### Phase 0 — Foundations (weeks 1–6)
**Exit criterion (PRD): TTFI < 90s with 10 real merchants.**

Scaffolded this session:
- [x] Client PWA shell — manifest, service worker (stale-while-revalidate), Tailwind, router
- [x] Offline-first primitives — IndexedDB store, outbox queue, connectivity watcher
- [x] Invoice composer UI (lines, live totals, approve action wired to outbox)
- [x] Fastify API skeleton — health, auth (OTP stub), invoices (approve stub), webhooks (stub)
- [x] Prisma data model — Tenant, User, Customer, Document/DocumentLine, NumberSeries, TaxProfile, Delivery, Payment, WabaConnection/Template, SendCostLedgerEntry
- [x] RLS policy set (`prisma/rls-policies.sql`) + `withTenant()` transaction wrapper
- [x] Invoice-numbering service (`allocateNumber`)
- [x] Durable job queue wiring (BullMQ + Redis, send-worker stub)
- [x] Live Postgres (Neon) + Redis (Upstash) provisioned, migrations applied, RLS verified against real cross-tenant reads/writes

- [x] OTP verify → real Tenant/User upsert → JWT with `{userId, tenantId, phone}`, exercised end-to-end against Neon (login path confirmed to resolve the *same* identity on a second sign-in, not create a duplicate)
- [x] `/invoices/:draftId/approve` creates a real, numbered `Document` + `DocumentLine`s (not just a number) — server computes totals from the submitted lines rather than trusting a client-supplied figure, inline customer creation dedupes on `(tenantId, whatsapp)` (a repeat customer's second invoice reuses the same `Customer` row and keeps the original name, PRD §8.2 P1). Exercised end-to-end: two invoices for one customer produced `INV-2026-0001`/`-0002`, correct totals, correct dedup, and `GET /invoices` returns both, tenant-isolated by RLS

- [x] Client wired to the real API end-to-end: onboarding (phone → OTP → JWT, stored via zustand+localStorage) → composer (real approve call, real server-computed total, real allocated number) → dashboard (real invoice list, real outstanding total). Route guards redirect an unauthenticated visit from `/` or `/dashboard` to `/onboarding`; a `401` mid-session clears the stored token instead of surfacing a confusing error. Verified by actually driving it in Chrome, not just curl — full signup → invoice → dashboard, landing on the composer (not a dashboard) exactly as PRD §6.1 J1 specifies
- [x] Outbox flush wired up — `enqueue()` existed from the initial scaffold but nothing ever called `flushOutbox()`; it's now triggered on mount and on reconnect (PRD §9.1/9.3)

Remaining before the exit gate:
- [ ] Real OTP delivery (WhatsApp utility template + SMS fallback) — currently logs the code server-side since no BSP is wired up yet (Open Decision #1); `/auth/otp/request` is not safe to expose publicly until that lands
- [ ] Full onboarding fields (logo, currency/country auto-detect, tax setting) — currently only phone + business name; country/currency default to NG/NGN server-side
- [ ] Draft persistence: local ULID drafts in IndexedDB, server-side draft staging so a merchant's approval can survive a lost connection mid-request (today the full draft payload travels in the approve request body — fine online, not yet offline-safe)
- [ ] Tax computation: `taxTotal` is hardcoded to 0 until a tenant has a configured, versioned `TaxProfile` to pin the invoice to (PRD §7.4) — computing a number without one would be a guess presented as a real figure on a financial document
- [ ] PDF render pipeline: headless-browser template → object storage, 3–4 template designs (PRD §8.5)
- [ ] Rail A delivery: `wa.me` deep link + Web Share Target, pre-filled message with hosted invoice link
- [ ] Hosted invoice page: separate, server-rendered, ≤60KB critical path, works with JS disabled, tokenised/expiring URL (this is **not** part of the client SPA — build as a lean server-rendered route)
- [ ] Android `beforeinstallprompt` deferred until first successful send; iOS explicit install-education screen (no native prompt exists)
- [ ] Contact Picker API integration with manual fallback
- [ ] Item catalogue auto-save with fuzzy recall
- [ ] Country-seeded tax profiles (start with launch market — see §11.6 decision below)
- [ ] Instrumentation for TTFI itself (can't hit the exit gate without measuring it)

### Phase 1 — Get paid (weeks 7–12)
**Exit criterion (PRD): 20% of invoice value collected in-app across the pilot cohort.**

- [ ] Payment provider integration for launch market (Paystack/Flutterwave if Nigeria — see §5 decision below), redirect/hosted-field only, no raw card data (PCI scope minimisation, §12 P0)
- [ ] Payment webhook handlers → `Payment` row + `Document.status` transition, idempotent by provider event id
- [ ] Manual payment recording (cash/transfer), partial-payment support
- [ ] Basic dashboard (outstanding, overdue, paid this month, sent count)
- [ ] One export format (CSV first — cheapest, covers accountant handoff)
- [ ] Bank transfer instructions block on PDF with copy-to-clipboard account number

### Phase 2 — Rail B (weeks 13–20)
**Exit criterion (PRD): 97% delivered-rate, positive contribution margin per paying merchant.**

- [ ] BSP integration (see Open Decision #1 below — this blocks the phase start)
- [ ] Embedded Signup flow (Meta Tech Provider program), per-merchant WABA provisioning
- [ ] Coexistence support (keep WhatsApp Business app working on the same number)
- [ ] Template management surface: submit, status (submitted/approved/rejected/paused), plain-language rejection reasons, one-tap resubmit — needed at merchant-count scale, not support-ticket scale
- [ ] Core templates: `invoice_new`, `invoice_reminder_due`, `invoice_reminder_overdue`, `payment_received`, `quote_new` — all utility category, all reference a specific transaction
- [ ] Delivery webhooks → `Delivery` status transitions (sent/delivered/read)
- [ ] Per-tenant, per-market send-cost ledger (`SendCostLedgerEntry`) — **build this now, not later**; nothing about paid-tier pricing works without it
- [ ] Quality-rating monitoring per tenant, auto-pause reminder sequences on a red rating
- [ ] Consent capture (opt-in timestamp + source per customer), instant/permanent opt-out honoured platform-wide
- [ ] Velocity limits, new-account send caps, content heuristics on line-item text, rapid-suspension path — **P0, ship before public launch** (PRD §12): one spam incident risks Tech Provider standing
- [ ] Paid tiers live (Starter/Business/Pro), region-adjusted pricing, credit bundles with graceful degrade-to-Rail-A on exhaustion (never hard-stop a send)
- [ ] Model both pre- and post-1-Oct-2026 WhatsApp cost curves before finalizing bundle pricing (§10.4)

### Phase 3 — Automation & retention (weeks 21–28)
**Exit criterion (PRD): week-4 retention ≥ 35%, free→paid ≥ 6%.**

- [ ] Recurring invoice schedules
- [ ] Reminder sequences (pre-due, due-date, overdue), pausable per invoice
- [ ] Quotes with accept/decline, quote→invoice conversion preserving audit link
- [ ] Multi-user roles (Owner/Editor/Viewer/Accountant) + approval workflow
- [ ] Accountant seat/portal — pull forward from here if pilot data supports it (Open Decision #4)
- [ ] Conversion-trigger instrumentation (§11.4): 15+/week → Rail B prompt, 3+ overdue → reminders prompt, repeat customer 3mo → recurring prompt, compliance deadline → pack prompt, second invite → multi-user prompt

### Phase 4 — Compliance & scale (weeks 29–40)
**Exit criterion (PRD): compliance pack live ahead of enforcement deadline; second market launched.**

- [ ] Nigeria e-invoicing (MBS/NRS): accredited Access Point Provider integration, IRN + CSID + QR on rendered PDF — data model already supports this (`TaxProfile` versioning, `Document.number` immutability); confirm current phase dates with the Nigeria Revenue Service before committing sprint capacity (PRD explicitly flags this has already slipped)
- [ ] Second market launch (Kenya, Ghana, India, Indonesia, Brazil, or Philippines per §11.6)
- [ ] Reporting depth (revenue over time, top customers, tax collected/withheld, aged receivables)
- [ ] Public API access (Pro tier)

## 3. Cross-cutting, start-of-project requirements (not phase-boxed)

These are called out as P0/day-one in the PRD and are easy to defer by accident because no single phase "owns" them:

- **Send-cost ledger** — §10.4, explicitly "not a v2 feature." Build the table and write path in Phase 0/1 even though Rail B doesn't ship until Phase 2, so cost data exists before pricing decisions are made.
- **Audit log** — every state transition on an approved document (`DocumentEvent`), from Phase 0.
- **Abuse/spam controls** — must exist before *any* public Rail B usage, i.e., before Phase 2 ships, not after.
- **Tax profile versioning** — historical invoices must never re-render with new rates; the schema already versions this, but the render pipeline must pin to the version at issue time.
- **GDPR/NDPR** — data export, right to erasure with a statutory-retention carve-out (5–7 years), processor/controller split, DPA. Slot into Phase 1 or 2 depending on launch market's regulatory timeline.

## 4. Open decisions that block downstream work

Carried from PRD §15/§10.1, ranked by how soon they block something:

1. **BSP selection (360dialog / Twilio / Telnyx)** — blocks Phase 2 start entirely. PRD recommends starting with a BSP and re-evaluating direct Cloud API at ~50k sends/month. *Needs a decision before Phase 2 planning begins*, since template management and Embedded Signup integration code differs per BSP.
2. **Launch market** — PRD recommends Nigeria (§11.6: WhatsApp penetration + active e-invoicing forcing function + local payment rails). This determines: which PSP to integrate first in Phase 1 (Paystack/Flutterwave), which tax profile to seed first, and the Phase 4 compliance target. *Needs confirming before Phase 1 payment integration starts.*
3. **Free-tier branding footer impact on corporate-facing merchants** — test in pilot, doesn't block build, affects Phase 3 conversion-trigger tuning.
4. **Accountant portal timing** — Phase 3 as planned, or pulled forward if the pilot shows the channel is as strong as the PRD expects (§5.3 calls it "the single highest-leverage distribution channel").
5. **Offline approval with reserved number blocks** — the PRD frames this as a possible complexity trap. Recommendation: **do not build in Phase 0**; instrument how often merchants actually queue while offline first (the outbox already captures this — surface it as a metric), then decide.
6. **v1 language scope** — doesn't block the composer (already language-agnostic), but blocks PDF template and tax-terminology work in Phase 0/1. Needs a decision before template design starts in earnest.

## 5. Metrics to instrument from Phase 0 (not bolted on later)

Per PRD §4.3, these need event tracking wired in from the first merchant, not retrofitted:
TTFI (signup → first send), session-1 activation rate, week-4 retention, WhatsApp delivered/read rates (Phase 2+), free→paid conversion, % invoice value collected in-app, days-to-payment (self-reported baseline vs. app), blended WhatsApp COGS per paying merchant, viral coefficient (recipient→signup attribution — needs the hosted invoice page's footer CTA wired to signup source from day one).

## 6. What this session scaffolded vs. what's still design work

**Scaffolded and verified working, in a real browser against a live database** — not just curl: signup (phone → OTP → business name) → composer (lands there, not a dashboard, per PRD §6.1 J1) → Approve & Send → `INV-2026-0001` with a server-computed total → Dashboard showing the real outstanding total and the invoice in "Recent." All of it tenant-isolated by RLS, confirmed against real cross-tenant reads. Along the way: fixed a port collision with an unrelated project on the same dev machine (both defaulted to 4000 — moved to 4177) and replaced a catch-all error handler that was misreporting network failures as "wrong code."

**Deliberately not built yet** (these are Phase 0 remaining-work items above, not oversights): real OTP delivery (currently server-logs the code — no BSP wired up), tax computation (no `TaxProfile` wired to onboarding yet, so `taxTotal` is 0 rather than a guess), PDF rendering, hosted invoice page, any WhatsApp or payment integration, full onboarding fields (logo, currency/country, tax setting), and offline-safe draft staging.
