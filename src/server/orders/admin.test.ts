import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/errors";
import { createCheckout } from "../checkout/service";
import { simulateSandboxPayment } from "../payments/sandbox";
import { setup } from "../payments/__tests__/fixtures";
import { adminAdjustStock, adminCreateShipment, adminGetOrder, adminListOrders, adminRefundOrder, adminTransitionOrder } from "./admin";
import { ADMIN_DEV_ACTOR_ID, devTokenResolver, requireAdmin } from "./admin-auth";
import { getPublicOrder } from "./view";

const actor = { actorId: ADMIN_DEV_ACTOR_ID, role: "owner" as const };

async function apiError(p: Promise<unknown>) {
  try { await p; } catch (e) { if (e instanceof ApiError) return e; throw e; }
  throw new Error("expected ApiError");
}

async function paidOrder() {
  const f = setup();
  const d = await createCheckout(f.deps, f.provider, f.request());
  const token = d.accessToken!;
  await simulateSandboxPayment(f.deps, f.provider, d.checkoutId, token, "success");
  const order = (await f.deps.repo.getOrderByCheckout(d.checkoutId))!;
  return { f, d, token, order, providers: new Map([[f.provider.name, f.provider]]) };
}

describe("GET /orders/{reference} (guest)", () => {
  it("returns the guest-safe view with the right token", async () => {
    const { f, token, order } = await paidOrder();
    const o = await getPublicOrder(f.deps, order.reference, token);
    expect(o).toMatchObject({ reference: order.reference, status: "paid", currency: "UZS", totals: { totalMinor: 65_000_000 } });
    expect(o.items).toHaveLength(2);
    expect(JSON.stringify(o)).not.toMatch(/variantId|accessTokenHash|providerPaymentId/);
  });
  it("wrong token and unknown reference are both 404", async () => {
    const { f, order } = await paidOrder();
    expect((await apiError(getPublicOrder(f.deps, order.reference, "x".repeat(43)))).status).toBe(404);
    expect((await apiError(getPublicOrder(f.deps, "DY-20261022-AAAAA", "x".repeat(43)))).status).toBe(404);
  });
});

describe("admin auth (server-side)", () => {
  const env = { PAYMENTS_STORE: "memory", NODE_ENV: "development", ADMIN_DEV_TOKEN: "d".repeat(40) };
  const req = (h?: string) => new Request("http://x", { headers: h ? { authorization: h } : {} });
  it("fails closed without a resolver match", async () => {
    expect((await apiError(requireAdmin(req(), "orders", devTokenResolver(env)))).status).toBe(401);
    expect((await apiError(requireAdmin(req(`Bearer ${"e".repeat(40)}`), "orders", devTokenResolver(env)))).status).toBe(401);
    expect((await apiError(requireAdmin(req(`Bearer ${"d".repeat(40)}`), "orders", devTokenResolver({ ...env, NODE_ENV: "production" })))).status).toBe(401);
    expect((await apiError(requireAdmin(req(`Bearer ${"d".repeat(40)}`), "orders", devTokenResolver({ ...env, PAYMENTS_STORE: undefined })))).status).toBe(401);
  });
  it("QA P0: ADMIN_DEV_TOKEN is ignored in production / live even when set and correct", async () => {
    const good = req(`Bearer ${"d".repeat(40)}`);
    for (const over of [{ NODE_ENV: "production" }, { PAYMENT_MODE: "live" }, { NODE_ENV: "production", PAYMENT_MODE: "sandbox", ALLOW_MOCK_IN_PRODUCTION: "true" }]) {
      expect(await devTokenResolver({ ...env, ...over })(good)).toBeNull();
    }
    expect(await devTokenResolver({ ...env, PAYMENT_MODE: "sandbox" })(good)).toEqual(actor);
  });
  it("dev token works locally; role matrix enforced", async () => {
    expect(await requireAdmin(req(`Bearer ${"d".repeat(40)}`), "orders", devTokenResolver(env))).toEqual(actor);
    const editor = async () => ({ actorId: randomUUID(), role: "editor" as const });
    expect((await apiError(requireAdmin(req(), "orders", editor))).status).toBe(403);
  });
});

