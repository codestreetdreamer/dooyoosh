/**
 * POST /api/v1/checkout (spec §4, §5, §12). Owner: Payments & Orders.
 * v0.2+: hosted checkout. Response returns `redirectUrl` (provider page), not a Stripe clientSecret.
 * Errors: 400 VALIDATION_ERROR, 409 OUT_OF_STOCK / PRICE_CHANGED (details.variantIds),
 *         422 COUNTRY_NOT_SHIPPABLE, 502 PAYMENT_ERROR.
 */
import { z } from "zod";
import { MAX_CART_LINES, MAX_LINE_QTY } from "./cart";
import { address, currency, email, isoDateTime, locale, nonNegativeMinor, paymentProvider, phone, uuid } from "./common";

/** Session lifetimes (spec v0.2): provider session 30 min, reservation 35 min. */
export const PROVIDER_SESSION_TTL_MINUTES = 30;
export const RESERVATION_TTL_MINUTES = 35;

export const CHECKOUT_STATUSES = ["open", "awaiting_payment", "completed", "expired", "failed"] as const;
export const checkoutStatus = z.enum(CHECKOUT_STATUSES);
export type CheckoutStatus = z.infer<typeof checkoutStatus>;

export const checkoutLineInput = z.object({
  variantId: uuid,
  quantity: z.number().int().min(1).max(MAX_LINE_QTY),
  /** Price the customer saw. Mismatch with server price -> 409 PRICE_CHANGED. Never used as the charged price. */
  expectedUnitPriceMinor: nonNegativeMinor.optional(),
});

export const createCheckoutRequest = z.object({
  email,
  phone: phone.optional(),
  locale,
  items: z
    .array(checkoutLineInput)
    .min(1)
    .max(MAX_CART_LINES)
    .refine((items) => new Set(items.map((i) => i.variantId)).size === items.length, "duplicate variantId"),
  shippingAddress: address,
  billingAddress: address.optional(),
  shippingMethodId: uuid,
  /** Client-generated UUID so retries of the same submit do not create two checkouts. */
  idempotencyKey: uuid.optional(),
});
export type CreateCheckoutRequest = z.infer<typeof createCheckoutRequest>;

export const totals = z.object({
  currency,
  subtotalMinor: nonNegativeMinor,
  shippingMinor: nonNegativeMinor,
  taxMinor: nonNegativeMinor,
  discountMinor: nonNegativeMinor,
  totalMinor: nonNegativeMinor,
});
export type Totals = z.infer<typeof totals>;

export const createCheckoutResponse = z.object({
  data: z.object({
    checkoutId: uuid,
    provider: paymentProvider,
    redirectUrl: z.url(),
    /** provider session expiry (30 min) */
    expiresAt: isoDateTime,
    /** stock reservation expiry (35 min), for the bag countdown */
    reservedUntil: isoDateTime,
    totals,
  }),
});
export type CreateCheckoutResponse = z.infer<typeof createCheckoutResponse>;

/** Server-side snapshot stored in checkouts.items (jsonb). Passed to PaymentProvider.createSession. */
export const checkoutSnapshotLine = z.object({
  variantId: uuid,
  sku: z.string(),
  productName: z.string(),
  size: z.string().nullable(),
  colour: z.string().nullable(),
  unitPriceMinor: nonNegativeMinor,
  quantity: z.number().int().positive(),
  lineTotalMinor: nonNegativeMinor,
  /** fiscal snapshot (ZRU-792, spec §13); copied to order_items. `DEMO-` prefix = never fiscalise / never charge live */
  ikpuCode: z.string().min(1).max(32).nullable(),
  packageCode: z.string().min(1).max(32).nullable(),
  vatRateBp: z.number().int().min(0).max(10000),
});
export type CheckoutSnapshotLine = z.infer<typeof checkoutSnapshotLine>;
