# DOOYOOSH — Schema delta for migration 0001 (Architect review, 2026-10-22)

Owner of the fix: **Backend & Database** (Architect does not edit `src/server/db/**`).
Baseline reviewed: original `0000_init.sql` (28 tables). Target: ARCHITECTURE.md v0.3 §12 + `src/contracts/*`.
"WT" = already in the working tree of `src/server/db/schema/*.ts` (seen 01:01); still needs to land in a generated migration + snapshot.
Update 01:03: Backend & Database regenerated `0000_init.sql` (29 tables, DB is empty so the §12 column changes A1–A7 are folded into 0000) and is scaffolding `0001_security_core.sql`, `0002_stock_order_functions.sql`, `0003_rls_policies.sql`, `0004_storage_media.sql` (0002–0004 still empty stubs). Mapping: A8 → 0002, A9/A11 → 0001, A10 → 0003. All B items not already in 0000 go in 0001 (or a new 0005), never by editing an applied migration once Supabase has been migrated.

## A. Agreed in spec v0.3 §12 (must be in 0001)
| # | Change | Status |
|---|---|---|
| A1 | `payment_provider` enum `['stripe']` → `['mock','stripe','payme','click']` | WT ✅ |
| A2 | `payments.provider` drop `DEFAULT 'stripe'`; `provider_payment_id` UNIQUE → UNIQUE(`provider`,`provider_payment_id`) | WT ✅ |
| A3 | `webhook_events(id PK)` → `payment_events(provider, event_id, type, payload, received_at, processed_at, error)` PK(`provider`,`event_id`) | WT ✅ |
| A4 | `checkouts.payment_intent_id` → `provider_session_id text` + `provider payment_provider NOT NULL`; UNIQUE(`provider`,`provider_session_id`) | WT ✅ |
| A5 | `order_status` add `stock_conflict` | WT ✅ |
| A6 | `products.currency DEFAULT 'EUR'` → no default (currency comes from `markets.currency`, seeded from `DEFAULT_CURRENCY`) | WT ✅ |
| A7 | Money columns `integer` → `bigint` (mode number). Reason: UZS tiyin overflows int4 above ~21.4M so'm per order | WT ✅ |
| A8 | Stock functions, `SECURITY DEFINER`, `SET search_path = ''`, schema-qualified names, `EXECUTE` revoked from `public, anon, authenticated`, granted to `service_role` only (signatures fixed in `src/contracts/inventory.ts`):<br>`reserve_checkout(p_checkout_id uuid, p_items jsonb, p_expires_at timestamptz) returns void` — lock rows in `variant_id` order; on shortage `RAISE EXCEPTION 'OUT_OF_STOCK' USING ERRCODE='P0001', DETAIL=<json array of variant ids>`<br>`convert_checkout_to_order(p_checkout_id uuid, p_order jsonb) returns jsonb` → `{order_id, reference, status:'paid'\|'stock_conflict'\|'already_converted', conflict_variant_ids}`; non-active reservation ⇒ `stock_conflict`, never a CHECK violation<br>`release_checkout(p_checkout_id uuid, p_reason text) returns int`<br>`release_expired_reservations(p_now timestamptz default now(), p_limit int default 500) returns int`<br>`adjust_stock(p_variant_id uuid, p_delta int, p_reason inventory_movement_reason, p_note text, p_actor_id uuid) returns int` | ❌ |
| A9 | `inventory_movements` append-only: `REVOKE UPDATE, DELETE, TRUNCATE` from all app roles (+ trigger that raises on UPDATE/DELETE as defence in depth) | WT 🟡 in `0001_security_core.sql` (not yet reviewed/applied) |
| A10 | RLS ON for every table; no anon/authenticated policies on `checkouts, orders, order_items, order_events, payments, refunds, payment_events, shipments, stock_reservations, inventory_movements, audit_log, admin_users`; public reads only via `security_invoker = on` views over published products/variants (no `stock_*` numbers, only `available bool`) and published articles | ❌ |
| A11 | `admin_users.id` and `profiles.id` FK → `auth.users(id) ON DELETE CASCADE` (hand-written SQL) | WT 🟡 in `0001_security_core.sql` (not yet reviewed/applied) |

