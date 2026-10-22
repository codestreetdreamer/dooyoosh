/**
 * Admin contracts: /api/v1/admin/* (spec §5 Admin). Requires Supabase admin session + role (TOTP).
 * Role matrix: owner = all; editor = products, articles, media; fulfilment = orders, shipments, inventory adjust.
 * Owners: products/variants/articles/media -> Backend & Database; orders/shipments/variants adjust -> Payments & Orders.
 */
import { z } from "zod";
import { categoryKind, productImage, productStatus, sizeSystem } from "./catalog";
import { address, currency, email, isoDateTime, locale, nonNegativeMinor, paginated, paginationQuery, single, slug, uuid } from "./common";
import { totals } from "./checkout";
import { articleStatus, tag, tiptapDoc } from "./journal";
import { orderItem, orderReference, orderStatus, shipment } from "./orders";
import { paymentSummary, refundSummary } from "./payments";

export { adjustStockRequest, adjustStockResponse, inventoryMovement } from "./inventory";

export const ADMIN_ROLES = ["owner", "editor", "fulfilment"] as const;
export const adminRole = z.enum(ADMIN_ROLES);
export type AdminRole = z.infer<typeof adminRole>;

export const ADMIN_AREAS = ["products", "articles", "media", "orders", "shipments", "inventory"] as const;
export type AdminArea = (typeof ADMIN_AREAS)[number];
export const ROLE_MATRIX: Record<AdminRole, readonly AdminArea[]> = {
  owner: ADMIN_AREAS,
  editor: ["products", "articles", "media"],
  fulfilment: ["orders", "shipments", "inventory"],
};

export const idParams = z.object({ id: uuid });

// ---------------- Products ----------------
export const productTranslationInput = z.object({
  locale,
  name: z.string().min(1).max(200),
  description: z.string().max(10_000).nullable().optional(),
  materials: z.string().max(2_000).nullable().optional(),
  care: z.string().max(2_000).nullable().optional(),
  fitNotes: z.string().max(2_000).nullable().optional(),
  seoTitle: z.string().max(70).nullable().optional(),
  seoDescription: z.string().max(170).nullable().optional(),
});

export const adminVariant = z.object({
  id: uuid,
  sku: z.string(),
  size: z.string().nullable(),
  colour: z.string().nullable(),
  colourHex: z.string().nullable(),
  priceMinor: nonNegativeMinor.nullable(),
  stockOnHand: z.number().int().nonnegative(),
  stockReserved: z.number().int().nonnegative(),
  isActive: z.boolean(),
  weightGrams: z.number().int().nonnegative().nullable(),
});
export type AdminVariant = z.infer<typeof adminVariant>;

