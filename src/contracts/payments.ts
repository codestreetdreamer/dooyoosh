/**
 * Provider-agnostic payment boundary (spec §4, §11, §12.1). Owner of implementations: Payments & Orders
 * (src/server/payments/{provider.ts,mock.ts,stripe.ts,payme.ts,click.ts}). Signatures here are fixed by Architect.
 *
 * Webhook rules (spec §11): verify on RAW body; compare amount+currency with the DB checkout/order;
 * dedupe on payment_events(provider, event_id); always 200 once recorded (even stock_conflict).
 */
import { z } from "zod";
import type { CheckoutSnapshotLine, Totals } from "./checkout";
import { currency, isoDateTime, locale, nonNegativeMinor, paymentProvider, uuid, type PaymentProviderName } from "./common";

export { PAYMENT_PROVIDERS, paymentProvider, type PaymentProviderName } from "./common";

export const PAYMENT_STATUSES = ["requires_payment", "succeeded", "failed", "canceled", "refunded", "partially_refunded"] as const;
export const paymentStatus = z.enum(PAYMENT_STATUSES);
export type PaymentStatus = z.infer<typeof paymentStatus>;

export const REFUND_STATUSES = ["pending", "succeeded", "failed", "canceled"] as const;
export const refundStatus = z.enum(REFUND_STATUSES);

export const PAYMENT_EVENT_TYPES = ["payment.succeeded", "payment.failed", "payment.expired", "refund.succeeded"] as const;
export const paymentEventType = z.enum(PAYMENT_EVENT_TYPES);
export type PaymentEventType = z.infer<typeof paymentEventType>;

/** Input to createSession: server-computed snapshot only (never client prices). */
export interface CheckoutForPayment {
  checkoutId: string;
  email: string;
  locale: z.infer<typeof locale>;
  lines: CheckoutSnapshotLine[];
  totals: Totals;
  /** absolute URLs; success URL carries checkoutId + guest token */
  successUrl: string;
  cancelUrl: string;
  /** provider session must expire at/before this (30 min, spec v0.2) */
  expiresAt: Date;
  /** = checkoutId; passed to the provider as its idempotency key */
  idempotencyKey: string;
}

export interface CreateSessionResult {
  redirectUrl: string;
  /** stored in checkouts.provider_session_id; UNIQUE(provider, provider_session_id) */
  providerSessionId: string;
  expiresAt: Date;
}

/** Normalized webhook/callback event, identical for every provider. */
export const normalizedPaymentEvent = z.object({
  provider: paymentProvider,
  /** provider's event/transaction id; PK part of payment_events(provider, event_id) */
  eventId: z.string().min(1).max(255),
  type: paymentEventType,
  providerPaymentId: z.string().min(1).max(255),
  amountMinor: nonNegativeMinor,
  currency,
  /** our checkout id, echoed back by the provider (metadata / merchant trans id) */
  checkoutId: uuid,
  occurredAt: isoDateTime.optional(),
  /** provider refund id, only for refund.* */
  providerRefundId: z.string().optional(),
});
export type NormalizedPaymentEvent = z.infer<typeof normalizedPaymentEvent>;

/**
 * Some providers (Payme JSON-RPC, Click prepare/complete) require a synchronous, provider-specific
 * response body. verifyWebhook returns both the normalized event(s) and what to answer.
 */
export interface VerifiedWebhook {
  /** empty when the call is a provider handshake that changes nothing (e.g. Payme CheckPerformTransaction) */
  events: NormalizedPaymentEvent[];
  /** body + status the route must return to the provider */
  respond: (outcome: WebhookOutcome) => { status: number; body: string; headers?: Record<string, string> };
}

export type WebhookOutcome =
  | { kind: "processed" }
  | { kind: "duplicate" }
  | { kind: "stock_conflict"; orderReference: string }
  | { kind: "rejected"; reason: "amount_mismatch" | "unknown_checkout" | "expired" };

export interface RefundInput {
  providerPaymentId: string;
  amountMinor: number;
  currency: string;
  reason: string;
  /** e.g. refund row id; providers that support it dedupe on this */
  idempotencyKey: string;
}

/** Payme/Click may have no merchant-initiated refund API: staff refunds in the provider cabinet. */
export type RefundResult =
  | { status: z.infer<typeof refundStatus>; providerRefundId: string }
  | { status: "manual_required"; instructions: string };

