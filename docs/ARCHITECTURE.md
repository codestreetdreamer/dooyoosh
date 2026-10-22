# DOOYOOSH — Architecture Spec v0.4 (binding)

Owner: Architect. Status: DRAFT v0.4, 2026-10-22.
v0.2: hosted checkout (Stripe Checkout or equivalent) behind PaymentProvider; checkout session 30 min, reservation TTL 35 min; webhook_events -> payment_events(provider,event_id); order status stock_conflict + auto-refund; provider [OPEN] pending business country. All agents build to this file.
v0.4: business is in Uzbekistan. Stripe is NOT used. Wherever sections 1-5 say Stripe/PaymentIntent/EUR, read: provider adapter (mock|payme|click; stripe kept only as an enum value), provider session, currency from markets (UZS, minor units = tiyin). Payme/Click are server-to-server (Payme JSON-RPC Check/Create/Perform/Cancel, Click Prepare/Complete): reserve at our checkout before redirect; Check/Prepare only verify reservation is active; Perform/Complete convert; Perform after reservation expiry returns provider error; Cancel after Perform = refund + inventory movement `return`. Live mode requires PAYMENT_MODE=live and verified merchant eligibility. Section 12 overrides earlier sections.
Changes go through Architect: propose in the group chat, Architect updates this file and bumps the version.
Sections marked [OPEN] wait on a decision from Mirfozil.

## 1. Stack (decided)

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) everywhere | One language, shared types |
| Web app | Next.js 15, App Router, React Server Components | SSR/SEO for journal + shop, one deployable |
| Styling | Tailwind CSS v4 + CSS variables for design tokens | Tokens map 1:1 to brand system |
| UI primitives | Radix UI (headless) | Accessibility without a generic look |
| Database | PostgreSQL 16 on Supabase (EU region, Frankfurt) | Transactions for stock; Mirfozil knows Supabase |
| ORM / migrations | Drizzle ORM + drizzle-kit (SQL migrations in repo) | Typed, explicit SQL, no magic |
| Validation / contracts | Zod schemas in `src/contracts` | Single source for API request/response types |
| Auth | Supabase Auth. Admin: email + password + TOTP. Customers: guest checkout in v1, accounts optional later | |
| Payments | [OPEN] Hosted checkout behind `PaymentProvider` interface. Stripe Checkout (EUR, BLIK, P24) if the business is registered in Poland/EU; Payme/Click (UZS) if in Uzbekistan. Stripe does not onboard Uzbek entities. | Provider-agnostic core |
| Email | Resend + React Email templates | Order confirmation, shipped, refund |
| Images / media | Supabase Storage, served via `next/image` | |
| Journal content | Stored in Postgres, edited in our admin (TipTap rich text, stored as JSON) | One admin for products + articles |
| i18n | next-intl, locale-prefixed routes `/en/...`; translation tables in DB | English at launch |
| Jobs / cron | Vercel Cron hitting protected route handlers | Reservation expiry, email retries |
| Hosting | Vercel (app) + Supabase (DB, auth, storage) | |
| Package manager | pnpm. Node 20 LTS | |
| Testing | Vitest (unit), Playwright (e2e), Stripe CLI for webhook tests | |
| Lint / format | ESLint + Prettier, enforced in CI (GitHub Actions) | |

Not allowed without an Architect change: other ORMs, client-side price calculation as source of truth, storing card data, a second database, a separate headless CMS.

## 2. Global rules

- Money: integer minor units (`amount_cents INT`) + `currency CHAR(3)`. Never floats.
- IDs: `uuid` primary keys (`gen_random_uuid()`). Human order reference: `DY-YYYYMMDD-XXXXX` (base32, unique).
- Timestamps: `timestamptz`, UTC, columns `created_at`, `updated_at`.
- Soft delete for catalog (`archived_at`); orders are never deleted.
- Prices, stock, totals, shipping eligibility are ALWAYS computed on the server at checkout. The client cart is a hint.
- Every state change on an order or stock writes a history row (see `inventory_movements`, `order_events`).
- Row Level Security ON for all tables. Public reads only via server code or views exposing published data.
- Secrets only in env vars; see `.env.example`. Never commit keys.

## 3. Data model (Postgres)

