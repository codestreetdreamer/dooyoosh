/**
 * Persistence port for checkout, orders and payments (Payments & Orders-owned tables only). Owner: Payments & Orders.
 *
 * Stock is NOT here: every stock change goes through `InventoryService` (src/contracts/inventory.ts), implemented by
 * Backend & Database in src/server/inventory/reservations.ts over the SECURITY DEFINER functions
 * reserve_checkout / convert_checkout_to_order / release_checkout / release_expired_reservations / adjust_stock (spec §12.5).
 *
 * `memory-store.ts` implements this port AND a fake InventoryService with the same semantics, for unit tests and
 * local demo until the Postgres implementation lands (TODO: pg-store.ts once docs/DATABASE.md is published).
 */
import type { OrderStatus } from "@/contracts/orders";
import type { CheckoutStatus, CheckoutSnapshotLine } from "@/contracts/checkout";
import type { Address } from "@/contracts/common";
import type { PaymentProviderName, TxLike } from "./types";

/** Fiscal fields (spec §13, ZRU-792). Snapshotted per line; nullable for DEMO- seed data, required in live mode. */
export interface FiscalFields {
  ikpuCode: string | null;
  packageCode: string | null;
  /** VAT in basis points, 1200 = 12% */
  vatRateBp: number | null;
}

/** checkouts.items jsonb line = contract snapshot line + fiscal fields (PROPOSAL to Architect: add to contract). */
export type CheckoutLine = CheckoutSnapshotLine & FiscalFields;

export interface VariantForCheckout extends FiscalFields {
  variantId: string;
  sku: string;
  productName: string;
  size: string | null;
  colour: string | null;
  /** variant.price_cents ?? product.base_price_cents (minor units) */
  unitPriceMinor: number;
  currency: string;
  isActive: boolean;
  /** product published and not archived */
  isPublished: boolean;
  /** on_hand - reserved > 0 hint (exact count never leaves the server); reserve_checkout is authoritative */
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
  name: string;
  isActive: boolean;
  marketCurrency: string;
  marketActive: boolean;
  /** countries.is_shippable AND country.market_id = method.market_id */
  countryShippable: boolean;
  rates: ShippingRateRow[];
}

export interface NewCheckout {
  id: string;
  idempotencyKey: string | null;
  accessTokenHash: string;
  email: string;
  phone: string | null;
  locale: string;
  currency: string;
  items: CheckoutLine[];
  shippingAddress: Address;
  billingAddress: Address | null;
  shippingMethodId: string;
  shippingName: string;
  subtotalMinor: number;
  shippingMinor: number;
  taxMinor: number;
  discountMinor: number;
  totalMinor: number;
  provider: PaymentProviderName;
  /** provider session expiry (30 min) -> checkouts.expires_at */
  expiresAt: Date;
  /** stock reservation expiry (35 min) -> stock_reservations.expires_at */
  reservedUntil: Date;
}

export interface CheckoutRow extends NewCheckout {
  status: CheckoutStatus;
  providerSessionId: string | null;
  createdAt: Date;
}

export interface OrderRow {
  id: string;
  reference: string;
  checkoutId: string;
  status: OrderStatus;
  totalMinor: number;
  currency: string;
  items: CheckoutLine[];
  paidAt: Date | null;
}

/** Full order read model for GET /orders/{reference} and the admin views (orders + items + payments + refunds + shipments + events). */
export interface OrderDetail extends OrderRow {
  email: string;
  phone: string | null;
  locale: string;
  accessTokenHash: string;
  shippingAddress: Address;
  billingAddress: Address | null;
  shippingMethodId: string;
  subtotalMinor: number;
  shippingMinor: number;
  taxMinor: number;
  discountMinor: number;
  placedAt: Date;
  updatedAt: Date;
  payments: PaymentRow[];
  refunds: RefundRow[];
  shipments: ShipmentRow[];
  events: OrderEventRow[];
}
export interface PaymentRow { id: string; provider: PaymentProviderName; providerPaymentId: string; amountMinor: number; currency: string; status: "succeeded" | "refunded" | "partially_refunded" | "failed" | "canceled"; createdAt: Date }
export interface RefundRow { id: string; paymentId: string; orderId: string; amountMinor: number; reason: string | null; providerRefundId: string | null; status: "pending" | "succeeded" | "failed" | "canceled"; idempotencyKey: string; createdAt: Date }
export interface ShipmentRow { id: string; orderId: string; carrier: string; trackingNumber: string | null; trackingUrl: string | null; status: "label_created" | "in_transit" | "delivered" | "exception"; shippedAt: Date | null; deliveredAt: Date | null }
export interface OrderEventRow { id: string; type: string; fromStatus: OrderStatus | null; toStatus: OrderStatus | null; payload: unknown; actorId: string | null; createdAt: Date }
export interface OrderListQuery { status?: OrderStatus; q?: string; cursor?: string; limit: number }
export interface OrderListItem { id: string; reference: string; email: string; status: OrderStatus; currency: string; totalMinor: number; itemCount: number; placedAt: Date; paidAt: Date | null }

export interface OrderEventInput {
  type: string;
  fromStatus: OrderStatus;
  toStatus: OrderStatus;
  payload: Record<string, unknown>;
  actorId: string | null;
}

