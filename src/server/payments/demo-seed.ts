/**
 * DEV-ONLY demo data for the in-memory store (PAYMENTS_STORE=memory; container.ts refuses that in production).
 * Mirrors Frontend's src/dev-fixtures/catalog.ts (same variant ids / DEMO- SKUs / UZS tiyin prices, generated from it
 * on 2026-10-22) and its shipping method ids, so a fixture-driven cart checks out against the real API unchanged.
 * Fiscal fields use DEMO- IKPU codes: accepted in sandbox, refused in live (pricing.ts isDemoIkpu).
 * Stock: available variants get 5 units (the first available variant of each product gets 1, for sold-out tests);
 * fixture "sold out" variants get 0.
 */
import type { MemoryStore } from "./memory-store";

type Row = [id: string, sku: string, name: string, size: string | null, colour: string | null, priceMinor: number, available: 0 | 1, category: string];

// prettier-ignore
export const DEMO_VARIANTS: Row[] = [
  ["00000000-0000-4000-8000-000000000005", "DEMO-SILK-SLIP-DR-1", "Silk Slip Dress", "XS", "Dusty Rose", 245000000, 0, "clothing"],
  ["00000000-0000-4000-8000-000000000006", "DEMO-SILK-SLIP-DR-2", "Silk Slip Dress", "S", "Dusty Rose", 245000000, 1, "clothing"],
  ["00000000-0000-4000-8000-000000000007", "DEMO-SILK-SLIP-DR-3", "Silk Slip Dress", "M", "Dusty Rose", 245000000, 1, "clothing"],
  ["00000000-0000-4000-8000-000000000008", "DEMO-SILK-SLIP-DR-4", "Silk Slip Dress", "L", "Dusty Rose", 245000000, 1, "clothing"],
  ["00000000-0000-4000-8000-000000000009", "DEMO-SILK-SLIP-DR-5", "Silk Slip Dress", "XS", "Espresso", 245000000, 1, "clothing"],
  ["00000000-0000-4000-8000-000000000010", "DEMO-SILK-SLIP-DR-6", "Silk Slip Dress", "S", "Espresso", 245000000, 1, "clothing"],
  ["00000000-0000-4000-8000-000000000011", "DEMO-SILK-SLIP-DR-7", "Silk Slip Dress", "M", "Espresso", 245000000, 1, "clothing"],
  ["00000000-0000-4000-8000-000000000012", "DEMO-SILK-SLIP-DR-8", "Silk Slip Dress", "L", "Espresso", 245000000, 0, "clothing"],
  ["00000000-0000-4000-8000-000000000017", "DEMO-WOOL-WRAP-CO-1", "Wool Wrap Coat", "S", "Taupe", 490000000, 1, "clothing"],
  ["00000000-0000-4000-8000-000000000018", "DEMO-WOOL-WRAP-CO-2", "Wool Wrap Coat", "M", "Taupe", 490000000, 1, "clothing"],
  ["00000000-0000-4000-8000-000000000019", "DEMO-WOOL-WRAP-CO-3", "Wool Wrap Coat", "L", "Taupe", 490000000, 1, "clothing"],
  ["00000000-0000-4000-8000-000000000020", "DEMO-WOOL-WRAP-CO-4", "Wool Wrap Coat", "S", "Camel", 490000000, 1, "clothing"],
  ["00000000-0000-4000-8000-000000000021", "DEMO-WOOL-WRAP-CO-5", "Wool Wrap Coat", "M", "Camel", 490000000, 1, "clothing"],
  ["00000000-0000-4000-8000-000000000022", "DEMO-WOOL-WRAP-CO-6", "Wool Wrap Coat", "L", "Camel", 490000000, 1, "clothing"],
  ["00000000-0000-4000-8000-000000000027", "DEMO-PLEATED-WIDE-1", "Pleated Wide Trousers", "34", "Espresso", 165000000, 0, "clothing"],
  ["00000000-0000-4000-8000-000000000028", "DEMO-PLEATED-WIDE-2", "Pleated Wide Trousers", "36", "Espresso", 165000000, 1, "clothing"],
  ["00000000-0000-4000-8000-000000000029", "DEMO-PLEATED-WIDE-3", "Pleated Wide Trousers", "38", "Espresso", 165000000, 1, "clothing"],
  ["00000000-0000-4000-8000-000000000030", "DEMO-PLEATED-WIDE-4", "Pleated Wide Trousers", "40", "Espresso", 165000000, 1, "clothing"],
  ["00000000-0000-4000-8000-000000000035", "DEMO-COTTON-POPLI-1", "Cotton Poplin Shirt", "XS", "Ivory", 98000000, 1, "clothing"],
  ["00000000-0000-4000-8000-000000000036", "DEMO-COTTON-POPLI-2", "Cotton Poplin Shirt", "S", "Ivory", 98000000, 1, "clothing"],
  ["00000000-0000-4000-8000-000000000037", "DEMO-COTTON-POPLI-3", "Cotton Poplin Shirt", "M", "Ivory", 98000000, 1, "clothing"],
  ["00000000-0000-4000-8000-000000000038", "DEMO-COTTON-POPLI-4", "Cotton Poplin Shirt", "L", "Ivory", 98000000, 1, "clothing"],
  ["00000000-0000-4000-8000-000000000039", "DEMO-COTTON-POPLI-5", "Cotton Poplin Shirt", "XS", "Dusty Rose", 98000000, 1, "clothing"],
  ["00000000-0000-4000-8000-000000000040", "DEMO-COTTON-POPLI-6", "Cotton Poplin Shirt", "S", "Dusty Rose", 98000000, 1, "clothing"],
  ["00000000-0000-4000-8000-000000000041", "DEMO-COTTON-POPLI-7", "Cotton Poplin Shirt", "M", "Dusty Rose", 98000000, 1, "clothing"],
  ["00000000-0000-4000-8000-000000000042", "DEMO-COTTON-POPLI-8", "Cotton Poplin Shirt", "L", "Dusty Rose", 98000000, 1, "clothing"],
  ["00000000-0000-4000-8000-000000000047", "DEMO-IKAT-MIDI-SK-1", "Ikat Midi Skirt", "S", "Rose Ikat", 185000000, 0, "clothing"],
  ["00000000-0000-4000-8000-000000000048", "DEMO-IKAT-MIDI-SK-2", "Ikat Midi Skirt", "M", "Rose Ikat", 185000000, 0, "clothing"],
  ["00000000-0000-4000-8000-000000000053", "DEMO-LEATHER-BALL-1", "Leather Ballet Flat", "36", "Espresso", 140000000, 1, "footwear"],
  ["00000000-0000-4000-8000-000000000054", "DEMO-LEATHER-BALL-2", "Leather Ballet Flat", "37", "Espresso", 140000000, 1, "footwear"],
  ["00000000-0000-4000-8000-000000000055", "DEMO-LEATHER-BALL-3", "Leather Ballet Flat", "38", "Espresso", 140000000, 1, "footwear"],
  ["00000000-0000-4000-8000-000000000056", "DEMO-LEATHER-BALL-4", "Leather Ballet Flat", "39", "Espresso", 140000000, 1, "footwear"],
  ["00000000-0000-4000-8000-000000000057", "DEMO-LEATHER-BALL-5", "Leather Ballet Flat", "40", "Espresso", 140000000, 0, "footwear"],
  ["00000000-0000-4000-8000-000000000058", "DEMO-LEATHER-BALL-6", "Leather Ballet Flat", "36", "Blush", 140000000, 0, "footwear"],
  ["00000000-0000-4000-8000-000000000059", "DEMO-LEATHER-BALL-7", "Leather Ballet Flat", "37", "Blush", 140000000, 1, "footwear"],
  ["00000000-0000-4000-8000-000000000060", "DEMO-LEATHER-BALL-8", "Leather Ballet Flat", "38", "Blush", 140000000, 1, "footwear"],
  ["00000000-0000-4000-8000-000000000061", "DEMO-LEATHER-BALL-9", "Leather Ballet Flat", "39", "Blush", 140000000, 1, "footwear"],
  ["00000000-0000-4000-8000-000000000062", "DEMO-LEATHER-BALL-10", "Leather Ballet Flat", "40", "Blush", 140000000, 1, "footwear"],
  ["00000000-0000-4000-8000-000000000067", "DEMO-KNEE-HIGH-BO-1", "Knee-High Boot", "37", "Espresso", 320000000, 1, "footwear"],
  ["00000000-0000-4000-8000-000000000068", "DEMO-KNEE-HIGH-BO-2", "Knee-High Boot", "38", "Espresso", 320000000, 1, "footwear"],
  ["00000000-0000-4000-8000-000000000069", "DEMO-KNEE-HIGH-BO-3", "Knee-High Boot", "39", "Espresso", 320000000, 1, "footwear"],
  ["00000000-0000-4000-8000-000000000074", "DEMO-SUEDE-LOAFER-1", "Suede Loafer", "38", "Taupe", 195000000, 1, "footwear"],
  ["00000000-0000-4000-8000-000000000075", "DEMO-SUEDE-LOAFER-2", "Suede Loafer", "39", "Taupe", 195000000, 1, "footwear"],
  ["00000000-0000-4000-8000-000000000076", "DEMO-SUEDE-LOAFER-3", "Suede Loafer", "40", "Taupe", 195000000, 1, "footwear"],
  ["00000000-0000-4000-8000-000000000077", "DEMO-SUEDE-LOAFER-4", "Suede Loafer", "41", "Taupe", 195000000, 0, "footwear"],
  ["00000000-0000-4000-8000-000000000082", "DEMO-STRUCTURED-T-1", "Structured Tote", null, "Espresso", 275000000, 1, "accessories"],
  ["00000000-0000-4000-8000-000000000083", "DEMO-STRUCTURED-T-2", "Structured Tote", null, "Taupe", 275000000, 0, "accessories"],
  ["00000000-0000-4000-8000-000000000088", "DEMO-SILK-TWILL-S-1", "Silk Twill Scarf", null, "Rose Suzani", 85000000, 1, "accessories"],
  ["00000000-0000-4000-8000-000000000093", "DEMO-GOLD-HOOP-EA-1", "Gold Hoop Earrings", null, "Gold", 120000000, 0, "accessories"],
  ["00000000-0000-4000-8000-000000000098", "DEMO-LEATHER-BELT-1", "Leather Belt", "70", "Espresso", 69000000, 1, "accessories"],
  ["00000000-0000-4000-8000-000000000099", "DEMO-LEATHER-BELT-2", "Leather Belt", "80", "Espresso", 69000000, 1, "accessories"],
  ["00000000-0000-4000-8000-000000000100", "DEMO-LEATHER-BELT-3", "Leather Belt", "90", "Espresso", 69000000, 1, "accessories"]
];

