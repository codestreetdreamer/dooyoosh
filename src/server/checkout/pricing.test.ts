import { describe, expect, it } from "vitest";
import { MAX_CART_LINES, MAX_LINE_QTY } from "@/contracts/cart";
import { ApiError } from "@/lib/errors";
import { computeQuote, linesMissingFiscalData, pickShippingRate, validateLines } from "./pricing";
import type { ShippingMethodForCheckout, VariantForCheckout } from "../payments/store";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const v = (id: string, over: Partial<VariantForCheckout> = {}): VariantForCheckout => ({
  variantId: id, sku: `DEMO-${id.slice(0, 2)}`, productName: "P", size: null, colour: null, unitPriceMinor: 15_000_000, currency: "UZS",
  isActive: true, isPublished: true, available: 10, weightGrams: 200, ikpuCode: null, packageCode: null, vatRateBp: 0, ...over,
});
const ship = (over: Partial<ShippingMethodForCheckout> = {}): ShippingMethodForCheckout => ({
  methodId: "m", name: "Courier", isActive: true, marketCurrency: "UZS", marketActive: true, countryShippable: true,
  rates: [{ minSubtotalMinor: 0, maxWeightGrams: null, priceMinor: 2_500_000, freeOverMinor: 50_000_000 }], ...over,
});
function code(fn: () => unknown): { code: string; details: Record<string, unknown> } {
  try { fn(); } catch (e) { if (e instanceof ApiError) return { code: e.code, details: e.details }; throw e; }
  throw new Error("expected ApiError");
}

describe("validateLines (QA-07)", () => {
  it.each([0, -1, 1.5, MAX_LINE_QTY + 1, Number.NaN])("rejects quantity %s", (q) => {
    expect(code(() => validateLines([{ variantId: A, quantity: q }])).code).toBe("VALIDATION_ERROR");
  });
  it("rejects duplicate variant lines", () => {
    expect(code(() => validateLines([{ variantId: A, quantity: 1 }, { variantId: A, quantity: 1 }])).code).toBe("VALIDATION_ERROR");
  });
  it("caps line count and rejects empty", () => {
    const many = Array.from({ length: MAX_CART_LINES + 1 }, (_, i) => ({ variantId: `${i}`.padStart(8, "0") + A.slice(8), quantity: 1 }));
    expect(code(() => validateLines(many)).code).toBe("VALIDATION_ERROR");
    expect(code(() => validateLines([])).code).toBe("VALIDATION_ERROR");
  });
  it("accepts 1..MAX", () => expect(() => validateLines([{ variantId: A, quantity: 1 }, { variantId: B, quantity: MAX_LINE_QTY }])).not.toThrow());
});

describe("computeQuote", () => {
  it("recomputes from DB prices; client price is never charged", () => {
    const q = computeQuote([{ variantId: A, quantity: 2 }], [v(A)], ship(), "UZ");
    expect(q.totals).toEqual({ currency: "UZS", subtotalMinor: 30_000_000, shippingMinor: 2_500_000, taxMinor: 0, discountMinor: 0, totalMinor: 32_500_000 });
    expect(q.lines[0]!.unitPriceMinor).toBe(15_000_000);
  });
  it("PRICE_CHANGED with variantIds when the expected price differs", () => {
    const e = code(() => computeQuote([{ variantId: A, quantity: 1, expectedUnitPriceMinor: 1 }, { variantId: B, quantity: 1, expectedUnitPriceMinor: 15_000_000 }], [v(A), v(B)], ship(), "UZ"));
    expect(e).toEqual({ code: "PRICE_CHANGED", details: { variantIds: [A] } });
  });
  it("OUT_OF_STOCK for unknown / inactive / unpublished / insufficient, all ids listed", () => {
    const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const e = code(() => computeQuote([{ variantId: A, quantity: 1 }, { variantId: B, quantity: 1 }, { variantId: C, quantity: 1 }, { variantId: D, quantity: 3 }], [v(B, { isActive: false }), v(C, { isPublished: false }), v(D, { available: 2 })], ship(), "UZ"));
    expect(e).toEqual({ code: "OUT_OF_STOCK", details: { variantIds: [A, B, C, D] } });
  });
  it("free shipping over threshold; currency comes from the market, not hardcoded", () => {
    const q = computeQuote([{ variantId: A, quantity: 4 }], [v(A)], ship(), "UZ");
    expect(q.totals.shippingMinor).toBe(0);
    const eur = computeQuote([{ variantId: A, quantity: 1 }], [v(A, { currency: "EUR", unitPriceMinor: 1999 })], ship({ marketCurrency: "EUR", rates: [{ minSubtotalMinor: 0, maxWeightGrams: null, priceMinor: 500, freeOverMinor: null }] }), "PL");
    expect(eur.totals).toMatchObject({ currency: "EUR", totalMinor: 2499 });
  });
  it("refuses a variant priced in another currency than the market", () => {
    expect(code(() => computeQuote([{ variantId: A, quantity: 1 }], [v(A, { currency: "EUR" })], ship(), "UZ")).code).toBe("INTERNAL");
  });
  it("COUNTRY_NOT_SHIPPABLE for non-shippable country or missing method", () => {
    expect(code(() => computeQuote([{ variantId: A, quantity: 1 }], [v(A)], ship({ countryShippable: false }), "US")).code).toBe("COUNTRY_NOT_SHIPPABLE");
    expect(code(() => computeQuote([{ variantId: A, quantity: 1 }], [v(A)], null, "UZ")).code).toBe("COUNTRY_NOT_SHIPPABLE");
  });
  it("weight-limited rate tiers", () => {
    const rates = [{ minSubtotalMinor: 0, maxWeightGrams: 1000, priceMinor: 100, freeOverMinor: null }, { minSubtotalMinor: 0, maxWeightGrams: null, priceMinor: 900, freeOverMinor: null }];
    expect(pickShippingRate(rates, 0, 500)?.priceMinor).toBe(100);
    expect(pickShippingRate(rates, 0, 5000)?.priceMinor).toBe(900);
  });
  it("reports lines missing fiscal data", () => {
    const q = computeQuote([{ variantId: A, quantity: 1 }, { variantId: B, quantity: 1 }], [v(A), v(B, { ikpuCode: "06109001001000000", packageCode: "1", vatRateBp: 1200 })], ship(), "UZ");
    expect(linesMissingFiscalData(q.lines)).toEqual([A]);
  });
});

describe("guest token hash (Architect cf91ef3)", () => {
  it("hash = hex(HMAC_SHA256(secret, token)); constant-time match; malformed hash never matches", async () => {
    const { createHmac } = await import("node:crypto");
    const { hashAccessToken, tokenMatches } = await import("./token");
    const h = hashAccessToken("s".repeat(32), "tok");
    expect(h).toBe(createHmac("sha256", "s".repeat(32)).update("tok").digest("hex"));
    expect(tokenMatches("s".repeat(32), "tok", h)).toBe(true);
    expect(tokenMatches("t".repeat(32), "tok", h)).toBe(false);
    expect(tokenMatches("s".repeat(32), "tok", "zz")).toBe(false);
    expect(tokenMatches("s".repeat(32), "tok", h.toUpperCase())).toBe(false);
  });
});
