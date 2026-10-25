# DOOYOOSH

Premium fashion journal and EU-facing e-commerce storefront, operated by a **Uzbekistan merchant** (UZS, Payme/Click behind a `PaymentProvider` interface). Guest checkout in v1; admin for catalog, journal, orders, and fulfilment.

This is the monorepo root. Agents own paths per [`docs/OWNERSHIP.md`](docs/OWNERSHIP.md). Binding design lives in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Stack

| Layer | Choice |
|---|---|
| App | Next.js 15 (App Router), React 19, TypeScript strict |
| UI | Tailwind CSS v4, Radix, next-intl (`/en/...`) |
| DB / Auth / Storage | PostgreSQL 17 on Supabase (EU Frankfurt staging), Drizzle + SQL migrations |
| Contracts | Zod in `src/contracts` |
| Payments | `mock` \| `payme` \| `click` (Stripe enum only; UZ entity cannot onboard Stripe) |
| Email | Resend + React Email |
| Host | Vercel (app) + Supabase |
| Tooling | **pnpm**, **Node 20** LTS, Vitest, Playwright, ESLint, Prettier |

## Layout

```
dooyoosh/
  docs/                 Architecture, contracts, ownership, deploy readiness, payments UZ
  src/
    app/                Storefront, journal, admin UI, thin `/api/v1/*` handlers
    contracts/          Zod API schemas (Architect)
    server/             Domain services (db, catalog, inventory, checkout, orders, payments, …)
    components/ lib/ styles/ emails/ messages/
  tests/                Unit, API, e2e (QA); `tests/db` is its own package
  .env.example          All env vars — copy to `.env.local`, never commit secrets
```

Feature work uses **git worktrees** off this repo (e.g. `feat/db`, `feat/payments`, `feat/frontend`, `feat/qa`). Do not edit another agent's owned paths; open a request in the Dooyoosh group chat.

## Run locally

```bash
# Node >= 20.11 < 21 (or >= 22), pnpm >= 10
pnpm install

cp .env.example .env.local
# Fill DATABASE_URL / Supabase keys for real DB work.
# Default PAYMENT_PROVIDER=mock, PAYMENT_MODE=sandbox.

pnpm dev          # http://localhost:3000
pnpm build
pnpm typecheck
pnpm lint
pnpm test         # root Vitest
```

**Database:** point `DATABASE_URL` at local Postgres 17 or the staging Supabase project. Migrations live under `src/server/db` (Backend owns them). Apply with the Backend harness / `drizzle-kit` — do not invent a second migration path.

**Payments tests** (Payments & Orders):

```bash
# memory store (no DB)
pnpm exec vitest run --config src/server/payments/vitest.config.ts

# Postgres store (needs a DB with migrations 0000–0009 + seed)
PAYMENTS_TEST_DATABASE_URL=postgresql://... pnpm exec vitest run --config src/server/payments/vitest.config.ts
```

**DB / RLS suite** (QA, throwaway PG recommended):

```bash
cd tests/db && pnpm install && pnpm test
```

**HTTP API suite** (QA): `tests/run-api.sh` with `PAYMENTS_TEST_DATABASE_URL` (see QA notes; some failures are still owned by QA — see [`docs/RELEASE_REPORT.md`](docs/RELEASE_REPORT.md)).

## Docs

| Doc | Purpose |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Binding stack, data model, checkout flow, open decisions |
| [`docs/CONTRACTS.md`](docs/CONTRACTS.md) | API contracts |
| [`docs/OWNERSHIP.md`](docs/OWNERSHIP.md) | Who may edit which paths |
| [`docs/DEPLOY_READINESS.md`](docs/DEPLOY_READINESS.md) | Account / code checklist |
| [`docs/PAYMENT_PROVIDERS_UZ.md`](docs/PAYMENT_PROVIDERS_UZ.md) | Payme/Click/Octo research for UZ merchants |
| [`docs/RELEASE_REPORT.md`](docs/RELEASE_REPORT.md) | Sprint status (2026-10-25) |

## Payments: sandbox vs live (P0)

- **Sandbox / demo:** `PAYMENT_MODE=sandbox` (and usually `PAYMENT_PROVIDER=mock`). Mock in a production build is allowed **only** with `ALLOW_MOCK_IN_PRODUCTION=true` and never with `PAYMENT_MODE=live`.
- **Live money:** `PAYMENT_MODE=live` + real Payme/Click credentials + merchant eligibility (YaTT/MChJ, settlement account, IKPU, fiscal). Refused otherwise.
- The **success redirect is not payment proof**. Only a verified provider webhook/callback (Perform/Complete) marks an order paid.
- Never claim the shop accepts live cards until providers and legal blockers in the release report are cleared.

## Secrets

Copy `.env.example` → `.env.local`. **Never commit** real keys, service-role tokens, webhook secrets, or `NEWSLETTER_HASH_SECRET` / `ORDER_TOKEN_SECRET`. Production requires `NEWSLETTER_HASH_SECRET` (32+ chars); boot must fail without it.

## Branches / remote

Local branches of record (integration trial-2 tips): see [`docs/RELEASE_REPORT.md`](docs/RELEASE_REPORT.md). Remote: [github.com/codestreetdreamer/dooyoosh](https://github.com/codestreetdreamer/dooyoosh). First push waits on `gh` auth for the Architect box — do not force-push agent worktrees.