### Catalog
- `categories` (id, slug unique, parent_id null, kind enum[clothing,footwear,accessories], sort_order, is_active)
- `category_translations` (category_id, locale, name, description) PK(category_id, locale)
- `products` (id, slug unique, category_id, brand null, status enum[draft,published,archived], base_price_cents, currency, size_system enum[alpha,eu_shoe,uk_shoe,us_shoe,one_size,numeric], published_at, archived_at, created_at, updated_at)
- `product_translations` (product_id, locale, name, description, materials, care, fit_notes, seo_title, seo_description) PK(product_id, locale)
- `product_images` (id, product_id, variant_id null, storage_path, alt, sort_order, width, height)
- `product_variants` (id, product_id, sku unique, size null, colour null, colour_hex null, price_cents null = use base price, stock_on_hand int >=0, stock_reserved int >=0, is_active, weight_grams, created_at, updated_at)
  - CHECK (stock_reserved <= stock_on_hand)
  - UNIQUE (product_id, size, colour)
- `size_charts` (id, name, size_system, data jsonb) and `products.size_chart_id` null

### Inventory
- `inventory_movements` (id, variant_id, delta int, reason enum[restock,adjustment,sale,cancellation,return,damage], order_id null, note, actor_id null, created_at)
- `stock_reservations` (id, variant_id, checkout_id, quantity, expires_at, status enum[active,converted,released])

### Markets and shipping
- `markets` (id, code e.g. 'EU', currency, is_active)
- `countries` (iso2 PK, market_id, is_shippable bool) — only verified countries are shippable at launch
- `shipping_methods` (id, market_id, code, name, min_days, max_days, is_active)
- `shipping_rates` (id, shipping_method_id, min_subtotal_cents, max_weight_grams null, price_cents, free_over_cents null)

### Checkout and orders
- `checkouts` (id, email, locale, currency, items jsonb snapshot, shipping_address jsonb, shipping_method_id, subtotal_cents, shipping_cents, tax_cents, total_cents, payment_intent_id, status enum[open,awaiting_payment,completed,expired,failed], expires_at, created_at)
- `orders` (id, reference unique, checkout_id unique, email, phone null, locale, currency, subtotal_cents, shipping_cents, tax_cents, discount_cents, total_cents, status enum[pending_payment,paid,stock_conflict,fulfilling,shipped,delivered,cancelled,refunded,partially_refunded], shipping_address jsonb, billing_address jsonb, shipping_method_id, access_token_hash, placed_at, paid_at, created_at, updated_at)
- `order_items` (id, order_id, variant_id, sku, product_name, size, colour, unit_price_cents, quantity, line_total_cents) — snapshot, never joined for display
- `order_events` (id, order_id, type, from_status, to_status, payload jsonb, actor_id null, created_at)
- `payments` (id, order_id, provider 'stripe', provider_payment_id unique, amount_cents, currency, status enum[requires_payment,succeeded,failed,refunded,partially_refunded], raw jsonb, created_at)
- `refunds` (id, payment_id, amount_cents, reason, provider_refund_id unique, status, created_at)
- `shipments` (id, order_id, carrier, tracking_number, tracking_url, status enum[label_created,in_transit,delivered,exception], shipped_at, delivered_at)
- `payment_events` (provider, event_id, type, received_at, processed_at, error null) PK(provider, event_id) — idempotency

### Journal
- `articles` (id, slug unique, status enum[draft,scheduled,published,archived], cover_image_path, author_name, published_at, created_at, updated_at)
- `article_translations` (article_id, locale, title, excerpt, body jsonb (TipTap), seo_title, seo_description)
- `article_products` (article_id, product_id, sort_order) — shoppable editorials
- `tags`, `article_tags`

### Admin
- `admin_users` (id = auth.users.id, role enum[owner,editor,fulfilment], is_active)
- `audit_log` (id, actor_id, action, entity, entity_id, diff jsonb, created_at)

## 4. Checkout and stock flow (binding)

1. `POST /api/v1/checkout` — server loads variants, recomputes prices and shipping, then in ONE transaction:
   `UPDATE product_variants SET stock_reserved = stock_reserved + :q WHERE id = :id AND is_active AND stock_on_hand - stock_reserved >= :q` for each line; any 0-row update aborts with `409 OUT_OF_STOCK`.
   Inserts `checkouts` + `stock_reservations` (expires_at = now() + 35 min; provider session expires in 30 min), creates Stripe PaymentIntent with `metadata.checkout_id`, idempotency key = checkout id.
2. Client confirms payment with Stripe Payment Element.
3. `POST /api/v1/payments/{provider}/callback` — verify signature, insert into `webhook_events` (conflict = already handled, return 200). On `payment_intent.succeeded`: in one transaction create `orders` + `order_items`, convert reservations (stock_on_hand -= q, stock_reserved -= q, movement reason `sale`), set order `paid`, enqueue confirmation email.
4. On `payment_intent.payment_failed` / expiry cron: release reservations (stock_reserved -= q), checkout `expired|failed`.
5. Order status changes only through `src/server/orders/transitions.ts` (single state machine).
6. The success page never marks an order paid; only the webhook does.

