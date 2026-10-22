/**
 * Admin order operations (CONTRACTS adminListOrders / adminGetOrder / adminTransitionOrder / adminRefundOrder /
 * adminCreateShipment / adminAdjustStock). Owner: Payments & Orders. Callers MUST have passed requireAdmin().
 * Every status change goes through transitions.ts (single state machine).
 */
import type { OrderStatus } from "@/contracts/orders";
import type { AdminOrder } from "@/contracts/admin";
import type { RefundSummary } from "@/contracts/payments";
import { ApiError } from "@/lib/errors";
import type { PaymentDeps } from "../payments/deps";
import type { PaymentProvider } from "../payments/types";
import type { OrderDetail, OrderListQuery, RefundRow } from "../payments/store";
import { TransitionError, transitionOrder } from "./transitions";
import { toAdminOrder } from "./view";
import type { AdminPrincipal } from "./admin-auth";

async function load(deps: PaymentDeps, id: string): Promise<OrderDetail> {
  const o = await deps.repo.getOrderDetail(id);
  if (!o) throw ApiError.notFound("order not found");
  return o;
}

async function move(deps: PaymentDeps, id: string, to: OrderStatus, actor: AdminPrincipal, payload: Record<string, unknown>) {
  try {
    return await transitionOrder(deps.repo, id, to, { kind: "admin", actorId: actor.actorId, note: payload.note as string | undefined }, payload, deps.now());
  } catch (e) {
    if (e instanceof TransitionError) {
      if (e.code === "NOT_FOUND") throw ApiError.notFound("order not found");
      throw ApiError.validation(e.message, [{ code: e.code, to }]);
    }
    throw e;
  }
}

export async function adminListOrders(deps: PaymentDeps, q: OrderListQuery) {
  const { items, nextCursor } = await deps.repo.listOrders(q);
  return {
    data: items.map((i) => ({ ...i, placedAt: i.placedAt.toISOString(), paidAt: i.paidAt ? i.paidAt.toISOString() : null })),
    page: { cursor: nextCursor, limit: q.limit },
  };
}

export async function adminGetOrder(deps: PaymentDeps, id: string): Promise<AdminOrder> {
  return toAdminOrder(await load(deps, id));
}

/** Statuses an admin may set through /transition. Money and shipping have their own endpoints. */
const VIA_OTHER: Partial<Record<OrderStatus, string>> = {
  paid: "only a verified provider callback can mark an order paid",
  stock_conflict: "set by the payment pipeline only",
  pending_payment: "initial state only",
  refunded: "use POST /admin/orders/{id}/refund",
  partially_refunded: "use POST /admin/orders/{id}/refund",
  shipped: "use POST /admin/orders/{id}/shipments",
};

export async function adminTransitionOrder(deps: PaymentDeps, id: string, to: OrderStatus, note: string | undefined, actor: AdminPrincipal): Promise<AdminOrder> {
  const why = VIA_OTHER[to];
  if (why) throw ApiError.validation(why, [{ code: "NOT_ALLOWED", to }]);
  const before = await load(deps, id);
  const r = await move(deps, id, to, actor, note ? { note } : {});
  // Cancelling an order that already took stock puts it back (once: only when this call changed the status).
  // Money is NOT returned automatically; the admin refunds via /refund (the UI should prompt).
  if (to === "cancelled" && r.changed && ["paid", "fulfilling", "partially_refunded"].includes(before.status)) {
    await deps.inventory.restockOrder(id, "cancellation", actor.actorId, `admin cancel ${before.reference}`);
  }
  return toAdminOrder(await load(deps, id));
}

const REFUNDABLE: OrderStatus[] = ["paid", "fulfilling", "shipped", "delivered", "partially_refunded", "cancelled", "stock_conflict"];
const refundView = (r: RefundRow): RefundSummary => ({ id: r.id, paymentId: r.paymentId, amountMinor: r.amountMinor, reason: r.reason, providerRefundId: r.providerRefundId, status: r.status, createdAt: r.createdAt.toISOString() });