/**
 * Provider-side transaction for merchant-callback providers that call us BEFORE an order exists (Payme, Click).
 * SCHEMA REQUEST (Backend): table `provider_transactions` — see report.
 */
export interface ProviderTxn {
  provider: PaymentProviderName;
  /** Payme params.id (24 chars) / Click click_trans_id */
  providerTxnId: string;
  /** bigserial: Click merchant_prepare_id / merchant_confirm_id; Payme `transaction` (stringified) */
  seq: number;
  checkoutId: string;
  amountMinor: number;
  currency: string;
  /** 1 created/prepared, 2 performed/completed, -1 cancelled, -2 cancelled after perform (Payme tipy-dannykh) */
  state: 1 | 2 | -1 | -2;
  /** Payme cancel reason code (1..5, 10) */
  reason: number | null;
  /** provider's own creation time (Payme params.time, ms); GetStatement filters on it */
  providerTime: number;
  createTime: number;
  performTime: number;
  cancelTime: number;
  orderId: string | null;
  raw: Record<string, unknown>;
}

export interface CommerceRepo {
  runInTransaction<T>(fn: (tx: TxLike) => Promise<T>): Promise<T>;

  // ---- reads of Backend-owned catalog/shipping data
  getVariantsForCheckout(variantIds: string[], locale: string): Promise<VariantForCheckout[]>;
  /** admin only: exact counters (never exposed publicly) */
  getVariantStock(variantId: string): Promise<{ stockOnHand: number; stockReserved: number }>;
  getShippingMethod(methodId: string, countryIso2: string): Promise<ShippingMethodForCheckout | null>;

  // ---- checkouts
  insertCheckout(c: NewCheckout, tx?: TxLike): Promise<void>;
  getCheckout(checkoutId: string): Promise<CheckoutRow | null>;
  getCheckoutByIdempotencyKey(key: string): Promise<CheckoutRow | null>;
  setProviderSession(checkoutId: string, sessionId: string): Promise<void>;
  setCheckoutStatus(checkoutId: string, status: CheckoutStatus): Promise<void>;
  listExpiredCheckouts(now: Date, limit: number): Promise<CheckoutRow[]>;
  /** read-only: every stock_reservations row for the checkout is 'active' AND expires_at > now */
  isReservationActive(checkoutId: string, now: Date): Promise<boolean>;

  // ---- orders
  getOrder(orderId: string): Promise<OrderRow | null>;
  getOrderByCheckout(checkoutId: string): Promise<OrderRow | null>;
  /** compare-and-set status + insert order_events in ONE transaction; false if current status != event.fromStatus */
  updateOrderStatus(orderId: string, event: OrderEventInput, now: Date): Promise<boolean>;

  // ---- order reads / fulfilment (admin + guest order page)
  getOrderDetail(orderId: string): Promise<OrderDetail | null>;
  getOrderIdByReference(reference: string): Promise<string | null>;
  /** newest first; cursor is opaque (memory: offset; pg: placed_at/id keyset) */
  listOrders(q: OrderListQuery): Promise<{ items: OrderListItem[]; nextCursor: string | null }>;
  insertShipment(s: Omit<ShipmentRow, "id">): Promise<ShipmentRow>;
  getRefundByIdempotencyKey(key: string): Promise<RefundRow | null>;

  // ---- payments
  /** payment_events insert; on PK conflict returns the existing row's processed flag */
  recordPaymentEvent(provider: PaymentProviderName, eventId: string, type: string, payload: unknown): Promise<{ inserted: boolean; processed: boolean }>;
  markPaymentEventProcessed(provider: PaymentProviderName, eventId: string, error: string | null): Promise<void>;
  upsertPayment(p: { orderId: string; provider: PaymentProviderName; providerPaymentId: string; amountMinor: number; currency: string; status: PaymentRow["status"]; raw: unknown }): Promise<void>;
  recordRefund(r: { orderId: string; provider: PaymentProviderName; providerPaymentId: string; amountMinor: number; reason: string; providerRefundId: string | null; status: "pending" | "succeeded"; idempotencyKey: string }): Promise<RefundRow>;

  // ---- provider transactions (Payme/Click)
  insertProviderTxn(t: Omit<ProviderTxn, "seq">): Promise<{ created: boolean; txn: ProviderTxn }>;
  getProviderTxn(provider: PaymentProviderName, providerTxnId: string): Promise<ProviderTxn | null>;
  getProviderTxnBySeq(provider: PaymentProviderName, seq: number): Promise<ProviderTxn | null>;
  /** transactions of the checkout in state 1 or 2 */
  findOpenProviderTxns(provider: PaymentProviderName, checkoutId: string): Promise<ProviderTxn[]>;
  /** compare-and-set on state; null if the state changed underneath (concurrent retry) */
  updateProviderTxn(provider: PaymentProviderName, providerTxnId: string, expectedState: ProviderTxn["state"], patch: Partial<ProviderTxn>): Promise<ProviderTxn | null>;
  listProviderTxns(provider: PaymentProviderName, fromProviderTime: number, toProviderTime: number): Promise<ProviderTxn[]>;
}