describe("admin orders", () => {
  it("list + detail", async () => {
    const { f, order } = await paidOrder();
    const l = await adminListOrders(f.deps, { limit: 10, status: "paid" });
    expect(l.data.map((x) => x.reference)).toEqual([order.reference]);
    expect(l.data[0]!.itemCount).toBe(3);
    expect((await adminListOrders(f.deps, { limit: 10, q: "nobody@" })).data).toHaveLength(0);
    const d = await adminGetOrder(f.deps, order.id);
    expect(d.payments[0]).toMatchObject({ provider: "mock", status: "succeeded", amountMinor: 65_000_000 });
    expect(d.events[0]).toMatchObject({ toStatus: "paid" });
  });

  it("transition refuses money/shipping statuses and illegal steps", async () => {
    const { f, order } = await paidOrder();
    for (const to of ["paid", "refunded", "shipped", "stock_conflict"] as const) {
      expect((await apiError(adminTransitionOrder(f.deps, order.id, to, undefined, actor))).status).toBe(400);
    }
    expect((await apiError(adminTransitionOrder(f.deps, order.id, "delivered", undefined, actor))).status).toBe(400);
    const o = await adminTransitionOrder(f.deps, order.id, "fulfilling", "packing", actor);
    expect(o.status).toBe("fulfilling");
    expect(o.events.at(-1)).toMatchObject({ fromStatus: "paid", toStatus: "fulfilling", actorId: ADMIN_DEV_ACTOR_ID });
  });

  it("cancel restocks once", async () => {
    const { f, order } = await paidOrder();
    expect(f.store.stock(f.v1).onHand).toBe(3);
    await adminTransitionOrder(f.deps, order.id, "cancelled", undefined, actor);
    await adminTransitionOrder(f.deps, order.id, "cancelled", undefined, actor);
    expect(f.store.stock(f.v1).onHand).toBe(5);
  });

  it("refund: partial then full, idempotent key, cannot exceed balance", async () => {
    const { f, order, providers } = await paidOrder();
    const k1 = randomUUID();
    const r1 = await adminRefundOrder(f.deps, providers, order.id, { amountMinor: 5_000_000, reason: "damaged", idempotencyKey: k1 }, actor);
    expect(r1).toMatchObject({ created: true, refund: { status: "succeeded", amountMinor: 5_000_000 } });
    expect((await f.deps.repo.getOrder(order.id))!.status).toBe("partially_refunded");
    const again = await adminRefundOrder(f.deps, providers, order.id, { amountMinor: 5_000_000, reason: "damaged", idempotencyKey: k1 }, actor);
    expect(again).toMatchObject({ created: false, refund: { id: r1.refund.id } });
    const over = await apiError(adminRefundOrder(f.deps, providers, order.id, { amountMinor: 60_000_001, reason: "x", idempotencyKey: randomUUID() }, actor));
    expect(over.status).toBe(400);
    await adminRefundOrder(f.deps, providers, order.id, { amountMinor: 60_000_000, reason: "rest", idempotencyKey: randomUUID() }, actor);
    const d = await adminGetOrder(f.deps, order.id);
    expect(d.status).toBe("refunded");
    expect(d.payments[0]!.status).toBe("refunded");
    expect(f.notifier.calls.filter((c) => c.startsWith("refunded:"))).toHaveLength(2);
  });

  it("shipment: paid -> fulfilling -> shipped, visible on guest page", async () => {
    const { f, order, token } = await paidOrder();
    const s = await adminCreateShipment(f.deps, order.id, { carrier: "UzPost", trackingNumber: "UZ123", trackingUrl: "https://track.example/UZ123" }, actor);
    expect(s.status).toBe("in_transit");
    const pub = await getPublicOrder(f.deps, order.reference, token);
    expect(pub.status).toBe("shipped");
    expect(pub.shipments[0]).toMatchObject({ carrier: "UzPost", trackingNumber: "UZ123" });
    expect((await apiError(adminCreateShipment(f.deps, order.id, { carrier: "UzPost", trackingNumber: "UZ124" }, actor))).status).toBe(400);
    expect(f.notifier.calls).toContain(`shipped:${order.reference}`);
  });

  it("adjust stock: counters returned, cannot go below reserved, unknown variant 404", async () => {
    const f = setup();
    expect(await adminAdjustStock(f.deps, f.v1, { delta: 3, reason: "restock" }, actor)).toEqual({ variantId: f.v1, stockOnHand: 8, stockReserved: 0 });
    await createCheckout(f.deps, f.provider, f.request());
    expect((await apiError(adminAdjustStock(f.deps, f.v1, { delta: -7, reason: "damage" }, actor))).status).toBe(400);
    expect((await apiError(adminAdjustStock(f.deps, randomUUID(), { delta: 1, reason: "restock" }, actor))).status).toBe(404);
    expect(f.store.s.movements.at(-1)).toMatchObject({ variantId: f.v1, delta: 3, actorId: ADMIN_DEV_ACTOR_ID });
  });
});
