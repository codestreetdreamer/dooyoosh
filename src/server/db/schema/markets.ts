import { sql } from "drizzle-orm";
import { bigint, boolean, char, check, index, integer, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { currencyCheck, id } from "./_common";

export const markets = pgTable("markets", {
  id: id(),
  code: text("code").notNull().unique(),
  currency: char("currency", { length: 3 }).notNull(),
  isActive: boolean("is_active").notNull().default(false),
}, (t) => [check("markets_currency_fmt", currencyCheck(t.currency))]);

export const countries = pgTable("countries", {
  iso2: char("iso2", { length: 2 }).primaryKey(),
  marketId: uuid("market_id").notNull().references(() => markets.id, { onDelete: "restrict" }),
  isShippable: boolean("is_shippable").notNull().default(false),
}, (t) => [index("countries_market_idx").on(t.marketId), check("countries_iso2_fmt", sql`${t.iso2} ~ '^[A-Z]{2}$'`)]);

export const shippingMethods = pgTable("shipping_methods", {
  id: id(),
  marketId: uuid("market_id").notNull().references(() => markets.id, { onDelete: "restrict" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  minDays: integer("min_days").notNull(),
  maxDays: integer("max_days").notNull(),
  isActive: boolean("is_active").notNull().default(true),
}, (t) => [
  unique("shipping_methods_market_code_uq").on(t.marketId, t.code),
  check("shipping_methods_days", sql`${t.minDays} >= 0 AND ${t.maxDays} >= ${t.minDays}`),
]);

export const shippingRates = pgTable("shipping_rates", {
  id: id(),
  shippingMethodId: uuid("shipping_method_id").notNull().references(() => shippingMethods.id, { onDelete: "cascade" }),
  minSubtotalCents: bigint("min_subtotal_cents", { mode: "number" }).notNull().default(0),
  maxWeightGrams: integer("max_weight_grams"),
  priceCents: bigint("price_cents", { mode: "number" }).notNull(),
  freeOverCents: bigint("free_over_cents", { mode: "number" }),
}, (t) => [
  check("shipping_rates_nonneg", sql`${t.priceCents} >= 0 AND ${t.minSubtotalCents} >= 0`),
  check("shipping_rates_free_over_nonneg", sql`${t.freeOverCents} IS NULL OR ${t.freeOverCents} >= 0`),
  check("shipping_rates_max_weight_pos", sql`${t.maxWeightGrams} IS NULL OR ${t.maxWeightGrams} > 0`),
  index("shipping_rates_method_idx").on(t.shippingMethodId),
]);
