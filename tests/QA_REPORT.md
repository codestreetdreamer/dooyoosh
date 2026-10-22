# DOOYOOSH — QA & Security report #1 (2026-10-22, 23:0x UTC)

**What was tested:** `src/server/db/migrations/0000_init.sql` as it was at 00:58 box time (spec v0.3), applied to a fresh, throwaway **local Postgres 17** cluster (`/usr/lib/postgresql/17/bin`, own data dir, port 54329). Supabase roles `anon`/`authenticated`/`service_role` were emulated, with Supabase's default table GRANTs. The real Supabase project was **not touched**.
**Caveat:** Backend is regenerating the migration right now (the `migrations/` dir was briefly missing after the run, and `schema/*.ts` now has `bigint`, `profiles` and `idempotency_key`). Rerun with `cd tests/db && pnpm i && pnpm test`. The harness applies whatever is in `migrations/`, plus `src/server/db/tests/supabase_emulation.sql` if present.

**Result: 99 tests = 59 passed, 15 failed, 25 skipped (blocked).** 2 of the passing tests are HAZARD tests: they pass *because* the hazard exists.

## Passed (actually ran)
- Inventory race, 20 real concurrent connections: last 1 unit → exactly 1 reservation; stock 3 × qty 2 → exactly 1; stock 5 → exactly 5, never oversold; inactive variant never reserved; a naive unguarded UPDATE is rejected by the CHECK (23514).
- Idempotency: `payment_events` PK(provider,event_id); a duplicate insert is a no-op; 10 concurrent identical deliveries → exactly 1 row; the same event_id under payme and click is accepted; a 2nd order for the same checkout is rejected (`orders.checkout_id` UNIQUE); `payments` UNIQUE(provider, provider_payment_id).
- Schema: all 28 spec tables and columns, all 11 enums (incl. `stock_conflict`, provider enum mock/stripe/payme/click), no float or numeric money, no EUR default currency, variant CHECKs and UNIQUEs, orders reference/checkout_id UNIQUE, checkouts UNIQUE(provider, provider_session_id).

## Defects
| ID | Sev | Agent | Issue | Repro | Status |
|---|---|---|---|---|---|
| QA-01 | P0 | Backend & Database | RLS is OFF on **all 29** public tables and 0 policies exist (spec §2, §12.6) | `rls.test.js` "every public table has RLS enabled" | Open (planned RLS migration) |
| QA-02 | P0 | Backend & Database | With Supabase default grants, `anon` can read `orders` (PII), set `product_variants.stock_reserved=0`, read draft products, and insert fake `payment_events` (which pre-empts a real callback → payment never processed) | `rls.test.js` anon tests | Open (fixed by QA-01 + REVOKE) |
| QA-03 | P0 | Backend & Database | `authenticated` can `INSERT INTO admin_users(id,role) VALUES (auth.uid(),'owner')`, so anyone can self-promote to admin | `rls.test.js` "cannot self-assign admin role" | Open |
| QA-04 | P1 | Backend & Database | `inventory_movements` is not append-only: UPDATE/DELETE succeed for every role (spec §12.5) | `rls.test.js` append-only tests | Open |
| QA-05 | P1 | Backend & Database | SECURITY DEFINER stock functions (`reserve_checkout`, `convert_checkout_to_order`, `release_checkout`, `release_expired_reservations`, `adjust_stock`) don't exist. The test also checks `search_path=''` and that only service_role has EXECUTE | `schema.test.js` §12.5 | Open (pending) |
| QA-06 | P1 | Backend & Database → Payments & Orders | HAZARD: late convert after A's reservation expired and B re-reserved: blindly running `on_hand-=1, reserved-=1` **steals B's unit, and the CHECK does not catch it**. `convert_checkout_to_order` must lock and check `stock_reservations.status='active'` for that checkout, never the variant counters alone | `inventory-race.test.js` HAZARD test 2 | Open: needs function + test |
| QA-07 | P1 | Payments & Orders (validation) / Backend (function) | HAZARD: the spec's reservation UPDATE accepts `qty=-1` and decrements `stock_reserved` (frees others' reservations). Need Zod `int().min(1)` + a guard in `reserve_checkout` | `inventory-race.test.js` HAZARD test 1 | Open |
| QA-08 | P1 | Backend & Database | UZS in tiyin overflows int4 above **21,474,836 so'm**: `checkouts/orders.subtotal_cents,total_cents`, `payments.amount_cents` were `integer` | `schema.test.js` "UZS headroom" | Probably being fixed (`bigint` now imported in orders.ts); re-verify |
| QA-09 | P2 | Backend & Database | `stock_reservations` has no UNIQUE(checkout_id, variant_id), so a retried checkout can double-reserve | `schema.test.js` | Open |
| QA-10 | P2 | Backend & Database | `admin_users.id` has no FK to `auth.users` (the comment says a hand-written migration adds it; it doesn't exist) | `schema.test.js` | Open |
| QA-11 | P2 | Backend & Database | `refunds.provider_refund_id` UNIQUE is global and `refunds` has no `provider`, so Payme and Click refund ids can collide | `webhook-idempotency.test.js` | Open |
| QA-12 | P2 | Backend & Database | No public views with `security_invoker=on` exist (spec §12.6) | `schema.test.js` | Open (pending) |
| QA-13 | P2 | Architect | Spec §3 line 72 still says `payments.provider 'stripe'` and §4/§5 still say Stripe PaymentIntent / `/webhooks/stripe`, which contradicts §12 (UZ, Payme/Click) | read docs | Open |

## Blocked (skipped placeholders in `tests/db/blocked.test.js`, exact assertions written)
There is no app, API routes, checkout/payments/orders code, or callback handlers yet:
- Checkout tampering (client price ignored, qty ≤0, unknown/inactive variant, duplicate lines, non-shippable country, PRICE_CHANGED with `details.variantIds`, reservation before redirect with 35-min expiry).
- Payme: Basic auth (-32504), Check only verifies reservation active + amount (tiyin), amount mismatch (-31001), CreateTransaction idempotent, Perform after 35-min expiry returns error, Perform replay is idempotent, Cancel after Perform restores stock with `inventory_movements.reason='return'`.
- Click: `sign_string` check, Prepare only verifies, Complete after expiry returns error, duplicate Complete.
- API authz (401/403 role matrix, guest order token → 404, cron secret), success page never marks paid.
- Responsive/e2e (Playwright, 4 viewports, axe, UZS format, countdown, 409 UX).

## Files
`tests/db/` (own package.json: vitest + pg), `tests/QA_REPORT.md`, `.github/workflows/ci.yml` (none existed; runs only tests/db).
