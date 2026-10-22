# DOOYOOSH — API contracts index (v0.3, 2026-10-22)

Owner: Architect. Source of truth: `src/contracts/*.ts` (Zod). The `endpoints` registry in `src/contracts/index.ts`
drives `src/lib/api-client.ts`; this table is generated from it — if they disagree, the code wins and this file is regenerated.
Schema names are `<module>.<export>` under `src/contracts/`. Route handler file = `src/app/api/v1/<path>/route.ts`.

## Conventions
- Success: `{ "data": ... }`; lists `{ "data": [...], "page": { "cursor": string|null, "limit": number } }` (default limit 24, max 100).
- Errors (all endpoints): `common.errorEnvelope` → `{ "error": { "code", "message", "details" } }`, built only via `src/lib/errors.ts` (`ApiError`, `errorResponse`, `withErrors`).
  Codes: VALIDATION_ERROR 400, UNAUTHORIZED 401, FORBIDDEN 403, NOT_FOUND 404, OUT_OF_STOCK 409, PRICE_CHANGED 409, COUNTRY_NOT_SHIPPABLE 422, PAYMENT_ERROR 502, INTERNAL 500.
  409s always carry `details.variantIds: uuid[]`.
- Money in API = `*Minor` integer fields + `currency` (ISO 4217). DB columns stay `*_cents` (spec §12.3). No hardcoded EUR.
- Provider union: `mock | stripe | payme | click` (`mock` refused in production by `src/lib/env.ts`).
- Order status includes `stock_conflict`; transitions in `orders.ORDER_TRANSITIONS`, enforced only by `src/server/orders/transitions.ts`.
- Handlers are thin: `parse(contract) → service → respond(contract)`. `src/app` never imports `src/server/db`.
- Auth: `public` = none; `admin` = Supabase session + `admin_users` role (+TOTP); `webhook` = provider signature/token on RAW body; `cron` = `Authorization: Bearer $CRON_SECRET`.

