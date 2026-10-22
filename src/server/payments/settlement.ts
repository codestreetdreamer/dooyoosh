/**
 * Provider-independent settlement steps shared by all adapters. Owner: Payments & Orders.
 *  - capture: verified callback -> inventory.convert (convert_checkout_to_order, idempotent) -> payments row
 *  - stock_conflict auto-refund (spec §11)
 *  - refund after provider cancel (Payme CancelTransaction on a performed txn): order -> refunded, restock reason 'return'
 */
import { newOrderReference } from "../orders/reference";
import { assertPaymentCapture, transitionOrder, type TransitionCause } from "../orders/transitions";
import type { PaymentProvider, PaymentProviderName } from "./types";
import type { PaymentDeps } from "./deps";

export type CaptureResult =
  | { kind: "paid" | "already"; orderId: string; reference: string }
  | { kind: "stock_conflict"; orderId: string; reference: string; conflictVariantIds: string[] }
  | { kind: "not_found" };

export async function captureCheckout(
  deps: PaymentDeps,
  p: { provider: PaymentProviderName; checkoutId: string; providerPaymentId: string; amountMinor: number; currency: string; eventId: string; raw: unknown },
): Promise<CaptureResult> {
  const cause: TransitionCause = { kind: "provider_callback", provider: p.provider, eventId: p.eventId, verified: true };
  assertPaymentCapture(cause);
  const checkout = await deps.repo.getCheckout(p.checkoutId);
  if (!checkout) return { kind: "not_found" };
  const now = deps.now();
  const r = await deps.inventory.convert(p.checkoutId, {
    reference: newOrderReference(now),
    provider: p.provider,
    providerPaymentId: p.providerPaymentId,
    amountMinor: p.amountMinor,
    currency: p.currency,
    paidAt: now,
  });
  // money was taken in every branch -> record the payment (UNIQUE(provider, provider_payment_id) makes it idempotent)
  await deps.repo.upsertPayment({ orderId: r.orderId, provider: p.provider, providerPaymentId: p.providerPaymentId, amountMinor: p.amountMinor, currency: p.currency, status: "succeeded", raw: p.raw });
  if (r.status === "paid") {
    await deps.notifier.orderPaid({ orderId: r.orderId, reference: r.reference, checkoutId: p.checkoutId });
    return { kind: "paid", orderId: r.orderId, reference: r.reference };
  }
  if (r.status === "already_converted") {
    const order = await deps.repo.getOrder(r.orderId);
    if (order?.status === "stock_conflict") return { kind: "stock_conflict", orderId: r.orderId, reference: r.reference, conflictVariantIds: [] };
    return { kind: "already", orderId: r.orderId, reference: r.reference };
  }
  return { kind: "stock_conflict", orderId: r.orderId, reference: r.reference, conflictVariantIds: r.conflictVariantIds };
}

/** Late payment after reservation released (spec §11): refund automatically; order stock_conflict -> refunded. */
export async function refundStockConflict(
  deps: PaymentDeps,
  provider: PaymentProvider,
  p: { orderId: string; reference: string; providerPaymentId: string; amountMinor: number; currency: string },
): Promise<"succeeded" | "manual_required"> {
  const order = await deps.repo.getOrder(p.orderId);
  if (order?.status === "refunded") return "succeeded";
  const idempotencyKey = `stock_conflict:${p.orderId}`;
  const res = await provider.refund({ providerPaymentId: p.providerPaymentId, amountMinor: p.amountMinor, currency: p.currency, reason: "stock_conflict", idempotencyKey });
  if (res.status === "manual_required") {
    await deps.repo.recordRefund({ orderId: p.orderId, provider: provider.name, providerPaymentId: p.providerPaymentId, amountMinor: p.amountMinor, reason: "stock_conflict", providerRefundId: null, status: "pending", idempotencyKey });
    await deps.notifier.manualRefundRequired({ orderId: p.orderId, reference: p.reference, provider: provider.name, instructions: res.instructions });
    await deps.notifier.stockConflict({ orderId: p.orderId, reference: p.reference, refund: "manual_required" });
    return "manual_required";
  }
  await deps.repo.recordRefund({ orderId: p.orderId, provider: provider.name, providerPaymentId: p.providerPaymentId, amountMinor: p.amountMinor, reason: "stock_conflict", providerRefundId: res.providerRefundId, status: res.status === "succeeded" ? "succeeded" : "pending", idempotencyKey });
  if (res.status === "succeeded") {
    await transitionOrder(deps.repo, p.orderId, "refunded", { kind: "system", reason: "stock_conflict_refund" }, { providerRefundId: res.providerRefundId }, deps.now());
    await deps.repo.upsertPayment({ orderId: p.orderId, provider: provider.name, providerPaymentId: p.providerPaymentId, amountMinor: p.amountMinor, currency: p.currency, status: "refunded", raw: { refund: res } });
  }
  await deps.notifier.stockConflict({ orderId: p.orderId, reference: p.reference, refund: "succeeded" });
  return "succeeded";
}

/**
 * Provider already returned the money (Payme CancelTransaction on state 2, Click Complete error<0 after completion).
 * Caller MUST have won the provider-txn compare-and-set (2 -> -2), so this runs once per payment.
 * Restocks every line with reason 'return' unless the order never took stock (stock_conflict).
 */
export async function refundAfterProviderCancel(
  deps: PaymentDeps,
  p: { provider: PaymentProviderName; orderId: string; providerPaymentId: string; amountMinor: number; currency: string; eventId: string; reason: string },
): Promise<void> {
  const order = await deps.repo.getOrder(p.orderId);
  if (!order) throw new Error(`order ${p.orderId} not found for provider cancel`);
  const tookStock = order.status !== "stock_conflict" && order.status !== "refunded" && order.status !== "cancelled";
  const res = await transitionOrder(deps.repo, p.orderId, "refunded", { kind: "provider_callback", provider: p.provider, eventId: p.eventId, verified: true }, { reason: p.reason }, deps.now());
  await deps.repo.upsertPayment({ orderId: p.orderId, provider: p.provider, providerPaymentId: p.providerPaymentId, amountMinor: p.amountMinor, currency: p.currency, status: "refunded", raw: { cancel: p.reason } });
  await deps.repo.recordRefund({ orderId: p.orderId, provider: p.provider, providerPaymentId: p.providerPaymentId, amountMinor: p.amountMinor, reason: p.reason, providerRefundId: `${p.providerPaymentId}:cancel`, status: "succeeded", idempotencyKey: `provider_cancel:${p.provider}:${p.providerPaymentId}` });
  if (res.changed && tookStock) {
    await deps.inventory.restockOrder(p.orderId, "return", null, `${p.provider} cancel ${p.providerPaymentId} (${order.reference})`);
  }
  if (res.changed) await deps.notifier.orderRefunded({ orderId: p.orderId, reference: order.reference, amountMinor: p.amountMinor, currency: p.currency });
}