export type PaymentMode = "sandbox" | "live";

/** Extra request facts some providers need (Click/Payme IP allow-lists). */
export interface WebhookRequestMeta {
  method: string;
  /** first hop of x-forwarded-for on Vercel */
  ip: string | null;
}

/** Row of provider_transactions: Payme/Click create a txn before our order exists. UNIQUE(provider, providerTxnId). */
export interface ProviderTransaction {
  provider: PaymentProviderName;
  providerTxnId: string;
  checkoutId: string;
  orderId: string | null;
  amountMinor: number;
  state: "created" | "performed" | "canceled" | "canceled_after_perform";
  createdAt: Date;
  performedAt: Date | null;
  canceledAt: Date | null;
  cancelReason: number | null;
}

/** Store access a synchronous callback handler may use. Implemented by Payments & Orders (src/server/payments/store.ts). */
export interface ProviderCallbackPort {
  getCheckout(checkoutId: string): Promise<{ id: string; status: string; amountMinor: number; currency: string; reservedUntil: Date } | null>;
  getTransaction(provider: PaymentProviderName, providerTxnId: string): Promise<ProviderTransaction | null>;
  saveTransaction(tx: ProviderTransaction): Promise<ProviderTransaction>;
  /** dedupe via payment_events + convert_checkout_to_order / refund; same path as verifyWebhook events */
  settle(event: NormalizedPaymentEvent): Promise<WebhookOutcome>;
}

export interface ProviderCallbackResult {
  status: number;
  body: string;
  headers?: Record<string, string>;
}

export interface PaymentProvider {
  readonly name: PaymentProviderName;
  readonly mode: PaymentMode;
  /** ISO 4217 codes this provider can charge; checkout refuses a market currency outside this list. */
  readonly supportedCurrencies: readonly string[] | "any";
  createSession(checkout: CheckoutForPayment): Promise<CreateSessionResult>;
  /** MUST be given the raw request body string. Throws ApiError(UNAUTHORIZED) on bad signature/token. */
  verifyWebhook(rawBody: string, headers: Headers, meta?: WebhookRequestMeta): Promise<VerifiedWebhook>;
  /**
   * Synchronous request/response providers (Payme JSON-RPC, Click prepare/complete). When present the
   * webhook route calls this INSTEAD of verifyWebhook. It must verify auth/signature itself first,
   * compare amounts to the DB, and return the provider's own error body (HTTP 200) on business errors.
   */
  handleCallback?(rawBody: string, headers: Headers, meta: WebhookRequestMeta, port: ProviderCallbackPort): Promise<ProviderCallbackResult>;
  /** Cancel an unpaid session before releasing stock (expiry cron). Idempotent; no-op if already closed. */
  cancel(providerSessionId: string): Promise<void>;
  refund(input: RefundInput): Promise<RefundResult>;
}

/** Route param for POST /api/v1/webhooks/{provider}. */
export const webhookParams = z.object({ provider: paymentProvider });

// ---- Admin view of a payment (used by admin.ts) ----
export const paymentSummary = z.object({
  id: uuid,
  provider: paymentProvider,
  providerPaymentId: z.string(),
  amountMinor: nonNegativeMinor,
  currency,
  status: paymentStatus,
  createdAt: isoDateTime,
});
export type PaymentSummary = z.infer<typeof paymentSummary>;

export const refundSummary = z.object({
  id: uuid,
  paymentId: uuid,
  amountMinor: nonNegativeMinor,
  reason: z.string().nullable(),
  providerRefundId: z.string().nullable(),
  status: refundStatus,
  createdAt: isoDateTime,
});
export type RefundSummary = z.infer<typeof refundSummary>;


// ---- POST /checkout/{checkoutId}/sandbox-pay, body {token, outcome} (sandbox only; 404 when PAYMENT_MODE=live) ----
export const sandboxPayParams = z.object({ checkoutId: uuid });
export const sandboxPayRequest = z.object({
  token: z.string().min(32).max(128),
  outcome: z.enum(["success", "fail"]).default("success"),
});
export const sandboxPayResponse = z.object({
  data: z.object({ callbacks: z.array(z.object({ status: z.number().int(), body: z.unknown() })) }),
});
export type SandboxPayResponse = z.infer<typeof sandboxPayResponse>;