## Endpoints
| Name | Method | Path | Request | Response (status) | Auth (roles) | Owner | Status |
|---|---|---|---|---|---|---|---|
| `listProducts` | GET | `/api/v1/products` | query: `catalog.listProductsQuery` | `catalog.listProductsResponse` (200) | public | Backend & Database | todo |
| `getProduct` | GET | `/api/v1/products/{slug}` | params: `catalog.productParams`<br>query: `catalog.getProductQuery` | `catalog.getProductResponse` (200) | public | Backend & Database | todo |
| `listCategories` | GET | `/api/v1/categories` | query: `catalog.listCategoriesQuery` | `catalog.listCategoriesResponse` (200) | public | Backend & Database | todo |
| `search` | GET | `/api/v1/search` | query: `catalog.searchQuery` | `catalog.searchResponse` (200) | public | Backend & Database | todo |
| `validateCart` | POST | `/api/v1/cart/validate` | body: `cart.validateCartRequest` | `cart.validateCartResponse` (200) | public | Backend & Database | todo |
| `shippingOptions` | GET | `/api/v1/shipping/options` | query: `shipping.shippingOptionsQuery` | `shipping.shippingOptionsResponse` (200) | public | Backend & Database | todo |
| `createCheckout` | POST | `/api/v1/checkout` | body: `checkout.createCheckoutRequest` | `checkout.createCheckoutResponse` (201) | public | Payments & Orders | todo |
| `checkoutStatus` | GET | `/api/v1/checkout/{checkoutId}/status` | params: `orders.checkoutStatusParams`<br>query: `orders.checkoutStatusQuery` | `orders.checkoutStatusResponse` (200) | public | Payments & Orders | todo |
| `getOrder` | GET | `/api/v1/orders/{reference}` | params: `orders.orderParams`<br>query: `orders.getOrderQuery` | `orders.getOrderResponse` (200) | public | Payments & Orders | todo |
| `listArticles` | GET | `/api/v1/articles` | query: `journal.listArticlesQuery` | `journal.listArticlesResponse` (200) | public | Backend & Database | todo |
| `getArticle` | GET | `/api/v1/articles/{slug}` | params: `journal.articleParams`<br>query: `journal.getArticleQuery` | `journal.getArticleResponse` (200) | public | Backend & Database | todo |
| `newsletterSignup` | POST | `/api/v1/newsletter` | body: `journal.newsletterSignupRequest` | `journal.newsletterSignupResponse` (202) | public | Backend & Database | todo |
| `newsletterConfirm` | GET | `/api/v1/newsletter/confirm` | query: `journal.newsletterConfirmQuery` | `journal.newsletterConfirmResponse` (200) | public | Backend & Database | todo |
| `paymentWebhook` | POST | `/api/v1/webhooks/{provider}` | params: `payments.webhookParams` | provider-specific (VerifiedWebhook.respond) (200) | webhook | Payments & Orders | todo |
| `cronReleaseExpired` | POST | `/api/v1/cron/release-expired` | — | `inventory.releaseExpiredResponse` (200) | cron | Payments & Orders | todo |
| `adminListProducts` | GET | `/api/v1/admin/products` | query: `admin.adminListProductsQuery` | `admin.adminListProductsResponse` (200) | admin (owner, editor) | Backend & Database | todo |
| `adminCreateProduct` | POST | `/api/v1/admin/products` | body: `admin.createProductRequest` | `admin.adminProductResponse` (201) | admin (owner, editor) | Backend & Database | todo |
| `adminGetProduct` | GET | `/api/v1/admin/products/{id}` | params: `id` | `admin.adminProductResponse` (200) | admin (owner, editor) | Backend & Database | todo |
| `adminUpdateProduct` | PATCH | `/api/v1/admin/products/{id}` | params: `id`<br>body: `admin.updateProductRequest` | `admin.adminProductResponse` (200) | admin (owner, editor) | Backend & Database | todo |
| `adminArchiveProduct` | DELETE | `/api/v1/admin/products/{id}` | params: `id` | `admin.adminProductResponse` (200) | admin (owner, editor) | Backend & Database | todo |
| `adminPublishProduct` | POST | `/api/v1/admin/products/{id}/publish` | params: `id` | `admin.adminProductResponse` (200) | admin (owner, editor) | Backend & Database | todo |
| `adminUnpublishProduct` | POST | `/api/v1/admin/products/{id}/unpublish` | params: `id` | `admin.adminProductResponse` (200) | admin (owner, editor) | Backend & Database | todo |
| `adminCreateVariant` | POST | `/api/v1/admin/products/{id}/variants` | params: `id`<br>body: `admin.createVariantRequest` | `admin.adminVariantResponse` (201) | admin (owner, editor) | Backend & Database | todo |
| `adminUpdateVariant` | PATCH | `/api/v1/admin/variants/{id}` | params: `id`<br>body: `admin.updateVariantRequest` | `admin.adminVariantResponse` (200) | admin (owner, editor) | Backend & Database | todo |
| `adminAdjustStock` | POST | `/api/v1/admin/variants/{id}/adjust` | params: `id`<br>body: `inventory.adjustStockRequest` | `inventory.adjustStockResponse` (200) | admin (owner, fulfilment) | Payments & Orders | todo |
| `adminListMovements` | GET | `/api/v1/admin/variants/{id}/movements` | params: `id`<br>query: `admin.listMovementsQuery` | `paginatedMovements` (200) | admin (owner, fulfilment) | Backend & Database | todo |
| `adminListOrders` | GET | `/api/v1/admin/orders` | query: `admin.adminListOrdersQuery` | `admin.adminListOrdersResponse` (200) | admin (owner, fulfilment) | Payments & Orders | todo |
| `adminGetOrder` | GET | `/api/v1/admin/orders/{id}` | params: `id` | `admin.adminOrderResponse` (200) | admin (owner, fulfilment) | Payments & Orders | todo |
| `adminTransitionOrder` | POST | `/api/v1/admin/orders/{id}/transition` | params: `id`<br>body: `admin.transitionOrderRequest` | `admin.adminOrderResponse` (200) | admin (owner, fulfilment) | Payments & Orders | todo |
| `adminRefundOrder` | POST | `/api/v1/admin/orders/{id}/refund` | params: `id`<br>body: `admin.refundOrderRequest` | `admin.refundOrderResponse` (201) | admin (owner, fulfilment) | Payments & Orders | todo |
| `adminCreateShipment` | POST | `/api/v1/admin/orders/{id}/shipments` | params: `id`<br>body: `admin.createShipmentRequest` | `admin.createShipmentResponse` (201) | admin (owner, fulfilment) | Payments & Orders | todo |
| `adminListArticles` | GET | `/api/v1/admin/articles` | query: `admin.adminListArticlesQuery` | `admin.adminListArticlesResponse` (200) | admin (owner, editor) | Backend & Database | todo |
| `adminCreateArticle` | POST | `/api/v1/admin/articles` | body: `admin.createArticleRequest` | `admin.adminArticleResponse` (201) | admin (owner, editor) | Backend & Database | todo |
| `adminUpdateArticle` | PATCH | `/api/v1/admin/articles/{id}` | params: `id`<br>body: `admin.updateArticleRequest` | `admin.adminArticleResponse` (200) | admin (owner, editor) | Backend & Database | todo |
| `adminArchiveArticle` | DELETE | `/api/v1/admin/articles/{id}` | params: `id` | `admin.adminArticleResponse` (200) | admin (owner, editor) | Backend & Database | todo |
| `adminPublishArticle` | POST | `/api/v1/admin/articles/{id}/publish` | params: `id`<br>body: `admin.publishArticleRequest` | `admin.adminArticleResponse` (200) | admin (owner, editor) | Backend & Database | todo |
| `adminMediaUploadUrl` | POST | `/api/v1/admin/media/upload-url` | body: `admin.mediaUploadUrlRequest` | `admin.mediaUploadUrlResponse` (200) | admin (owner, editor) | Backend & Database | todo |