## B. Additional findings (Architect) — please include in 0001
| # | Change | Why | Status |
|---|---|---|---|
| B1 | `checkouts.access_token_hash text NOT NULL` (sha256 of the guest token minted at checkout); `convert_checkout_to_order` copies it to `orders.access_token_hash` | `GET /checkout/{id}/status?token=` on the success page; token must exist before the webhook creates the order | ❌ |
| B2 | `checkouts.updated_at timestamptz NOT NULL DEFAULT now()` | Global rule §2; cron/webhook change status | ❌ |
| B3 | `payment_status` add `canceled` | Expiry cron cancels the provider session before releasing stock (contracts `PAYMENT_STATUSES`) | ❌ |
| B4 | CHECK `currency ~ '^[A-Z]{3}$'` on `markets, products, checkouts, orders, payments` | Currency is no longer defaulted; garbage in = wrong charges | ❌ |
| B5 | CHECK `iso2 ~ '^[A-Z]{2}$'` on `countries` | Contracts send upper-case ISO2 | ❌ |
| B6 | CHECK `locale IN ('en','uz','ru')` (or a `locales` table + FK) on all `*_translations`, `checkouts`, `orders` | Matches `SUPPORTED_LOCALES` in contracts; launch set still [OPEN] | ❌ |
| B7 | CHECK `unit_price_cents >= 0` on `order_items`; `free_over_cents IS NULL OR >= 0` and `max_weight_grams IS NULL OR > 0` on `shipping_rates`; `weight_grams IS NULL OR >= 0` on `product_variants`; `amount_cents > 0` already on refunds ✅ | Non-negative money/weights | ❌ |
| B8 | `stock_reservations`: UNIQUE(`checkout_id`,`variant_id`); add `created_at`, `released_at`, `converted_at` | One reservation per line; audit of expiry timing for the race tests | ❌ |
| B9 | `refunds`: add `idempotency_key uuid UNIQUE NOT NULL`, `updated_at` | Admin refund request carries `idempotencyKey` (double-click safety) | ❌ |
| B10 | `shipments`: add `created_at`, `updated_at`; CHECK `tracking_url IS NULL OR tracking_url ~ '^https://'` | Global rule §2; no `javascript:` links in emails | ❌ |
| B11 | New table `newsletter_subscribers` (id uuid, email text UNIQUE (lower-cased), locale, status enum[pending,confirmed,unsubscribed], confirm_token_hash text, confirmed_at, unsubscribed_at, created_at, updated_at); RLS on, no public policies | `POST /newsletter` + `GET /newsletter/confirm` (double opt-in) have no table | ❌ |
| B12 | Full-text search: generated `search_tsv tsvector` (config `simple`, uz/ru-safe) on `product_translations` (name, description, materials) and `article_translations` (title, excerpt) + GIN indexes | `GET /search` (spec §5) | ❌ |
| B13 | DB trigger `set_updated_at()` on every table with `updated_at` | Drizzle `$onUpdate` does not run inside SQL functions (`adjust_stock`, `convert_...`) | WT 🟡 in `0001_security_core.sql` (not yet reviewed/applied) |
| B14 | CHECK `status <> 'published' OR published_at IS NOT NULL` on `products` and `articles`; `articles` `scheduled` ⇒ `published_at IS NOT NULL` | Public views filter on `published_at <= now()` | ❌ |
| B15 | `order_events.type` → CHECK against a fixed list (or enum) e.g. `status_changed, payment_received, payment_failed, stock_conflict, refund_requested, refund_succeeded, shipment_created, email_sent, note` | Stable history for admin UI/tests | ❌ (low) |
| B16 | Partial unique index: at most one `payments` row with `status='succeeded'` per `order_id` | Prevents double capture recording | ❌ |
| B17 | `checkouts.idempotency_key` is UNIQUE ✅ (WT) — keep it nullable, matches contract `idempotencyKey?` | — | WT ✅ |

