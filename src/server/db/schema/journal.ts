import { bigint, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/pg-core";
import { tsvector } from "./_types";
import { createdAt, id, localeCheck, updatedAt } from "./_common";
import { products } from "./catalog";

export const articleStatus = pgEnum("article_status", ["draft", "scheduled", "published", "archived"]);

export const articles = pgTable("articles", {
  id: id(),
  slug: text("slug").notNull().unique(),
  status: articleStatus("status").notNull().default("draft"),
  coverImagePath: text("cover_image_path"),
  authorName: text("author_name"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("articles_status_published_idx").on(t.status, t.publishedAt),
  check("articles_published_requires_published_at", sql`${t.status} NOT IN ('published','scheduled') OR ${t.publishedAt} IS NOT NULL`),
]);

export const articleTranslations = pgTable("article_translations", {
  articleId: uuid("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
  locale: text("locale").notNull(),
  title: text("title").notNull(),
  excerpt: text("excerpt"),
  body: jsonb("body").notNull(),
  seoTitle: text("seo_title"),
  seoDescription: text("seo_description"),
  searchTsv: tsvector("search_tsv").generatedAlwaysAs(
    sql`to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(excerpt,''))`,
  ),
}, (t) => [
  primaryKey({ columns: [t.articleId, t.locale] }),
  check("article_translations_locale_chk", localeCheck(t.locale)),
  index("article_translations_search_idx").using("gin", t.searchTsv),
]);

export const articleProducts = pgTable("article_products", {
  articleId: uuid("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.articleId, t.productId] }), index("article_products_product_idx").on(t.productId)]);

export const tags = pgTable("tags", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
});

export const articleTags = pgTable("article_tags", {
  articleId: uuid("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
  tagId: uuid("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.articleId, t.tagId] }), index("article_tags_tag_idx").on(t.tagId)]);

// B11: newsletter double opt-in. RLS on, no public policies (server only).
export const newsletterStatus = pgEnum("newsletter_status", ["pending", "confirmed", "unsubscribed"]);
export const newsletterSubscribers = pgTable("newsletter_subscribers", {
  id: id(),
  email: text("email").notNull().unique(),
  locale: text("locale").notNull().default("en"),
  status: newsletterStatus("status").notNull().default("pending"),
  confirmTokenHash: text("confirm_token_hash"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  check("newsletter_email_lower", sql`${t.email} = lower(${t.email})`),
  check("newsletter_locale_chk", localeCheck(t.locale)),
  index("newsletter_confirm_token_idx").on(t.confirmTokenHash),
]);

// 0008: DB-backed newsletter rate limit (QA P3). Only hashes are stored (HMAC/sha256 of IP and email), pruned after 24h.
// RLS on, no API-role access; written/counted only by public.newsletter_attempt() (service_role).
export const newsletterAttempts = pgTable("newsletter_attempts", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  ipHash: text("ip_hash"),
  emailHash: text("email_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("newsletter_attempts_ip_hash_fmt", sql`${t.ipHash} IS NULL OR ${t.ipHash} ~ '^[0-9a-f]{64}$'`),
  check("newsletter_attempts_email_hash_fmt", sql`${t.emailHash} ~ '^[0-9a-f]{64}$'`),
  index("newsletter_attempts_ip_idx").on(t.ipHash, t.createdAt),
  index("newsletter_attempts_email_idx").on(t.emailHash, t.createdAt),
  index("newsletter_attempts_created_idx").on(t.createdAt),
]);