export const adminProduct = z.object({
  id: uuid,
  slug,
  categoryId: uuid,
  categoryKind: categoryKind.optional(),
  brand: z.string().nullable(),
  status: productStatus,
  basePriceMinor: nonNegativeMinor,
  currency,
  sizeSystem,
  sizeChartId: uuid.nullable(),
  translations: z.array(productTranslationInput),
  variants: z.array(adminVariant),
  images: z.array(productImage),
  publishedAt: isoDateTime.nullable(),
  archivedAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type AdminProduct = z.infer<typeof adminProduct>;

export const adminListProductsQuery = paginationQuery.extend({
  status: productStatus.optional(),
  category: uuid.optional(),
  q: z.string().max(100).optional(),
});
export const adminListProductsResponse = paginated(adminProduct.omit({ translations: true, images: true }).extend({ name: z.string() }));

export const createProductRequest = z.object({
  slug,
  categoryId: uuid,
  brand: z.string().max(100).nullable().optional(),
  basePriceMinor: nonNegativeMinor,
  /** must equal the active market currency; server rejects others */
  currency,
  sizeSystem,
  sizeChartId: uuid.nullable().optional(),
  translations: z.array(productTranslationInput).min(1),
});
export type CreateProductRequest = z.infer<typeof createProductRequest>;
export const updateProductRequest = createProductRequest.partial();
export const adminProductResponse = single(adminProduct);
/** DELETE = archive (soft delete), POST /publish, POST /unpublish -> adminProductResponse */

// ---------------- Variants ----------------
export const createVariantRequest = z.object({
  sku: z.string().min(1).max(64).regex(/^[A-Z0-9-_.]+$/i),
  size: z.string().max(20).nullable().optional(),
  colour: z.string().max(40).nullable().optional(),
  colourHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().optional(),
  priceMinor: nonNegativeMinor.nullable().optional(),
  /** initial stock is written via adjust_stock(restock), never as a raw column write */
  initialStock: z.number().int().nonnegative().default(0),
  isActive: z.boolean().default(true),
  weightGrams: z.number().int().nonnegative().nullable().optional(),
});
/** PATCH /variants/{id}: stock is NOT patchable here (use /adjust). */
export const updateVariantRequest = createVariantRequest.omit({ initialStock: true }).partial();
export const adminVariantResponse = single(adminVariant);

// ---------------- Inventory ----------------
export const listMovementsQuery = paginationQuery;
// response: paginated(inventoryMovement) — see inventory.ts

// ---------------- Orders ----------------
export const adminOrderListItem = z.object({
  id: uuid,
  reference: orderReference,
  email,
  status: orderStatus,
  currency,
  totalMinor: nonNegativeMinor,
  itemCount: z.number().int().nonnegative(),
  placedAt: isoDateTime,
  paidAt: isoDateTime.nullable(),
});
export const adminListOrdersQuery = paginationQuery.extend({ status: orderStatus.optional(), q: z.string().max(100).optional() });
export const adminListOrdersResponse = paginated(adminOrderListItem);

export const orderEvent = z.object({
  id: uuid,
  type: z.string(),
  fromStatus: orderStatus.nullable(),
  toStatus: orderStatus.nullable(),
  payload: z.unknown().nullable(),
  actorId: uuid.nullable(),
  createdAt: isoDateTime,
});

export const adminOrder = z.object({
  id: uuid,
  reference: orderReference,
  checkoutId: uuid,
  email,
  phone: z.string().nullable(),
  locale,
  status: orderStatus,
  totals,
  items: z.array(orderItem.extend({ variantId: uuid.nullable() })),
  shippingAddress: address,
  billingAddress: address.nullable(),
  shippingMethodId: uuid,
  payments: z.array(paymentSummary),
  refunds: z.array(refundSummary),
  shipments: z.array(shipment),
  events: z.array(orderEvent),
  placedAt: isoDateTime,
  paidAt: isoDateTime.nullable(),
  updatedAt: isoDateTime,
});
export type AdminOrder = z.infer<typeof adminOrder>;
export const adminOrderResponse = single(adminOrder);

/** POST /orders/{id}/transition — validated against ORDER_TRANSITIONS in transitions.ts */
export const transitionOrderRequest = z.object({ to: orderStatus, note: z.string().max(500).optional() });

/** POST /orders/{id}/refund */
export const refundOrderRequest = z.object({
  amountMinor: nonNegativeMinor.refine((v) => v > 0, "must be > 0"),
  reason: z.string().min(1).max(500),
  /** client-generated, dedupes double clicks */
  idempotencyKey: uuid,
});
export const refundOrderResponse = single(refundSummary);

// ---------------- Shipments ----------------
/** POST /orders/{id}/shipments -> order status shipped + email */
export const createShipmentRequest = z.object({
  carrier: z.string().min(1).max(60),
  trackingNumber: z.string().min(1).max(100),
  trackingUrl: z.url().refine((u) => u.startsWith("https://"), "https only").optional(),
});
export const createShipmentResponse = single(shipment);

// ---------------- Articles ----------------
export const articleTranslationInput = z.object({
  locale,
  title: z.string().min(1).max(200),
  excerpt: z.string().max(500).nullable().optional(),
  body: tiptapDoc,
  seoTitle: z.string().max(70).nullable().optional(),
  seoDescription: z.string().max(170).nullable().optional(),
});

export const adminArticle = z.object({
  id: uuid,
  slug,
  status: articleStatus,
  coverImagePath: z.string().nullable(),
  authorName: z.string().nullable(),
  translations: z.array(articleTranslationInput),
  productIds: z.array(uuid),
  tags: z.array(tag),
  publishedAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export const adminListArticlesQuery = paginationQuery.extend({ status: articleStatus.optional() });
export const adminListArticlesResponse = paginated(adminArticle.omit({ translations: true }).extend({ title: z.string() }));
export const createArticleRequest = z.object({
  slug,
  coverImagePath: z.string().max(500).nullable().optional(),
  authorName: z.string().max(100).nullable().optional(),
  translations: z.array(articleTranslationInput).min(1),
  productIds: z.array(uuid).max(24).default([]),
  tagSlugs: z.array(slug).max(10).default([]),
});
export const updateArticleRequest = createArticleRequest.partial();
/** POST /articles/{id}/publish: optional schedule */
export const publishArticleRequest = z.object({ publishAt: isoDateTime.optional() });
export const adminArticleResponse = single(adminArticle);

// ---------------- Media ----------------
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const mediaUploadUrlRequest = z.object({
  filename: z.string().min(1).max(200).regex(/^[\w.-]+$/),
  contentType: z.enum(ALLOWED_IMAGE_TYPES),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  purpose: z.enum(["product", "article"]),
});
export const mediaUploadUrlResponse = single(
  z.object({ uploadUrl: z.url(), storagePath: z.string(), token: z.string(), expiresAt: isoDateTime }),
);
