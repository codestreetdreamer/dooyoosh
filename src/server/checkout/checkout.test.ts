import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/errors";
import { createCheckout, getCheckoutStatus, releaseExpiredCheckouts } from "./service";
import { deriveAccessToken } from "./token";
import { handleWebhook } from "../payments/webhooks";
import { MOCK_SIGNATURE_HEADER, signMockPayload } from "../payments/mock";
import { SECRET, TOKEN_SECRET, setup } from "../payments/__tests__/fixtures";

async function apiError(p: Promise<unknown>) {
  try { await p; } catch (e) { if (e instanceof ApiError) return e; throw e; }
  throw new Error("expected ApiError");
}

function mockWebhook(f: ReturnType<typeof setup>, body: Record<string, unknown>, secret = SECRET) {
  const raw = JSON.stringify({ provider: "mock", ...body });
  const headers = new Headers({ [MOCK_SIGNATURE_HEADER]: signMockPayload(secret, raw, Math.floor(f.clock.now().getTime() / 1000)) });
  return handleWebhook(f.deps, f.provider, raw, headers, { method: "POST", ip: null });
}

describe("createCheckout", () => {
  it("recomputes totals, reserves stock atomically, 30 min session / 35 min reservation", async () => {
    const f = setup();
    const d = await createCheckout(f.deps, f.provider, f.request());
    expect(d.totals).toEqual({ currency: "UZS", subtotalMinor: 62_000_000, shippingMinor: 3_000_000, taxMinor: 0, discountMinor: 0, totalMinor: 65_000_000 });
    expect(Date.parse(d.expiresAt) - f.clock.t).toBe(30 * 60_000);
    expect(Date.parse(d.reservedUntil) - f.clock.t).toBe(35 * 60_000);
    expect(f.store.stock(f.v1)).toEqual({ onHand: 5, reserved: 2 });
    expect(f.store.s.checkouts.get(d.checkoutId)!.status).toBe("awaiting_payment");
    expect(d.redirectUrl).toContain("/en/checkout/sandbox-pay?checkoutId=");
  });

  it("all-or-nothing: one line short -> 409 OUT_OF_STOCK, nothing reserved, no checkout row", async () => {
    const f = setup("mock", { stock: 1 });
    const e = await apiError(createCheckout(f.deps, f.provider, f.request()));
    expect(e.code).toBe("OUT_OF_STOCK");
    expect(e.details).toEqual({ variantIds: [f.v1] });
    expect(f.store.stock(f.v2).reserved).toBe(0);
    expect(f.store.s.checkouts.size).toBe(0);
  });

  it("race: last unit reserved by first checkout -> second gets OUT_OF_STOCK from reserve and is rolled back", async () => {
    const f = setup("mock", { stock: 1 });
    const req = f.request({ items: [{ variantId: f.v1, quantity: 1 }] });
    const results = await Promise.allSettled([createCheckout(f.deps, f.provider, req), createCheckout(f.deps, f.provider, req)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(f.store.stock(f.v1)).toEqual({ onHand: 1, reserved: 1 });
    expect(f.store.s.checkouts.size).toBe(1);
  });

  it("negative / zero quantity never reaches the reservation (QA-07)", async () => {
    const f = setup();
    for (const q of [-1, 0, 2.5]) {
      const e = await apiError(createCheckout(f.deps, f.provider, f.request({ items: [{ variantId: f.v1, quantity: q }] })));
      expect(e.code).toBe("VALIDATION_ERROR");
    }
    expect(f.store.stock(f.v1).reserved).toBe(0);
  });

  it("idempotencyKey: retry returns the same checkout, no second reservation", async () => {
    const f = setup();
    const key = randomUUID();
    const a = await createCheckout(f.deps, f.provider, f.request({ idempotencyKey: key }));
    const b = await createCheckout(f.deps, f.provider, f.request({ idempotencyKey: key }));
    expect(b.checkoutId).toBe(a.checkoutId);
    expect(f.store.stock(f.v1).reserved).toBe(2);
  });

  it("refuses a currency the provider cannot charge", async () => {
    const f = setup("payme");
    f.store.s.shipping.get(f.methodId)!.marketCurrency = "EUR";
    for (const v of f.store.s.variants.values()) v.currency = "EUR";
    const e = await apiError(createCheckout(f.deps, f.provider, f.request()));
    expect(e.code).toBe("PAYMENT_ERROR");
  });

  it("live mode refuses DEMO- IKPU codes; sandbox allows them", async () => {
    const live = setup("payme", { mode: "live", fiscal: true });
    live.store.s.variants.get(live.v1)!.ikpuCode = "DEMO-06109001";
    const e = await apiError(createCheckout(live.deps, live.provider, live.request()));
    expect(e.details.variantIds).toEqual([live.v1]);
    const sb = setup("payme", { fiscal: true });
    sb.store.s.variants.get(sb.v1)!.ikpuCode = "DEMO-06109001";
    const d = await createCheckout(sb.deps, sb.provider, sb.request());
    const url = Buffer.from(d.redirectUrl.split("/").pop()!, "base64").toString();
    expect(url).toContain(`c=https://shop.example/en/checkout/return?checkoutId=${d.checkoutId}&token=`);
    expect(d.redirectUrl.startsWith("https://test.paycom.uz/")).toBe(true);
  });

  it("live mode refuses products without IKPU/package/VAT", async () => {
    const f = setup("payme", { mode: "live" });
    const e = await apiError(createCheckout(f.deps, f.provider, f.request()));
    expect(e.code).toBe("PAYMENT_ERROR");
    expect(e.details.variantIds).toEqual([f.v1, f.v2]);
  });
});

describe("mock provider end to end", () => {
  it("signed success -> order paid, stock sold once; duplicate delivery is a no-op", async () => {
    const f = setup();
    const d = await createCheckout(f.deps, f.provider, f.request());
    const ev = { eventId: "evt_1", type: "payment.succeeded", providerPaymentId: "pi_1", amountMinor: d.totals.totalMinor, currency: "UZS", checkoutId: d.checkoutId };
    const r1 = await mockWebhook(f, ev);
    expect(r1.status).toBe(200);
    const r2 = await mockWebhook(f, ev);
    expect(JSON.parse(r2.body).outcome).toBe("duplicate");
    expect(f.store.s.orders.size).toBe(1);
    const order = [...f.store.s.orders.values()][0]!;
    expect(order.status).toBe("paid");
    expect(f.store.stock(f.v1)).toEqual({ onHand: 3, reserved: 0 });
    expect(f.store.s.movements.filter((m) => m.reason === "sale")).toHaveLength(2);
    const token = deriveAccessToken(TOKEN_SECRET, d.checkoutId);
    expect(await getCheckoutStatus(f.deps, d.checkoutId, token)).toEqual({ checkoutStatus: "completed", orderReference: order.reference, orderStatus: "paid" });
  });

  it("same payment under a new event id still creates only one order", async () => {
    const f = setup();
    const d = await createCheckout(f.deps, f.provider, f.request());
    for (const id of ["evt_a", "evt_b"]) await mockWebhook(f, { eventId: id, type: "payment.succeeded", providerPaymentId: "pi_1", amountMinor: d.totals.totalMinor, currency: "UZS", checkoutId: d.checkoutId });
    expect(f.store.s.orders.size).toBe(1);
    expect(f.store.stock(f.v1).onHand).toBe(3);
  });

  it("bad signature -> 401, nothing recorded", async () => {
    const f = setup();
    const d = await createCheckout(f.deps, f.provider, f.request());
    const r = await mockWebhook(f, { eventId: "evt_x", type: "payment.succeeded", providerPaymentId: "pi", amountMinor: d.totals.totalMinor, currency: "UZS", checkoutId: d.checkoutId }, "wrong-secret");
    expect(r.status).toBe(401);
    expect(f.store.s.paymentEvents.size).toBe(0);
    expect(f.store.s.orders.size).toBe(0);
  });

  it("amount or currency mismatch -> rejected, no order", async () => {
    const f = setup();
    const d = await createCheckout(f.deps, f.provider, f.request());
    const r = await mockWebhook(f, { eventId: "evt_m", type: "payment.succeeded", providerPaymentId: "pi", amountMinor: 1, currency: "UZS", checkoutId: d.checkoutId });
    expect(r.status).toBe(400);
    const r2 = await mockWebhook(f, { eventId: "evt_c", type: "payment.succeeded", providerPaymentId: "pi", amountMinor: d.totals.totalMinor, currency: "EUR", checkoutId: d.checkoutId });
    expect(r2.status).toBe(400);
    expect(f.store.s.orders.size).toBe(0);
  });

  it("late success after reservation expired -> stock_conflict, auto refund, other buyer keeps the unit (QA-06)", async () => {
    const f = setup("mock", { stock: 1 });
    const a = await createCheckout(f.deps, f.provider, f.request({ items: [{ variantId: f.v1, quantity: 1 }] }));
    f.clock.advanceMin(36);
    await releaseExpiredCheckouts(f.deps, f.provider);
    const b = await createCheckout(f.deps, f.provider, f.request({ items: [{ variantId: f.v1, quantity: 1 }], email: "b@example.com" }));
    const r = await mockWebhook(f, { eventId: "evt_late", type: "payment.succeeded", providerPaymentId: "pi_late", amountMinor: a.totals.totalMinor, currency: "UZS", checkoutId: a.checkoutId });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).outcome).toBe("stock_conflict");
    const order = [...f.store.s.orders.values()][0]!;
    expect(order.status).toBe("refunded");
    expect(f.store.stock(f.v1)).toEqual({ onHand: 1, reserved: 1 }); // B's reservation intact
    expect(f.notifier.calls.some((c) => c.startsWith("conflict:"))).toBe(true);
    expect(b.checkoutId).not.toBe(a.checkoutId);
  });

  it("payment.failed releases the reservation", async () => {
    const f = setup();
    const d = await createCheckout(f.deps, f.provider, f.request());
    await mockWebhook(f, { eventId: "evt_f", type: "payment.failed", providerPaymentId: "pi", amountMinor: d.totals.totalMinor, currency: "UZS", checkoutId: d.checkoutId });
    expect(f.store.stock(f.v1).reserved).toBe(0);
    expect(f.store.s.checkouts.get(d.checkoutId)!.status).toBe("failed");
  });

  it("status endpoint: wrong token -> 404", async () => {
    const f = setup();
    const d = await createCheckout(f.deps, f.provider, f.request());
    const e = await apiError(getCheckoutStatus(f.deps, d.checkoutId, "x".repeat(43)));
    expect(e.code).toBe("NOT_FOUND");
  });

  it("cron releases expired checkouts only after 35 min", async () => {
    const f = setup();
    await createCheckout(f.deps, f.provider, f.request());
    f.clock.advanceMin(31);
    expect((await releaseExpiredCheckouts(f.deps, f.provider)).checkoutsExpired).toBe(0);
    f.clock.advanceMin(5);
    expect(await releaseExpiredCheckouts(f.deps, f.provider)).toEqual({ checkoutsExpired: 1, reservationsReleased: 2 });
    expect(f.store.stock(f.v1).reserved).toBe(0);
  });
});
