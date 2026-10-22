/** Shared storefront read helpers (owner: Backend & Database). Server only. */
import "server-only";
import type { ProductCard, ProductImage } from "@/contracts/catalog";
import type { Locale } from "@/contracts/common";
import { ApiError } from "@/lib/errors";
import { clientEnv } from "@/lib/env";
import type { Tx } from "../db/client";

export const STORAGE_BUCKET = "product-images";

/** Public URL of an object in the product-images bucket (docs/DATABASE.md §6). */
export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https:\/\//.test(path)) return path;
  const base = clientEnv().NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, "");
  const key = path.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
  return `${base}/storage/v1/object/public/${STORAGE_BUCKET}/${key}`;
}

export const iso = (d: Date | string | null | undefined): string | null =>
  d == null ? null : (d instanceof Date ? d : new Date(d)).toISOString();
export const num = (v: unknown): number => (typeof v === "number" ? v : Number(v));

// ---- Opaque keyset cursors: base64url(JSON [sortValue, id]) ----
export function encodeCursor(parts: (string | number | null)[]): string {
  return Buffer.from(JSON.stringify(parts)).toString("base64url");
}
export function decodeCursor(cursor: string | undefined, shape: ("string" | "number" | "nullable-string")[]): (string | number | null)[] | null {
  if (!cursor) return null;
  try {
    const v: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Array.isArray(v) || v.length !== shape.length) throw new Error("shape");
    v.forEach((x, i) => {
      const t = shape[i];
      const okType = t === "number" ? typeof x === "number" && Number.isSafeInteger(x)
        : t === "string" ? typeof x === "string" && x.length > 0 && x.length < 100
        : x === null || (typeof x === "string" && x.length < 100);
      if (!okType) throw new Error("type");
    });
    return v as (string | number | null)[];
  } catch {
    throw ApiError.validation("Invalid cursor", [{ path: ["cursor"], message: "Invalid cursor" }]);
  }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Row shape produced by productCardSql. */
export interface ProductCardRow {
  id: string; slug: string; name: string; brand: string | null; category_slug: string;
  price_from: string | number; currency: string; available: boolean; published_at: Date | null; published_key: string | null;
  img_id: string | null; img_variant_id: string | null; img_path: string | null; img_alt: string | null;
  img_width: number | null; img_height: number | null; img_sort: number | null;
}

/**
 * SELECT list + FROM for product cards over storefront_products (alias sp). Name falls back to 'en', then slug.
 * Cover image = first product-level image (variant images after), by sort order.
 */
export function productCardFrom(tx: Tx, locale: Locale) {
  return tx`
    select sp.id, sp.slug, coalesce(t.name, te.name, sp.slug) as name, sp.brand, sp.category_slug,
           coalesce(sp.price_from_cents, sp.base_price_cents) as price_from, sp.currency, sp.available, sp.published_at, sp.published_at::text as published_key,
           img.id as img_id, img.variant_id as img_variant_id, img.storage_path as img_path, img.alt as img_alt,
           img.width as img_width, img.height as img_height, img.sort_order as img_sort
      from public.storefront_products sp
      left join public.product_translations t on t.product_id = sp.id and t.locale = ${locale}
      left join public.product_translations te on te.product_id = sp.id and te.locale = 'en'
      left join lateral (
        select i.id, i.variant_id, i.storage_path, i.alt, i.width, i.height, i.sort_order
          from public.product_images i where i.product_id = sp.id
         order by (i.variant_id is not null), i.sort_order, i.id limit 1) img on true`;
}

export function toImage(r: { id: string; variant_id: string | null; storage_path: string; alt: string | null; width: number | null; height: number | null; sort_order: number }): ProductImage {
  return {
    id: r.id, variantId: r.variant_id, url: mediaUrl(r.storage_path)!, alt: r.alt ?? "",
    width: r.width && r.width > 0 ? r.width : null, height: r.height && r.height > 0 ? r.height : null, sortOrder: r.sort_order,
  };
}

export function toCard(r: ProductCardRow): ProductCard {
  return {
    id: r.id, slug: r.slug, name: r.name, brand: r.brand, categorySlug: r.category_slug,
    priceFromMinor: num(r.price_from), currency: r.currency.trim(), available: r.available, publishedAt: iso(r.published_at),
    image: r.img_id && r.img_path
      ? toImage({ id: r.img_id, variant_id: r.img_variant_id, storage_path: r.img_path, alt: r.img_alt, width: r.img_width, height: r.img_height, sort_order: r.img_sort ?? 0 })
      : null,
  };
}
