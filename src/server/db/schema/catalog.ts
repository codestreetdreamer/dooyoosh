import { sql } from "drizzle-orm";
import {
  AnyPgColumn, bigint, boolean, char, check, index, integer, jsonb, pgEnum, pgTable,
  primaryKey, text, timestamp, unique, uuid,
} from "drizzle-orm/pg-core";
import { tsvector } from "./_types";
import { createdAt, currencyCheck, id, localeCheck, updatedAt } from "./_common";

export const categoryKind = pgEnum("category_kind", ["clothing", "footwear", "accessories"]);
export const productStatus = pgEnum("product_status", ["draft", "published", "archived"]);
export const sizeSystem = pgEnum("size_system", ["alpha", "eu_shoe", "uk_shoe", "us_shoe", "one_size", "numeric"]);

export const categories = pgTable("categories", {
  id: id(),
  slug: text("slug").notNull().unique(),
  parentId: uuid("parent_id").references((): AnyPgColumn => categories.id, { onDelete: "restrict" }),
  kind: categoryKind("kind").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
}, (t) => [index("categories_parent_idx").on(t.parentId)]);

export const categoryTranslations = pgTable("category_translations", {
  categoryId: uuid("category_id").notNull().references(() => categories.id, { onDelete: "cascade" }),
  locale: text("locale").notNull(),
  name: text("name").notNull(),
  description: text("description"),
}, (t) => [primaryKey({ columns: [t.categoryId, t.locale] }), check("category_translations_locale_chk", localeCheck(t.locale))]);

export const sizeCharts = pgTable("size_charts", {
  id: id(),
  name: text("name").notNull(),
  sizeSystem: sizeSystem("size_system").notNull(),
  data: jsonb("data").notNull(),
});

export const products = pgTable("products", {
  id: id(),
  slug: text("slug").notNull().unique(),
  categoryId: uuid("category_id").notNull().references(() => categories.id, { onDelete: "restrict" }),
  brand: text("brand"),
  status: productStatus("status").notNull().default("draft"),
  basePriceCents: bigint("base_price_cents", { mode: "number" }).notNull(),
  // minor units of `currency` (tiyin for UZS). No default: must match the active market's currency.
  currency: char("currency", { length: 3 }).notNull(),
  sizeSystem: sizeSystem("size_system").notNull(),
  // UZ fiscal receipts (ZRU-792 / Payme/Click receipts): IKPU (MXIK) 17-digit code, package code, VAT rate in basis points
  // 17-digit IKPU/MXIK, or DEMO-<17 digits> for seed data (never valid for live receipts)
  ikpuCode: text("ikpu_code"),
  ikpuIsDemo: boolean("ikpu_is_demo").generatedAlwaysAs(sql`coalesce(ikpu_code LIKE 'DEMO-%', false)`),
  packageCode: text("package_code"),
  vatRateBp: integer("vat_rate_bp").notNull().default(1200),
  sizeChartId: uuid("size_chart_id").references(() => sizeCharts.id, { onDelete: "set null" }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  check("products_base_price_nonneg", sql`${t.basePriceCents} >= 0`),
  check("products_ikpu_fmt", sql`${t.ikpuCode} IS NULL OR ${t.ikpuCode} ~ '^(DEMO-)?[0-9]{17}$'`),
  check("products_vat_rate_bp_range", sql`${t.vatRateBp} >= 0 AND ${t.vatRateBp} <= 10000`),
  check("products_published_requires_ikpu", sql`${t.status} <> 'published' OR ${t.ikpuCode} IS NOT NULL`),
  check("products_published_requires_published_at", sql`${t.status} <> 'published' OR ${t.publishedAt} IS NOT NULL`),
  check("products_currency_fmt", currencyCheck(t.currency)),
  index("products_category_status_idx").on(t.categoryId, t.status),
  index("products_published_at_idx").on(t.publishedAt),
  index("products_size_chart_idx").on(t.sizeChartId),
]);

export const productTranslations = pgTable("product_translations", {
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  locale: text("locale").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  materials: text("materials"),
  care: text("care"),
  fitNotes: text("fit_notes"),
  seoTitle: text("seo_title"),
  seoDescription: text("seo_description"),
  // B12: full-text search ('simple' config is safe for uz/ru)
  searchTsv: tsvector("search_tsv").generatedAlwaysAs(
    sql`to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(description,'') || ' ' || coalesce(materials,''))`,
  ),
}, (t) => [
  primaryKey({ columns: [t.productId, t.locale] }),
  check("product_translations_locale_chk", localeCheck(t.locale)),
  index("product_translations_search_idx").using("gin", t.searchTsv),
]);

export const productVariants = pgTable("product_variants", {
  id: id(),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
  sku: text("sku").notNull().unique(),
  size: text("size"),
  colour: text("colour"),
  colourHex: char("colour_hex", { length: 7 }),
  priceCents: bigint("price_cents", { mode: "number" }), // null = use products.base_price_cents
  stockOnHand: integer("stock_on_hand").notNull().default(0),
  stockReserved: integer("stock_reserved").notNull().default(0),
  // Public availability flag; anon/authenticated get column-level SELECT on this, never on the counts.
  inStock: boolean("in_stock").generatedAlwaysAs(sql`stock_on_hand - stock_reserved > 0`),
  isActive: boolean("is_active").notNull().default(true),
  weightGrams: integer("weight_grams"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  unique("product_variants_product_size_colour_uq").on(t.productId, t.size, t.colour).nullsNotDistinct(),
  check("product_variants_on_hand_nonneg", sql`${t.stockOnHand} >= 0`),
  check("product_variants_reserved_nonneg", sql`${t.stockReserved} >= 0`),
  check("product_variants_reserved_le_on_hand", sql`${t.stockReserved} <= ${t.stockOnHand}`),
  check("product_variants_price_nonneg", sql`${t.priceCents} IS NULL OR ${t.priceCents} >= 0`),
  check("product_variants_weight_nonneg", sql`${t.weightGrams} IS NULL OR ${t.weightGrams} >= 0`),
  check("product_variants_colour_hex_fmt", sql`${t.colourHex} IS NULL OR ${t.colourHex} ~ '^#[0-9A-Fa-f]{6}$'`),
  index("product_variants_product_idx").on(t.productId),
]);

export const productImages = pgTable("product_images", {
  id: id(),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  variantId: uuid("variant_id").references(() => productVariants.id, { onDelete: "set null" }),
  storagePath: text("storage_path").notNull(),
  alt: text("alt").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
  width: integer("width"),
  height: integer("height"),
}, (t) => [index("product_images_product_idx").on(t.productId, t.sortOrder), index("product_images_variant_idx").on(t.variantId)]);
