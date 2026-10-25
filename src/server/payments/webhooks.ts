/**
 * Generic webhook pipeline for POST /api/v1/webhooks/{provider} (spec §4.3, §11). Owner: Payments & Orders.
 *
 * Order of checks: 1) signature/auth on the RAW body (inside provider.verifyWebhook)  2) payment_events dedupe
 * 3) checkout lookup  4) amount + currency + provider vs DB checkout  5) settle via convert_checkout_to_order.
 *
 * Merchant-callback providers (Payme JSON-RPC, Click Prepare/Complete) must answer synchronously with a
 * provider-specific body whose content depends on our state, so they do their stateful work inside verifyWebhook
 * (with their own idempotency on provider_transactions + payment_events) and return `events: []`.
 *
 * Dedupe nuance: an event already in payment_events but NOT marked processed (crash mid-way) is re-processed;
 * every step below is idempotent, so a retry completes the work instead of silently dropping a paid order.
 */
import { ApiError } from "@/lib/errors";
import type { NormalizedPaymentEvent, PaymentProvider, WebhookOutcome, WebhookRequestMeta } from "./types";
import type { PaymentDeps } from "./deps";
import { captureCheckout, refundStockConflict } from "./settlement";
import { transitionOrder } from "../orders/transitions";

export interface WebhookHttpResult {
  status: number;
  body: string;
  headers: Record<string, string>;
}

export async function handleWebhook(deps: PaymentDeps, provider: PaymentProvider, rawBody: string, headers: Headers, meta: WebhookRequestMeta): Promise<WebhookHttpResult> {
  let verified;
  try {
    verified = await provider.verifyWebhook(rawBody, headers, meta);
  } catch (e) {
    if (e instanceof ApiError) return { status: e.status, body: JSON.stringify(e.toJSON()), headers: { "content-type": "application/json" } };
    throw e;
  }
  let outcome: WebhookOutcome = { kind: "processed" };
  for (const ev of verified.events) outcome = await processEvent(deps, provider, ev);
  const r = verified.respond(outcome);
  return { status: r.status, body: r.body, headers: { "cache-control": "no-store", ...(r.headers ?? {}) } };
}

export async function processEvent(deps: PaymentDeps, provider: PaymentProvider, ev: NormalizedPaymentEvent): Promise<WebhookOutcome> {
  const { repo } = deps;
  const rec = await repo.recordPaymentEvent(provider.name, ev.eventId, ev.type, ev);
  if (!rec.inserted && rec.processed) return { kind: "duplicate" };

  const checkout = await repo.getCheckout(ev.checkoutId);
  if (!checkout) {
    await repo.markPaymentEventProcessed(provider.name, ev.eventId, "unknown_checkout");
    return { kind: "rejected", reason: "unknown_checkout" };
  }
  if (checkout.provider !== provider.name || ev.amountMinor !== checkout.totalMinor || ev.currency !== checkout.currency) {
    await repo.markPaymentEventProcessed(provider.name, ev.eventId, "amount_mismatch");
    return { kind: "rejected", reason: "amount_mismatch" };
  }

  let outcome: WebhookOutcome = { kind: "processed" };
  switch (ev.type) {
    case "payment.succeeded": {
      const r = await captureCheckout(deps, { provider: provider.name, checkoutId: ev.checkoutId, providerPaymentId: ev.providerPaymentId, amountMinor: ev.amountMinor, currency: ev.currency, eventId: ev.eventId, raw: ev });
      if (r.kind === "not_found") outcome = { kind: "rejected", reason: "unknown_checkout" };
      else if (r.kind === "stock_conflict") {
        await refundStockConflict(deps, provider, { orderId: r.orderId, reference: r.reference, providerPaymentId: ev.providerPaymentId, amountMinor: ev.amountMinor, currency: ev.currency });
        outcome = { kind: "stock_conflict", orderReference: r.reference };
      }
      break;
    }
    case "payment.failed":
    case "payment.expired": {
      const order = await repo.getOrderByCheckout(ev.checkoutId);
      if (!order) {
        await deps.inventory.release(ev.checkoutId, ev.type === "payment.failed" ? "payment_failed" : "expired");
        await repo.setCheckoutStatus(ev.checkoutId, ev.type === "payment.failed" ? "failed" : "expired");
      }
      break;
    }
    case "refund.succeeded": {
      const order = await repo.getOrderByCheckout(ev.checkoutId);
      if (order && order.status !== "refunded") {
        await transitionOrder(repo, order.id, "refunded", { kind: "provider_callback", provider: provider.name, eventId: ev.eventId, verified: true }, { providerRefundId: ev.providerRefundId ?? null }, deps.now());
      }
      break;
    }
  }
  await repo.markPaymentEventProcessed(provider.name, ev.eventId, null);
  return outcome;
}