## 5. API contracts (v1)

Base `/api/v1`. JSON. Errors always:
```json
{ "error": { "code": "OUT_OF_STOCK", "message": "human text", "details": {} } }
```
Codes: VALIDATION_ERROR 400, UNAUTHORIZED 401, FORBIDDEN 403, NOT_FOUND 404, OUT_OF_STOCK 409, PRICE_CHANGED 409, COUNTRY_NOT_SHIPPABLE 422, PAYMENT_ERROR 502, INTERNAL 500.
List responses: `{ "data": [...], "page": { "cursor": "...|null", "limit": 24 } }`.
All schemas live in `src/contracts/*.ts` (Zod); handlers and frontend import from there.

### Public
| Method | Path | Purpose |
|---|---|---|
| GET | /products?category=&size=&colour=&minPrice=&maxPrice=&sort=new\|price_asc\|price_desc&cursor=&limit= | Catalog listing (published only) |
| GET | /products/{slug} | Product + variants (availability = on_hand - reserved > 0, exact count hidden) + images |
| GET | /categories | Category tree |
| GET | /search?q= | Postgres full-text over product + article translations |
| POST | /cart/validate | Body `{items:[{variantId,quantity}]}` → current prices, availability, subtotal |
| GET | /shipping/options?country= | Methods and rates for a shippable country |
| POST | /checkout | Body `{email, phone?, items, shippingAddress, shippingMethodId, locale}` → `{checkoutId, clientSecret, totals}` |
| GET | /orders/{reference}?token= | Order status for guest (token from email, hashed in DB) |
| GET | /articles?tag=&cursor= , /articles/{slug} | Journal |
| POST | /newsletter | Email signup (double opt-in) |
| POST | /payments/{provider}/callback | Payme (Basic auth) / Click (sign_string) / mock; auth verified server-side, amount compared to DB |

### Admin (`/api/v1/admin/*`, requires admin session + role)
- Products: GET/POST /products, GET/PATCH/DELETE(archive) /products/{id}, POST /products/{id}/publish, /unpublish
- Variants: POST /products/{id}/variants, PATCH /variants/{id}
- Inventory: POST /variants/{id}/adjust `{delta, reason, note}` (writes movement), GET /variants/{id}/movements
- Orders: GET /orders?status=&q=, GET /orders/{id}, POST /orders/{id}/transition `{to, note}`, POST /orders/{id}/refund `{amountCents, reason}`
- Shipments: POST /orders/{id}/shipments `{carrier, trackingNumber, trackingUrl}` → status shipped + email
- Articles: GET/POST /articles, PATCH/DELETE /articles/{id}, POST /articles/{id}/publish
- Media: POST /media/upload-url → signed Supabase upload URL
Role matrix: owner = all; editor = products, articles, media; fulfilment = orders, shipments, inventory adjust.

Admin UI may use Server Actions internally, but they must call the same `src/server/*` services as the route handlers.

## 6. Routes (pages)

```
/[locale]                         Homepage
/[locale]/shop                    All products
/[locale]/shop/[category]         clothing | footwear | accessories
/[locale]/product/[slug]          Product details
/[locale]/bag                     Shopping bag
/[locale]/checkout                Checkout
/[locale]/order/[reference]       Confirmation / status (token)
/[locale]/journal                 Journal index
/[locale]/journal/[slug]          Article
/[locale]/pages/[slug]            About, Shipping, Returns, Size guide, Privacy, Terms, Cookies, Contact
/admin/...                        Admin (no locale), protected
```

## 7. File structure

```
dooyoosh/
  docs/ARCHITECTURE.md  docs/adr/NNN-*.md
  public/brand/ (original logo files, favicon)  
  src/
    app/
      [locale]/(store)/...        storefront pages
      [locale]/(journal)/...      journal pages
      admin/(dashboard)/...       admin pages
      api/v1/.../route.ts         route handlers (thin: parse -> service -> respond)
    contracts/                    Zod schemas + inferred types (API source of truth)
    server/
      db/schema/*.ts              Drizzle schema, one file per domain
      db/migrations/              generated SQL
      catalog/ inventory/ checkout/ orders/ payments/ shipping/ journal/ email/ auth/
      payments/provider.ts        PaymentProvider interface; stripe.ts implementation
    components/ui/                primitives (Radix + tokens)
    components/store/ journal/ admin/
    lib/                          money.ts, i18n.ts, env.ts (Zod-validated env), errors.ts
    styles/tokens.css             design tokens
    emails/                       React Email templates
    messages/en.json              UI strings
  tests/unit/  tests/e2e/
  .env.example  drizzle.config.ts  next.config.ts  package.json
```

