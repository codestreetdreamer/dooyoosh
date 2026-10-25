/** GET /products, GET /products/{slug} (owner: Backend & Database). Reads as `anon` via storefront_* views. */
import "server-only";
import type { ListProductsQuery, ListProductsResponse, ProductDetail } from "@/contracts/catalog";
import type { Locale } from "@/contracts/common";
import { ApiError } from "@/lib/errors";
import { asAnon } from "../db/client";
import { decodeCursor, encodeCursor, num, productCardFrom, toCard, toImage, type ProductCardRow } from "./shared";

export async function listProducts(q: ListProductsQuery): Promise<ListProductsResponse> {
  if (q.minPrice != null && q.maxPrice != null && q.minPrice > q.maxPrice) {
    throw ApiError.validation("minPrice must be <= maxPrice", [{ path: ["minPrice"], message: "minPrice > maxPrice" }]);
  }
  return asAnon(async (tx) => {
    const price = tx`coalesce(sp.price_from_cents, sp.base_price_cents)`;
    // keyset cursor per sort: new -> [published_at iso, id]; price -> [price, id]
    let after = tx``;
    if (q.cursor) {
      if (q.sort === "new") {
        const [ts, id] = decodeCursor(q.cursor, ["string", "string"]) as [string, string];
        if (Number.isNaN(Date.parse(ts))) throw ApiError.validation("Invalid cursor");
        after = tx`and (sp.published_at, sp.id) < (${ts}::timestamptz, ${id}::uuid)`;
      } else {
        const [p, id] = decodeCursor(q.cursor, ["number", "string"]) as [number, string];
        after = q.sort === "price_asc"
          ? tx`and (${price}, sp.id) > (${p}::bigint, ${id}::uuid)`
          : tx`and (${price}, sp.id) < (${p}::bigint, ${id}::uuid)`;
      }
    }
    const order = q.sort === "new" ? tx`order by sp.published_at desc, sp.id desc`
      : q.sort === "price_asc" ? tx`order by ${price} asc, sp.id asc` : tx`order by ${price} desc, sp.id desc`;
    const category = q.category
      ? tx`and sp.category_id in (
            with recursive c as (select id from public.categories where slug = ${q.category}
                                 union all select ch.id from public.categories ch join c on ch.parent_id = c.id)
            select id from c)`
      : tx``;
    const variantFilter = q.size || q.colour
      ? tx`and exists (select 1 from public.storefront_variants sv where sv.product_id = sp.id
            ${q.size ? tx`and lower(sv.size) = lower(${q.size})` : tx``}
            ${q.colour ? tx`and lower(sv.colour) = lower(${q.colour})` : tx``})`
      : tx``;
    const minP = q.minPrice != null ? tx`and ${price} >= ${q.minPrice}` : tx``;
    const maxP = q.maxPrice != null ? tx`and ${price} <= ${q.maxPrice}` : tx``;

    const rows = await tx<ProductCardRow[]>`
      ${productCardFrom(tx, q.locale)}
      where true ${category} ${variantFilter} ${minP} ${maxP} ${after}
      ${order} limit ${q.limit + 1}`;
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    const cursor = rows.length > q.limit && last
      ? encodeCursor(q.sort === "new" ? [last.published_key, last.id] : [num(last.price_from), last.id])
      : null;
    return { data: page.map(toCard), page: { cursor, limit: q.limit } };
  });
}

export async function getProduct(slug: string, locale: Locale): Promise<ProductDetail> {
  return asAnon(async (tx) => {
    const [row] = await tx<(ProductCardRow & Record<string, unknown>)[]>`
      select c.*, sp2.size_system, sp2.size_chart_id,
             coalesce(t.description, te.description) as description, coalesce(t.materials, te.materials) as materials,
             coalesce(t.care, te.care) as care, coalesce(t.fit_notes, te.fit_notes) as fit_notes,
             coalesce(t.seo_title, te.seo_title) as seo_title, coalesce(t.seo_description, te.seo_description) as seo_description
        from (${productCardFrom(tx, locale)} where sp.slug = ${slug}) c
        join public.storefront_products sp2 on sp2.id = c.id
        left join public.product_translations t on t.product_id = c.id and t.locale = ${locale}
        left join public.product_translations te on te.product_id = c.id and te.locale = 'en'`;
    if (!row) throw ApiError.notFound("Product not found");
    const id = row.id;
    const [images, variants, charts] = await Promise.all([
      tx<{ id: string; variant_id: string | null; storage_path: string; alt: string | null; width: number | null; height: number | null; sort_order: number }[]>`
        select id, variant_id, storage_path, alt, width, height, sort_order from public.product_images
         where product_id = ${id} order by (variant_id is not null), sort_order, id`,
      tx<{ id: string; sku: string; size: string | null; colour: string | null; colour_hex: string | null; price_cents: string; currency: string; available: boolean }[]>`
        select id, sku, size, colour, colour_hex, price_cents, currency, available
          from public.storefront_variants where product_id = ${id} order by sku`,
      row.size_chart_id
        ? tx<{ id: string; name: string; data: unknown }[]>`select id, name, data from public.size_charts where id = ${row.size_chart_id as string}`
        : Promise.resolve([] as { id: string; name: string; data: unknown }[]),
    ]);
    const s = (k: string) => (row[k] as string | null) ?? null;
    return {
      ...toCard(row),
      description: s("description"), materials: s("materials"), care: s("care"), fitNotes: s("fit_notes"),
      seoTitle: s("seo_title"), seoDescription: s("seo_description"),
      sizeSystem: row.size_system as ProductDetail["sizeSystem"],
      sizeChart: charts[0] ? { id: charts[0].id, name: charts[0].name, data: charts[0].data } : null,
      images: images.map(toImage),
      variants: variants.map((v) => ({
        id: v.id, sku: v.sku, size: v.size, colour: v.colour,
        colourHex: v.colour_hex && /^#[0-9A-Fa-f]{6}$/.test(v.colour_hex) ? v.colour_hex : null,
        priceMinor: num(v.price_cents), currency: v.currency.trim(), available: v.available,
      })),
    };
  });
}
