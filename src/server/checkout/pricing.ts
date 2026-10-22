/**
 * Pure server-side price/shipping/total recompute (spec §2, §4.1). Owner: Payments & Orders.
 * Client prices are NEVER used as the charged price; `expectedUnitPriceMinor` only detects PRICE_CHANGED.
 * All amounts are integer minor units of the market currency (tiyin for UZS). No floats anywhere.
 */
import { MAX_CART_LINES, MAX_LINE_QTY } from "@/contracts/cart";
import { ApiError } from "@/lib/errors";
import type { Totals } from "@/contracts/checkout";
import type { CheckoutLine, ShippingMethodForCheckout, ShippingRateRow, VariantForCheckout } from "../payments/store";

export interface LineInput {
  variantId: string;
  quantity: number;
  expectedUnitPriceMinor?: number;
}

/**
 * Defence in depth on top of the Zod contract (QA-07): quantity integer in [1, MAX_LINE_QTY], no duplicate variant
 * lines, at most MAX_CART_LINES lines. A negative quantity would otherwise decrement stock_reserved.
 */
export function validateLines(lines: LineInput[]): void {
  if (!Array.isArray(lines) || lines.length === 0) throw ApiError.validation("items must not be empty");
  if (lines.length > MAX_CART_LINES) throw ApiError.validation(`at most ${MAX_CART_LINES} lines`);
  const seen = new Set<string>();
  const bad: string[] = [];
  for (const l of lines) {
    if (!Number.isSafeInteger(l.quantity) || l.quantity < 1 || l.quantity > MAX_LINE_QTY) bad.push(l.variantId);
    if (l.expectedUnitPriceMinor !== undefined && (!Number.isSafeInteger(l.expectedUnitPriceMinor) || l.expectedUnitPriceMinor < 0)) bad.push(l.variantId);
    if (seen.has(l.variantId)) throw ApiError.validation("duplicate variantId", [{ path: ["items"], variantId: l.variantId }]);
    seen.add(l.variantId);
  }
  if (bad.length) throw ApiError.validation(`quantity must be an integer between 1 and ${MAX_LINE_QTY}`, [{ path: ["items"], variantIds: bad }]);
}

export function pickShippingRate(rates: ShippingRateRow[], subtotalMinor: number, weightGrams: number): ShippingRateRow | null {
  const eligible = rates
    .filter((r) => r.minSubtotalMinor <= subtotalMinor && (r.maxWeightGrams === null || weightGrams <= r.maxWeightGrams))
    // most specific tier first (highest threshold), then cheapest
    .sort((a, b) => b.minSubtotalMinor - a.minSubtotalMinor || a.priceMinor - b.priceMinor);
  return eligible[0] ?? null;
}

export function shippingPrice(rate: ShippingRateRow, subtotalMinor: number): number {
  return rate.freeOverMinor !== null && subtotalMinor >= rate.freeOverMinor ? 0 : rate.priceMinor;
}

export interface Quote {
  lines: CheckoutLine[];
  totals: Totals;
  weightGrams: number;
}

/**
 * Recompute everything from DB rows. Throws ApiError:
 *  409 OUT_OF_STOCK (unknown / inactive / unpublished / not enough available) with details.variantIds
 *  409 PRICE_CHANGED (client's expectedUnitPriceMinor differs from server price) with details.variantIds
 *  422 COUNTRY_NOT_SHIPPABLE, 400 VALIDATION_ERROR for an unusable shipping method
 */
export function computeQuote(input: LineInput[], variants: VariantForCheckout[], shipping: ShippingMethodForCheckout | null, country: string): Quote {
  validateLines(input);
  if (!shipping || !shipping.countryShippable || !shipping.marketActive) throw ApiError.countryNotShippable(country);
  if (!shipping.isActive) throw ApiError.validation("shipping method is not available", [{ path: ["shippingMethodId"] }]);
  const currency = shipping.marketCurrency;

  const byId = new Map(variants.map((v) => [v.variantId, v]));
  const outOfStock: string[] = [];
  const priceChanged: string[] = [];
  const lines: CheckoutLine[] = [];
  let weight = 0;
  for (const l of input) {
    const v = byId.get(l.variantId);
    if (!v || !v.isActive || !v.isPublished || v.available < l.quantity) {
      outOfStock.push(l.variantId);
      continue;
    }
    if (v.currency !== currency) {
      // catalog priced in another currency than the destination market: never convert silently
      throw ApiError.internal(`variant ${v.variantId} priced in ${v.currency}, market uses ${currency}`);
    }
    if (l.expectedUnitPriceMinor !== undefined && l.expectedUnitPriceMinor !== v.unitPriceMinor) priceChanged.push(l.variantId);
    const lineTotal = v.unitPriceMinor * l.quantity;
    if (!Number.isSafeInteger(lineTotal)) throw ApiError.validation("amount too large");
    weight += (v.weightGrams ?? 0) * l.quantity;
    lines.push({
      variantId: v.variantId,
      sku: v.sku,
      productName: v.productName,
      size: v.size,
      colour: v.colour,
      unitPriceMinor: v.unitPriceMinor,
      quantity: l.quantity,
      lineTotalMinor: lineTotal,
      ikpuCode: v.ikpuCode,
      packageCode: v.packageCode,
      vatRateBp: v.vatRateBp,
    });
  }
  if (outOfStock.length) throw ApiError.outOfStock(outOfStock);
  if (priceChanged.length) throw ApiError.priceChanged(priceChanged);

  const subtotal = lines.reduce((s, l) => s + l.lineTotalMinor, 0);
  const rate = pickShippingRate(shipping.rates, subtotal, weight);
  if (!rate) throw ApiError.countryNotShippable(country);
  const shippingMinor = shippingPrice(rate, subtotal);
  // Prices are VAT-inclusive (spec §10.3 [OPEN]); VAT is reported per line for fiscal receipts, not added on top.
  const taxMinor = 0;
  const discountMinor = 0;
  const totalMinor = subtotal + shippingMinor + taxMinor - discountMinor;
  if (!Number.isSafeInteger(totalMinor)) throw ApiError.validation("amount too large");
  return { lines, weightGrams: weight, totals: { currency, subtotalMinor: subtotal, shippingMinor, taxMinor, discountMinor, totalMinor } };
}

/** Demo seed data uses IKPU codes starting "DEMO-": they must never reach a live payment or live fiscal receipt. */
export function isDemoIkpu(code: string | null): boolean {
  return code !== null && code.toUpperCase().startsWith("DEMO-");
}

/** Lines missing IKPU / package code / VAT rate, or carrying a DEMO- IKPU. Live mode refuses them (spec §13, ZRU-792). */
export function linesMissingFiscalData(lines: CheckoutLine[]): string[] {
  return lines.filter((l) => !l.ikpuCode || isDemoIkpu(l.ikpuCode) || !l.packageCode || l.vatRateBp === null).map((l) => l.variantId);
}