Rule: `app/` never imports Drizzle directly; only `src/server/*` touches the DB.

## 8. Design tokens (initial, Frontend may tune values, not names)

```
--color-bg: #F7F1E8 (cream)   --color-surface: #FFFDF8 (ivory)
--color-text: #2B1E17 (espresso)   --color-text-muted: #6B5B52
--color-accent: #C9A2A0 (dusty rose)   --color-border: #E6DCD0
--font-serif: headline serif [OPEN: pick, e.g. Cormorant Garamond]
--font-sans: UI sans [OPEN: pick, e.g. Inter]
```
Targets: LCP < 2.5s on 4G mobile, WCAG 2.2 AA contrast, CLS < 0.1.

## 9. Ownership

| Area | Agent |
|---|---|
| This spec, contracts, schema review, ADRs | Architect |
| Pages, components, tokens, i18n strings, accessibility | Frontend & Design |
| Drizzle schema, migrations, catalog/inventory/journal services, admin APIs, RLS | Backend & Database |
| Checkout, Stripe, webhooks, orders state machine, refunds, shipments, emails | Payments & Orders |
| Tests, threat model, RLS/authz review, webhook and stock race tests, CI gates | QA & Security |

## 10. Open decisions for Mirfozil

1. Legal entity / country of registration (drives Stripe account, VAT/OSS, launch countries).
2. Launch countries (proposal: Poland + a few EU countries only).
3. VAT handling: prices shown VAT-inclusive (EU norm) — confirm; Stripe Tax or manual rates.
4. Carrier(s) for shipping (e.g. InPost / DPD / DHL) — tracking integration is manual entry in v1.
5. Fonts and final logo files (SVG preferred).
6. Customer accounts in v1, or guest checkout only (proposal: guest only).
7. Rest of the spec: the message ended at "Journal:" — remaining sections still needed.

## 11. v0.2 rules
- Webhook/callback: verify signature on RAW body, compare amount+currency with DB order, dedupe via payment_events.
- Late success after reservation released: order -> stock_conflict, automatic refund, customer email.
- 409 errors include `details.variantIds`.

## 12. v0.3 decisions (2026-10-22)
1. `payment_provider` enum = [mock, stripe, payme, click] (`mock` for dev/test only; app refuses `mock` when NODE_ENV=production). `payments.provider`, `payment_events.provider`; PK `payment_events(provider, event_id)`.
2. `checkouts.payment_intent_id` -> `provider_session_id text`, plus `checkouts.provider`; UNIQUE(provider, provider_session_id).
3. Money columns keep `*_cents` names but mean minor units of `currency` (tiyin for UZS). No DB default currency; it comes from `markets.currency`. Seed market currency from config.
4. `order_status` adds `stock_conflict`; `checkout_status` unchanged.
5. Stock changes ONLY via SECURITY DEFINER functions, EXECUTE granted to service_role only: `reserve_checkout`, `convert_checkout_to_order`, `release_checkout`, `release_expired_reservations`, `adjust_stock`. App code never UPDATEs stock columns. `inventory_movements` append-only (UPDATE/DELETE revoked). Functions must `SET search_path = ''` and schema-qualify names. `convert_checkout_to_order` handles non-active reservation -> `stock_conflict` (no CHECK violation, webhook returns 200).
6. RLS ON everywhere; no anon/authenticated policies on checkouts/orders/order_items/payments/refunds/payment_events/shipments/stock_reservations; public read via views over published catalog/articles only (views `security_invoker = on`).
7. Supabase project `dooyoosh` (eu-central-1) is DEV/STAGING only. No real customer data until the UZ personal-data localisation question is answered.

## 13. v0.4 additions (2026-10-22 23:05)
- Fiscal (ZRU-792): `products.ikpu_code text`, `products.package_code text`, `products.vat_rate_bp int` (basis points, e.g. 1200 = 12%); snapshot all three into `order_items`. Required for live mode, nullable for demo seed.
- Hosting: MVP/sandbox deploys to Vercel. Live Click/Octo need static egress IP: production hosting is an OPEN production blocker (options: VPS/container with static IP, or egress proxy). Payment adapters must not assume Vercel.
- Data residency: per Payments & Orders' research (docs/PAYMENT_PROVIDERS_UZ.md), only biometric/genetic/telecom data must stay in UZ after ZRU-1125; Frankfurt OK for MVP, legal confirmation is a production blocker.
