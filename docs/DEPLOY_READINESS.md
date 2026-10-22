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
| Drizzle schema + 0000_init.sql (31 tables, B1–B16, B18–B22) | ✅ 2026-10-22, applied to staging bmigqxmswskihqrkeezh | Backend & Database |
| Migrations 0001_security_core, 0002_stock_order_functions, 0003_rls_policies, 0004_storage_media (RLS on all tables, append-only inventory_movements, SECURITY DEFINER stock/order fns, bucket product-images) | ✅ 2026-10-22, applied to staging; advisors: security only INFO rls_enabled_no_policy (intentional, server-only tables), performance only INFO unused_index (empty DB) | Backend & Database |
| Seeds: reference (UZ/UZS, PLACEHOLDER shipping) + DEMO catalogue (12 products, 4 articles; removable via seed/cleanup_demo.sql) | ✅ applied to staging; DEMO data must be removed before launch ❌; demo product images not uploaded ❌ | Backend & Database |
| DB tests (src/server/db/tests: RLS, functions, concurrency) | ✅ local all pass; RLS + functions also pass on staging (rolled back) | Backend & Database |
| docs/DATABASE.md, src/server/db/supabase.types.ts | ✅ 2026-10-22 | Backend & Database |
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