## C. Not schema, but blocking 0001 being applied
- Supabase `dooyoosh` (eu-central-1) is DEV/STAGING only (§12.7); do not load real customer data until the UZ data-localisation question is answered.
- Spec §1 says Postgres 16; the Supabase project runs Postgres 17 — Architect will update §1 (no schema impact).
- `DATABASE_URL` / service-role key are not in env yet, so nothing can be migrated against Supabase; test against QA's embedded Postgres (`tests/db`).

## D. Payments & Orders requests (appended by Backend & Database, 2026-10-22, at Architect's request)
Numbered B18–B22 because B17 above is already used (checkouts.idempotency_key).
| # | Change | Why | Status |
|---|---|---|---|
| B18 | New table `provider_transactions` (id, provider, provider_txn_id, checkout_id NOT NULL, order_id NULL, state enum[created,performed,canceled,canceled_after_perform], amount_cents bigint, currency, cancel_reason int, raw jsonb, created_at, performed_at, canceled_at, updated_at), UNIQUE(provider, provider_txn_id); RLS on, no anon/authenticated access | Payme/Click create a transaction before our order exists; mirrors `ProviderTransaction` in `src/contracts/payments.ts` | ✅ feat/db (0000) |
| B19 | `convert_checkout_to_order` writes `order_events` (`payment_received` / `stock_conflict`) and copies `checkouts.access_token_hash` → `orders.access_token_hash` | Order history + guest status token | ✅ feat/db (0002) |
| B20 | `convert_checkout_to_order(p_checkout_id, p_order, p_conflict_mode text default 'mark')`; `'abort'` raises `STOCK_CONFLICT` (DETAIL = variant ids) and rolls back instead of creating a `stock_conflict` order | Payme Perform / Click Complete can refuse before money is captured | ✅ feat/db (0002) |
| B21 | `adjust_stock(..., p_actor_id uuid)` accepts NULL actor (system/cron/provider callback) | System adjustments | ✅ feat/db (0002) |
| B22 | Fiscal fields (`ikpu_code`, `package_code`, `vat_rate_bp`) exposed in `storefront_variants`; convert prefers snapshot `ikpuCode/packageCode/vatRateBp` (contract `CheckoutSnapshotLine`), falling back to `products` | ZRU-792 fiscal receipts | ✅ feat/db (0003/0002) |


## E. Backend & Database — local migrations 0005/0006 (2026-10-22, NOT on staging until QA green)
- B23 `products.vat_rate_bp` NOT NULL, no default (Architect); convert has no 1200 fallback; seeds write 1200 explicitly. ✅ 0005/0006
- B24 `access_token_hash` = hex HMAC_SHA256(ORDER_TOKEN_SECRET, token) by Payments; DB CHECK `^[0-9a-f]{64}$` on checkouts + orders. ✅ 0005
- B25 `provider_transactions.seq` bigint identity (UNIQUE (provider, seq)) + `provider_time` bigint ms nullable (index (provider, provider_time)) for Payme GetStatement. ✅ 0005
- B26 `refunds.idempotency_key` uuid → text NOT NULL UNIQUE (1..200). ✅ 0005
- B27 convert conflict modes `record` (default) | `abort`; abort returns `aborted` and writes nothing. ✅ 0006
- B28 `checkouts.idempotency_payload_hash` + `IDEMPOTENCY_CONFLICT` (reserve_checkout p_payload_hash, `checkout_id_for_idempotency_key`). ✅ 0005/0006 — needs an ERROR_CODES entry (409) from the Architect.
- B29 `newsletter_attempts` (hashed ip/email, RLS on, no API-role grants) + `newsletter_attempt()` (prune >24h + insert + count, service_role) replacing the in-memory newsletter limiter; IP only from `TRUSTED_IP_HEADER`. ⏳ 0008 local only
