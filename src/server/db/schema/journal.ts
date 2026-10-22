import { index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./_common";
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
}, (t) => [index("articles_status_published_idx").on(t.status, t.publishedAt)]);

export const articleTranslations = pgTable("article_translations", {
  articleId: uuid("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
  locale: text("locale").notNull(),
  title: text("title").notNull(),
  excerpt: text("excerpt"),
  body: jsonb("body").notNull(),
  seoTitle: text("seo_title"),
  seoDescription: text("seo_description"),
}, (t) => [primaryKey({ columns: [t.articleId, t.locale] })]);

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
