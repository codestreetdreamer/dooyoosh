/**
 * GET /api/v1/orders/{reference} with `Authorization: Bearer <accessToken>` (guest order status). Owner: Payments & Orders.
 * The token comes from the checkout response (sessionStorage) or the email link fragment `#token=`; DB stores only access_token_hash.
 * Unknown reference OR wrong token -> 404 NOT_FOUND (do not reveal which).
 */
import { z } from "zod";
import { address, currency, email, isoDateTime, locale, nonNegativeMinor, uuid } from "./common";
import { totals } from "./checkout";

export const ORDER_STATUSES = [
  "pending_payment",
  "paid",
  "stock_conflict",
  "fulfilling",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
  "partially_refunded",
] as const;
export const orderStatus = z.enum(ORDER_STATUSES);
export type OrderStatus = z.infer<typeof orderStatus>;

/** Allowed transitions; implemented in src/server/orders/transitions.ts (single state machine, spec §4.5). */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending_payment: ["paid", "stock_conflict", "cancelled"],
  paid: ["fulfilling", "cancelled", "refunded", "partially_refunded"],
  stock_conflict: ["refunded"],
  fulfilling: ["shipped", "cancelled", "refunded", "partially_refunded"],
  shipped: ["delivered", "refunded", "partially_refunded"],
  delivered: ["refunded", "partially_refunded"],
  partially_refunded: ["refunded", "fulfilling", "shipped", "delivered"],
  cancelled: ["refunded"],
  refunded: [],
};

export const orderReference = z.string().regex(/^DY-\d{8}-[A-Z2-7]{5}$/);

export const SHIPMENT_STATUSES = ["label_created", "in_transit", "delivered", "exception"] as const;
export const shipmentStatus = z.enum(SHIPMENT_STATUSES);

export const shipment = z.object({
  id: uuid,
  carrier: z.string(),
  trackingNumber: z.string().nullable(),
  trackingUrl: z.url().nullable(),
  status: shipmentStatus,
  shippedAt: isoDateTime.nullable(),
  deliveredAt: isoDateTime.nullable(),
});
export type Shipment = z.infer<typeof shipment>;

export const orderItem = z.object({
  sku: z.string(),
  productName: z.string(),
  size: z.string().nullable(),
  colour: z.string().nullable(),
  unitPriceMinor: nonNegativeMinor,
  quantity: z.number().int().positive(),
  lineTotalMinor: nonNegativeMinor,
});
export type OrderItem = z.infer<typeof orderItem>;

export const orderParams = z.object({ reference: orderReference });
/** token moved to header `Authorization: Bearer <accessToken>` (v0.5). Email links use `#token=` (fragment, never sent to servers). */
export const getOrderQuery = z.object({});

/** Guest-safe view (no internal ids, no raw payment data). */
export const publicOrder = z.object({
  reference: orderReference,
  status: orderStatus,
  email,
  locale,
  currency,
  totals,
  items: z.array(orderItem),
  shippingAddress: address,
  shipments: z.array(shipment),
  placedAt: isoDateTime,
  paidAt: isoDateTime.nullable(),
});
export type PublicOrder = z.infer<typeof publicOrder>;
export const getOrderResponse = z.object({ data: publicOrder });
export type GetOrderResponse = z.infer<typeof getOrderResponse>;

/**
 * Success page polling (no order yet until the webhook lands):
 * GET /api/v1/checkout/{checkoutId}/status -> order reference once paid. Owner: Payments & Orders.
 * Added in contracts v0.3 so the success page never trusts URL params (spec §4.6).
 */
export const checkoutStatusParams = z.object({ checkoutId: uuid });
/**
 * The guest access token is minted at checkout creation (hash stored in checkouts.access_token_hash,
 * copied to orders.access_token_hash by convert_checkout_to_order) and returned once in POST /checkout
 * (re-derivable on idempotent replay). It is NEVER placed in any URL. Wrong token -> 404.
 */
/** token in header `Authorization: Bearer <accessToken>`; `?token=` -> 400 */
export const checkoutStatusQuery = z.object({});
export const checkoutStatusResponse = z.object({
  data: z.object({
    checkoutStatus: z.enum(["open", "awaiting_payment", "completed", "expired", "failed"]),
    orderReference: orderReference.nullable(),
    orderStatus: orderStatus.nullable(),
  }),
});
export type CheckoutStatusResponse = z.infer<typeof checkoutStatusResponse>;
