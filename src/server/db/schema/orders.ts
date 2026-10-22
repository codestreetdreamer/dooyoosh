import { sql } from "drizzle-orm";
import { bigint, char, check, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { boolean } from "drizzle-orm/pg-core";
import { createdAt, currencyCheck, id, localeCheck, updatedAt } from "./_common";
import { productVariants } from "./catalog";
import { shippingMethods } from "./markets";

/** B15: fixed list of order_events.type values. */
export const ORDER_EVENT_TYPES = [
  "status_changed", "payment_received", "payment_failed", "stock_conflict", "refund_requested",
  "refund_succeeded", "shipment_created", "email_sent", "note", "stock_restocked",
] as const;
const ORDER_EVENT_TYPES_SQL = sql.raw(`(${ORDER_EVENT_TYPES.map((t) => `'${t}'`).join(",")})`);

export const checkoutStatus = pgEnum("checkout_status", ["open", "awaiting_payment", "completed", "expired", "failed"]);
export const orderStatus = pgEnum("order_status", [
  "pending_payment", "paid", "stock_conflict", "fulfilling", "shipped", "delivered", "cancelled", "refunded", "partially_refunded",
]);
export const paymentProvider = pgEnum("payment_provider", ["mock", "stripe", "payme", "click"]);
export const paymentStatus = pgEnum("payment_status", ["requires_payment", "succeeded", "failed", "canceled", "refunded", "partially_refunded"]);
export const refundStatus = pgEnum("refund_status", ["pending", "succeeded", "failed", "canceled"]);
export const shipmentStatus = pgEnum("shipment_status", ["label_created", "in_transit", "delivered", "exception"]);

export const checkouts = pgTable("checkouts", {
  id: id(),
  email: text("email").notNull(),
  phone: text("phone"),
  locale: text("locale").notNull(),
  // minor units of `currency` (tiyin for UZS); copied from markets.currency, never defaulted
  currency: char("currency", { length: 3 }).notNull(),
  items: jsonb("items").notNull(),
  shippingAddress: jsonb("shipping_address").notNull(),
  billingAddress: jsonb("billing_address"),
  shippingMethodId: uuid("shipping_method_id").notNull().references(() => shippingMethods.id),
  // client-supplied UUID: retries of the same submit return the same checkout
  idempotencyKey: uuid("idempotency_key").unique(),
  subtotalCents: bigint("subtotal_cents", { mode: "number" }).notNull(),
  shippingCents: bigint("shipping_cents", { mode: "number" }).notNull(),
  taxCents: bigint("tax_cents", { mode: "number" }).notNull().default(0),
  discountCents: bigint("discount_cents", { mode: "number" }).notNull().default(0),
  totalCents: bigint("total_cents", { mode: "number" }).notNull(),
  provider: paymentProvider("provider").notNull(),
  providerSessionId: text("provider_session_id"),
  // B1: sha256 hex of the guest token minted at checkout; copied to orders.access_token_hash on convert
  accessTokenHash: text("access_token_hash").notNull(),
  // stock reservation expiry (35 min), set by reserve_checkout(); expires_at = provider session (30 min)
  reservedUntil: timestamp("reserved_until", { withTimezone: true }),
  status: checkoutStatus("status").notNull().default("open"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  check("checkouts_totals_nonneg", sql`${t.subtotalCents} >= 0 AND ${t.shippingCents} >= 0 AND ${t.taxCents} >= 0 AND ${t.discountCents} >= 0 AND ${t.totalCents} >= 0`),
  check("checkouts_total_sum", sql`${t.totalCents} = ${t.subtotalCents} + ${t.shippingCents} + ${t.taxCents} - ${t.discountCents}`),
  unique("checkouts_provider_session_uq").on(t.provider, t.providerSessionId),
  check("checkouts_currency_fmt", currencyCheck(t.currency)),
  check("checkouts_locale_chk", localeCheck(t.locale)),
  index("checkouts_status_expires_idx").on(t.status, t.expiresAt),
  index("checkouts_shipping_method_idx").on(t.shippingMethodId),
]);

export const orders = pgTable("orders", {
  id: id(),
  reference: text("reference").notNull().unique(),
  checkoutId: uuid("checkout_id").notNull().unique().references(() => checkouts.id),
  email: text("email").notNull(),
  phone: text("phone"),
  locale: text("locale").notNull(),
  currency: char("currency", { length: 3 }).notNull(),
  subtotalCents: bigint("subtotal_cents", { mode: "number" }).notNull(),
  shippingCents: bigint("shipping_cents", { mode: "number" }).notNull(),
  taxCents: bigint("tax_cents", { mode: "number" }).notNull().default(0),
  discountCents: bigint("discount_cents", { mode: "number" }).notNull().default(0),
  totalCents: bigint("total_cents", { mode: "number" }).notNull(),
  status: orderStatus("status").notNull().default("pending_payment"),
  shippingAddress: jsonb("shipping_address").notNull(),
  billingAddress: jsonb("billing_address"),
  shippingMethodId: uuid("shipping_method_id").notNull().references(() => shippingMethods.id),
  accessTokenHash: text("access_token_hash").notNull(),
  placedAt: timestamp("placed_at", { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  check("orders_currency_fmt", currencyCheck(t.currency)),
  check("orders_locale_chk", localeCheck(t.locale)),
  check("orders_reference_fmt", sql`${t.reference} ~ '^DY-[0-9]{8}-[A-Z2-7]{5}$'`),
  check("orders_total_sum", sql`${t.totalCents} = ${t.subtotalCents} + ${t.shippingCents} + ${t.taxCents} - ${t.discountCents}`),
  check("orders_totals_nonneg", sql`${t.subtotalCents} >= 0 AND ${t.shippingCents} >= 0 AND ${t.taxCents} >= 0 AND ${t.discountCents} >= 0 AND ${t.totalCents} >= 0`),
  index("orders_status_idx").on(t.status, t.createdAt),
  index("orders_email_idx").on(t.email),
  index("orders_shipping_method_idx").on(t.shippingMethodId),
]);

export const orderItems = pgTable("order_items", {
  id: id(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "restrict" }),
  variantId: uuid("variant_id").references(() => productVariants.id, { onDelete: "set null" }),
  sku: text("sku").notNull(),
  productName: text("product_name").notNull(),
  size: text("size"),
  colour: text("colour"),
  // fiscal snapshot from products at convert time
  ikpuCode: text("ikpu_code"),
  packageCode: text("package_code"),
  vatRateBp: integer("vat_rate_bp").notNull(),
  ikpuIsDemo: boolean("ikpu_is_demo").generatedAlwaysAs(sql`coalesce(ikpu_code LIKE 'DEMO-%', false)`),
  unitPriceCents: bigint("unit_price_cents", { mode: "number" }).notNull(),
  quantity: integer("quantity").notNull(),
  lineTotalCents: bigint("line_total_cents", { mode: "number" }).notNull(),
}, (t) => [
  check("order_items_qty_pos", sql`${t.quantity} > 0`),
  check("order_items_unit_price_nonneg", sql`${t.unitPriceCents} >= 0`),
  check("order_items_line_total", sql`${t.lineTotalCents} = ${t.unitPriceCents} * ${t.quantity}`),
  index("order_items_order_idx").on(t.orderId),
  index("order_items_variant_idx").on(t.variantId),
]);

export const orderEvents = pgTable("order_events", {
  id: id(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "restrict" }),
  type: text("type").notNull(),
  fromStatus: orderStatus("from_status"),
  toStatus: orderStatus("to_status"),
  payload: jsonb("payload"),
  actorId: uuid("actor_id"),
  createdAt: createdAt(),
}, (t) => [
  index("order_events_order_idx").on(t.orderId, t.createdAt),
  check("order_events_type_chk", sql`${t.type} IN ${ORDER_EVENT_TYPES_SQL}`),
]);

export const payments = pgTable("payments", {
  id: id(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "restrict" }),
  provider: paymentProvider("provider").notNull(),
  providerPaymentId: text("provider_payment_id").notNull(),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  currency: char("currency", { length: 3 }).notNull(),
  status: paymentStatus("status").notNull(),
  raw: jsonb("raw"),
  createdAt: createdAt(),
}, (t) => [
  check("payments_amount_nonneg", sql`${t.amountCents} >= 0`),
  unique("payments_provider_payment_uq").on(t.provider, t.providerPaymentId),
  check("payments_currency_fmt", currencyCheck(t.currency)),
  // B16: at most one succeeded payment per order
  uniqueIndex("payments_one_succeeded_per_order_uq").on(t.orderId).where(sql`${t.status} = 'succeeded'`),
  index("payments_order_idx").on(t.orderId),
]);

export const refunds = pgTable("refunds", {
  id: id(),
  paymentId: uuid("payment_id").notNull().references(() => payments.id, { onDelete: "restrict" }),
  provider: paymentProvider("provider").notNull(),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  reason: text("reason"),
  providerRefundId: text("provider_refund_id"),
  status: refundStatus("status").notNull().default("pending"),
  // B9: admin refund request idempotency
  idempotencyKey: uuid("idempotency_key").notNull().unique(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  check("refunds_amount_pos", sql`${t.amountCents} > 0`),
  // QA-11: provider refund ids are unique per provider, not globally
  unique("refunds_provider_refund_uq").on(t.provider, t.providerRefundId),
  index("refunds_payment_idx").on(t.paymentId),
]);

export const shipments = pgTable("shipments", {
  id: id(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "restrict" }),
  carrier: text("carrier").notNull(),
  trackingNumber: text("tracking_number"),
  trackingUrl: text("tracking_url"),
  status: shipmentStatus("status").notNull().default("label_created"),
  shippedAt: timestamp("shipped_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("shipments_order_idx").on(t.orderId),
  check("shipments_tracking_url_https", sql`${t.trackingUrl} IS NULL OR ${t.trackingUrl} ~ '^https://'`),
]);

// Idempotency for provider webhooks/callbacks (Stripe, Payme JSON-RPC, Click Prepare/Complete).
// Insert ... on conflict do nothing => already handled. See record_payment_event().
export const paymentEvents = pgTable("payment_events", {
  provider: paymentProvider("provider").notNull(),
  eventId: text("event_id").notNull(),
  type: text("type").notNull(),
  payload: jsonb("payload"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  error: text("error"),
}, (t) => [primaryKey({ columns: [t.provider, t.eventId] })]);

// B18 (Payments): Payme/Click transactions exist before our order (CreateTransaction -> PerformTransaction).
// Mirrors ProviderTransaction in src/contracts/payments.ts. RLS on, server (service_role) only.
export const providerTxnState = pgEnum("provider_txn_state", ["created", "performed", "canceled", "canceled_after_perform"]);
export const providerTransactions = pgTable("provider_transactions", {
  id: id(),
  provider: paymentProvider("provider").notNull(),
  providerTxnId: text("provider_txn_id").notNull(),
  checkoutId: uuid("checkout_id").notNull().references(() => checkouts.id, { onDelete: "restrict" }),
  orderId: uuid("order_id").references(() => orders.id, { onDelete: "restrict" }),
  state: providerTxnState("state").notNull().default("created"),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  currency: char("currency", { length: 3 }).notNull(),
  cancelReason: integer("cancel_reason"),
  raw: jsonb("raw"),
  createdAt: createdAt(),
  performedAt: timestamp("performed_at", { withTimezone: true }),
  canceledAt: timestamp("canceled_at", { withTimezone: true }),
  updatedAt: updatedAt(),
}, (t) => [
  unique("provider_transactions_provider_txn_uq").on(t.provider, t.providerTxnId),
  check("provider_transactions_amount_nonneg", sql`${t.amountCents} >= 0`),
  check("provider_transactions_currency_fmt", currencyCheck(t.currency)),
  index("provider_transactions_checkout_idx").on(t.checkoutId),
  index("provider_transactions_order_idx").on(t.orderId),
]);
