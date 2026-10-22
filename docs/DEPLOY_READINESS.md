# DOOYOOSH — Deploy readiness (checked 2026-10-22 by Architect, updated 23:05 UTC)

Rule: nothing is "done" until its row here is ✅. Each agent updates only its own rows.

## Accounts & services (need Mirfozil)
| Item | Status | Owner |
|---|---|---|
| GitHub repo for dooyoosh (GitHub connector is connected; repo not created yet) | ❌ | Mirfozil + Architect |
| Supabase project `dooyoosh` (ref bmigqxmswskihqrkeezh, eu-central-1, Postgres 17, ACTIVE_HEALTHY, empty) ✅. Keys/DB URL not yet in env ❌. UZ data-localisation law (Art. 27¹) may require UZ hosting — legal check ❌ | Mirfozil |
| Vercel project linked to repo | ❌ | Mirfozil |
| Payment provider account (Stripe if PL/EU entity, Payme/Click if UZ) + API keys + webhook secret | ❌ blocked: business country | Mirfozil |
| Resend account + verified sending domain (DNS) | ❌ | Mirfozil |
| Domain name + DNS access | ❌ | Mirfozil |
| Original logo (SVG or high-res PNG) — only a gallery screenshot exists | ❌ | Mirfozil |
| Rest of brief after "Journal:" | ❌ | Mirfozil |
| Legal pages content (privacy, terms, returns, cookies) | ❌ | Mirfozil |

## Code / repo
| Item | Status | Owner |
|---|---|---|
| Root config: package.json (pnpm, Next 15, React 19, TS strict), tsconfig `@/*`, next.config.ts, eslint/prettier/postcss, .gitignore, `pnpm install` ok, `pnpm typecheck` passes | ✅ 2026-10-22 | Architect |
| Next.js app scaffold (`src/app/[locale]/layout.tsx`, pages, `src/lib/i18n.ts`, tokens) — `pnpm build` cannot pass until this exists | ❌ | Frontend & Design |
| Drizzle schema + 0000_init.sql | ✅ reported | Backend & Database |
| RLS migration, append-only inventory_movements | ❌ | Backend & Database |
| `.env.example` + Zod env validation (`src/lib/env.ts`, refuses `mock` in production/live) | ✅ 2026-10-22 | Architect (per OWNERSHIP.md) |
| API contracts `src/contracts/*` (37 endpoints) + `src/lib/{errors,money,api-client}.ts` + docs/CONTRACTS.md | ✅ 2026-10-22 | Architect |
| Schema review → docs/SCHEMA_DELTA.md (items for Backend & Database) | ✅ 2026-10-22 | Architect |
| CODEOWNERS | ✅ 2026-10-22 | Architect |
| PaymentProvider interface + adapter + webhook | ❌ | Payments & Orders |
| Emails (React Email + Resend) | ❌ | Payments & Orders |
| Tests: concurrency, webhook signature/idempotency, RLS | ❌ | QA & Security |
| CI (GitHub Actions: lint, typecheck, tests) | ❌ | QA & Security |
| git init (branch `main`) + baseline commit, local only | ✅ 2026-10-22 | Architect |
| GitHub repo + first push | ❌ needs Mirfozil's go-ahead to create `dooyoosh` repo | Mirfozil + Architect |

## Tools on the shared computer
node 20 ✅, pnpm ✅, git ✅, gh installed but NOT logged in ❌, psql ❌, supabase CLI ❌, vercel CLI ❌, stripe CLI ❌, docker ❌.

## Required env vars (target)
DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
PAYMENT_PROVIDER, STRIPE_SECRET_KEY / PAYME_* / CLICK_*, PAYMENT_WEBHOOK_SECRET,
RESEND_API_KEY, EMAIL_FROM, NEXT_PUBLIC_SITE_URL, CRON_SECRET.
