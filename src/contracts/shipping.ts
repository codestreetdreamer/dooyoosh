/** GET /shipping/options?country= (spec §5). Owner: Backend & Database. Carrier is [OPEN]. */
import { z } from "zod";
import { countryIso2, currency, locale, nonNegativeMinor, uuid } from "./common";

export const shippingOptionsQuery = z.object({
  country: countryIso2,
  locale: locale.default("en"),
  /** optional hint for free-shipping thresholds; server recomputes at checkout */
  subtotalMinor: z.coerce.number().int().nonnegative().optional(),
});
export type ShippingOptionsQuery = z.infer<typeof shippingOptionsQuery>;

export const shippingOption = z.object({
  methodId: uuid,
  code: z.string(),
  name: z.string(),
  minDays: z.number().int().nonnegative(),
  maxDays: z.number().int().nonnegative(),
  priceMinor: nonNegativeMinor,
  freeOverMinor: nonNegativeMinor.nullable(),
  currency,
});
export type ShippingOption = z.infer<typeof shippingOption>;

/** 422 COUNTRY_NOT_SHIPPABLE when the country is not shippable. */
export const shippingOptionsResponse = z.object({
  data: z.object({ country: countryIso2, currency, options: z.array(shippingOption) }),
});
export type ShippingOptionsResponse = z.infer<typeof shippingOptionsResponse>;
