// BLOCKED: these need code that does not exist yet (no Next.js app, no src/server/checkout|payments|orders, no API routes).
// Each it.todo/skip lists the exact assertion. Flip to it() once the code lands.
import { describe, it } from "vitest";

describe.skip("BLOCKED checkout tampering (POST /api/v1/checkout) — Payments & Orders", () => {
  it("client-sent unitPrice/total fields are ignored; totals recomputed from product_variants.price_cents ?? products.base_price_cents", () => {});
  it("quantity <= 0, non-integer, or > 99 -> 400 VALIDATION_ERROR (and never reaches reservation UPDATE)", () => {});
  it("unknown / inactive / draft-product variantId -> 409 OUT_OF_STOCK or 400, details.variantIds set", () => {});
  it("duplicate variantId lines are merged before reservation (no double reserve bypass)", () => {});
  it("non-shippable country -> 422 COUNTRY_NOT_SHIPPABLE; shippingMethodId from another market rejected", () => {});
  it("price changed between cart/validate and checkout -> 409 PRICE_CHANGED with details.variantIds", () => {});
  it("reservation is made at OUR checkout before redirect to Payme/Click; stock_reservations.expires_at = now()+35min", () => {});
});

describe.skip("BLOCKED Payme JSON-RPC callbacks — Payments & Orders", () => {
  it("missing/invalid Basic auth (Paycom:<key>) -> error -32504, no DB writes", () => {});
  it("CheckPerformTransaction only verifies reservation is active + amount (tiyin) == orders.total_cents; does not reserve", () => {});
  it("amount mismatch by 1 tiyin -> -31001", () => {});
  it("CreateTransaction twice with same id -> same result, one payments row", () => {});
  it("PerformTransaction after 35-min reservation expiry -> returns error, order not paid, stock unchanged", () => {});
  it("PerformTransaction replay -> idempotent, single sale movement, single order paid", () => {});
  it("CancelTransaction after Perform restores stock_on_hand and writes inventory_movements reason='return'", () => {});
});

describe.skip("BLOCKED Click Prepare/Complete — Payments & Orders", () => {
  it("bad sign_string (md5 of click_trans_id+service_id+SECRET+merchant_trans_id+amount+action+sign_time) -> error -1", () => {});
  it("Prepare only verifies reservation active + amount; Complete after expiry -> error, no order paid", () => {});
  it("duplicate Complete for same click_trans_id -> no second order / movement (payment_events(provider,event_id))", () => {});
});

describe.skip("BLOCKED Stripe webhook (only if EU path revived) — Payments & Orders", () => {
  it("signature verified on raw body; re-serialized JSON body fails verification", () => {});
});

describe.skip("BLOCKED API authorization — Backend & Database / Payments & Orders", () => {
  it("/api/v1/admin/* without session -> 401; editor on /admin/orders -> 403; fulfilment on /admin/products -> 403", () => {});
  it("GET /orders/{reference} without token or with wrong token -> 404 (not 403, no existence leak)", () => {});
  it("cron routes without CRON_SECRET -> 401", () => {});
  it("success page never sets order paid; only callback does", () => {});
});

describe.skip("BLOCKED responsive / e2e (Playwright) — Frontend & Design", () => {
  it("360x800, 390x844, 768x1024, 1440x900: no horizontal scroll on home, shop, product, bag, checkout", () => {});
  it("UZS formatting '1 250 000 so'm' everywhere; axe-core 0 serious violations; tap targets >= 24px", () => {});
  it("bag shows 35-min reservation countdown; 409 OUT_OF_STOCK updates bag with readable message", () => {});
});
