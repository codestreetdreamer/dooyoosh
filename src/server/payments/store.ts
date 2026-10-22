/**
 * Persistence port for checkout, orders and payments. Owner: Payments & Orders.
 *
 * App code NEVER writes stock columns itself (spec §12.5). Every stock-affecting method maps 1:1 to a
 * Backend & Database SECURITY DEFINER function (service_role only); exact params land in docs/DATABASE.md:
 *   reserveCheckout          -> reserve_checkout
 *   convertCheckoutToOrder   -> convert_checkout_to_order (idempotent; reports stock_conflict)
 *   releaseCheckout          -> release_checkout
 *   releaseExpired           -> release_expired_reservations
 *   restockOrder             -> adjust_stock (reason 'return' | 'cancellation')
 *   recordPaymentEvent       -> record_payment_event
 * `memory-store.ts` is an in-memory fake with the same semantics, used by unit tests until the Postgres
 * implementation (src/server/payments/pg-store.ts, TODO after DATABASE.md) exists.
 */
import type { OrderStatus } from "@/contracts/orders";
import type { CheckoutStatus, CheckoutSnapshotLine } from "@/contracts/checkout";
import type { Address } from "@/contracts/common";
import type { PaymentProviderName } from "./types";

export interface VariantForCheckout {
  variantId: string;
  sku: string;
  productName: string;
  size: string | null;
  colour: string | null;
  /** variant.price_cents ?? product.base_price_cents, minor units */
  unitPriceMinor: number;
  currency: string;
  isActive: boolean;
  isPublished: boolean;
  /** stock_on_hand - stock_reserved (hint only; reserve_checkout is authoritative) */
  available: number;
  weightGrams: number | null;
}

export interface ShippingRateRow {
  minSubtotalMinor: number;
  maxWeightGrams: number | null;
  priceMinor: number;
  freeOverMinor: number | null;
}

export interface ShippingMethodForCheckout {
  methodId: string;
  isActive: boolean;
  marketCurrency: string;
  marketActive: boolean;
  /** countries.is_shippable for the destination and the country belongs to the method's market */
  countryShippable: boolean;
  rates: ShippingRateRow[];
}

export interface NewCheckout {
  id: string;
  idempotencyKey: string | null;
  email: string;
  phone: string | null;
  locale: string;
  currency: string;
  items: CheckoutSnapshotLine[];
  shippingAddress: Address;
  billingAddress: Address | null;
  shippingMethodId: string;
  subtotalMinor: number;
  shippingMinor: number;
  taxMinor: number;
  discountMinor: number;
  totalMinor: number;
  provider: PaymentProviderName;
  /** provider session expiry (30 min) -> checkouts.expires_at */
  expiresAt: Date;
  /** reservation expiry (35 min) -> stock_reservations.expires_at */
  reservedUntil: Date;
}

export interface CheckoutRow extends NewCheckout {
  status: CheckoutStatus;
  providerSessionId: string | null;
  createdAt: Date;
}

export type ReserveResult =
  | { ok: true; checkout: CheckoutRow; reused: boolean }
  | { ok: false; outOfStockVariantIds: string[] };

export interface OrderRow {
  id: string;
  reference: string;
  checkoutId: string;
  status: OrderStatus;
  totalMinor: number;
  currency: string;
  paidAt: Date | null;
}

export type ConvertResult =
  | { kind: "created" | "existing"; order: OrderRow }
  /** reservation was released/expired: order recorded as stock_conflict-candidate (pending_payment); caller transitions + refunds */
  | { kind: "stock_conflict"; order: OrderRow }
  /** conflictMode 'abort': nothing written, caller returns a provider error (Payme/Click) */
  | { kind: "reservation_inactive" }
  | { kind: "not_found" };

export interface ConvertInput {
  checkoutId: string;
  reference: string;
  accessTokenHash: string;
  provider: PaymentProviderName;
  providerPaymentId: string;
  amountMinor: number;
  currency: string;
  /** 'record' (Stripe/mock style: money already taken) or 'abort' (Payme/Click: we can still refuse the payment) */
  conflictMode: "record" | "abort";
  now: Date;
}

export interface OrderEventInput {
  type: string;
  fromStatus: OrderStatus;
  toStatus: OrderStatus;
  payload: Record<string, unknown>;
  actorId: string | null;
}

