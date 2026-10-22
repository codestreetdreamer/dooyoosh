# DOOYOOSH — File ownership (binding, v1, 2026-10-22)

Only the owner edits a path. Others open a request in the Dooyoosh group chat (or a PR the owner reviews).
`src/contracts/**` changes need Architect approval — it is the integration boundary.

| Path | Owner |
|---|---|
| `docs/**`, `src/contracts/**`, `CODEOWNERS`, root config (`package.json` deps, `tsconfig.json`, `next.config.ts`, `.env.example`, `src/lib/env.ts`, `src/lib/errors.ts`, `src/lib/money.ts`) | Architect |
| `src/server/db/**` (schema, migrations, RLS SQL, seed), `drizzle.config.ts` | Backend & Database |
| `src/server/catalog/**`, `src/server/inventory/**` (except reservation convert/release called by orders), `src/server/journal/**`, `src/server/auth/**`, `src/server/media/**` | Backend & Database |
| `src/app/api/v1/products/**`, `categories/**`, `search/**`, `articles/**`, `newsletter/**`, `cart/**`, `shipping/**` | Backend & Database |
| `src/app/api/v1/admin/{products,variants,articles,media}/**` | Backend & Database |
| `src/server/checkout/**`, `src/server/orders/**` (incl. `transitions.ts`), `src/server/payments/**` (`provider.ts`, adapters, `mock.ts`), `src/server/shipping/**`, `src/server/email/**`, `src/emails/**` | Payments & Orders |
| `src/app/api/v1/checkout/**`, `orders/**`, `webhooks/**`, `cron/**`, `admin/{orders,shipments}/**`, `admin/variants/[id]/adjust` | Payments & Orders |
| `src/app/[locale]/**`, `src/app/admin/**` (UI pages only), `src/components/**`, `src/styles/**`, `src/messages/**`, `src/lib/i18n.ts`, `public/**` | Frontend & Design |
| `tests/**`, `playwright.config.ts`, `vitest.config.ts`, `.github/workflows/**`, `docs/THREAT_MODEL.md` | QA & Security |

## Integration rules
1. Frontend calls the API only through `src/lib/api-client.ts` (Architect) typed by `src/contracts`.
2. Route handlers are thin: `parse(contract) -> service -> respond(contract)`; errors via `src/lib/errors.ts`.
3. Services never import from `src/app`. `src/app` never imports `src/server/db`.
4. Payments & Orders calls inventory only through `src/server/inventory/reservations.ts` exported functions: `reserve`, `convert`, `release` (Backend implements, signatures fixed in `src/contracts/inventory.ts`).
5. Branches: `feat/<area>-<topic>`; PR to `main`; CI must pass; QA & Security reviews anything under payments, checkout, webhooks, auth, RLS.