export async function adminRefundOrder(
  deps: PaymentDeps, providers: Map<string, PaymentProvider>, id: string,
  req: { amountMinor: number; reason: string; idempotencyKey: string }, actor: AdminPrincipal,
): Promise<{ refund: RefundSummary; created: boolean }> {
  const key = `admin:${req.idempotencyKey}`;
  const prev = await deps.repo.getRefundByIdempotencyKey(key);
  if (prev) {
    if (prev.orderId !== id) throw ApiError.validation("idempotencyKey already used for another order");
    return { refund: refundView(prev), created: false };
  }
  const o = await load(deps, id);
  if (!REFUNDABLE.includes(o.status)) throw ApiError.validation(`order in status ${o.status} cannot be refunded`);
  const pay = o.payments.find((p) => p.status === "succeeded" || p.status === "partially_refunded");
  if (!pay) throw ApiError.validation("order has no captured payment");
  const already = o.refunds.filter((r) => r.status === "pending" || r.status === "succeeded").reduce((n, r) => n + r.amountMinor, 0);
  const remaining = pay.amountMinor - already;
  if (req.amountMinor > remaining) throw ApiError.validation(`amount exceeds refundable balance (${remaining})`, [{ code: "AMOUNT_TOO_HIGH", remaining }]);
  const provider = providers.get(pay.provider);
  let res: Awaited<ReturnType<PaymentProvider["refund"]>>;
  try {
    res = provider
      ? await provider.refund({ providerPaymentId: pay.providerPaymentId, amountMinor: req.amountMinor, currency: pay.currency, reason: req.reason, idempotencyKey: key })
      : { status: "manual_required", instructions: `provider ${pay.provider} not enabled in this deployment; refund in its cabinet` };
  } catch {
    throw ApiError.payment("refund request to the payment provider failed");
  }
  if (res.status === "failed" || res.status === "canceled") throw ApiError.payment(`provider refused the refund (${res.status})`);
  const succeeded = res.status === "succeeded";
  const providerRefundId = "providerRefundId" in res ? res.providerRefundId : null;
  const row = await deps.repo.recordRefund({
    orderId: id, provider: pay.provider, providerPaymentId: pay.providerPaymentId, amountMinor: req.amountMinor, reason: req.reason,
    providerRefundId, status: succeeded ? "succeeded" : "pending", idempotencyKey: key,
  });
  if (res.status === "manual_required") {
    await deps.notifier.manualRefundRequired({ orderId: id, reference: o.reference, provider: pay.provider, instructions: res.instructions });
  } else if (succeeded) {
    const full = already + req.amountMinor >= pay.amountMinor;
    await move(deps, id, full ? "refunded" : "partially_refunded", actor, { refundId: row.id, amountMinor: req.amountMinor, reason: req.reason });
    await deps.repo.upsertPayment({ orderId: id, provider: pay.provider, providerPaymentId: pay.providerPaymentId, amountMinor: pay.amountMinor, currency: pay.currency, status: full ? "refunded" : "partially_refunded", raw: { refund: res } });
    await deps.notifier.orderRefunded({ orderId: id, reference: o.reference, amountMinor: req.amountMinor, currency: pay.currency });
  }
  return { refund: refundView(row), created: true };
}

export async function adminCreateShipment(
  deps: PaymentDeps, id: string, req: { carrier: string; trackingNumber: string; trackingUrl?: string }, actor: AdminPrincipal,
) {
  const o = await load(deps, id);
  if (!["paid", "fulfilling", "partially_refunded"].includes(o.status)) throw ApiError.validation(`order in status ${o.status} cannot be shipped`);
  if (o.status === "paid") await move(deps, id, "fulfilling", actor, { note: "auto before shipment" });
  const now = deps.now();
  const s = await deps.repo.insertShipment({ orderId: id, carrier: req.carrier, trackingNumber: req.trackingNumber, trackingUrl: req.trackingUrl ?? null, status: "in_transit", shippedAt: now, deliveredAt: null });
  await move(deps, id, "shipped", actor, { shipmentId: s.id, carrier: s.carrier, trackingNumber: s.trackingNumber });
  await deps.notifier.orderShipped({ orderId: id, reference: o.reference, carrier: s.carrier, trackingNumber: s.trackingNumber, trackingUrl: s.trackingUrl });
  return { id: s.id, carrier: s.carrier, trackingNumber: s.trackingNumber, trackingUrl: s.trackingUrl, status: s.status, shippedAt: now.toISOString(), deliveredAt: null };
}

export async function adminAdjustStock(deps: PaymentDeps, variantId: string, req: { delta: number; reason: "restock" | "adjustment" | "return" | "damage"; note?: string }, actor: AdminPrincipal) {
  if ((await deps.repo.getVariantsForCheckout([variantId], "en")).length === 0) throw ApiError.notFound("variant not found");
  try {
    await deps.inventory.adjust({ variantId, ...req }, actor.actorId);
  } catch {
    throw ApiError.validation("stock would go below zero or below reserved units", [{ code: "INVALID_DELTA" }]);
  }
  const s = await deps.repo.getVariantStock(variantId);
  return { variantId, stockOnHand: s.stockOnHand, stockReserved: s.stockReserved };
}