/** Provider-side transaction state for providers that call us before an order exists (Payme, Click). */
export interface ProviderTxn {
  provider: PaymentProviderName;
  /** Payme transaction id / Click click_trans_id */
  providerTxnId: string;
  /** monotonically increasing integer: Click merchant_prepare_id / merchant_confirm_id, Payme `transaction` */
  seq: number;
  checkoutId: string;
  amountMinor: number;
  currency: string;
  /** Payme states 1, 2, -1, -2 (developer.help.paycom.uz/metody-merchant-api/tipy-dannykh). Click: 1 prepared, 2 completed, -1 cancelled, -2 cancelled after complete. */
  state: 1 | 2 | -1 | -2;
  reason: number | null;
  /** provider's own creation time (Payme params.time), ms */
  providerTime: number;
  createTime: number;
  performTime: number;
  cancelTime: number;
  orderId: string | null;
  raw: Record<string, unknown>;
}

export interface CommerceStore {
  // ---- catalog / shipping reads (Backend-owned data, read-only here)
  getVariantsForCheckout(variantIds: string[], locale: string): Promise<VariantForCheckout[]>;
  getShippingMethod(methodId: string, countryIso2: string): Promise<ShippingMethodForCheckout | null>;

  // ---- checkout + stock (DB functions)
  reserveCheckout(input: NewCheckout): Promise<ReserveResult>;
  getCheckout(checkoutId: string): Promise<CheckoutRow | null>;
  setProviderSession(checkoutId: string, provider: PaymentProviderName, sessionId: string): Promise<void>;
  /** true if every reservation of the checkout is 'active' and not past expires_at */
  isReservationActive(checkoutId: string, now: Date): Promise<boolean>;
  releaseCheckout(checkoutId: string, status: "expired" | "failed"): Promise<void>;
  releaseExpired(now: Date): Promise<number>;
  convertCheckoutToOrder(input: ConvertInput): Promise<ConvertResult>;
  restockOrder(orderId: string, reason: "return" | "cancellation", note: string): Promise<void>;

  // ---- orders
  getOrder(orderId: string): Promise<OrderRow | null>;
  getOrderByCheckout(checkoutId: string): Promise<OrderRow | null>;
  /** compare-and-set status + insert order_events row in one transaction. false if status != from. */
  updateOrderStatus(orderId: string, event: OrderEventInput, now: Date): Promise<boolean>;

  // ---- payments
  /** insert into payment_events; 'duplicate' on PK(provider,event_id) conflict */
  recordPaymentEvent(provider: PaymentProviderName, eventId: string, type: string, payload: unknown): Promise<"inserted" | "duplicate">;
  markPaymentEventProcessed(provider: PaymentProviderName, eventId: string, error: string | null): Promise<void>;
  upsertPayment(p: { orderId: string; provider: PaymentProviderName; providerPaymentId: string; amountMinor: number; currency: string; status: "succeeded" | "refunded" | "failed"; raw: unknown }): Promise<{ paymentId: string }>;
  recordRefund(r: { providerPaymentId: string; provider: PaymentProviderName; amountMinor: number; reason: string; providerRefundId: string | null; status: "pending" | "succeeded" }): Promise<void>;

  // ---- provider transactions (SCHEMA REQUEST: table provider_transactions, see report)
  insertProviderTxn(t: Omit<ProviderTxn, "seq">): Promise<{ created: boolean; txn: ProviderTxn }>;
  getProviderTxn(provider: PaymentProviderName, providerTxnId: string): Promise<ProviderTxn | null>;
  getProviderTxnBySeq(provider: PaymentProviderName, seq: number): Promise<ProviderTxn | null>;
  /** transactions for a checkout in state 1 or 2 */
  findOpenProviderTxns(provider: PaymentProviderName, checkoutId: string): Promise<ProviderTxn[]>;
  /** compare-and-set on state; returns updated row or null if state changed underneath */
  updateProviderTxn(provider: PaymentProviderName, providerTxnId: string, expectedState: ProviderTxn["state"], patch: Partial<ProviderTxn>): Promise<ProviderTxn | null>;
  listProviderTxns(provider: PaymentProviderName, fromProviderTime: number, toProviderTime: number): Promise<ProviderTxn[]>;
}