export const DEMO_SHIPPING = {
  standard: "00000000-0000-4000-b000-000000000001",
  express: "00000000-0000-4000-b000-000000000002",
  intl: "00000000-0000-4000-b000-000000000003",
} as const;

const INTL = ["KZ", "PL", "DE", "GB", "US", "AE", "TR"];

export function seedDemo(store: MemoryStore) {
  const seenProduct = new Set<string>();
  for (const [variantId, sku, productName, size, colour, unitPriceMinor, available, category] of DEMO_VARIANTS) {
    const first = available === 1 && !seenProduct.has(productName);
    if (available === 1) seenProduct.add(productName);
    store.addVariant({
      variantId, sku, productName, size, colour, unitPriceMinor, currency: "UZS",
      stockOnHand: available === 1 ? (first ? 1 : 5) : 0,
      weightGrams: category === "footwear" ? 900 : category === "clothing" ? 500 : 300,
      ikpuCode: `DEMO-${sku.length.toString().padStart(17, "0")}`, packageCode: "DEMO-PKG", vatRateBp: 1200,
    });
  }
  const m = (methodId: string, name: string, countries: string[], priceMinor: number, freeOverMinor: number | null) =>
    store.addShippingMethod({ methodId, name, isActive: true, marketCurrency: "UZS", marketActive: true, countries, rates: [{ minSubtotalMinor: 0, maxWeightGrams: null, priceMinor, freeOverMinor }] });
  m(DEMO_SHIPPING.standard, "Standard (Uzbekistan)", ["UZ"], 3_000_000, 300_000_000);
  m(DEMO_SHIPPING.express, "Express courier, Tashkent", ["UZ"], 6_000_000, null);
  m(DEMO_SHIPPING.intl, "International tracked", INTL, 35_000_000, null);
}