## Non-HTTP boundaries
| Boundary | Contract | Implemented in | Owner | Status |
|---|---|---|---|---|
| Payment provider | `payments.PaymentProvider` (`createSession`, `verifyWebhook`, `cancel`, `refund`) → `NormalizedPaymentEvent` {provider, eventId, type: payment.succeeded\|payment.failed\|payment.expired\|refund.succeeded, providerPaymentId, amountMinor, currency, checkoutId} | `src/server/payments/{provider,mock,stripe,payme,click}.ts` | Payments & Orders | todo (mock first) |
| Inventory | `inventory.InventoryService` (`reserve`, `convert`, `release`, `releaseExpired`, `adjust`) wrapping DB functions `reserve_checkout`, `convert_checkout_to_order`, `release_checkout`, `release_expired_reservations`, `adjust_stock` | `src/server/inventory/reservations.ts` + SQL migration | Backend & Database | todo |
| Order state machine | `orders.ORDER_TRANSITIONS` | `src/server/orders/transitions.ts` | Payments & Orders | todo |
| Env | `src/lib/env.ts` (`serverEnv()`, `clientEnv()`) | — | Architect | done |
| Money | `src/lib/money.ts` (`toMinor`, `formatMoney`, `add`...) — UZS shown without decimals, e.g. `1 250 000 so’m` | — | Architect | done |

## Changes vs spec §5 text (accepted in v0.3)
1. `POST /checkout` returns `{checkoutId, provider, redirectUrl, expiresAt, reservedUntil, totals}` (hosted checkout) instead of `clientSecret`. Request accepts optional `expectedUnitPriceMinor` per line (→ 409 PRICE_CHANGED) and `idempotencyKey`.
2. `POST /webhooks/stripe` → `POST /webhooks/{provider}`; response body is provider-specific (Payme JSON-RPC, Click prepare/complete).
3. Added `GET /checkout/{checkoutId}/status?token=` for the success page (never trusts URL params; needs `checkouts.access_token_hash`, see SCHEMA_DELTA.md).
4. Added `GET /newsletter/confirm?token=` (double opt-in) and `POST /cron/release-expired`.
5. Variant stock is not PATCHable; initial stock goes through `adjust_stock(restock)`.
