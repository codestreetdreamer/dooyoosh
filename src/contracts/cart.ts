/** POST /cart/validate (spec §5). Owner: Backend & Database. The client cart is a hint; server recomputes. */
import { z } from "zod";
import { currency, locale, nonNegativeMinor, uuid } from "./common";

export const MAX_LINE_QTY = 10;
export const MAX_CART_LINES = 50;

export const cartItem = z.object({ variantId: uuid, quantity: z.number().int().min(1).max(MAX_LINE_QTY) });
export type CartItem = z.infer<typeof cartItem>;

export const cartItems = z
  .array(cartItem)
  .min(1)
  .max(MAX_CART_LINES)
  .refine((items) => new Set(items.map((i) => i.variantId)).size === items.length, "duplicate variantId");

export const validateCartRequest = z.object({ items: cartItems, locale: locale.default("en") });
export type ValidateCartRequest = z.infer<typeof validateCartRequest>;

export const CART_LINE_ISSUES = ["out_of_stock", "insufficient_stock", "inactive", "unpublished", "not_found"] as const;

export const validatedCartLine = z.object({
  variantId: uuid,
  productSlug: z.string(),
  productName: z.string(),
  sku: z.string(),
  size: z.string().nullable(),
  colour: z.string().nullable(),
  imageUrl: z.url().nullable(),
  unitPriceMinor: nonNegativeMinor,
  quantity: z.number().int().min(0),
  lineTotalMinor: nonNegativeMinor,
  available: z.boolean(),
  /** max quantity purchasable now, capped at MAX_LINE_QTY (exact stock hidden) */
  maxQuantity: z.number().int().min(0).max(MAX_LINE_QTY),
  issue: z.enum(CART_LINE_ISSUES).nullable(),
});
export type ValidatedCartLine = z.infer<typeof validatedCartLine>;

export const validateCartResponse = z.object({
  data: z.object({
    currency,
    lines: z.array(validatedCartLine),
    subtotalMinor: nonNegativeMinor,
    allAvailable: z.boolean(),
  }),
});
export type ValidateCartResponse = z.infer<typeof validateCartResponse>;
