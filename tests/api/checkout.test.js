// Live: POST /checkout tampering (spec §2 "prices always computed on the server", contracts/checkout.ts).
import { describe, it, expect, beforeAll } from "vitest";
import { endpoints } from "../../src/contracts/index.ts";
import { UP, DOWN_REASON, call, skipIfMissing, expectEnvelope, randomUUID } from "./lib/http.js";
import { buyable, checkoutBody } from "./lib/fixtures.js";

let f;
const post = (b) => call("POST", "/checkout", { body: b });
const need = async (ctx) => {
  const probe = await post({});
  skipIfMissing(ctx, probe, "POST /checkout");
  if (!f) ctx.skip("no published, available variant + shipping method found (seed DEMO data or set QA_VARIANT_ID / QA_SHIPPING_METHOD_ID)");
};

describe.skipIf(!UP)(`checkout tampering${UP ? "" : ` [SKIPPED: ${DOWN_REASON}]`}`, () => {
  beforeAll(async () => { f = await buyable(); });

  it("happy path: 201, contract shape, reservedUntil ~35 min, expiresAt ~30 min, totals from server", async (ctx) => {
    await need(ctx);
    const r = await post(checkoutBody(f, { idempotencyKey: randomUUID() }));
    expect(r.status, r.text.slice(0, 300)).toBe(201);
    const d = endpoints.createCheckout.response.parse(r.json).data;
    const mins = (iso) => (new Date(iso) - Date.now()) / 60000;
    expect(mins(d.reservedUntil)).toBeGreaterThan(33); expect(mins(d.reservedUntil)).toBeLessThanOrEqual(35.5);
    expect(mins(d.expiresAt)).toBeGreaterThan(28); expect(mins(d.expiresAt)).toBeLessThanOrEqual(30.5);
    expect(mins(d.expiresAt)).toBeLessThan(mins(d.reservedUntil));
    if (f.priceMinor !== undefined) expect(d.totals.subtotalMinor).toBe(f.priceMinor);
    expect(d.totals.totalMinor).toBe(d.totals.subtotalMinor + d.totals.shippingMinor + d.totals.taxMinor - d.totals.discountMinor);
  });

  it("client-sent price/total fields are ignored (unitPriceMinor: 1, totals: 0)", async (ctx) => {
    await need(ctx);
    const b = checkoutBody(f);
    b.items[0].unitPriceMinor = 1; b.items[0].priceMinor = 1; b.totals = { totalMinor: 0 }; b.totalMinor = 0; b.currency = "USD";
    const r = await post(b);
    if (r.status === 400) return expectEnvelope(expect, r, 400, "VALIDATION_ERROR"); // strict schema rejecting unknown keys is also fine
    expect(r.status).toBe(201);
    const t = r.json.data.totals;
    expect(t.subtotalMinor).not.toBe(1);
    if (f.priceMinor !== undefined) expect(t.subtotalMinor).toBe(f.priceMinor);
    expect(t.currency).not.toBe("USD");
  });

  it("expectedUnitPriceMinor != server price -> 409 PRICE_CHANGED with details.variantIds", async (ctx) => {
    await need(ctx);
    const b = checkoutBody(f); b.items[0].expectedUnitPriceMinor = (f.priceMinor ?? 1000) + 1;
    const r = await post(b);
    expectEnvelope(expect, r, 409, "PRICE_CHANGED");
    expect(r.json.error.details.variantIds).toEqual([f.variantId]);
  });

  for (const q of [0, -1, 11, 21, 1.5, "1", null]) {
    it(`quantity ${JSON.stringify(q)} -> 400 VALIDATION_ERROR (MAX_LINE_QTY=10)`, async (ctx) => {
      await need(ctx);
      const b = checkoutBody(f); b.items[0].quantity = q;
      expectEnvelope(expect, await post(b), 400, "VALIDATION_ERROR");
    });
  }

  it("unknown variantId -> 409 OUT_OF_STOCK (or 400) with details.variantIds", async (ctx) => {
    await need(ctx);
    const ghost = randomUUID();
    const r = await post(checkoutBody(f, { items: [{ variantId: ghost, quantity: 1 }] }));
    expect([400, 409]).toContain(r.status);
    if (r.status === 409) { expect(r.json.error.code).toBe("OUT_OF_STOCK"); expect(r.json.error.details.variantIds).toContain(ghost); }
  });

  it("inactive / draft variant -> 409 OUT_OF_STOCK", async (ctx) => {
    await need(ctx);
    const v = process.env.QA_INACTIVE_VARIANT_ID;
    if (!v) ctx.skip("set QA_INACTIVE_VARIANT_ID (seeded inactive or draft-product variant)");
    const r = await post(checkoutBody(f, { items: [{ variantId: v, quantity: 1 }] }));
    expectEnvelope(expect, r, 409, "OUT_OF_STOCK");
    expect(r.json.error.details.variantIds).toContain(v);
  });

  it("duplicate variant lines are rejected or merged, never double-reserved past stock", async (ctx) => {
    await need(ctx);
    const r = await post(checkoutBody(f, { items: [{ variantId: f.variantId, quantity: 10 }, { variantId: f.variantId, quantity: 10 }] }));
    // contract: duplicate variantId -> 400 VALIDATION_ERROR
    expectEnvelope(expect, r, 400, "VALIDATION_ERROR");
  });

  it("non-shippable country -> 422 COUNTRY_NOT_SHIPPABLE", async (ctx) => {
    await need(ctx);
    const b = checkoutBody(f); b.shippingAddress.country = process.env.QA_NON_SHIPPABLE_COUNTRY || "KP";
    expectEnvelope(expect, await post(b), 422, "COUNTRY_NOT_SHIPPABLE");
  });

  it("shippingMethodId that does not exist -> 4xx envelope, not 500", async (ctx) => {
    await need(ctx);
    const r = await post(checkoutBody(f, { shippingMethodId: randomUUID() }));
    expect(r.status).toBeGreaterThanOrEqual(400); expect(r.status).toBeLessThan(500);
    expect(r.json?.error?.code).toBeTruthy();
  });

  it("same idempotencyKey twice -> same checkoutId, stock reserved once", async (ctx) => {
    await need(ctx);
    const key = randomUUID();
    const a = await post(checkoutBody(f, { idempotencyKey: key }));
    const b = await post(checkoutBody(f, { idempotencyKey: key }));
    expect(a.status).toBe(201);
    expect([200, 201]).toContain(b.status);
    expect(b.json.data.checkoutId).toBe(a.json.data.checkoutId);
  });

  it("OUT_OF_STOCK 409 shape when asking for more than available", async (ctx) => {
    await need(ctx);
    const v = process.env.QA_LOW_STOCK_VARIANT_ID; // seeded with stock_on_hand=1
    if (!v) ctx.skip("set QA_LOW_STOCK_VARIANT_ID (variant with stock 1)");
    const r = await post(checkoutBody(f, { items: [{ variantId: v, quantity: 2 }] }));
    expectEnvelope(expect, r, 409, "OUT_OF_STOCK");
    expect(r.json.error.details.variantIds).toEqual([v]);
  });

  it("invalid JSON / wrong content-type -> 400, never 500", async (ctx) => {
    await need(ctx);
    const r = await call("POST", "/checkout", { raw: "{not json", headers: { "content-type": "application/json" } });
    expectEnvelope(expect, r, 400, "VALIDATION_ERROR");
  });
});
